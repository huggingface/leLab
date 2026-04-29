
import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Camera, Mic } from "lucide-react";

interface PermissionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPermissionsResult: (allow: boolean) => void;
}

const PermissionModal: React.FC<PermissionModalProps> = ({ open, onOpenChange, onPermissionsResult }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-[480px] p-8">
        <DialogHeader>
          <div className="flex justify-center items-center gap-4 mb-4">
            <Camera className="w-8 h-8 text-orange-500" />
            <Mic className="w-8 h-8 text-orange-500" />
          </div>
          <DialogTitle className="text-white text-center text-2xl font-bold">
            Enable Camera & Microphone
          </DialogTitle>
        </DialogHeader>
        <div className="text-center space-y-6 py-4">
          <DialogDescription className="text-gray-400 text-base leading-relaxed">
            LiveLab requires access to your camera and microphone for a fully
            immersive telepresence experience. This enables real-time video
            feedback and voice command capabilities.
          </DialogDescription>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
            <Button
              onClick={() => onPermissionsResult(true)}
              className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white px-10 py-6 text-lg transition-all shadow-md shadow-orange-500/30 hover:shadow-lg hover:shadow-orange-500/40"
            >
              Allow Access
            </Button>
            <Button
              onClick={() => onPermissionsResult(false)}
              variant="outline"
              className="w-full sm:w-auto border-gray-500 hover:border-gray-200 px-10 py-6 text-lg text-zinc-500 bg-zinc-900 hover:bg-zinc-800"
            >
              Continue without
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PermissionModal;
