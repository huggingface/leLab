import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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
import { parseEpisodeList } from "@/lib/datasetApi";

interface MoveEpisodesDialogProps {
  repoId: string;
  totalEpisodes: number;
  currentEpisode: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (episodeIndices: number[], outputName: string) => Promise<void>;
}

export default function MoveEpisodesDialog({
  repoId,
  totalEpisodes,
  currentEpisode,
  open,
  onOpenChange,
  onMove,
}: MoveEpisodesDialogProps) {
  const [episodesText, setEpisodesText] = useState("");
  const [outputName, setOutputName] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEpisodesText(currentEpisode === null ? "" : String(currentEpisode));
      setOutputName("");
      setMoving(false);
      setError(null);
    }
  }, [open, currentEpisode]);

  const episodes = parseEpisodeList(episodesText, totalEpisodes);
  const movesEverything = episodes !== null && episodes.length >= totalEpisodes;
  const canMove =
    episodes !== null && !movesEverything && /^[A-Za-z0-9._-]+$/.test(outputName) && !moving;

  const handleOpenChange = (nextOpen: boolean) => {
    if (moving) return;
    onOpenChange(nextOpen);
  };

  const handleMove = async () => {
    if (!canMove || episodes === null) return;
    setMoving(true);
    try {
      await onMove(episodes, outputName);
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
          <DialogTitle className="text-white">Move episodes to a new dataset</DialogTitle>
          <DialogDescription>
            The episodes leave <code>{repoId}</code> and are saved locally as a new dataset. The
            episodes left in <code>{repoId}</code> are renumbered.
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
            <Label htmlFor="moved-dataset-name" className="text-gray-300">
              New dataset name
            </Label>
            <Input
              id="moved-dataset-name"
              value={outputName}
              onChange={(event) => {
                setError(null);
                setOutputName(event.target.value.replace(/[^A-Za-z0-9._-]/g, "_"));
              }}
              placeholder="rejected_takes"
              disabled={moving}
              className="border-gray-700 bg-gray-800 text-white"
            />
            <p className="text-xs text-gray-500">
              Saved locally as <code>local/{outputName || "name"}</code>.
            </p>
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
