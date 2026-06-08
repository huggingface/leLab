import { ApiError, Fetcher, apiRequest } from "./apiClient";

export type JobState = "running" | "done" | "failed" | "interrupted";

export interface TrainingMetrics {
  current_step: number;
  total_steps: number;
  current_loss: number | null;
  current_lr: number | null;
  grad_norm: number | null;
  eta_seconds: number | null;
}

export interface LogLine {
  timestamp: number;
  message: string;
}

export type MetricsHistoryPoint = {
  step: number;
  loss: number | null;
  lr: number | null;
  grad_norm: number | null;
};

// Mirror of the backend TrainingRequest. The frontend doesn't send all of
// these; defaults on the server fill in the rest.
export interface TrainingRequest {
  dataset_repo_id: string;
  policy_type: string;
  steps: number;
  batch_size: number;
  seed?: number;
  num_workers: number;
  log_freq: number;
  save_freq: number;
  save_checkpoint: boolean;
  resume: boolean;
  wandb_enable: boolean;
  wandb_project?: string;
  wandb_entity?: string;
  wandb_notes?: string;
  wandb_mode?: string;
  wandb_disable_artifact: boolean;
  policy_device?: string;
  policy_use_amp: boolean;
  optimizer_type?: string;
  optimizer_lr?: number;
  optimizer_weight_decay?: number;
  optimizer_grad_clip_norm?: number;
  use_policy_training_preset: boolean;
  // Optional target for runner dispatch; omitted ⇒ local.
  target?: { runner: "local" | "hf_cloud"; flavor?: string };
}

export interface JobRecord {
  id: string;
  name: string;
  state: JobState;
  config: TrainingRequest;
  output_dir: string;
  started_at: number;
  ended_at: number | null;
  exit_code: number | null;
  error_message: string | null;
  metrics: TrainingMetrics;
  runner: "local" | "hf_cloud" | "imported";
  hf_job_id: string | null;
  hf_flavor: string | null;
  hf_repo_id: string | null;
  hf_job_url: string | null;
  wandb_run_url: string | null;
  checkpoint_count: number;
}

// Per-running-job snapshot pushed by the watchdog over WS at ~1Hz. Subset
// of JobRecord — just the fields that change during a running tick.
export interface JobProgressSnapshot {
  id: string;
  state: JobState;
  metrics: TrainingMetrics;
  wandb_run_url: string | null;
  checkpoint_count: number;
}

export async function listJobs(
  baseUrl: string,
  fetcher: Fetcher,
  limit = 10,
  signal?: AbortSignal,
): Promise<JobRecord[]> {
  const body = await apiRequest<{ jobs: JobRecord[] }>(
    baseUrl,
    fetcher,
    `/jobs?limit=${limit}`,
    { signal, action: "List jobs" },
  );
  return body.jobs;
}

export async function getJob(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
  signal?: AbortSignal,
): Promise<JobRecord> {
  return apiRequest<JobRecord>(baseUrl, fetcher, `/jobs/${id}`, {
    signal,
    action: "Get job",
  });
}

export async function getJobLogs(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
  signal?: AbortSignal,
): Promise<LogLine[]> {
  const body = await apiRequest<{ logs: LogLine[] }>(
    baseUrl,
    fetcher,
    `/jobs/${id}/logs`,
    { signal, action: "Get job logs" },
  );
  return body.logs;
}

export async function getJobLogFile(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
  signal?: AbortSignal,
): Promise<LogLine[]> {
  const body = await apiRequest<{ logs: LogLine[] }>(
    baseUrl,
    fetcher,
    `/jobs/${id}/log-file`,
    { signal, action: "Get job log file" },
  );
  return body.logs;
}

export async function getJobMetricsHistory(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
  signal?: AbortSignal,
): Promise<MetricsHistoryPoint[]> {
  const body = await apiRequest<{ points: MetricsHistoryPoint[] }>(
    baseUrl,
    fetcher,
    `/jobs/${id}/metrics-history`,
    { signal, action: "Get job metrics history" },
  );
  return body.points;
}

export async function startTrainingJob(
  baseUrl: string,
  fetcher: Fetcher,
  request: TrainingRequest,
): Promise<JobRecord> {
  const { target, ...config } = request;
  const body = target ? { config, target } : config;
  try {
    return await apiRequest<JobRecord>(baseUrl, fetcher, "/jobs/training", {
      method: "POST",
      body,
      action: "Start training",
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      throw new Error("Another training is already running. Stop it first.");
    }
    throw e;
  }
}

export async function importModel(
  baseUrl: string,
  fetcher: Fetcher,
  source: string,
  name?: string,
): Promise<JobRecord> {
  return apiRequest<JobRecord>(baseUrl, fetcher, "/jobs/import", {
    method: "POST",
    body: name ? { source, name } : { source },
    action: "Import model",
  });
}

export async function stopJob(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
): Promise<JobRecord> {
  return apiRequest<JobRecord>(baseUrl, fetcher, `/jobs/${id}/stop`, {
    method: "POST",
    action: "Stop job",
  });
}

export async function deleteJob(
  baseUrl: string,
  fetcher: Fetcher,
  id: string,
): Promise<void> {
  await apiRequest<void>(baseUrl, fetcher, `/jobs/${id}`, {
    method: "DELETE",
    action: "Delete job",
  });
}

export interface RunnerFlavor {
  name: string;
  pretty_name: string;
  cpu: string;
  ram: string;
  accelerator: string | null;
  unit_cost_usd: number;
  unit_label: string;
}

export interface RunnerHardwareResponse {
  authenticated: boolean;
  username: string | null;
  flavors: RunnerFlavor[];
}

const EMPTY_HARDWARE: RunnerHardwareResponse = {
  authenticated: false,
  username: null,
  flavors: [],
};

export async function listRunnerHardware(
  baseUrl: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<RunnerHardwareResponse> {
  // Backend returns 401/403 for unauthenticated users; surface as "no flavors"
  // rather than throwing so the UI can render the "log in to use cloud" hint.
  try {
    return await apiRequest<RunnerHardwareResponse>(
      baseUrl,
      fetcher,
      "/jobs/runners/hardware",
      { signal, action: "List runner hardware" },
    );
  } catch (e) {
    if (e instanceof ApiError) return EMPTY_HARDWARE;
    throw e;
  }
}

export interface HubJob {
  id: string;
  created_at: string | null;
  docker_image: string | null;
  space_id: string | null;
  flavor: string | null;
  status: { stage: string; message: string | null } | null;
  owner: string | null;
  url: string;
}

export interface HubModel {
  repo_id: string;
  last_modified: string | null;
  private: boolean;
}

export interface HubJobsResponse {
  authenticated: boolean;
  jobs: HubJob[];
  models: HubModel[];
}

const EMPTY_HUB: HubJobsResponse = {
  authenticated: false,
  jobs: [],
  models: [],
};

export async function listHubJobs(
  baseUrl: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<HubJobsResponse> {
  // Same graceful degradation as listRunnerHardware.
  try {
    return await apiRequest<HubJobsResponse>(baseUrl, fetcher, "/jobs/hub", {
      signal,
      action: "List hub jobs",
    });
  } catch (e) {
    if (e instanceof ApiError) return EMPTY_HUB;
    throw e;
  }
}
