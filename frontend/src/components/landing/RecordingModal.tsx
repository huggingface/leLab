import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { CameraConfig } from "@/components/recording/CameraConfiguration";
import RecordingSettingsFields from "@/components/recording/RecordingSettingsFields";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { RobotRecord } from "@/hooks/useRobots";

interface RecordingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robot: RobotRecord | null;
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

  const canStart = !!robot && robot.is_clean;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[600px] p-8 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-center items-center mb-4">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">REC</span>
            </div>
          </div>
          <DialogTitle className="text-white text-center text-2xl font-bold">
            Configure Recording
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <DialogDescription className="text-slate-400 text-base leading-relaxed text-center">
            Pick a configured robot and dataset parameters for recording.
          </DialogDescription>

          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
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
              <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
                Dataset Configuration
              </h3>
              <div className="space-y-2">
                <Label
                  htmlFor="datasetName"
                  className="text-sm font-medium text-slate-300"
                >
                  Dataset Name *
                </Label>
                <Input
                  id="datasetName"
                  value={datasetName}
                  onChange={(e) =>
                    setDatasetName(
                      e.target.value.replace(/[^A-Za-z0-9._-]/g, "_")
                    )
                  }
                  placeholder="my_dataset"
                  className="bg-slate-900 border-slate-600 text-white rounded-lg"
                />
                <p className="text-xs text-slate-500">
                  Letters, numbers, <code>.</code> <code>_</code>{" "}
                  <code>-</code> only — other characters become{" "}
                  <code>_</code>.
                </p>
                {datasetName &&
                  (auth.status === "authenticated" ? (
                    <p className="text-xs text-slate-500">
                      Will be saved as{" "}
                      <span className="text-slate-300 font-mono">
                        {auth.username}/{datasetName}
                      </span>
                    </p>
                  ) : auth.status === "unauthenticated" ? (
                    <p className="text-xs text-amber-400/80">
                      Log in to Hugging Face to set the repository owner.
                    </p>
                  ) : null)}
              </div>
            </div>

            <RecordingSettingsFields
              singleTask={singleTask}
              setSingleTask={setSingleTask}
              numEpisodes={numEpisodes}
              setNumEpisodes={setNumEpisodes}
              episodeTimeS={episodeTimeS}
              setEpisodeTimeS={setEpisodeTimeS}
              resetTimeS={resetTimeS}
              setResetTimeS={setResetTimeS}
              streamingEncoding={streamingEncoding}
              setStreamingEncoding={setStreamingEncoding}
              cameras={cameras}
              setCameras={setCameras}
              releaseStreamsRef={releaseStreamsRef}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              onClick={onStart}
              disabled={!canStart}
              className="w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white px-10 py-6 text-lg transition-all shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start Recording
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="w-full sm:w-auto border-slate-600 hover:border-slate-400 px-10 py-6 text-lg text-slate-400 bg-slate-800 hover:bg-slate-700"
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
