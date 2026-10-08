import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal, ExternalLink, Copy, Check } from "lucide-react";

const ONE_LINER =
  "uv tool install --with-executables-from huggingface_hub git+https://github.com/huggingface/leLab.git && lelab";
const LOCAL_URL = "http://localhost:8000/";

interface UsageInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible?: boolean;
}

const UsageInstructionsModal: React.FC<UsageInstructionsModalProps> = ({
  open,
  onOpenChange,
  dismissible = true,
}) => {
  const [copied, setCopied] = useState(false);

  const blockClose = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ONE_LINER);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={dismissible ? onOpenChange : () => undefined}
    >
      <DialogContent
        className="bg-gray-900 border-gray-700 text-gray-300 sm:max-w-xl"
        hideClose={!dismissible}
        onEscapeKeyDown={blockClose}
        onPointerDownOutside={blockClose}
        onInteractOutside={blockClose}
      >
        <DialogHeader className="text-center sm:text-center min-w-0">
          <DialogTitle className="text-white flex items-center justify-center gap-2 text-xl">
            <Terminal className="w-6 h-6" />
            Get Started with LeLab
          </DialogTitle>
          <DialogDescription>
            LeLab runs on your machine. Click the command to copy it, then paste
            in a terminal:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy command to clipboard"
            className="group relative w-full bg-gray-800 hover:bg-gray-750 rounded-lg border border-gray-700 hover:border-gray-600 text-left transition-colors cursor-pointer"
          >
            <pre className="p-4 pr-12 text-xs sm:text-sm overflow-x-auto whitespace-pre-wrap break-all">
              <code className="text-green-400">{ONE_LINER}</code>
            </pre>
            <span className="absolute right-2 top-2 flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 group-hover:text-white bg-gray-900/80">
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </span>
          </button>
          <p className="text-gray-400 text-sm text-center">
            After running, your browser will open the local LeLab app.
          </p>
          <Button
            asChild
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <a href={LOCAL_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open LeLab
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UsageInstructionsModal;
