import React, { useState, useEffect, useRef, useCallback } from "react";

interface CameraFeedProps {
  baseUrl: string;
  name: string;
  // False during the preparing phase: show an empty slot until the camera is
  // connected and streaming. True once recording/resetting, when frames flow.
  live: boolean;
  // Pixel size computed by the parent to fit the available space. The box is
  // sized to the camera's aspect ratio, so the video fills it without letterbox.
  width: number;
  height: number;
}

// Renders one recording camera's window at an explicit size. During preparing it
// shows an empty placeholder; once live it plays the backend MJPEG stream. The
// browser renders a `multipart/x-mixed-replace` response natively in an <img>,
// so we just point it at /camera-feed/{name}. If the stream errors before frames
// flow (camera still warming up), retry with a cache-busting key after a delay.
const RecordingCameraFeed: React.FC<CameraFeedProps> = ({
  baseUrl,
  name,
  live,
  width,
  height,
}) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [hasError, setHasError] = useState(false);
  const retryRef = useRef<number | null>(null);

  const src = `${baseUrl}/camera-feed/${encodeURIComponent(name)}?k=${reloadKey}`;

  useEffect(() => {
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    if (retryRef.current) window.clearTimeout(retryRef.current);
    retryRef.current = window.setTimeout(() => {
      setHasError(false);
      setReloadKey((k) => k + 1);
    }, 1500);
  }, []);

  // 0 before the first measurement; skip rendering a zero-size box.
  if (width <= 0 || height <= 0) return null;

  return (
    <div
      style={{ width, height }}
      className="relative bg-gray-900 rounded-lg border border-gray-700 overflow-hidden flex items-center justify-center"
    >
      {!live ? (
        <span className="text-gray-500 text-sm">Getting ready…</span>
      ) : hasError ? (
        <span className="text-gray-500 text-sm">Connecting feed…</span>
      ) : (
        <img
          src={src}
          alt={`${name} live feed`}
          onError={handleError}
          className="w-full h-full object-contain"
        />
      )}
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-sm text-gray-200">
        {name}
      </span>
    </div>
  );
};

export default RecordingCameraFeed;
