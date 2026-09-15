import React, { useEffect, useState } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { mergeDatasets } from "@/lib/datasetApi";

interface MergeDatasetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Local datasets available to pick from. */
  datasets: { repo_id: string }[];
  /** Pre-checked when the dialog opens (the dataset currently being browsed). */
  initialRepoId?: string | null;
  /** Called with the newly merged dataset's repo_id once it's on disk. */
  onMerged: (outputRepoId: string) => void;
}

/**
 * Merge several local datasets into one new local dataset.
 *
 * Wraps `lerobot.datasets.dataset_tools.merge_datasets` via `/merge-datasets`,
 * which concatenates the selected datasets' videos and data files. The result
 * is written to disk only — merging never touches the Hub.
 */
const MergeDatasetsDialog: React.FC<MergeDatasetsDialogProps> = ({
  open,
  onOpenChange,
  datasets,
  initialRepoId,
  onMerged,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outputName, setOutputName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(initialRepoId ? [initialRepoId] : []));
      setOutputName("");
      setSubmitting(false);
    }
  }, [open, initialRepoId]);

  const toggle = (repoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const canSubmit = selected.size >= 2 && outputName.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await mergeDatasets(
        baseUrl,
        fetchWithHeaders,
        Array.from(selected),
        outputName.trim(),
      );
      if (!result.success || !result.output_repo_id) {
        toast({
          title: "Merge failed",
          description: result.message ?? "Could not merge the selected datasets.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Datasets merged",
        description: `${selected.size} datasets merged into ${result.output_repo_id}.`,
      });
      onOpenChange(false);
      onMerged(result.output_repo_id);
    } catch (e) {
      toast({
        title: "Merge failed",
        description: e instanceof Error ? e.message : "Could not merge the selected datasets.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-gray-800 bg-gray-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-orange-500" />
            Merge datasets
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Pick at least two local datasets. Their episodes are concatenated into a new
            dataset — the originals are left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-gray-800 p-2">
          {datasets.length === 0 && (
            <p className="p-2 text-xs text-gray-500">No local datasets available.</p>
          )}
          {datasets.map((d) => (
            <label
              key={d.repo_id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-900"
            >
              <Checkbox
                checked={selected.has(d.repo_id)}
                onCheckedChange={() => toggle(d.repo_id)}
              />
              <span className="truncate">{d.repo_id}</span>
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="merge-output-name" className="text-xs text-gray-400">
            New dataset name
          </Label>
          <Input
            id="merge-output-name"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="merged-dataset"
            className="border-gray-800 bg-gray-900 text-sm text-white"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="border-gray-800 bg-gray-900 text-xs text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-1.5 bg-orange-600 text-xs hover:bg-orange-700"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Merge {selected.size >= 2 ? `${selected.size} datasets` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MergeDatasetsDialog;
