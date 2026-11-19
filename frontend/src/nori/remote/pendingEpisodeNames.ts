// Record-time custom names are queued per acknowledged Keep and matched after
// promotion by stable episode ID. Legacy stored session queues retain their
// previous count/task/time matching. Names survive reloads for up to 48 hours.

import { type Fetcher } from "@/lib/apiClient";
import { getRobotRecordings } from "@/nori/api/client";
import { listRecordingEpisodes, nameRecordingEpisode } from "@/nori/remote/episodeReview";

export interface PendingNameSet {
  /** Laptop-clock ISO time of session_start. */
  startedAt: string;
  /** The session task — every episode's meta.json task, used to verify a match. */
  task: string;
  /** Per KEPT episode, in recording order ("" = left unnamed). */
  names: string[];
  /** Modern robot takes are matched by identity, independently of upload order. */
  episodeIds?: string[];
}

const KEY = "nori.pendingEpisodeNames.v1";
const EXPIRE_MS = 48 * 3600 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function load(): PendingNameSet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as PendingNameSet[]) : [];
    if (!Array.isArray(arr)) return [];
    // Expire stale sets and drop degenerate ones (nothing to apply).
    return arr.filter(
      (s) =>
        s &&
        Array.isArray(s.names) &&
        s.names.some((n) => n) &&
        Date.now() - Date.parse(s.startedAt) < EXPIRE_MS,
    );
  } catch {
    return [];
  }
}

function save(sets: PendingNameSet[]) {
  try {
    if (sets.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(sets));
  } catch {
    // localStorage unavailable (private mode) — names just won't survive reload.
  }
}

/** Queue one modern take or a legacy session. No-op if all names are empty. */
export function addPendingNames(set: PendingNameSet): void {
  if (!set.names.some((n) => n)) return;
  const prior = load().filter((pending) => !set.episodeIds?.[0] || pending.episodeIds?.[0] !== set.episodeIds[0]);
  save([...prior, set]);
}

/** How many naming updates are still waiting to be applied. */
export function pendingNameCount(): number {
  return load().length;
}

/** Try to apply every pending set. Returns how many updates were applied and
 * how many remain (their bundles haven't uploaded/promoted yet, or no bundle
 * matched safely). Safe to call repeatedly — a set is removed only after every
 * one of its non-empty names is written. */
export async function applyPendingNames(
  baseUrl: string,
  fetcher: Fetcher,
): Promise<{ applied: number; pending: number; identityUnavailable?: boolean }> {
  let sets = load();
  if (sets.length === 0) return { applied: 0, pending: 0 };

  const { bundles } = await getRobotRecordings(baseUrl, fetcher);
  const used = new Set<string>();
  const remaining: PendingNameSet[] = [];
  let applied = 0;
  let identityUnavailable = false;

  // Oldest session first, matched to its oldest eligible bundle, so two
  // same-task same-count sessions pair up chronologically instead of both
  // grabbing the newest upload.
  sets = [...sets].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const set of sets) {
    const t0 = Date.parse(set.startedAt) - CLOCK_SKEW_MS;
    const candidates = bundles
      .filter(
        (b) =>
          b.status === "PROMOTED" &&
          !used.has(b.session_id) &&
          (set.episodeIds?.length
            ? !b.recording_metadata?.episode_id || set.episodeIds.includes(b.recording_metadata.episode_id)
            : b.episode_count === set.names.length && Date.parse(b.created_at) >= t0),
      )
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    let done = false;
    for (const cand of candidates) {
      try {
        const listing = await listRecordingEpisodes(baseUrl, fetcher, cand.session_id);
        const eps = listing.episodes;
        if (set.episodeIds?.length) {
          if (eps.length && eps.every((episode) => !episode.episode_id)) {
            identityUnavailable = true;
            continue;
          }
          // Each modern queue item is one acknowledged Keep. Never guess its
          // target using prompt text, count, timestamps or arrival order.
          const target = eps.find((ep) => ep.episode_id === set.episodeIds![0]);
          if (!target) continue;
          const name = set.names[0].trim();
          if (name && target.name !== name) await nameRecordingEpisode(
            baseUrl, fetcher, cand.session_id, target.index, name);
          used.add(cand.session_id);
          applied += 1;
          done = true;
          break;
        }
        if (eps.length !== set.names.length) continue;
        if (!eps.every((e) => e.task === set.task)) continue;
        for (let i = 0; i < set.names.length; i++) {
          const name = set.names[i].trim();
          if (!name || eps[i].name === name) continue;
          await nameRecordingEpisode(baseUrl, fetcher, cand.session_id, eps[i].index, name);
        }
        used.add(cand.session_id);
        applied += 1;
        done = true;
        break;
      } catch {
        // Listing/PATCH failed (still finalizing, transient network) — keep the
        // set pending; already-written names re-verify as equal next round.
        break;
      }
    }
    if (!done) remaining.push(set);
  }
  save(remaining);
  return { applied, pending: remaining.length, ...(identityUnavailable ? { identityUnavailable: true } : {}) };
}
