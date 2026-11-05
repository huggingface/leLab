import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/contexts/ApiContext";

export type InstallState = "idle" | "installing" | "done" | "error";

export interface LogEntry {
  timestamp: number;
  message: string;
}

interface InstallStatus {
  state: InstallState;
  error: string | null;
  logs: LogEntry[];
}

const POLL_INTERVAL_MS = 1500;

export interface UseInstallExtraResult {
  state: InstallState;
  error: string | null;
  logs: LogEntry[];
  logBoxRef: React.RefObject<HTMLDivElement>;
  handleInstall: () => Promise<void>;
  handleRetry: () => void;
}

/**
 * Drives the backend extra-install flow (`accelerate`, policy extras, …). Seeds state
 * from `${endpointPrefix}/install-status`, polls while installing, and exposes
 * install/retry handlers. Pass `enabled=false` to gate seeding on dialog open.
 */
export function useInstallExtra(
  endpointPrefix: string,
  enabled: boolean = true
): UseInstallExtraResult {
  const { baseUrl, fetchWithHeaders } = useApi();

  const [state, setState] = useState<InstallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // Seed local state from the backend so a refresh mid-install picks up where
  // we left off (or shows Done/Error if the install already finished).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchWithHeaders(`${baseUrl}/${endpointPrefix}/install-status`)
      .then((r) => r.json())
      .then((status: InstallStatus) => {
        if (cancelled) return;
        setState(status.state);
        setError(status.error);
        if (status.logs.length > 0) setLogs(status.logs);
      })
      .catch(() => {
        // Backend unreachable — stay in idle; the user can still try.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, baseUrl, fetchWithHeaders, endpointPrefix]);

  // Poll while installing.
  useEffect(() => {
    if (state !== "installing") return;
    const id = setInterval(async () => {
      try {
        const r = await fetchWithHeaders(
          `${baseUrl}/${endpointPrefix}/install-status`
        );
        if (!r.ok) return;
        const status: InstallStatus = await r.json();
        if (status.logs && status.logs.length > 0) {
          setLogs((prev) => [...prev, ...status.logs]);
        }
        if (status.state !== "installing") {
          setState(status.state);
          setError(status.error);
        }
      } catch {
        // Transient errors are fine; we'll retry on next tick.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, baseUrl, fetchWithHeaders, endpointPrefix]);

  // Auto-scroll the log panel as new lines arrive.
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  const handleInstall = useCallback(async () => {
    setState("installing");
    setError(null);
    setLogs([]);
    try {
      const r = await fetchWithHeaders(
        `${baseUrl}/${endpointPrefix}/install`,
        { method: "POST" }
      );
      const body: { started: boolean; message: string } = await r.json();
      if (!body.started && r.ok) return; // already installing
      if (!r.ok) {
        setState("error");
        setError(body.message || `Install request failed (${r.status})`);
      }
    } catch (e) {
      setState("error");
      setError(
        `Install request failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }, [baseUrl, fetchWithHeaders, endpointPrefix]);

  const handleRetry = useCallback(() => {
    setState("idle");
    setError(null);
    setLogs([]);
  }, []);

  return { state, error, logs, logBoxRef, handleInstall, handleRetry };
}
