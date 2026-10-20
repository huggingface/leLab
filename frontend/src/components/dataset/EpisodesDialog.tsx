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

/** "move" sends the episodes to a new dataset; "delete" drops them. */
export type EpisodesDialogMode = "move" | "delete";

interface EpisodesDialogProps {
  mode: EpisodesDialogMode;
  repoId: string;
  totalEpisodes: number;
  currentEpisode: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `outputName` is the new dataset's name in "move" mode, and null in "delete" mode. */
  onSubmit: (episodeIndices: number[], outputName: string | null) => Promise<void>;
}

export default function EpisodesDialog({
  mode,
  repoId,
  totalEpisodes,
  currentEpisode,
  open,
  onOpenChange,
  onSubmit,
}: EpisodesDialogProps) {
  const [episodesText, setEpisodesText] = useState("");
  const [outputName, setOutputName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEpisodesText(currentEpisode === null ? "" : String(currentEpisode));
      setOutputName("");
      setWorking(false);
      setError(null);
    }
  }, [open, currentEpisode]);

  const isMove = mode === "move";
  const verb = isMove ? "Move" : "Delete";
  const episodes = parseEpisodeList(episodesText, totalEpisodes);
  const takesEverything = episodes !== null && episodes.length >= totalEpisodes;
  const nameValid = !isMove || /^[A-Za-z0-9._-]+$/.test(outputName);
  const canSubmit = episodes !== null && !takesEverything && nameValid && !working;

  const handleOpenChange = (nextOpen: boolean) => {
    if (working) return;
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!canSubmit || episodes === null) return;
    setWorking(true);
    try {
      await onSubmit(episodes, isMove ? outputName : null);
      onOpenChange(false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not ${verb.toLowerCase()} the episodes.`,
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-gray-700 bg-gray-900 text-gray-300 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isMove ? "Move episodes to a new dataset" : "Delete episodes"}
          </DialogTitle>
          <DialogDescription>
            {isMove ? (
              <>
                The episodes leave <code>{repoId}</code> and are saved locally as a new dataset.
              </>
            ) : (
              <>
                The episodes are permanently removed from <code>{repoId}</code>. To keep a copy,
                move them to a new dataset instead.
              </>
            )}{" "}
            The episodes left in <code>{repoId}</code> are renumbered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="episode-selection" className="text-gray-300">
              Episodes
            </Label>
            <Input
              id="episode-selection"
              value={episodesText}
              onChange={(event) => {
                setError(null);
                setEpisodesText(event.target.value);
              }}
              placeholder="3, 7, 10-12"
              disabled={working}
              className="border-gray-700 bg-gray-800 text-white"
            />
            {episodesText.trim() && episodes === null && (
              <p className="text-xs text-red-400">
                Use episode numbers from 0 to {totalEpisodes - 1}, e.g. 3, 7, 10-12.
              </p>
            )}
            {takesEverything && (
              <p className="text-xs text-red-400">At least one episode must stay in the dataset.</p>
            )}
          </div>

          {isMove && (
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
                disabled={working}
                className="border-gray-700 bg-gray-800 text-white"
              />
              <p className="text-xs text-gray-500">
                Saved locally as <code>local/{outputName || "name"}</code>.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={working}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={isMove ? undefined : "bg-red-500 text-white hover:bg-red-600"}
          >
            {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {working
              ? `${isMove ? "Moving" : "Deleting"}…`
              : `${verb} ${episodes?.length ?? 0} episode${episodes?.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
