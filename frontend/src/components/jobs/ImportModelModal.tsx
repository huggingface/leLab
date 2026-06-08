import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { importModel } from "@/lib/jobsApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

const ImportModelModal: React.FC<Props> = ({ open, onOpenChange, onImported }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const src = source.trim();
    if (!src) return;
    setSubmitting(true);
    setError(null);
    try {
      await importModel(baseUrl, fetchWithHeaders, src, name.trim() || undefined);
      setSource("");
      setName("");
      onOpenChange(false);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-[520px] p-8">
        <DialogHeader>
          <DialogTitle className="text-white text-center text-2xl font-bold">
            Import a model
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-center">
            Point at a local directory or a Hugging Face repo. It appears as a
            job you can run inference on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="source" className="text-sm font-medium text-gray-300">
              Local path or Hugging Face repo id
            </Label>
            <Input
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="/path/to/pretrained_model  or  user/my-policy"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium text-gray-300">
              Display name (optional)
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My imported policy"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          {error ? (
            <Alert className="bg-red-900/40 border-red-700 text-red-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-3 justify-center pt-2">
            <Button
              onClick={handleSubmit}
              disabled={!source.trim() || submitting}
              className="bg-green-500 hover:bg-green-600 text-white px-8 disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {submitting ? "Importing…" : "Import"}
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="border-gray-500 px-8 text-zinc-400 bg-zinc-900 hover:bg-zinc-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportModelModal;
