// Paths to the built-in URDF models shipped under frontend/public/.
// Keyed by the same robot_type family used by RobotRecord.robot_type
// ("so101" / "omx_ai") after normalization — see resolveDefaultRobotType.
export const DEFAULT_URDF_PATHS = {
  so101: "/so-101-urdf/urdf/so101_new_calib.urdf",
  omx: "/omx-urdf/urdf/omx_f.urdf",
} as const;

export type DefaultRobotType = keyof typeof DEFAULT_URDF_PATHS;

/** Map a RobotRecord.robot_type string (e.g. "so101", "omx_ai") to a built-in model key. */
export const resolveDefaultRobotType = (
  robotType: string | null | undefined
): DefaultRobotType => {
  return (robotType || "").toLowerCase().includes("omx") ? "omx" : "so101";
};
