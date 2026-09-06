// Declarative model for the beginner onboarding tour. Each step points the
// spotlight at a real element (by its `data-tour` attribute) on a given route
// and explains, in plain language, one stage of the record -> train -> run loop.
//
// `gate` / `isComplete` read a live snapshot of how far the user has actually
// gotten (see useOnboardingProgress) so the tour can adapt and auto-advance.
// Both are optional: a step without them is a simple click-through.

export type Placement = "top" | "bottom" | "left" | "right" | "center";

// A read-only snapshot of the user's real progress, derived entirely from
// existing endpoints (/robots, /datasets, /jobs, /hf-auth-status).
export interface ProgressSnapshot {
  hasSelectedRobot: boolean;
  robotIsClean: boolean;
  hasLocalDataset: boolean;
  hasTrainedModel: boolean;
  isAuthenticated: boolean;
}

export interface TourStep {
  /** Stable id, also used as the log/debug label. */
  id: string;
  /** Route this step lives on; the tour navigates here before showing it. */
  route: string;
  /** `data-tour` value of the element to spotlight. Omit for a centered card. */
  target?: string;
  title: string;
  body: string;
  placement?: Placement;
  /** Optional steps can be skipped without doing the action (e.g. no hardware). */
  optional?: boolean;
  /** When false, the step's action isn't possible yet (informational only). */
  gate?: (s: ProgressSnapshot) => boolean;
  /** When true, the user has done this step's action; enables auto-advance. */
  isComplete?: (s: ProgressSnapshot) => boolean;
  /** When present and false, the step is skipped entirely for this user. */
  show?: (s: ProgressSnapshot) => boolean;
}

export const ONBOARDING_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/",
    placement: "center",
    title: "Welcome to LeLab",
    body: "This quick tour walks you from a fresh setup to a robot that runs a policy you trained yourself: calibrate, record, train, run. It takes about two minutes, and you can leave anytime with Esc.",
  },
  {
    id: "pick-robot",
    route: "/",
    target: "robot-selector",
    placement: "bottom",
    title: "Pick or name your arm",
    body: "Start here. Choose an existing robot, or type a new name to create one. Everything else in the tour hangs off the arm you select.",
    isComplete: (s) => s.hasSelectedRobot,
  },
  {
    id: "calibrate",
    route: "/calibration",
    target: "calibration-start",
    placement: "bottom",
    title: "Calibrate the arms",
    body: "Calibration teaches the app each joint's range of motion so movements map correctly. Run it once for the leader arm, then the follower. Press Start and follow the on-screen steps.",
    optional: true,
    isComplete: (s) => s.robotIsClean,
  },
  {
    id: "cameras",
    route: "/calibration",
    target: "calibration-cameras",
    placement: "top",
    title: "Add cameras (if your task needs sight)",
    body: "If the robot has to see what it's doing, add one or more cameras here. They're saved with this robot and reused when you record. Skip this if your task doesn't need vision.",
    optional: true,
  },
  {
    id: "teleop",
    route: "/",
    target: "robot-teleop",
    placement: "top",
    title: "Try teleoperation (optional)",
    body: "Drive the follower arm by moving the leader. It's a good way to confirm calibration feels right before you record anything. This button unlocks once the arm is calibrated.",
    optional: true,
    gate: (s) => s.robotIsClean,
  },
  {
    id: "record",
    route: "/",
    target: "dataset-picker",
    placement: "bottom",
    title: "Record a dataset",
    body: "A dataset is a set of episodes: one attempt at your task each. Episode time is how long each attempt runs; reset time is the pause to reposition objects between attempts. Aim for 10 to 50 clean episodes to start.",
    gate: (s) => s.robotIsClean,
    isComplete: (s) => s.hasLocalDataset,
  },
  {
    id: "train",
    route: "/",
    target: "training-entry",
    placement: "bottom",
    title: "Train a policy",
    body: "Turn your recorded episodes into a policy the robot can run. ACT is fast and a great first choice; SmolVLA is a larger vision-language model. You can train on your own GPU, or rent one in the cloud with a Hugging Face login.",
    gate: (s) => s.hasLocalDataset,
    isComplete: (s) => s.hasTrainedModel,
  },
  {
    id: "watch-training",
    route: "/",
    target: "jobs-section",
    placement: "top",
    title: "Watch it train",
    body: "Your training job shows up here with live progress. Once it has a usable checkpoint, a green play button appears on the model so you can run it.",
  },
  {
    id: "inference",
    route: "/",
    target: "jobs-section",
    placement: "top",
    title: "Run your policy",
    body: "Press the play button on a finished model to let the robot attempt the task on its own, using what it learned from your episodes. This is the payoff of the whole loop.",
    optional: true,
  },
  {
    id: "upload",
    route: "/",
    target: "training-entry",
    placement: "bottom",
    title: "Share on the Hub (optional)",
    body: "Log in to Hugging Face to push your datasets and trained models to the Hub, so you can back them up, share them, or train in the cloud.",
    optional: true,
    show: (s) => !s.isAuthenticated,
  },
  {
    id: "done",
    route: "/",
    placement: "center",
    title: "That's the whole loop",
    body: "Calibrate, record, train, run. You can reopen this tour anytime from the ? button in the corner. Happy building.",
  },
];
