import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DatasetPicker from "@/components/landing/DatasetPicker";
import { parseEpisodeList } from "@/lib/datasetApi";
import { DatasetItem, MoveDestination } from "@/lib/replayApi";

interface MoveEpisodesDialogProps {
  datasets: DatasetItem[];
  repoId: string;
  totalEpisodes: number;
  currentEpisode: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (episodeIndices: number[], destination: MoveDestination) => Promise<void>;
}

export default function MoveEpisodesDialog({
  datasets,
  repoId,
  totalEpisodes,
  currentEpisode,
  open,
  onOpenChange,
  onMove,
}: MoveEpisodesDialogProps) {
  const [episodesText, setEpisodesText] = useState("");
  const [destination, setDestination] = useState<MoveDestination | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEpisodesText(currentEpisode === null ? "" : String(currentEpisode));
      setDestination(null);
      setMoving(false);
      setError(null);
    }
  }, [open, currentEpisode]);

  const candidates = useMemo(() => datasets.filter((d) => d.repo_id !== repoId), [datasets, repoId]);
  const episodes = parseEpisodeList(episodesText, totalEpisodes);
  const movesEverything = episodes !== null && episodes.length >= totalEpisodes;
  const canMove = episodes !== null && !movesEverything && destination !== null && !moving;
  const pickDestination = (next: MoveDestination) => {
    setError(null);
    setDestination(next);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (moving) return;
    onOpenChange(nextOpen);
  };

  const handleMove = async () => {
    if (!canMove || episodes === null || destination === null) return;
    setMoving(true);
    try {
      await onMove(episodes, destination);
      onOpenChange(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not move the episodes.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-gray-700 bg-gray-900 text-gray-300 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Move episodes to another dataset</DialogTitle>
          <DialogDescription>
            The episodes leave <code>{repoId}</code> and go to a new or an existing local dataset.
            The episodes left in <code>{repoId}</code> are renumbered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="move-episodes" className="text-gray-300">
              Episodes
            </Label>
            <Input
              id="move-episodes"
              value={episodesText}
              onChange={(event) => {
                setError(null);
                setEpisodesText(event.target.value);
              }}
              placeholder="3, 7, 10-12"
              disabled={moving}
              className="border-gray-700 bg-gray-800 text-white"
            />
            {episodesText.trim() && episodes === null && (
              <p className="text-xs text-red-400">
                Use episode numbers from 0 to {totalEpisodes - 1}, e.g. 3, 7, 10-12.
              </p>
            )}
            {movesEverything && (
              <p className="text-xs text-red-400">At least one episode must stay in the dataset.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-gray-300">Destination</Label>
            <DatasetPicker
              datasets={candidates}
              loading={false}
              onPickExisting={(item) => pickDestination({ existingRepoId: item.repo_id })}
              onCreateNew={(name) => pickDestination({ newName: name })}
            >
              <Button
                variant="outline"
                role="combobox"
                disabled={moving}
                className="w-full justify-between border-gray-700 bg-gray-800 text-white hover:bg-gray-700"
              >
                <span className="truncate">
                  {destination === null
                    ? "Select or create a dataset…"
                    : "newName" in destination
                      ? `local/${destination.newName}`
                      : destination.existingRepoId}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DatasetPicker>
            {destination !== null && (
              <p className="text-xs text-gray-500">
                {"newName" in destination ? (
                  <>
                    Saved locally as <code>local/{destination.newName}</code>.
                  </>
                ) : (
                  <>
                    Merged into <code>{destination.existingRepoId}</code> after its own episodes. It must
                    have the same fps, features and robot type.
                  </>
                )}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!canMove}>
            {moving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {moving
              ? "Moving…"
              : `Move ${episodes?.length ?? 0} episode${episodes?.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
