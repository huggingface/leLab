import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Search, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";

interface PortDetectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robotType: "leader" | "follower";
  onPortDetected: (port: string) => void;
}

const PortDetectionModal: React.FC<PortDetectionModalProps> = ({
  open,
  onOpenChange,
  robotType,
  onPortDetected,
}) => {
  const [step, setStep] = useState<
    "instructions" | "detecting" | "success" | "error"
  >("instructions");
  const [detectedPort, setDetectedPort] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [portsBeforeDisconnect, setPortsBeforeDisconnect] = useState<string[]>(
    []
  );
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  const handleStartDetection = async () => {
    try {
      setStep("detecting");
      setError("");

      // Start port detection process
      const response = await fetchWithHeaders(
        `${baseUrl}/start-port-detection`,
        {
          method: "POST",
          body: JSON.stringify({
            robot_type: robotType,
          }),
        }
      );

      const data = await response.json();

      if (data.status === "success") {
        setPortsBeforeDisconnect(data.data.ports_before);
        // Backend polls for up to 15s waiting for the user to unplug —
        // call immediately, the request stays open until a port disappears or timeout.
        detectPortAfterDisconnect(data.data.ports_before);
      } else {
        throw new Error(data.message || "Failed to start port detection");
      }
    } catch (error) {
      console.error("Error starting port detection:", error);
      setError(
        `Error starting detection: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      setStep("error");
    }
  };

  const detectPortAfterDisconnect = async (portsBefore: string[]) => {
    try {
      const response = await fetchWithHeaders(
        `${baseUrl}/detect-port-after-disconnect`,
        {
          method: "POST",
          body: JSON.stringify({
            ports_before: portsBefore,
          }),
        }
      );

      const data = await response.json();

      if (data.status === "success") {
        setDetectedPort(data.port);

        // Save the port for future use
        await savePort(data.port);

        setStep("success");

        toast({
          title: "Port Detected Successfully",
          description: `${robotType} port detected: ${data.port}`,
        });
      } else {
        throw new Error(data.message || "Failed to detect port");
      }
    } catch (error) {
      console.error("Error detecting port:", error);
      setError(
        `Error detecting port: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      setStep("error");
    }
  };

  const savePort = async (port: string) => {
    try {
      await fetchWithHeaders(`${baseUrl}/save-robot-port`, {
        method: "POST",
        body: JSON.stringify({
          robot_type: robotType,
          port: port,
        }),
      });
    } catch (error) {
      console.error("Error saving port:", error);
      // Don't throw here, as the main detection was successful
    }
  };

  const handleUsePort = () => {
    onPortDetected(detectedPort);
    onOpenChange(false);
    resetModal();
  };

  const handleClose = () => {
    onOpenChange(false);
    resetModal();
  };

  const resetModal = () => {
    setStep("instructions");
    setDetectedPort("");
    setError("");
    setPortsBeforeDisconnect([]);
  };

  const renderStepContent = () => {
    switch (step) {
      case "instructions":
        return (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <Search className="w-16 h-16 text-blue-500 mx-auto" />
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">
                  Detect {robotType === "leader" ? "Leader" : "Follower"} Port
                </h3>
                <p className="text-gray-400">
                  Follow these steps to automatically detect the robot port:
                </p>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  1
                </div>
                <p className="text-gray-300 text-sm">
                  Make sure your {robotType} robot arm is currently connected
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  2
                </div>
                <p className="text-gray-300 text-sm">
                  Click "Start Detection" below
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  3
                </div>
                <p className="text-gray-300 text-sm">
                  When prompted,{" "}
                  <strong>unplug the {robotType} robot arm</strong> from USB
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  4
                </div>
                <p className="text-gray-300 text-sm">
                  The system will automatically detect which port was
                  disconnected
                </p>
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <Button
                onClick={handleStartDetection}
                className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-2"
              >
                Start Detection
              </Button>
              <Button
                onClick={handleClose}
                variant="outline"
                className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white px-8 py-2"
              >
                Cancel
              </Button>
            </div>
          </div>
        );

      case "detecting":
        return (
          <div className="space-y-6 text-center">
            <Loader2 className="w-16 h-16 text-blue-500 mx-auto animate-spin" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-white">
                Detecting Port...
              </h3>
              <p className="text-gray-400">
                Please <strong>unplug the {robotType} robot arm</strong> from
                USB now
              </p>
              <p className="text-sm text-gray-500">
                Detection will complete automatically in a few seconds
              </p>
            </div>
          </div>
        );

      case "success":
        return (
          <div className="space-y-6 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-white">
                Port Detected Successfully!
              </h3>
              <p className="text-gray-400">
                {robotType === "leader" ? "Leader" : "Follower"} port detected:
              </p>
              <p className="text-xl font-mono text-green-400 bg-gray-800 px-4 py-2 rounded">
                {detectedPort}
              </p>
              <p className="text-sm text-gray-500">
                This port has been saved as the default for future use.
                <br />
                You can now reconnect your robot arm.
              </p>
            </div>

            <div className="flex gap-4 justify-center">
              <Button
                onClick={handleUsePort}
                className="bg-green-500 hover:bg-green-600 text-white px-8 py-2"
              >
                Use This Port
              </Button>
              <Button
                onClick={handleClose}
                variant="outline"
                className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white px-8 py-2"
              >
                Cancel
              </Button>
            </div>
          </div>
        );

      case "error":
        return (
          <div className="space-y-6 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-white">
                Detection Failed
              </h3>
              <p className="text-gray-400">Unable to detect the robot port.</p>
              <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <Button
                onClick={() => setStep("instructions")}
                className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-2"
              >
                Try Again
              </Button>
              <Button
                onClick={handleClose}
                variant="outline"
                className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white px-8 py-2"
              >
                Cancel
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-[500px] p-8">
        <DialogHeader>
          <DialogTitle className="text-white text-center text-xl font-bold">
            Port Detection
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-center">
            Automatically detect the USB port for your robot arm
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">{renderStepContent()}</div>
      </DialogContent>
    </Dialog>
  );
};

export default PortDetectionModal;
