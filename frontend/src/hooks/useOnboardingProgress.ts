import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/contexts/ApiContext";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { listDatasets } from "@/lib/replayApi";
import { listHubJobs, listJobs } from "@/lib/jobsApi";
import type { RobotRecord } from "@/hooks/useRobots";
import type { ProgressSnapshot } from "@/lib/onboardingSteps";

// Matches the key useRobots persists the selected robot under.
const SELECTED_KEY = "lelab.selectedRobot";
const POLL_MS = 2000;

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
 */
export function useOnboardingProgress(active: boolean): ProgressSnapshot {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { auth } = useHfAuth();
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(EMPTY);
  const authStatus = auth.status;

  const refresh = useCallback(async () => {
    let selectedName: string | null = null;
    try {
      selectedName = localStorage.getItem(SELECTED_KEY);
    } catch {
      // Storage unavailable — treat as no selection.
    }

    const [robotsBody, datasets, jobs, hub] = await Promise.all([
      fetchWithHeaders(`${baseUrl}/robots`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      listDatasets(baseUrl, fetchWithHeaders).catch(() => []),
      listJobs(baseUrl, fetchWithHeaders, 20).catch(() => []),
      listHubJobs(baseUrl, fetchWithHeaders).catch(() => ({
        authenticated: false,
        jobs: [],
        models: [],
      })),
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
      hasTrainedModel:
        jobs.some((j) => j.checkpoint_count > 0 || j.state === "done") ||
        hub.models.length > 0,
      isAuthenticated: authStatus === "authenticated" || hub.authenticated,
    });
  }, [baseUrl, fetchWithHeaders, authStatus]);

  // Keep the latest refresh in a ref so the polling interval never tears down.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) {
      setSnapshot(EMPTY);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (!cancelled) refreshRef.current();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  return snapshot;
}
