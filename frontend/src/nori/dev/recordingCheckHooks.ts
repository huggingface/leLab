/** Local-only browser fixture. Never connects to a robot, backend or account. */
import { useSyncExternalStore } from "react";
import { RemoteTeleop, type RecordState } from "@nori/sdk";
import { MockDaemonSim, createLoopbackSignaling } from "@nori/sdk/mock";
import { settleBackendRouting, type RawBundleEntry } from "@/nori/api/client";
import { settleSupabaseGate } from "@/nori/auth/supabase";

settleBackendRouting();
settleSupabaseGate();
const STORE = "nori.recordingCheck.fixtures.v1";
type Fixture = RawBundleEntry & { name?: string };
let fixtures: Fixture[] = JSON.parse(localStorage.getItem(STORE) || "[]");
let state: RecordState | null = null;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const session = crypto.randomUUID().slice(0, 8);
const sim = new MockDaemonSim({ recordingPrefix: session, recordingEpochMs: Date.now() - performance.now() });
let copied = 0;

const canvas = document.createElement("canvas");
canvas.width = 640; canvas.height = 360;
const ctx = canvas.getContext("2d")!;
setInterval(() => {
  ctx.fillStyle = "#e8e8d9"; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "#23372c"; ctx.font = "24px sans-serif";
  ctx.fillText("Simulated camera · naming check", 30, 65);
  ctx.fillStyle = "#e9b78e"; ctx.fillRect(280 + Math.sin(Date.now() / 700) * 80, 140, 70, 70);
}, 80);
const stream = canvas.captureStream(12);
const teleop = new RemoteTeleop({
  signaling: createLoopbackSignaling().transport,
  stun: "", turnUrls: [], turnUser: "", turnCred: "", forceRelay: false,
  arm: "right", onLog: () => {}, onConnState: () => {}, onTelemetry: () => {},
  onMode: () => {}, onControlActive: () => {},
  onRecord: (next) => { state = next; emit(); },
});
// Exercise the real SDK request correlation with the pure protocol simulator.
const wire = teleop as unknown as {
  dcSend: (frame: Record<string, unknown>) => boolean;
  ingestRecordStatus: (frame: Record<string, unknown>) => void;
};
wire.dcSend = (frame) => {
  const replies = sim.handleFrame(frame, performance.now());
  queueMicrotask(() => {
    for (const reply of replies) wire.ingestRecordStatus(reply);
    while (copied < sim.keptRecordings.length) {
      const metadata = sim.keptRecordings[copied++];
      const shortGroup = metadata.collection_id.replace(/-/g, "").slice(0, 8);
      const take = metadata.episode_id;
      fixtures = [...fixtures, {
        session_id: `${session}-${take}`, label: metadata.task.slice(0, 120),
        recording_metadata: { ...metadata, display_name: `Group ${shortGroup} · ${metadata.task.slice(0, 60)} · ${take}`, outcome: metadata.outcome as "success" | "failure" },
        status: "PROMOTED", hf_path_prefix: "mock", episode_count: 1, frame_count: 24,
        created_at: metadata.recorded_at, finalized_at: metadata.recorded_at,
        local_deleted_at: metadata.recorded_at, failure_reason: null,
      }];
      localStorage.setItem(STORE, JSON.stringify(fixtures));
    }
    emit();
  });
  return true;
};
teleop.videoStream = () => stream;

export function useTeleopSession() {
  const recordState = useSyncExternalStore(subscribe, () => state);
  return { teleop, running: true, connState: "connected", controlActive: true, recordState };
}

const fetchWithHeaders = async (url: string, options: RequestInit = {}) => {
  const path = new URL(url, location.origin).pathname;
  if (path.endsWith("/raw-bundles")) return Response.json({ bundles: fixtures, on_robot_pending: 0 });
  const match = path.match(/\/recordings\/([^/]+)\/(episodes|episode\/0\/name)$/);
  const row = fixtures.find((fixture) => fixture.session_id === decodeURIComponent(match?.[1] ?? ""));
  if (!match || !row) return Response.json({ detail: "Unknown fixture route" }, { status: 404 });
  if (options.method === "PATCH") {
    row.name = JSON.parse(String(options.body)).name;
    fixtures = [...fixtures];
    localStorage.setItem(STORE, JSON.stringify(fixtures)); emit();
    return Response.json({ index: 0, name: row.name });
  }
  return Response.json({ cameras: ["overhead"], token: "mock", token_exp: 0, episodes: [{
    index: 0, episode_id: row.recording_metadata?.episode_id, task: row.recording_metadata?.task,
    name: row.name || "", length: 24, duration_s: 2,
  }] });
};
export const useApi = () => ({ baseUrl: location.origin, fetchWithHeaders });
export function useFixtureRecordings() { return useSyncExternalStore(subscribe, () => fixtures); }
export function resetFixtures() { localStorage.removeItem(STORE); fixtures = []; emit(); }
