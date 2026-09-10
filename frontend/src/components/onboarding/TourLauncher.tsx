import React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/contexts/OnboardingContext";

interface TourLauncherProps {
  /** "floating" pins a round button to the corner on every page; "inline" is
   * a compact button for the landing top bar. */
  variant?: "floating" | "inline";
  className?: string;
}

const TourLauncher: React.FC<TourLauncherProps> = ({
  variant = "inline",
  className,
}) => {
  const { start, isActive } = useOnboarding();

  // The floating button would only get in the way while the tour is running.
  if (variant === "floating" && isActive) return null;

  if (variant === "floating") {
    return (
      <button
        type="button"
        onClick={start}
        aria-label="Start the guided tour"
        title="Guided tour"
        className={cn(
          "fixed bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center",
          "rounded-full border border-gray-700 bg-gray-900 text-gray-300 shadow-lg",
          "transition-colors hover:bg-gray-800 hover:text-white",
          className
        )}
      >
        <HelpCircle className="h-5 w-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      aria-label="Start the guided tour"
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-gray-700 px-2.5 py-1.5",
        "text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white",
        className
      )}
    >
      <HelpCircle className="h-4 w-4" />
      Tour
    </button>
  );
};

export default TourLauncher;
