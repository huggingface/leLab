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

export interface MoveEpisodesResult {
  success: true;
  repo_id: string;
  moved_episodes: number;
  remaining_episodes: number;
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

export type MoveDestination = { newName: string } | { existingRepoId: string };

export async function moveEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  episodeIndices: number[],
  destination: MoveDestination,
): Promise<MoveEpisodesResult> {
  return apiRequest<MoveEpisodesResult>(baseUrl, fetcher, "/datasets/move-episodes", {
    method: "POST",
    body: {
      repo_id: repoId,
      episode_indices: episodeIndices,
      ...("newName" in destination
        ? { output_name: destination.newName }
        : { target_repo_id: destination.existingRepoId }),
    },
    action: "Move episodes",
  });
}

export type EpisodeTaskStatus =
  | { pending: true }
  | { pending: false; local_error?: string | null; hub_error?: string | null; hub_updated?: boolean };

/** Queue a task edit for one episode, or for every episode when `episodeIndex` is null. */
export async function setEpisodeTask(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  task: string,
  episodeIndex: number | null,
): Promise<void> {
  await apiRequest(baseUrl, fetcher, "/datasets/episode-task", {
    method: "POST",
    body: { repo_id: repoId, task, episode_index: episodeIndex },
    action: "Edit task",
  });
}

/** Whether the queued task edits of a dataset are still being written, and how they ended. */
export async function getEpisodeTaskStatus(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
): Promise<EpisodeTaskStatus> {
  return apiRequest<EpisodeTaskStatus>(
    baseUrl,
    fetcher,
    `/datasets/episode-task-status?repo_id=${encodeURIComponent(repoId)}`,
    { action: "Task edit status" },
  );
}
