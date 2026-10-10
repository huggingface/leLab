import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
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
import {
  FPS_TONE_TEXT,
  InferenceStatus,
  fpsTone,
  getInferenceStatus,
  stopInference,
} from "@/lib/inferenceApi";

const POLL_MS = 1000;
// One sample per poll, so this is the last minute of control-loop rate.
const FPS_HISTORY_LEN = 60;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Rate history over a fixed 60-sample axis: the curve grows in from the
 * left, then slides once the window is full. The dashed line is the target. */
const FpsSparkline: React.FC<{ values: number[]; target: number | null }> = ({
  values,
  target,
}) => {
  const W = 200;
  const H = 40;
  if (values.length < 2) return null;
  const ceiling = Math.max(target ?? 0, ...values) * 1.1 || 1;
  const y = (v: number) => H - (v / ceiling) * H;
  const step = W / (FPS_HISTORY_LEN - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-10"
      aria-label="Control-loop rate over the last minute"
    >
      {target != null && target > 0 && (
        <line
          x1={0}
          y1={y(target)}
          x2={W}
          y2={y(target)}
          stroke="#374151"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke="#4ade80"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

const FpsTile: React.FC<{
  value: string;
  label: string;
  valueClass?: string;
  borderClass?: string;
}> = ({ value, label, valueClass = "text-slate-200", borderClass = "border-gray-700" }) => (
  <div className={`flex-1 bg-black/40 border rounded-lg px-3 py-2 ${borderClass}`}>
    <div className={`font-mono text-xl leading-none tabular-nums ${valueClass}`}>{value}</div>
    <div className="text-[10px] text-gray-500 mt-1">{label}</div>
  </div>
);

const Inference: React.FC = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const navigatedAwayRef = useRef(false);
  // Independent flag: we may request a stop (safety net) before the run
  // is actually inactive. We must not flip navigatedAwayRef yet — that
  // would block the natural completion path on the next tick.
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const stopIfHung = async () => {
      try {
        await stopInference(baseUrl, fetchWithHeaders);
      } catch {
        // The next status poll will surface the failure if it persists.
      }
    };
    const tick = async () => {
      try {
        const next = await getInferenceStatus(baseUrl, fetchWithHeaders);
        if (cancelled) return;
        setStatus(next);
        if (next.fps_now != null && !next.fps_stale) {
          const sample = next.fps_now;
          setFpsHistory((h) => [...h, sample].slice(-FPS_HISTORY_LEN));
        }
        // Auto-bounce home once the run is done.
        if (!next.inference_active && !navigatedAwayRef.current) {
          navigatedAwayRef.current = true;
          if (next.exited) {
            // The average is the one number worth carrying off the page: it
            // says whether the policy actually ran at the rate it was trained at.
            const rate =
              next.fps_avg != null
                ? ` Averaged ${next.fps_avg.toFixed(1)} Hz` +
                  (next.target_fps ? ` of ${next.target_fps} Hz.` : ".")
                : "";
            toast({
              title: "Inference finished",
              description:
                next.exit_code === 0
                  ? `Run completed.${rate}`
                  : `Exit code ${next.exit_code}. See ${next.log_path}.`,
              variant: next.exit_code === 0 ? "default" : "destructive",
            });
          }
          navigate("/");
          return;
        }
        // Safety net: only fire after the rollout *main loop* has actually
        // started (lerobot honours --duration there). Setup time — policy
        // load, snapshot_download, bus connect, camera connect — can take
        // 10–30s and must NOT count against the user's configured duration.
        if (
          next.inference_active &&
          next.rollout_started_at != null &&
          next.duration_s != null &&
          next.duration_s > 0 &&
          next.rollout_elapsed_s > next.duration_s + 10 &&
          !stopRequestedRef.current
        ) {
          stopRequestedRef.current = true;
          toast({
            title: "Inference seems hung",
            description: `Rollout past duration by ${Math.round(
              next.rollout_elapsed_s - next.duration_s,
            )}s. Stopping.`,
            variant: "destructive",
          });
          stopIfHung();
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Lost connection to backend",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [baseUrl, fetchWithHeaders, navigate, toast]);

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await stopInference(baseUrl, fetchWithHeaders);
      // Status poll will catch the inactive state and navigate home.
    } catch (e) {
      toast({
        title: "Stop failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (!status) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin mr-3" /> Connecting to inference…
      </div>
    );
  }

  const setupElapsed = status.elapsed_s ?? 0;
  const rolloutElapsed = status.rollout_elapsed_s ?? 0;
  const duration = status.duration_s ?? 0;
  const isSettingUp = status.inference_active && status.rollout_started_at == null;
  const isRunning = status.inference_active && status.rollout_started_at != null;
  // When setting up: progress is uncertain — show a soft pulsing bar.
  // When rolling out: progress is rolloutElapsed / duration.
  const pct =
    isRunning && duration > 0
      ? Math.min(100, (rolloutElapsed / duration) * 100)
      : 0;
  const pillLabel = isSettingUp
    ? "SETTING UP"
    : isRunning
    ? "RUNNING"
    : "FINISHED";
  const timerSeconds = isRunning ? rolloutElapsed : setupElapsed;

  const targetFps = status.target_fps;
  const fpsNow = status.fps_now;
  const hasFps = fpsNow != null || status.fps_avg != null;
  const nowTone = fpsNow != null ? fpsTone(fpsNow, targetFps) : null;
  const minTone = status.fps_min != null ? fpsTone(status.fps_min, targetFps) : null;
  const fmtFps = (v: number | null) => (v != null ? v.toFixed(1) : "—");

  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/")}
          className="text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Logo />
        <h1 className="font-bold text-white text-2xl">Inference</h1>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-full max-w-xl">
          <div className="text-center mb-6">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-widest ${
                isSettingUp
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-green-500/15 text-green-300"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isSettingUp ? "bg-amber-500" : "bg-green-500"
                } animate-pulse`}
              />
              {pillLabel}
            </div>
          </div>

          <div className="text-center mb-4">
            <div
              className={`text-7xl font-mono font-bold leading-none ${
                isSettingUp ? "text-amber-400" : "text-green-400"
              }`}
            >
              {formatTime(timerSeconds)}
            </div>
            <div className="text-sm text-gray-500 mt-2">
              {isSettingUp
                ? "Loading policy & connecting hardware…"
                : `/ ${formatTime(duration)}`}
            </div>
          </div>

          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-8">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                isSettingUp
                  ? "bg-amber-500/40 animate-pulse w-full"
                  : "bg-green-500"
              }`}
              style={isSettingUp ? undefined : { width: `${pct}%` }}
            />
          </div>

          <div className="mb-6">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-500">
                control loop
              </span>
              {targetFps != null && (
                <span className="text-[10px] text-gray-500">target {targetFps} Hz</span>
              )}
            </div>
            {!hasFps ? (
              <div className="text-xs text-gray-600 border border-gray-800 rounded-lg px-3 py-4 text-center">
                {isSettingUp
                  ? "Waiting for the control loop…"
                  : "No rate reported yet."}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <FpsTile
                    value={fmtFps(fpsNow)}
                    label="FPS now"
                    valueClass={nowTone ? FPS_TONE_TEXT[nowTone] : "text-slate-500"}
                    borderClass={
                      nowTone === "bad"
                        ? "border-red-900"
                        : nowTone === "warn"
                        ? "border-amber-900"
                        : nowTone === "good"
                        ? "border-green-900"
                        : "border-gray-700"
                    }
                  />
                  <FpsTile value={fmtFps(status.fps_avg)} label="average" />
                  <FpsTile
                    value={fmtFps(status.fps_min)}
                    label="worst second"
                    valueClass={minTone ? FPS_TONE_TEXT[minTone] : "text-slate-200"}
                  />
                </div>
                <FpsSparkline values={fpsHistory} target={targetFps} />
                <div className="text-[10px] text-gray-500">
                  {status.fps_worst_gap_ms != null &&
                    `longest stall ${Math.round(status.fps_worst_gap_ms)} ms · `}
                  {status.fps_ticks} loop ticks
                </div>
              </>
            )}
          </div>

          <div className="text-xs text-slate-500 break-all mb-6">
            policy: {status.policy_ref ?? "(unknown)"}
          </div>

          <Button
            onClick={() => setShowStopConfirm(true)}
            disabled={!status.inference_active}
            className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-6 text-lg disabled:opacity-50"
          >
            <Square className="w-5 h-5 mr-2" />
            Stop
          </Button>
        </div>
      </div>

      <AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop inference?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              The follower will hold its current pose. You can launch another
              run from the job tile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700">
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStop}
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

export default Inference;
