import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Maximize, Minimize, Play, Square } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import {
  InferenceStatus,
  getInferenceStatus,
  startInference,
  stopInference,
} from "@/lib/inferenceApi";
import { DemoPreset, getDemoPreset } from "@/lib/demoPreset";

const formatTime = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const CameraFeed: React.FC<{
  baseUrl: string;
  camId: number;
  label: string;
}> = ({ baseUrl, camId, label }) => {
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-gray-900 min-h-[180px] flex items-center justify-center">
      {!loaded && (
        <span className="absolute text-gray-600 text-sm">
          waiting for camera…
        </span>
      )}
      <img
        src={`${baseUrl}/demo-camera/${camId}?t=${tick}`}
        alt={`Live camera ${label}`}
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-contain ${loaded ? "opacity-100" : "opacity-0"}`}
      />
      <span className="absolute bottom-2 left-3 text-xs text-gray-300 bg-black/60 rounded px-2 py-0.5">
        {label}
      </span>
    </div>
  );
};

const Demo = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const [preset] = useState<DemoPreset | null>(() => getDemoPreset());
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const active = !!status?.inference_active;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getInferenceStatus(baseUrl, fetchWithHeaders);
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [baseUrl, fetchWithHeaders]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Fullscreen may be blocked (iframe/permissions) — non-fatal.
      });
    }
  }, []);

  const handleStart = async () => {
    if (!preset) return;
    setSubmitting(true);
    try {
      await startInference(baseUrl, fetchWithHeaders, preset.request);
    } catch (e) {
      toast({
        title: "Couldn't start the demo",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    setSubmitting(true);
    try {
      await stopInference(baseUrl, fetchWithHeaders);
    } catch (e) {
      toast({
        title: "Couldn't stop the demo",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const elapsed = status?.rollout_elapsed_s ?? status?.elapsed_s ?? 0;
  const duration = status?.duration_s ?? preset?.request.duration_s ?? 0;
  const progress =
    active && duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col select-none">
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-300 text-sm transition-colors"
          aria-label="Back to home"
        >
          <ArrowLeft className="w-4 h-4" />
          exit
        </button>
        <button
          onClick={toggleFullscreen}
          className="text-gray-600 hover:text-gray-300 transition-colors"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <Minimize className="w-5 h-5" />
          ) : (
            <Maximize className="w-5 h-5" />
          )}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-10 px-6 pb-16">
        {!preset ? (
          <div className="text-center max-w-md space-y-4">
            <h1 className="text-3xl font-bold">Demo mode</h1>
            <p className="text-gray-400 leading-relaxed">
              No demo configured yet. Run an inference once from the landing
              page (green play button on a trained model) — its exact settings
              will be reused here for one-click demos.
            </p>
            <button
              onClick={() => navigate("/")}
              className="text-red-400 hover:text-red-300 underline underline-offset-4"
            >
              Go to the landing page
            </button>
          </div>
        ) : active ? (
          <>
            <div className="flex items-center gap-3 text-gray-400">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
              Robot running
            </div>
            {!status?.rollout_started_at ? (
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <span className="h-10 w-10 rounded-full border-4 border-gray-700 border-t-green-500 animate-spin" />
                <span>Loading policy — the robot will move in ~30 s…</span>
              </div>
            ) : (
              Object.keys(preset.request.cameras).length > 0 && (
                <div
                  className={`grid gap-4 w-full max-w-4xl ${
                    Object.keys(preset.request.cameras).length > 1
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1"
                  }`}
                >
                  {Object.entries(preset.request.cameras).map(([name, cfg]) => (
                    <CameraFeed
                      key={name}
                      baseUrl={baseUrl}
                      camId={cfg.camera_index ?? 0}
                      label={name}
                    />
                  ))}
                </div>
              )
            )}
            <div className="text-6xl md:text-7xl font-bold font-mono tabular-nums">
              {formatTime(elapsed)}
            </div>
            {duration > 0 && (
              <div className="w-full max-w-xl h-2 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            <button
              onClick={handleStop}
              disabled={submitting}
              className="mt-4 flex items-center justify-center gap-3 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-2xl font-bold px-14 py-6 shadow-lg shadow-red-600/30 transition-all active:scale-95"
            >
              <Square className="w-7 h-7 fill-current" />
              STOP
            </button>
          </>
        ) : (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold">
                {preset.request.task || "Robot demo"}
              </h1>
              <p className="text-gray-500 text-sm">
                {preset.policyLabel} · {preset.robotName} ·{" "}
                {preset.request.duration_s}s
              </p>
            </div>
            <button
              onClick={handleStart}
              disabled={submitting}
              className="flex items-center justify-center gap-4 rounded-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-3xl font-bold px-16 py-8 shadow-lg shadow-green-600/30 transition-all active:scale-95"
            >
              <Play className="w-9 h-9 fill-current" />
              {submitting ? "STARTING…" : "START"}
            </button>
            {status?.exited && status.exit_code !== 0 && status.exit_code != null && (
              <p className="text-xs text-red-400">
                Last run exited with code {status.exit_code} — check the
                inference page for logs.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Demo;
