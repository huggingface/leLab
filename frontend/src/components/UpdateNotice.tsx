import { useState } from "react";
import { Loader2, Copy, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";

/**
 * App-level popup that notifies the user when a newer LeLab is available on
 * GitHub. Offers a copy-able upgrade command, a best-effort "Update now" button
 * (runs the pip upgrade on the backend), and a "don't ask again" opt-out.
 */
const UpdateNotice = () => {
  const { status, open, dismiss } = useUpdateCheck();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const [dontAsk, setDontAsk] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  if (!status) return null;

  const behind =
    typeof status.commits_behind === "number" && status.commits_behind > 0
      ? `${status.commits_behind} commit${status.commits_behind === 1 ? "" : "s"} behind`
      : "A new version is available";

  const copyCommand = async () => {
    if (!status.update_command) return;
    try {
      await navigator.clipboard.writeText(status.update_command);
      toast({ title: "Copied", description: "Update command copied to clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the command manually.",
        variant: "destructive",
      });
    }
  };

  const runUpdate = async () => {
    setUpdating(true);
    setOutput(null);
    try {
      const r = await fetchWithHeaders(`${baseUrl}/update`, { method: "POST" });
      const body: { success: boolean; message: string; output: string } = await r.json();
      if (body.success) {
        toast({ title: "Updated", description: body.message });
        dismiss(false);
      } else {
        setOutput(body.output || body.message);
        toast({ title: "Update failed", description: body.message, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !updating) dismiss(dontAsk);
      }}
    >
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-white">
            <Sparkles className="w-5 h-5 text-amber-400" />
            LeLab update available
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            You're {behind}. Update to get the latest fixes and features.
            {status.compare_url && (
              <>
                {" "}
                <a
                  href={status.compare_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-300 underline hover:text-sky-200"
                >
                  See what changed
                </a>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2 py-1.5 rounded bg-slate-900 text-sky-300 text-xs overflow-x-auto whitespace-nowrap">
              {status.update_command}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={copyCommand}
              title="Copy command"
              className="shrink-0 bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>

          {output && (
            <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-300 whitespace-pre-wrap">
              {output}
            </pre>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <Checkbox
                checked={dontAsk}
                onCheckedChange={(v) => setDontAsk(v === true)}
              />
              Don't ask me again
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => dismiss(dontAsk)}
                disabled={updating}
                className="text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                Later
              </Button>
              {status.can_auto_update && (
                <Button onClick={runUpdate} disabled={updating}>
                  {updating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    "Update now"
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpdateNotice;
