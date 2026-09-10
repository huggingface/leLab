import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { Thumbnail, getThumbnails } from "@/lib/datasetApi";

interface FilmStripProps {
  repoId: string;
  episodeIndex: number;
  camera: string;
  /** Episode-relative frame currently on screen; the nearest thumb highlights. */
  currentFrame: number;
  onSeekFrame: (frameIndex: number) => void;
  count?: number;
}

/**
 * Thumbnails across the episode. One request for the whole strip — the backend
 * decodes them in a single pass over the mp4 rather than reopening it per frame.
 */
const FilmStrip: React.FC<FilmStripProps> = ({
  repoId,
  episodeIndex,
  camera,
  currentFrame,
  onSeekFrame,
  count = 12,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getThumbnails(baseUrl, fetchWithHeaders, repoId, episodeIndex, camera, count, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setThumbs(r.success ? r.thumbnails : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setThumbs([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl, fetchWithHeaders, repoId, episodeIndex, camera, count]);

  // Highlight the thumb nearest the playhead rather than the one before it, so
  // the marker tracks what's actually on screen.
  const activeIdx = thumbs.reduce(
    (best, t, i) =>
      Math.abs(t.frame_index - currentFrame) <
      Math.abs((thumbs[best]?.frame_index ?? Infinity) - currentFrame)
        ? i
        : best,
    0,
  );

  if (loading && thumbs.length === 0) {
    return (
      <div className="flex h-[68px] items-center justify-center rounded-md border border-gray-800 bg-gray-950">
        <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
      </div>
    );
  }

  if (thumbs.length === 0) {
    return (
      <div className="flex h-[68px] items-center justify-center rounded-md border border-gray-800 bg-gray-950 text-xs text-gray-600">
        No thumbnails
      </div>
    );
  }

  return (
    <div className="flex gap-1 overflow-x-auto rounded-md border border-gray-800 bg-gray-950 p-1">
      {thumbs.map((t, i) => (
        <button
          key={t.frame_index}
          type="button"
          onClick={() => onSeekFrame(t.frame_index)}
          title={`Frame ${t.frame_index}`}
          className={`group relative flex-none overflow-hidden rounded transition ${
            i === activeIdx
              ? "ring-2 ring-orange-500"
              : "ring-1 ring-gray-800 hover:ring-gray-600"
          } focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400`}
        >
          <img
            src={t.data_uri}
            alt={`Frame ${t.frame_index}`}
            className="h-14 w-auto"
            draggable={false}
          />
          <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[10px] tabular-nums text-gray-300 opacity-0 transition group-hover:opacity-100">
            {t.frame_index}
          </span>
        </button>
      ))}
    </div>
  );
};

export default FilmStrip;
