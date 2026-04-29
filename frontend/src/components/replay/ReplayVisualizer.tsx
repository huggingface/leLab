
import React from "react";
import { VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import UrdfViewer from "../UrdfViewer";
import UrdfProcessorInitializer from "../UrdfProcessorInitializer";

interface ReplayVisualizerProps {
  className?: string;
}

const ReplayVisualizer: React.FC<ReplayVisualizerProps> = ({
  className,
}) => {
  return (
    <div
      className={cn(
        "h-full w-full space-y-4 flex flex-col",
        className
      )}
    >
      <div className="bg-gray-900 rounded-lg p-4 flex-1 flex flex-col border border-gray-700">
        <div className="flex-1 bg-black rounded border border-gray-800 min-h-[50vh]">
          <UrdfProcessorInitializer />
          <UrdfViewer />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((cam) => (
          <div
            key={cam}
            className="aspect-video bg-gray-900 rounded-lg border border-gray-800 flex flex-col items-center justify-center p-2"
          >
            <VideoOff className="h-8 w-8 text-gray-600 mb-2" />
            <span className="text-gray-500 text-xs text-center">
              Camera {cam} Feed
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReplayVisualizer;
