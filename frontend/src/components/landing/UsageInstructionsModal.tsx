import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal, ExternalLink } from "lucide-react";

const ONE_LINER =
  "uv tool install git+https://github.com/huggingface/leLab.git && lelab";
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
  const blockClose = (e: Event) => {
    if (!dismissible) e.preventDefault();
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
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-white flex items-center justify-center gap-2 text-xl">
            <Terminal className="w-6 h-6" />
            Get Started with LeLab
          </DialogTitle>
          <DialogDescription>
            LeLab runs on your machine. Paste this in a terminal:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <pre className="bg-gray-800 p-4 rounded-lg text-xs sm:text-sm overflow-x-auto text-left border border-gray-700">
            <code className="text-green-400">{ONE_LINER}</code>
          </pre>
          <p className="text-gray-400 text-sm text-center">
            After running, your browser will open the local LeLab app.
          </p>
          <Button
            asChild
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <a href={LOCAL_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open LeLab ({LOCAL_URL})
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UsageInstructionsModal;
