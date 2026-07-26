import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Compass, Route } from "lucide-react";

interface WelcomeDialogProps {
  open: boolean;
  onStart: () => void;
  onDismiss: () => void;
}

// The stages a newcomer will walk through, shown as a quick preview so the
// tour's value is clear before they commit two minutes to it.
const STAGES = ["Calibrate", "Record", "Train", "Run"];

const WelcomeDialog: React.FC<WelcomeDialogProps> = ({
  open,
  onStart,
  onDismiss,
}) => {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <DialogContent className="bg-gray-900 border-gray-700 text-gray-300 sm:max-w-lg">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="flex items-center justify-center gap-2 text-xl text-white">
            <Compass className="h-6 w-6 text-blue-400" />
            Welcome to LeLab
          </DialogTitle>
          <DialogDescription>
            New to teaching a robot arm? A two-minute guided tour walks you
            through the whole loop, no jargon required.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            {STAGES.map((stage, i) => (
              <React.Fragment key={stage}>
                <span className="rounded-md bg-gray-800 px-2.5 py-1 font-medium text-gray-200">
                  {stage}
                </span>
                {i < STAGES.length - 1 && (
                  <span className="text-gray-600">→</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            onClick={onStart}
            className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"
          >
            <Route className="mr-2 h-4 w-4" />
            Take the tour
          </Button>
          <Button
            variant="ghost"
            onClick={onDismiss}
            className="w-full text-gray-400 hover:text-white sm:w-auto"
          >
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeDialog;
