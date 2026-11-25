import { TERMINAL, type TaskRecord } from "./api";

// Each task owns a local copy. Editing a reloaded harness in another task preserves the original.
export interface HarnessSnapshot {
  version: 1;
  model: string;
  revision: number;
  tools: { name: string; description: string; source: string }[];
}

export interface SavedHarness {
  id: string;
  label: string;
  snapshot: HarnessSnapshot;
}

export const HARNESSES_CHANGED = "nori-agent-harnesses-changed";

function prefix(owner: string, model: string) {
  return `nori:agent-harness:${encodeURIComponent(owner)}:${model}:`;
}

function parse(value: string | null, model: string): SavedHarness | null {
  if (!value) return null;
  try {
    const entry = JSON.parse(value);
    const s = entry?.snapshot;
    if (typeof entry.id === "string" && typeof entry.label === "string" && s?.version === 1 && s.model === model
      && Number.isInteger(s.revision) && Array.isArray(s.tools) && s.tools.length
      && s.tools.every((t: HarnessSnapshot["tools"][number]) =>
        t && typeof t.name === "string" && typeof t.description === "string" && typeof t.source === "string")) return entry;
  } catch { /* ignore an unreadable entry */ }
  return null;
}

export function saveHarness(owner: string, id: string, label: string, snapshot: HarnessSnapshot) {
  const key = prefix(owner, snapshot.model) + id;
  const prior = parse(localStorage.getItem(key), snapshot.model);
  if (prior && prior.snapshot.revision >= snapshot.revision) return;
  localStorage.setItem(key, JSON.stringify({ id, label, snapshot }));
  window.dispatchEvent(new Event(HARNESSES_CHANGED));
}

export function listHarnesses(owner: string, model: string): SavedHarness[] {
  const group = prefix(owner, model);
  const entries: SavedHarness[] = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(group)) continue;
    const entry = parse(localStorage.getItem(key), model);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

const pendingPrefix = (owner: string) => `nori:pending-harness:${encodeURIComponent(owner)}:`;

export function rememberHarnessTask(owner: string, id: string) {
  localStorage.setItem(pendingPrefix(owner) + id, id);
}

export function pendingHarnessTasks(owner: string): string[] {
  const prefix = pendingPrefix(owner);
  return Object.keys(localStorage).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
}

export function archiveTaskHarness(owner: string, record: TaskRecord) {
  if (record.authored_harness) saveHarness(owner, record.task_id, record.instruction, record.authored_harness);
  if (TERMINAL.has(record.status)) localStorage.removeItem(pendingPrefix(owner) + record.task_id);
}
