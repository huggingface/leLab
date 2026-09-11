// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import EpisodeViewer from "./EpisodeViewer";
import { EpisodeDetail } from "@/lib/datasetApi";

vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://localhost:8000" }),
}));
vi.mock("./FilmStrip", () => ({ default: () => null }));
vi.mock("./MotionTrace", () => ({ default: () => null }));

test.each([0, 4])("playback loops at file end with an episode offset of %s seconds", async (offset) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const detail: EpisodeDetail = {
    success: true, repo_id: "owner/demo", episode_index: 1,
    length: 10, duration_s: 1, tasks: [], fps: 10, robot_type: "test",
    cameras: [{ name: "top", chunk: 0, file_index: 0,
      from_timestamp: offset, to_timestamp: offset + 1 }],
    prev_episode: 0, next_episode: null, total_episodes: 2,
  };
  act(() => root.render(<EpisodeViewer repoId="owner/demo" detail={detail} onNavigate={() => {}} />));
  const video = host.querySelector("video")!;
  let paused = false;
  let ended = false;
  Object.defineProperties(video, {
    paused: { get: () => paused },
    ended: { get: () => ended },
  });
  video.play = vi.fn(async () => { paused = false; });
  try {
    act(() => video.dispatchEvent(new Event("play")));
    // At natural EOF the browser is already paused when timeupdate runs,
    // then delivers pause and ended. Seeking alone does not resume playback.
    paused = true;
    ended = true;
    video.currentTime = offset + 1;
    await act(async () => {
      for (const type of ["timeupdate", "pause", "ended"]) {
        video.dispatchEvent(new Event(type));
      }
    });
    expect(video.currentTime).toBe(offset);
    expect(paused).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});
