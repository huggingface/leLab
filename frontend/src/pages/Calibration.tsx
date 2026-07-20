import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Settings,
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Play,
  Square,
  Circle,
  Camera,
  ShieldQuestion,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Logo from "@/components/Logo";
import PortDetectionButton from "@/components/ui/PortDetectionButton";
import PortDetectionModal from "@/components/ui/PortDetectionModal";
import { useApi } from "@/contexts/ApiContext";
import { isMotorRangeComplete } from "@/lib/calibrationTargets";
import CameraConfiguration, {
  CameraConfig,
} from "@/components/recording/CameraConfiguration";

const DISCONTINUITY_ERROR_PREFIX = "Motor discontinuity detected";

interface CalibrationStatus {
  calibration_active: boolean;
  status: string; // "idle", "connecting", "recording", "completed", "error", "stopping"
  device_type: string | null;
  error: string | null;
  message: string;
  step: number;
  total_steps: number;
  current_positions: Record<string, number> | null;
  recorded_ranges: Record<
    string,
    { min: number; max: number; current: number }
  > | null;
}

interface CalibrationRequest {
  device_type: string; // "robot" or "teleop"
  port: string;
  config_file: string;
  robot_name: string | null;
  robot_type: string;
}

interface RobotRecord {
  name: string;
  leader_port: string;
  follower_port: string;
  leader_config: string;
  follower_config: string;
  cameras: CameraConfig[];
  is_clean: boolean;
  robot_type?: string;
}

const Calibration = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const robotName =
    (location.state as { robot_name?: string } | null)?.robot_name ?? null;
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  const consoleRef = useRef<HTMLDivElement>(null);
  const demoVideoRef = useRef<HTMLDivElement>(null);

  const [deviceType, setDeviceType] = useState<string>("teleop");
  const [port, setPort] = useState<string>("");
  const [robotType, setRobotType] = useState<string>("so101");
  const [robot, setRobot] = useState<RobotRecord | null>(null);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  // Off by default so merely opening the calibration page never grabs a camera.
  // The user explicitly starts a scan, which is when cameras are turned on,
  // enumerated, and the browser permission prompt is requested.
  const [camerasActive, setCamerasActive] = useState(false);
  const cameraSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRobot = useCallback(async (): Promise<RobotRecord | null> => {
    if (!robotName) return null;
    try {
      const res = await fetchWithHeaders(
        `${baseUrl}/robots/${encodeURIComponent(robotName)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const r = (data.robot as RobotRecord | null) ?? null;
      setRobot(r);
      if (r && r.robot_type) {
        setRobotType(r.robot_type);
      }
      return r;
    } catch (e) {
      console.error("Failed to load robot record:", e);
      return null;
    }
  }, [robotName, baseUrl, fetchWithHeaders]);

  // Initial fetch + form prefill on arrival.
  useEffect(() => {
    if (!robotName) return;
    let cancelled = false;
    (async () => {
      const r = await fetchRobot();
      if (!r || cancelled) return;
      // Default to the first incomplete side in the checklist (leader, then follower).
      const defaultDevice = !r.leader_config
        ? "teleop"
        : !r.follower_config
        ? "robot"
        : "teleop";
      setDeviceType(defaultDevice);
      setPort(
        defaultDevice === "teleop"
          ? r.leader_port || ""
          : r.follower_port || ""
      );
      if (r.robot_type) {
        setRobotType(r.robot_type);
      }
      setCameras(r.cameras ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [robotName, fetchRobot]);

  // Persist camera changes back to the robot record (debounced).
  const handleCamerasChange = (next: CameraConfig[]) => {
    setCameras(next);
    if (!robotName) return;
    if (cameraSaveTimerRef.current) {
      clearTimeout(cameraSaveTimerRef.current);
    }
    cameraSaveTimerRef.current = setTimeout(async () => {
      try {
        await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(robotName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cameras: next }),
          }
        );
      } catch (e) {
        console.error("Failed to save cameras to robot record:", e);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (cameraSaveTimerRef.current) {
        clearTimeout(cameraSaveTimerRef.current);
      }
    };
  }, []);

  const [showPortDetection, setShowPortDetection] = useState(false);
  const [detectionRobotType, setDetectionRobotType] = useState<
    "leader" | "follower"
  >("leader");

  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatus>(
    {
      calibration_active: false,
      status: "idle",
      device_type: null,
      error: null,
      message: "",
      step: 0,
      total_steps: 1,
      current_positions: null,
      recorded_ranges: null,
    }
  );
  const [isPolling, setIsPolling] = useState(false);

  // Mirror calibration_active into a ref so the unmount cleanup below can read
  // the latest value without re-firing on every status change.
  const calibrationActiveRef = useRef(false);
  useEffect(() => {
    calibrationActiveRef.current = calibrationStatus.calibration_active;
  }, [calibrationStatus.calibration_active]);

  // If the user leaves this page (back arrow, browser back, programmatic nav)
  // while calibration is running, the backend singleton stays active and the
  // next Start request fails with "Calibration already active". Stop it on
  // unmount as a catch-all.
  useEffect(() => {
    return () => {
      if (calibrationActiveRef.current) {
        fetchWithHeaders(`${baseUrl}/stop-calibration`, { method: "POST" }).catch(
          (e) => console.error("Failed to stop calibration on unmount:", e)
        );
      }
    };
  }, [baseUrl, fetchWithHeaders]);

  const pollStatus = async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/calibration-status`);
      if (response.ok) {
        const status = await response.json();
        setCalibrationStatus(status);

        if (
          !status.calibration_active &&
          (status.status === "completed" ||
            status.status === "error" ||
            status.status === "idle")
        ) {
          setIsPolling(false);
        }
      }
    } catch (error) {
      console.error("Error polling status:", error);
    }
  };

  const handleStartCalibration = async () => {
    if (!robotName) {
      toast({
        title: "No robot selected",
        description: "Open Calibration from a robot's gear icon on the Landing page.",
        variant: "destructive",
      });
      return;
    }
    if (!port) {
      toast({
        title: "Missing port",
        description: "Set the device's serial port before starting.",
        variant: "destructive",
      });
      return;
    }

    const request: CalibrationRequest = {
      device_type: deviceType,
      port: port,
      config_file: robotName,
      robot_name: robotName,
      robot_type: robotType,
    };

    // Optimistically mark as active so the unmount cleanup will fire even if
    // the user navigates away before the backend reports calibration_active=true.
    // Reverted below if the start request fails.
    calibrationActiveRef.current = true;

    try {
      const response = await fetchWithHeaders(`${baseUrl}/start-calibration`, {
        method: "POST",
        body: JSON.stringify(request),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Calibration Started",
          description: `Calibration started for ${deviceType}`,
        });
        setIsPolling(true);
      } else {
        calibrationActiveRef.current = false;
        toast({
          title: "Calibration Failed",
          description: result.message || "Failed to start calibration",
          variant: "destructive",
        });
      }
    } catch (error) {
      calibrationActiveRef.current = false;
      console.error("Error starting calibration:", error);
      toast({
        title: "Error",
        description: "Failed to start calibration",
        variant: "destructive",
      });
    }
  };

  const handleStopCalibration = async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/stop-calibration`, {
        method: "POST",
      });

      const result = await response.json();

      if (result.success) {
        // The 200ms polling interval will pick up the stopped state.
        toast({
          title: "Calibration Stopped",
          description: "Calibration has been stopped",
        });
      } else {
        toast({
          title: "Error",
          description: result.message || "Failed to stop calibration",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error stopping calibration:", error);
      toast({
        title: "Error",
        description: "Failed to stop calibration",
        variant: "destructive",
      });
    }
  };

  const handleCompleteStep = async () => {
    if (!calibrationStatus.calibration_active) return;

    try {
      const response = await fetchWithHeaders(
        `${baseUrl}/complete-calibration-step`,
        { method: "POST" }
      );

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Step Completed",
          description: data.message,
        });
      } else {
        toast({
          title: "Step Failed",
          description: data.message || "Could not complete step",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error completing step:", error);
      toast({
        title: "Error",
        description: "Could not complete calibration step",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (
      calibrationStatus.status === "error" &&
      calibrationStatus.error?.startsWith(DISCONTINUITY_ERROR_PREFIX)
    ) {
      demoVideoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [calibrationStatus.status, calibrationStatus.error]);

  useEffect(() => {
    if (!isPolling) return;
    // Single stable interval. Reads calibration_active from the ref each tick so
    // the interval doesn't tear down/recreate on every status change.
    pollStatus();
    const interval = setInterval(() => {
      pollStatus();
    }, 200);
    return () => clearInterval(interval);
    // pollStatus is stable enough — it only reads via fetchWithHeaders + setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling]);

  // Load default port when device type changes (skip when arriving from a tile —
  // the robot-record prefill above wins)
  useEffect(() => {
    const loadDefaultPort = async () => {
      if (!deviceType) return;
      if (robotName) return;

      try {
        const robotType = deviceType === "robot" ? "follower" : "leader";
        const response = await fetchWithHeaders(
          `${baseUrl}/robot-port/${robotType}`
        );
        const data = await response.json();
        if (data.status === "success") {
          const portToUse = data.saved_port || data.default_port;
          if (portToUse) {
            setPort(portToUse);
          }
        }
      } catch (error) {
        console.error("Error loading default port:", error);
      }
    };

    loadDefaultPort();
  }, [deviceType, robotName, baseUrl, fetchWithHeaders]);

  const handleDeviceTypeChange = (next: string) => {
    setDeviceType(next);
    if (!robot) return;
    setPort(
      next === "teleop" ? robot.leader_port || "" : robot.follower_port || ""
    );
  };

  // Refresh the robot record when a calibration completes so the checklist
  // flips to ✓ for the side that was just saved, and advance Device Type to
  // the next still-incomplete side (or stay on the current side if both done).
  useEffect(() => {
    if (calibrationStatus.status !== "completed") return;
    (async () => {
      const r = await fetchRobot();
      if (!r) return;
      const nextDevice = !r.leader_config
        ? "teleop"
        : !r.follower_config
        ? "robot"
        : "teleop";
      setDeviceType(nextDevice);
      setPort(
        nextDevice === "teleop"
          ? r.leader_port || ""
          : r.follower_port || ""
      );
    })();
  }, [calibrationStatus.status, fetchRobot]);

  const handlePortDetection = () => {
    const robotType = deviceType === "robot" ? "follower" : "leader";
    setDetectionRobotType(robotType);
    setShowPortDetection(true);
  };

  // Write the port for the current side straight into the robot record, so a
  // re-detected USB port (which shuffles on reboot/reconnect) sticks without
  // needing a full re-calibration. Mirrors the camera write-back above.
  const persistPort = useCallback(
    async (nextPort: string) => {
      if (!robotName || !nextPort) return;
      const field = deviceType === "robot" ? "follower_port" : "leader_port";
      // Skip redundant writes when the value already matches the record.
      if (robot && robot[field] === nextPort) return;
      try {
        const res = await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(robotName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: nextPort }),
          }
        );
        const data = await res.json();
        if (data.robot) setRobot(data.robot);
      } catch (e) {
        console.error("Failed to save port to robot record:", e);
      }
    },
    [robotName, deviceType, robot, baseUrl, fetchWithHeaders]
  );

  const persistRobotType = useCallback(
    async (nextType: string) => {
      if (!robotName || !nextType) return;
      if (robot && robot.robot_type === nextType) return;
      try {
        const res = await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(robotName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ robot_type: nextType }),
          }
        );
        const data = await res.json();
        if (data.robot) setRobot(data.robot);
      } catch (e) {
        console.error("Failed to save robot type to robot record:", e);
      }
    },
    [robotName, robot, baseUrl, fetchWithHeaders]
  );

  const handlePortDetected = (detectedPort: string) => {
    setPort(detectedPort);
    persistPort(detectedPort);
  };

  const getStatusDisplay = () => {
    switch (calibrationStatus.status) {
      case "idle":
        return {
          color: "bg-slate-500",
          icon: <Settings className="w-4 h-4" />,
          text: "Idle",
        };
      case "connecting":
        return {
          color: "bg-yellow-500",
          icon: <Loader2 className="w-4 h-4 animate-spin" />,
          text: "Connecting",
        };
      case "recording":
        return {
          color: "bg-purple-500",
          icon: <Activity className="w-4 h-4" />,
          text: "Recording Ranges",
        };
      case "completed":
        return {
          color: "bg-green-500",
          icon: <CheckCircle className="w-4 h-4" />,
          text: "Completed",
        };
      case "error":
        return {
          color: "bg-red-500",
          icon: <XCircle className="w-4 h-4" />,
          text: "Error",
        };
      case "stopping":
        return {
          color: "bg-orange-500",
          icon: <Square className="w-4 h-4" />,
          text: "Stopping",
        };
      default:
        return {
          color: "bg-slate-500",
          icon: <Settings className="w-4 h-4" />,
          text: "Unknown",
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <Logo iconOnly />
            <h1 className="text-3xl font-bold">
              {robotName ? `Calibrate "${robotName}"` : "Device Calibration"}
            </h1>
          </div>
        </div>

        {!robotName && (
          <Alert className="mb-6 bg-amber-900/40 border-amber-700 text-amber-100">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Open Calibration from a robot's gear icon on the Landing page.
              Each robot has its own calibration; running this page directly is
              not supported.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-800/60 border-slate-700 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-200">
                <Settings className="w-5 h-5 text-blue-400" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label
                  htmlFor="robotType"
                  className="text-sm font-medium text-slate-300"
                >
                  Robot Model *
                </Label>
                <Select
                  value={robotType}
                  onValueChange={(val) => {
                    setRobotType(val);
                    persistRobotType(val);
                  }}
                >
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white rounded-md">
                    <SelectValue placeholder="Select robot model" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-white">
                    <SelectItem value="so101" className="hover:bg-slate-700">
                      SO-101 (or SO-100 series)
                    </SelectItem>
                    <SelectItem value="omx_ai" className="hover:bg-slate-700">
                      OMX-AI
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="deviceType"
                  className="text-sm font-medium text-slate-300"
                >
                  Device Type *
                </Label>
                <Select
                  value={deviceType}
                  onValueChange={handleDeviceTypeChange}
                >
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white rounded-md">
                    <SelectValue placeholder="Select device type" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-white">
                    <SelectItem value="teleop" className="hover:bg-slate-700">
                      Teleoperator (Leader)
                    </SelectItem>
                    <SelectItem value="robot" className="hover:bg-slate-700">
                      Robot (Follower)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="port"
                  className="text-sm font-medium text-slate-300"
                >
                  Port *
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="port"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    onBlur={(e) => persistPort(e.target.value)}
                    placeholder="/dev/tty.usbmodem..."
                    className="bg-slate-700 border-slate-600 text-white rounded-md flex-1"
                  />
                  <PortDetectionButton
                    onClick={handlePortDetection}
                    robotType={deviceType === "robot" ? "follower" : "leader"}
                    className="border-slate-600 hover:border-blue-500 text-slate-400 hover:text-blue-400 bg-slate-700 hover:bg-slate-600"
                  />
                </div>
              </div>

              <Separator className="bg-slate-700" />

              <div className="flex flex-col gap-3">
                {!calibrationStatus.calibration_active ? (
                  <Button
                    onClick={handleStartCalibration}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-full py-6 text-lg"
                    disabled={!robotName || !deviceType || !port}
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Start Calibration
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopCalibration}
                    variant="destructive"
                    className="w-full rounded-full py-6 text-lg"
                  >
                    <Square className="w-5 h-5 mr-2" />
                    Cancel Calibration
                  </Button>
                )}
              </div>

              {robot && (
                <div className="space-y-2 pt-2">
                  <div className="text-sm font-medium text-slate-300">
                    Robot calibration
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {robot.leader_config ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-500" />
                    )}
                    <span
                      className={
                        robot.leader_config ? "text-slate-200" : "text-slate-400"
                      }
                    >
                      Leader (Teleoperator)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {robot.follower_config ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-500" />
                    )}
                    <span
                      className={
                        robot.follower_config
                          ? "text-slate-200"
                          : "text-slate-400"
                      }
                    >
                      Follower (Robot)
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-200">
                <Activity className="w-5 h-5 text-teal-400" />
                Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-md">
                <span className="text-slate-300">Status:</span>
                <Badge
                  className={`${statusDisplay.color} text-white rounded-md`}
                >
                  {statusDisplay.icon}
                  <span className="ml-2">{statusDisplay.text}</span>
                </Badge>
              </div>

              {calibrationStatus.status === "recording" &&
                calibrationStatus.recorded_ranges && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-slate-300">
                        Live Position Data
                      </span>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                      <div className="space-y-3">
                        {Object.entries(calibrationStatus.recorded_ranges).map(
                          ([motor, range]) => {
                            const totalRange = range.max - range.min;
                            const currentOffset = range.current - range.min;
                            const progressPercent =
                              totalRange > 0
                                ? (currentOffset / totalRange) * 100
                                : 50;
                            const rangeComplete = isMotorRangeComplete(
                              calibrationStatus.device_type,
                              motor,
                              totalRange,
                              robotType
                            );

                            return (
                              <div key={motor} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white font-semibold text-sm">
                                      {motor}
                                    </span>
                                    {rangeComplete && (
                                      <CheckCircle
                                        className="w-4 h-4 text-green-400"
                                        aria-label="Range complete"
                                      />
                                    )}
                                  </div>
                                  <span className="text-slate-300 text-xs font-mono">
                                    {range.current}
                                  </span>
                                </div>
                                <div className="relative">
                                  <div className="w-full bg-slate-700 rounded-full h-3">
                                    <div
                                      className="bg-slate-600 h-3 rounded-full relative"
                                      style={{ width: "100%" }}
                                    >
                                      <div
                                        className={`absolute top-0 w-1 h-3 rounded-full transition-all duration-100 ${
                                          rangeComplete
                                            ? "bg-green-400"
                                            : "bg-yellow-400"
                                        }`}
                                        style={{
                                          left: `${Math.max(
                                            0,
                                            Math.min(100, progressPercent)
                                          )}%`,
                                          transform: "translateX(-50%)",
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                                    <span>{range.min}</span>
                                    <span>{range.max}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {calibrationStatus.status === "connecting" && (
                <Alert className="bg-yellow-900/50 border-yellow-700 text-yellow-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Connecting to the device. Please ensure it's connected.
                  </AlertDescription>
                </Alert>
              )}

              {calibrationStatus.status === "recording" && (() => {
                const ranges = calibrationStatus.recorded_ranges ?? {};
                const motors = Object.entries(ranges);
                const allComplete =
                  motors.length > 0 &&
                  motors.every(([motor, range]) =>
                    isMotorRangeComplete(
                      calibrationStatus.device_type,
                      motor,
                      range.max - range.min,
                      robotType
                    )
                  );
                return (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <Button
                        onClick={handleCompleteStep}
                        disabled={!calibrationStatus.calibration_active}
                        className={`px-8 py-3 rounded-full transition-colors ${
                          allComplete
                            ? "bg-green-600 hover:bg-green-700"
                            : "bg-orange-500 hover:bg-orange-600"
                        }`}
                      >
                        {allComplete ? (
                          <CheckCircle className="w-4 h-4 mr-2" />
                        ) : (
                          <AlertCircle className="w-4 h-4 mr-2" />
                        )}
                        Save Calibration
                      </Button>
                    </div>
                    <Alert className="bg-purple-900/50 border-purple-700 text-purple-200">
                      <Activity className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Important:</strong> Move EACH joint through its
                        full range. A check appears next to each joint once its
                        range is wide enough.
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              })()}

              {calibrationStatus.status === "completed" && (
                <Alert className="bg-green-900/50 border-green-700 text-green-200">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Calibration completed successfully!
                  </AlertDescription>
                </Alert>
              )}

              {calibrationStatus.status === "error" &&
                calibrationStatus.error &&
                (calibrationStatus.error.startsWith(
                  DISCONTINUITY_ERROR_PREFIX
                ) ? (
                  <Alert className="bg-red-900/50 border-red-700 text-red-200">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="font-semibold text-base mb-1">
                        Motor discontinuity detected
                      </div>
                      <div>
                        Make sure to start the calibration with the robot in a
                        middle position — all joints in the middle of their
                        ranges. See the calibration demo below for the correct
                        starting pose.
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="bg-red-900/50 border-red-700 text-red-200">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Error:</strong> {calibrationStatus.error}
                    </AlertDescription>
                  </Alert>
                ))}

              <div
                ref={demoVideoRef}
                className="bg-slate-900/50 p-4 rounded-lg border border-slate-700"
              >
                <h4 className="font-semibold mb-3 text-slate-200">
                  Calibration Demo:
                </h4>
                <div className="relative rounded-lg overflow-hidden bg-slate-800">
                  <video
                    className="w-full h-auto rounded-md"
                    controls
                    preload="auto"
                    muted
                  >
                    <source
                      src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/lerobot/calibrate_so101_2.mp4"
                      type="video/mp4"
                    />
                    <p className="text-slate-400 text-sm text-center py-4">
                      Your browser does not support the video tag.
                      <br />
                      <a
                        href="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/lerobot/calibrate_so101_2.mp4"
                        className="text-blue-400 hover:text-blue-300 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Click here to view the calibration video
                      </a>
                    </p>
                  </video>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {robotName && (
          <Card className="bg-slate-800/60 border-slate-700 backdrop-blur-sm mt-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-slate-200">
                <Settings className="w-5 h-5 text-blue-400" />
                Attached cameras
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="cameras-toggle"
                  className="text-sm text-slate-400 cursor-pointer"
                >
                  {camerasActive ? "On" : "Off"}
                </Label>
                <Switch
                  id="cameras-toggle"
                  checked={camerasActive}
                  onCheckedChange={setCamerasActive}
                  className="data-[state=checked]:bg-green-500"
                  aria-label="Turn cameras on or off"
                />
              </div>
            </CardHeader>
            <CardContent>
              {camerasActive ? (
                <CameraConfiguration
                  cameras={cameras}
                  onCamerasChange={handleCamerasChange}
                />
              ) : (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 text-center space-y-3">
                  <Camera className="w-10 h-10 mx-auto text-slate-500" />
                  <div className="space-y-1">
                    <p className="text-slate-200 font-medium">Cameras are off</p>
                    <p className="text-sm text-slate-400 max-w-md mx-auto">
                      Turn cameras on to scan for connected devices and preview
                      them. The browser may briefly open a camera to read device
                      labels, and configured cameras stay active while previews
                      are visible; your browser will ask for camera permission.
                      Nothing is recorded.
                    </p>
                    {cameras.length > 0 && (
                      <p className="text-xs text-slate-500 pt-1">
                        {cameras.length} camera
                        {cameras.length === 1 ? "" : "s"} saved to this robot.
                      </p>
                    )}
                  </div>
                  <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                    <ShieldQuestion className="w-3.5 h-3.5" />
                    You'll be asked to grant camera access.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <PortDetectionModal
        open={showPortDetection}
        onOpenChange={setShowPortDetection}
        robotType={detectionRobotType}
        onPortDetected={handlePortDetected}
      />
    </div>
  );
};

export default Calibration;
