import { useEffect, useState } from "react";
import { RobotRecord } from "@/hooks/useRobots";
import { useAvailableCameras } from "@/hooks/useAvailableCameras";
import { ImageFeatures } from "@/lib/checkpointsApi";
import {
  CameraRequest,
  CameraRotation,
  PhysicalCamera,
  physicalCameraKey,
  rotatedDimensions,
  rotationForCamera,
  serializeCamera,
} from "@/lib/cameraConfig";

/**
 * Binds each expected camera to a physical one. A robot camera with the same
 * name is bound automatically; the user picks the rest.
 */
export function useCameraBindings(
  imageFeatures: ImageFeatures | null,
  robot: RobotRecord | null,
  enabled: boolean,
) {
  // Per expected camera name → user-selected physical camera index (or null).
  const [bindings, setBindings] = useState<Record<string, number | null>>({});
  // User rotation choice per physical camera, over the one saved with the robot.
  const [rotations, setRotations] = useState<Record<string, CameraRotation>>({});
  const { cameras: availableCameras } = useAvailableCameras({ enabled });

  // If the selected robot has cameras whose names match an expected camera,
  // auto-bind them. Prefer matching by browser device_id (stable across cv2
  // index drift); fall back to the saved camera_index.
  useEffect(() => {
    if (!imageFeatures) return;
    const robotCams = robot?.cameras ?? [];
    if (robotCams.length === 0 || availableCameras.length === 0) return;
    setBindings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const expectedName of Object.keys(imageFeatures)) {
        if (next[expectedName] != null) continue;
        const robotCam = robotCams.find(
          (c) => c.name.toLowerCase() === expectedName.toLowerCase(),
        );
        if (!robotCam) continue;
        const live =
          (robotCam.device_id &&
            availableCameras.find((c) => c.deviceId === robotCam.device_id)) ||
          availableCameras.find((c) => c.index === robotCam.camera_index);
        if (live) {
          next[expectedName] = live.index;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [imageFeatures, robot, availableCameras]);

  const allBound =
    !!imageFeatures && Object.keys(imageFeatures).every((name) => bindings[name] != null);

  const bind = (name: string, index: number) =>
    setBindings((prev) => ({ ...prev, [name]: index }));

  useEffect(() => {
    if (enabled) setRotations({});
  }, [enabled, robot?.name]);

  const physicalFor = (index: number): PhysicalCamera =>
    availableCameras.find((c) => c.index === index) ?? { index, deviceId: "" };

  const rotationFor = (name: string): CameraRotation => {
    const idx = bindings[name];
    return idx == null
      ? 0
      : rotationForCamera(physicalFor(idx), robot?.cameras ?? [], rotations);
  };

  const setRotation = (name: string, rotation: CameraRotation) => {
    const idx = bindings[name];
    if (idx != null) {
      setRotations((prev) => ({ ...prev, [physicalCameraKey(physicalFor(idx))]: rotation }));
    }
  };

  /**
   * The backend camera config: every bound camera. The expected resolution is
   * the rotated output, so the API gets the capture dimensions.
   */
  const toCameraDict = (fps: number) => {
    const cameraDict: Record<string, CameraRequest> = {};
    for (const [name, dims] of Object.entries(imageFeatures ?? {})) {
      const idx = bindings[name];
      if (idx == null) continue;
      const rotation = rotationFor(name);
      const capture = rotatedDimensions(dims.width, dims.height, rotation);
      cameraDict[name] = serializeCamera({
        type: "opencv",
        camera_index: idx,
        width: capture.width,
        height: capture.height,
        rotation,
        fps,
      });
    }
    return cameraDict;
  };

  return { bindings, bind, allBound, availableCameras, rotationFor, setRotation, toCameraDict };
}
