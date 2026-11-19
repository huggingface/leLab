import type { RawBundleEntry } from "@/nori/api/client";

export type RecordingGroup = {
  key: string;
  label: string;
  newestMs: number;
  bundles: RawBundleEntry[];
};

const SESSION_GAP_MS = 20 * 60_000;
const timestamp = (b: RawBundleEntry) => {
  const recorded = Date.parse(b.recording_metadata?.recorded_at ?? "");
  const created = Date.parse(b.created_at);
  return Number.isFinite(recorded) ? recorded : Number.isFinite(created) ? created : 0;
};

export function groupRecordings(bundles: RawBundleEntry[]): RecordingGroup[] {
  const buckets = new Map<string, RawBundleEntry[]>();
  for (const b of bundles) {
    const collection = b.recording_metadata?.collection_id;
    const legacyTask = b.recording_metadata?.task.trim() || b.label;
    const key = collection ? `collection:${collection}` : `legacy:${legacyTask}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(b);
    buckets.set(key, bucket);
  }
  const groups: RecordingGroup[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) => timestamp(a) - timestamp(b));
    const collection = sorted[0].recording_metadata?.collection_id;
    let cluster: RawBundleEntry[] = [];
    const flush = () => {
      if (!cluster.length) return;
      const task = cluster[0].recording_metadata?.task.trim() || "Recording";
      const preview = task.length > 64 ? task.slice(0, 63).trimEnd() + "…" : task;
      groups.push({
        key: collection ? key : `${key}:${cluster[0].session_id}`,
        label: collection ? `${preview} · ${collection.replace(/-/g, "").slice(0, 8)}` : cluster[0].recording_metadata?.task.trim() || cluster[0].label,
        newestMs: timestamp(cluster[cluster.length - 1]), bundles: cluster,
      });
      cluster = [];
    };
    for (const b of sorted) {
      // Only legacy uploads need time/label heuristics. A stable collection
      // survives slow uploads, edited names and long pauses between takes.
      if (!collection && cluster.length && timestamp(b) - timestamp(cluster[cluster.length - 1]) > SESSION_GAP_MS) flush();
      cluster.push(b);
    }
    flush();
  }
  return groups.sort((a, b) => b.newestMs - a.newestMs);
}

export function recordingOutcome(b: RawBundleEntry): string | null {
  if (!b.recording_metadata) return null;
  return ({ success: "Task succeeded", failure: "Task failed", aborted: "Aborted", discarded: "Discarded", unknown: "Outcome unknown" })[
    b.recording_metadata?.outcome ?? "unknown"
  ] ?? null;
}

/** Keep the API's legacy label stable for older Lab versions. Modern clients
 * display a separate generated name, while preserving owner-edited labels.
 */
export function recordingName(b: RawBundleEntry): string {
  const metadata = b.recording_metadata;
  const legacyTaskLabel = metadata?.task.trim().slice(0, 120).trim();
  if (metadata && b.label.trim() !== legacyTaskLabel) return b.label;
  if (metadata?.display_name) return metadata.display_name;
  const identity = b.session_id.replace(/-/g, "").slice(0, 12);
  return `${b.label} · ${identity}`;
}
