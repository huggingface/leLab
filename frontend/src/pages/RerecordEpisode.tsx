import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useRobots } from "@/hooks/useRobots";
import CameraConfiguration, {
  CameraConfig,
} from "@/components/recording/CameraConfiguration";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DatasetMeta {
  repo_id: string;
  num_episodes: number | null;
  num_frames: number | null;
  loadable: boolean;
}

interface EpisodeInfo {
  episode_index: number;
  length: number;
  task: string;
}

interface CameraVideoInfo {
  key: string;
  rel_path: string;
  from_timestamp: number;
  to_timestamp: number;
}

// ─── Replay modal ─────────────────────────────────────────────────────────────

function EpisodeReplayModal({
  repoId,
  episodeIndex,
  baseUrl,
  fetchWithHeaders,
  onClose,
}: {
  repoId: string;
  episodeIndex: number;
  baseUrl: string;
  fetchWithHeaders: typeof fetch;
  onClose: () => void;
}) {
  const [cameras, setCameras] = useState<CameraVideoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchWithHeaders(
      `${baseUrl}/dataset-episode-video-info?repo_id=${encodeURIComponent(repoId)}&episode_index=${episodeIndex}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setCameras(data.cameras ?? []);
        else setError(data.message ?? "Failed to load video info");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [repoId, episodeIndex, baseUrl, fetchWithHeaders]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Play className="w-4 h-4 text-green-400" />
            Episode #{episodeIndex}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-red-400 text-sm py-4">{error}</div>
        ) : cameras.length === 0 ? (
          <div className="text-gray-400 text-sm py-4">No video found for this episode.</div>
        ) : (
          <div className={`grid gap-3 ${cameras.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {cameras.map((cam) => {
              const shortKey = cam.key.split(".").pop() ?? cam.key;
              const src = `${baseUrl}/dataset-video-file?repo_id=${encodeURIComponent(repoId)}&path=${encodeURIComponent(cam.rel_path)}#t=${cam.from_timestamp},${cam.to_timestamp}`;
              return (
                <div key={cam.key} className="rounded-lg overflow-hidden border border-gray-700">
                  <video
                    src={src}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full bg-black"
                    style={{ maxHeight: "360px" }}
                    onLoadedMetadata={(e) => {
                      // Seek to start of episode segment
                      const v = e.currentTarget;
                      v.currentTime = cam.from_timestamp;
                    }}
                    onTimeUpdate={(e) => {
                      // Loop within the episode segment
                      const v = e.currentTarget;
                      if (v.currentTime >= cam.to_timestamp) {
                        v.currentTime = cam.from_timestamp;
                      }
                    }}
                  />
                  <div className="px-2 py-1 text-xs text-gray-400 bg-gray-800">
                    {shortKey} &nbsp;·&nbsp; {(cam.to_timestamp - cam.from_timestamp).toFixed(1)}s
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EpisodeCard({
  ep,
  selected,
  onToggle,
  onPlay,
}: {
  ep: EpisodeInfo;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
        selected
          ? "border-red-500 bg-red-500/10"
          : "border-gray-700 bg-gray-800 hover:border-gray-500"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
              selected ? "border-red-500 bg-red-500" : "border-gray-500"
            }`}
          >
            {selected && <Check className="w-3 h-3 text-white" />}
          </div>
          <span className="font-mono text-sm text-white">
            #{ep.episode_index}
          </span>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">{ep.length} frames</span>
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors"
            title="Replay episode"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {ep.task && (
        <p className="text-xs text-gray-500 mt-1 ml-6 truncate">{ep.task}</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const RerecordEpisode: React.FC = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const { selectedRecord, availableNames, records, selectRobot, isLoading: robotsLoading } = useRobots();

  // ── Dataset selection ──
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // ── Episode list ──
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set());
  const [replayEpisodeIndex, setReplayEpisodeIndex] = useState<number | null>(null);

  // ── Recording config ──
  const [singleTask, setSingleTask] = useState("");
  const [numNewEpisodes, setNumNewEpisodes] = useState(1);
  const [episodeTimeS, setEpisodeTimeS] = useState(60);
  const [resetTimeS, setResetTimeS] = useState(15);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);

  // ── Action state ──
  const [working, setWorking] = useState(false);
  const releaseStreamsRef = useRef<(() => void) | null>(null);

  // Load datasets on mount
  useEffect(() => {
    setDatasetsLoading(true);
    fetchWithHeaders(`${baseUrl}/edit/datasets`)
      .then((r) => r.json())
      .then((data: DatasetMeta[]) =>
        setDatasets(data.filter((d) => d.loadable && (d.num_episodes ?? 0) > 0))
      )
      .catch((e) => console.error("Failed to load datasets:", e))
      .finally(() => setDatasetsLoading(false));
  }, [baseUrl, fetchWithHeaders]);

  // Load episode list when dataset is selected
  const loadEpisodes = useCallback(
    (repoId: string) => {
      setEpisodesLoading(true);
      setEpisodes([]);
      setSelectedEpisodes(new Set());
      fetchWithHeaders(
        `${baseUrl}/dataset-episodes?repo_id=${encodeURIComponent(repoId)}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.success) setEpisodes(data.episodes ?? []);
          else
            toast({
              title: "Could not load episodes",
              description: data.message,
              variant: "destructive",
            });
        })
        .catch((e) =>
          toast({
            title: "Error",
            description: String(e),
            variant: "destructive",
          })
        )
        .finally(() => setEpisodesLoading(false));
    },
    [baseUrl, fetchWithHeaders, toast]
  );

  const handleSelectDataset = useCallback(
    (repoId: string) => {
      setSelectedDataset(repoId);
      loadEpisodes(repoId);
      // Pre-fill task from dataset episodes if available
    },
    [loadEpisodes]
  );

  // Sync cameras from robot profile when robot changes
  useEffect(() => {
    setCameras(selectedRecord ? [...(selectedRecord.cameras ?? [])] : []);
  }, [selectedRecord]);

  // Sync task from first episode
  useEffect(() => {
    if (episodes.length > 0 && !singleTask) {
      const firstTask = episodes[0].task;
      if (firstTask) setSingleTask(firstTask);
    }
  }, [episodes, singleTask]);

  const toggleEpisode = useCallback((idx: number) => {
    setSelectedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedEpisodes(new Set(episodes.map((e) => e.episode_index)));
  }, [episodes]);

  const clearAll = useCallback(() => {
    setSelectedEpisodes(new Set());
  }, []);

  // Total episodes that will be recorded = selected (to replace) + extra new ones
  const totalToRecord = selectedEpisodes.size > 0 ? selectedEpisodes.size + (numNewEpisodes - selectedEpisodes.size > 0 ? numNewEpisodes - selectedEpisodes.size : 0) : numNewEpisodes;

  const canStart =
    !!selectedDataset &&
    !!selectedRecord &&
    selectedRecord.is_clean &&
    !!singleTask.trim() &&
    !working;

  const handleStart = useCallback(async () => {
    if (!selectedDataset || !selectedRecord) return;

    setWorking(true);

    try {
      // Step 1: Delete selected episodes in-place (if any)
      if (selectedEpisodes.size > 0) {
        const resp = await fetchWithHeaders(
          `${baseUrl}/edit/delete-episodes-inplace`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataset_repo_id: selectedDataset,
              episode_indices: Array.from(selectedEpisodes),
            }),
          }
        );
        const data = await resp.json();
        if (!data.success) {
          toast({
            title: "Delete failed",
            description: data.message,
            variant: "destructive",
          });
          setWorking(false);
          return;
        }
        toast({
          title: "Episodes deleted",
          description: data.message,
        });
      }

      // Step 2: Build recording config and navigate to Recording page
      const cameraDict = cameras.reduce(
        (acc, cam) => {
          acc[cam.name] = {
            type: cam.type,
            camera_index: cam.camera_index,
            width: cam.width,
            height: cam.height,
            fps: cam.fps,
            ...(cam.fourcc ? { fourcc: cam.fourcc } : {}),
            ...(cam.backend ? { backend: cam.backend } : {}),
          };
          return acc;
        },
        {} as Record<string, unknown>
      );

      const nToRecord =
        selectedEpisodes.size > 0
          ? Math.max(selectedEpisodes.size, numNewEpisodes)
          : numNewEpisodes;

      const recordingConfig = {
        leader_port: selectedRecord.leader_port,
        follower_port: selectedRecord.follower_port,
        leader_config: selectedRecord.leader_config,
        follower_config: selectedRecord.follower_config,
        dataset_repo_id: selectedDataset,
        single_task: singleTask.trim(),
        num_episodes: nToRecord,
        episode_time_s: episodeTimeS,
        reset_time_s: resetTimeS,
        fps: 30,
        video: true,
        push_to_hub: false,
        resume: true,
        streaming_encoding: true,
        cameras: cameraDict,
      };

      // Release any camera preview streams before navigation
      if (releaseStreamsRef.current) releaseStreamsRef.current();

      navigate("/recording", { state: { recordingConfig } });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
      setWorking(false);
    }
  }, [
    selectedDataset,
    selectedRecord,
    selectedEpisodes,
    cameras,
    numNewEpisodes,
    singleTask,
    episodeTimeS,
    resetTimeS,
    baseUrl,
    fetchWithHeaders,
    navigate,
    toast,
  ]);

  const shortId = (r: string) =>
    r.includes("/") ? r.split("/")[1] : r;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Add / Re-record Episodes</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Delete bad demonstrations and record replacements, or append new
              episodes to an existing dataset.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: dataset + episode selection */}
          <div className="space-y-4">
            {/* Dataset picker */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
                <Video className="w-4 h-4 text-gray-400" />
                Select Dataset
              </h2>
              {datasetsLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading datasets…
                </div>
              ) : datasets.length === 0 ? (
                <p className="text-gray-500 text-sm">No local datasets found.</p>
              ) : (
                <Select
                  value={selectedDataset ?? ""}
                  onValueChange={handleSelectDataset}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                    <SelectValue placeholder="Choose a dataset…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 text-white">
                    {datasets.map((ds) => (
                      <SelectItem
                        key={ds.repo_id}
                        value={ds.repo_id}
                        className="focus:bg-gray-700 focus:text-white"
                      >
                        <span className="font-medium">{shortId(ds.repo_id)}</span>
                        {ds.num_episodes !== null && (
                          <span className="ml-2 text-gray-400 text-xs">
                            ({ds.num_episodes} ep)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedDataset && (
                <p className="mt-1 text-xs text-gray-500 font-mono">{selectedDataset}</p>
              )}
            </div>

            {/* Episode list */}
            {selectedDataset && (
              <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-white flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-400" />
                    Episodes to Delete
                    {selectedEpisodes.size > 0 && (
                      <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
                        {selectedEpisodes.size} selected
                      </Badge>
                    )}
                  </h2>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadEpisodes(selectedDataset)}
                      className="text-gray-400 hover:text-white h-7 px-2"
                      title="Refresh"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={selectAll}
                      className="text-gray-400 hover:text-white h-7 px-2 text-xs"
                    >
                      All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAll}
                      className="text-gray-400 hover:text-white h-7 px-2 text-xs"
                    >
                      None
                    </Button>
                  </div>
                </div>

                {episodesLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading episodes…
                  </div>
                ) : episodes.length === 0 ? (
                  <p className="text-gray-500 text-sm">No episodes found.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
                    {episodes.map((ep) => (
                      <EpisodeCard
                        key={ep.episode_index}
                        ep={ep}
                        selected={selectedEpisodes.has(ep.episode_index)}
                        onToggle={() => toggleEpisode(ep.episode_index)}
                        onPlay={() => setReplayEpisodeIndex(ep.episode_index)}
                      />
                    ))}
                  </div>
                )}

                {selectedEpisodes.size > 0 && (
                  <p className="mt-3 text-xs text-red-400/80 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" />
                    {selectedEpisodes.size} episode(s) will be permanently
                    deleted before recording starts.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Right column: recording config */}
          <div className="space-y-4">
            {/* Robot selection */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <h2 className="font-semibold text-white mb-3">Robot</h2>
              {robotsLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading robots…
                </div>
              ) : availableNames.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  No robots configured. Set one up on the Landing page first.
                </p>
              ) : (
                <Select
                  value={selectedRecord?.name ?? ""}
                  onValueChange={selectRobot}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                    <SelectValue placeholder="Choose a robot…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 text-white">
                    {availableNames.map((name) => (
                      <SelectItem
                        key={name}
                        value={name}
                        className="focus:bg-gray-700 focus:text-white"
                      >
                        {name}
                        {!records[name]?.is_clean && (
                          <span className="ml-2 text-amber-400 text-xs">
                            (needs calibration)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedRecord && !selectedRecord.is_clean && (
                <p className="mt-2 text-xs text-amber-400">
                  This robot needs calibration before recording.
                </p>
              )}
            </div>

            {/* Recording parameters */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-4">
              <h2 className="font-semibold text-white">Recording Parameters</h2>

              <div className="space-y-1.5">
                <Label className="text-sm text-gray-300">Task Description *</Label>
                <Input
                  value={singleTask}
                  onChange={(e) => setSingleTask(e.target.value)}
                  placeholder="e.g., pick and place the rubber object"
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm text-gray-300">
                  Episodes to record{" "}
                  {selectedEpisodes.size > 0 && (
                    <span className="text-gray-500">
                      (min {selectedEpisodes.size} to replace deleted)
                    </span>
                  )}
                </Label>
                <NumberInput
                  min={selectedEpisodes.size > 0 ? selectedEpisodes.size : 1}
                  value={numNewEpisodes}
                  onChange={(v) => {
                    if (v !== undefined) setNumNewEpisodes(v);
                  }}
                  className="bg-gray-800 border-gray-700 text-white"
                />
                {selectedEpisodes.size > 0 && numNewEpisodes < selectedEpisodes.size && (
                  <p className="text-xs text-amber-400">
                    Will record {selectedEpisodes.size} episodes to replace the
                    deleted ones.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm text-gray-300">
                    Episode duration (s)
                  </Label>
                  <NumberInput
                    min={1}
                    value={episodeTimeS}
                    onChange={(v) => {
                      if (v !== undefined) setEpisodeTimeS(v);
                    }}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-gray-300">
                    Reset duration (s)
                  </Label>
                  <NumberInput
                    min={1}
                    value={resetTimeS}
                    onChange={(v) => {
                      if (v !== undefined) setResetTimeS(v);
                    }}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
              </div>
            </div>

            {/* Cameras */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <CameraConfiguration
                cameras={cameras}
                onCamerasChange={setCameras}
                releaseStreamsRef={releaseStreamsRef}
                readOnly
              />
              <p className="text-xs text-gray-500 mt-2">
                Cameras are taken from the selected robot profile.
              </p>
            </div>

            {/* Action */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <div className="mb-3 text-sm text-gray-400">
                {selectedEpisodes.size > 0 ? (
                  <span>
                    Will delete{" "}
                    <span className="text-red-400 font-semibold">
                      {selectedEpisodes.size}
                    </span>{" "}
                    episode(s), then record{" "}
                    <span className="text-green-400 font-semibold">
                      {Math.max(selectedEpisodes.size, numNewEpisodes)}
                    </span>{" "}
                    new episode(s).
                  </span>
                ) : (
                  <span>
                    Will append{" "}
                    <span className="text-green-400 font-semibold">
                      {numNewEpisodes}
                    </span>{" "}
                    new episode(s) to the selected dataset.
                  </span>
                )}
              </div>
              <Button
                onClick={handleStart}
                disabled={!canStart}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-5 text-base disabled:opacity-40"
              >
                {working ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <Plus className="w-5 h-5 mr-2" />
                )}
                {working
                  ? "Preparing…"
                  : selectedEpisodes.size > 0
                  ? `Delete & Record`
                  : `Record New Episodes`}
              </Button>
              {!selectedRecord && (
                <p className="text-xs text-amber-400 mt-2 text-center">
                  Select a configured robot to enable recording.
                </p>
              )}
              {!selectedDataset && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Select a dataset to start.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {replayEpisodeIndex !== null && selectedDataset && (
        <EpisodeReplayModal
          repoId={selectedDataset}
          episodeIndex={replayEpisodeIndex}
          baseUrl={baseUrl}
          fetchWithHeaders={fetchWithHeaders}
          onClose={() => setReplayEpisodeIndex(null)}
        />
      )}
    </div>
  );
};

export default RerecordEpisode;
