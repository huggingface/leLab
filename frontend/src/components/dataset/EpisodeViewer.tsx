import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Loader2,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/contexts/ApiContext";
import { EpisodeDetail, frameUrl, videoUrl } from "@/lib/datasetApi";
import FilmStrip from "./FilmStrip";
import MotionTrace from "./MotionTrace";

const RATES = [0.5, 1, 2] as const;
type Rate = (typeof RATES)[number];

/**
 * Secondaries are nudged only when they drift past this. Chasing every
 * timeupdate would thrash the decoder for sub-frame corrections nobody sees.
 */
const SYNC_DEADBAND_S = 0.2;

interface EpisodeViewerProps {
  repoId: string;
  detail: EpisodeDetail;
  onNavigate: (episodeIndex: number) => void;
}

const EpisodeViewer: React.FC<EpisodeViewerProps> = ({ repoId, detail, onNavigate }) => {
  const { baseUrl } = useApi();
  const cams = detail.cameras;

  const [activeCam, setActiveCam] = useState<string>(cams[0]?.name ?? "");
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<Rate>(1);
  const [currentFrame, setCurrentFrame] = useState(0);

  const driverRef = useRef<HTMLVideoElement | null>(null);
  const secondaryRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Episode changed (or its cameras did) → fall back to a camera that exists.
  useEffect(() => {
    if (!cams.some((c) => c.name === activeCam)) setActiveCam(cams[0]?.name ?? "");
  }, [cams, activeCam]);

  const activeInfo = useMemo(
    () => cams.find((c) => c.name === activeCam) ?? cams[0] ?? null,
    [cams, activeCam],
  );

  const fps = detail.fps ?? 20;
  // The mp4 holds several episodes back to back; this one occupies
  // [fromTs, toTs). Everything below is expressed against that window.
  const fromTs = activeInfo?.from_timestamp ?? 0;
  const toTs = activeInfo?.to_timestamp ?? fromTs + (detail.duration_s ?? 0);

  const seekToFrame = useCallback(
    (frameIndex: number) => {
      const v = driverRef.current;
      if (!v) return;
      const clamped = Math.max(0, Math.min(frameIndex, Math.max(detail.length - 1, 0)));
      v.currentTime = fromTs + clamped / fps;
      setCurrentFrame(clamped);
    },
    [fromTs, fps, detail.length],
  );

  const handleLoadedMetadata = useCallback(() => {
    const v = driverRef.current;
    if (!v) return;
    v.currentTime = fromTs;
    // A fresh element resets playbackRate to 1, which used to leave the pills
    // reading "2x" while playback ran at 1x.
    v.playbackRate = rate;
    setCurrentFrame(0);
  }, [fromTs, rate]);

  // Move to the new episode's window when the selection changes.
  //
  // The element is keyed on the *file*, so paging between episodes that share
  // an mp4 doesn't remount it and `loadedMetadata` won't fire again — this is
  // what actually puts the player on the new episode. Keying on the episode
  // instead would rebuild the player every time, which silently drops playback
  // (a new element is always paused) and leaves a frozen frame behind.
  useEffect(() => {
    const v = driverRef.current;
    if (!v) return;
    const wasPlaying = !v.paused;
    const goToEpisode = () => {
      v.currentTime = fromTs;
      v.playbackRate = rate;
      setCurrentFrame(0);
      // Keep playing across the switch rather than stranding the user on a
      // still frame with the button claiming it's playing.
      if (wasPlaying || playing) void v.play().catch(() => setPlaying(false));
    };
    if (v.readyState >= 1) {
      goToEpisode();
    } else {
      v.addEventListener("loadedmetadata", goToEpisode, { once: true });
      return () => v.removeEventListener("loadedmetadata", goToEpisode);
    }
    // `playing` is deliberately not a dep: this runs on episode/camera change,
    // not every play/pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.episode_index, activeCam, fromTs]);

  const handleTimeUpdate = useCallback(() => {
    const v = driverRef.current;
    if (!v) return;
    // Loop inside this episode's window rather than running on into the next
    // episode's footage, which shares the file.
    if (v.currentTime >= toTs) {
      v.currentTime = fromTs;
      setCurrentFrame(0);
      return;
    }
    setCurrentFrame(Math.max(0, Math.floor((v.currentTime - fromTs) * fps)));

    if (!showAll) return;
    // Each camera sits at its own offset inside its own file, so a secondary is
    // synced by mapping through *its* from_timestamp — not by copying
    // currentTime, which would land it in a neighbouring episode.
    for (const c of cams) {
      if (c.name === activeCam) continue;
      const el = secondaryRefs.current[c.name];
      if (!el) continue;
      const target = (c.from_timestamp ?? 0) + (v.currentTime - fromTs);
      if (Math.abs(el.currentTime - target) > SYNC_DEADBAND_S) el.currentTime = target;
      el.playbackRate = v.playbackRate;
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    }
  }, [toTs, fromTs, fps, showAll, cams, activeCam, playing]);

  const togglePlay = useCallback(() => {
    const v = driverRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  // Keep the element's rate in step with the pills across re-renders and
  // camera swaps.
  useEffect(() => {
    if (driverRef.current) driverRef.current.playbackRate = rate;
  }, [rate, activeCam]);

  // Space toggles playback, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        seekToFrame(currentFrame - 1);
      } else if (e.code === "ArrowRight") {
        seekToFrame(currentFrame + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekToFrame, currentFrame]);

  if (!activeInfo) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-950 text-sm text-gray-500">
        This episode has no camera videos on disk.
      </div>
    );
  }

  const secondaries = cams.filter((c) => c.name !== activeCam);

  return (
    <div className="flex flex-col gap-3">
      {/* Camera + view controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-gray-800 bg-gray-950 p-0.5">
          {cams.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setActiveCam(c.name)}
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                c.name === activeCam
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {cams.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll((s) => !s)}
            className={`h-7 gap-1.5 border-gray-800 bg-gray-950 text-xs hover:bg-gray-900 ${
              showAll ? "text-orange-400" : "text-gray-400"
            }`}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
            All cameras
          </Button>
        )}

        <div className="ml-auto flex rounded-md border border-gray-800 bg-gray-950 p-0.5">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={`rounded px-2.5 py-1 text-xs font-medium tabular-nums transition ${
                r === rate ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      {/* Viewport */}
      <div
        className={
          showAll && cams.length > 1
            ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
            : "grid grid-cols-1"
        }
      >
        <div className="relative flex items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-black">
          <video
            // Keyed on the file, not the episode: paging within one mp4 seeks
            // instead of rebuilding the player, so playback survives the switch.
            key={`${activeCam}-${activeInfo.chunk}-${activeInfo.file_index}`}
            ref={driverRef}
            src={videoUrl(baseUrl, repoId, activeCam, activeInfo.chunk, activeInfo.file_index)}
            // The episode's first frame, decoded server-side, so the box shows
            // the scene immediately instead of sitting black while the mp4
            // downloads and seeks to the episode's window.
            poster={frameUrl(baseUrl, repoId, detail.episode_index, activeCam, 0, 640)}
            // Height-capped and ratio-natural: robot cameras are 4:3, so forcing
            // a 16:9 box would pillarbox them. The cap is sized so the transport,
            // motion trace and film strip all stay above the fold on a laptop.
            className={`w-auto max-w-full bg-black object-contain ${
              showAll && cams.length > 1 ? "max-h-[22vh]" : "max-h-[42vh]"
            }`}
            preload="auto"
            playsInline
            muted
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
            {activeCam}
          </span>
        </div>

        {showAll &&
          secondaries.map((c) => (
            <div
              key={c.name}
              className="relative flex items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-black"
            >
              <video
                key={`${c.name}-${c.chunk}-${c.file_index}`}
                ref={(el) => {
                  secondaryRefs.current[c.name] = el;
                }}
                src={videoUrl(baseUrl, repoId, c.name, c.chunk, c.file_index)}
                poster={frameUrl(baseUrl, repoId, detail.episode_index, c.name, 0, 640)}
                className="max-h-[22vh] w-auto max-w-full bg-black object-contain"
                preload="auto"
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = c.from_timestamp ?? 0;
                }}
              />
              <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
                {c.name}
              </span>
            </div>
          ))}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={togglePlay}
          className="h-8 w-8 bg-orange-600 p-0 hover:bg-orange-500"
          title="Play / pause (Space)"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seekToFrame(currentFrame - 1)}
          className="h-8 w-8 border-gray-800 bg-gray-950 p-0 text-gray-300 hover:bg-gray-900"
          title="Previous frame (←)"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seekToFrame(currentFrame + 1)}
          className="h-8 w-8 border-gray-800 bg-gray-950 p-0 text-gray-300 hover:bg-gray-900"
          title="Next frame (→)"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </Button>

        <input
          type="range"
          min={0}
          max={Math.max(detail.length - 1, 0)}
          value={currentFrame}
          onChange={(e) => seekToFrame(Number(e.target.value))}
          className="mx-2 h-1 flex-1 cursor-pointer appearance-none rounded bg-gray-800 accent-orange-500"
          aria-label="Scrub episode"
        />

        <span className="w-28 text-right text-xs tabular-nums text-gray-400">
          {currentFrame} / {Math.max(detail.length - 1, 0)}
        </span>
      </div>

      <MotionTrace
        repoId={repoId}
        episodeIndex={detail.episode_index}
        currentFrame={currentFrame}
        onSeekFrame={seekToFrame}
      />

      <FilmStrip
        repoId={repoId}
        episodeIndex={detail.episode_index}
        camera={activeCam}
        currentFrame={currentFrame}
        onSeekFrame={seekToFrame}
      />

      {/* Episode paging */}
      <div className="flex items-center justify-between border-t border-gray-800 pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={detail.prev_episode === null}
          onClick={() => detail.prev_episode !== null && onNavigate(detail.prev_episode)}
          className="h-7 gap-1 border-gray-800 bg-gray-950 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        <span className="text-xs text-gray-500">
          Episode {detail.episode_index} of {detail.total_episodes}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={detail.next_episode === null}
          onClick={() => detail.next_episode !== null && onNavigate(detail.next_episode)}
          className="h-7 gap-1 border-gray-800 bg-gray-950 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default EpisodeViewer;
