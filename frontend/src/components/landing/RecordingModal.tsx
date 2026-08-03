import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle, ChevronDown, Disc } from "lucide-react";
import CameraConfiguration, {
  CameraConfig,
} from "@/components/recording/CameraConfiguration";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { RobotRecord } from "@/hooks/useRobots";
import { ResumeDatasetInfo } from "@/pages/Landing";

interface RecordingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robot: RobotRecord | null;
  resumeMode?: boolean;
  resumeInfo?: ResumeDatasetInfo | null;
  episodeTarget?: number | null;
  setEpisodeTarget?: (value: number | null) => void;
  datasetName: string;
  setDatasetName: (value: string) => void;
  singleTask: string;
  setSingleTask: (value: string) => void;
  numEpisodes: number;
  setNumEpisodes: (value: number) => void;
  episodeTimeS: number;
  setEpisodeTimeS: (value: number) => void;
  resetTimeS: number;
  setResetTimeS: (value: number) => void;
  streamingEncoding: boolean;
  setStreamingEncoding: (value: boolean) => void;
  cameras: CameraConfig[];
  setCameras: (cameras: CameraConfig[]) => void;
  onStart: () => void;
  releaseStreamsRef?: React.MutableRefObject<(() => void) | null>;
}

const RecordingModal: React.FC<RecordingModalProps> = ({
  open,
  onOpenChange,
  robot,
  resumeMode = false,
  resumeInfo = null,
  episodeTarget = null,
  setEpisodeTarget,
  datasetName,
  setDatasetName,
  singleTask,
  setSingleTask,
  numEpisodes,
  setNumEpisodes,
  episodeTimeS,
  setEpisodeTimeS,
  resetTimeS,
  setResetTimeS,
  streamingEncoding,
  setStreamingEncoding,
  cameras,
  setCameras,
  onStart,
  releaseStreamsRef,
}) => {
  const { auth } = useHfAuth();

  const configuredCameraNames = cameras.map((c) => c.name);
  const missingCameras = resumeInfo
    ? resumeInfo.cameras.filter((c) => !configuredCameraNames.includes(c))
    : [];
  const extraCameras = resumeInfo
    ? configuredCameraNames.filter((c) => !resumeInfo.cameras.includes(c))
    : [];
  const camerasMatch = missingCameras.length === 0 && extraCameras.length === 0;
  const setupOk = !resumeMode || !resumeInfo || camerasMatch;

  const canStart = !!robot && robot.is_clean && setupOk;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-[600px] p-8 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-center items-center mb-4">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">REC</span>
            </div>
          </div>
          <DialogTitle className="text-white text-center text-2xl font-bold">
            {resumeMode ? "Continue Recording" : "Configure Recording"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <DialogDescription className="text-gray-400 text-base leading-relaxed text-center">
            Pick a configured robot and dataset parameters for recording.
          </DialogDescription>

          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
                Robot Configuration
              </h3>
              {!robot ? (
                <Alert className="bg-amber-900/40 border-amber-700 text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Select and configure a robot on the Landing page before
                    recording.
                  </AlertDescription>
                </Alert>
              ) : !robot.is_clean ? (
                <Alert className="bg-amber-900/40 border-amber-700 text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{robot.name}</strong> is missing a calibration.
                    Configure it before recording.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-slate-200">
                    Recording with <strong>{robot.name}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
                Dataset Configuration
              </h3>
              {resumeMode && (
                <Alert className="bg-blue-900/40 border-blue-700 text-blue-100">
                  <Disc className="h-4 w-4" />
                  <AlertDescription>
                    New episodes will be appended to{" "}
                    <strong className="font-mono">{datasetName}</strong>
                    {resumeInfo && (
                      <> ({resumeInfo.numEpisodes} episodes so far)</>
                    )}
                    . The setup must match the original recording exactly.
                  </AlertDescription>
                </Alert>
              )}
              {resumeMode && resumeInfo && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3 space-y-2">
                  <p className="text-sm font-medium text-gray-200">
                    Required setup (from the dataset)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5">
                      <span className="text-gray-500 block">Robot type</span>
                      <span className="text-gray-200 font-mono">
                        {resumeInfo.robotType}
                      </span>
                    </div>
                    <div className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5">
                      <span className="text-gray-500 block">FPS</span>
                      <span className="text-gray-200 font-mono">
                        {resumeInfo.fps}
                      </span>
                    </div>
                    <div
                      className={`rounded px-2 py-1.5 border ${
                        camerasMatch
                          ? "bg-gray-800 border-gray-700"
                          : "bg-red-900/40 border-red-700"
                      }`}
                    >
                      <span className="text-gray-500 block">Cameras</span>
                      <span
                        className={`font-mono ${camerasMatch ? "text-gray-200" : "text-red-300"}`}
                      >
                        {resumeInfo.cameras.join(", ") || "none"}
                      </span>
                    </div>
                  </div>
                  {!camerasMatch && (
                    <Alert className="bg-red-900/40 border-red-700 text-red-100">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Camera setup doesn&apos;t match the dataset.
                        {missingCameras.length > 0 && (
                          <>
                            {" "}
                            Missing:{" "}
                            <strong className="font-mono">
                              {missingCameras.join(", ")}
                            </strong>
                            .
                          </>
                        )}
                        {extraCameras.length > 0 && (
                          <>
                            {" "}
                            Not in the dataset:{" "}
                            <strong className="font-mono">
                              {extraCameras.join(", ")}
                            </strong>
                            .
                          </>
                        )}{" "}
                        Rename or adjust your cameras below to match, then the
                        button will unlock.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="datasetName"
                    className="text-sm font-medium text-gray-300"
                  >
                    Dataset Name *
                  </Label>
                  <Input
                    id="datasetName"
                    value={datasetName}
                    disabled={resumeMode}
                    onChange={(e) =>
                      setDatasetName(
                        e.target.value.replace(/[^A-Za-z0-9._-]/g, "_")
                      )
                    }
                    placeholder="my_dataset"
                    className="bg-gray-800 border-gray-700 text-white disabled:opacity-60"
                  />
                  {!resumeMode && (
                    <p className="text-xs text-gray-500">
                      Letters, numbers, <code>.</code> <code>_</code>{" "}
                      <code>-</code> only — other characters become{" "}
                      <code>_</code>.
                    </p>
                  )}
                  {datasetName &&
                    !resumeMode &&
                    (auth.status === "authenticated" ? (
                      <p className="text-xs text-gray-500">
                        Will be saved as{" "}
                        <span className="text-gray-300 font-mono">
                          {auth.username}/{datasetName}
                        </span>
                      </p>
                    ) : auth.status === "unauthenticated" ? (
                      <p className="text-xs text-amber-400/80">
                        Log in to Hugging Face to set the repository owner.
                      </p>
                    ) : null)}
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="singleTask"
                    className="text-sm font-medium text-gray-300"
                  >
                    Task Description *
                  </Label>
                  <Input
                    id="singleTask"
                    value={singleTask}
                    onChange={(e) => setSingleTask(e.target.value)}
                    placeholder="e.g., pick up the red block and place it on the blue square"
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="numEpisodes"
                      className="text-sm font-medium text-gray-300"
                    >
                      {resumeMode ? "Episodes to add" : "Number of Episodes"}
                    </Label>
                    <NumberInput
                      id="numEpisodes"
                      min="1"
                      max="100"
                      value={numEpisodes}
                      onChange={(v) => {
                        if (v !== undefined) setNumEpisodes(v);
                      }}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="episodeTarget"
                      className="text-sm font-medium text-gray-300"
                    >
                      Episode goal (optional)
                    </Label>
                    <NumberInput
                      id="episodeTarget"
                      min="1"
                      value={episodeTarget ?? undefined}
                      onChange={(v) => {
                        setEpisodeTarget?.(v ?? null);
                      }}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                    <p className="text-xs text-gray-500">
                      Total episodes you aim for across all sessions — shows
                      progress in the dataset list.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="episodeTimeS"
                      className="text-sm font-medium text-gray-300"
                    >
                      Episode duration (seconds)
                    </Label>
                    <NumberInput
                      id="episodeTimeS"
                      min="1"
                      value={episodeTimeS}
                      onChange={(v) => {
                        if (v !== undefined) setEpisodeTimeS(v);
                      }}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="resetTimeS"
                      className="text-sm font-medium text-gray-300"
                    >
                      Reset duration (seconds)
                    </Label>
                    <NumberInput
                      id="resetTimeS"
                      min="1"
                      value={resetTimeS}
                      onChange={(v) => {
                        if (v !== undefined) setResetTimeS(v);
                      }}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <CameraConfiguration
                cameras={cameras}
                onCamerasChange={setCameras}
                releaseStreamsRef={releaseStreamsRef}
                readOnly
              />
              <p className="text-xs text-gray-500">
                These are the cameras set up for this robot. To add or change a
                camera, configure it on the Calibration page.
              </p>
            </div>

            <Collapsible className="space-y-4 group">
              <CollapsibleTrigger className="flex items-center justify-between w-full text-lg font-semibold text-white border-b border-gray-700 pb-2">
                <span>Advanced Parameters</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="streamingEncoding"
                    checked={streamingEncoding}
                    onCheckedChange={(value) =>
                      setStreamingEncoding(value === true)
                    }
                    className="mt-0.5 border-gray-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="streamingEncoding"
                      className="text-sm font-medium text-gray-200 cursor-pointer"
                    >
                      Streaming video encoding
                    </Label>
                    <p className="text-xs text-gray-500">
                      Encodes frames in real time during capture so each
                      episode saves almost instantly. Uncheck to fall back to
                      the slower PNG-then-encode flow.
                    </p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              onClick={onStart}
              disabled={!canStart}
              className="w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white px-10 py-6 text-lg transition-all shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resumeMode ? "Resume Recording" : "Start Recording"}
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="w-full sm:w-auto border-gray-500 hover:border-gray-200 px-10 py-6 text-lg text-zinc-500 bg-zinc-900 hover:bg-zinc-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecordingModal;
