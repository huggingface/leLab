import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface EpisodeTaskDialogProps {
  repoId: string;
  episodeIndex: number;
  currentTask: string;
  totalEpisodes: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `episodeIndex` is null when the task applies to every episode. */
  onSave: (task: string, episodeIndex: number | null) => void;
}

export default function EpisodeTaskDialog({
  repoId,
  episodeIndex,
  currentTask,
  totalEpisodes,
  open,
  onOpenChange,
  onSave,
}: EpisodeTaskDialogProps) {
  const [task, setTask] = useState("");
  const [allEpisodes, setAllEpisodes] = useState(false);

  useEffect(() => {
    if (open) {
      setTask(currentTask);
      setAllEpisodes(false);
    }
  }, [open, currentTask]);

  const canSave = task.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    onSave(task.trim(), allEpisodes ? null : episodeIndex);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-gray-700 bg-gray-900 text-gray-300 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Edit task</DialogTitle>
          <DialogDescription>
            The task is the instruction a policy is trained on, saved with each episode of{" "}
            <code>{repoId}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="episode-task" className="text-gray-300">
              Task
            </Label>
            <Input
              id="episode-task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSave();
              }}
              className="border-gray-700 bg-gray-800 text-white"
            />
          </div>
          {totalEpisodes > 1 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="episode-task-all"
                checked={allEpisodes}
                onCheckedChange={(checked) => setAllEpisodes(checked === true)}
                className="border-gray-500"
              />
              <Label htmlFor="episode-task-all" className="text-sm text-gray-300">
                Apply to all {totalEpisodes} episodes, not only episode {episodeIndex}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
