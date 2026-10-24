import { useEffect, useRef, useState } from "react";

/**
 * Attach a live browser camera stream to a `<video>` element by deviceId.
 * Set `paused=true` to release the stream (e.g. so cv2.VideoCapture can claim
 * the camera exclusively). The stream is auto-stopped on unmount.
 *
 * A first getUserMedia attempt can fail two ways that we want to recover from:
 *   - Transiently: the device is briefly held (e.g. right after an enumeration
 *     probe releases it) and reports NotReadableError/AbortError. We back off
 *     and retry the same deviceId a few times.
 *   - Pending an external change: camera permission hasn't been granted yet, or
 *     the device isn't connected. Retrying the same call won't help, but the
 *     browser can fire `devicechange` following a permission grant or a
 *     device-exposure change (timing isn't guaranteed) — so we re-attempt on
 *     that event instead. Without this the hook would otherwise stay stuck on
 *     the error state until a full page reload.
 *
 * The stream is first requested at `size`, the capture size recording uses
 * (browser default when omitted). A stream can also open cleanly yet never
 * deliver a frame: some UVC cameras (e.g. Innomaker U20CAM on macOS) accept
 * 640x480 in Firefox but stay silent until something starts them at a native
 * resolution. If no frame arrives within STALL_TIMEOUT_MS we reopen at the
 * next size in FALLBACK_SIZES, so cameras that stream at `size` are untouched.
 */
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 300;
// Errors worth an immediate retry. Permission denial (NotAllowedError), missing
// device (NotFoundError) and unsatisfiable constraints (OverconstrainedError)
// won't fix themselves on a retimed retry — those recover via `devicechange`.
const TRANSIENT_ERRORS = new Set(["NotReadableError", "AbortError"]);
const STALL_TIMEOUT_MS = 2500;
const FALLBACK_SIZES: CameraSize[] = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

export interface CameraSize {
  width: number;
  height: number;
}

const sizeConstraints = (size: CameraSize | undefined): MediaTrackConstraints =>
  size ? { width: { ideal: size.width }, height: { ideal: size.height } } : {};

export function useCameraStream(deviceId: string, paused: boolean, size?: CameraSize) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasError, setHasError] = useState(false);
  // Bumping this forces the stream effect to re-run (a clean retry).
  const [retryKey, setRetryKey] = useState(0);
  // Track the error state for the devicechange handler without re-binding it.
  const hasErrorRef = useRef(false);
  hasErrorRef.current = hasError;

  // A permission grant or hot-plug can prompt the browser to emit
  // `devicechange`; use it to re-attempt a stream that failed pre-permission.
  // Only retry when we're actually in the error state, so an unrelated change
  // (e.g. plugging in a mic) never tears down a healthy stream.
  useEffect(() => {
    const onDeviceChange = () => {
      if (hasErrorRef.current) setRetryKey((k) => k + 1);
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, []);

  useEffect(() => {
    if (paused || !deviceId) {
      if (!deviceId) setHasError(true);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    setHasError(false);
    const attempts = [size, ...FALLBACK_SIZES];

    const stopStream = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const start = async (attempt: number, sizeIndex: number) => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, ...sizeConstraints(attempts[sizeIndex]) },
        });
        if (cancelled) {
          stopStream();
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.play().catch(() => {});
        if (sizeIndex < attempts.length - 1) {
          stallTimer = setTimeout(() => {
            if (cancelled || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
            stopStream();
            start(0, sizeIndex + 1);
          }, STALL_TIMEOUT_MS);
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (attempt < MAX_RETRIES && TRANSIENT_ERRORS.has(name)) {
          // Exponential backoff: 300ms, 600ms, 1200ms, ...
          retryTimer = setTimeout(
            () => start(attempt + 1, sizeIndex),
            BASE_DELAY_MS * 2 ** attempt
          );
        } else {
          setHasError(true);
        }
      }
    };
    start(0, 0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (stallTimer) clearTimeout(stallTimer);
      stopStream();
    };
    // Depend on the size's numbers, not the object, so a caller passing a fresh
    // literal each render doesn't restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, paused, retryKey, size?.width, size?.height]);

  return { videoRef, hasError };
}
