import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

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
import { DatasetItem } from "@/lib/replayApi";

interface MergeDatasetsDialogProps {
  datasets: DatasetItem[];
  selectedRepoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (sourceRepoIds: string[], outputName: string) => Promise<void>;
}

export default function MergeDatasetsDialog({
  datasets,
  selectedRepoId,
  open,
  onOpenChange,
  onMerge,
}: MergeDatasetsDialogProps) {
  const [selected, setSelected] = useState<string[]>([selectedRepoId]);
  const [outputName, setOutputName] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      datasets.filter(
        (dataset) =>
          (dataset.source === "local" || dataset.source === "both") && !selected.includes(dataset.repo_id),
      ),
    [datasets, selected],
  );
  const canMerge = selected.length >= 2 && /^[A-Za-z0-9._-]+$/.test(outputName) && !merging;

  const addDataset = (repoId: string) => {
    setError(null);
    setSelected((current) => [...current, repoId]);
  };

  const removeDataset = (repoId: string) => {
    setError(null);
    setSelected((current) => current.filter((id) => id !== repoId));
  };

  const reset = () => {
    setSelected([selectedRepoId]);
    setOutputName("");
    setMerging(false);
    setError(null);
  };

  useEffect(() => {
    if (open) {
      setSelected([selectedRepoId]);
      setOutputName("");
      setMerging(false);
      setError(null);
    }
  }, [open, selectedRepoId]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!merging && !nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleMerge = async () => {
    if (!canMerge) return;
    setMerging(true);
    try {
      await onMerge(selected, outputName);
      reset();
      onOpenChange(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not merge the selected datasets.");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-gray-700 bg-gray-900 text-gray-300 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Merge local datasets</DialogTitle>
          <DialogDescription>
            <code>{selectedRepoId}</code> is included. Select at least one more local dataset. Their source files stay
            unchanged; the merged dataset is saved locally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-gray-300">Source datasets</Label>
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-gray-700 p-3">
            <p className="text-sm text-gray-200">{selectedRepoId}</p>
            {selected.slice(1).map((repoId) => (
              <div key={repoId} className="flex items-center justify-between text-sm text-gray-200">
                <span className="truncate">{repoId}</span>
                <button
                  type="button"
                  aria-label={`Remove ${repoId}`}
                  onClick={() => removeDataset(repoId)}
                  disabled={merging}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <DatasetPicker
            datasets={candidates}
            loading={false}
            onPickExisting={(item) => addDataset(item.repo_id)}
          >
            <Button variant="outline" size="sm" disabled={merging} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add dataset
            </Button>
          </DatasetPicker>
          <p className="text-xs text-gray-500">Select at least one additional dataset.</p>

          <div className="space-y-2">
            <Label htmlFor="merged-dataset-name" className="text-gray-300">
              Merged dataset name
            </Label>
            <Input
              id="merged-dataset-name"
              value={outputName}
              onChange={(event) => {
                setError(null);
                setOutputName(event.target.value.replace(/[^A-Za-z0-9._-]/g, "_"));
              }}
              placeholder="combined_pick_place"
              disabled={merging}
              className="border-gray-700 bg-gray-800 text-white"
            />
            <p className="text-xs text-gray-500">
              Saved locally as <code>local/{outputName || "name"}</code>.
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={merging}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={!canMerge}>
            {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {merging ? "Merging…" : "Merge datasets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
