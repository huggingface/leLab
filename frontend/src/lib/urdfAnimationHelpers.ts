import { MathUtils } from "three";
import { RobotAnimationConfig } from "@/lib/types";

// Define the interface for the Urdf viewer element
export interface UrdfViewerElement extends HTMLElement {
  setJointValue: (joint: string, value: number) => void;
}

/**
 * Generalized animation function for any robot
 * @param viewer The Urdf viewer element
 * @param config Configuration for the robot's joint animations
 * @returns A cleanup function to cancel the animation
 */
export function animateRobot(
  viewer: UrdfViewerElement,
  config: RobotAnimationConfig
): () => void {
  let animationFrameId: number | null = null;
  let isRunning = true;
  const speedMultiplier = config.speedMultiplier || 1;

  const animate = () => {
    if (!isRunning) return;

    const time = Date.now() / 300; // Base time unit

    try {
      // Process each joint configuration
      for (const joint of config.joints) {
        // Calculate the animation ratio (0-1) based on the animation type
        let ratio = 0;
        const adjustedTime =
          time * joint.speed * speedMultiplier + joint.offset;

        switch (joint.type) {
          case "sine":
            // Sine wave oscillation mapped to 0-1
            ratio = (Math.sin(adjustedTime) + 1) / 2;
            break;
          case "linear":
            // Saw tooth pattern (0 to 1 repeated)
            ratio = (adjustedTime % (2 * Math.PI)) / (2 * Math.PI);
            break;
          case "constant":
            // Constant value (using max)
            ratio = 1;
            break;
          default:
            // Use custom easing if provided
            if (joint.customEasing) {
              ratio = joint.customEasing(adjustedTime);
            }
        }

        // Calculate the joint value based on min/max and the ratio
        let value = MathUtils.lerp(joint.min, joint.max, ratio);

        // Convert from degrees to radians if specified
        if (joint.isDegrees) {
          value = (value * Math.PI) / 180;
        }

        // Set the joint value, catching errors for non-existent joints
        try {
          viewer.setJointValue(joint.name, value);
        } catch (e) {
          // Silently ignore if the joint doesn't exist
        }
      }
    } catch (err) {
      console.error("Error in robot animation:", err);
    }

    // Continue the animation loop
    animationFrameId = requestAnimationFrame(animate);
  };

  // Start the animation
  animationFrameId = requestAnimationFrame(animate);

  // Return cleanup function
  return () => {
    isRunning = false;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
}

/**
 * Animates a hexapod robot (like T12) with walking motion
 * @param viewer The Urdf viewer element
 * @returns A cleanup function to cancel the animation
 */
export function animateHexapodRobot(viewer: UrdfViewerElement): () => void {
  let animationFrameId: number | null = null;
  let isRunning = true;

  const animate = () => {
    // Don't continue animation if we've been told to stop
    if (!isRunning) return;

    // Animate the legs (for T12 robot)
    const time = Date.now() / 3e2;

    try {
      for (let i = 1; i <= 6; i++) {
        const offset = (i * Math.PI) / 3;
        const ratio = Math.max(0, Math.sin(time + offset));

        // For a hexapod robot like T12
        if (typeof viewer.setJointValue === "function") {
          // Hip joints
          viewer.setJointValue(
            `HP${i}`,
            (MathUtils.lerp(30, 0, ratio) * Math.PI) / 180
          );
          // Knee joints
          viewer.setJointValue(
            `KP${i}`,
            (MathUtils.lerp(90, 150, ratio) * Math.PI) / 180
          );
          // Ankle joints
          viewer.setJointValue(
            `AP${i}`,
            (MathUtils.lerp(-30, -60, ratio) * Math.PI) / 180
          );

          // Check if these joints exist before setting values
          try {
            // Tire/Contact joints
            viewer.setJointValue(`TC${i}A`, MathUtils.lerp(0, 0.065, ratio));
            viewer.setJointValue(`TC${i}B`, MathUtils.lerp(0, 0.065, ratio));
            // Wheel rotation
            viewer.setJointValue(`W${i}`, performance.now() * 0.001);
          } catch (e) {
            // Silently ignore if those joints don't exist
          }
        }
      }
    } catch (err) {
      console.error("Error in animation:", err);
    }

    // Continue the animation loop
    animationFrameId = requestAnimationFrame(animate);
  };

  // Start the animation
  animationFrameId = requestAnimationFrame(animate);

  // Return cleanup function
  return () => {
    // Mark animation as stopped but DO NOT reset joint positions
    isRunning = false;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
}

// Example: Walking animation for Cassie robot
export const cassieWalkingConfig: RobotAnimationConfig = {
  speedMultiplier: 0.5, // Adjust overall speed
  joints: [
    // Left leg
    {
      name: "hip_abduction_left",
      type: "sine",
      min: -0.1, // Small side-to-side movement
      max: 0.1,
      speed: 1,
      offset: 0,
      isDegrees: false, // Already in radians
    },
    {
      name: "hip_rotation_left", // Assuming this joint exists
      type: "sine",
      min: -0.2,
      max: 0.2,
      speed: 1,
      offset: Math.PI / 2, // 90 degrees out of phase
      isDegrees: false,
    },
    {
      name: "hip_flexion_left", // Assuming this joint exists
      type: "sine",
      min: -0.3,
      max: 0.6,
      speed: 1,
      offset: 0,
      isDegrees: false,
    },
    {
      name: "knee_joint_left", // Assuming this joint exists
      type: "sine",
      min: 0.2,
      max: 1.4,
      speed: 1,
      offset: Math.PI / 2, // 90 degrees phase shifted from hip
      isDegrees: false,
    },
    {
      name: "ankle_joint_left", // Assuming this joint exists
      type: "sine",
      min: -0.4,
      max: 0.1,
      speed: 1,
      offset: Math.PI, // 180 degrees out of phase with hip
      isDegrees: false,
    },
    {
      name: "toe_joint_left", // Assuming this joint exists
      type: "sine",
      min: -0.2,
      max: 0.2,
      speed: 1,
      offset: Math.PI * 1.5, // 270 degrees phase
      isDegrees: false,
    },

    // Right leg (with appropriate phase shift to alternate with left leg)
    {
      name: "hip_abduction_right", // Assuming this joint exists
      type: "sine",
      min: -0.1,
      max: 0.1,
      speed: 1,
      offset: Math.PI, // 180 degrees out of phase with left side
      isDegrees: false,
    },
    {
      name: "hip_rotation_right", // Assuming this joint exists
      type: "sine",
      min: -0.2,
      max: 0.2,
      speed: 1,
      offset: Math.PI + Math.PI / 2, // 180 + 90 degrees phase
      isDegrees: false,
    },
    {
      name: "hip_flexion_right", // Assuming this joint exists
      type: "sine",
      min: -0.3,
      max: 0.6,
      speed: 1,
      offset: Math.PI, // 180 degrees out of phase with left hip
      isDegrees: false,
    },
    {
      name: "knee_joint_right", // Assuming this joint exists
      type: "sine",
      min: 0.2,
      max: 1.4,
      speed: 1,
      offset: Math.PI + Math.PI / 2, // 180 + 90 degrees phase
      isDegrees: false,
    },
    {
      name: "ankle_joint_right", // Assuming this joint exists
      type: "sine",
      min: -0.4,
      max: 0.1,
      speed: 1,
      offset: 0, // 180 + 180 degrees = 360 = 0
      isDegrees: false,
    },
    {
      name: "toe_joint_right", // Assuming this joint exists
      type: "sine",
      min: -0.2,
      max: 0.2,
      speed: 1,
      offset: Math.PI / 2, // 180 + 270 = 450 degrees = 90 degrees
      isDegrees: false,
    },
  ],
};
