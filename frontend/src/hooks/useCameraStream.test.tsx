// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCameraStream } from "./useCameraStream";

let root: Root;
let container: HTMLDivElement;
const getUserMedia = vi.fn();
const stop = vi.fn();

const Preview = () => {
  const { videoRef } = useCameraStream("cam", false, { width: 640, height: 480 });
  return <video ref={videoRef} />;
};

const flush = () => act(async () => {});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop }] });
  stop.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const requestedSize = (call: number) => {
  const { width, height } = getUserMedia.mock.calls[call][0].video;
  return [width.ideal, height.ideal];
};

test("opens at the recorded size and keeps a stream that delivers frames", async () => {
  act(() => root.render(<Preview />));
  await flush();
  Object.defineProperty(container.querySelector("video")!, "readyState", { value: HTMLMediaElement.HAVE_CURRENT_DATA });
  await act(async () => vi.advanceTimersByTime(5000));
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(requestedSize(0)).toEqual([640, 480]);
  expect(stop).not.toHaveBeenCalled();
});

test("reopens at 1280x720 when the recorded size never delivers a frame", async () => {
  act(() => root.render(<Preview />));
  await flush();
  await act(async () => vi.advanceTimersByTime(2500));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(requestedSize(1)).toEqual([1280, 720]);
});
