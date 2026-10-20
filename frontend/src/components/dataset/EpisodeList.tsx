import React, { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { EpisodeSummary, formatDuration } from "@/lib/datasetApi";

interface EpisodeListProps {
  episodes: EpisodeSummary[];
  selected: number | null;
  onSelect: (episodeIndex: number) => void;
  /** Shows an edit button on the selected episode's task when set. */
  onEditTask?: (episodeIndex: number) => void;
}

const EpisodeList: React.FC<EpisodeListProps> = ({ episodes, selected, onSelect, onEditTask }) => {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Follow the selection. Paging with Previous/Next, or opening a link straight
  // to episode 40, would otherwise leave the highlighted row scrolled out of
  // sight — the list would look like it never moved.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (episodes.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 text-xs text-gray-500">
        No episodes in this dataset.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
          Episodes
        </span>
        <span className="text-[11px] tabular-nums text-gray-600">{episodes.length}</span>
      </div>
      {/* Tailwind arbitrary values take underscores where the CSS needs spaces:
          `calc(100vh-280px)` is not valid CSS and the rule is dropped. */}
      <div className="max-h-[calc(100vh_-_280px)] overflow-y-auto">
        {episodes.map((ep) => {
          const active = ep.episode_index === selected;
          return (
            <div
              key={ep.episode_index}
              className={`flex items-center border-b border-gray-900 transition last:border-b-0 ${
                active ? "bg-gray-800/80" : "hover:bg-gray-900"
              }`}
            >
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onSelect(ep.episode_index)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-orange-500"
              >
                <span
                  className={`w-8 text-xs tabular-nums ${
                    active ? "font-semibold text-orange-400" : "text-gray-500"
                  }`}
                >
                  {ep.episode_index}
                </span>
                <span className="flex-1 truncate text-xs text-gray-300">
                  {ep.tasks.length > 0 ? ep.tasks.join(", ") : "—"}
                </span>
                <span className="text-[11px] tabular-nums text-gray-500">
                  {formatDuration(ep.duration_s)}
                </span>
              </button>
              {active && onEditTask && (
                <button
                  type="button"
                  onClick={() => onEditTask(ep.episode_index)}
                  aria-label={`Edit the task of episode ${ep.episode_index}`}
                  className="mr-2 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EpisodeList;
