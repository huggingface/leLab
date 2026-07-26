import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/contexts/OnboardingContext";

const MARGIN = 8;
const GAP = 12;
const CARD_W = 340;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

interface TourCardProps {
  /** Bounding rect of the highlighted element, or null for a centered card. */
  rect: DOMRect | null;
}

const TourCard: React.FC<TourCardProps> = ({ rect }) => {
  const {
    currentStep,
    stepIndex,
    totalSteps,
    currentComplete,
    currentGated,
    next,
    back,
    skipStep,
    stop,
  } = useOnboarding();
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: CARD_W, h: 0 });

  useLayoutEffect(() => {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
  }, [currentStep?.id, rect]);

  // Move focus to the card when a step opens so keyboard and screen-reader
  // users land on the guidance. The card remounts per step (keyed by id), so
  // this fires once per step.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  if (!currentStep) return null;

  const placement = currentStep.placement ?? "bottom";
  const centered = !rect || placement === "center";
  const isLast = stepIndex >= totalSteps - 1;
  const isFirst = stepIndex <= 0;

  let pos: React.CSSProperties;
  if (centered) {
    pos = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = rect!.top - size.h - GAP;
        left = rect!.left + rect!.width / 2 - size.w / 2;
        break;
      case "left":
        left = rect!.left - size.w - GAP;
        top = rect!.top + rect!.height / 2 - size.h / 2;
        break;
      case "right":
        left = rect!.right + GAP;
        top = rect!.top + rect!.height / 2 - size.h / 2;
        break;
      case "bottom":
      default:
        top = rect!.bottom + GAP;
        left = rect!.left + rect!.width / 2 - size.w / 2;
        break;
    }
    // Flip to the opposite side if the preferred one overflows the viewport.
    if (placement === "bottom" && top + size.h > vh - MARGIN)
      top = rect!.top - size.h - GAP;
    if (placement === "top" && top < MARGIN) top = rect!.bottom + GAP;
    if (placement === "right" && left + size.w > vw - MARGIN)
      left = rect!.left - size.w - GAP;
    if (placement === "left" && left < MARGIN) left = rect!.right + GAP;
    // Keep the card fully on screen.
    left = clamp(left, MARGIN, vw - size.w - MARGIN);
    top = clamp(top, MARGIN, vh - size.h - MARGIN);
    pos = { top, left };
  }

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Guided tour"
      aria-live="polite"
      tabIndex={-1}
      className={cn(
        "pointer-events-auto fixed z-[45] w-[340px] max-w-[calc(100vw-16px)]",
        "rounded-lg border border-gray-700 bg-gray-900 text-gray-300 shadow-2xl outline-none",
        "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
      )}
      style={pos}
    >
      <button
        type="button"
        onClick={() => stop(false)}
        aria-label="Exit tour"
        className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="p-4 pt-5">
        <div className="mb-1 flex items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-400">
            Step {stepIndex + 1} of {totalSteps}
          </p>
          {currentComplete && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
              <Check className="h-3 w-3" />
              Done
            </span>
          )}
        </div>
        <h3 className="pr-6 text-base font-semibold text-white">
          {currentStep.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">
          {currentStep.body}
        </p>

        {currentGated && !currentComplete && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <Lock className="h-3 w-3 shrink-0" />
            Finish the earlier step to unlock this, or continue with Next
            whenever you like.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={back}
            disabled={isFirst}
            className="text-gray-400 hover:text-white disabled:opacity-40"
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            {currentStep.optional && !isLast && (
              <Button
                variant="ghost"
                size="sm"
                onClick={skipStep}
                className="text-gray-400 hover:text-white"
              >
                Skip
              </Button>
            )}
            <Button
              size="sm"
              onClick={next}
              className={cn(
                "text-white",
                currentComplete
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {isLast ? "Finish" : currentComplete ? "Continue" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourCard;
