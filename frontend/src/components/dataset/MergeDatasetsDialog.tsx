import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

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
import { DatasetItem } from "@/lib/replayApi";

interface MergeDatasetsDialogProps {
  datasets: DatasetItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (sourceRepoIds: string[], outputName: string) => Promise<void>;
}

export default function MergeDatasetsDialog({
  datasets,
  open,
  onOpenChange,
  onMerge,
}: MergeDatasetsDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [outputName, setOutputName] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localDatasets = useMemo(
    () => datasets.filter((dataset) => dataset.source === "local" || dataset.source === "both"),
    [datasets],
  );
  const canMerge = selected.length >= 2 && /^[A-Za-z0-9._-]+$/.test(outputName) && !merging;

  const toggleDataset = (repoId: string, checked: boolean) => {
    setError(null);
    setSelected((current) => (checked ? [...current, repoId] : current.filter((id) => id !== repoId)));
  };

  const reset = () => {
    setSelected([]);
    setOutputName("");
    setMerging(false);
    setError(null);
  };

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
            Select two or more local datasets. Their source files stay unchanged; the merged dataset is saved locally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-gray-300">Source datasets</Label>
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-gray-700 p-3">
            {localDatasets.map((dataset) => (
              <label key={dataset.repo_id} className="flex cursor-pointer items-center gap-3 text-sm text-gray-200">
                <Checkbox
                  checked={selected.includes(dataset.repo_id)}
                  onCheckedChange={(checked) => toggleDataset(dataset.repo_id, checked === true)}
                  disabled={merging}
                />
                {dataset.repo_id}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">Select at least two datasets.</p>

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
