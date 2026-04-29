
import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import UrdfViewer from "../UrdfViewer";
import UrdfProcessorInitializer from "../UrdfProcessorInitializer";
import Logo from "@/components/Logo";

interface VisualizerPanelProps {
  onGoBack: () => void;
  className?: string;
}

const VisualizerPanel: React.FC<VisualizerPanelProps> = ({
  onGoBack,
  className,
}) => {
  return (
    <div
      className={cn(
        "w-full p-2 sm:p-4 space-y-4 lg:space-y-0 lg:space-x-4 flex flex-col lg:flex-row",
        className
      )}
    >
      <div className="bg-gray-900 rounded-lg p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onGoBack}
            className="text-gray-400 hover:text-white hover:bg-gray-800 flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Logo iconOnly={true} />
          <div className="w-px h-6 bg-gray-700" />
          <h2 className="text-xl font-medium text-gray-200">Teleoperation</h2>
        </div>
        <div className="flex-1 bg-black rounded border border-gray-800 min-h-[50vh] lg:min-h-0">
          <UrdfProcessorInitializer />
          <UrdfViewer />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-2 gap-2 lg:w-96 flex-shrink-0">
        {[1, 2, 3, 4].map((cam) => (
          <div
            key={cam}
            className="aspect-video bg-gray-900 rounded-lg border border-gray-800 flex flex-col items-center justify-center p-2"
          >
            <VideoOff className="h-8 w-8 text-gray-600 mb-2" />
            <span className="text-gray-500 text-xs text-center">
              No Camera Available
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VisualizerPanel;
