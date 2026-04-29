/**
 * Shared type definitions for Urdf parsing from supabase edge function
 */

export interface UrdfData {
  name?: string;
  description?: string;
  mass?: number;
  dofs?: number;
  joints?: {
    revolute?: number;
    prismatic?: number;
    continuous?: number;
    fixed?: number;
    other?: number;
  };
  links?: {
    name?: string;
    mass?: number;
  }[];
  materials?: {
    name?: string;
    percentage?: number;
  }[];
}

/**
 * Interface representing a Urdf file model
 */
export interface UrdfFileModel {
  /**
   * Path to the Urdf file
   */
  path: string;

  /**
   * Blob URL for accessing the file
   */
  blobUrl: string;

  /**
   * Name of the model extracted from the file path
   */
  name?: string;
}

/**
 * Joint animation configuration interface
 */
export interface JointAnimationConfig {
  /** Joint name in the Urdf */
  name: string;
  /** Animation type (sine, linear, etc.) */
  type: "sine" | "linear" | "constant";
  /** Minimum value for the joint */
  min: number;
  /** Maximum value for the joint */
  max: number;
  /** Speed multiplier for the animation (lower = slower) */
  speed: number;
  /** Phase offset in radians */
  offset: number;
  /** Whether angles are in degrees (will be converted to radians) */
  isDegrees?: boolean;
  /** For more complex movements, a custom function that takes time and returns a value between 0 and 1 */
  customEasing?: (time: number) => number;
}

/**
 * Robot animation configuration interface
 */
export interface RobotAnimationConfig {
  /** Array of joint configurations */
  joints: JointAnimationConfig[];
  /** Global speed multiplier */
  speedMultiplier?: number;
}

export interface AnimationRequest {
  robotName: string;
  urdfContent: string;
  description: string; // Natural language description of the desired animation
}

export interface ContentItem {
  id: string;
  title: string;
  imageUrl: string;
  description?: string;
  categories: string[];
  urdfPath: string;
}

export interface Category {
  id: string;
  name: string;
}
