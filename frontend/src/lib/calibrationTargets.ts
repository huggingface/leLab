// Per-motor target range (max - min, in raw motor steps) by device_type.
// Derived from observed SO-101 calibration files; values sit slightly below
// the smallest observed good range so a real calibration clears the 98% bar.
const SO101_LEADER_TARGETS: Record<string, number> = {
  shoulder_pan: 2400,
  shoulder_lift: 2300,
  elbow_flex: 2150,
  wrist_flex: 2250,
  wrist_roll: 3700,
  gripper: 1150,
};

const SO101_FOLLOWER_TARGETS: Record<string, number> = {
  shoulder_pan: 2400,
  shoulder_lift: 2300,
  elbow_flex: 2150,
  wrist_flex: 2250,
  wrist_roll: 3700,
  gripper: 1400,
};

const TARGETS_BY_DEVICE_TYPE: Record<string, Record<string, number>> = {
  teleop: SO101_LEADER_TARGETS,
  robot: SO101_FOLLOWER_TARGETS,
};

const RANGE_TOLERANCE = 0.98;

export function isMotorRangeComplete(
  deviceType: string | null | undefined,
  motor: string,
  rangeAchieved: number
): boolean {
  if (!deviceType) return false;
  const target = TARGETS_BY_DEVICE_TYPE[deviceType]?.[motor];
  if (!target) return false;
  return rangeAchieved >= target * RANGE_TOLERANCE;
}
