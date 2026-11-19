import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRobotRecordings } from "@/nori/api/client";
import { listRecordingEpisodes, nameRecordingEpisode } from "./episodeReview";
import { addPendingNames, applyPendingNames, pendingNameCount } from "./pendingEpisodeNames";

vi.mock("@/nori/api/client", () => ({ getRobotRecordings: vi.fn() }));
vi.mock("./episodeReview", () => ({ listRecordingEpisodes: vi.fn(), nameRecordingEpisode: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
const fetcher = vi.fn();
const queued = (id: string, name: string) => addPendingNames({ startedAt: new Date().toISOString(),
  task: "Same prompt", names: [name], episodeIds: [id] });

describe("pending per-take names", () => {
  it("matches independently uploaded takes by ID despite identical tasks and reversed order", async () => {
    queued("episode-a", "First take");
    queued("episode-b", "Second take");
    vi.mocked(getRobotRecordings).mockResolvedValue({ on_robot_pending: 0, bundles: [
      { session_id: "upload-b", status: "PROMOTED", episode_count: 1 },
      { session_id: "upload-a", status: "PROMOTED", episode_count: 1 },
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
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [{ session_id: "other", status: "PROMOTED" }] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", episode_id: "wrong" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1 });
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
  });
  it("persists failed writes and deduplicates acknowledged Keep retries", async () => {
    queued("wanted", "old name");
    queued("wanted", "new name");
    expect(pendingNameCount()).toBe(1);
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [{ session_id: "upload", status: "PROMOTED" }] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, episode_id: "wanted" }] } as never);
    vi.mocked(nameRecordingEpisode).mockRejectedValueOnce(new Error("offline"));
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1 });
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenLastCalledWith("", fetcher, "upload", 0, "new name");
  });
  it("falls back to manual naming when an older backend omits episode IDs", async () => {
    queued("wanted", "My name");
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [{ session_id: "old", status: "PROMOTED" }] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Same prompt", name: "" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 0, pending: 1, identityUnavailable: true });
    expect(nameRecordingEpisode).not.toHaveBeenCalled();
    expect(pendingNameCount()).toBe(1);
  });
  it("still applies names stored by the older session-based UI", async () => {
    const at = new Date().toISOString();
    addPendingNames({ startedAt: at, task: "Old prompt", names: ["old custom name"] });
    vi.mocked(getRobotRecordings).mockResolvedValue({ bundles: [{ session_id: "old", status: "PROMOTED", episode_count: 1, created_at: at }] } as never);
    vi.mocked(listRecordingEpisodes).mockResolvedValue({ episodes: [{ index: 0, task: "Old prompt", name: "" }] } as never);
    expect(await applyPendingNames("", fetcher)).toEqual({ applied: 1, pending: 0 });
    expect(nameRecordingEpisode).toHaveBeenCalledWith("", fetcher, "old", 0, "old custom name");
  });
});
