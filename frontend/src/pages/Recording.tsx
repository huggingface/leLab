import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  MoreHorizontal,
  RotateCcw,
  Square,
  SkipForward,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  getMuted,
  setMuted as persistMuted,
  playRecordingStartCue,
  playResetStartCue,
  playAutoAdvanceWarning,
} from "@/lib/recordingAudio";
import { useApi } from "@/contexts/ApiContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RecordingConfig {
  leader_port: string;
  follower_port: string;
  leader_config: string;
  follower_config: string;
  dataset_repo_id: string;
  single_task: string;
  num_episodes: number;
  episode_time_s: number;
  reset_time_s: number;
  fps: number;
  video: boolean;
  push_to_hub: boolean;
  resume: boolean;
  streaming_encoding: boolean;
}

type Phase = "preparing" | "recording" | "resetting" | "completed";

interface BackendStatus {
  recording_active: boolean;
  current_phase: string;
  current_episode?: number;
  total_episodes?: number;
  saved_episodes?: number;
  phase_elapsed_seconds?: number;
  phase_time_limit_s?: number;
  session_elapsed_seconds?: number;
  session_ended?: boolean;
  dataset_repo_id?: string;
  error?: string;
  cameras?: string[]; // Names of the cameras configured for this session
  available_controls: {
    stop_recording: boolean;
    exit_early: boolean;
    rerecord_episode: boolean;
  };
}

const Recording = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, wsBaseUrl, fetchWithHeaders } = useApi();

  // Get recording config from navigation state
  const recordingConfig = location.state?.recordingConfig as RecordingConfig;

  // Backend status state - this is the single source of truth
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(
    null
  );
  const [recordingSessionStarted, setRecordingSessionStarted] = useState(false);

  const [optimisticPhase, setOptimisticPhase] = useState<Phase | null>(null);
  // Why the session hasn't come up yet, surfaced on the waiting screen: without
  // it a failing /recording-status just spins "Connecting..." forever.
  const [startupError, setStartupError] = useState<string | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => getMuted());
  const prevRealPhaseRef = useRef<Phase | null>(null);
  // Bumps on each re-record so the auto-advance warning re-fires for the same episode number.
  const [rerecordTick, setRerecordTick] = useState(0);
  const warningFiredForPhaseRef = useRef<{ phase: Phase | null; episode: number | null; tick: number }>({ phase: null, episode: null, tick: 0 });
  // Guards against React StrictMode double-invocation of the start effect.
  const startInitiatedRef = useRef(false);

  // --- Leaving the startup screen --------------------------------------------
  // Whether a server-side session might need stopping: null while
  // /start-recording is still in flight; false only once we have a clean,
  // parsed, HTTP-ok response saying it wasn't created; true otherwise —
  // including a network failure or an HTTP error status, neither of which
  // proves the request never reached the server (it may have started the
  // worker thread before the *response* was lost). Read by attemptLeave
  // (below), which is the one place allowed to turn this false, and only
  // after the backend itself confirms /stop-recording went through.
  const activeSessionRef = useRef<boolean | null>(null);
  // True once the user has asked to leave. Read by the status-poll effect so
  // a stray successful poll can't navigate to /upload out from under a leave
  // already in progress.
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // --- Camera preview layout -------------------------------------------------
  // Aspect ratio (width / height) of the configured cameras, used to size the
  // preview windows without letterboxing. Falls back to 4:3 if unknown.
  const cameraAspect = useMemo(() => {
    const cams = (recordingConfig as unknown as { cameras?: unknown })?.cameras;
    const list = Array.isArray(cams)
      ? cams
      : cams && typeof cams === "object"
      ? Object.values(cams as Record<string, unknown>)
      : [];
    const first = list[0] as { width?: number; height?: number } | undefined;
    if (first?.width && first?.height) return first.width / first.height;
    return 4 / 3;
  }, [recordingConfig]);

  // Measure the space left for the camera windows (via ResizeObserver, so it
  // re-fits on any viewport change) to size them as large as possible while
  // keeping the whole page within one screen (no scroll).
  const [cameraArea, setCameraArea] = useState({ w: 0, h: 0 });
  const cameraAreaObserver = useRef<ResizeObserver | null>(null);
  const cameraAreaRef = useCallback((node: HTMLDivElement | null) => {
    cameraAreaObserver.current?.disconnect();
    cameraAreaObserver.current = null;
    if (node) {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        setCameraArea({ w: r.width, h: r.height });
      });
      ro.observe(node);
      cameraAreaObserver.current = ro;
    }
  }, []);

  // Pick the column count and per-window pixel size that maximizes the video
  // area within the measured space, given the camera count and aspect ratio.
  const cameraCount = backendStatus?.cameras?.length ?? 0;
  const cameraWindow = useMemo(() => {
    const { w, h } = cameraArea;
    if (!cameraCount || w <= 0 || h <= 0) return { width: 0, height: 0 };
    const gap = 12; // matches the grid's gap-3
    let best = { width: 0, height: 0, area: -1 };
    for (let cols = 1; cols <= cameraCount; cols++) {
      const rows = Math.ceil(cameraCount / cols);
      const cellW = (w - gap * (cols - 1)) / cols;
      const cellH = (h - gap * (rows - 1)) / rows;
      if (cellW <= 0 || cellH <= 0) continue;
      const width = Math.min(cellW, cellH * cameraAspect);
      const height = width / cameraAspect;
      const area = width * height;
      if (area > best.area) best = { width, height, area };
    }
    return { width: Math.floor(best.width), height: Math.floor(best.height) };
  }, [cameraArea, cameraCount, cameraAspect]);

  const toggleMute = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      persistMuted(next);
      return next;
    });
  }, []);

  // Redirect if no config provided
  useEffect(() => {
    if (!recordingConfig) {
      toast({
        title: "No Configuration",
        description: "Please start recording from the main page.",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [recordingConfig, navigate, toast]);

  // Start recording session when component loads. The ref guard prevents
  // React StrictMode (and any future re-renders) from firing /start-recording
  // twice — the second call returns 409 and bounces the user home.
  useEffect(() => {
    if (recordingConfig && !startInitiatedRef.current) {
      startInitiatedRef.current = true;
      startRecordingSession();
    }
    // startRecordingSession is intentionally omitted: re-running this effect
    // on its identity change would re-fire /start-recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingConfig]);

  // Refs so the poll interval below stays stable and reads the latest values
  // without tearing itself down on every state change.
  const optimisticPhaseRef = useRef(optimisticPhase);
  optimisticPhaseRef.current = optimisticPhase;
  const rerecordTickRef = useRef(rerecordTick);
  rerecordTickRef.current = rerecordTick;

  // Poll backend status continuously to stay in sync
  useEffect(() => {
    if (!recordingSessionStarted) return;

    const pollStatus = async () => {
      // The user has asked to leave (via the startup screen's stop-and-leave
      // path below) — stop acting on status so a poll that happens to
      // succeed can't navigate to /upload out from under that leave.
      if (leavingRef.current) return;
      try {
        const response = await fetchWithHeaders(
          `${baseUrl}/recording-status`
        );
        if (!response.ok) {
          setStartupError(
            `The backend returned ${response.status} for /recording-status. Check the server log.`
          );
          return;
        }
        const status = await response.json();
        // Re-check: this request could have been in flight (already past the
        // guard above) when the user clicked "Back to Home" — don't let its
        // result repopulate the screen or navigate out from under that leave.
        if (leavingRef.current) return;
        setStartupError(null);
        setBackendStatus(status);

        const currentOptimistic = optimisticPhaseRef.current;
        if (currentOptimistic && status.current_phase === currentOptimistic) {
          setOptimisticPhase(null);
        }

        const real = status.current_phase as Phase;
        const prev = prevRealPhaseRef.current;
        if (prev !== real) {
          if (real === "recording" && prev !== null) {
            playRecordingStartCue();
          } else if (real === "resetting") {
            playResetStartCue();
          }
          prevRealPhaseRef.current = real;
          warningFiredForPhaseRef.current = { phase: null, episode: null, tick: 0 };
        }

        const elapsed = status.phase_elapsed_seconds || 0;
        const limit = status.phase_time_limit_s || 0;
        const inFinalThreeSeconds = limit > 3 && elapsed >= limit - 3;
        const ep = status.current_episode ?? null;
        const tick = rerecordTickRef.current;
        const warned = warningFiredForPhaseRef.current;
        if (
          inFinalThreeSeconds &&
          currentOptimistic === null &&
          (warned.phase !== real ||
            warned.episode !== ep ||
            warned.tick !== tick)
        ) {
          playAutoAdvanceWarning();
          warningFiredForPhaseRef.current = { phase: real, episode: ep, tick };
        }

        if (!status.recording_active && status.session_ended) {
          // A failure can land after episodes were already saved, so surface
          // the reason either way and only go home when nothing survived it.
          if (status.current_phase === "error") {
            const saved = status.saved_episodes || 0;
            toast({
              title: saved > 0 ? "Recording Interrupted" : "Recording Failed",
              description:
                saved > 0
                  ? `${saved} episode(s) were saved before the session failed: ${status.error || "unknown error"}`
                  : status.error || "The recording session failed to start.",
              variant: "destructive",
            });
            if (saved === 0) {
              navigate("/");
              return;
            }
          }
          const datasetInfo = {
            dataset_repo_id:
              status.dataset_repo_id || recordingConfig.dataset_repo_id,
            single_task: recordingConfig.single_task,
            num_episodes: recordingConfig.num_episodes,
            saved_episodes: status.saved_episodes || 0,
            session_elapsed_seconds: status.session_elapsed_seconds || 0,
          };
          navigate("/upload", { state: { datasetInfo } });
        }
      } catch (error) {
        console.error("Error polling recording status:", error);
        setStartupError(
          `Could not reach the backend: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    pollStatus();
    const statusInterval = setInterval(pollStatus, 1000);
    return () => clearInterval(statusInterval);
  }, [recordingSessionStarted, recordingConfig, navigate, baseUrl, fetchWithHeaders, toast]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Decide what leaving the startup screen actually requires, and do it.
  // Called both from the "Back to Home" click and — if that click landed
  // while /start-recording was still in flight — from that request's own
  // continuation once it knows whether a session exists. Retryable: a failed
  // /stop-recording leaves `leaving` false so the button can be clicked again.
  const attemptLeave = useCallback(async () => {
    setLeaveError(null);
    setLeaving(true);

    if (activeSessionRef.current === null) {
      // /start-recording hasn't resolved yet. Its own continuation calls
      // attemptLeave again once it knows whether a session was created —
      // nothing to do here but stay on the "stopping" state.
      return;
    }

    if (activeSessionRef.current === false) {
      // Only set on a clean, parsed, HTTP-ok response that explicitly says
      // no session was created — safe to leave immediately.
      navigate("/");
      return;
    }

    try {
      const response = await fetchWithHeaders(`${baseUrl}/stop-recording`, {
        method: "POST",
      });
      if (!response.ok) {
        // fetch only rejects on a network-level failure; an HTTP error status
        // (500, a proxy's 502/504) resolves normally and must be treated as a
        // failed stop too, not silently as one that succeeded.
        throw new Error(`Backend returned ${response.status} for /stop-recording`);
      }
      // A 200 here means the backend actually processed the request; `success:
      // false` in the body just means there was nothing left to stop (e.g. a
      // retry after it already did) — either way it's now safe to leave.
      await response.json().catch(() => null);
      activeSessionRef.current = false;
      navigate("/");
    } catch (error) {
      // The backend may be unreachable, or may not be — from here there's no
      // way to tell whether the session actually stopped. Don't navigate
      // away and lose the only control that can stop it: stay on this screen
      // so the user can retry, rather than leaving an unattended recording
      // session driving the arm with nothing left to shut it down.
      setLeaving(false);
      setLeaveError(
        "Could not confirm the session was stopped — it may still be recording. Try again."
      );
    }
  }, [baseUrl, fetchWithHeaders, navigate]);

  const handleLeaveStartup = useCallback(() => {
    if (leaving) return; // a stop attempt (or the pending start) is already in flight
    leavingRef.current = true;
    attemptLeave();
  }, [leaving, attemptLeave]);

  const startRecordingSession = async () => {
    let response: Response | null = null;
    let data: { success?: boolean; message?: string } | null = null;
    try {
      response = await fetchWithHeaders(`${baseUrl}/start-recording`, {
        method: "POST",
        body: JSON.stringify(recordingConfig),
      });
      data = await response.json();
    } catch (error) {
      // Network failure, or a response body that didn't parse. Left as null
      // and handled uniformly below as "uncertain" — neither case proves the
      // request never reached the server.
    }

    // /start-recording always answers HTTP 200 even when it fails (it never
    // raises; failure is only ever a `success: false` body), so response.ok
    // can't distinguish success from failure — and a rejected fetch doesn't
    // prove nothing happened either: the request may have reached the server
    // and started the worker thread before the *response* was lost in
    // transit. The only outcome that provably means "no session" is a clean,
    // parsed, HTTP-ok body that explicitly says so.
    const confirmedNotStarted = !!response?.ok && data?.success === false;
    activeSessionRef.current = !confirmedNotStarted;

    if (leavingRef.current) {
      // The user asked to leave while this request was in flight. attemptLeave
      // reads activeSessionRef: stops the session if it turns out to exist (or
      // might), navigates home directly only for the confirmed-clean case.
      attemptLeave();
      return;
    }

    if (data?.success) {
      setStartupError(null);
      setRecordingSessionStarted(true);
      toast({
        title: "Recording Started",
        description: `Started recording ${recordingConfig.num_episodes} episodes`,
      });
      return;
    }

    if (confirmedNotStarted) {
      toast({
        title: "Error Starting Recording",
        description: data?.message || "Failed to start recording session.",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    // Uncertain outcome (network error, or an unparseable/non-ok response):
    // a session may have been created with no status polling attached to it.
    // Don't guess "nothing to worry about" and drop straight home — route
    // through the same stop-then-leave path a manual cancel uses, so
    // /stop-recording gets sent before this screen gives up on it.
    toast({
      title: "Connection Error",
      description: "Could not confirm whether recording started. Making sure nothing was left running…",
      variant: "destructive",
    });
    leavingRef.current = true;
    attemptLeave();
  };

  const handleExitEarly = useCallback(async () => {
    if (!backendStatus?.available_controls.exit_early) return;
    if (optimisticPhase !== null) return;

    const realPhase = backendStatus.current_phase as Phase;
    const next: Phase | null =
      realPhase === "recording" ? "resetting" :
      realPhase === "resetting" ? "recording" : null;

    if (!next) return;

    setOptimisticPhase(next);

    try {
      const response = await fetchWithHeaders(
        `${baseUrl}/recording-exit-early`,
        { method: "POST" }
      );
      if (!response.ok) {
        const data = await response.json();
        setOptimisticPhase(null);
        toast({
          title: "Error",
          description: data.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      setOptimisticPhase(null);
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    }
  }, [backendStatus, optimisticPhase, baseUrl, fetchWithHeaders, toast]);

  const handleRerecordEpisode = useCallback(async () => {
    if (!backendStatus?.available_controls.rerecord_episode) return;

    try {
      const response = await fetchWithHeaders(
        `${baseUrl}/recording-rerecord-episode`,
        {
          method: "POST",
        }
      );
      const data = await response.json();

      if (response.ok) {
        setRerecordTick((t) => t + 1);
        toast({
          title: "Re-recording Episode",
          description: `Episode ${backendStatus.current_episode} will be re-recorded.`,
        });
      } else {
        toast({
          title: "Error",
          description: data.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    }
  }, [backendStatus, baseUrl, fetchWithHeaders, toast]);

  const handleStopRecording = useCallback(async () => {
    if (!backendStatus?.available_controls.stop_recording) return;
    try {
      await fetchWithHeaders(`${baseUrl}/stop-recording`, {
        method: "POST",
      });

      toast({
        title: "Stopping recording",
        description: "Finalizing dataset…",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to stop recording.",
        variant: "destructive",
      });
    }
  }, [backendStatus, baseUrl, fetchWithHeaders, toast]);

  const requestStopRecording = useCallback(() => {
    if (!backendStatus?.available_controls.stop_recording) return;
    setShowStopConfirm(true);
  }, [backendStatus]);

  const confirmStopRecording = useCallback(async () => {
    setShowStopConfirm(false);
    await handleStopRecording();
  }, [handleStopRecording]);

  // The top-left "Back to Home" link used to navigate away unconditionally,
  // leaving an active session's worker thread driving the arm with no UI
  // attached to it — the same bug as the startup screen's exit button, just
  // reachable once a session is fully up and running. Unlike that screen,
  // `backendStatus` here is already a confirmed live status (not a pending
  // guess), so there's no "unknown" state to wait out: either a session is
  // active and gets stopped first, or there isn't one and it's safe to leave.
  const [leavingSession, setLeavingSession] = useState(false);

  const handleBackToHome = useCallback(async () => {
    if (leavingSession) return;
    if (!backendStatus?.available_controls.stop_recording) {
      navigate("/");
      return;
    }
    setLeavingSession(true);
    try {
      const response = await fetchWithHeaders(`${baseUrl}/stop-recording`, {
        method: "POST",
      });
      if (!response.ok) {
        // fetch only rejects on a network-level failure; an HTTP error status
        // resolves normally and must be treated as a failed stop too.
        throw new Error(`Backend returned ${response.status} for /stop-recording`);
      }
      navigate("/");
    } catch (error) {
      // Backend unreachable — don't navigate away and lose the only
      // one-click control that can stop it; let the user retry, or fall
      // back to "Stop recording" in the ⋯ menu once the backend answers.
      setLeavingSession(false);
      toast({
        title: "Could not stop the session",
        description:
          "The robot may still be recording. Try again, or use Stop recording from the menu.",
        variant: "destructive",
      });
    }
  }, [leavingSession, backendStatus, baseUrl, fetchWithHeaders, navigate, toast]);

  const handlersRef = useRef({
    handleExitEarly,
    handleRerecordEpisode,
    requestStopRecording,
    showStopConfirm,
  });
  useEffect(() => {
    handlersRef.current = {
      handleExitEarly,
      handleRerecordEpisode,
      requestStopRecording,
      showStopConfirm,
    };
  });

  const sessionReady = recordingSessionStarted && backendStatus !== null;

  useEffect(() => {
    if (!sessionReady) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === " " || e.code === "Space" || e.key === "ArrowRight") {
        e.preventDefault();
        handlersRef.current.handleExitEarly();
      } else if (e.key === "ArrowLeft" || e.key === "Delete" || e.key === "Backspace") {
        // Delete reads as "throw this take away"; a Mac laptop's delete key
        // reports Backspace, so both are bound. preventDefault also stops
        // Backspace from navigating the browser back.
        e.preventDefault();
        handlersRef.current.handleRerecordEpisode();
      } else if (e.key === "Escape") {
        if (handlersRef.current.showStopConfirm) return;
        handlersRef.current.requestStopRecording();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionReady]);

  if (!recordingConfig) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg">No recording configuration found.</p>
          <Button onClick={() => navigate("/")} className="mt-4">
            Return to Home
          </Button>
        </div>
      </div>
    );
  }

  // Show loading state while waiting for backend status. The two messages are
  // distinct on purpose: they say which half of the startup is stuck.
  if (!backendStatus) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center max-w-lg px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
          <p className="text-lg">
            {leaving
              ? "Stopping session…"
              : recordingSessionStarted
              ? "Connecting to recording session..."
              : "Starting recording session..."}
          </p>
          {startupError && !leaving && (
            <p className="mt-4 text-sm text-red-400">{startupError}</p>
          )}
          {leaveError && (
            <p className="mt-4 text-sm text-red-400">{leaveError}</p>
          )}
          <Button
            onClick={handleLeaveStartup}
            disabled={leaving}
            variant="outline"
            className="mt-6 border-gray-600 text-gray-300 hover:text-white disabled:opacity-50"
          >
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const realPhase = backendStatus.current_phase as Phase;
  const currentPhase: Phase = optimisticPhase ?? realPhase;
  const currentEpisode = backendStatus.current_episode ?? 1;
  const totalEpisodes =
    backendStatus.total_episodes ?? recordingConfig.num_episodes;

  const phaseElapsedTime = optimisticPhase
    ? 0
    : backendStatus.phase_elapsed_seconds || 0;
  const phaseTimeLimit =
    currentPhase === "recording"
      ? recordingConfig.episode_time_s
      : currentPhase === "resetting"
      ? recordingConfig.reset_time_s
      : backendStatus.phase_time_limit_s || 0;

  const sessionElapsedTime = backendStatus.session_elapsed_seconds || 0;

  const getStatusText = () => {
    if (currentPhase === "recording") return `RECORDING EPISODE ${currentEpisode}`;
    if (currentPhase === "resetting") return "RESET — GET READY";
    if (currentPhase === "preparing") return "PREPARING SESSION";
    return "SESSION COMPLETE";
  };

  const phaseColor =
    currentPhase === "recording"
      ? { dot: "bg-red-500", pill: "bg-red-500/15 text-red-300", timer: "text-green-400", bar: "bg-green-500", button: "bg-green-500 hover:bg-green-600" }
      : currentPhase === "resetting"
      ? { dot: "bg-orange-500", pill: "bg-orange-500/15 text-orange-300", timer: "text-orange-400", bar: "bg-orange-500", button: "bg-orange-500 hover:bg-orange-600" }
      : { dot: "bg-gray-500", pill: "bg-gray-500/15 text-gray-300", timer: "text-gray-400", bar: "bg-gray-500", button: "bg-gray-500" };

  const primaryLabel =
    currentPhase === "recording"
      ? "End Episode"
      : currentPhase === "resetting"
      ? "Start Next Episode"
      : "Advance";

  const PrimaryIcon = currentPhase === "recording" ? SkipForward : Play;

  // Says what the countdown belongs to, so the two clocks on screen (phase and
  // session) can't be confused for each other.
  const timerCaption =
    currentPhase === "recording"
      ? `Episode ${currentEpisode} recording time`
      : currentPhase === "resetting"
      ? "Reset time before next episode"
      : "Phase time";

  return (
    <div className="h-screen bg-black text-white p-6 flex flex-col overflow-hidden">
      <div className="max-w-7xl w-full mx-auto flex-1 min-h-0 flex flex-col">
        <div className="mb-3 flex-shrink-0">
          <Button
            onClick={handleBackToHome}
            disabled={leavingSession}
            variant="outline"
            className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {leavingSession ? "Stopping…" : "Back to Home"}
          </Button>
        </div>

        <div className="bg-gray-900 rounded-lg border border-gray-700 p-6 flex-1 min-h-0 flex flex-col justify-center">
          <div className="flex justify-between items-center gap-4 mb-3 flex-shrink-0">
            <div
              className="flex items-baseline gap-2 rounded-lg bg-gray-800 px-4 py-2"
              aria-label={`Episode ${currentEpisode} of ${totalEpisodes}`}
            >
              <span className="text-xs font-bold tracking-widest text-gray-400">EPISODE</span>
              <span className="text-3xl font-bold leading-none text-white">{currentEpisode}</span>
              <span className="text-xl font-semibold leading-none text-gray-500">/ {totalEpisodes}</span>
            </div>
            <div className="flex items-center gap-4 text-gray-400">
              <div
                className="flex items-baseline gap-2"
                aria-label={`Total session time ${formatTime(sessionElapsedTime)}`}
              >
                <span className="text-xs font-bold tracking-widest text-gray-500">SESSION</span>
                <span className="font-mono text-xl text-gray-300">{formatTime(sessionElapsedTime)}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-800"
              >
                {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-800"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  className="bg-gray-900 border-gray-700 text-white"
                >
                  <DropdownMenuItem
                    onClick={requestStopRecording}
                    disabled={!backendStatus.available_controls.stop_recording}
                    className="text-red-400 focus:bg-gray-800 focus:text-red-300"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop recording
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="text-center mb-3 flex-shrink-0">
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-widest ${phaseColor.pill}`}
            >
              <span className={`w-2 h-2 rounded-full ${phaseColor.dot} ${currentPhase !== "completed" ? "animate-pulse" : ""}`} />
              {getStatusText()}
            </div>
          </div>

          {/* Camera windows for the cameras configured for this session. Shown
              from the preparing phase so the slots are laid out immediately;
              each fills with its live feed once the robot is connected and
              recording/resetting. This is the flexible region: it absorbs the
              space left after the fixed chrome, and cameraWindow sizes each feed
              as large as fits so the whole page stays within one screen. */}
          {backendStatus.cameras &&
            backendStatus.cameras.length > 0 &&
            currentPhase !== "completed" && (
              <div
                ref={cameraAreaRef}
                className="flex-1 min-h-0 flex flex-wrap gap-3 justify-center content-center overflow-hidden mb-3"
              >
                {backendStatus.cameras.map((name) => (
                  <CameraFeed
                    key={name}
                    baseUrl={baseUrl}
                    name={name}
                    live={
                      currentPhase === "recording" ||
                      currentPhase === "resetting"
                    }
                    width={cameraWindow.width}
                    height={cameraWindow.height}
                  />
                ))}
              </div>
            )}

          <div className="text-center mb-3 flex-shrink-0">
            <div className="flex items-baseline justify-center gap-3">
              <span className={`text-7xl font-mono font-bold leading-none ${phaseColor.timer}`}>
                {formatTime(phaseElapsedTime)}
              </span>
              <span className="text-3xl font-mono font-semibold leading-none text-gray-500">
                / {formatTime(phaseTimeLimit)}
              </span>
            </div>
            <div className="text-sm font-medium tracking-wide text-gray-400 mt-2">
              {timerCaption}
            </div>
          </div>

          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-4 flex-shrink-0">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${phaseColor.bar}`}
              style={{
                width: `${Math.min((phaseElapsedTime / phaseTimeLimit) * 100, 100)}%`,
              }}
            />
          </div>

          <div className="flex flex-shrink-0 gap-3">
            <Button
              onClick={handleExitEarly}
              disabled={
                !backendStatus.available_controls.exit_early ||
                optimisticPhase !== null ||
                currentPhase === "completed"
              }
              className={`flex-1 text-white font-semibold py-6 text-lg disabled:opacity-50 ${phaseColor.button}`}
            >
              <PrimaryIcon className="w-5 h-5 mr-2" />
              {primaryLabel}
              {currentPhase !== "completed" && (
                <span className="ml-3 px-2 py-0.5 rounded text-xs font-mono bg-black/30 text-white/70">SPACE / →</span>
              )}
            </Button>
            {/* Discarding the take is a normal part of recording, so it gets a
                real button rather than a row in the overflow menu. */}
            <Button
              onClick={handleRerecordEpisode}
              disabled={!backendStatus.available_controls.rerecord_episode}
              variant="outline"
              className="flex-shrink-0 py-6 px-6 text-lg font-semibold border-gray-600 bg-gray-800 text-white hover:bg-gray-700 hover:text-white disabled:opacity-40"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              Re-record
              <span className="ml-3 px-2 py-0.5 rounded text-xs font-mono bg-black/40 text-white/70">DEL / ←</span>
            </Button>
          </div>

          {currentPhase === "completed" && (
            <p className="text-center text-sm text-gray-400 mt-6">
              Recording complete — redirecting to upload…
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop recording?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Saved episodes are kept. The session will end and you'll be taken to the upload page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700">
              Keep recording
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStopRecording}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

interface CameraFeedProps {
  baseUrl: string;
  name: string;
  // False during the preparing phase: show an empty slot until the camera is
  // connected and streaming. True once recording/resetting, when frames flow.
  live: boolean;
  // Pixel size computed by the parent to fit the available space. The box is
  // sized to the camera's aspect ratio, so the video fills it without letterbox.
  width: number;
  height: number;
}

// Renders one recording camera's window at an explicit size. During preparing it
// shows an empty placeholder; once live it plays the backend MJPEG stream. The
// browser renders a `multipart/x-mixed-replace` response natively in an <img>,
// so we just point it at /camera-feed/{name}. If the stream errors before frames
// flow (camera still warming up), retry with a cache-busting key after a delay.
const CameraFeed: React.FC<CameraFeedProps> = ({
  baseUrl,
  name,
  live,
  width,
  height,
}) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [hasError, setHasError] = useState(false);
  const retryRef = useRef<number | null>(null);

  const src = `${baseUrl}/camera-feed/${encodeURIComponent(name)}?k=${reloadKey}`;

  useEffect(() => {
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    if (retryRef.current) window.clearTimeout(retryRef.current);
    retryRef.current = window.setTimeout(() => {
      setHasError(false);
      setReloadKey((k) => k + 1);
    }, 1500);
  }, []);

  // 0 before the first measurement; skip rendering a zero-size box.
  if (width <= 0 || height <= 0) return null;

  return (
    <div
      style={{ width, height }}
      className="relative bg-gray-900 rounded-lg border border-gray-700 overflow-hidden flex items-center justify-center"
    >
      {!live ? (
        <span className="text-gray-500 text-sm">Getting ready…</span>
      ) : hasError ? (
        <span className="text-gray-500 text-sm">Connecting feed…</span>
      ) : (
        <img
          src={src}
          alt={`${name} live feed`}
          onError={handleError}
          className="w-full h-full object-cover"
        />
      )}
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-sm text-gray-200">
        {name}
      </span>
    </div>
  );
};

export default Recording;
