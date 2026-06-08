import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Camera, Plus, X, VideoOff, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAvailableCameras } from "@/hooks/useAvailableCameras";
import { useCameraStream } from "@/hooks/useCameraStream";

export interface CameraConfig {
  id: string;
  name: string;
  type: string;
  camera_index?: number; // cv2 index — what the recorder opens
  device_id: string; // Browser deviceId matched to the cv2 index by AVFoundation localizedName
  width: number;
  height: number;
  fps?: number;
  fourcc?: string; // 4-char OpenCV pixel format (e.g. "MJPG"); undefined = auto-detect
  backend?: string; // Cv2Backends name (e.g. "AVFOUNDATION"); undefined = platform default
}

interface CameraConfigurationProps {
  cameras: CameraConfig[];
  onCamerasChange: (cameras: CameraConfig[]) => void;
  releaseStreamsRef?: React.MutableRefObject<(() => void) | null>; // Ref to expose stream release function
}

const CameraConfiguration: React.FC<CameraConfigurationProps> = ({
  cameras,
  onCamerasChange,
  releaseStreamsRef,
}) => {
  const { toast } = useToast();

  const {
    cameras: availableCameras,
    isLoading: isLoadingCameras,
    refresh: refreshCameras,
  } = useAvailableCameras();
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>("");
  const [cameraName, setCameraName] = useState("");

  // cv2's AVFoundation order is uniqueID-sorted, so plugging/unplugging a
  // device between sessions shifts indices. The browser device_id stays
  // stable per-origin, so use it to refresh each seeded camera's
  // camera_index — otherwise the recorder opens the wrong physical device
  // and the dropdown's "already added" check guards a stale index.
  useEffect(() => {
    if (availableCameras.length === 0 || cameras.length === 0) return;
    let changed = false;
    const refreshed = cameras.map((cam) => {
      if (!cam.device_id) return cam;
      const match = availableCameras.find((m) => m.deviceId === cam.device_id);
      if (match && match.index !== cam.camera_index) {
        changed = true;
        return { ...cam, camera_index: match.index };
      }
      return cam;
    });
    if (changed) onCamerasChange(refreshed);
    // We deliberately don't depend on `cameras`/`onCamerasChange` to avoid
    // re-running every keystroke in the camera-name input — re-syncing only
    // when the available-cameras list itself changes is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCameras]);

  const addCamera = () => {
    if (!selectedCameraIndex || !cameraName.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a camera and provide a name.",
        variant: "destructive",
      });
      return;
    }

    const cameraIndex = parseInt(selectedCameraIndex);
    const selectedCamera = availableCameras.find(
      (cam) => cam.index === cameraIndex
    );

    if (!selectedCamera) {
      toast({
        title: "Invalid Camera",
        description: "Selected camera is not available.",
        variant: "destructive",
      });
      return;
    }

    // Block duplicates by either cv2 index or browser deviceId — a stale
    // camera_index in a seeded camera can otherwise let the same physical
    // device sneak in under a different index.
    const isDuplicate = cameras.some(
      (cam) =>
        cam.camera_index === selectedCamera.index ||
        (selectedCamera.deviceId && cam.device_id === selectedCamera.deviceId),
    );
    if (isDuplicate) {
      toast({
        title: "Camera Already Added",
        description: "This camera is already in the configuration.",
        variant: "destructive",
      });
      return;
    }

    const newCamera: CameraConfig = {
      id: `camera_${Date.now()}`,
      name: cameraName.trim(),
      type: "opencv",
      camera_index: selectedCamera.index,
      device_id: selectedCamera.deviceId,
      width: 640,
      height: 480,
      fps: 30,
    };

    onCamerasChange([...cameras, newCamera]);

    setSelectedCameraIndex("");
    setCameraName("");

    toast({
      title: "Camera Added",
      description: `${newCamera.name} has been added to the configuration.`,
    });
  };

  const removeCamera = (cameraId: string) => {
    onCamerasChange(cameras.filter((cam) => cam.id !== cameraId));
    toast({
      title: "Camera Removed",
      description: "Camera has been removed from the configuration.",
    });
  };

  const updateCamera = (cameraId: string, updates: Partial<CameraConfig>) => {
    onCamerasChange(
      cameras.map((cam) =>
        cam.id === cameraId ? { ...cam, ...updates } : cam
      )
    );
  };

  // When the recording session is starting, the parent calls
  // releaseStreamsRef.current() to make every CameraPreview drop its browser
  // stream so cv2.VideoCapture can grab the camera exclusively.
  const [streamsPaused, setStreamsPaused] = useState(false);
  const releaseAllCameraStreams = useCallback(() => {
    setStreamsPaused(true);
  }, []);

  useEffect(() => {
    if (releaseStreamsRef) {
      releaseStreamsRef.current = releaseAllCameraStreams;
    }
  }, [releaseStreamsRef, releaseAllCameraStreams]);


  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
        Camera Configuration
      </h3>

      {/* Add Camera Section */}
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-4">
        <h4 className="text-md font-medium text-gray-300">Add Camera</h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-gray-300">
                Available Cameras
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => refreshCameras()}
                disabled={isLoadingCameras}
                className="h-6 w-6 text-gray-400 hover:text-white"
                title="Rescan for cameras (e.g. after plugging in a new USB camera)"
                aria-label="Rescan for cameras"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingCameras ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
            <Select
              value={selectedCameraIndex}
              onValueChange={setSelectedCameraIndex}
              disabled={isLoadingCameras}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                <SelectValue
                  placeholder={
                    isLoadingCameras ? "Loading cameras..." : "Select camera"
                  }
                />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                {availableCameras.map((camera) => {
                  const alreadyAdded = cameras.some(
                    (cam) =>
                      cam.camera_index === camera.index ||
                      (camera.deviceId && cam.device_id === camera.deviceId),
                  );
                  return (
                    <SelectItem
                      key={camera.index}
                      value={camera.index.toString()}
                      className="text-white hover:bg-gray-700"
                      disabled={!camera.available || alreadyAdded}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{camera.name}</span>
                        <span className="text-xs text-gray-400">
                          Index {camera.index}
                          {alreadyAdded && " · already added"}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-300">
              Camera Name
            </Label>
            <Input
              value={cameraName}
              onChange={(e) => setCameraName(e.target.value)}
              placeholder="e.g., workspace_cam"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          <div className="space-y-2 flex flex-col justify-end">
            <Button
              onClick={addCamera}
              className="bg-blue-500 hover:bg-blue-600 text-white"
              disabled={!selectedCameraIndex || !cameraName.trim()}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Camera
            </Button>
          </div>
        </div>
      </div>

      {/* Configured Cameras */}
      {cameras.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-300">
            Configured Cameras ({cameras.length})
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
            {cameras.map((camera) => (
              <CameraPreview
                key={camera.id}
                camera={camera}
                paused={streamsPaused}
                onRemove={() => removeCamera(camera.id)}
                onUpdate={(updates) => updateCamera(camera.id, updates)}
              />
            ))}
          </div>
        </div>
      )}

      {cameras.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <Camera className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <p>No cameras configured. Add a camera to get started.</p>
        </div>
      )}
    </div>
  );
};

interface CameraPreviewProps {
  camera: CameraConfig;
  paused: boolean;
  onRemove: () => void;
  onUpdate: (updates: Partial<CameraConfig>) => void;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({
  camera,
  paused,
  onRemove,
  onUpdate,
}) => {
  const { videoRef, hasError: streamError } = useCameraStream(
    camera.device_id,
    paused
  );
  const showVideo = !paused && camera.device_id && !streamError;
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      <div className="aspect-[4/3] bg-gray-800 relative">
        {showVideo ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <VideoOff className="w-8 h-8 text-gray-500 mb-2" />
            <span className="text-gray-500 text-sm">
              {paused
                ? "Preview paused"
                : camera.device_id
                ? "Preview failed"
                : "No browser match"}
            </span>
          </div>
        )}
      </div>

      {/* Camera Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="font-medium text-white truncate">{camera.name}</h5>
          <Button
            onClick={onRemove}
            size="sm"
            variant="ghost"
            className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-16">Resolution:</span>
            <div className="flex items-center gap-1">
              <NumberInput
                value={camera.width}
                onChange={(v) => {
                  if (v !== undefined) onUpdate({ width: v });
                }}
                className="bg-gray-800 border-gray-700 text-white text-xs h-6 px-2 w-16"
                min="320"
                max="1920"
              />
              <span className="flex items-center">×</span>
              <NumberInput
                value={camera.height}
                onChange={(v) => {
                  if (v !== undefined) onUpdate({ height: v });
                }}
                className="bg-gray-800 border-gray-700 text-white text-xs h-6 px-2 w-16"
                min="240"
                max="1080"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16">FPS:</span>
            <NumberInput
              value={camera.fps ?? 30}
              onChange={(v) => {
                if (v !== undefined) onUpdate({ fps: v });
              }}
              className="bg-gray-800 border-gray-700 text-white text-xs h-6 px-2 w-16"
              min="10"
              max="60"
            />
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Type: {camera.type} | Device: {camera.device_id?.substring(0, 10)}...
        </div>
      </div>
    </div>
  );
};

export default CameraConfiguration;
