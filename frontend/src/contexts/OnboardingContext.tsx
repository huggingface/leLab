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
import SpotlightOverlay from "@/components/onboarding/SpotlightOverlay";
import TourLauncher from "@/components/onboarding/TourLauncher";

// Persisted across sessions, mirroring the useUpdateCheck pattern. The `-v1`
// suffix lets a future revamp re-offer the tour to everyone by bumping it.
const STORAGE_KEY = "lelab:onboarding-v1";
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
  stepIndex: number;
  totalSteps: number;
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
  const [stepIndex, setStepIndex] = useState(0);
  const [hasSeen, setHasSeen] = useState<boolean>(() => readStatus() !== null);

  const totalSteps = ONBOARDING_STEPS.length;
  const currentStep =
    isActive && stepIndex >= 0 && stepIndex < totalSteps
      ? ONBOARDING_STEPS[stepIndex]
      : null;

  const stop = useCallback((completed: boolean) => {
    setIsActive(false);
    writeStatus(completed ? "completed" : "dismissed");
    setHasSeen(true);
  }, []);

  const start = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= totalSteps - 1) {
        stop(true);
        return i;
      }
      return i + 1;
    });
  }, [totalSteps, stop]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

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

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isActive,
      currentStep,
      stepIndex,
      totalSteps,
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
      totalSteps,
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
