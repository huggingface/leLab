// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BrowserCameraPreview from "./BrowserCameraPreview";
import CameraRotationSelect from "./CameraRotationSelect";
vi.mock("@/hooks/useCameraStream", () => ({ useCameraStream: () => ({ videoRef: React.createRef<HTMLVideoElement>(), hasError: false }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); root = createRoot(container); });
afterEach(() => act(() => root.unmount()));
test("the Rotation control exposes four clockwise values and emits a number", () => {
  const change = vi.fn();
  act(() => root.render(<CameraRotationSelect rotation={180} onChange={change} />));
  const select = container.querySelector("select")!;
  expect(container.querySelector("label")!.htmlFor).toBe(select.id);
  expect(select.value).toBe("180");
  expect(Array.from(select.options).map((option) => option.text)).toEqual(["0° clockwise", "90° clockwise", "180° clockwise", "270° clockwise"]);
  act(() => { select.value = "90"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change).toHaveBeenCalledWith(90);
});
test("a quarter turn fills the rotated recorded frame", () => {
  act(() => root.render(<BrowserCameraPreview deviceId="wrist" rotation={90} width={640} height={480} />));
  const video = container.querySelector("video")!, wrapper = video.parentElement!;
  expect(wrapper.style.aspectRatio).toBe("480 / 640");
  expect(video.style.objectFit).toBe("cover");
  expect(video.style.maxWidth).toBe("none");
  expect(video.style.transform).toBe("translate(-50%, -50%) rotate(90deg)");
  expect(parseFloat(video.style.width)).toBeCloseTo(640 / 480 * 100);
  expect(parseFloat(video.style.height)).toBeCloseTo(480 / 640 * 100);
});
test("a stream at another size keeps the recorded aspect ratio", () => {
  act(() => root.render(<BrowserCameraPreview deviceId="A" rotation={0} width={640} height={480} />));
  const video = container.querySelector("video")!;
  Object.defineProperty(video, "videoWidth", { value: 1280 });
  Object.defineProperty(video, "videoHeight", { value: 720 });
  act(() => video.dispatchEvent(new Event("loadedmetadata")));
  expect(video.parentElement!.style.aspectRatio).toBe("640 / 480");
  expect(video.style.width).toBe("100%");
  expect(video.style.objectFit).toBe("cover");
});
test("the reference ghost sits over the video with its rotation and opacity", () => {
  act(() => root.render(<BrowserCameraPreview deviceId="wrist" rotation={90} ghostSrc="blob:ref" ghostOpacity={0.3} />));
  const video = container.querySelector("video")!, ghost = container.querySelector("img")!;
  expect(ghost.getAttribute("src")).toBe("blob:ref");
  expect(ghost.style.opacity).toBe("0.3");
  expect(ghost.style.transform).toBe(video.style.transform);
  expect(ghost.style.width).toBe(video.style.width);
  act(() => root.render(<BrowserCameraPreview deviceId="wrist" />));
  expect(container.querySelector("img")).toBeNull();
});
