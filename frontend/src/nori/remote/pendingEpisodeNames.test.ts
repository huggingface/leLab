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
