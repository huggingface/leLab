import React from "react";
import { VideoOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AvailableCamera } from "@/hooks/useAvailableCameras";
import { ImageFeatures } from "@/lib/checkpointsApi";
import { useCameraStream } from "@/hooks/useCameraStream";

const CameraThumbnail: React.FC<{ deviceId: string; paused: boolean }> = ({
  deviceId,
  paused,
}) => {
  const { videoRef, hasError } = useCameraStream(deviceId, paused);
  if (paused || hasError || !deviceId) {
    return (
      <div className="w-32 h-24 bg-gray-800 rounded border border-gray-700 flex flex-col items-center justify-center">
        <VideoOff className="w-5 h-5 text-gray-500 mb-1" />
        <span className="text-[10px] text-gray-500">
          {paused ? "Released" : "No preview"}
        </span>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="w-32 h-24 object-cover rounded border border-gray-700 bg-black"
    />
  );
};

interface CameraBindingsProps {
  imageFeatures: ImageFeatures;
  bindings: Record<string, number | null>;
  onBind: (name: string, index: number) => void;
  availableCameras: AvailableCamera[];
  /** Drop the previews so the backend can open the same devices. */
  paused: boolean;
}

/** One row per expected camera: its resolution, a physical camera picker and a preview. */
const CameraBindings: React.FC<CameraBindingsProps> = ({
  imageFeatures,
  bindings,
  onBind,
  availableCameras,
  paused,
}) => (
  <>
    {Object.entries(imageFeatures).map(([name, dims]) => {
      const value = bindings[name];
      const bound =
        value != null ? availableCameras.find((c) => c.index === value) : undefined;
      return (
        <div key={name} className="flex items-center gap-3">
          <div className="flex-1">
            <Label className="text-sm font-medium text-gray-200">{name}</Label>
            <p className="text-xs text-gray-500">
              {dims.width}×{dims.height}
            </p>
          </div>
          <Select
            value={value != null ? String(value) : undefined}
            onValueChange={(v) => onBind(name, Number(v))}
          >
            <SelectTrigger className="bg-gray-800 border-gray-700 text-white w-56">
              <SelectValue placeholder="Select a camera" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700 text-white">
              {availableCameras.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-gray-500">
                  No cameras detected
                </div>
              ) : (
                availableCameras.map((cam) => (
                  <SelectItem key={cam.index} value={String(cam.index)}>
                    #{cam.index} — {cam.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <CameraThumbnail deviceId={bound?.deviceId ?? ""} paused={paused} />
        </div>
      );
    })}
  </>
);

export default CameraBindings;
