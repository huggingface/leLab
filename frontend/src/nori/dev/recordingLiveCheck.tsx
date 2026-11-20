import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { DatasetCaptureCard } from "@/nori/remote/DatasetCaptureCard";
import { groupRecordings, recordingOutcome, recordingName } from "@/nori/remote/recordingPresentation";
import { liveStream, useLiveHealth, useLiveRecordings } from "./recordingLiveCheckHooks";
import "@/index.css";

function LiveCheck() {
  const health = useLiveHealth();
  const recordings = useLiveRecordings();
  const groups = groupRecordings(recordings);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = liveStream; }, []);
  return <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nori Lab · 0000 live camera check</p>
      <h1 className="text-3xl font-bold">Real takes from NORI-A3-0000</h1>
      <p className="max-w-3xl text-muted-foreground">Real {health.camera_role || "robot"} camera, isolated ROS recorder and gateway recording logic. Uploads use the real backend handlers with local database and storage adapters. No motion or production cloud writes. Recording transport is an SSH-only HTTP bridge rather than WebRTC.</p>
      <p className="text-sm">Camera frames received: {health.camera_frames ?? 0} · Recorder {health.recorder_ready ? "ready" : "connecting"} · Review {health.review_ready ? "ready" : "connecting"}</p>
      {health.error && <p className="text-sm text-red-700">{health.error}</p>}
      {health.backendError && <p className="text-sm text-red-700">{health.backendError}</p>}
    </header>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="relative">
          <video ref={video} autoPlay playsInline muted className="w-full rounded-xl bg-black"><track kind="captions" /></video>
          {health.error && <p className="absolute inset-x-0 bottom-0 rounded-b-xl bg-black/80 p-3 text-sm text-white">Video disconnected. Waiting for 0000…</p>}
        </div>
        <DatasetCaptureCard defaultOpen />
      </div>
      <section aria-label="Real recording results" className="space-y-4">
        <h2 className="text-xl font-semibold">{recordings.length} real takes · {groups.length} groups</h2>
        <p className="text-sm text-muted-foreground">Camera-only test data. Kept takes upload locally; rejected takes never appear here. Results and custom names come from backend responses and survive reload.</p>
        {groups.map((group) => <article key={group.key} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">{group.label}</h3>
          {group.bundles.map((take) => <div key={take.session_id} className="space-y-1 border-t border-border pt-3">
            <p className="break-words text-sm font-medium">{recordingName(take)}</p>
            <p className="text-xs">{recordingOutcome(take)} · {take.status} · {take.frame_count ?? "pending"} captured frames</p>
            {recordings.find((row) => row.session_id === take.session_id)?.name && <p className="text-xs">Custom name: {recordings.find((row) => row.session_id === take.session_id)?.name}</p>}
          </div>)}
        </article>)}
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<LiveCheck />);
