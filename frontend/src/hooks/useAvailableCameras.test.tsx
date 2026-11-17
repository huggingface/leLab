// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAvailableCameras } from "./useAvailableCameras";

const mocks = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://test", fetchWithHeaders: mocks.fetcher }),
}));

let root: Root;
let current: ReturnType<typeof useAvailableCameras>;
function Probe() {
  current = useAvailableCameras();
  return null;
}

const backendCameras = {
  status: "success",
  cameras: [
    { index: 0, name: "HD Pro Webcam C920", available: true },
    { index: 2, name: "icspring camera", available: true },
  ],
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify(backendCameras)));
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

test("lists the backend cameras without a preview when navigator.mediaDevices is undefined", async () => {
  // Plain http:// from another machine is not a secure context: the browser
  // exposes no mediaDevices at all (the headless-board-plus-laptop setup).
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

  await act(async () => root.render(<Probe />));
  await act(async () => {});

  expect(mocks.fetcher).toHaveBeenCalledWith("http://test/available-cameras");
  expect(current.cameras).toEqual([
    { index: 0, name: "HD Pro Webcam C920", deviceId: "", available: true },
    { index: 2, name: "icspring camera", deviceId: "", available: true },
  ]);
});

test("pairs a backend camera with the browser device of the same name", async () => {
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: "videoinput", deviceId: "dev-c920", label: "HD Pro Webcam C920 (046d:08e5)" },
  ]);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });

  await act(async () => root.render(<Probe />));
  await act(async () => {});

  expect(current.cameras.map((c) => [c.index, c.deviceId])).toEqual([
    [0, "dev-c920"],
    [2, ""],
  ]);
});
