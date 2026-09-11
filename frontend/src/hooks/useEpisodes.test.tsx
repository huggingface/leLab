// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useEpisodes } from "./useEpisodes";
import { listEpisodes, EpisodeListResponse } from "@/lib/datasetApi";

vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://localhost:8000", fetchWithHeaders: fetch }),
}));
vi.mock("@/lib/datasetApi", () => ({ listEpisodes: vi.fn() }));

let root: Root;
let current: ReturnType<typeof useEpisodes>;
let renders: Array<ReturnType<typeof useEpisodes>>;
let pending: Array<{
  resolve: (value: EpisodeListResponse) => void;
  reject: (error: Error) => void;
}>;

function Probe({ repoId }: { repoId: string | null }) {
  current = useEpisodes(repoId);
  renders.push(current);
  return null;
}

function listing(repoId: string, first: number): EpisodeListResponse {
  return {
    success: true, repo_id: repoId, fps: 10, robot_type: "test",
    total_episodes: 1, total_frames: 10, cameras: [],
    episodes: [{ episode_index: first, length: 10, duration_s: 1, tasks: [] }],
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  renders = [];
  pending = [];
  vi.mocked(listEpisodes).mockImplementation(() => new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
  }));
});

afterEach(() => act(() => root.unmount()));

test("a late previous dataset response cannot replace the selected list", async () => {
  act(() => root.render(<Probe repoId="owner/A" />));
  act(() => root.render(<Probe repoId="owner/B" />));
  await act(async () => pending[1].resolve(listing("owner/B", 10)));
  await act(async () => pending[0].resolve(listing("owner/A", 0)));
  expect(current.data?.repo_id).toBe("owner/B");
  expect(current.data?.episodes[0].episode_index).toBe(10);
});

test("switching dataset never exposes the previous first episode to auto-selection", async () => {
  act(() => root.render(<Probe repoId="owner/A" />));
  await act(async () => pending[0].resolve(listing("owner/A", 0)));
  renders = [];
  act(() => root.render(<Probe repoId="owner/B" />));
  expect(renders.every((result) => result.data === null)).toBe(true);
  await act(async () => pending[1].resolve(listing("owner/B", 10)));
  expect(current.data?.episodes[0].episode_index).toBe(10);
});

test("an obsolete failure cannot clear data or finish the current request", async () => {
  act(() => root.render(<Probe repoId="owner/A" />));
  act(() => root.render(<Probe repoId="owner/B" />));
  await act(async () => pending[0].reject(new Error("old request failed")));
  expect(current.error).toBeNull();
  expect(current.loading).toBe(true);
  await act(async () => pending[1].resolve(listing("owner/B", 10)));
  expect(current.data?.repo_id).toBe("owner/B");
});

test("clearing selection ignores an in-flight response", async () => {
  act(() => root.render(<Probe repoId="owner/A" />));
  act(() => root.render(<Probe repoId={null} />));
  await act(async () => pending[0].resolve(listing("owner/A", 0)));
  expect(current.data).toBeNull();
  expect(current.loading).toBe(false);
});
