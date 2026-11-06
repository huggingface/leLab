import { RefObject, useEffect, useState } from "react";
import {
  LightingMatch,
  Pixels,
  alignmentInput,
  alignmentScore,
  lightingMatch,
  lightingSignature,
} from "@/lib/cameraReferenceScore";

const POLL_MS = 500;

export interface ReferenceScores {
  /** 0-100, or null while there is no frame or the sizes differ. */
  alignment: number | null;
  lighting: LightingMatch | null;
}

const EMPTY: ReferenceScores = { alignment: null, lighting: null };

function pixelsOf(source: CanvasImageSource, width: number, height: number): Pixels | null {
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Alignment and lighting scores of the `<video>` inside `previewRef` against the
 * reference frame at `referenceUrl`, refreshed twice a second. Both frames are raw
 * (unrotated) stream frames, so rotation doesn't enter the comparison.
 */
export function useReferenceScores(
  previewRef: RefObject<HTMLElement>,
  referenceUrl: string | null,
  enabled: boolean,
): ReferenceScores {
  const [scores, setScores] = useState<ReferenceScores>(EMPTY);

  useEffect(() => {
    setScores(EMPTY);
    if (!enabled || !referenceUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const ref = pixelsOf(img, img.naturalWidth, img.naturalHeight);
      if (!ref) return;
      const refAlign = alignmentInput(ref);
      const refLight = lightingSignature(ref);
      timer = setInterval(() => {
        const video = previewRef.current?.querySelector("video");
        const live = video && video.readyState >= 2 ? pixelsOf(video, video.videoWidth, video.videoHeight) : null;
        if (!live) return setScores(EMPTY);
        const sameSize = live.width === ref.width && live.height === ref.height;
        setScores({
          alignment: sameSize ? alignmentScore(alignmentInput(live), refAlign) : null,
          lighting: lightingMatch(lightingSignature(live), refLight),
        });
      }, POLL_MS);
    };
    img.src = referenceUrl;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [previewRef, referenceUrl, enabled]);

  return scores;
}
