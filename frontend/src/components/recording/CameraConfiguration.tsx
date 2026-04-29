import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { Camera, Plus, X, Video, VideoOff } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";

export interface CameraConfig {
  id: string;
  name: string;
  type: string;
  camera_index?: number; // Keep for backend compatibility
  device_id: string; // Use this for actual camera selection
  width: number;
  height: number;
  fps?: number;
}

interface CameraConfigurationProps {
  cameras: CameraConfig[];
  onCamerasChange: (cameras: CameraConfig[]) => void;
  releaseStreamsRef?: React.MutableRefObject<(() => void) | null>; // Ref to expose stream release function
}

interface AvailableCamera {
  index: number;
  deviceId: string;
  name: string;
  available: boolean;
}

const CameraConfiguration: React.FC<CameraConfigurationProps> = ({
  cameras,
  onCamerasChange,
  releaseStreamsRef,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const [availableCameras, setAvailableCameras] = useState<AvailableCamera[]>(
    []
  );
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>("");
  const [cameraName, setCameraName] = useState("");
  const [isLoadingCameras, setIsLoadingCameras] = useState(false);
  const [cameraStreams, setCameraStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );

  // Fetch available cameras on component mount
  useEffect(() => {
    fetchAvailableCameras();
  }, []);

  const fetchAvailableCameras = async () => {
    console.log("🚀 fetchAvailableCameras() called");
    setIsLoadingCameras(true);
    try {
      console.log(
        "📡 Trying backend endpoint:",
        `${baseUrl}/available-cameras`
      );
      const response = await fetchWithHeaders(`${baseUrl}/available-cameras`);
      console.log("📡 Backend response status:", response.status, response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log("📡 Backend camera data received:", data);
        setAvailableCameras(data.cameras || []);

        // Always also try browser detection to get device IDs
        console.log("🔄 Also running browser detection for device IDs...");
        await detectBrowserCameras();
      } else {
        console.log("📡 Backend failed, falling back to browser detection");
        // Fallback to browser camera detection
        await detectBrowserCameras();
      }
    } catch (error) {
      console.error("📡 Error fetching cameras from backend:", error);
      console.log("🔄 Falling back to browser detection due to error");
      // Fallback to browser camera detection
      await detectBrowserCameras();
    } finally {
      setIsLoadingCameras(false);
      console.log("✅ fetchAvailableCameras() completed");
    }
  };

  const detectBrowserCameras = async () => {
    try {
      // First, request camera permissions to get proper device IDs and labels
      console.log("🔐 Requesting camera permissions for device detection...");
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        console.log("✅ Camera permission granted, stopping temp stream");
        tempStream.getTracks().forEach((track) => track.stop());
      } catch (permError) {
        console.warn(
          "⚠️ Camera permission denied, device IDs may be empty:",
          permError
        );
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      console.log(
        "🔍 Raw video devices from enumerateDevices:",
        videoDevices.map((d) => ({
          deviceId: d.deviceId,
          label: d.label,
          kind: d.kind,
        }))
      );

      const detectedCameras = videoDevices.map((device, index) => ({
        index,
        deviceId: device.deviceId || `fallback_${index}`, // Fallback if deviceId is empty
        name: device.label || `Camera ${index + 1}`,
        available: true,
      }));

      console.log("🎬 Browser cameras with indices mapped:", detectedCameras);
      setAvailableCameras(detectedCameras);
    } catch (error) {
      console.error("Error detecting browser cameras:", error);
      toast({
        title: "Camera Detection Failed",
        description:
          "Could not detect available cameras. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const startCameraPreview = async (cameraConfig: CameraConfig) => {
    try {
      console.log(
        "🎥 Starting camera preview for:",
        cameraConfig.name,
        "with device_id:",
        cameraConfig.device_id,
        "camera_index:",
        cameraConfig.camera_index
      );

      // Create constraints with fallbacks to avoid OverconstrainedError
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: cameraConfig.width, min: 320, max: 1920 },
          height: { ideal: cameraConfig.height, min: 240, max: 1080 },
          frameRate: { ideal: cameraConfig.fps || 30, min: 10, max: 60 },
        },
      };

      // Only add deviceId if it's not a fallback
      if (
        cameraConfig.device_id &&
        !cameraConfig.device_id.startsWith("fallback_")
      ) {
        (constraints.video as MediaTrackConstraints).deviceId = {
          exact: cameraConfig.device_id, // Changed from 'ideal' to 'exact'
        };
        console.log(
          "🔧 Using EXACT deviceId constraint:",
          cameraConfig.device_id
        );
      } else {
        console.log("⚠️ No valid deviceId, will use default camera");
      }

      console.log(
        "📋 Final constraints:",
        JSON.stringify(constraints, null, 2)
      );

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Get the actual device being used
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log("✅ Actual camera settings:", {
          deviceId: settings.deviceId,
          label: videoTrack.label,
          width: settings.width,
          height: settings.height,
        });

        // Check if we got the camera we requested
        if (
          cameraConfig.device_id &&
          settings.deviceId !== cameraConfig.device_id
        ) {
          console.warn(
            "⚠️ CAMERA MISMATCH! Requested:",
            cameraConfig.device_id,
            "Got:",
            settings.deviceId
          );
        } else {
          console.log("✅ Camera match confirmed!");
        }
      }

      console.log(
        "Camera stream created successfully for:",
        cameraConfig.name,
        {
          streamId: stream.id,
          tracks: stream.getTracks().length,
          videoTracks: stream.getVideoTracks().length,
          active: stream.active,
        }
      );

      setCameraStreams((prev) => {
        const newMap = new Map(prev.set(cameraConfig.id, stream));
        console.log("Updated camera streams map:", Array.from(newMap.keys()));
        return newMap;
      });

      // Force a small delay to ensure state update
      await new Promise((resolve) => setTimeout(resolve, 100));

      return stream;
    } catch (error: unknown) {
      console.error("Error starting camera preview:", error);

      const isMediaError = error instanceof Error;
      const errorName = isMediaError ? error.name : "";
      const errorMessage = isMediaError ? error.message : "Unknown error";

      // If constraints failed, try with basic constraints
      if (
        errorName === "OverconstrainedError" ||
        errorName === "NotReadableError"
      ) {
        try {
          console.log("Retrying with basic constraints...");
          const basicStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
          });

          setCameraStreams(
            (prev) => new Map(prev.set(cameraConfig.id, basicStream))
          );
          toast({
            title: "Camera Preview Started",
            description: `${cameraConfig.name} started with basic settings due to constraint issues.`,
          });
          return basicStream;
        } catch (basicError) {
          console.error("Error with basic constraints:", basicError);
        }
      }

      toast({
        title: "Camera Preview Failed",
        description: `Could not start preview for ${cameraConfig.name}: ${errorMessage}`,
        variant: "destructive",
      });
      return null;
    }
  };

  const stopCameraPreview = (cameraId: string) => {
    const stream = cameraStreams.get(cameraId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setCameraStreams((prev) => {
        const newMap = new Map(prev);
        newMap.delete(cameraId);
        return newMap;
      });
    }
  };

  const addCamera = async () => {
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

    // Check if camera is already added
    if (cameras.some((cam) => cam.camera_index === cameraIndex)) {
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

    console.log("🆕 Creating new camera config:", {
      name: newCamera.name,
      camera_index: newCamera.camera_index,
      device_id: newCamera.device_id,
      selectedCamera: selectedCamera,
    });

    const updatedCameras = [...cameras, newCamera];
    onCamerasChange(updatedCameras);

    // Start preview for the new camera
    await startCameraPreview(newCamera);

    // Reset form
    setSelectedCameraIndex("");
    setCameraName("");

    toast({
      title: "Camera Added",
      description: `${newCamera.name} has been added to the configuration.`,
    });
  };

  const removeCamera = (cameraId: string) => {
    stopCameraPreview(cameraId);
    const updatedCameras = cameras.filter((cam) => cam.id !== cameraId);
    onCamerasChange(updatedCameras);

    toast({
      title: "Camera Removed",
      description: "Camera has been removed from the configuration.",
    });
  };

  const updateCamera = (cameraId: string, updates: Partial<CameraConfig>) => {
    const updatedCameras = cameras.map((cam) =>
      cam.id === cameraId ? { ...cam, ...updates } : cam
    );
    onCamerasChange(updatedCameras);
  };

  // Function to release all camera streams (for recording start)
  const releaseAllCameraStreams = useCallback(() => {
    console.log("🔓 Releasing all camera streams for recording...");
    cameraStreams.forEach((stream, cameraId) => {
      console.log(`🔓 Stopping stream for camera: ${cameraId}`);
      stream.getTracks().forEach((track) => track.stop());
    });
    setCameraStreams(new Map());
    console.log("✅ All camera streams released");
  }, [cameraStreams]);

  // Expose the release function to parent component via ref
  useEffect(() => {
    if (releaseStreamsRef) {
      releaseStreamsRef.current = releaseAllCameraStreams;
    }
  }, [releaseStreamsRef, releaseAllCameraStreams]);

  // Clean up streams on component unmount
  useEffect(() => {
    return () => {
      cameraStreams.forEach((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
    };
  }, []);

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
            <Label className="text-sm font-medium text-gray-300">
              Available Cameras
            </Label>
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
                {availableCameras.map((camera) => (
                  <SelectItem
                    key={camera.index}
                    value={camera.index.toString()}
                    className="text-white hover:bg-gray-700"
                    disabled={
                      !camera.available ||
                      cameras.some((cam) => cam.camera_index === camera.index)
                    }
                  >
                    {camera.name} (Index {camera.index})
                    {cameras.some((cam) => cam.camera_index === camera.index) &&
                      " (Already added)"}
                  </SelectItem>
                ))}
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
                stream={cameraStreams.get(camera.id)}
                onRemove={() => removeCamera(camera.id)}
                onUpdate={(updates) => updateCamera(camera.id, updates)}
                onStartPreview={() => startCameraPreview(camera)}
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
  stream?: MediaStream;
  onRemove: () => void;
  onUpdate: (updates: Partial<CameraConfig>) => void;
  onStartPreview: () => void;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({
  camera,
  stream,
  onRemove,
  onUpdate,
  onStartPreview,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  // Debug logging for props
  console.log("CameraPreview render for:", camera.name, {
    hasStream: !!stream,
    streamActive: stream?.active,
    isPreviewActive,
    streamId: stream?.id,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      console.log("Setting stream to video element for camera:", camera.name);
      video.srcObject = stream;

      // Explicitly play the video to ensure it starts
      const playVideo = async () => {
        try {
          await video.play();
          console.log("Video playing successfully for camera:", camera.name);
          setIsPreviewActive(true);
        } catch (error) {
          console.error("Error playing video for camera:", camera.name, error);
          // Try to play without audio in case autoplay is blocked
          video.muted = true;
          try {
            await video.play();
            console.log("Video playing muted for camera:", camera.name);
            setIsPreviewActive(true);
          } catch (mutedError) {
            console.error("Error playing muted video:", mutedError);
            setIsPreviewActive(false);
          }
        }
      };

      // Wait for metadata to load before playing
      if (video.readyState >= 1) {
        playVideo();
      } else {
        video.addEventListener("loadedmetadata", playVideo, { once: true });
      }
    } else {
      console.log("No stream or video element for camera:", camera.name);
      setIsPreviewActive(false);
    }
  }, [stream, camera.name]);

  useEffect(() => {
    // Auto-start preview when camera is added
    if (!stream && !isPreviewActive) {
      console.log("Auto-starting preview for camera:", camera.name);
      onStartPreview();
    }
  }, [stream, isPreviewActive, onStartPreview, camera.name]);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Camera Preview */}
      <div className="aspect-[4/3] bg-gray-800 relative">
        {/* Always show the video element if we have a stream, regardless of isPreviewActive */}
        {stream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
              onLoadedMetadata={() =>
                console.log("Video metadata loaded for:", camera.name)
              }
              onPlay={() =>
                console.log("Video started playing for:", camera.name)
              }
              onError={(e) => console.error("Video error for:", camera.name, e)}
              onCanPlay={() => console.log("Video can play for:", camera.name)}
            />
            <div className="absolute top-2 left-2">
              <div className="flex items-center gap-1 bg-black/50 px-2 py-1 rounded text-xs">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-400">
                  {isPreviewActive ? "LIVE" : "LOADING"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <VideoOff className="w-8 h-8 text-gray-500 mb-2" />
            <span className="text-gray-500 text-sm">Preview not available</span>
            <Button
              onClick={onStartPreview}
              size="sm"
              className="mt-2 bg-blue-500 hover:bg-blue-600"
            >
              <Video className="w-3 h-3 mr-1" />
              Start Preview
            </Button>
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
              <Input
                type="number"
                value={camera.width}
                onChange={(e) =>
                  onUpdate({ width: parseInt(e.target.value) || 640 })
                }
                className="bg-gray-800 border-gray-700 text-white text-xs h-6 px-2 w-16"
                min="320"
                max="1920"
              />
              <span className="flex items-center">×</span>
              <Input
                type="number"
                value={camera.height}
                onChange={(e) =>
                  onUpdate({ height: parseInt(e.target.value) || 480 })
                }
                className="bg-gray-800 border-gray-700 text-white text-xs h-6 px-2 w-16"
                min="240"
                max="1080"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16">FPS:</span>
            <Input
              type="number"
              value={camera.fps || 30}
              onChange={(e) =>
                onUpdate({ fps: parseInt(e.target.value) || 30 })
              }
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
