import { Fetcher, apiRequest } from "./apiClient";

export type DatasetSource = "local" | "hub" | "both";

export interface DatasetItem {
  repo_id: string;
  last_modified: string | null;
  private: boolean;
  source: DatasetSource;
}

export interface MergeDatasetsResult {
  success: true;
  repo_id: string;
  num_episodes: number;
  total_frames: number;
}

export async function listDatasets(
  baseUrl: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<DatasetItem[]> {
  return apiRequest<DatasetItem[]>(baseUrl, fetcher, "/datasets", {
    signal,
    action: "List datasets",
  });
}

/**
 * Local-cache datasets only — a pure filesystem scan on the backend, with no
 * Hugging Face Hub call. For lightweight callers (e.g. the onboarding poll)
 * that only need to know what exists on disk.
 */
export async function listLocalDatasets(
  baseUrl: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<DatasetItem[]> {
  return apiRequest<DatasetItem[]>(baseUrl, fetcher, "/datasets?scope=local", {
    signal,
    action: "List local datasets",
  });
}

export async function mergeLocalDatasets(
  baseUrl: string,
  fetcher: Fetcher,
  sourceRepoIds: string[],
  outputName: string,
): Promise<MergeDatasetsResult> {
  return apiRequest<MergeDatasetsResult>(baseUrl, fetcher, "/datasets/merge", {
    method: "POST",
    body: { source_repo_ids: sourceRepoIds, output_name: outputName },
    action: "Merge datasets",
  });
}

export interface EpisodeTaskResult {
  success: true;
  repo_id: string;
  task: string;
  updated_episodes: number;
}

/** Set the task of one episode, or of every episode when `episodeIndex` is null. */
export async function setEpisodeTask(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  task: string,
  episodeIndex: number | null,
): Promise<EpisodeTaskResult> {
  return apiRequest<EpisodeTaskResult>(baseUrl, fetcher, "/datasets/episode-task", {
    method: "POST",
    body: { repo_id: repoId, task, episode_index: episodeIndex },
    action: "Edit task",
  });
}
