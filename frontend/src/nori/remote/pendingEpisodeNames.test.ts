import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRobotRecordings } from "@/nori/api/client";
import { listRecordingEpisodes, nameRecordingEpisode } from "./episodeReview";
import { addPendingNames, applyPendingNames, pendingNameCount } from "./pendingEpisodeNames";

vi.mock("@/nori/api/client", () => ({ getRobotRecordings: vi.fn() }));
vi.mock("./episodeReview", () => ({ listRecordingEpisodes: vi.fn(), nameRecordingEpisode: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  fetcher = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
let fetcher = vi.fn();
const legacyKey = "nori.pendingEpisodeNames.v1";
const modernKey = "nori.pendingEpisodeNames.v2";
const reservationsKey = "nori.episodeNameReservations.v1";
const bundle = (session_id: string) => ({ session_id, status: "PROMOTED", episode_count: 1,
  label: "Same prompt", created_at: new Date().toISOString() });
const queued = (id: string, name: string) => addPendingNames({ startedAt: new Date().toISOString(),
  task: "Same prompt", names: [name], episodeIds: [id] });

describe("pending per-take names", () => {
  it("matches independently uploaded takes by ID despite identical tasks and reversed order", async () => {
    queued("episode-a", "First take");
    queued("episode-b", "Second take");
    vi.mocked(getRobotRecordings).mockResolvedValue({ on_robot_pending: 0, bundles: [
      bundle("upload-b"), bundle("upload-a"),
    ] } as never);
    vi.mocked(listRecordingEpisodes).mockImplementation(async (_base, _fetch, id) => ({
      episodes: [{ index: 0, episode_id: id === "upload-a" ? "episode-a" : "episode-b", task: "Same prompt", name: "" }],
    }) as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 2, pending: 0 });
    expect(vi.mocked(nameRecordingEpisode).mock.calls.map((call) => call.slice(2))).toEqual([
      ["upload-a", 0, "First take"], ["upload-b", 0, "Second take"],
    ]);
  });
  it("never guesses a matching task is the right episode", async () => {
    queued("wanted", "My take");
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("other")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", episode_id: "wrong" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1 });
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
  });
  it("persists failed writes and deduplicates acknowledged Keep retries", async () => {
    queued("wanted", "old name");
    queued("wanted", "new name");
    expect(pendingNameCount()).toBe(1);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("upload")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, episode_id: "wanted" }] } as never);
    vi.mocked(nameRecordingEpisode).mockRejectedValueOnce(new Error("offline"));
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenLastCalledWith("", expect.any(Function), "upload", 0, "new name");
  });
  it("falls back to manual naming when an older backend omits episode IDs", async () => {
    queued("wanted", "My name");
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("old")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", name: "" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1, identityUnavailable: true });
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
    expect(pendingNameCount()).toBe(1);
  });

  it("keeps modern names invisible to an older Lab's v1 queue reader", () => {
    addPendingNames({ startedAt: new Date().toISOString(), task: "Legacy", names: ["Legacy name"] });
    queued("episode-a", "Name intended for A");
    const oldReader = JSON.parse(localStorage.getItem(legacyKey)!);
    expect(oldReader.map((s: { names: string[] }) => s.names)).toEqual([["Legacy name"]]);
    expect(localStorage.getItem(legacyKey)).not.toContain("episode-a");
    expect(JSON.parse(localStorage.getItem(modernKey)!)[0].episodeIds).toEqual(["episode-a"]);
    expect(pendingNameCount()).toBe(2);
  });

  it("rescues identity-based names left in v1 without losing legacy names", () => {
    const at = new Date().toISOString();
    localStorage.setItem(legacyKey, JSON.stringify([
      { startedAt: at, task: "Legacy", names: ["Old"] },
      { startedAt: at, task: "Same prompt", names: ["Original"], episodeIds: ["episode-a"] },
    ]));
    expect(pendingNameCount()).toBe(2);
    expect(JSON.parse(localStorage.getItem(legacyKey)!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(modernKey)!)[0].episodeIds).toEqual(["episode-a"]);
    queued("episode-a", "Updated");
    expect(pendingNameCount()).toBe(2);
    expect(JSON.parse(localStorage.getItem(modernKey)!)[0].names).toEqual(["Updated"]);
  });

  it("does not scan unrelated historical recordings for modern names", async () => {
    for (let i = 0; i < 3; i++) queued(`wanted-${i}`, `Name ${i}`);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: Array.from({ length: 100 }, (_, i) => ({
      ...bundle(`old-${i}`), created_at: "2020-01-01T00:00:00Z", label: "Unrelated",
    })) } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 3 });
    expect(listRecordingEpisodes).not.toHaveBeenCalled();
  });

  it("bounds and shares discovery, caches missing IDs and backs off repeated retries", async () => {
    for (let i = 0; i < 3; i++) queued(`wanted-${i}`, `Name ${i}`);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: Array.from({ length: 100 }, (_, i) => bundle(`old-${i}`)) } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", name: "" }] } as never);
    expect(await applyPendingNames("", fetcher)).toMatchObject({ pending: 3, identityUnavailable: true });
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(8);
    await applyPendingNames("", fetcher);
    expect(getRobotRecordings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await applyPendingNames("", fetcher);
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(16);
    expect(new Set(vi.mocked(listRecordingEpisodes).mock.calls.map((c) => c[2])).size).toBe(16);
    await vi.advanceTimersByTimeAsync(30_000);
    await applyPendingNames("", fetcher);
    expect(getRobotRecordings).toHaveBeenCalledTimes(2); // next retry waits 60 seconds
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
  });

  it("does not overlap slow retries or discard names queued during a request", async () => {
    queued("episode-a", "First");
    let release!: (value: never) => void;
    vi.mocked(getRobotRecordings).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyPendingNames("", fetcher)).toBe(first);
    expect(getRobotRecordings).toHaveBeenCalledTimes(1);
    queued("episode-b", "Second");
    release({ bundles: [bundle("a")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, episode_id: "episode-a", name: "" }] } as never);
    expect(await first).toMatchObject({ applied: 1, pending: 1 });
    expect(JSON.parse(localStorage.getItem(modernKey)!)[0].episodeIds).toEqual(["episode-b"]);
  });

  it("rechecks cached missing identity after expiry so a backend upgrade can apply names", async () => {
    queued("wanted", "My name");
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("old")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValueOnce({ episodes: [{ index: 0, task: "Same prompt" }] } as never)
      .mockResolvedValueOnce({ episodes: [{ index: 0, episode_id: "wanted", task: "Same prompt" }] } as never);
    await applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(30_000);
    await applyPendingNames("", fetcher);
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await applyPendingNames("", fetcher)).toMatchObject({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenCalledWith("", expect.any(Function), "old", 0, "My name");
  });

  it("prioritizes exact metadata identity and refreshes the index before a retried write", async () => {
    queued("wanted", "My name");
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [
      ...Array.from({ length: 100 }, (_, i) => bundle(`old-${i}`)),
      { ...bundle("right"), recording_metadata: { episode_id: "wanted" } },
    ] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValueOnce({ episodes: [{ index: 2, episode_id: "wanted" }] } as never)
      .mockResolvedValueOnce({ episodes: [{ index: 1, episode_id: "wanted" }] } as never);
    vi.mocked(nameRecordingEpisode).mockRejectedValueOnce(new Error("offline"));
    await applyPendingNames("", fetcher);
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await applyPendingNames("", fetcher)).toMatchObject({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenLastCalledWith("", expect.any(Function), "right", 1, "My name");
  });
  it("still applies names stored by the older session-based UI", async () => {
    const at = new Date().toISOString();
    addPendingNames({ startedAt: at, task: "Old prompt", names: ["old custom name"] });
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [{ session_id: "old", status: "PROMOTED", episode_count: 1, created_at: at }] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Old prompt", name: "" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenCalledWith("", expect.any(Function), "old", 0, "old custom name");
  });

  it.each(["registration metadata", "viewer identity"])("preserves a delayed legacy name when modern uploads arrive first with %s", async (identitySource) => {
    addPendingNames({ startedAt: new Date(Date.now() - 60_000).toISOString(),
      task: "Same prompt", names: ["Legacy session name"] });
    queued("modern-episode", "Modern take name");
    const modern = { ...bundle("modern-upload"), ...(identitySource === "registration metadata"
      ? { recording_metadata: { episode_id: "modern-episode" } } : {}) };
    const saved = new Map<string, string>();
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [modern] } as never);
    vi.mocked(listRecordingEpisodes).mockImplementation(async (_base, _fetch, id) => ({
      episodes: [{ index: 0, task: "Same prompt", episode_id: id === "modern-upload" ? "modern-episode" : "legacy-episode",
        name: saved.get(id) ?? "" }],
    }) as never);
    vi.mocked(nameRecordingEpisode).mockImplementation(async (_base, _fetch, id, index, name) => {
      saved.set(id, name); return { index, name };
    });
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 1 });
    expect(vi.mocked(nameRecordingEpisode).mock.calls.map((call) => call.slice(2))).toEqual([
      ["modern-upload", 0, "Modern take name"],
    ]);
    expect(JSON.parse(localStorage.getItem(legacyKey)!)[0].names).toEqual(["Legacy session name"]);
    expect(localStorage.getItem(modernKey)).toBeNull();

    // The completed modern queue is gone. Its protection must survive a
    // reload and another retry while the legacy upload is still delayed.
    vi.resetModules();
    const reloaded = await import("./pendingEpisodeNames");
    expect(await reloaded.applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1 });
    expect(nameRecordingEpisode).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [modern, bundle("legacy-upload")] } as never);
    expect(await reloaded.applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
    expect(vi.mocked(nameRecordingEpisode).mock.calls.map((call) => call.slice(2))).toEqual([
      ["modern-upload", 0, "Modern take name"], ["legacy-upload", 0, "Legacy session name"],
    ]);
    expect(saved.get("modern-upload")).toBe("Modern take name");
    expect(reloaded.pendingNameCount()).toBe(0);
  });

  it.each(["Same prompt", "Unrelated prompt"])("handles missing backend identity safely with a modern take for %s", async (modernTask) => {
    addPendingNames({ startedAt: new Date(Date.now() - 60_000).toISOString(), task: "Same prompt", names: ["Legacy name"] });
    // Even an unnamed kept modern take must not receive a legacy name.
    addPendingNames({ startedAt: new Date().toISOString(), task: modernTask, names: [""], episodeIds: ["modern-take"] });
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("unknown-upload")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", name: "" }] } as never);
    if (modernTask === "Same prompt") {
      expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1, identityUnavailable: true });
      expect(nameRecordingEpisode).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(legacyKey)!)[0].names).toEqual(["Legacy name"]);
    } else {
      expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
      expect(nameRecordingEpisode).toHaveBeenCalledWith("", expect.any(Function), "unknown-upload", 0, "Legacy name");
    }
    expect(localStorage.getItem(modernKey)).toBeNull();
  });

  it("protects a modern name queued while a legacy episode lookup is in flight", async () => {
    addPendingNames({ startedAt: new Date(Date.now() - 60_000).toISOString(), task: "Same prompt", names: ["Legacy name"] });
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("modern-upload")] } as never);
    const listing = { episodes: [{ index: 0, episode_id: "modern-take", task: "Same prompt", name: "" }] };
    let release!: (value: never) => void;
    vi.mocked(listRecordingEpisodes).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue(listing as never);
    const pending = applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(0);
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(1);
    queued("modern-take", "Modern name");
    release(listing as never);
    expect(await pending).toEqual({ applied: 0, pending: 2 });
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 1 });
    expect(nameRecordingEpisode).toHaveBeenCalledTimes(1);
    expect(nameRecordingEpisode).toHaveBeenCalledWith("", expect.any(Function), "modern-upload", 0, "Modern name");
  });

  it("expires modern reservations after the legacy naming retention window", async () => {
    addPendingNames({ startedAt: new Date().toISOString(), task: "Same prompt", names: [""], episodeIds: ["modern-take"] });
    expect(JSON.parse(localStorage.getItem(reservationsKey)!)).toHaveLength(1);
    expect(pendingNameCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(48 * 3600_000 + 1);
    addPendingNames({ startedAt: new Date().toISOString(), task: "New session", names: ["New name"] });
    expect(localStorage.getItem(reservationsKey)).toBeNull();
    expect(pendingNameCount()).toBe(1);
  });

  it("aborts a stalled recordings request, releases the lock and retries queued names", async () => {
    queued("wanted", "My name");
    let signal!: AbortSignal;
    fetcher.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise(() => {});
    });
    vi.mocked(getRobotRecordings).mockImplementationOnce(async (_base, bounded) => {
      await bounded("/fake-recordings");
      return { bundles: [], on_robot_pending: 0 };
    }).mockResolvedValue({ bundles: [bundle("upload")] } as never);
    const pending = applyPendingNames("", fetcher);
    const refused = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(applyPendingNames("", fetcher)).toBe(pending);
    await vi.advanceTimersByTimeAsync(1_000);
    await refused;
    expect(signal.aborted).toBe(true);
    expect(pendingNameCount()).toBe(1);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, episode_id: "wanted" }] } as never);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await applyPendingNames("", fetcher)).toMatchObject({ applied: 1, pending: 0 });
  });

  it("stops a pass after one timed-out episode listing and preserves every queued name", async () => {
    for (let i = 0; i < 3; i++) queued(`wanted-${i}`, `Name ${i}`);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("upload")] } as never);
    vi.mocked(listRecordingEpisodes).mockImplementation(() => new Promise(() => {}));
    const pending = applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ applied: 0, pending: 3 });
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(1);
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
  });

  it.each(["modern", "legacy queue"])("verifies an uncertain %s rename saved by the server before retrying the write", async (kind) => {
    if (kind === "modern") queued("wanted", "My name");
    else addPendingNames({ startedAt: new Date().toISOString(), task: "Same prompt", names: ["My name"] });
    let savedName = "";
    let signal!: AbortSignal;
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("upload")] } as never);
    vi.mocked(listRecordingEpisodes).mockImplementation(async () => ({
      episodes: [{ index: savedName ? 1 : 2, episode_id: "wanted", name: savedName, task: "Same prompt" }],
    }) as never);
    fetcher.mockImplementation((_url: string, options: RequestInit) => {
      savedName = "My name"; // server commits, response never arrives
      signal = options.signal!;
      return new Promise(() => {});
    });
    vi.mocked(nameRecordingEpisode).mockImplementationOnce(async (_base, bounded) => {
      await bounded("/fake-name", { method: "PATCH" });
      return { index: 2, name: "My name" };
    });
    const pending = applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ applied: 0, pending: 1 });
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await applyPendingNames("", fetcher)).toMatchObject({ applied: 1, pending: 0 });
    expect(listRecordingEpisodes).toHaveBeenCalledTimes(2);
    expect(nameRecordingEpisode).toHaveBeenCalledTimes(1);
  });

  it("prevents a rename delayed in auth from sending after its deadline", async () => {
    queued("wanted", "My name");
    let releaseAuth!: () => void;
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [bundle("upload")] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, episode_id: "wanted" }] } as never);
    vi.mocked(nameRecordingEpisode).mockImplementationOnce(async (_base, bounded) => {
      await new Promise<void>((resolve) => { releaseAuth = resolve; });
      await bounded("/fake-name", { method: "PATCH" });
      return { index: 0, name: "My name" };
    });
    const pending = applyPendingNames("", fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ applied: 0, pending: 1 });
    releaseAuth();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(pendingNameCount()).toBe(1);
  });
});
