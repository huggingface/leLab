import { expect, test } from "vitest";
import { CameraConfig, cameraRotation, normalizeCameraConfig, physicalCameraKey, rotatedDimensions, rotationForCamera, serializeCameras } from "./cameraConfig";
const camera: CameraConfig = { id: "wrist", name: "wrist", device_id: "usb-wrist", camera_index: 1, type: "opencv", width: 640, height: 480, fps: 30 };

test("old profiles default to zero without changing capture dimensions", () => {
  expect(normalizeCameraConfig(camera)).toEqual({ ...camera, rotation: 0 });
});
test.each([0, 90, 180, 270] as const)("rotation %s survives profile and session serialization", (rotation) => {
  const saved = JSON.parse(JSON.stringify(normalizeCameraConfig({ ...camera, rotation })));
  expect(serializeCameras([saved]).wrist).toEqual({ type: "opencv", camera_index: 1, width: 640, height: 480, fps: 30, rotation });
});
test.each([null, "90", -90, 45, 360, true, NaN])("invalid rotation %s is not replaced with zero", (value) => {
  expect(() => cameraRotation(value)).toThrow("Camera rotation must be");
});
test.each([0, 90, 180, 270] as const)("capture/output conversion is reversible at %s degrees", (rotation) => {
  const output = rotatedDimensions(640, 480, rotation);
  expect(output).toEqual(rotation === 90 || rotation === 270 ? { width: 480, height: 640 } : { width: 640, height: 480 });
  expect(rotatedDimensions(output.width, output.height, rotation)).toEqual({ width: 640, height: 480 });
});
test("rotation follows a physical camera across index drift and policy reassignment", () => {
  const saved = [{ ...camera, rotation: 180 as const }, { ...camera, id: "top", name: "top", device_id: "usb-top", camera_index: 2, rotation: 90 as const }];
  const wrist = { deviceId: "usb-wrist", index: 2 }, top = { deviceId: "usb-top", index: 1 };
  expect(rotationForCamera(wrist, saved, {})).toBe(180);
  expect(rotationForCamera(top, saved, {})).toBe(90);
  const overrides = { [physicalCameraKey(wrist)]: 270 as const };
  expect(rotationForCamera(wrist, saved, overrides)).toBe(270);
  expect(rotationForCamera(top, saved, overrides)).toBe(90);
  expect(rotationForCamera({ deviceId: "unsaved", index: 5 }, saved, {})).toBe(0);
});
