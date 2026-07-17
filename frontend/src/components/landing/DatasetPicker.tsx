import React, { useState } from "react";
import { Plus, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DatasetItem } from "@/lib/replayApi";
import { getEpisodeTarget } from "@/lib/episodeTargets";

function relativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

interface DatasetPickerProps {
  datasets: DatasetItem[];
  loading: boolean;
  onPickExisting: (item: DatasetItem) => void;
  onResumeExisting?: (item: DatasetItem) => void;
  onCreateNew: (name: string) => void;
  onOpenCustom: (repoId: string) => void;
  children: React.ReactNode;
}

const REPO_ID_RE = /^[\w.\-]+\/[\w.\-]+$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

const DatasetPicker: React.FC<DatasetPickerProps> = ({
  datasets,
  loading,
  onPickExisting,
  onResumeExisting,
  onCreateNew,
  onOpenCustom,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const matchesExisting = datasets.some(
    (d) => d.repo_id.toLowerCase() === trimmed.toLowerCase(),
  );
  const isRepoId = REPO_ID_RE.test(trimmed);
  const isName = NAME_RE.test(trimmed) && !trimmed.includes("/");
  const canCreate = trimmed.length > 0 && isName && !matchesExisting;
  const canOpenCustom = isRepoId && !matchesExisting;

  const createDisabled = matchesExisting || (trimmed !== "" && !canCreate);
  const createLabel = matchesExisting
    ? "Already exists"
    : trimmed === ""
      ? "Create new dataset…"
      : canCreate
        ? `Create "${trimmed}"`
        : 'Use a name without "/"';

  const handleFooterCreate = () => {
    if (createDisabled) return;
    onCreateNew(trimmed);
    reset();
  };

  const localDatasets = datasets.filter((d) => d.source === "local" || d.source === "both");
  const hubDatasets = datasets.filter((d) => d.source === "hub");

  const reset = () => {
    setQuery("");
    setOpen(false);
  };

  const handlePick = (item: DatasetItem) => {
    onPickExisting(item);
    reset();
  };

  const handleCreate = () => {
    if (!canCreate) return;
    onCreateNew(trimmed);
    reset();
  };

  const handleOpenCustom = () => {
    if (!canOpenCustom) return;
    onOpenCustom(trimmed);
    reset();
  };

  const renderItem = (d: DatasetItem) => {
    const target = getEpisodeTarget(d.repo_id);
    const detailParts: string[] = [];
    if (d.num_episodes != null) {
      detailParts.push(
        target
          ? `${d.num_episodes}/${target} episodes`
          : `${d.num_episodes} episodes`,
      );
    }
    const rel = relativeDate(d.last_modified);
    if (rel) detailParts.push(rel);
    const progress =
      target && d.num_episodes != null
        ? Math.min(100, Math.round((d.num_episodes / target) * 100))
        : null;
    return (
    <CommandItem
      key={d.repo_id}
      value={d.repo_id}
      onSelect={() => handlePick(d)}
      className="text-white aria-selected:bg-gray-700"
    >
      <div className="flex-1 min-w-0">
        <span className="block truncate">{d.repo_id}</span>
        {detailParts.length > 0 && (
          <span className="block text-xs text-gray-400">
            {detailParts.join(" · ")}
          </span>
        )}
        {progress !== null && (
          <span className="mt-1 block h-1 w-full rounded bg-gray-700">
            <span
              className={`block h-1 rounded ${progress >= 100 ? "bg-green-500" : "bg-red-400"}`}
              style={{ width: `${progress}%` }}
            />
          </span>
        )}
      </div>
      {d.source === "both" && (
        <span className="text-xs text-gray-400 mr-2">on Hub</span>
      )}
      {d.private && (
        <span className="text-xs text-amber-400">private</span>
      )}
      {(d.source === "local" || d.source === "both") && onResumeExisting && (
        <button
          type="button"
          title="Continue recording: append new episodes to this dataset"
          onClick={(e) => {
            e.stopPropagation();
            onResumeExisting(d);
            reset();
          }}
          className="ml-2 flex shrink-0 items-center gap-1 rounded-full border border-gray-600 px-2 py-0.5 text-xs text-gray-300 hover:border-red-400 hover:text-red-400 hover:bg-gray-700"
        >
          <Plus className="h-3 w-3" />
          episodes
        </button>
      )}
    </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0 bg-gray-800 border-gray-700 text-white"
        align="end"
      >
        <Command className="bg-gray-800">
          <CommandInput
            placeholder="Search, type a new name, or org/name…"
            value={query}
            onValueChange={(v) => setQuery(v.replace(/[^A-Za-z0-9._\-/]/g, "_"))}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (canCreate) {
                e.preventDefault();
                handleCreate();
              } else if (canOpenCustom) {
                e.preventDefault();
                handleOpenCustom();
              }
            }}
            className="text-white"
          />
          <CommandList>
            {datasets.length === 0 && !canCreate && !canOpenCustom && (
              <CommandEmpty className="py-4 text-sm text-gray-400 text-center">
                {loading
                  ? "Loading datasets…"
                  : "No datasets yet. Type a name to create one."}
              </CommandEmpty>
            )}
            {localDatasets.length > 0 && (
              <CommandGroup heading="Local">
                {localDatasets.map(renderItem)}
              </CommandGroup>
            )}
            {hubDatasets.length > 0 && (
              <CommandGroup heading="Hugging Face">
                {hubDatasets.map(renderItem)}
              </CommandGroup>
            )}
            {canOpenCustom && (
              <CommandGroup heading="Custom repo">
                <CommandItem
                  value={`__open__${trimmed}`}
                  onSelect={handleOpenCustom}
                  className="text-white aria-selected:bg-gray-700"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open &quot;{trimmed}&quot; in viewer
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          <button
            type="button"
            onClick={handleFooterCreate}
            disabled={createDisabled}
            className="flex w-full items-center gap-2 border-t border-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            <Plus className="h-4 w-4" />
            {createLabel}
          </button>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default DatasetPicker;
