// NORI: Additive file. Typed client for Nori-Backend, reached *through* the LeLab
// Python server's `/nori/*` proxy routes (same origin as the rest of the app). The
// browser attaches the Supabase JWT as `X-Nori-JWT`; LeLab forwards it to Nori-Backend
// as `Authorization: Bearer ...`. See NORI_PLAN.md "Auth model".
//
// Response shapes come from `./types.ts`, auto-generated from Nori-Backend's openapi.json
// (regenerate with `npm run gen:types`).

import { apiRequest, type Fetcher, type ApiRequestOptions } from "@/lib/apiClient";
import { getAccessToken } from "@/nori/auth/session";
import type { components } from "@/nori/api/types";
import type { JobRecord, TrainingRequest } from "@/lib/jobsApi";

/** The training config Nori forwards to LeLab's /jobs/training (target is added here). */
export type NoriTrainingConfig = Omit<TrainingRequest, "target">;

export type CustomerProfile = components["schemas"]["CustomerProfile"];
export type PolicyListEntry = components["schemas"]["PolicyListEntry"];
export type Acquisition = components["schemas"]["AcquisitionResponse"];
/** Result of the LeLab download proxy — bytes cached to local disk. */
export interface PolicyDownloadResult {
  ref: string;
  path: string;
  size_bytes: number;
}
export type DispatchResponse = components["schemas"]["DispatchResponse"];
export type TrainingJob = components["schemas"]["TrainingJob"];
export type TrainingJobLogs = components["schemas"]["TrainingJobLogs"];
export type SessionRow = components["schemas"]["SessionRow"];
/** upload_dataset adds this when it skipped the transfer because an identical
 *  promoted upload already exists (idempotent upload). */
export type MaybeDeduplicated = { deduplicated?: boolean };
export type Consent = components["schemas"]["Consent"];
export type ConsentType = components["schemas"]["ConsentGrantRequest"]["consent_type"];
export type DeletionRequest = components["schemas"]["DeletionRequest"];
export type DeletionScope = components["schemas"]["DeletionRequestCreate"]["request_scope"];

/** Label for the consent-policy text the user agreed to. Bump when that text changes. */
export const CONSENT_POLICY_VERSION = "v1";
/** GET /customers/me returns the profile, or this shape when not yet provisioned. */
export type NotProvisioned = { provisioned: false } & Record<string, unknown>;
export type CustomerMe = CustomerProfile | NotProvisioned;

export function isProvisioned(me: CustomerMe): me is CustomerProfile {
  return (me as NotProvisioned).provisioned !== false && "id" in me;
}

export interface NoriPublicConfig {
  noriBackendUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  configured: boolean;
}

/** Build the fetcher that injects the Nori JWT header on top of the base fetcher. */
function withNoriAuth(fetcher: Fetcher): Fetcher {
  return async (url, options = {}) => {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (token) headers["X-Nori-JWT"] = token;
    return fetcher(url, { ...options, headers });
  };
}

// -- hosted direct-backend mode --------------------------------------------
// On the hosted site (Vercel) there is no local LeLab, so the `/nori/*` proxy
// has nowhere to go. The pure-proxy routes are 1:1 mirrors of Nori-Backend's
// `/api/v1/*` surface and the backend validates the Supabase JWT itself, so in
// hosted mode we call the backend directly: `/nori/X` → `<backend>/api/v1/X`
// with `Authorization: Bearer <jwt>` (instead of the X-Nori-JWT proxy header).
// Enabled by NoriContext when the bootstrap falls back to build-time config
// AND the bundle carries VITE_NORI_BACKEND_URL. Requires the backend to
// allowlist this origin (Nori-Backend config.py `_HOSTED_APP_ORIGINS`).
let directBackendUrl: string | null = null;

/** LeLab-local surfaces with no backend equivalent (hardware, local disk,
 * the local LLM proxy, the installed-policy cache). Blocked with a clear
 * error instead of a confusing 404. */
const LELAB_ONLY_PREFIXES = [
  "/nori/llm",
  "/nori/leader",
  "/nori/datasets/upload",
  "/nori/policies/local",
];

// Routing gate: pages fetch on mount, but proxy-vs-direct is only decided when
// the bootstrap's config probe settles (up to 4s later on a hosted page). Every
// noriRequest waits on this gate so a mount-time fetch can't race ahead and hit
// the dead localhost proxy before direct mode is enabled. Mirrors the Supabase
// auth gate in auth/supabase.ts. NoriContext MUST settle it on every bootstrap
// terminal path (success, fallback, and error) or all /nori/* requests hang.
let settleRouting: (() => void) | undefined;
const routingSettled = new Promise<void>((resolve) => {
  settleRouting = resolve;
});

/** Called by NoriContext once proxy-vs-direct routing is decided. Idempotent. */
export function settleBackendRouting(): void {
  settleRouting?.();
}

export function enableDirectBackend(url: string): void {
  directBackendUrl = url.replace(/\/+$/, "");
}

/** True when requests go straight to Nori-Backend (hosted, LeLab-free). */
export function isDirectBackend(): boolean {
  return directBackendUrl !== null;
}

/** The Nori-Backend origin when in direct (hosted) mode, else null. Used by the LLM pages,
 * which — unlike the /nori/* proxy routes — must reach the backend's `/api/v1/agent/llm/*`
 * proxy directly (there is no LeLab in a hosted build to assemble + forward for them). */
export function getDirectBackendUrl(): string | null {
  return directBackendUrl;
}

function withDirectAuth(fetcher: Fetcher): Fetcher {
  return async (url, options = {}) => {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetcher(url, { ...options, headers });
  };
}

/**
 * Make an authenticated request to a LeLab `/nori/*` proxy route — or, in
 * hosted direct-backend mode, to the equivalent Nori-Backend route.
 * `baseUrl` is the LeLab server (from ApiContext), not Nori-Backend directly.
 */
export async function noriRequest<T = unknown>(
  baseUrl: string,
  fetcher: Fetcher,
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  await routingSettled; // proxy-vs-direct decided by the bootstrap — see gate above
  if (directBackendUrl) {
    if (
      LELAB_ONLY_PREFIXES.some((p) => path.startsWith(p)) ||
      path.endsWith("/download") // marketplace install writes to LeLab's local disk
    ) {
      throw new Error(
        "This action needs the Nori desktop app — it isn't available on the hosted site."
      );
    }
    const apiPath = path.replace(/^\/nori/, "/api/v1");
    return apiRequest<T>(directBackendUrl, withDirectAuth(fetcher), apiPath, options);
  }
  return apiRequest<T>(baseUrl, withNoriAuth(fetcher), path, options);
}

/**
 * Browser-native upload variant of noriRequest. The /datasets/upload routes are
 * LeLab-only for the DESKTOP repo_id flow (the proxy reads a local dataset), but the
 * browser-native MANIFEST flow reaches the backend directly (hosted). So this variant
 * skips the lelab-only gate for those paths: in direct-backend mode it hits the backend
 * directly; on the desktop proxy it forwards as usual. Kept separate so the existing
 * desktop uploadDataset() stays gated + unbroken.
 */
export async function noriUploadRequest<T = unknown>(
  baseUrl: string,
  fetcher: Fetcher,
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  await routingSettled;
  if (directBackendUrl) {
    const apiPath = path.replace(/^\/nori/, "/api/v1");
    return apiRequest<T>(directBackendUrl, withDirectAuth(fetcher), apiPath, options);
  }
  return apiRequest<T>(baseUrl, withNoriAuth(fetcher), path, options);
}

/** Public config bootstrap — does not require auth. */
export function getNoriConfig(baseUrl: string, fetcher: Fetcher): Promise<NoriPublicConfig> {
  return apiRequest<NoriPublicConfig>(baseUrl, fetcher, "/nori/config", {
    action: "Load Nori config",
    // This is THE LeLab-reachability probe (leLabAvailable gates local-hardware pages
    // on it). On a hosted page a fetch to the default dead localhost:8000 can hang
    // indefinitely — the bootstrap never settles and pages that should show
    // "unavailable on the web" just spin. A local server answers in ms; 4s is generous.
    signal: AbortSignal.timeout(4000),
  });
}

/**
 * Build-time public config, used as a fallback when no LeLab server is reachable
 * (the LeLab-free hosted deploy — e.g. the standalone VR page). Populated from
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (+ optional `VITE_NORI_BACKEND_URL`)
 * baked in at build time. Returns null when the bundle was built without them, so the
 * default LeLab-served `/nori/config` path is completely unaffected.
 *
 * These are PUBLIC values — the anon key already ships to every browser via
 * `/nori/config`; baking it is not a secrets leak. A service-role key must never go here.
 */
export function getBuildTimeConfig(): NoriPublicConfig | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return {
    noriBackendUrl: import.meta.env.VITE_NORI_BACKEND_URL ?? "",
    supabaseUrl,
    supabaseAnonKey,
    configured: true,
  };
}

// -- customers / provisioning (Phase 2) ----------------------------------------

/** POST /nori/customers/me/provision — idempotent; safe on every sign-in. */
export function provisionCustomer(baseUrl: string, fetcher: Fetcher): Promise<CustomerProfile> {
  return noriRequest<CustomerProfile>(baseUrl, fetcher, "/nori/customers/me/provision", {
    method: "POST",
    action: "Provision account",
  });
}

/** GET /nori/customers/me — profile, or NotProvisioned if not yet provisioned. */
export function getCustomer(baseUrl: string, fetcher: Fetcher): Promise<CustomerMe> {
  return noriRequest<CustomerMe>(baseUrl, fetcher, "/nori/customers/me", {
    action: "Load account",
  });
}

// -- marketplace (Phase 3) -----------------------------------------------------

/** GET /nori/marketplace/policies — full catalog; filter by `source` client-side. */
export function listPolicies(baseUrl: string, fetcher: Fetcher): Promise<PolicyListEntry[]> {
  return noriRequest<PolicyListEntry[]>(baseUrl, fetcher, "/nori/marketplace/policies", {
    action: "Load marketplace",
  });
}

/** Acquire also kicks off a one-click "add to my cloud" copy job (import_job_id). */
export type AcquisitionResult = Acquisition & { import_job_id?: string | null };

/** POST /nori/marketplace/policies/{listingId}/acquire — entitles AND enqueues a
 * copy of the item into the caller's own cloud (poll import_job_id). */
export function acquirePolicy(
  baseUrl: string,
  fetcher: Fetcher,
  listingId: string
): Promise<AcquisitionResult> {
  return noriRequest<AcquisitionResult>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(listingId)}/acquire`,
    { method: "POST", action: "Add to my cloud" }
  );
}

/** An "add to my cloud" import job (copies a community listing into the user's
 * cloud). Poll getImportJob until DONE; then the item shows in My Stuff. */
export interface ImportJob {
  id: string;
  status: "PENDING" | "IMPORTING" | "DONE" | "FAILED";
  kind: "policy" | "dataset";
  result_dataset_session_id: string | null;
  result_job_id: string | null;
  failure_reason: string | null;
}

/** GET /nori/marketplace/imports/{id} — poll an add-to-my-cloud import job. */
export function getImportJob(baseUrl: string, fetcher: Fetcher, importJobId: string): Promise<ImportJob> {
  return noriRequest<ImportJob>(
    baseUrl,
    fetcher,
    `/nori/marketplace/imports/${encodeURIComponent(importJobId)}`,
    { action: "Check add-to-cloud status" }
  );
}

/** POST /nori/marketplace/policies/{ref}/download — caches bytes to local disk. */
export function downloadPolicy(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string
): Promise<PolicyDownloadResult> {
  return noriRequest<PolicyDownloadResult>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(ref)}/download`,
    { method: "POST", action: "Download policy" }
  );
}

/** One file of a policy bundle, as reported by the details endpoint. */
export interface PolicyFileSummary {
  name: string;
  size_bytes: number | null;
  sha256: string | null;
}
/** LeRobot stats for a dataset listing (from meta/info.json); datasets only. */
export interface DatasetStats {
  total_episodes: number | null;
  total_frames: number | null;
  fps: number | null;
  robot_type: string | null;
  task: string | null;
}
/** Full detail view — superset of the catalog list entry. */
export interface PolicyDetails {
  ref: string;
  source: string;
  kind?: string; // "policy" | "dataset" | "bundle"
  title: string;
  is_renamed: boolean;
  description: string | null;
  policy_class: string | null;
  price_usd: number | null;
  created_at: string;
  dataset_repo: string | null;
  promoted_at: string | null;
  final_cost_usd: number | null;
  timeout_seconds: number | null;
  editable: boolean;
  files: PolicyFileSummary[];
  dataset_stats?: DatasetStats | null;
  /** Real training stats for own policies (null for listings). */
  training_steps?: number | null;
  batch_size?: number | null;
  dataset_episode_count?: number | null;
  dataset_frame_count?: number | null;
}

/** GET /nori/marketplace/policies/{ref}/details — full detail view. */
export function getPolicyDetails(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string
): Promise<PolicyDetails> {
  return noriRequest<PolicyDetails>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(ref)}`,
    { action: "Load policy details" }
  );
}

/** PATCH /nori/marketplace/policies/{ref} — rename an own policy (title=null clears). */
export function renamePolicy(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string,
  title: string | null
): Promise<PolicyDetails> {
  return noriRequest<PolicyDetails>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(ref)}`,
    { method: "PATCH", body: { title }, action: "Rename policy" }
  );
}

/**
 * One of the caller's community-publish submissions (any lifecycle state).
 * `status`: pending_review | public | rejected | taken_down. Non-public states
 * are visible ONLY to the owner (this view); the public catalog never shows them.
 */
export interface MyListing {
  listing_id: string;
  source_job_id: string | null;
  /** Dataset listings key on the upload session (source_job_id stays null) —
   * match a detail ref against either field. */
  source_upload_session_id?: string | null;
  title: string;
  description: string | null;
  status: string;
  review_reason: string | null;
  in_review: boolean;
  is_public: boolean;
  created_at: string;
}


/**
 * POST .../publish — request community publication of an OWN policy. Creates a
 * pending_review listing; re-homing + human review happen server-side before it
 * goes public. 403 = grant the publish_public consent first; 409 = already has
 * an active listing / in-flight deletion / pre-bundle legacy policy.
 */
export function publishPolicy(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string,
  title: string,
  description: string | null
): Promise<MyListing> {
  return noriRequest<MyListing>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(ref)}/publish`,
    { method: "POST", body: { title, description }, action: "Publish policy" }
  );
}

/** POST /nori/marketplace/datasets/{uploadRef}/publish — publish one of your
 * PROMOTED uploads as a community dataset (uploadRef = the upload session id).
 * 202: created in pending_review, auto-publishes after re-homing + the format
 * gate. 403 without publish_public consent; 409 if already published. */
export function publishDataset(
  baseUrl: string,
  fetcher: Fetcher,
  uploadRef: string,
  title: string,
  description: string | null
): Promise<MyListing> {
  return noriRequest<MyListing>(
    baseUrl,
    fetcher,
    `/nori/marketplace/datasets/${encodeURIComponent(uploadRef)}/publish`,
    { method: "POST", body: { title, description }, action: "Publish dataset" }
  );
}

/** DELETE .../publish — instant, idempotent takedown of the active listing. */
export function unpublishPolicy(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string
): Promise<{ taken_down: string[] }> {
  return noriRequest<{ taken_down: string[] }>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/${encodeURIComponent(ref)}/publish`,
    { method: "DELETE", action: "Unpublish policy" }
  );
}

/** DELETE /nori/marketplace/datasets/{uploadRef}/publish — instant, idempotent
 * takedown of the active dataset listing sourced from this upload. */
export function unpublishDataset(
  baseUrl: string,
  fetcher: Fetcher,
  uploadRef: string
): Promise<{ taken_down: string[] }> {
  return noriRequest<{ taken_down: string[] }>(
    baseUrl,
    fetcher,
    `/nori/marketplace/datasets/${encodeURIComponent(uploadRef)}/publish`,
    { method: "DELETE", action: "Unpublish dataset" }
  );
}

/** GET /nori/marketplace/my-listings — the caller's submissions + review state. */
export function listMyListings(baseUrl: string, fetcher: Fetcher): Promise<MyListing[]> {
  return noriRequest<MyListing[]>(baseUrl, fetcher, "/nori/marketplace/my-listings", {
    action: "Load my listings",
  });
}

/** One installed policy in the local Nori cache. */
export interface LocalPolicy {
  ref: string;
  path: string;
  files: { name: string; size_bytes: number }[];
  size_bytes: number;
  runnable: boolean;
}

/** GET /nori/policies/local — installed policies (survives refresh; local disk). */
export function listLocalPolicies(
  baseUrl: string,
  fetcher: Fetcher
): Promise<LocalPolicy[]> {
  return noriRequest<LocalPolicy[]>(baseUrl, fetcher, "/nori/policies/local", {
    action: "Load installed policies",
  });
}

/** DELETE /nori/policies/local/{ref} — remove an installed policy from the cache. */
export function deleteLocalPolicy(
  baseUrl: string,
  fetcher: Fetcher,
  ref: string
): Promise<{ ref: string; deleted: boolean }> {
  return noriRequest<{ ref: string; deleted: boolean }>(
    baseUrl,
    fetcher,
    `/nori/policies/local/${encodeURIComponent(ref)}`,
    { method: "DELETE", action: "Remove installed policy" }
  );
}

// -- datasets / training (Phase 4) ---------------------------------------------

/** POST /nori/datasets/upload — runs the backend-mediated 4-step S3 upload. */
export function uploadDataset(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  commitMessage?: string
): Promise<SessionRow> {
  return noriRequest<SessionRow>(baseUrl, fetcher, "/nori/datasets/upload", {
    method: "POST",
    body: { repo_id: repoId, commit_message: commitMessage },
    action: "Upload dataset",
  });
}

/** POST /nori/training/dispatch — body {timeout_seconds: 60..3600}. */
export function dispatchTraining(
  baseUrl: string,
  fetcher: Fetcher,
  timeoutSeconds = 900
): Promise<DispatchResponse> {
  return noriRequest<DispatchResponse>(baseUrl, fetcher, "/nori/training/dispatch", {
    method: "POST",
    body: { timeout_seconds: timeoutSeconds },
    action: "Dispatch training",
  });
}

/**
 * Start a Nori-dispatched training via LeLab's existing /jobs/training endpoint with a
 * `nori_cloud` target. The job lands in LeLab's job registry + watch UI (NoriCloudJobRunner)
 * AND, since it dispatches to the backend, in GET /nori/training/jobs. Returns the LeLab
 * JobRecord (its `id` keys the local monitor at /nori/training/:jobId).
 *
 * NOTE: the whole `config` (policy/steps/optimizer/…) is forwarded and recorded on the
 * LeLab JobRecord, but Nori-Backend's dispatch is currently config-less — it only reads
 * `target.timeout_seconds` and decides what to train from the customer's data + consents.
 * The extra fields have no training effect until Nori-Backend honors them.
 */
/** Constants for client-side training-time estimates — same numbers the
 * backend's dispatch fit-gate uses, so UI estimate and server verdict can
 * never disagree. `resumable` flips server-side when safe pause/resume ships. */
export interface TrainingEstimateParams {
  step_rates: Record<string, { floor: number; typical: number }>;
  setup_seconds: number;
  max_timeout_seconds: number;
  resumable: boolean;
}

/** One policy in the My Stuff library, with its UI state bucket and lineage. */
export interface LibraryPolicy {
  job_id: string;
  /** The customer's display title (set via rename), if any. */
  title: string | null;
  /** applied_config.policy_type — available pre-promotion (policy_class isn't). */
  policy_type: string | null;
  /** First RUNNING sighting; drives the live-progress estimate. */
  run_started_at: string | null;
  status: string;
  state: "live" | "training" | "paused" | "failed";
  policy_class: string | null;
  steps: number | null;
  steps_done: number | null;
  created_at: string;
  promoted_at: string | null;
  checkpoint_url: string | null;
  final_cost_usd: number | null;
  /** Owner-set: when true, the policy can't be renamed or deleted. */
  locked?: boolean;
  /** 'own' (trained here) | 'community' (added from a marketplace listing). */
  origin?: "own" | "community";
  /** The listing this was copied from (community items only). */
  source_listing_id?: string | null;
  /** True when the caller has a live/pending community listing for this item. */
  published?: boolean;
}

/** One uploaded dataset with the policies trained from it. */
export interface LibraryDataset {
  dataset_ref: string;
  session_id: string;
  label: string;
  created_at: string;
  episode_count: number | null;
  frame_count: number | null;
  /** Record-time robot model ("L2" | "L3"); null for pre-label datasets (L2 era). */
  robot_type?: string | null;
  /** Owner-set: when true, the dataset can't be renamed or deleted. */
  locked?: boolean;
  /** 'own' (assembled/uploaded here) | 'community' (added from a marketplace listing). */
  origin?: "own" | "community";
  /** The listing this was copied from (community items only). */
  source_listing_id?: string | null;
  /** True when the caller has a live/pending community listing for this item. */
  published?: boolean;
  /** Assemble-time processing options (REQUESTED, not produced — the processing
   * tools aren't wired yet). Shown as badges; the maps drive the viewer's picker. */
  /** Maps REQUESTED at assemble time. */
  derived_maps?: string[];
  /** Maps actually written and downloadable. A map in derived_maps but not here
   *  is still generating (GPU work, can be hours). Can also be a superset: one
   *  inverse-rendering pass emits normals+albedo+roughness together. */
  produced_maps?: string[];
  video_processing?: string[];
  policies: LibraryPolicy[];
}

export interface Library {
  datasets: LibraryDataset[];
  /** Policies whose source dataset can't be resolved (shown as "source not recorded"). */
  unlinked_policies: LibraryPolicy[];
}

/** PATCH /nori/datasets/upload/{id} — rename an upload (owner-private label). */
export function renameUploadLabel(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  label: string
): Promise<SessionRow> {
  return noriRequest<SessionRow>(
    baseUrl,
    fetcher,
    `/nori/datasets/upload/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: { label }, action: "Rename dataset" }
  );
}

/** PATCH /nori/training/jobs/{id}/name — name a policy at ANY lifecycle stage
 * (before training finishes included). None/empty clears back to generated titles. */
export function renameTrainingJob(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  title: string | null
): Promise<{ job_id: string; title: string | null }> {
  return noriRequest<{ job_id: string; title: string | null }>(
    baseUrl,
    fetcher,
    `/nori/training/jobs/${encodeURIComponent(jobId)}/name`,
    { method: "PATCH", body: { title }, action: "Rename policy" }
  );
}

/** GET /nori/library — the My Stuff aggregate (datasets ↔ policies, joined by lineage). */
// ---- Sound clips: the soundboard library -------------------------------------

/** One clip in the customer's library. `duration_ms`/`bytes` describe the CANONICAL
 *  (converted) audio, not the uploaded file, and are null until it is READY. */
export interface SoundClip {
  id: string;
  name: string;
  status: "PENDING_UPLOAD" | "READY" | "FAILED";
  duration_ms: number | null;
  bytes: number | null;
  created_at: string | null;
  /** Why a FAILED clip failed, in words meant for the person who uploaded it. */
  failure_reason: string | null;
}

export function listSounds(baseUrl: string, fetcher: Fetcher): Promise<{ sounds: SoundClip[] }> {
  return noriRequest(baseUrl, fetcher, "/nori/sounds", { action: "Load your sounds" });
}

export function startSoundUpload(
  baseUrl: string, fetcher: Fetcher, filename: string, name?: string,
): Promise<{ sound_id: string; put_url: string; expires_in: number; max_bytes: number }> {
  return noriRequest(baseUrl, fetcher, "/nori/sounds/upload/start", {
    method: "POST", body: { filename, name: name ?? null }, action: "Start the upload",
  });
}

export function finalizeSoundUpload(
  baseUrl: string, fetcher: Fetcher, soundId: string,
): Promise<{ sound_id: string; status: string; duration_ms?: number; bytes?: number }> {
  return noriRequest(baseUrl, fetcher, `/nori/sounds/upload/${soundId}/finalize`, {
    method: "POST", action: "Finish the upload",
  });
}

export function getSoundUrl(
  baseUrl: string, fetcher: Fetcher, soundId: string, original = false,
): Promise<{ url: string; expires_in: number; name: string }> {
  const query = original ? "?original=true" : "";
  return noriRequest(baseUrl, fetcher, `/nori/sounds/${soundId}/url${query}`, {
    action: "Get the sound",
  });
}

export function renameSound(
  baseUrl: string, fetcher: Fetcher, soundId: string, name: string,
): Promise<{ id: string; name: string }> {
  return noriRequest(baseUrl, fetcher, `/nori/sounds/${soundId}`, {
    method: "PATCH", body: { name }, action: "Rename the sound",
  });
}

export function deleteSound(
  baseUrl: string, fetcher: Fetcher, soundId: string,
): Promise<{ deleted: boolean; id: string }> {
  return noriRequest(baseUrl, fetcher, `/nori/sounds/${soundId}`, {
    method: "DELETE", action: "Delete the sound",
  });
}

/**
 * Upload one file end to end: open the session, PUT the bytes STRAIGHT TO S3, then
 * finalize. The PUT bypasses both LeLab and the backend — presigned URLs exist so
 * user bytes never transit our servers — which is also why the SSE header below is
 * mandatory: it is baked into the URL's signature and the bucket denies unencrypted
 * PUTs, so omitting it fails with SignatureDoesNotMatch rather than anything helpful.
 */
export async function uploadSound(
  baseUrl: string, fetcher: Fetcher, file: File, name?: string,
): Promise<SoundClip> {
  const started = await startSoundUpload(baseUrl, fetcher, file.name, name);
  if (file.size > started.max_bytes) {
    throw new Error(
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ` +
      `${Math.round(started.max_bytes / (1024 * 1024))} MB.`
    );
  }
  const put = await fetch(started.put_url, {
    method: "PUT",
    headers: { "x-amz-server-side-encryption": "AES256" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Try again.`);

  const done = await finalizeSoundUpload(baseUrl, fetcher, started.sound_id);
  return {
    id: started.sound_id,
    name: name ?? file.name.replace(/\.[^.]+$/, ""),
    status: (done.status as SoundClip["status"]) ?? "READY",
    duration_ms: done.duration_ms ?? null,
    bytes: done.bytes ?? null,
    created_at: new Date().toISOString(),
    failure_reason: null,
  };
}

export function getLibrary(baseUrl: string, fetcher: Fetcher): Promise<Library> {
  return noriRequest<Library>(baseUrl, fetcher, "/nori/library", { action: "Load your library" });
}

/** One robot-recorded episode bundle (W2.11). Not trainable yet (needs assembly);
 *  a read-only view of what the robot has recorded and where it is in its journey
 *  to the cloud. `status`: PROMOTED = in your cloud; PENDING_UPLOAD/FINALIZING =
 *  in flight; FAILED/PROMOTION_FAILED = needs attention. */
export interface RawBundleEntry {
  session_id: string;
  recording_metadata?: {
    display_name?: string;
    episode_id: string;
    collection_id: string;
    task: string;
    outcome: "success" | "failure" | "aborted" | "discarded" | "unknown";
    recorded_at: string;
  } | null;
  label: string;
  status: string;
  hf_path_prefix: string | null;
  episode_count: number | null;
  frame_count: number | null;
  /** Episode length in seconds (action-stream span from the bundle's
   *  meta.json). Absent until the backend surfaces it — the card just omits
   *  the duration until then. */
  duration_s?: number | null;
  /** Count of commanded-motion samples (action rows, ~50 Hz Servo output) —
   *  "motion samples" on the card. Absent until the backend surfaces it. */
  action_count?: number | null;
  /** Capture provenance from the bundle's meta.json (absent until the backend
   *  surfaces it): camera_format "mjpeg"|"yuyv", auto_exposure "auto"|"manual".
   *  Rendered as labels so the ML side can tell what a take was filmed with. */
  camera_format?: string | null;
  auto_exposure?: string | null;
  /** Record-time robot model ("L2" | "L3", from the recorder's capture stamp);
   *  null for recordings made before the label existed (the L2 fleet). */
  robot_type?: string | null;
  created_at: string;
  finalized_at: string | null;
  failure_reason: string | null;
  /** True while this recording is a source of an in-flight assembly job — the UI
   *  shows "Uploading to dataset" and it can't be selected again meanwhile. */
  assembling?: boolean;
  /** Owner-set: a locked recording can't be renamed or deleted (whole recording
   *  or individual episodes). Same lock as datasets/policies (migration 026);
   *  toggled through the shared setDatasetLock endpoint (recordings are upload
   *  sessions too). */
  locked?: boolean;
  /** When the recording robot confirmed it deleted its local raw copy after
   *  promotion (W2.11). null while PROMOTED means the full-quality copy is in the
   *  cloud but the robot still holds its on-disk copy — the UI shows "Finishing on
   *  robot…" until this is set, so "In cloud" also means the SD-card space is back. */
  local_deleted_at?: string | null;
  /** The MOST RECENT assembly job using this recording FAILED with this reason
   *  (e.g. "all were excluded (episode-0002: camera gap 7.2s)"). null when the
   *  latest attempt succeeded or is still running — a new attempt clears it. */
  last_assembly_error?: string | null;
}

export interface RobotRecordings {
  bundles: RawBundleEntry[];
  /** Episodes recorded but not yet uploaded from the robot; null if unknown
   *  (the robot hasn't reported recently / heartbeat table unavailable). */
  on_robot_pending: number | null;
}

/** GET /nori/datasets/raw-bundles — the caller's robot recordings for My Stuff. */
export function getRobotRecordings(baseUrl: string, fetcher: Fetcher): Promise<RobotRecordings> {
  return noriRequest<RobotRecordings>(baseUrl, fetcher, "/nori/datasets/raw-bundles", {
    action: "Load your robot recordings",
  });
}

/** An assembly job (recording -> flat LeRobot dataset). Enqueued by /assemble and
 *  the session/episode delete rebuilds; poll getAssemblyJob until terminal. */
export interface AssemblyJob {
  id: string;
  status: "PENDING" | "ASSEMBLING" | "DONE" | "FAILED";
  mode: "new" | "append" | "rebuild";
  failure_reason: string | null;
  result_dataset_session_id: string | null;
  created_at: string;
}

/** Maps derivable from recordings + video-processing passes, offered at assemble
 *  time. These are LIVE now: depth comes from the masking stage, and
 *  normals/albedo/roughness from one inverse-rendering pass on a GPU. */
/** Selectable per-frame maps. `metallic` is deliberately ABSENT: the model
 *  emits it, but on our footage it is salt-and-pepper noise (the quantity is
 *  ill-posed from a single view — see the SDG findings), so it would ship a map
 *  nobody can use. The backend rejects it with a 422, so offering it here would
 *  only produce a failed assemble. */
export const DERIVE_MAPS = ["depth", "normals", "albedo", "roughness"] as const;
export const VIDEO_PROCESSING = ["color_jitter", "full_relight"] as const;
/** Which of the above a user may actually request. Empty on purpose: both
 *  passes RUN, but their output is not yet packaged into a downloadable layer
 *  (the backend's finalize only writes MAP layers), so selecting one spent GPU
 *  hours and delivered nothing while still reporting success. The backend
 *  rejects them with a 422 that says exactly that, so offering them here would
 *  only produce a failed assemble. Flip this when the relight lane ships. */
export const VIDEO_PROCESSING_ENABLED: readonly string[] = [];
export type DeriveMap = (typeof DERIVE_MAPS)[number];
export type VideoProcessing = (typeof VIDEO_PROCESSING)[number];

/** POST /nori/datasets/assemble — turn robot recordings into a trainable dataset
 *  (a NEW one, or APPEND onto an existing dataset). Returns the job to poll. */
export function assembleDataset(
  baseUrl: string,
  fetcher: Fetcher,
  args: {
    sources: string[];
    mode: "new" | "append";
    targetDatasetSessionId?: string | null;
    name?: string | null;
    deriveMaps?: string[];
    videoProcessing?: string[];
    /** Cameras to derive maps for; [] = all. MUST match what was sent to
     *  estimateAssembly, or the quoted time describes a different job than the
     *  one that runs. */
    mapCameras?: string[];
  }
): Promise<{ assembly_job_id: string; status: string }> {
  return noriRequest(baseUrl, fetcher, "/nori/datasets/assemble", {
    method: "POST",
    body: {
      sources: args.sources,
      mode: args.mode,
      target_dataset_session_id: args.targetDatasetSessionId ?? null,
      name: args.name ?? null,
      derive_maps: args.deriveMaps ?? [],
      video_processing: args.videoProcessing ?? [],
      map_cameras: args.mapCameras ?? [],
    },
    action: "Assemble dataset",
  });
}

/** POST /nori/datasets/assemble/estimate — how long the selection will take.
 *
 *  TWO phases, reported separately because they differ by orders of magnitude:
 *    assembly_seconds   minutes; after this the dataset is trainable.
 *    processing_seconds  map derivation on GPUs — HOURS for a large selection
 *                        (measured ~0.6 h for one 4-camera episode of normals).
 *                        `null` means "selected but the rate isn't measured
 *                        yet" and MUST render as unknown, never as instant.
 *
 *  `estimated_seconds` is kept for back-compat and equals assembly_seconds.
 *  Callers should fail SOFT: the endpoint may be absent on an older backend,
 *  and the split fields are absent on a backend older than the split. */
export function estimateAssembly(
  baseUrl: string,
  fetcher: Fetcher,
  args: {
    sources: string[];
    deriveMaps?: string[];
    videoProcessing?: string[];
    /** Cameras to derive maps for; [] = all. Cost is per (episode x camera). */
    mapCameras?: string[];
  }
): Promise<{
  estimated_seconds: number;
  assembly_seconds?: number;
  processing_seconds?: number | null;
  frame_count: number;
  episode_count: number;
}> {
  return noriRequest(baseUrl, fetcher, "/nori/datasets/assemble/estimate", {
    method: "POST",
    body: {
      sources: args.sources,
      derive_maps: args.deriveMaps ?? [],
      video_processing: args.videoProcessing ?? [],
      map_cameras: args.mapCameras ?? [],
    },
    action: "Estimate assembly time",
  });
}

/** GET /nori/datasets/assemble/{id} — poll one assembly job. */
export function getAssemblyJob(baseUrl: string, fetcher: Fetcher, jobId: string): Promise<AssemblyJob> {
  return noriRequest<AssemblyJob>(baseUrl, fetcher, `/nori/datasets/assemble/${encodeURIComponent(jobId)}`, {
    action: "Check assembly status",
  });
}

/** An in-flight assembly job (for My Stuff's "Assembling" dataset badge / placeholder). */
export interface ActiveAssembly {
  id: string;
  mode: "new" | "append" | "rebuild";
  status: "PENDING" | "ASSEMBLING";
  new_dataset_name: string | null;
  target_dataset_session_id: string | null;
}

/** One map-processing job (sdg_jobs), as the UI needs it. */
export type ProcessingJob = {
  id: string;
  dataset_session_id: string | null;
  /** PENDING | RUNNING | FAILED | DONE | CANCELLED */
  status: string;
  /** Human-readable stage progress, e.g. "masking: dispatched (3 units)". Also
   *  carries a camera-fallback note when the requested camera wasn't present. */
  phase: string | null;
  units_total: number;
  requested_maps: string[];
  produced_maps: string[];
  /** Why it failed. The whole reason these routes exist — a failed job used to
   *  be indistinguishable from a slow one. */
  failure_reason: string | null;
  /** The ONE actionable line of failure_reason: reasons are container
   *  tracebacks, so the first line is a mid-traceback fragment while the
   *  exception message sits at the end. The backend extracts it; prefer this. */
  failure_headline: string | null;
  attempts: number | null;
  created_at: string | null;
  staged_at: string | null;
  updated_at: string | null;
};

/** GET /nori/datasets/processing/active — in-flight AND recently-failed
 *  map processing. Failures are included deliberately: map derivation runs for
 *  minutes to hours after the assemble modal closes, so a failure is otherwise
 *  invisible. Fail SOFT — absent on an older backend.
 *
 *  No `mine/` segment: the backend declares these on `mine_router`, but that
 *  router's prefix is plain `/datasets` (same as assemblies/active below). The
 *  variable name is not part of the URL. */
export function getActiveProcessing(
  baseUrl: string,
  fetcher: Fetcher
): Promise<{ processing: ProcessingJob[] }> {
  return noriRequest(baseUrl, fetcher, "/nori/datasets/processing/active", {
    action: "Load map-processing status",
  });
}

/** GET /nori/datasets/processing/{id} — poll one map-processing job. */
export function getProcessingJob(
  baseUrl: string,
  fetcher: Fetcher,
  sdgJobId: string
): Promise<ProcessingJob> {
  return noriRequest(baseUrl, fetcher, `/nori/datasets/processing/${sdgJobId}`, {
    action: "Poll map-processing job",
  });
}

/** GET /nori/datasets/assemblies/active — the caller's in-flight assembly jobs. */
export function getActiveAssemblies(baseUrl: string, fetcher: Fetcher): Promise<{ assemblies: ActiveAssembly[] }> {
  return noriRequest(baseUrl, fetcher, "/nori/datasets/assemblies/active", {
    action: "Load active assemblies",
  });
}

/** A dataset export job (package a cloud dataset -> downloadable tarball). Enqueued
 *  by exportDataset; poll getExportJob until DONE, then download_url is a live,
 *  short-lived presigned S3 URL (bytes stream straight from S3, not the backend). */
export interface ExportJob {
  export_job_id: string;
  status: "PENDING" | "EXPORTING" | "DONE" | "FAILED";
  /** Live presigned download URL — present only when DONE and not yet expired. */
  download_url: string | null;
  size_bytes: number | null;
  expires_at: string | null;
  failure_reason: string | null;
}

/** POST /nori/datasets/{id}/export — package this dataset for download. Idempotent:
 *  reuses a still-valid export instead of re-tarring. Returns the job to poll. */
export function exportDataset(
  baseUrl: string,
  fetcher: Fetcher,
  datasetSessionId: string,
  /** Extra derived-map layers to pack alongside the base dataset. [] = base
   *  only. The backend keys its export REUSE on this, so asking for more
   *  layers correctly builds a new tarball rather than handing back the old
   *  base-only one. */
  include: string[] = []
): Promise<ExportJob> {
  return noriRequest<ExportJob>(
    baseUrl,
    fetcher,
    `/nori/datasets/${encodeURIComponent(datasetSessionId)}/export`,
    { method: "POST", body: { include }, action: "Prepare dataset download" }
  );
}

/** GET /nori/datasets/export/{id} — poll one export job. */
export function getExportJob(baseUrl: string, fetcher: Fetcher, exportJobId: string): Promise<ExportJob> {
  return noriRequest<ExportJob>(
    baseUrl,
    fetcher,
    `/nori/datasets/export/${encodeURIComponent(exportJobId)}`,
    { action: "Check download status" }
  );
}

// ---- Bring-your-own-policy upload (Step 2) --------------------------------
/** start -> PUT the bundle tarball to put_url -> finalize -> poll getPolicyUpload
 *  until PROMOTED (result_job_id = the new deployable/downloadable policy) or FAILED. */
export interface PolicyUploadMeta {
  views?: string[];        // camera roles the policy expects (left_wrist/right_wrist/overhead)
  arm?: string | null;     // "left" | "right" | "both"
  fps?: number | null;
  instruction?: string | null;  // language policies (smolvla) need this
  title?: string | null;
}
export interface PolicyUploadStart {
  upload_id: string;
  put_url: string;
  expires_in: number;
}
export interface PolicyUploadSession {
  id: string;
  status: "PENDING_UPLOAD" | "FINALIZING" | "PROMOTED" | "FAILED";
  result_job_id: string | null;
  failure_reason: string | null;
}

/** POST /nori/marketplace/policies/upload/start — open a BYO-policy upload session and
 *  get a presigned PUT for the bundle tarball. */
export function startPolicyUpload(
  baseUrl: string,
  fetcher: Fetcher,
  meta: PolicyUploadMeta
): Promise<PolicyUploadStart> {
  return noriRequest<PolicyUploadStart>(
    baseUrl,
    fetcher,
    "/nori/marketplace/policies/upload/start",
    { method: "POST", body: meta, action: "Start policy upload" }
  );
}

/** PUT the bundle tarball STRAIGHT to S3 (never through the backend). Requires a bucket
 *  CORS rule allowing PUT + the SSE header from the app origin (see the backend
 *  storage/verify_aws_setup.py checklist) — not a noriRequest, a direct S3 fetch. */
export async function putPolicyBundle(putUrl: string, file: Blob): Promise<void> {
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: { "x-amz-server-side-encryption": "AES256" },
    body: file,
  });
  if (!res.ok) {
    throw new Error(
      `Upload to storage failed (HTTP ${res.status}). On the hosted site the storage ` +
        `bucket needs a CORS rule permitting browser uploads.`
    );
  }
}

/** POST /nori/marketplace/policies/upload/{id}/finalize — verify the bytes + enqueue gating. */
export function finalizePolicyUpload(
  baseUrl: string,
  fetcher: Fetcher,
  uploadId: string
): Promise<{ upload_id: string; status: string }> {
  return noriRequest<{ upload_id: string; status: string }>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/upload/${encodeURIComponent(uploadId)}/finalize`,
    { method: "POST", action: "Finalize policy upload" }
  );
}

/** GET /nori/marketplace/policies/upload/{id} — poll upload/gating/promotion. */
export function getPolicyUpload(
  baseUrl: string,
  fetcher: Fetcher,
  uploadId: string
): Promise<PolicyUploadSession> {
  return noriRequest<PolicyUploadSession>(
    baseUrl,
    fetcher,
    `/nori/marketplace/policies/upload/${encodeURIComponent(uploadId)}`,
    { action: "Check policy upload status" }
  );
}

// ---- Browser-native dataset / recording upload (Step 3) -------------------
/** One manifest entry: the file's path RELATIVE to the dataset/bundle root + its size. */
export interface DatasetUploadEntry {
  path: string;
  size: number;
}
export interface DatasetUploadStart {
  session_id: string;
  uploads: { path: string; put_url: string }[];
  expires_at: string;
}
export interface UploadSessionRow {
  id: string;
  status: string;  // PENDING_UPLOAD | FINALIZING | PROMOTED | FAILED | ...
  failure_reason?: string | null;
  hf_path_prefix?: string | null;
}

/** POST /nori/datasets/upload/start — open a browser-native upload session for a
 *  LeRobot dataset ('lerobot') or a raw recording ('raw_bundle'); returns a presigned
 *  PUT per file. Provenance is stamped 'uploaded' (customer JWT) → not publishable. */
export function startDatasetUpload(
  baseUrl: string,
  fetcher: Fetcher,
  args: {
    manifest: DatasetUploadEntry[];
    kind: "lerobot" | "raw_bundle";
    label?: string | null;
    commit_message?: string | null;
  }
): Promise<DatasetUploadStart> {
  return noriUploadRequest<DatasetUploadStart>(
    baseUrl,
    fetcher,
    "/nori/datasets/upload/start",
    {
      method: "POST",
      body: {
        manifest: args.manifest,
        kind: args.kind,
        label: args.label ?? null,
        commit_message: args.commit_message ?? null,
      },
      action: "Start upload",
    }
  );
}

/** POST /nori/datasets/upload/{id}/finalize — verify the uploaded files + promote. */
export function finalizeDatasetUpload(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string
): Promise<UploadSessionRow> {
  return noriUploadRequest<UploadSessionRow>(
    baseUrl,
    fetcher,
    `/nori/datasets/upload/${encodeURIComponent(sessionId)}/finalize`,
    { method: "POST", action: "Finalize upload" }
  );
}

/** GET /nori/datasets/upload/{id} — poll an upload session to terminal. */
export function getUploadSession(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string
): Promise<UploadSessionRow> {
  return noriUploadRequest<UploadSessionRow>(
    baseUrl,
    fetcher,
    `/nori/datasets/upload/${encodeURIComponent(sessionId)}`,
    { action: "Check upload status" }
  );
}

/** One recording session that contributed episodes to an assembled dataset —
 *  the unit you can filter by or bulk-delete. */
export interface DatasetProvenanceSession {
  session_key: string;
  recorded_at: string | null;
  task: string | null;
  episode_count: number;
  source_raw_session_id: string | null;
  created_at: string;
}

/** GET /nori/datasets/{id}/sessions — provenance sessions + the per-episode session
 *  map (`episode_sessions[i]` = episode i's source session_key, for the filter view). */
export function getDatasetSessions(
  baseUrl: string,
  fetcher: Fetcher,
  datasetSessionId: string
): Promise<{ sessions: DatasetProvenanceSession[]; episode_sessions: string[] }> {
  return noriRequest(baseUrl, fetcher, `/nori/datasets/${encodeURIComponent(datasetSessionId)}/sessions`, {
    action: "Load dataset sessions",
  });
}

/** DELETE /nori/datasets/{id}/sessions/{key} — bulk-delete a whole session's
 *  episodes. Enqueues a reindex-safe rebuild; returns the job to poll. */
export function deleteDatasetSession(
  baseUrl: string,
  fetcher: Fetcher,
  datasetSessionId: string,
  sessionKey: string
): Promise<{ assembly_job_id: string; status: string }> {
  return noriRequest(
    baseUrl,
    fetcher,
    `/nori/datasets/${encodeURIComponent(datasetSessionId)}/sessions/${encodeURIComponent(sessionKey)}`,
    { method: "DELETE", action: "Delete session" }
  );
}

/** POST /nori/datasets/{id}/delete-episodes — delete individual episodes by index.
 *  Enqueues a reindex-safe rebuild; returns the job to poll. */
export function deleteDatasetEpisodes(
  baseUrl: string,
  fetcher: Fetcher,
  datasetSessionId: string,
  episodeIndices: number[]
): Promise<{ assembly_job_id: string; status: string }> {
  return noriRequest(
    baseUrl,
    fetcher,
    `/nori/datasets/${encodeURIComponent(datasetSessionId)}/delete-episodes`,
    { method: "POST", body: { episode_indices: episodeIndices }, action: "Delete episodes" }
  );
}

/** DELETE /nori/datasets/{id} — permanently delete a dataset (HF files + record).
 * Owner-scoped; 409 if the dataset is published to the community. */
export function deleteDataset(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  alsoUnpublish = false
): Promise<{ deleted: boolean; session_id: string }> {
  const qs = alsoUnpublish ? "?also_unpublish=true" : "";
  return noriRequest(baseUrl, fetcher, `/nori/datasets/${encodeURIComponent(sessionId)}${qs}`, {
    method: "DELETE",
    action: "Delete dataset",
  });
}

/** POST /nori/datasets/{id}/lock — lock/unlock a dataset (locked = no rename/delete). */
export function setDatasetLock(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string,
  locked: boolean
): Promise<{ session_id: string; locked: boolean }> {
  return noriRequest(baseUrl, fetcher, `/nori/datasets/${encodeURIComponent(sessionId)}/lock`, {
    method: "POST",
    body: { locked },
    action: locked ? "Lock dataset" : "Unlock dataset",
  });
}

/** DELETE /nori/library/policies/{id} — delete a policy (checkpoint + record).
 * 409 if the policy is published, still training, or locked. */
export function deletePolicy(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  alsoUnpublish = false
): Promise<{ deleted: boolean; job_id: string }> {
  const qs = alsoUnpublish ? "?also_unpublish=true" : "";
  return noriRequest(baseUrl, fetcher, `/nori/library/policies/${encodeURIComponent(jobId)}${qs}`, {
    method: "DELETE",
    action: "Delete policy",
  });
}

/** POST /nori/library/policies/{id}/lock — lock/unlock a policy. */
export function setPolicyLock(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  locked: boolean
): Promise<{ job_id: string; locked: boolean }> {
  return noriRequest(baseUrl, fetcher, `/nori/library/policies/${encodeURIComponent(jobId)}/lock`, {
    method: "POST",
    body: { locked },
    action: locked ? "Lock policy" : "Unlock policy",
  });
}

export function getTrainingEstimateParams(
  baseUrl: string,
  fetcher: Fetcher
): Promise<TrainingEstimateParams> {
  return noriRequest<TrainingEstimateParams>(baseUrl, fetcher, "/nori/training/estimate-params", {
    action: "Load training estimate params",
  });
}

/** Safe pause of a running training job — the trainer checkpoints and the
 * job lands PAUSED (resumable) within ~a minute. 409 if already terminal. */
export function stopTrainingJob(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string
): Promise<{ stopping: boolean; detail: string }> {
  return noriRequest(baseUrl, fetcher, `/nori/training/jobs/${encodeURIComponent(jobId)}/stop`, {
    method: "POST",
    action: "Pause training",
  });
}

/** Resume a PAUSED job from its checkpoint. Config + dataset come from the
 * paused job; timeoutSeconds reserves the fresh segment's usage — a 402 here
 * means the monthly allowance can't cover it (surface it as an alert). */
export function resumeTrainingJob(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  timeoutSeconds = 900,
  /** New TOTAL step target — only for CONTINUING a COMPLETED policy (must exceed
   *  what it already trained). Omit to just finish a PAUSED job's original target. */
  steps?: number
): Promise<DispatchResponse> {
  return noriRequest<DispatchResponse>(baseUrl, fetcher, "/nori/training/dispatch", {
    method: "POST",
    body: {
      resume_from_job_id: jobId,
      timeout_seconds: timeoutSeconds,
      ...(steps !== undefined ? { steps } : {}),
    },
    action: steps !== undefined ? "Continue training" : "Resume training",
  });
}

export function startNoriTraining(
  baseUrl: string,
  fetcher: Fetcher,
  config: NoriTrainingConfig,
  timeoutSeconds = 900
): Promise<JobRecord> {
  return noriRequest<JobRecord>(baseUrl, fetcher, "/jobs/training", {
    method: "POST",
    body: {
      config,
      target: { runner: "nori_cloud", timeout_seconds: timeoutSeconds },
    },
    action: "Start training",
  });
}

export function listJobs(baseUrl: string, fetcher: Fetcher): Promise<TrainingJob[]> {
  return noriRequest<TrainingJob[]>(baseUrl, fetcher, "/nori/training/jobs", {
    action: "Load training jobs",
  });
}

/** Cameras + arms recorded in a dataset — populates the scope picker so it only
 *  offers what was actually recorded. `datasetRef` omitted => the latest upload. */
export interface DatasetScopeOptions {
  cameras: string[];
  arms: string[];
  joints: string[];
}
export function getDatasetScopeOptions(
  baseUrl: string,
  fetcher: Fetcher,
  datasetRef?: string
): Promise<DatasetScopeOptions> {
  const q = datasetRef ? `?dataset_ref=${encodeURIComponent(datasetRef)}` : "";
  return noriRequest<DatasetScopeOptions>(
    baseUrl,
    fetcher,
    `/nori/training/dataset-features${q}`,
    { action: "Load dataset scope options" }
  );
}

/** One of Nori's published open datasets (GET /nori/marketplace/datasets/public). */
export interface PublicDataset {
  id: string;
  title: string;
  description: string | null;
  hf_repo: string;
  license: string | null;
}

export function listPublicDatasets(baseUrl: string, fetcher: Fetcher): Promise<PublicDataset[]> {
  return noriRequest<PublicDataset[]>(baseUrl, fetcher, "/nori/marketplace/datasets/public", {
    action: "Load open datasets",
  });
}

/** One of the customer's promoted datasets (training dataset_ref picker).
 * `source` is "upload" for the customer's own promoted uploads, or "community"
 * for a dataset acquired from the marketplace (dataset_ref = "community:<id>"). */
export interface MyDataset {
  dataset_ref: string;
  label: string;
  created_at: string;
  session_id: string;
  source?: string;
  /** Summary shown under the training dataset picker. Null for community
   * datasets and for uploads promoted before count capture landed. */
  episode_count?: number | null;
  frame_count?: number | null;
}

/** GET /nori/datasets/mine — the caller's promoted datasets, newest first. */
export function listMyDatasets(baseUrl: string, fetcher: Fetcher): Promise<MyDataset[]> {
  return noriRequest<MyDataset[]>(baseUrl, fetcher, "/nori/datasets/mine", {
    action: "Load datasets",
  });
}

/** Short-lived coturn TURN credentials, minted per session (backend §2.4). Drop
 * straight into RTCPeerConnection.iceServers; re-fetch after `ttl` seconds. */
export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
  // Pentest V1: present only when robot_serial + dtls_fp were supplied AND the caller owns the
  // robot. `grant` is the ES256 robot-session grant bound to that DTLS fingerprint; `grant_exp`
  // is its unix expiry (short — the client re-mints within the session). Absent on anonymous /
  // legacy fetches, so the caller must treat them as optional.
  grant?: string;
  grant_exp?: number;
}

/** GET /nori/turn/credentials — mint short-lived coturn creds for this session.
 * Direct-backend mode maps to /api/v1/turn/credentials. Requires auth.
 * When `bind` is supplied (robot serial + this peer's DTLS fingerprint), the response also
 * carries a robot-session grant bound to that fingerprint (pentest V1). */
export function getTurnCredentials(
  baseUrl: string,
  fetcher: Fetcher,
  bind?: { robotSerial: string; dtlsFp: string },
): Promise<TurnCredentials> {
  const qs = bind
    ? "?" +
      new URLSearchParams({ robot_serial: bind.robotSerial, dtls_fp: bind.dtlsFp }).toString()
    : "";
  return noriRequest<TurnCredentials>(baseUrl, fetcher, `/nori/turn/credentials${qs}`, {
    action: "Fetch TURN credentials",
  });
}

export function getJob(baseUrl: string, fetcher: Fetcher, jobId: string): Promise<TrainingJob> {
  return noriRequest<TrainingJob>(
    baseUrl,
    fetcher,
    `/nori/training/jobs/${encodeURIComponent(jobId)}`,
    { action: "Load training job" }
  );
}

/** GET /nori/training/jobs/{id}/logs?since= — poll ~2s; stop when is_terminal.
 * `tail` (only honored on a fresh read, since=0) returns just the last N lines
 * but reports the true end as next_offset, so a reload seeds cheaply and then
 * streams only new lines. Omit tail (or pass since>0) for the full log. */
export function getJobLogs(
  baseUrl: string,
  fetcher: Fetcher,
  jobId: string,
  since = 0,
  tail?: number
): Promise<TrainingJobLogs> {
  const q = `since=${since}${tail != null ? `&tail=${tail}` : ""}`;
  return noriRequest<TrainingJobLogs>(
    baseUrl,
    fetcher,
    `/nori/training/jobs/${encodeURIComponent(jobId)}/logs?${q}`,
    { action: "Load training logs" }
  );
}

// -- pairing / consents / deletion (Phase 6) -----------------------------------

/** POST /nori/customers/me/pair — pair a robot (multi-robot). First robot becomes
 * active; later ones are added inactive. Idempotent on a serial you already own;
 * 409 only if the serial is owned by another customer. Returns the updated profile. */
export function pairRobot(
  baseUrl: string,
  fetcher: Fetcher,
  robotSerialNumber: string,
  pairCode?: string,
  nickname?: string
): Promise<CustomerProfile> {
  return noriRequest<CustomerProfile>(baseUrl, fetcher, "/nori/customers/me/pair", {
    method: "POST",
    // pair_code is the proof-of-possession code on the box (backend migration 029).
    // Sent only when provided; the backend requires it to claim a provisioned robot
    // and ignores it for legacy/un-provisioned serials.
    //
    // nickname is the customer's friendly name for the robot, shown on the home card
    // and (once set) editable on the robot's own kiosk — one column, so both surfaces
    // agree. Optional: omitted leaves it null. On re-pairing a robot already owned, the
    // backend's claim path only writes a nickname when one is supplied, so leaving this
    // blank never clobbers a name already set at the kiosk.
    body: {
      robot_serial_number: robotSerialNumber,
      ...(pairCode ? { pair_code: pairCode } : {}),
      ...(nickname ? { nickname } : {}),
    },
    action: "Pair robot",
  });
}

/**
 * One robot paired to the customer, as returned by `GET /customers/me/robots`
 * (multi-robot; live in Nori-Backend as of 2026-07-06). The Pairing page still
 * keeps a profile-derived single-robot fallback for resilience if that call fails.
 */
export interface PairedRobot {
  robot_serial_number: string;
  nickname?: string | null;
  paired_at?: string | null;
  /** True for the robot teleop/remote currently targets. */
  is_active?: boolean;
}

/** GET /nori/customers/me/robots — all robots paired to the customer (multi-robot). */
export function listRobots(baseUrl: string, fetcher: Fetcher): Promise<PairedRobot[]> {
  return noriRequest<PairedRobot[]>(baseUrl, fetcher, "/nori/customers/me/robots", {
    action: "Load robots",
  });
}

/**
 * POST /nori/customers/me/unpair — detach a robot. Pass the serial to unpair a specific
 * robot (multi-robot); omit to unpair the sole/active robot. Idempotent if already gone.
 */
export function unpairRobot(
  baseUrl: string,
  fetcher: Fetcher,
  robotSerialNumber?: string
): Promise<CustomerProfile> {
  return noriRequest<CustomerProfile>(baseUrl, fetcher, "/nori/customers/me/unpair", {
    method: "POST",
    body: robotSerialNumber ? { robot_serial_number: robotSerialNumber } : undefined,
    action: "Unpair robot",
  });
}

/**
 * POST /nori/customers/me/robots/{serial}/select — set which paired robot is active
 * (the one teleop/remote connects to). Returns the updated profile.
 */
export function selectRobot(
  baseUrl: string,
  fetcher: Fetcher,
  robotSerialNumber: string
): Promise<CustomerProfile> {
  return noriRequest<CustomerProfile>(
    baseUrl,
    fetcher,
    `/nori/customers/me/robots/${encodeURIComponent(robotSerialNumber)}/select`,
    { method: "POST", action: "Select robot" }
  );
}

/**
 * PATCH /nori/customers/me/robots/{serial} — set (or clear) a paired robot's nickname.
 * Pass an empty string to clear. Last-write-wins against a rename made on the robot's
 * own kiosk, which writes the same column. Returns the updated robot.
 */
export function renameRobot(
  baseUrl: string,
  fetcher: Fetcher,
  robotSerialNumber: string,
  nickname: string
): Promise<PairedRobot> {
  return noriRequest<PairedRobot>(
    baseUrl,
    fetcher,
    `/nori/customers/me/robots/${encodeURIComponent(robotSerialNumber)}`,
    { method: "PATCH", body: { nickname }, action: "Rename robot" }
  );
}

export function listConsents(baseUrl: string, fetcher: Fetcher): Promise<Consent[]> {
  return noriRequest<Consent[]>(baseUrl, fetcher, "/nori/consents", {
    action: "Load consents",
  });
}

export function grantConsent(
  baseUrl: string,
  fetcher: Fetcher,
  consentType: ConsentType
): Promise<Consent> {
  return noriRequest<Consent>(baseUrl, fetcher, "/nori/consents", {
    method: "POST",
    body: { consent_type: consentType, policy_version: CONSENT_POLICY_VERSION },
    action: "Grant consent",
  });
}

export function revokeConsent(
  baseUrl: string,
  fetcher: Fetcher,
  consentId: string,
  reason?: string
): Promise<Consent> {
  return noriRequest<Consent>(
    baseUrl,
    fetcher,
    `/nori/consents/${encodeURIComponent(consentId)}/revoke`,
    { method: "POST", body: { reason }, action: "Revoke consent" }
  );
}

export function createDeletionRequest(
  baseUrl: string,
  fetcher: Fetcher,
  requestScope: DeletionScope,
  notes?: string
): Promise<DeletionRequest> {
  return noriRequest<DeletionRequest>(baseUrl, fetcher, "/nori/deletion-requests", {
    method: "POST",
    body: { request_scope: requestScope, notes },
    action: "Request deletion",
  });
}

/**
 * Billing summary (backend Phase 1 — prepaid tiers: free / pro $20/mo / developer).
 * Monthly fields are null until backend migration 013 is applied; the Account page
 * falls back to profile-derived numbers when this endpoint is unavailable.
 */
export interface BillingSummary {
  billing_tier: string;
  /** 0 for free, 20 for pro, null for developer (negotiated). */
  tier_price_usd_per_month: number | null;
  compute: {
    allowed_seconds_per_month: number;
    consumed_seconds_this_month: number;
    reserved_seconds_this_month: number;
    remaining_seconds_this_month: number;
  };
  agent_tokens: {
    used_today: number;
    allowed_today: number;
    soft_warn_threshold: number;
    used_this_month: number | null;
    allowed_per_month: number | null;
    hard_capped: boolean;
  };
  /** Route-level clamps for this tier; null = none (pro/developer today). */
  limits: {
    max_job_timeout_seconds: number;
    max_concurrent_jobs: number;
    max_robots: number;
  } | null;
}

/** GET /nori/billing/summary — tier + monthly compute + agent-token budgets. */
export function getBillingSummary(baseUrl: string, fetcher: Fetcher): Promise<BillingSummary> {
  return noriRequest<BillingSummary>(baseUrl, fetcher, "/nori/billing/summary", {
    action: "Load billing summary",
  });
}

// -- robot-direct cloud inference (P2 shadow slice) ----------------------------
// Start a rollout that runs ROBOT-DIRECT on Modal (no laptop in the loop): the
// backend spawns the serve container and the robot's own agent fetches the
// grant and connects. Unlike CloudDeploySection (laptop-hosted cloud loop),
// nothing runs on this browser — it only triggers + watches the session.
export interface InferenceSession {
  session_id: string;
  status: "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" | "STOPPED" | "EXPIRED";
  robot_serial: string;
  policy_kind: string;
  instruction?: string | null;
  created_at?: string | null;
  ended_at?: string | null;
  failure_reason?: string | null;
}

export interface StartInferenceRequest {
  robot_serial: string;
  policy_kind?: string;
  instruction?: string;
  views?: string[];
  arm?: "left" | "right" | "both" | null;
  job_id?: string | null;
}

/** POST /nori/inference/sessions — start a robot-direct cloud rollout. */
export function startInferenceSession(
  baseUrl: string,
  fetcher: Fetcher,
  body: StartInferenceRequest
): Promise<InferenceSession> {
  return noriRequest<InferenceSession>(baseUrl, fetcher, "/nori/inference/sessions", {
    method: "POST",
    body,
    action: "Start cloud rollout",
  });
}

/** GET /nori/inference/sessions/{id} — poll session status. */
export function getInferenceSession(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string
): Promise<InferenceSession> {
  return noriRequest<InferenceSession>(
    baseUrl,
    fetcher,
    `/nori/inference/sessions/${sessionId}`,
    { action: "Load cloud rollout status" }
  );
}

/** POST /nori/inference/sessions/{id}/stop — stop a running rollout. */
export function stopInferenceSession(
  baseUrl: string,
  fetcher: Fetcher,
  sessionId: string
): Promise<InferenceSession> {
  return noriRequest<InferenceSession>(
    baseUrl,
    fetcher,
    `/nori/inference/sessions/${sessionId}/stop`,
    { method: "POST", action: "Stop cloud rollout" }
  );
}
