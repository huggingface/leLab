import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Circle,
  Trash2,
  Loader2,
  ExternalLink,
  CloudOff,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useRobots } from "@/hooks/useRobots";
import { useRecording } from "@/hooks/useRecording";
import { useEditDataset } from "@/hooks/useEditDataset";
import RobotConfigManager from "@/components/landing/RobotConfigManager";
import RecordingSettingsFields from "@/components/recording/RecordingSettingsFields";

const EditDataset = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initial = location.state?.datasetInfo as
    | { dataset_repo_id?: string }
    | undefined;
  const justRecorded = (location.state?.justRecorded as boolean) ?? false;
  const repoId = initial?.dataset_repo_id;

  const {
    selectedName,
    selectedRecord,
    availableNames,
    isLoading: isLoadingRobots,
    selectRobot,
    createRobot,
    deleteRobot,
  } = useRobots();

  const rec = useRecording(selectedRecord);
  const { setResumeRepoId, setCameras } = rec;

  const {
    datasetInfo,
    isLoading,
    syncStatus,
    syncLoading,
    isUploading,
    handleUploadToHub,
    isDeleting,
    handleDeleteDataset,
  } = useEditDataset(repoId);

  useEffect(() => {
    if (repoId) setResumeRepoId(repoId);
  }, [repoId, setResumeRepoId]);

  // use the sames cameras as the ones used on the original recording
  useEffect(() => {
    if (selectedRecord) setCameras([...(selectedRecord.cameras ?? [])]);
  }, [selectedRecord, setCameras]);

  useEffect(() => {
    return () => {
      if (rec.releaseStreamsRef.current) {
        rec.releaseStreamsRef.current();
      }
    };
  }, []);

  const [isPrivate, setIsPrivate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const onUpload = async () => {
    await handleUploadToHub(isPrivate);
  };

  const onDelete = async () => {
    await handleDeleteDataset();
    setShowDeleteConfirm(false);
  };

  const openInHubViewer = (repo: string) => {
    const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(`/${repo}`)}`;
    const target = `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  if (isLoading || !datasetInfo) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-3" /> Loading dataset…
        </div>
      </div>
    );
  }

  const canRecord = !!selectedRecord && selectedRecord.is_clean;

  const syncReady = !syncLoading && syncStatus != null;
  const isSynced = syncReady && !syncStatus.needs_sync && syncStatus.on_hub;
  const needsPush = syncReady && syncStatus.needs_sync;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Home
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-white">Edit Dataset</h1>
              <p className="text-xs text-slate-400 font-mono break-all">
                {datasetInfo.dataset_repo_id}
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowDeleteConfirm(true)}
            variant="ghost"
            disabled={isDeleting}
            className="text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
        </div>

        {justRecorded && (
          <div className="rounded-lg border border-green-600/40 bg-green-900/20 p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-green-300 font-medium">Recording complete</p>
              <p className="text-sm text-slate-400">
                New episodes have been saved. Publish to the Hub when you are
                ready to sync them.
              </p>
            </div>
          </div>
        )}

        <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
          <CardHeader>
            <CardTitle className="text-white">Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <span className="text-slate-400 text-sm">Episodes</span>
                <p className="text-2xl font-bold text-green-400">
                  {datasetInfo.num_episodes ?? "—"}
                </p>
              </div>
              {datasetInfo.robot_type && (
                <div>
                  <span className="text-slate-400 text-sm">Robot type</span>
                  <p className="text-white">{datasetInfo.robot_type}</p>
                </div>
              )}
              {datasetInfo.fps != null && (
                <div>
                  <span className="text-slate-400 text-sm">FPS</span>
                  <p className="text-white">{datasetInfo.fps}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4 flex items-center gap-4 flex-wrap">
          {syncLoading && (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          )}

          {isSynced && (
            <>
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-slate-200 font-semibold">In sync with Hub</p>
                <p className="text-xs text-slate-500">
                  Local dataset matches the Hugging Face Hub copy.
                </p>
              </div>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openInHubViewer(datasetInfo.dataset_repo_id)}
                  className="text-blue-400 hover:bg-slate-800 hover:text-blue-300"
                >
                  <ExternalLink className="w-4 h-4 mr-1" /> View
                </Button>
              </div>
            </>
          )}

          {needsPush && (
            <>
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-amber-200 font-semibold">
                  Local changes not on Hub
                </p>
                <p className="text-xs text-slate-500">
                  {syncStatus.on_hub
                    ? "You have new episodes that aren't synced yet."
                    : "This dataset has never been published."}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <Checkbox
                    checked={isPrivate}
                    onCheckedChange={(checked) => setIsPrivate(checked === true)}
                    className="border-slate-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                  />
                  Private
                </label>
                <Button
                  onClick={onUpload}
                  disabled={isUploading}
                  size="sm"
                  className="bg-green-600 hover:bg-green-500 text-white"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CloudOff className="w-4 h-4 mr-2" />
                  )}
                  Publish
                </Button>
              </div>
            </>
          )}
        </div>

        <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
          <CardHeader>
            <CardTitle className="text-white">Add to dataset</CardTitle>
            <p className="text-sm text-slate-400">
              Record more episodes into this dataset. Use the same robot and
              cameras it was originally recorded with.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <RobotConfigManager
              selectedName={selectedName}
              selectedRecord={selectedRecord}
              availableNames={availableNames}
              isLoading={isLoadingRobots}
              selectRobot={selectRobot}
              createRobot={createRobot}
              deleteRobot={deleteRobot}
            />

            <RecordingSettingsFields
              singleTask={rec.singleTask}
              setSingleTask={rec.setSingleTask}
              numEpisodes={rec.numEpisodes}
              setNumEpisodes={rec.setNumEpisodes}
              episodeTimeS={rec.episodeTimeS}
              setEpisodeTimeS={rec.setEpisodeTimeS}
              resetTimeS={rec.resetTimeS}
              setResetTimeS={rec.setResetTimeS}
              streamingEncoding={rec.streamingEncoding}
              setStreamingEncoding={rec.setStreamingEncoding}
              cameras={rec.cameras}
              setCameras={rec.setCameras}
              releaseStreamsRef={rec.releaseStreamsRef}
              isResuming
            />

            <div className="space-y-2">
              <Button
                onClick={() => rec.startRecording({ fps: datasetInfo.fps })}
                disabled={!canRecord}
                className="bg-red-500 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Circle className="h-3 w-3 mr-2 fill-current" />
                Start Recording
              </Button>
              {!canRecord && (
                <p className="text-xs text-amber-400/80">
                  Select a calibrated robot above to start recording.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset from disk?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This permanently removes{" "}
              <span className="font-mono text-white">
                {datasetInfo.dataset_repo_id}
              </span>{" "}
              from your local cache. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
              Keep dataset
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EditDataset;
