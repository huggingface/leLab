import { Fetcher, apiRequest } from "./apiClient";

export interface JobCheckpoint {
  step: number;
  source: "local" | "hub";
  ref: string;
}

export interface PolicyConfigSummary {
  policy_type: string | null;
  image_features: Record<string, { height: number; width: number }>;
  requires_task: boolean;
}

export async function listJobCheckpoints(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  signal?: AbortSignal,
): Promise<JobCheckpoint[]> {
  const body = await apiRequest<{ checkpoints: JobCheckpoint[] }>(
    baseUrl,
    fetcher,
    `/jobs/${jobId}/checkpoints`,
    { signal, action: "List checkpoints" },
  );
  return body.checkpoints;
}

export async function getCheckpointPolicyConfig(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  step: number,
  signal?: AbortSignal,
): Promise<PolicyConfigSummary> {
  return apiRequest<PolicyConfigSummary>(
    baseUrl,
    fetcher,
    `/jobs/${jobId}/checkpoints/${step}/policy-config`,
    { signal, action: "Load policy config" },
  );
}

/**
 * Same policy-config summary, for a ref that isn't tied to a LeLab training
 * job — a local checkpoint directory (e.g. from a third-party
 * `lerobot_policy_<name>` plugin) or a raw Hub ref.
 */
export async function getCustomPolicyConfig(
  baseUrl: string,
  fetcher: Fetcher,
  policyRef: string,
  signal?: AbortSignal,
): Promise<PolicyConfigSummary> {
  const qs = new URLSearchParams({ policy_ref: policyRef });
  return apiRequest<PolicyConfigSummary>(baseUrl, fetcher, `/policy-config?${qs}`, {
    signal,
    action: "Load policy config",
  });
}
