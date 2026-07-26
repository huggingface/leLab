import React, { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
  const { currentStep, stepIndex, totalSteps, next, back, skipStep, stop } =
    useOnboarding();
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: CARD_W, h: 0 });

  useLayoutEffect(() => {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
  }, [currentStep?.id, rect]);

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
      className={cn(
        "pointer-events-auto fixed z-[45] w-[340px] max-w-[calc(100vw-16px)]",
        "rounded-lg border border-gray-700 bg-gray-900 text-gray-300 shadow-2xl"
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
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-blue-400">
          Step {stepIndex + 1} of {totalSteps}
        </p>
        <h3 className="pr-6 text-base font-semibold text-white">
          {currentStep.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">
          {currentStep.body}
        </p>

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
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourCard;
