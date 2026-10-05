// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CameraConfiguration from "./CameraConfiguration";
import { CameraConfig, normalizeCameraConfig, serializeCameras } from "@/lib/cameraConfig";
vi.mock("@/hooks/useAvailableCameras", () => ({ useAvailableCameras: () => ({ cameras: [], isLoading: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useCameraStream", () => ({ useCameraStream: () => ({ videoRef: React.createRef<HTMLVideoElement>(), hasError: false }) }));
let root: Root;
let container: HTMLDivElement;
const camera: CameraConfig = { id: "wrist", name: "wrist", device_id: "usb-wrist", type: "opencv", width: 640, height: 480 };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); root = createRoot(container); });
afterEach(() => act(() => root.unmount()));
test("rotation updates the profile while capture dimensions stay native", () => {
  const change = vi.fn();
  act(() => root.render(<CameraConfiguration cameras={[camera]} onCamerasChange={change} />));
  const select = container.querySelector("select")!;
  expect(select.value).toBe("0");
  act(() => { select.value = "90"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change).toHaveBeenCalledWith([{ ...camera, rotation: 90 }]);
  const saved = JSON.parse(JSON.stringify(change.mock.calls[0][0])).map(normalizeCameraConfig);
  act(() => root.render(<CameraConfiguration cameras={saved} onCamerasChange={change} />));
  expect(container.querySelector("select")!.value).toBe("90");
  expect(container.querySelector("video")!.style.transform).toContain("rotate(90deg)");
  expect(serializeCameras(saved).wrist).toMatchObject({ rotation: 90, width: 640, height: 480 });
});
test("the recording configuration displays rotated output without an editing control", () => {
  act(() => root.render(<CameraConfiguration cameras={[{ ...camera, rotation: 90 }]} readOnly onCamerasChange={vi.fn()} />));
  expect(container.textContent).toContain("480×640 · 90° clockwise");
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("video")!.parentElement!.style.aspectRatio).toBe("480 / 640");
});

test("an invalid stored rotation stays visible until the user selects a valid value", () => {
  const change = vi.fn();
  const invalid = { ...camera, rotation: 45 as never };
  act(() => root.render(<CameraConfiguration cameras={[invalid]} onCamerasChange={change} />));
  expect(container.querySelector("[role=alert]")!.textContent).toContain("Select a valid rotation");
  expect(container.querySelector("video")).toBeNull();
  const select = container.querySelector("select")!;
  expect(select.value).toBe("");
  act(() => { select.value = "180"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change).toHaveBeenCalledWith([{ ...camera, rotation: 180 }]);
});
