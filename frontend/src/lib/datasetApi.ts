import { Fetcher, apiRequest } from "./apiClient";

export interface EpisodeSummary {
  episode_index: number;
  length: number;
  duration_s: number | null;
  tasks: string[];
}

export interface EpisodeListResponse {
  success: boolean;
  message?: string;
  repo_id: string;
  fps: number | null;
  robot_type: string | null;
  total_episodes: number;
  total_frames: number | null;
  cameras: string[];
  episodes: EpisodeSummary[];
}

export interface EpisodeCamera {
  name: string;
  /**
   * Where this episode starts inside the camera's mp4. Several episodes share
   * one file, so this is almost never 0 — and each camera carries its own
   * offset, which is why syncing secondaries means mapping through this value
   * rather than copying the driver's currentTime.
   */
  from_timestamp: number | null;
  to_timestamp: number | null;
  chunk: number;
  file_index: number;
}

export interface EpisodeDetail {
  success: boolean;
  message?: string;
  repo_id: string;
  episode_index: number;
  length: number;
  duration_s: number | null;
  tasks: string[];
  fps: number | null;
  robot_type: string | null;
  cameras: EpisodeCamera[];
  prev_episode: number | null;
  next_episode: number | null;
  total_episodes: number;
}

export interface MotionResponse {
  success: boolean;
  message?: string;
  episode_index: number;
  /** One aggregate value per frame: the sum of absolute joint deltas. */
  motion: number[];
  max_motion: number;
}

export interface Thumbnail {
  frame_index: number;
  data_uri: string;
}

export interface ThumbnailsResponse {
  success: boolean;
  message?: string;
  episode_index: number;
  camera: string;
  thumbnails: Thumbnail[];
}

export async function listEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  signal?: AbortSignal,
): Promise<EpisodeListResponse> {
  const qs = new URLSearchParams({ repo_id: repoId });
  return apiRequest<EpisodeListResponse>(baseUrl, fetcher, `/dataset-episodes?${qs}`, {
    signal,
    action: "List episodes",
  });
}

export async function getEpisode(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  episodeIndex: number,
  signal?: AbortSignal,
): Promise<EpisodeDetail> {
  const qs = new URLSearchParams({
    repo_id: repoId,
    episode_index: String(episodeIndex),
  });
  return apiRequest<EpisodeDetail>(baseUrl, fetcher, `/dataset-episode?${qs}`, {
    signal,
    action: "Load episode",
  });
}

export async function getMotion(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  episodeIndex: number,
  signal?: AbortSignal,
): Promise<MotionResponse> {
  const qs = new URLSearchParams({
    repo_id: repoId,
    episode_index: String(episodeIndex),
  });
  return apiRequest<MotionResponse>(baseUrl, fetcher, `/dataset-motion?${qs}`, {
    signal,
    action: "Load motion trace",
  });
}

export async function getThumbnails(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  episodeIndex: number,
  camera: string,
  count: number,
  signal?: AbortSignal,
): Promise<ThumbnailsResponse> {
  const qs = new URLSearchParams({
    repo_id: repoId,
    episode_index: String(episodeIndex),
    camera,
    count: String(count),
  });
  return apiRequest<ThumbnailsResponse>(baseUrl, fetcher, `/dataset-thumbnails?${qs}`, {
    signal,
    action: "Load thumbnails",
  });
}

/**
 * URL for one camera's mp4. Goes straight into <video src>, so it can't ride
 * apiRequest — the browser fetches it itself and does its own Range seeking.
 *
 * Addressed by chunk/file, not by episode: episodes share a file, so this URL
 * stays identical as you page between them and the element never reloads.
 */
export function videoUrl(
  baseUrl: string,
  repoId: string,
  camera: string,
  chunk: number,
  fileIndex: number,
): string {
  const qs = new URLSearchParams({
    repo_id: repoId,
    camera,
    chunk: String(chunk),
    file: String(fileIndex),
  });
  return `${baseUrl}/dataset-video?${qs}`;
}

/** URL for a single decoded frame as a PNG. Goes into <video poster> (or <img src>). */
export function frameUrl(
  baseUrl: string,
  repoId: string,
  episodeIndex: number,
  camera: string,
  frameIndex: number,
  maxWidth?: number,
): string {
  const qs = new URLSearchParams({
    repo_id: repoId,
    episode_index: String(episodeIndex),
    camera,
    frame_index: String(frameIndex),
  });
  if (maxWidth) qs.set("max_width", String(maxWidth));
  return `${baseUrl}/dataset-frame?${qs}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
