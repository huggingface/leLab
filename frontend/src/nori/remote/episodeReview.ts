// NORI: client for dataset episode review — view (+ delete, local only) episodes.
// Two sources:
//   * LOCAL  — a dataset in the lerobot cache, served by lelab off /nori/capture/*
//              (unauthenticated, like the other capture endpoints). View + delete.
//   * CLOUD  — a promoted upload in the owner's Nori/HF repo, served by the
//              backend's Phase 2 viewer. The episodes LISTING is JWT-authorized
//              (noriRequest → direct backend on the hosted app, LeLab proxy on
//              desktop); each CLIP is fetched straight from the backend with a
//              signed token in the URL (a <video> media load needs no CORS).

import { noriRequest } from "@/nori/api/client";
import { type Fetcher } from "@/lib/apiClient";
import { lelabFetch } from "@/lib/localAuth";

export interface DatasetEpisode {
  episode_id?: string;
  collection_id?: string;
  outcome?: string;
  index: number;
  length: number;
  task: string;
  duration_s: number;
  /** Operator's per-episode name/annotation ("" / absent when unnamed).
   * Editable for cloud + raw sources; local datasets don't carry one. */
  name?: string;
}

const base = (u: string) => u.replace(/\/$/, "");

export interface EpisodeListing {
  cameras: string[];
  /** Derived-map channels for a map picker (["rgb", ...derived]); absent/empty
   * when none were requested. Only cloud-dataset listings carry this. */
  maps?: string[];
  /** Which maps exist FOR EACH CAMERA, e.g. {overhead: ["rgb","depth"]}.
   * Maps are derived per camera (users restrict this to cut GPU cost), so the
   * flat `maps` list over-promises: it offered depth on every camera and 404'd
   * on all but one, which read as "not generated yet" when the map merely
   * belonged to another camera. Prefer this when present. */
  maps_by_camera?: Record<string, string[]>;
  /** Camera to open on — prefers one that HAS derived maps, since the first
   * camera is arbitrary info.json order and landing there hides a real layer. */
  default_camera?: string | null;
  episodes: DatasetEpisode[];
}

export async function listEpisodes(baseUrl: string, repoId: string): Promise<EpisodeListing> {
  const r = await lelabFetch(`${base(baseUrl)}/nori/capture/datasets/${encodeURIComponent(repoId)}/episodes`);
  if (!r.ok) throw new Error(`couldn't list episodes (HTTP ${r.status})`);
  const j = (await r.json()) as { cameras?: string[]; episodes: DatasetEpisode[] };
  return { cameras: j.cameras ?? [], episodes: j.episodes };
}

/** URL for one episode's clip (AV1→H.264, transcoded on demand + cached). */
export function episodeClipUrl(baseUrl: string, repoId: string, index: number, camera?: string): string {
  const q = camera ? `?camera=${encodeURIComponent(camera)}` : "";
  return `${base(baseUrl)}/nori/capture/datasets/${encodeURIComponent(repoId)}/episode/${index}/clip.mp4${q}`;
}

/** URL for one episode's first-frame thumbnail (JPEG). */
export function episodeThumbUrl(baseUrl: string, repoId: string, index: number, camera?: string): string {
  const q = camera ? `?camera=${encodeURIComponent(camera)}` : "";
  return `${base(baseUrl)}/nori/capture/datasets/${encodeURIComponent(repoId)}/episode/${index}/thumb.jpg${q}`;
}

export async function deleteEpisodes(
  baseUrl: string,
  repoId: string,
  indices: number[],
): Promise<{ deleted: number; remaining: number }> {
  const r = await lelabFetch(`${base(baseUrl)}/nori/capture/datasets/${encodeURIComponent(repoId)}/delete-episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indices }),
  });
  if (!r.ok) {
    const d = ((await r.json().catch(() => null)) as { detail?: string } | null)?.detail;
    throw new Error(d ?? `delete failed (HTTP ${r.status})`);
  }
  return r.json();
}

// -- Cloud source (Phase 2: promoted uploads, viewable anywhere) ---------------

export interface CloudEpisodeListing extends EpisodeListing {
  session_id: string;
  /** Signed token appended to each clip URL (?t=). Valid until token_exp. */
  token: string;
  token_exp: number;
}

/** List a promoted dataset's episodes from the backend viewer (JWT-authorized). */
export async function listCloudEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
): Promise<CloudEpisodeListing> {
  return noriRequest<CloudEpisodeListing>(
    baseUrl,
    fetcher,
    `/nori/library/datasets/${encodeURIComponent(sessionId)}/episodes`,
    { action: "List dataset episodes" },
  );
}

/** Clip URL served straight from the backend, authorized by the signed token in
 * the query (no auth header, so a plain <video src> works cross-origin).
 * `backendBase` is config.noriBackendUrl. */
export function cloudEpisodeClipUrl(
  backendBase: string,
  sessionId: string,
  index: number,
  token: string,
  camera?: string,
  map?: string,
): string {
  const cam = camera ? `&camera=${encodeURIComponent(camera)}` : "";
  // A non-"rgb" map serves a derived channel — 404s until the processing tools
  // produce it (the caller shows a placeholder on error).
  const mp = map && map !== "rgb" ? `&map=${encodeURIComponent(map)}` : "";
  return (
    `${base(backendBase)}/api/v1/library/datasets/${encodeURIComponent(sessionId)}` +
    `/episode/${index}/clip.mp4?t=${encodeURIComponent(token)}${cam}${mp}`
  );
}

/** First-frame thumbnail (JPEG) served from the backend, token-authorized. */
export function cloudEpisodeThumbUrl(
  backendBase: string,
  sessionId: string,
  index: number,
  token: string,
  camera?: string,
  map?: string,
): string {
  const cam = camera ? `&camera=${encodeURIComponent(camera)}` : "";
  const mp = map && map !== "rgb" ? `&map=${encodeURIComponent(map)}` : "";
  return (
    `${base(backendBase)}/api/v1/library/datasets/${encodeURIComponent(sessionId)}` +
    `/episode/${index}/thumb.jpg?t=${encodeURIComponent(token)}${cam}${mp}`
  );
}

// -- Raw source (robot recordings, ORIGINAL quality, viewable before assembly) -
// A raw_bundle upload session, served by the backend's raw-recording viewer as a
// lossless faststart remux of the robot's original H.264 cam mp4s (no AV1, no
// double-transcode). Same JWT-listing + signed-clip-token shape as the cloud
// dataset viewer, just different routes.

/** List a promoted raw_bundle recording's episodes from the backend viewer. */
export async function listRecordingEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
): Promise<CloudEpisodeListing> {
  return noriRequest<CloudEpisodeListing>(
    baseUrl,
    fetcher,
    `/nori/library/recordings/${encodeURIComponent(sessionId)}/episodes`,
    { action: "List recording episodes" },
  );
}

/** Delete whole takes from a raw recording. Immediate (each raw episode is its
 * own folder — no rebuild job, unlike an assembled dataset), so the caller must
 * re-list afterwards: the remaining episodes' indices shift down. */
export async function deleteRecordingEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  episodeIndices: number[],
): Promise<{ deleted: number; episode_count: number; frame_count: number | null }> {
  return noriRequest(
    baseUrl,
    fetcher,
    `/nori/library/recordings/${encodeURIComponent(sessionId)}/delete-episodes`,
    { method: "POST", body: { episode_indices: episodeIndices }, action: "Delete episodes" },
  );
}

/** Name/annotate one raw-recording episode ("" clears). Stored beside the
 * bundle on the backend, and carried into any dataset later assembled from it. */
export async function nameRecordingEpisode(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  index: number,
  name: string,
): Promise<{ index: number; name: string }> {
  return noriRequest<{ index: number; name: string }>(
    baseUrl,
    fetcher,
    `/nori/library/recordings/${encodeURIComponent(sessionId)}/episode/${index}/name`,
    { method: "PATCH", body: { name }, action: "Name episode" },
  );
}

/** Name/annotate one episode of an assembled cloud dataset ("" clears).
 * Sidecar metadata only — training data untouched; survives delete/renumber. */
export async function nameCloudEpisode(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  index: number,
  name: string,
): Promise<{ episode_index: number; name: string }> {
  return noriRequest<{ episode_index: number; name: string }>(
    baseUrl,
    fetcher,
    `/nori/datasets/${encodeURIComponent(sessionId)}/episodes/${index}/name`,
    { method: "PATCH", body: { name }, action: "Name episode" },
  );
}

/** Raw clip URL — the robot's original file, lossless faststart remux. */
export function recordingClipUrl(
  backendBase: string,
  sessionId: string,
  index: number,
  token: string,
  camera?: string,
): string {
  const cam = camera ? `&camera=${encodeURIComponent(camera)}` : "";
  return (
    `${base(backendBase)}/api/v1/library/recordings/${encodeURIComponent(sessionId)}` +
    `/episode/${index}/clip.mp4?t=${encodeURIComponent(token)}${cam}`
  );
}

/** First-frame thumbnail (JPEG) of a raw episode, token-authorized. */
export function recordingThumbUrl(
  backendBase: string,
  sessionId: string,
  index: number,
  token: string,
  camera?: string,
): string {
  const cam = camera ? `&camera=${encodeURIComponent(camera)}` : "";
  return (
    `${base(backendBase)}/api/v1/library/recordings/${encodeURIComponent(sessionId)}` +
    `/episode/${index}/thumb.jpg?t=${encodeURIComponent(token)}${cam}`
  );
}
