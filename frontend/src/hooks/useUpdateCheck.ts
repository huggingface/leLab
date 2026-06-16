import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/contexts/ApiContext";
import { isHostedSpace } from "@/lib/isHostedSpace";

export interface UpdateStatus {
  update_available: boolean;
  current_commit: string | null;
  latest_commit: string | null;
  commits_behind: number | null;
  compare_url: string | null;
  update_command: string | null;
  can_auto_update: boolean;
}

// Stores the latest SHA the user chose to ignore via "don't ask again". A newer
// release has a different SHA, so the popup naturally returns — which clears the
// previous opt-out, exactly as intended.
const DISMISS_KEY = "lelab:update-dismissed-sha";

interface UseUpdateCheckResult {
  status: UpdateStatus | null;
  open: boolean;
  /** Close the popup. `dontAskAgain` persists the current SHA so it stays hidden. */
  dismiss: (dontAskAgain: boolean) => void;
}

/**
 * Checks GitHub (via the backend) once on load for a newer LeLab and decides
 * whether to surface the update popup. Skipped on the hosted HF Space (a
 * different runtime that can't be updated this way) and silent on any failure.
 */
export function useUpdateCheck(): UseUpdateCheckResult {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isHostedSpace()) return;
    let cancelled = false;
    fetchWithHeaders(`${baseUrl}/update-check`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: UpdateStatus | null) => {
        if (cancelled || !data || !data.update_available) return;
        let dismissed: string | null = null;
        try {
          dismissed = localStorage.getItem(DISMISS_KEY);
        } catch {
          /* localStorage unavailable — show the popup anyway */
        }
        if (dismissed && dismissed === data.latest_commit) return;
        setStatus(data);
        setOpen(true);
      })
      .catch(() => {
        /* backend/GitHub unreachable — stay silent */
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchWithHeaders]);

  const dismiss = useCallback(
    (dontAskAgain: boolean) => {
      if (dontAskAgain && status?.latest_commit) {
        try {
          localStorage.setItem(DISMISS_KEY, status.latest_commit);
        } catch {
          /* localStorage unavailable — nothing to persist */
        }
      }
      setOpen(false);
    },
    [status]
  );

  return { status, open, dismiss };
}
