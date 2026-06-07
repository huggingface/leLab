import { Fetcher } from "./apiClient";

export interface DatasetInfo {
  dataset_repo_id: string;
  num_episodes?: number;
  fps?: number;
  robot_type?: string;
}

export interface SyncStatus {
  on_hub: boolean;
  needs_sync: boolean;
  local_mtime: string | null;
  hub_mtime: string | null;
}

export async function getDatasetInfo(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string
): Promise<DatasetInfo> {
  const res = await fetcher(`${baseUrl}/dataset-info`, {
    method: "POST",
    body: JSON.stringify({ dataset_repo_id: repoId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || "Failed to load dataset info");
  }
  return data;
}

export async function getSyncStatus(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string
): Promise<SyncStatus> {
  const res = await fetcher(`${baseUrl}/dataset-sync-status`, {
    method: "POST",
    body: JSON.stringify({ dataset_repo_id: repoId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to load sync status");
  }
  return data;
}

export interface UploadDatasetResponse {
  success: boolean;
  message?: string;
  docs_url?: string;
}

export async function uploadDataset(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  isPrivate: boolean
): Promise<UploadDatasetResponse> {
  const res = await fetcher(`${baseUrl}/upload-dataset`, {
    method: "POST",
    body: JSON.stringify({
      dataset_repo_id: repoId,
      tags: ["robotics", "lerobot"],
      private: isPrivate,
    }),
  });
  return res.json();
}

export interface DeleteDatasetResponse {
  success: boolean;
  message?: string;
}

export async function deleteDataset(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string
): Promise<DeleteDatasetResponse> {
  const res = await fetcher(`${baseUrl}/delete-dataset`, {
    method: "POST",
    body: JSON.stringify({ dataset_repo_id: repoId }),
  });
  return res.json();
}
