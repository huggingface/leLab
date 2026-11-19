// Session identity outlives the capture card. The client cache covers page
// navigation even when browser storage is unavailable; sessionStorage also
// covers reload/reconnect, separately for each backend/robot and browser tab.
export type RecordingSession = { collectionId: string; task: string; startedAt: string };
const sessions = new WeakMap<object, { scope: string; session: RecordingSession }>();
const key = (scope: string) => `nori.recordingSession.v1:${scope}`;

export function newRecordingCollectionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  // This is a grouping identifier, not an authentication secret.
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function rememberRecordingSession(owner: object, scope: string, session: RecordingSession): void {
  sessions.set(owner, { scope, session });
  if (scope) try { sessionStorage.setItem(key(scope), JSON.stringify(session)); } catch { /* Client cache still works. */ }
}

export function restoreRecordingSession(owner: object, scope: string): RecordingSession | null {
  const cached = sessions.get(owner);
  if (cached?.scope === scope) return cached.session;
  if (scope) try {
    const saved = JSON.parse(sessionStorage.getItem(key(scope)) || "null");
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.collectionId)
      && typeof saved.task === "string" && typeof saved.startedAt === "string"
      && Date.now() - Date.parse(saved.startedAt) < 48 * 3600_000) {
      sessions.set(owner, { scope, session: saved });
      return saved;
    }
  } catch { /* No persisted session. */ }
  return null;
}

export function forgetRecordingSession(owner: object, scope: string): void {
  sessions.delete(owner);
  if (scope) try { sessionStorage.removeItem(key(scope)); } catch { /* Best effort. */ }
}
