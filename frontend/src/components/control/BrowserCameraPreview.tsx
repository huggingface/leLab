import React, { useState } from "react";
import { VideoOff } from "lucide-react";
import { useCameraStream } from "@/hooks/useCameraStream";
import { CameraRotation, cameraPreviewGeometry, cameraRotationError } from "@/lib/cameraConfig";

interface Props {
  deviceId: string;
  paused?: boolean;
  rotation?: CameraRotation;
  width?: number;
  height?: number;
  className?: string;
  fallback?: string;
}

/** Browser streams contain raw frames, so only browser previews use CSS rotation. */
export default function BrowserCameraPreview({
  deviceId,
  paused = false,
  rotation = 0,
  width = 640,
  height = 480,
  className = "",
  fallback,
}: Props) {
  const rotationError = cameraRotationError({ rotation });
  const { videoRef, hasError } = useCameraStream(deviceId, paused || !!rotationError);
  const [metadata, setMetadata] = useState<{ deviceId: string; width: number; height: number } | null>(null);
  const dimensions = metadata?.deviceId === deviceId ? metadata : { width, height };
  const geometry = rotationError
    ? { aspectRatio: `${width} / ${height}`, videoStyle: {} }
    : cameraPreviewGeometry(dimensions.width, dimensions.height, rotation);
  const showVideo = !rotationError && !paused && deviceId && !hasError;
  return (
    <div
      className={`relative overflow-hidden bg-gray-800 ${className}`}
      style={{ aspectRatio: geometry.aspectRatio }}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={geometry.videoStyle}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setMetadata({ deviceId, width: video.videoWidth, height: video.videoHeight });
            }
          }}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <VideoOff className="w-5 h-5 text-gray-500 mb-1" />
          <span className="text-xs text-gray-500">
            {rotationError ?? fallback ?? (paused ? "Preview paused" : deviceId ? "Preview failed" : "No camera selected")}
          </span>
        </div>
      )}
    </div>
  );
}
