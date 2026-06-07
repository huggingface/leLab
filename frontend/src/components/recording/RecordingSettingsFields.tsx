import React from "react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import CameraConfiguration, {
  CameraConfig,
} from "@/components/recording/CameraConfiguration";

interface RecordingSettingsFieldsProps {
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
  releaseStreamsRef?: React.MutableRefObject<(() => void) | null>;
  isResuming?: boolean;
}

const RecordingSettingsFields: React.FC<RecordingSettingsFieldsProps> = ({
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
  releaseStreamsRef,
  isResuming = false,
}) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <Label
            htmlFor="singleTask"
            className="text-sm font-medium text-slate-300"
          >
            Task Description *
          </Label>
          <Input
            id="singleTask"
            value={singleTask}
            onChange={(e) => setSingleTask(e.target.value)}
            placeholder="e.g., pick up the red block and place it on the blue square"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="numEpisodes"
            className="text-sm font-medium text-slate-300"
          >
            {isResuming ? "Additional episodes to record" : "Number of Episodes"}
          </Label>
          <NumberInput
            id="numEpisodes"
            min="1"
            max="100"
            value={numEpisodes}
            onChange={(v) => {
              if (v !== undefined) setNumEpisodes(v);
            }}
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label
              htmlFor="episodeTimeS"
              className="text-sm font-medium text-slate-300"
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
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="resetTimeS"
              className="text-sm font-medium text-slate-300"
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
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
      </div>

      <CameraConfiguration
        cameras={cameras}
        onCamerasChange={setCameras}
        releaseStreamsRef={releaseStreamsRef}
      />

      <Collapsible className="space-y-4 group">
        <CollapsibleTrigger className="flex items-center justify-between w-full text-lg font-semibold text-white border-b border-slate-700 pb-2">
          <span>Advanced Parameters</span>
          <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="streamingEncoding"
              checked={streamingEncoding}
              onCheckedChange={(value) => setStreamingEncoding(value === true)}
              className="mt-0.5 border-slate-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
            />
            <div className="space-y-1">
              <Label
                htmlFor="streamingEncoding"
                className="text-sm font-medium text-slate-200 cursor-pointer"
              >
                Streaming video encoding
              </Label>
              <p className="text-xs text-slate-500">
                Encodes frames in real time during capture so each episode saves
                almost instantly. Uncheck to fall back to the slower
                PNG-then-encode flow.
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default RecordingSettingsFields;
