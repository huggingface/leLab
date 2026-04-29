import React from "react";
import { useNavigate } from "react-router-dom";
import VisualizerPanel from "@/components/control/VisualizerPanel";
import { useToast } from "@/hooks/use-toast";
import DirectFollowerControlPanel from "@/components/control/DirectFollowerControlPanel";
import UrdfViewer from "@/components/UrdfViewer";
import UrdfProcessorInitializer from "@/components/UrdfProcessorInitializer";
import Logo from "@/components/Logo";

const DirectFollowerPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleGoBack = async () => {
    try {
      // Stop the direct follower control process before navigating back
      console.log("🛑 Stopping direct follower control...");
      const response = await fetch("http://localhost:8000/stop-direct-follower", {
        method: "POST",
      });

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Direct follower control stopped:", result.message);
        toast({
          title: "Direct Follower Control Stopped",
          description:
            result.message ||
            "Direct follower control has been stopped successfully.",
        });
      } else {
        const errorText = await response.text();
        console.warn(
          "⚠️ Failed to stop direct follower control:",
          response.status,
          errorText
        );
        toast({
          title: "Warning",
          description: `Failed to stop direct follower control properly. Status: ${response.status}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("❌ Error stopping direct follower control:", error);
      toast({
        title: "Error",
        description: "Failed to communicate with the robot server.",
        variant: "destructive",
      });
    } finally {
      // Navigate back regardless of the result
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div className="w-full h-[95vh] flex flex-col lg:flex-row gap-4">
        {/* Left: Visualizer */}
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-900 rounded-lg p-4 flex-1 flex flex-col">
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={handleGoBack}
                className="text-gray-400 hover:text-white hover:bg-gray-800 p-2 rounded transition-colors"
                aria-label="Go Back"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {/* Only the logo, no "LiveLab" or blue L avatar */}
              <Logo iconOnly />
              <div className="w-px h-6 bg-gray-700" />
              <h2 className="text-xl font-medium text-gray-200">Direct Follower Control</h2>
            </div>
            {/* Visualization area */}
            <div className="flex-1 bg-black rounded border border-gray-800 min-h-[50vh]">
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-full h-full">
                  {/* Urdf Viewer only */}
                  <VisualizerOnlyUrdf />
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Right: Control Panel */}
        <div className="lg:w-[400px] flex-shrink-0 flex flex-col">
          <DirectFollowerControlPanel />
        </div>
      </div>
    </div>
  );
};

// Helper component to render just the URDF viewer
const VisualizerOnlyUrdf: React.FC = () => {
  // Important: Keep this separate from panels with cameras!
  return (
    <div className="w-full h-full">
      {/* Use the same URDF viewer as in Teleoperation */}
      <React.Suspense fallback={<div className="text-gray-400 p-12 text-center">Loading robot model...</div>}>
        <UrdfVisualizerWithProcessor />
      </React.Suspense>
    </div>
  );
};

const UrdfVisualizerWithProcessor: React.FC = () => (
  <>
    <UrdfProcessorInitializer />
    <UrdfViewer />
  </>
);

export default DirectFollowerPage;
