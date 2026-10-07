import { useEffect, useState } from "react";
import { RobotRecord } from "@/hooks/useRobots";
import { useAvailableCameras } from "@/hooks/useAvailableCameras";
import { ImageFeatures } from "@/lib/checkpointsApi";

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

  /** The backend camera config: every bound camera at its expected resolution. */
  const toCameraDict = (fps: number) => {
    const cameraDict: Record<string, {
      type: string; camera_index: number; width: number; height: number; fps: number;
    }> = {};
    for (const [name, dims] of Object.entries(imageFeatures ?? {})) {
      const idx = bindings[name];
      if (idx == null) continue;
      cameraDict[name] = {
        type: "opencv",
        camera_index: idx,
        width: dims.width,
        height: dims.height,
        fps,
      };
    }
    return cameraDict;
  };

  return { bindings, bind, allBound, availableCameras, toCameraDict };
}
