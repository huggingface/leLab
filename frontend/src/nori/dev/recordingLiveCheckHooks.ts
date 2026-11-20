/** Real 0000 recording through an SSH-only ROS bridge and local backend adapter.
 * No mock recording replies, motion authority, production auth or cloud writes.
 */
import { useSyncExternalStore } from "react";
import { RemoteTeleop, type RecordState } from "@nori/sdk";
import { createLoopbackSignaling } from "@nori/sdk/mock";
import { getRobotRecordings, settleBackendRouting, type RawBundleEntry } from "@/nori/api/client";
import { listRecordingEpisodes } from "@/nori/remote/episodeReview";
import { settleSupabaseGate } from "@/nori/auth/supabase";
import { requestRecordingBridge } from "./recordingBridgeResponse";

settleBackendRouting();
settleSupabaseGate();
let state: RecordState | null = null;
type Health = { camera_frames?: number; camera_role?: string; recorder_ready?: boolean; review_ready?: boolean; error?: string; backendError?: string };
let health: Health = {};
let recordings: Array<RawBundleEntry & { name?: string }> = [];
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const canvas = document.createElement("canvas");
canvas.width = 640; canvas.height = 360;
const context = canvas.getContext("2d")!;
let loading = false;
setInterval(() => {
  if (loading) return;
  loading = true;
  const image = new Image();
  image.onload = () => {
    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    }
    context.drawImage(image, 0, 0); loading = false;
  };
  image.onerror = () => { loading = false; };
  image.src = `/issue51-robot/camera.jpg?t=${Date.now()}`;
}, 250);
export const liveStream = canvas.captureStream(5);
const teleop = new RemoteTeleop({
  signaling: createLoopbackSignaling().transport,
  stun: "", turnUrls: [], turnUser: "", turnCred: "", forceRelay: false,
  arm: "right", onLog: () => {}, onConnState: () => {}, onTelemetry: () => {},
  onMode: () => {}, onControlActive: () => {},
  onRecord: (next) => { state = next; emit(); },
});
const wire = teleop as unknown as { dcSend: (frame: Record<string, unknown>) => boolean;
  ingestRecordStatus: (frame: Record<string, unknown>) => void };
wire.dcSend = (frame) => {
  if (frame.type !== "record") return false;
  void requestRecordingBridge<unknown>("/issue51-robot/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(frame) })
    .then((replies) => {
      if (!Array.isArray(replies)) throw new Error("0000 returned an invalid recording reply");
      for (const reply of replies) wire.ingestRecordStatus(reply);
    }).catch((error) => {
      health = { ...health, recorder_ready: false, review_ready: false, error: String(error) };
      wire.ingestRecordStatus({ type: "record_status", request_id: frame.request_id,
        ok: false, recording: state?.recording === true,
        error: `${String(error)} Refresh recording state before retrying; the last request may have reached the robot.` });
      emit();
    });
  return true;
};
teleop.videoStream = () => liveStream;
const fetchWithHeaders = (url: string, options?: RequestInit) => fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
export const useApi = () => ({ baseUrl: location.origin, fetchWithHeaders });

let refreshing = false;
async function loadRecordings() {
    const result = await getRobotRecordings(location.origin, fetchWithHeaders);
    return Promise.all(result.bundles.map(async (bundle) => {
      if (bundle.status !== "PROMOTED") return bundle;
      const listing = await listRecordingEpisodes(location.origin, fetchWithHeaders, bundle.session_id);
      return { ...bundle, name: listing.episodes[0]?.name };
    }));
}
export async function refreshLiveResults() {
  if (refreshing) return;
  refreshing = true;
  const [robot, saved] = await Promise.allSettled([
    requestRecordingBridge<Health>("/issue51-robot/status"), loadRecordings(),
  ]);
  health = robot.status === "fulfilled" ? robot.value : {
    ...health, recorder_ready: false, review_ready: false, camera_frames: 0,
    error: String(robot.reason),
  };
  if (saved.status === "fulfilled") {
    recordings = saved.value;
    delete health.backendError;
  } else health.backendError = "Saved test recordings are temporarily unavailable. Retrying…";
  refreshing = false;
  emit();
}
void refreshLiveResults();
setInterval(() => void refreshLiveResults(), 1500);

export function useTeleopSession() {
  const recordState = useSyncExternalStore(subscribe, () => state);
  const status = useSyncExternalStore(subscribe, () => health);
  const ready = !!(status.recorder_ready && status.review_ready && status.camera_frames);
  return { teleop, running: ready, connState: ready ? "connected" : "connecting", controlActive: ready, recordState };
}
export function useLiveHealth() { return useSyncExternalStore(subscribe, () => health); }
export function useLiveRecordings() { return useSyncExternalStore(subscribe, () => recordings); }
