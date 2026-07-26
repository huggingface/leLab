import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ONBOARDING_STEPS, TourStep } from "@/lib/onboardingSteps";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { isHostedSpace } from "@/lib/isHostedSpace";
import SpotlightOverlay from "@/components/onboarding/SpotlightOverlay";
import TourLauncher from "@/components/onboarding/TourLauncher";
import WelcomeDialog from "@/components/onboarding/WelcomeDialog";

// Persisted across sessions, mirroring the useUpdateCheck pattern. The `-v1`
// suffix lets a future revamp re-offer the tour to everyone by bumping it.
const STORAGE_KEY = "lelab:onboarding-v1";
// Delay before auto-advancing once a step's goal is met, so the user sees the
// "done" state register before moving on.
const AUTO_ADVANCE_MS = 1100;

type OnboardingStatus = "dismissed" | "completed";

const readStatus = (): OnboardingStatus | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "dismissed" || raw === "completed" ? raw : null;
  } catch {
    return null;
  }
};

const writeStatus = (status: OnboardingStatus) => {
  try {
    localStorage.setItem(STORAGE_KEY, status);
  } catch {
    // Storage may be unavailable (private mode, quota); nothing to persist.
  }
};

interface OnboardingContextValue {
  isActive: boolean;
  currentStep: TourStep | null;
  /** 0-based index of the current step among the steps visible to this user. */
  stepIndex: number;
  totalSteps: number;
  /** True when the current step's goal has been achieved. */
  currentComplete: boolean;
  /** True when the current step's prerequisite is not met yet (info only). */
  currentGated: boolean;
  /** True once the user has finished or dismissed the tour at least once. */
  hasSeen: boolean;
  start: () => void;
  next: () => void;
  back: () => void;
  /** Advance past an optional step without performing its action. */
  skipStep: () => void;
  /** Leave the tour. `completed` records how it ended for the persisted flag. */
  stop: (completed: boolean) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [isActive, setIsActive] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [hasSeen, setHasSeen] = useState<boolean>(() => readStatus() !== null);
  const [showWelcome, setShowWelcome] = useState(false);

  const progress = useOnboardingProgress(isActive);

  // Steps whose `show` predicate excludes this user drop out — but the current
  // step is always kept so it can never vanish mid-view and strand the tour.
  const visibleSteps = useMemo(
    () =>
      ONBOARDING_STEPS.filter(
        (s) => s.id === currentStepId || !s.show || s.show(progress)
      ),
    [progress, currentStepId]
  );

  const stepIndex = currentStepId
    ? visibleSteps.findIndex((s) => s.id === currentStepId)
    : -1;
  const currentStep =
    isActive && stepIndex >= 0 ? visibleSteps[stepIndex] : null;

  const currentComplete = currentStep?.isComplete
    ? currentStep.isComplete(progress)
    : false;
  const currentGated = currentStep?.gate ? !currentStep.gate(progress) : false;

  const stop = useCallback((completed: boolean) => {
    setIsActive(false);
    setCurrentStepId(null);
    writeStatus(completed ? "completed" : "dismissed");
    setHasSeen(true);
  }, []);

  const start = useCallback(() => {
    setShowWelcome(false);
    setCurrentStepId(ONBOARDING_STEPS[0]?.id ?? null);
    setIsActive(true);
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    writeStatus("dismissed");
    setHasSeen(true);
  }, []);

  // Offer the tour once, on the first visit only. Suppressed on the hosted HF
  // Space, where UsageInstructionsModal owns the first-run moment (a
  // non-dismissible install prompt) — the two must never stack. The corner
  // launcher stays available everywhere regardless.
  useEffect(() => {
    if (readStatus() === null && !isHostedSpace()) {
      setShowWelcome(true);
    }
  }, []);

  const next = useCallback(() => {
    const idx = visibleSteps.findIndex((s) => s.id === currentStepId);
    if (idx < 0) return;
    if (idx >= visibleSteps.length - 1) {
      stop(true);
      return;
    }
    setCurrentStepId(visibleSteps[idx + 1].id);
  }, [visibleSteps, currentStepId, stop]);

  const back = useCallback(() => {
    const idx = visibleSteps.findIndex((s) => s.id === currentStepId);
    if (idx > 0) setCurrentStepId(visibleSteps[idx - 1].id);
  }, [visibleSteps, currentStepId]);

  const skipStep = next;

  // Navigate to a step's route once, when that step is entered — never during
  // render. We deliberately do NOT re-navigate on later location changes, so a
  // user who clicks away mid-step isn't yanked back (the spotlight just falls
  // back to a centered card). The calibration page needs a robot_name in
  // navigation state to show the right robot's controls, so we forward the
  // currently-selected robot (persisted by useRobots).
  const lastNavStepId = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || !currentStep) {
      lastNavStepId.current = null;
      return;
    }
    if (lastNavStepId.current === currentStep.id) return;
    lastNavStepId.current = currentStep.id;
    if (location.pathname === currentStep.route) return;
    if (currentStep.route === "/calibration") {
      let robotName: string | null = null;
      try {
        robotName = localStorage.getItem("lelab.selectedRobot");
      } catch {
        // Storage unavailable — fall through to a plain navigation.
      }
      navigate(
        "/calibration",
        robotName ? { state: { robot_name: robotName } } : undefined
      );
      return;
    }
    navigate(currentStep.route);
  }, [isActive, currentStep, location.pathname, navigate]);

  // Auto-advance when a step's goal is met — but only on a false->true
  // transition while the step is shown, so returning to an already-complete
  // step via Back doesn't immediately bounce forward again.
  const autoRef = useRef<{ id: string | null; done: boolean }>({
    id: null,
    done: false,
  });
  useEffect(() => {
    if (!isActive || !currentStep) return;
    if (autoRef.current.id !== currentStep.id) {
      // Entering a (possibly already-complete) step: set the baseline and
      // never auto-advance out of a step that was already done on arrival.
      autoRef.current = { id: currentStep.id, done: currentComplete };
      return;
    }
    if (!autoRef.current.done && currentComplete) {
      autoRef.current.done = true;
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [isActive, currentStep, currentComplete, next]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isActive,
      currentStep,
      stepIndex,
      totalSteps: visibleSteps.length,
      currentComplete,
      currentGated,
      hasSeen,
      start,
      next,
      back,
      skipStep,
      stop,
    }),
    [
      isActive,
      currentStep,
      stepIndex,
      visibleSteps.length,
      currentComplete,
      currentGated,
      hasSeen,
      start,
      next,
      back,
      skipStep,
      stop,
    ]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <WelcomeDialog
        open={showWelcome}
        onStart={start}
        onDismiss={dismissWelcome}
      />
      <SpotlightOverlay />
      <TourLauncher variant="floating" />
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = (): OnboardingContextValue => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
};
