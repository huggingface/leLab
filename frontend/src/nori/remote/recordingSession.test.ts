import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetRecordingSession, newRecordingCollectionId, rememberRecordingSession, restoreRecordingSession } from "./recordingSession";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("recording session identity", () => {
  it("uses native UUID support when available", () => {
    const native = vi.fn(() => "12345678-1234-4234-8234-123456789abc");
    vi.stubGlobal("crypto", { randomUUID: native });
    expect(newRecordingCollectionId()).toBe(native.mock.results[0].value);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it.each(["getRandomValues", "no crypto"])("creates valid distinct UUIDs with %s", (support) => {
    let seed = 0;
    vi.stubGlobal("crypto", support === "getRandomValues" ? { getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(++seed); return bytes;
    } } : undefined);
    const ids = Array.from({ length: 20 }, newRecordingCollectionId);
    expect(ids.every((id) => uuid.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(20);
  });
  it("restores a group for a new client after reload and clears it on Finish", () => {
    const scope = "backend/robot-0000";
    const session = { collectionId: newRecordingCollectionId(), task: "Same prompt", startedAt: new Date().toISOString(), episodeIds: ["take-a"] };
    rememberRecordingSession({}, scope, session);
    const reconnected = {};
    expect(restoreRecordingSession(reconnected, scope, "take-a")).toEqual(session);
    expect(restoreRecordingSession({}, "backend/robot-0001")).toBeNull();
    expect(restoreRecordingSession({}, "other-backend/robot-0000")).toBeNull();
    forgetRecordingSession(reconnected, scope);
    expect(restoreRecordingSession(reconnected, scope)).toBeNull();
    expect(restoreRecordingSession({}, scope)).toBeNull();
  });
  it("preserves identity across card remounts when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } });
    const client = {};
    const session = { collectionId: newRecordingCollectionId(), task: "Prompt", startedAt: new Date().toISOString(), episodeIds: [] };
    rememberRecordingSession(client, "robot", session);
    expect(restoreRecordingSession(client, "robot")).toEqual(session);
    expect(restoreRecordingSession(client, "other robot")).toBeNull();
  });
  it("discards a v1 journal rather than guessing its recovered episode membership", () => {
    const scope = "backend/robot";
    sessionStorage.setItem(`nori.recordingSession.v1:${scope}`, JSON.stringify({
      collectionId: newRecordingCollectionId(), task: "Same prompt", startedAt: new Date().toISOString(),
    }));
    expect(restoreRecordingSession({}, scope, "unknown-take")).toBeNull();
    // A rollback's old reader sees no incompatible or stale session entry.
    expect(sessionStorage.getItem(`nori.recordingSession.v1:${scope}`)).toBeNull();
    expect(sessionStorage.getItem(`nori.recordingSession.v2:${scope}`)).toBeNull();
  });
  it.each(["same client", "new client"])("rejects a different recovered episode on the %s even with the same task", (kind) => {
    const owner = {};
    const scope = "backend/robot";
    rememberRecordingSession(owner, scope, { collectionId: newRecordingCollectionId(), task: "Same prompt",
      startedAt: new Date().toISOString(), episodeIds: ["take-a"] });
    expect(restoreRecordingSession(kind === "same client" ? owner : {}, scope, "take-b")).toBeNull();
    expect(sessionStorage.getItem(`nori.recordingSession.v2:${scope}`)).toBeNull();
  });
  it("does not infer a new client's group from an open session without an episode ID", () => {
    rememberRecordingSession({}, "robot", { collectionId: newRecordingCollectionId(), task: "Prompt",
      startedAt: new Date().toISOString(), episodeIds: ["take-a"] });
    expect(restoreRecordingSession({}, "robot")).toBeNull();
  });
});
