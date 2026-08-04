import { Fetcher, apiRequest } from "./apiClient";

export interface StartInferenceRequest {
  follower_port: string;
  follower_config: string;
  policy_ref: string;
  task: string;
  cameras: Record<string, {
    type: string;
    camera_index?: number;
    width: number;
    height: number;
    fps?: number;
  }>;
  duration_s: number;
}

export interface InferenceStatus {
  inference_active: boolean;
  started_at: number | null;
  rollout_started_at: number | null;
  elapsed_s: number;
  rollout_elapsed_s: number;
  duration_s: number | null;
  policy_ref: string | null;
  log_path: string | null;
  exited?: boolean;
  exit_code?: number | null;
  /** Control-loop telemetry, measured in the rollout subprocess. */
  target_fps: number | null;
  /** Rate over the last second — null while setting up or once the run ends. */
  fps_now: number | null;
  fps_avg: number | null;
  /** Slowest one-second window of the run. */
  fps_min: number | null;
  /** Longest single gap between two control-loop ticks. */
  fps_worst_gap_ms: number | null;
  fps_ticks: number;
  fps_stale: boolean;
}

export type FpsTone = "good" | "warn" | "bad";

/**
 * How healthy a measured rate is against the target. The thresholds are
 * deliberately forgiving: a rollout that holds 26 of its 30 Hz is fine, one
 * that halves is not.
 */
export function fpsTone(fps: number, target: number | null): FpsTone {
  if (!target || target <= 0) return "good";
  const ratio = fps / target;
  if (ratio >= 0.85) return "good";
  if (ratio >= 0.55) return "warn";
  return "bad";
}

export const FPS_TONE_TEXT: Record<FpsTone, string> = {
  good: "text-green-400",
  warn: "text-amber-400",
  bad: "text-red-400",
};

export async function startInference(
  baseUrl: string,
  fetcher: Fetcher,
  request: StartInferenceRequest,
): Promise<{ message: string; log_path: string }> {
  return apiRequest<{ message: string; log_path: string }>(
    baseUrl,
    fetcher,
    "/start-inference",
    { method: "POST", body: request, action: "Start inference" },
  );
}

export async function stopInference(
  baseUrl: string,
  fetcher: Fetcher,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(baseUrl, fetcher, "/stop-inference", {
    method: "POST",
    action: "Stop inference",
  });
}

export async function getInferenceStatus(
  baseUrl: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<InferenceStatus> {
  return apiRequest<InferenceStatus>(baseUrl, fetcher, "/inference-status", {
    signal,
    action: "Get inference status",
  });
}
