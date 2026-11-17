// "Record training dataset" card on the Remote page (W2.11).
//
// Supporting robots hold app takes for acknowledged review. Older robots keep
// the legacy recording flow; review there cannot guarantee robot-side deletion.
// The browser preview is ephemeral and is never the dataset.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordState, PendingEpisodeReview } from "@nori/sdk";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/contexts/ApiContext";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { EphemeralEpisodeRecorder } from "@/nori/remote/episodePreview";
import {
  addPendingNames,
  applyPendingNames,
  pendingNameCount,
} from "@/nori/remote/pendingEpisodeNames";

const STEREO_PREF_KEY = "nori.datasetCapture.stereo";

type RecordingMode = "legacy" | "review";
type Capture = { mode: "legacy"; episodeId?: never } | { mode: "review"; episodeId: string };
type Phase =
  | { kind: "idle" }                              // no session
  | { kind: "session" }                           // session open, between episodes
  | ({ kind: "recording" } & Capture)
  | ({ kind: "review"; url: string | null; decision?: "keep" | "reject" } & Capture);

// defaultOpen: start expanded — for layouts that already put the card behind
// their own drawer/tab, where a second collapsed header inside reads as broken.
export function DatasetCaptureCard({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { teleop, running, connState, controlActive, recordState } = useTeleopSession();
  const { baseUrl, fetchWithHeaders } = useApi();
  const connected = running && connState === "connected" && controlActive;

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [task, setTask] = useState("");
  // "Enforce stereo view": session-scoped robot-side setting — the robot
  // records the front + overhead cameras at one matched frame rate so their
  // frames pair into a stereo view. Chosen BEFORE a session starts (recording
  // parameters are fixed at session_start) and persisted as an operator
  // preference. The robot echoes `stereo` in record_status while enforcing,
  // which is what the status line reports — so a robot that predates the
  // stereo vocabulary shows nothing rather than a false promise.
  const [stereo, setStereo] = useState<boolean>(
    () => localStorage.getItem(STEREO_PREF_KEY) === "1",
  );
  const setStereoPref = useCallback((on: boolean) => {
    setStereo(on);
    try {
      localStorage.setItem(STEREO_PREF_KEY, on ? "1" : "0");
    } catch {
      // Storage unavailable (private mode) — the toggle still works this visit.
    }
  }, []);
  const [busy, setBusy] = useState(false);        // start/stop round-trip in flight
  const [reviewBusy, setReviewBusy] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode | null>(null);
  const [pendingReviews, setPendingReviews] = useState<PendingEpisodeReview[]>([]);
  const [previewNote, setPreviewNote] = useState<string>("");   // why a preview was empty
  const [episodeCount, setEpisodeCount] = useState(0);   // kept episodes this session
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  // Record-time episode names. The recorder wire has no name field, so names
  // are held per kept episode and queued at Finish session; a background loop
  // applies them to the uploaded recording (pendingEpisodeNames.ts).
  const [nameDraft, setNameDraft] = useState("");
  const namesRef = useRef<string[]>([]);          // per kept episode, this session
  const sessionStartRef = useRef<string>("");     // ISO, session_start time
  const [pendingSessions, setPendingSessions] = useState(() => pendingNameCount());
  const [namesApplied, setNamesApplied] = useState(false);

  const recoveryRequestRef = useRef<Promise<RecordState> | null>(null);
  const previewRef = useRef<EphemeralEpisodeRecorder>(new EphemeralEpisodeRecorder());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const recording = phase.kind === "recording";
  const inSession = phase.kind !== "idle";
  const legacyRecording = phase.kind === "recording" || phase.kind === "review"
    ? phase.mode === "legacy" : recordingMode === "legacy";
  const reviewUnavailable = phase.kind === "review" && phase.mode === "review" && recordingMode !== "review";

  // Keep the controls visible whenever a session is open.
  useEffect(() => {
    if (phase.kind !== "idle") setOpen(true);
  }, [phase.kind]);

  // Revoke the review clip's object URL when we leave review / unmount.
  useEffect(() => {
    if (phase.kind !== "review" || !phase.url) return;
    const url = phase.url;
    return () => URL.revokeObjectURL(url);
  }, [phase]);

  // Drop any in-flight recording ONLY on unmount. This MUST NOT depend on
  // `phase`: a phase-scoped cleanup fires on every transition and would cancel
  // the recorder the instant Start episode sets phase→recording (that was the
  // empty-preview bug — the recorder was killed ~ms after it started).
  useEffect(() => {
    const preview = previewRef.current;
    return () => preview.cancel();
  }, []);

  const recoverReview = useCallback((status: RecordState) => {
    setRecordingMode(status.reviewSupported ? "review" : "legacy");
    // Never reinterpret an existing take on reconnect. A held modern take must
    // wait for review support; a legacy take cannot gain a review hold later.
    if (!status.reviewSupported) return;
    setPendingReviews(status.pendingReviews ?? []);
    const previous = phaseRef.current;
    if ((previous.kind === "recording" || previous.kind === "review") && previous.mode === "legacy") return;
    if (status.activeReviewEpisodeId) {
      const episodeId = status.activeReviewEpisodeId;
      setPhase({ kind: "recording", mode: "review", episodeId });
    } else if (status.pendingReviews?.length) {
      const pending = status.pendingReviews[0];
      setTask(pending.task);
      setPhase((previous) => previous.kind === "review" && previous.episodeId === pending.episodeId
        ? { ...previous, decision: pending.decision } : { kind: "review", mode: "review", episodeId: pending.episodeId, url: null, decision: pending.decision });
    }
  }, []);

  const discoverRecording = useCallback(async () => {
    if (!teleop) throw new Error("Recording connection unavailable");
    const status = await teleop.recordStatus();
    return status.reviewSupported ? teleop.recordConfirmed("review_status") : status;
  }, [teleop]);

  const refreshReview = useCallback(async () => {
    if (!teleop) return;
    setBusy(true);
    try {
      recoverReview(await discoverRecording());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [teleop, recoverReview, discoverRecording]);

  useEffect(() => {
    setRecordingMode(null);
    if (!connected || !teleop) { recoveryRequestRef.current = null; return; }
    let cancelled = false;
    // React StrictMode may replay this effect; share its in-flight probe.
    const request = recoveryRequestRef.current ?? discoverRecording();
    recoveryRequestRef.current = request;
    void request.then((status) => {
      if (!cancelled) { recoverReview(status); setError(null); }
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (recoveryRequestRef.current === request) recoveryRequestRef.current = null;
    });
    return () => { cancelled = true; };
  }, [connected, teleop, recoverReview, discoverRecording]);

  const startSession = useCallback(async () => {
    if (!teleop || busy || !recordingMode) return;
    setBusy(true);
    setError(null);
    try {
      if (recordingMode === "legacy") teleop.record("session_start", task.trim() || "teleop session", { stereo });
      else await teleop.recordConfirmed("session_start", { task: task.trim() || "teleop session", stereo });
      setEpisodeCount(0);
      namesRef.current = [];
      setNameDraft("");
      setNamesApplied(false);
      sessionStartRef.current = new Date().toISOString();
      setPhase({ kind: "session" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [teleop, busy, recordingMode, task, stereo]);

  const finishSession = useCallback(async () => {
    if (!teleop || busy || !recordingMode) return;
    setBusy(true);
    try {
      if (recordingMode === "legacy") teleop.record("session_end");
      else await teleop.recordConfirmed("session_end");
      addPendingNames({ startedAt: sessionStartRef.current,
        task: task.trim() || "teleop session", names: namesRef.current });
      setPendingSessions(pendingNameCount());
      setPhase({ kind: "idle" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [teleop, busy, recordingMode, task]);

  // Apply pending record-time names whenever some exist: once now, then every
  // 30 s while this page is open (the bundle uploads only after the robot goes
  // idle, so this routinely completes minutes after Finish session).
  useEffect(() => {
    if (pendingSessions === 0) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await applyPendingNames(baseUrl, fetchWithHeaders);
        if (stop) return;
        setPendingSessions(res.pending);
        if (res.applied > 0) setNamesApplied(true);
      } catch {
        // Backend unreachable — leave pending; next tick retries.
      }
    };
    void tick();
    const iv = window.setInterval(() => void tick(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, [pendingSessions, baseUrl, fetchWithHeaders]);

  const startEpisode = useCallback(async () => {
    if (!teleop || busy || !recordingMode) return;
    setBusy(true);
    setError(null);
    try {
      const stream = teleop.videoStream();
      if (!stream) throw new Error("no video stream — is video enabled?");
      previewRef.current.start(stream);
      if (recordingMode === "legacy") {
        teleop.record("episode_start", task.trim() || "teleop session", { stereo });
        setPhase({ kind: "recording", mode: "legacy" });
      } else {
        const status = await teleop.recordConfirmed("episode_start", {
          task: task.trim() || "teleop session", stereo, reviewRequired: true,
        });
        if (!status.episodeId) throw new Error("Robot did not return an episode ID; refresh recording state");
        setPhase({ kind: "recording", mode: "review", episodeId: status.episodeId });
      }
    } catch (e) {
      previewRef.current.cancel();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [teleop, busy, recordingMode, task, stereo]);

  const stopEpisode = useCallback(async () => {
    if (!teleop || busy || phase.kind !== "recording") return;
    setBusy(true);
    setError(null);
    try {
      const status = phase.mode === "legacy" ? (teleop.record("episode_stop"), null)
        : await teleop.recordConfirmed("episode_stop", { episodeId: phase.episodeId });
      if (status?.episodeRemoved) {
        previewRef.current.cancel();
        setPhase({ kind: "session" });
        setError("The episode contained no recorded data and was removed");
        return;
      }
      // A failed browser preview must never hide the review decision after a
      // successful robot stop. Recovered episodes have no browser preview.
      let blob: Blob | null = null;
      try { blob = await previewRef.current.stop(); }
      catch { previewRef.current.cancel(); }
      setPreviewNote(blob ? "" : previewRef.current.diagnostic);
      setPhase({ ...phase, kind: "review",
        url: blob ? URL.createObjectURL(blob) : null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [teleop, busy, phase]);

  const resolveReview = useCallback(async (decision: "keep" | "reject") => {
    if (!teleop || phase.kind !== "review" || reviewBusy || !recordingMode) return;
    if (phase.mode === "review" && recordingMode !== "review") return;
    setReviewBusy(true);
    setError(null);
    try {
      const status = phase.mode === "legacy" ? null : await teleop.recordConfirmed(
        decision === "keep" ? "episode_keep" : "episode_reject", { episodeId: phase.episodeId });
      if (phase.mode === "legacy" && decision === "reject") teleop.record("episode_discard");
      if (decision === "keep") {
        namesRef.current.push(nameDraft.trim());
        setEpisodeCount((n) => n + 1);
      }
      setNameDraft("");
      const remaining = phase.mode === "legacy" ? pendingReviews
        : status?.pendingReviews ?? pendingReviews.filter((p) => p.episodeId !== phase.episodeId);
      setPendingReviews(remaining);
      if (remaining.length) {
        const next = remaining[0];
        setTask(next.task);
        setPhase({ kind: "review", mode: "review", episodeId: next.episodeId, url: null, decision: next.decision });
      } else {
        setPhase({ kind: "session" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // If an operation reached disk but cleanup failed, only that same
      // decision can be retried; refresh also restores this after reconnect.
      const pending = teleop.recordState()?.pendingReviews?.find((p) => p.episodeId === phase.episodeId);
      if (pending?.decision) setPhase({ ...phase, decision: pending.decision });
      // Preserve the preview and ID until acknowledged.
    } finally {
      setReviewBusy(false);
    }
  }, [teleop, phase, reviewBusy, recordingMode, nameDraft, pendingReviews]);

  const keepEpisode = useCallback(() => resolveReview("keep"), [resolveReview]);
  const rejectEpisode = useCallback(() => resolveReview("reject"), [resolveReview]);

  // Robot recorder status line (record_status replies via onRecord).
  const robotLine = (() => {
    if (recordState === null) return "no reply yet";
    if (recordState.recording) {
      return `recording ${recordState.episode ?? ""}${
        recordState.stereo ? " · stereo enforced" : ""
      }${
        recordState.freeGb !== undefined ? ` · ${recordState.freeGb} GB free` : ""
      }`;
    }
    if (recordState.error) return `unavailable (${recordState.error})`;
    return "ready — a full-quality copy records with each episode";
  })();

  return (
    <div className={`rounded-md border border-nori-h14131a/10 bg-nori-hf3f1e8 px-4 pt-3 text-nori-h14131a shadow-sm ${open ? "pb-4" : "pb-3"}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex min-h-9 cursor-pointer items-center justify-between"
      >
        <h3 className="text-base font-semibold leading-none tracking-tight">
          Record training dataset
          {recording && (
            <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />
          )}
        </h3>
        <span className="flex items-center gap-3 text-sm font-normal text-muted-foreground">
          {inSession && (
            <span className="text-xs">
              {episodeCount} episode{episodeCount === 1 ? "" : "s"} kept
            </span>
          )}
          {open ? "▲ hide" : "▼ show"}
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {legacyRecording && (
            <p className="text-sm text-amber-900 dark:text-amber-300">
              Review unavailable on this robot. Stopped recordings may upload before you
              choose Keep or Reject. Reject may not delete the robot's copy.
            </p>
          )}
          {reviewUnavailable && connected && recordingMode === "legacy" && (
            <p className="text-sm text-amber-900 dark:text-amber-300">
              Review unavailable on this robot. This take is still held for review.
              Refresh when review is available again to Keep or Reject it.
            </p>
          )}
          {error && connected && (
            <Button variant="outline" size="sm" onClick={refreshReview} disabled={busy || reviewBusy}>
              Refresh recording state
            </Button>
          )}
          {/* ---- no session: choose a task and start ---- */}
          {phase.kind === "idle" && (
            <>
              <p className="text-sm leading-relaxed text-nori-h6f6858">
                Record demonstrations of a task: each episode is saved on Nori at full
                quality. Upload and discard behavior depends on the robot's recording support.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="h-9 flex-1 rounded-md border border-nori-h14131a/15 bg-white/70 dark:bg-white/10 px-3 text-sm"
                  placeholder="task for this session (e.g. pick up the red cube)"
                  maxLength={200}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                />
                <Button onClick={startSession} disabled={busy || !connected || !recordingMode || !task.trim()}>
                  Start session
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  id="stereo-capture-toggle"
                  checked={stereo}
                  onCheckedChange={setStereoPref}
                />
                <label
                  htmlFor="stereo-capture-toggle"
                  className="cursor-pointer text-sm text-nori-h14131a"
                >
                  Enforce stereo view
                </label>
                <span className="text-xs text-nori-h6f6858">
                  records the front + overhead cameras at one matched frame rate so
                  their frames pair into a stereo view
                </span>
              </div>
              {!connected && <p className="text-sm text-nori-h6f6858">connect to the robot first</p>}
            </>
          )}

          {/* ---- session open, between episodes ---- */}
          {phase.kind === "session" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-nori-h14131a">
                  Session: <span className="font-semibold">{task.trim() || "teleop session"}</span>
                  <span className="ml-2 text-nori-h6f6858">· {episodeCount} kept</span>
                  {stereo && (
                    <span className="ml-2 rounded-full border border-nori-h14131a/20 px-2 py-0.5 text-[11px] text-nori-h6f6858 align-middle">
                      stereo
                    </span>
                  )}
                </p>
                <Button size="sm" variant="ghost" onClick={finishSession} disabled={busy || !connected || !recordingMode}>
                  Finish session
                </Button>
              </div>
              {/* Name the NEXT take before starting it (stays editable while
                  recording and at review; Keep attaches it to that episode). */}
              <input
                type="text"
                value={nameDraft}
                maxLength={120}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={`name the next take (optional) — e.g. "recover from slip", "cell B3"`}
                className="w-full max-w-md rounded-md border border-nori-h14131a/15 bg-white/70 dark:bg-white/10 px-3 py-1.5 text-sm text-nori-h14131a placeholder:text-nori-h857b6b focus:outline-none focus:ring-1 focus:ring-nori-hb06a1c"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={startEpisode} disabled={busy || !connected || !recordingMode}>
                  {busy ? "Starting…" : "Start episode"}
                </Button>
                <span className="text-sm text-nori-h6f6858">
                  drive the robot through the task, then stop to review it
                </span>
              </div>
              <div className="rounded-md border border-amber-400/50 bg-amber-50/70 px-3 py-2 text-xs text-nori-h6f6858 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="font-semibold text-amber-900 dark:text-amber-300">
                  {legacyRecording ? "Legacy recording: stopped takes follow this robot's existing upload behavior."
                    : episodeCount > 0
                    ? `${episodeCount} episode${episodeCount === 1 ? "" : "s"} kept and eligible for upload.`
                    : "New episodes stay on Nori until you Keep or Reject them."}
                </p>
                <p className="mt-1">
                  {legacyRecording ? "Robot-side review and pending-review recovery are unavailable. "
                    : "Kept episodes upload when Nori is idle, including between takes. Pending reviews stay on Nori across disconnects. "}
                  Leave Nori powered on until recordings land in My Stuff.
                </p>
              </div>
            </>
          )}

          {/* ---- an episode is recording ---- */}
          {phase.kind === "recording" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void stopEpisode()} variant="destructive" disabled={busy || !connected}>
                  {busy ? "Stopping…" : "Stop episode"}
                </Button>
                <span className="text-sm text-nori-h6f6858">
                  recording episode {episodeCount + 1} of “{task.trim() || "teleop session"}”
                  {nameDraft.trim() && (
                    <>
                      {" "}· named <span className="font-medium text-nori-h14131a">{nameDraft.trim()}</span>
                    </>
                  )}
                </span>
              </div>
              <input
                type="text"
                value={nameDraft}
                maxLength={120}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="name this take (optional)"
                className="w-full max-w-md rounded-md border border-nori-h14131a/15 bg-white/70 dark:bg-white/10 px-3 py-1.5 text-sm text-nori-h14131a placeholder:text-nori-h857b6b focus:outline-none focus:ring-1 focus:ring-nori-hb06a1c"
              />
            </div>
          )}

          {/* ---- review the just-stopped episode ---- */}
          {phase.kind === "review" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-nori-h14131a">Keep this episode?</p>
              {phase.url ? (
                <video
                  key={phase.url}
                  src={phase.url}
                  className="w-full max-w-md rounded-md border border-nori-h14131a/15 bg-black"
                  controls
                  loop
                  autoPlay
                  muted
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm italic text-muted-foreground">
                    {phase.mode === "legacy"
                      ? "Preview unavailable — the robot may already have saved or uploaded this take."
                      : "Preview unavailable — the robot copy is held until you Keep or Reject it."}
                  </p>
                  {previewNote && (
                    <p className="font-mono text-[11px] text-muted-foreground/80">{previewNote}</p>
                  )}
                </div>
              )}
              <input
                type="text"
                value={nameDraft}
                maxLength={120}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={`name this take (optional) — e.g. "recover from slip", "cell B3"`}
                className="w-full max-w-md rounded-md border border-nori-h14131a/15 bg-white/70 dark:bg-white/10 px-3 py-1.5 text-sm text-nori-h14131a placeholder:text-nori-h857b6b focus:outline-none focus:ring-1 focus:ring-nori-hb06a1c"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={keepEpisode} disabled={busy || reviewBusy || !connected || !recordingMode || reviewUnavailable || phase.decision === "reject"}>
                  Keep
                </Button>
                <Button onClick={rejectEpisode} variant="destructive" disabled={busy || reviewBusy || !connected || !recordingMode || reviewUnavailable || phase.decision === "keep"}>
                  Reject
                </Button>
                <span className="text-xs text-nori-h6f6858">
                  {phase.mode === "legacy"
                    ? "Keep adds it to the session. Reject may not delete the robot's copy. "
                    : "Keep adds it to the session, Reject deletes the held take. "}The name shows up on the
                  episode in My Stuff (it never becomes the task).
                </span>
              </div>
            </div>
          )}

          {/* robot recorder status — always visible while a session is open */}
          {inSession && (
            <p className="text-xs text-nori-h6f6858">
              robot recorder:{" "}
              {recordState?.recording && (
                <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />
              )}
              {robotLine}
            </p>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {pendingSessions > 0 && (
            <p className="text-xs text-nori-h6f6858">
              episode names from {pendingSessions} session{pendingSessions === 1 ? "" : "s"} will be
              applied automatically when the recording uploads to My Stuff (keep this page open, or
              name them later in Review episodes).
            </p>
          )}
          {pendingSessions === 0 && namesApplied && (
            <p className="text-xs text-nori-h6f6858">✓ episode names applied to the uploaded recording.</p>
          )}
        </div>
      )}
    </div>
  );
}
