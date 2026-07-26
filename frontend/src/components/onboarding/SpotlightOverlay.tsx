import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboarding } from "@/contexts/OnboardingContext";
import TourCard from "@/components/onboarding/TourCard";

// Padding around the highlighted element, in px.
const PAD = 8;
// How long to wait for a step's target to appear (e.g. after a route change)
// before falling back to a centered card so the tour never blocks.
const MOUNT_TIMEOUT_MS = 3000;

const SpotlightOverlay: React.FC = () => {
  const { isActive, currentStep, stop } = useOnboarding();
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Becomes true once we've either located the target or given up (fallback).
  const [ready, setReady] = useState(false);

  const stepId = currentStep?.id ?? null;
  const target = currentStep?.target ?? null;

  // Locate the step's target, tracking it across scroll/resize/layout shifts.
  // Re-runs whenever the step changes.
  useLayoutEffect(() => {
    setReady(false);
    setRect(null);
    if (!isActive || !stepId) return;

    // Centered steps (welcome/done) have no target.
    if (!target) {
      setReady(true);
      return;
    }

    let raf = 0;
    let observer: ResizeObserver | null = null;
    let tracked: Element | null = null;
    const startedAt = performance.now();

    const measure = () => {
      if (tracked) setRect(tracked.getBoundingClientRect());
    };

    const attachTrackers = (el: Element) => {
      tracked = el;
      measure();
      setReady(true);
      window.addEventListener("scroll", measure, true);
      window.addEventListener("resize", measure);
      observer = new ResizeObserver(measure);
      observer.observe(el);
    };

    const poll = () => {
      const el = document.querySelector(`[data-tour="${target}"]`);
      if (el) {
        attachTrackers(el);
        return;
      }
      if (performance.now() - startedAt > MOUNT_TIMEOUT_MS) {
        // Target never mounted — show the copy centered rather than block.
        setRect(null);
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    poll();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [isActive, stepId, target]);

  // Esc leaves the tour from anywhere.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, stop]);

  if (!isActive || !currentStep || !ready) return null;

  const hasRect = !!rect && rect.width > 0 && rect.height > 0;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-40">
      {hasRect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-blue-400/80 transition-all duration-200"
          style={{
            top: rect!.top - PAD,
            left: rect!.left - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
      <TourCard rect={hasRect ? rect : null} />
    </div>,
    document.body
  );
};

export default SpotlightOverlay;
