import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useOnboarding } from "@/contexts/OnboardingContext";
import TourCard from "@/components/onboarding/TourCard";

// Padding around the highlighted element, in px.
const PAD = 8;
// How long to wait for a step's target to appear (e.g. after a route change)
// before falling back to a centered card so the tour never blocks.
const MOUNT_TIMEOUT_MS = 3000;

const SpotlightOverlay: React.FC = () => {
  const { isActive, currentStep, stop } = useOnboarding();
  const location = useLocation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Becomes true once we've either located the target or given up (fallback).
  const [ready, setReady] = useState(false);

  const stepId = currentStep?.id ?? null;
  const target = currentStep?.target ?? null;

  // Locate the step's target, tracking it across scroll/resize/layout shifts.
  // Re-runs whenever the step changes, and on route changes so a manual
  // navigation away mid-step re-queries (rather than pinning a stale rect).
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
      if (!tracked) return;
      // The element can leave the DOM under us (e.g. the user navigated away
      // before this effect re-runs). Drop the spotlight instead of pinning it
      // to a stale position.
      if (!tracked.isConnected) {
        setRect(null);
        return;
      }
      setRect(tracked.getBoundingClientRect());
    };

    const attachTrackers = (el: Element) => {
      tracked = el;
      // Bring the target on-screen if it's below the fold (e.g. the cameras or
      // jobs step). "nearest" scrolls the minimum needed and does nothing when
      // it's already visible; the scroll listener below keeps the cutout and
      // card glued to it as the smooth scroll settles.
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
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
  }, [isActive, stepId, target, location.pathname]);

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
      <TourCard key={currentStep.id} rect={hasRect ? rect : null} />
    </div>,
    document.body
  );
};

export default SpotlightOverlay;
