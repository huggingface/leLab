import React, { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Database, Loader2, Upload } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import EpisodeList from "@/components/dataset/EpisodeList";
import EpisodeViewer from "@/components/dataset/EpisodeViewer";
import { useDatasets } from "@/hooks/useDatasets";
import { useEpisodeDetail, useEpisodes } from "@/hooks/useEpisodes";
import { formatDuration } from "@/lib/datasetApi";

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-[10px] uppercase tracking-wider text-gray-600">{label}</span>
    <span className="font-medium tabular-nums text-gray-200">{value}</span>
  </span>
);

/**
 * Browse the episodes of a dataset in the local LeRobot cache.
 *
 * Local datasets only: the visualize_dataset Space renders from a Hub repo
 * path, so a dataset you just recorded can't be opened there until it has been
 * uploaded. This reads the files on disk instead.
 */
const EditDataset = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { datasets, loading: datasetsLoading } = useDatasets();
  // A Hub-only dataset has no videos on disk to decode.
  const localDatasets = useMemo(
    () => datasets.filter((d) => d.source === "local" || d.source === "both"),
    [datasets],
  );

  const repoId = searchParams.get("dataset");
  const episodeParam = searchParams.get("episode");
  const episodeIndex = episodeParam === null ? null : Number(episodeParam);
  const selectedSource = datasets.find((d) => d.repo_id === repoId)?.source;

  const { data, loading, error } = useEpisodes(repoId);
  const {
    detail,
    loading: detailLoading,
    error: detailError,
  } = useEpisodeDetail(repoId, episodeIndex);

  // The URL owns which dataset/episode is open, so a reload or a pasted link
  // lands back in the same place. `api` is carried through rather than dropped:
  // setSearchParams replaces the whole query, and losing the backend override on
  // the first click would strand anyone driving a non-default backend (or the
  // hosted Space) the moment they picked an episode.
  const withApi = (params: Record<string, string>) => {
    const api = searchParams.get("api");
    return api ? { ...params, api } : params;
  };
  const setDataset = (next: string) => setSearchParams(withApi({ dataset: next }));
  const setEpisode = (next: number) => {
    if (!repoId) return;
    setSearchParams(withApi({ dataset: repoId, episode: String(next) }));
  };

  // Land on the first episode rather than an empty right-hand pane.
  useEffect(() => {
    if (repoId && data?.success && episodeParam === null && data.episodes.length > 0) {
      setSearchParams(
        withApi({ dataset: repoId, episode: String(data.episodes[0].episode_index) }),
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, data, episodeParam, setSearchParams]);

  return (
    <div className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="h-8 gap-1.5 px-2 text-gray-400 hover:bg-gray-900 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Database className="h-5 w-5 text-orange-500" />
            Browse dataset
          </h1>

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-[380px]">
              <Select value={repoId ?? undefined} onValueChange={setDataset}>
                <SelectTrigger className="h-9 border-gray-800 bg-gray-950 text-sm text-white">
                  <SelectValue
                    placeholder={datasetsLoading ? "Loading datasets…" : "Select a local dataset"}
                  />
                </SelectTrigger>
                <SelectContent className="border-gray-800 bg-gray-950 text-white">
                  {localDatasets.map((d) => (
                    <SelectItem key={d.repo_id} value={d.repo_id} className="text-sm">
                      {d.repo_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Picking a dataset now lands here rather than on /upload, so the
                upload + delete flow hangs off the page you browse from. */}
            {repoId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate("/upload", {
                    state: {
                      datasetInfo: {
                        dataset_repo_id: repoId,
                        source: selectedSource ?? "local",
                      },
                    },
                  })
                }
                className="h-9 gap-1.5 border-gray-800 bg-gray-950 text-xs text-gray-300 hover:bg-gray-900"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </Button>
            )}
          </div>
        </div>

        {!repoId && (
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-10 text-center">
            <Database className="mx-auto mb-3 h-8 w-8 text-gray-700" />
            <p className="text-sm text-gray-400">Select a dataset to browse its episodes.</p>
            {!datasetsLoading && localDatasets.length === 0 && (
              <p className="mt-2 text-xs text-gray-600">
                No datasets in the local LeRobot cache. Record one, or download it from the
                Hub first.
              </p>
            )}
          </div>
        )}

        {repoId && loading && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-950 p-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading dataset…
          </div>
        )}

        {repoId && error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-300">Could not read this dataset</p>
              <p className="mt-0.5 text-xs text-red-400/80">{error}</p>
            </div>
          </div>
        )}

        {repoId && data?.success && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-gray-800 bg-gray-950 px-4 py-2.5 text-xs">
              <Stat label="Episodes" value={String(data.total_episodes)} />
              <Stat label="Frames" value={data.total_frames?.toLocaleString() ?? "—"} />
              <Stat label="FPS" value={String(data.fps ?? "—")} />
              <Stat label="Robot" value={data.robot_type ?? "—"} />
              <Stat label="Cameras" value={data.cameras.join(", ") || "—"} />
              {detail && <Stat label="This episode" value={formatDuration(detail.duration_s)} />}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
              <EpisodeList
                episodes={data.episodes}
                selected={episodeIndex}
                onSelect={setEpisode}
              />

              <div>
                {detailLoading && !detail && (
                  <div className="flex h-64 items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-950 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading episode…
                  </div>
                )}
                {detailError && (
                  <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-xs text-red-400">
                    {detailError}
                  </div>
                )}
                {detail && (
                  <EpisodeViewer repoId={repoId} detail={detail} onNavigate={setEpisode} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EditDataset;
