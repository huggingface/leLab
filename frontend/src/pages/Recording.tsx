import React, { useState, useEffect, useCallback, useRef } from "react";
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
  available_controls: {
    stop_recording: boolean;
    exit_early: boolean;
    rerecord_episode: boolean;
  };
  error?: string | null;
  hint?: string | null;
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
  const [sessionError, setSessionError] = useState<{ error: string; hint: string | null } | null>(null);

  const [optimisticPhase, setOptimisticPhase] = useState<Phase | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => getMuted());
  const prevRealPhaseRef = useRef<Phase | null>(null);
  // Bumps on each re-record so the auto-advance warning re-fires for the same episode number.
  const [rerecordTick, setRerecordTick] = useState(0);
  const warningFiredForPhaseRef = useRef<{ phase: Phase | null; episode: number | null; tick: number }>({ phase: null, episode: null, tick: 0 });
  // Guards against React StrictMode double-invocation of the start effect.
  const startInitiatedRef = useRef(false);

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
    if (!recordingSessionStarted || sessionError !== null) return;

    const pollStatus = async () => {
      try {
        const response = await fetchWithHeaders(
          `${baseUrl}/recording-status`
        );
        if (!response.ok) return;
        const status = await response.json();
        
        if (status.current_phase === "error") {
          setSessionError({
            error: status.error || "Recording session failed.",
            hint: status.hint || null,
          });
          return;
        }

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
      }
    };

    pollStatus();
    const statusInterval = setInterval(pollStatus, 1000);
    return () => clearInterval(statusInterval);
  }, [recordingSessionStarted, recordingConfig, navigate, baseUrl, fetchWithHeaders, sessionError]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const startRecordingSession = async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/start-recording`, {
        method: "POST",
        body: JSON.stringify(recordingConfig),
      });

      const data = await response.json();

      if (response.ok) {
        setRecordingSessionStarted(true);
        toast({
          title: "Recording Started",
          description: `Started recording ${recordingConfig.num_episodes} episodes`,
        });
      } else {
        toast({
          title: "Error Starting Recording",
          description: data.message || "Failed to start recording session.",
          variant: "destructive",
        });
        navigate("/");
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
      navigate("/");
    }
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
      } else if (e.key === "ArrowLeft") {
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

  // Show loading state while waiting for backend status
  if (!backendStatus) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
          <p className="text-lg">Connecting to recording session...</p>
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

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>

        <div className="bg-gray-900 rounded-lg border border-gray-700 p-8">
          <div className="flex justify-end items-center gap-4 mb-6 text-sm text-gray-400">
            <span aria-label={`Episode ${currentEpisode} of ${totalEpisodes}`}>
              Episode <span className="text-white font-semibold">{currentEpisode}</span> / {totalEpisodes}
            </span>
            <span className="font-mono" aria-label={`Total session time ${formatTime(sessionElapsedTime)}`}>
              {formatTime(sessionElapsedTime)}
            </span>
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
                  onClick={handleRerecordEpisode}
                  disabled={!backendStatus.available_controls.rerecord_episode}
                  className="focus:bg-gray-800 focus:text-white"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Re-record episode
                </DropdownMenuItem>
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

          <div className="text-center mb-6">
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-widest ${phaseColor.pill}`}
            >
              <span className={`w-2 h-2 rounded-full ${phaseColor.dot} ${currentPhase !== "completed" ? "animate-pulse" : ""}`} />
              {getStatusText()}
            </div>
          </div>

          <div className="text-center mb-4">
            <div className={`text-7xl font-mono font-bold leading-none ${phaseColor.timer}`}>
              {formatTime(phaseElapsedTime)}
            </div>
            <div className="text-sm text-gray-500 mt-2">
              / {formatTime(phaseTimeLimit)}
            </div>
          </div>

          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-8">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${phaseColor.bar}`}
              style={{
                width: `${Math.min((phaseElapsedTime / phaseTimeLimit) * 100, 100)}%`,
              }}
            />
          </div>

          <Button
            onClick={handleExitEarly}
            disabled={
              !backendStatus.available_controls.exit_early ||
              optimisticPhase !== null ||
              currentPhase === "completed"
            }
            className={`w-full text-white font-semibold py-6 text-lg disabled:opacity-50 ${phaseColor.button}`}
          >
            <PrimaryIcon className="w-5 h-5 mr-2" />
            {primaryLabel}
            {currentPhase !== "completed" && (
              <span className="ml-3 px-2 py-0.5 rounded text-xs font-mono bg-black/30 text-white/70">SPACE / →</span>
            )}
          </Button>

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

      <AlertDialog open={sessionError !== null}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              Recording Session Failed
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300 space-y-4 mt-2">
              <p>The recording session encountered an error and had to stop.</p>
              
              <div className="bg-black/50 p-4 rounded border border-red-900/50 font-mono text-xs text-red-400 max-h-40 overflow-y-auto break-all whitespace-pre-wrap">
                {sessionError?.error}
              </div>

              {sessionError?.hint && (
                <div className="bg-blue-950/40 p-4 rounded border border-blue-800/40 text-sm text-slate-200">
                  <strong className="text-blue-400 block mb-1">Hardware Hint:</strong>
                  {sessionError.hint}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => navigate("/")}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Return to Home
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Recording;
