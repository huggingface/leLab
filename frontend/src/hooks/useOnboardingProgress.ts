import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/contexts/ApiContext";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { listDatasets } from "@/lib/replayApi";
import { listJobs } from "@/lib/jobsApi";
import type { RobotRecord } from "@/hooks/useRobots";
import type { ProgressSnapshot } from "@/lib/onboardingSteps";

// Matches the key useRobots persists the selected robot under.
const SELECTED_KEY = "lelab.selectedRobot";
// The tour only needs to notice progress within a few seconds; a gentle cadence
// keeps load off the backend, and polling pauses entirely while the tab is
// hidden.
const POLL_MS = 3000;

const EMPTY: ProgressSnapshot = {
  hasSelectedRobot: false,
  robotIsClean: false,
  hasLocalDataset: false,
  hasTrainedModel: false,
  isAuthenticated: false,
};

/**
 * A read-only snapshot of how far the user has actually gotten, derived from
 * existing endpoints. It only fetches while the tour is active, so it adds
 * zero cost when the tour is closed. Deliberately does NOT reuse useRobots
 * (which refetches per route and owns selection) — a second instance would
 * double traffic and race the selection state.
 *
 * Only cheap local endpoints are polled: no /jobs/hub, so the tour never adds
 * Hugging Face Hub API load. Tracked cloud jobs already surface in /jobs, and
 * auth comes from the existing HfAuth context.
 */
export function useOnboardingProgress(active: boolean): ProgressSnapshot {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { auth } = useHfAuth();
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(EMPTY);
  const isAuthenticated = auth.status === "authenticated";

  const refresh = useCallback(async () => {
    let selectedName: string | null = null;
    try {
      selectedName = localStorage.getItem(SELECTED_KEY);
    } catch {
      // Storage unavailable — treat as no selection.
    }

    const [robotsBody, datasets, jobs] = await Promise.all([
      fetchWithHeaders(`${baseUrl}/robots`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      listDatasets(baseUrl, fetchWithHeaders).catch(() => []),
      listJobs(baseUrl, fetchWithHeaders, 20).catch(() => []),
    ]);

    const records: RobotRecord[] = robotsBody?.robots ?? [];
    const selected = selectedName
      ? records.find((r) => r.name === selectedName) ?? null
      : null;

    setSnapshot({
      hasSelectedRobot: !!selected,
      robotIsClean: !!selected?.is_clean,
      hasLocalDataset: datasets.some(
        (d) => d.source === "local" || d.source === "both"
      ),
      hasTrainedModel: jobs.some(
        (j) => j.checkpoint_count > 0 || j.state === "done"
      ),
      isAuthenticated,
    });
  }, [baseUrl, fetchWithHeaders, isAuthenticated]);

  // Keep the latest refresh in a ref so the polling interval never tears down.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) {
      setSnapshot(EMPTY);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      // Skip while backgrounded, and never let ticks pile up if one is slow.
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        await refreshRef.current();
      } finally {
        inFlight = false;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    // Refresh promptly when the user returns to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return snapshot;
}
