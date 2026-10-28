import { describe, expect, it } from "vitest";

import { liveStateToJointRadians, type UrdfJointInfo } from "@/nori/components/liveJointPose";

// A synthetic joints map shaped like urdf-loader's robot.joints for the A3
// URDF (public/nori-urdf/nori.urdf): the 14 arm revolutes, both grippers, the
// lift, its mimics, and the continuous wheels.
const ARM_SHORTS = [
  "shoulder_pitch",
  "shoulder_roll",
  "bicep_yaw",
  "elbow_pitch",
  "forearm_yaw",
  "wrist_pitch",
  "wrist_roll",
] as const;

function makeJoints(): Record<string, UrdfJointInfo> {
  const joints: Record<string, UrdfJointInfo> = {
    lift_extension_joint: { jointType: "prismatic", limit: { lower: 0, upper: 0.72 } },
    // Mimics — must never be driven directly.
    lift_middle_joint: {
      jointType: "prismatic",
      limit: { lower: 0, upper: 0.36 },
      mimicJoint: "lift_extension_joint",
    },
    // Continuous joints report 0..0 limits.
    left_wheel_joint: { jointType: "continuous", limit: { lower: 0, upper: 0 } },
    right_wheel_joint: { jointType: "continuous", limit: { lower: 0, upper: 0 } },
  };
  for (const side of ["left", "right"] as const) {
    for (const short of ARM_SHORTS) {
      joints[`${side}_${short}_joint`] = {
        jointType: "revolute",
        limit: { lower: -1.5, upper: 2.5 },
      };
    }
    joints[`${side}_gripper_joint`] = {
      jointType: "revolute",
      limit: { lower: 0, upper: 0.8 },
    };
    joints[`${side}_gripper_idler_joint`] = {
      jointType: "revolute",
      limit: { lower: -0.8, upper: 0 },
      mimicJoint: `${side}_gripper_joint`,
    };
  }
  return joints;
}

describe("liveStateToJointRadians", () => {
  it.each([undefined, [-0.7, 1.3], [1.3, -0.7]] as const)(
    "reverses only right wrist roll after denormalization (SI bounds: %s)",
    (bounds) => {
      const joints = makeJoints();
      const descriptor = bounds ? {
        ranges_si: {
          "right_arm_wrist_roll.pos": [...bounds] as [number, number],
          "left_arm_wrist_roll.pos": [...bounds] as [number, number],
          "right_arm_wrist_pitch.pos": [...bounds] as [number, number],
        },
      } : undefined;
      const [lower, upper] = bounds ?? [-1.5, 2.5];
      for (const value of [-100, -50, 0, 50, 100]) {
        const out = liveStateToJointRadians({
          "right_arm_wrist_roll.pos": value,
          "left_arm_wrist_roll.pos": value,
          "right_arm_wrist_pitch.pos": value,
        }, joints, descriptor);
        const angle = lower + ((value + 100) / 200) * (upper - lower);
        expect(out.right_wrist_roll_joint).toBeCloseTo(-angle, 10);
        expect(out.left_wrist_roll_joint).toBeCloseTo(angle, 10);
        expect(out.right_wrist_pitch_joint).toBeCloseTo(angle, 10);
      }
    }
  );

  it("maps all 17 telemetry keys to their URDF joints", () => {
    const state: Record<string, number> = { "lift.pos": 360 };
    for (const side of ["left", "right"] as const) {
      for (const short of ARM_SHORTS) state[`${side}_arm_${short}.pos`] = 0;
      state[`${side}_arm_gripper.pos`] = 50;
    }
    expect(Object.keys(state)).toHaveLength(17);

    const out = liveStateToJointRadians(state, makeJoints());
    const expected = ["lift_extension_joint"];
    for (const side of ["left", "right"] as const) {
      for (const short of ARM_SHORTS) expected.push(`${side}_${short}_joint`);
      expected.push(`${side}_gripper_joint`);
    }
    expect(Object.keys(out).sort()).toEqual(expected.sort());
  });

  it("denormalizes arm joints: -100 → lower, 0 → midpoint, 100 → upper", () => {
    const joints = makeJoints();
    const at = (norm: number) =>
      liveStateToJointRadians({ "left_arm_elbow_pitch.pos": norm }, joints)
        .left_elbow_pitch_joint;
    expect(at(-100)).toBeCloseTo(-1.5, 10);
    expect(at(0)).toBeCloseTo(0.5, 10); // midpoint of [-1.5, 2.5]
    expect(at(100)).toBeCloseTo(2.5, 10);
  });

  it("denormalizes grippers on 0..100: 0 → lower, 100 → upper", () => {
    const joints = makeJoints();
    const at = (norm: number) =>
      liveStateToJointRadians({ "right_arm_gripper.pos": norm }, joints)
        .right_gripper_joint;
    expect(at(0)).toBeCloseTo(0, 10);
    expect(at(50)).toBeCloseTo(0.4, 10);
    expect(at(100)).toBeCloseTo(0.8, 10);
  });

  it("converts lift.pos millimetres to metres", () => {
    const out = liveStateToJointRadians({ "lift.pos": 500 }, makeJoints());
    expect(out.lift_extension_joint).toBeCloseTo(0.5, 10);
  });

  it("clamps out-of-range values to the joint limits", () => {
    const joints = makeJoints();
    expect(
      liveStateToJointRadians({ "left_arm_wrist_roll.pos": -250 }, joints)
        .left_wrist_roll_joint
    ).toBeCloseTo(-1.5, 10);
    expect(
      liveStateToJointRadians({ "left_arm_wrist_roll.pos": 250 }, joints)
        .left_wrist_roll_joint
    ).toBeCloseTo(2.5, 10);
    expect(
      liveStateToJointRadians({ "left_arm_gripper.pos": 180 }, joints)
        .left_gripper_joint
    ).toBeCloseTo(0.8, 10);
    expect(
      liveStateToJointRadians({ "lift.pos": 9000 }, joints).lift_extension_joint
    ).toBeCloseTo(0.72, 10);
    expect(
      liveStateToJointRadians({ "lift.pos": -50 }, joints).lift_extension_joint
    ).toBeCloseTo(0, 10);
  });

  it("skips unknown shorts and non-joint keys without throwing", () => {
    const out = liveStateToJointRadians(
      {
        "left_arm_flux_capacitor.pos": 10, // joint-shaped key, no such joint
        "x.vel": 0.3, // base odometry — not a joint key at all
        "left_arm_elbow_pitch.pos": 0,
      },
      makeJoints()
    );
    expect(Object.keys(out)).toEqual(["left_elbow_pitch_joint"]);
  });

  it("skips non-finite values", () => {
    const out = liveStateToJointRadians(
      { "left_arm_elbow_pitch.pos": NaN, "right_arm_elbow_pitch.pos": Infinity },
      makeJoints()
    );
    expect(out).toEqual({});
  });

  it("never emits mimic or continuous joints", () => {
    const state: Record<string, number> = { "lift.pos": 360 };
    for (const side of ["left", "right"] as const) state[`${side}_arm_gripper.pos`] = 100;
    const out = liveStateToJointRadians(state, makeJoints());
    expect(out).not.toHaveProperty("lift_middle_joint");
    expect(out).not.toHaveProperty("left_gripper_idler_joint");
    expect(out).not.toHaveProperty("right_gripper_idler_joint");
    expect(out).not.toHaveProperty("left_wheel_joint");
  });

  it("prefers descriptor ranges_si over URDF limits when present", () => {
    const descriptor: import("@nori/sdk").RobotDescriptor = {
      ranges_si: { "left_arm_elbow_pitch.pos": [-1, 1] },
    };
    const out = liveStateToJointRadians(
      { "left_arm_elbow_pitch.pos": 100 },
      makeJoints(),
      descriptor
    );
    expect(out.left_elbow_pitch_joint).toBeCloseTo(1, 10);
  });

  it("interpolates INVERTED ranges_si bounds as written (spec: order carries direction)", () => {
    // Mirrors nori-protocol fixtures ack_ranges_si_inverted.json: [2.79, -2.81].
    const descriptor: import("@nori/sdk").RobotDescriptor = {
      ranges_si: { "left_arm_elbow_pitch.pos": [2.79, -2.81] },
    };
    const joints = makeJoints();
    // norm -100 -> fraction 0 -> first bound; +100 -> fraction 1 -> second bound.
    expect(
      liveStateToJointRadians({ "left_arm_elbow_pitch.pos": -100 }, joints, descriptor)
        .left_elbow_pitch_joint
    ).toBeCloseTo(2.79, 10);
    expect(
      liveStateToJointRadians({ "left_arm_elbow_pitch.pos": 100 }, joints, descriptor)
        .left_elbow_pitch_joint
    ).toBeCloseTo(-2.81, 10);
    // Midpoint interpolates linearly between the bounds as written.
    expect(
      liveStateToJointRadians({ "left_arm_elbow_pitch.pos": 0 }, joints, descriptor)
        .left_elbow_pitch_joint
    ).toBeCloseTo((2.79 + -2.81) / 2, 10);
  });

  it("ranges_si never applies to lift.pos (already physical mm; URDF path clamps)", () => {
    const descriptor: import("@nori/sdk").RobotDescriptor = {
      // Invalid per spec (lift.pos MUST NOT have an entry) — the mapper ignores it.
      ranges_si: { "lift.pos": [0, 99] },
    };
    const out = liveStateToJointRadians({ "lift.pos": 360 }, makeJoints(), descriptor);
    expect(out.lift_extension_joint).toBeCloseTo(0.36, 10);
  });
});
