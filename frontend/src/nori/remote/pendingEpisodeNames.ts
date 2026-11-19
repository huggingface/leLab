// Modern names use a separate queue: older Lab versions must never interpret
// an identity-based name as a legacy task/time match after a rollback.
import { type Fetcher } from "@/lib/apiClient";
import { getRobotRecordings } from "@/nori/api/client";
import { listRecordingEpisodes, nameRecordingEpisode } from "@/nori/remote/episodeReview";

export interface PendingNameSet {
  startedAt: string;
  task: string;
  names: string[];
  episodeIds?: string[];
}

const LEGACY_KEY = "nori.pendingEpisodeNames.v1";
const KEY = "nori.pendingEpisodeNames.v2";
const EXPIRE_MS = 48 * 3600 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;
const MAX_LISTINGS = 8;
type Result = { applied: number; pending: number; identityUnavailable?: boolean };
type Listing = Awaited<ReturnType<typeof listRecordingEpisodes>>;
type RetryState = {
  inFlight?: Promise<Result>;
  nextAt: number;
  delay: number;
  signature: string;
  identityUnavailable: boolean;
  // Discovery only. Always obtain a fresh listing before writing by index.
  identities: Map<string, { ids: string[]; until: number }>;
};
const retries = new WeakMap<Fetcher, Map<string, RetryState>>();
const identityBased = (set: PendingNameSet) => Boolean(set.episodeIds?.length);
const signature = (set: PendingNameSet) => JSON.stringify(set);

function read(key: string): PendingNameSet[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s.startedAt === "string"
      && typeof s.task === "string" && Array.isArray(s.names)
      && s.names.every((n: unknown) => typeof n === "string") && s.names.some((n: string) => n.trim())
      && (!s.episodeIds || (Array.isArray(s.episodeIds) && s.episodeIds.every((id: unknown) => typeof id === "string")))
      && Date.now() - Date.parse(s.startedAt) < EXPIRE_MS) : [];
  } catch { return []; }
}

function write(key: string, sets: PendingNameSet[]): boolean {
  try {
    if (sets.length) localStorage.setItem(key, JSON.stringify(sets));
    else localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function load(): PendingNameSet[] {
  const old = read(LEGACY_KEY);
  const modern = read(KEY);
  // Rescue entries written by the initial issue-51 implementation. Remove
  // them from v1 only after successfully persisting the v2 copy.
  const misplaced = old.filter(identityBased);
  const combined = [...misplaced.filter((s) => !modern.some((m) => m.episodeIds?.[0] === s.episodeIds?.[0])), ...modern];
  if (misplaced.length && write(KEY, combined)) write(LEGACY_KEY, old.filter((s) => !identityBased(s)));
  return [...old.filter((s) => !identityBased(s)), ...combined];
}

function save(sets: PendingNameSet[]) {
  // Write modern names first so a failed storage write never moves them into v1.
  if (write(KEY, sets.filter(identityBased))) write(LEGACY_KEY, sets.filter((s) => !identityBased(s)));
}

export function addPendingNames(set: PendingNameSet): void {
  if (!set.names.some((n) => n.trim())) return;
  const prior = load().filter((s) => !set.episodeIds?.[0] || s.episodeIds?.[0] !== set.episodeIds[0]);
  save([...prior, set]);
}

export function pendingNameCount(): number { return load().length; }

/** Share overlapping retries, cap discovery requests, and back off while
 * waiting for uploads/older backends. State is scoped to the API/fetcher. */
export function applyPendingNames(baseUrl: string, fetcher: Fetcher): Promise<Result> {
  let scopes = retries.get(fetcher);
  if (!scopes) { scopes = new Map(); retries.set(fetcher, scopes); }
  let state = scopes.get(baseUrl);
  if (!state) {
    state = { nextAt: 0, delay: RETRY_MS, signature: "", identityUnavailable: false, identities: new Map() };
    scopes.set(baseUrl, state);
  }
  if (state.inFlight) return state.inFlight;
  const sets = load();
  if (!sets.length) return Promise.resolve({ applied: 0, pending: 0 });
  const queueSignature = JSON.stringify(sets);
  if (state.signature !== queueSignature) { state.nextAt = 0; state.delay = RETRY_MS; }
  if (Date.now() < state.nextAt) return Promise.resolve({ applied: 0, pending: sets.length,
    ...(state.identityUnavailable ? { identityUnavailable: true } : {}) });
  state.signature = queueSignature;
  const current = state;
  current.inFlight = run(baseUrl, fetcher, sets, current).then((result) => {
    current.identityUnavailable = result.identityUnavailable === true;
    return result;
  }).finally(() => {
    current.nextAt = Date.now() + current.delay;
    current.delay = Math.min(MAX_RETRY_MS, current.delay * 2);
    current.inFlight = undefined;
  });
  return current.inFlight;
}

async function run(baseUrl: string, fetcher: Fetcher, sets: PendingNameSet[], state: RetryState): Promise<Result> {
  const { bundles } = await getRobotRecordings(baseUrl, fetcher);
  const present = new Set(bundles.map((b) => b.session_id));
  for (const [id, entry] of state.identities) {
    if (!present.has(id) || entry.until <= Date.now()) state.identities.delete(id);
  }
  const used = new Set<string>();
  const completed = new Set<string>();
  const listings = new Map<string, Promise<Listing>>();
  let requests = 0;
  let applied = 0;
  let identityUnavailable = false;
  for (const set of [...sets].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) {
    const modern = identityBased(set);
    const targetId = set.episodeIds?.[0];
    const candidates = bundles.filter((b) => {
      if (b.status !== "PROMOTED" || used.has(b.session_id)) return false;
      if (!modern) return b.episode_count === set.names.length && Date.parse(b.created_at) >= Date.parse(set.startedAt) - CLOCK_SKEW_MS;
      if (b.recording_metadata?.episode_id) return b.recording_metadata.episode_id === targetId;
      // Older backends lack structured identity. Limit discovery to plausible
      // single-take uploads; matching still requires the actual episode UUID.
      return (b.episode_count == null || b.episode_count === 1)
        && Date.parse(b.created_at) >= Date.parse(set.startedAt) - CLOCK_SKEW_MS
        && b.label.trim() === set.task.trim().slice(0, 120).trim();
    }).sort((a, b) => Number(Boolean(b.recording_metadata?.episode_id)) - Number(Boolean(a.recording_metadata?.episode_id))
      || Date.parse(a.created_at) - Date.parse(b.created_at));
    for (const cand of candidates) {
      const cached = state.identities.get(cand.session_id);
      if (modern && !cand.recording_metadata?.episode_id && cached && !cached.ids.includes(targetId!)) {
        if (!cached.ids.length) identityUnavailable = true;
        continue;
      }
      try {
        let listing = listings.get(cand.session_id);
        if (!listing) {
          if (requests >= MAX_LISTINGS) break;
          requests++;
          listing = listRecordingEpisodes(baseUrl, fetcher, cand.session_id);
          listings.set(cand.session_id, listing);
        }
        const { episodes } = await listing;
        state.identities.set(cand.session_id, { ids: episodes.flatMap((e) => e.episode_id ? [e.episode_id] : []), until: Date.now() + MAX_RETRY_MS });
        if (modern) {
          if (episodes.length && episodes.every((e) => !e.episode_id)) { identityUnavailable = true; continue; }
          const target = episodes.find((e) => e.episode_id === targetId);
          if (!target) continue;
          const name = set.names[0].trim();
          if (name && target.name !== name) await nameRecordingEpisode(baseUrl, fetcher, cand.session_id, target.index, name);
        } else {
          if (episodes.length !== set.names.length || !episodes.every((e) => e.task === set.task)) continue;
          for (let i = 0; i < set.names.length; i++) {
            const name = set.names[i].trim();
            if (name && episodes[i].name !== name) await nameRecordingEpisode(baseUrl, fetcher, cand.session_id, episodes[i].index, name);
          }
        }
        used.add(cand.session_id);
        completed.add(signature(set));
        applied++;
        break;
      } catch { break; } // Keep failed writes queued; a fresh retry verifies names.
    }
  }
  // Preserve names queued/edited while this pass was waiting on the network.
  const remaining = load().filter((s) => !completed.has(signature(s)));
  save(remaining);
  state.signature = JSON.stringify(remaining);
  if (applied) state.delay = RETRY_MS;
  return { applied, pending: remaining.length, ...(identityUnavailable ? { identityUnavailable: true } : {}) };
}
