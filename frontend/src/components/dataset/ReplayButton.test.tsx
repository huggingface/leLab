// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ReplayButton from "./ReplayButton";
import { RobotRecord } from "@/hooks/useRobots";

const backend = vi.hoisted(() => ({
  active: false,
  startOk: true,
  statusFails: false,
  requests: [] as { path: string; body?: unknown }[],
}));
const robot = vi.hoisted(() => ({ current: null as RobotRecord | null }));
const toast = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({ baseUrl: "http://localhost:8000", fetchWithHeaders: () => {} }));

vi.mock("@/contexts/ApiContext", () => ({ useApi: () => api }));
vi.mock("@/hooks/useRobots", () => ({ useRobots: () => ({ selectedRecord: robot.current }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/apiClient", () => ({
  apiRequest: async (_baseUrl: string, _fetcher: unknown, path: string, opts?: { body?: unknown }) => {
    backend.requests.push({ path, body: opts?.body });
    if (path === "/replay-status") {
      if (backend.statusFails) throw new Error("network");
      return { replay_active: backend.active, error: null };
    }
    if (path === "/start-replay") {
      backend.active = backend.startOk;
      return { success: backend.startOk, message: "A replay is already running" };
    }
    return { success: true, message: "Replay stopped" };
  },
}));

const calibrated: RobotRecord = {
  name: "arm",
  leader_port: "/dev/leader",
  follower_port: "/dev/follower",
  leader_config: "leader.json",
  follower_config: "follower.json",
  cameras: [],
  is_clean: true,
};

let host: HTMLDivElement;
let root: Root;
const onStart = vi.fn();

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

async function mount() {
  await act(async () => {
    root.render(<ReplayButton repoId="local/ds" episodeIndex={2} onStart={onStart} />);
  });
}

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Object.assign(backend, { active: false, startOk: true, statusFails: false, requests: [] });
  robot.current = calibrated;
  toast.mockClear();
  onStart.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

test("hidden until a calibrated robot is selected", async () => {
  robot.current = null;
  await mount();
  expect(host.querySelector("button")).toBeNull();
});

test("a replay already running stays stoppable without a selected robot", async () => {
  robot.current = null;
  backend.active = true;
  await mount();
  expect(button("Stop robot")).toBeDefined();
});

test("starting replays this episode and runs the footage alongside", async () => {
  await mount();
  await act(async () => button("Play on robot")!.click());
  expect(backend.requests.at(-1)).toMatchObject({
    path: "/start-replay",
    body: { dataset_repo_id: "local/ds", episode_index: 2, follower_port: "/dev/follower" },
  });
  expect(onStart).toHaveBeenCalledOnce();
  expect(button("Stop robot")).toBeDefined();
});

test("Stop stays until the status shows the arm released", async () => {
  backend.active = true;
  await mount();
  await act(async () => button("Stop robot")!.click());
  await poll();
  expect(button("Stop robot")).toBeDefined();

  backend.active = false;
  await poll();
  expect(button("Play on robot")).toBeDefined();
});

test("a failed status poll keeps the Stop button", async () => {
  backend.active = true;
  await mount();
  backend.statusFails = true;
  await poll();
  expect(button("Stop robot")).toBeDefined();
});

test("a refused start reports it and offers Play again", async () => {
  backend.startOk = false;
  await mount();
  await act(async () => button("Play on robot")!.click());
  expect(onStart).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "A replay is already running" }),
  );
  expect(button("Play on robot")).toBeDefined();
});
