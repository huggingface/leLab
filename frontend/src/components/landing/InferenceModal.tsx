import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle, Loader2, Play, VideoOff } from "lucide-react";
import { RobotRecord } from "@/hooks/useRobots";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  JobCheckpoint,
  PolicyConfigSummary,
  getCheckpointPolicyConfig,
  listJobCheckpoints,
} from "@/lib/checkpointsApi";
import { startInference } from "@/lib/inferenceApi";
import CheckpointDropdown from "@/components/jobs/CheckpointDropdown";
import { useAvailableCameras } from "@/hooks/useAvailableCameras";
import { useCameraStream } from "@/hooks/useCameraStream";

const CameraThumbnail: React.FC<{ deviceId: string; paused: boolean }> = ({
  deviceId,
  paused,
}) => {
  const { videoRef, hasError } = useCameraStream(deviceId, paused);
  if (paused || hasError || !deviceId) {
    return (
      <div className="w-32 h-24 bg-gray-800 rounded border border-gray-700 flex flex-col items-center justify-center">
        <VideoOff className="w-5 h-5 text-gray-500 mb-1" />
        <span className="text-[10px] text-gray-500">
          {paused ? "Released" : "No preview"}
        </span>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="w-32 h-24 object-cover rounded border border-gray-700 bg-black"
    />
  );
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robot: RobotRecord | null;
  jobId: string;
  initialStep: number | null;
}

const DEFAULT_FPS = 30;

const InferenceModal: React.FC<Props> = ({
  open,
  onOpenChange,
  robot,
  jobId,
  initialStep,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [checkpoints, setCheckpoints] = useState<JobCheckpoint[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(initialStep);
  const [task, setTask] = useState("");
  const [durationS, setDurationS] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  const [policyConfig, setPolicyConfig] = useState<PolicyConfigSummary | null>(null);
  const [policyConfigLoading, setPolicyConfigLoading] = useState(false);
  const [policyConfigError, setPolicyConfigError] = useState<string | null>(null);

  // Per expected camera name → user-selected physical camera index (or null).
  const [cameraBindings, setCameraBindings] = useState<Record<string, number | null>>({});
  const { cameras: availableCameras } = useAvailableCameras({ enabled: open });

  // Load checkpoints when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listJobCheckpoints(baseUrl, fetchWithHeaders, jobId)
      .then((cks) => {
        if (cancelled) return;
        setCheckpoints(cks);
        if (cks.length > 0) {
          const latest = cks[cks.length - 1].step;
          setSelectedStep((prev) => (prev != null ? prev : latest));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCheckpoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, fetchWithHeaders, jobId]);


  // Load policy config when step changes.
  useEffect(() => {
    if (!open || selectedStep == null) {
      setPolicyConfig(null);
      setPolicyConfigError(null);
      return;
    }
    let cancelled = false;
    setPolicyConfigLoading(true);
    setPolicyConfigError(null);
    getCheckpointPolicyConfig(baseUrl, fetchWithHeaders, jobId, selectedStep)
      .then((cfg) => {
        if (cancelled) return;
        setPolicyConfig(cfg);
        // Reset camera bindings to one entry per expected camera name.
        // Preserve any prior selection that's still relevant.
        setCameraBindings((prev) => {
          const next: Record<string, number | null> = {};
          for (const name of Object.keys(cfg.image_features)) {
            next[name] = prev[name] ?? null;
          }
          return next;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setPolicyConfig(null);
        setPolicyConfigError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setPolicyConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, fetchWithHeaders, jobId, selectedStep]);

  // If the selected robot has cameras whose names match a policy-expected
  // camera, auto-bind them. Prefer matching by browser device_id (stable
  // across cv2 index drift); fall back to the saved camera_index.
  useEffect(() => {
    if (!policyConfig) return;
    const robotCams = robot?.cameras ?? [];
    if (robotCams.length === 0 || availableCameras.length === 0) return;
    setCameraBindings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const policyName of Object.keys(policyConfig.image_features)) {
        if (next[policyName] != null) continue;
        const robotCam = robotCams.find(
          (c) => c.name.toLowerCase() === policyName.toLowerCase(),
        );
        if (!robotCam) continue;
        const live =
          (robotCam.device_id &&
            availableCameras.find((c) => c.deviceId === robotCam.device_id)) ||
          availableCameras.find((c) => c.index === robotCam.camera_index);
        if (live) {
          next[policyName] = live.index;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [policyConfig, robot, availableCameras]);

  const selectedRef =
    selectedStep != null
      ? checkpoints.find((c) => c.step === selectedStep)?.ref ?? null
      : null;

  const expectedCameraNames = policyConfig
    ? Object.keys(policyConfig.image_features)
    : [];
  const allCamerasBound = expectedCameraNames.every(
    (name) => cameraBindings[name] != null,
  );

  const canStart =
    !!robot &&
    robot.is_clean &&
    selectedRef != null &&
    !!policyConfig &&
    allCamerasBound &&
    !submitting;

  const handleStart = async () => {
    if (!robot || selectedRef == null || !policyConfig) return;
    // Setting submitting=true makes every CameraPreview drop its
    // browser stream — required so the rollout subprocess can open the
    // same camera index via OpenCV without colliding on the device.
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 300));
    const cameraDict: Record<string, {
      type: string; camera_index?: number; width: number; height: number; fps?: number;
    }> = {};
    for (const [name, dims] of Object.entries(policyConfig.image_features)) {
      const idx = cameraBindings[name];
      if (idx == null) continue;
      cameraDict[name] = {
        type: "opencv",
        camera_index: idx,
        width: dims.width,
        height: dims.height,
        fps: DEFAULT_FPS,
      };
    }
    try {
      await startInference(baseUrl, fetchWithHeaders, {
        follower_port: robot.follower_port,
        follower_config: robot.follower_config,
        policy_ref: selectedRef,
        task,
        cameras: cameraDict,
        duration_s: durationS,
        robot_type: robot.robot_type || "so101",
      });
      onOpenChange(false);
      navigate("/inference");
    } catch (e) {
      toast({
        title: "Couldn't start inference",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      // Failure: bring the previews back so the user can adjust.
      setSubmitting(false);
    }
  };

  const onCameraBindingChange = (name: string, value: string) => {
    const idx = Number(value);
    setCameraBindings((prev) => ({ ...prev, [name]: idx }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-[600px] p-8 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-center items-center mb-4">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <Play className="w-4 h-4 text-white" />
            </div>
          </div>
          <DialogTitle className="text-white text-center text-2xl font-bold">
            Configure Inference
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <DialogDescription className="text-gray-400 text-base leading-relaxed text-center">
            Pick a checkpoint and confirm hardware. The selected policy will
            drive the follower autonomously for the configured duration.
          </DialogDescription>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
              Robot Configuration
            </h3>
            {!robot ? (
              <Alert className="bg-amber-900/40 border-amber-700 text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Select and configure a robot on the Landing page first.
                </AlertDescription>
              </Alert>
            ) : !robot.is_clean ? (
              <Alert className="bg-amber-900/40 border-amber-700 text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>{robot.name}</strong> is missing a calibration.
                  Configure it before running inference.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-slate-200">
                  Running on <strong>{robot.name}</strong>
                </span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
              Checkpoint
            </h3>
            {checkpoints.length === 0 ? (
              <Alert className="bg-amber-900/40 border-amber-700 text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No checkpoints available for this job yet.
                </AlertDescription>
              </Alert>
            ) : (
              <CheckpointDropdown
                checkpoints={checkpoints}
                selectedStep={selectedStep}
                onChange={setSelectedStep}
              />
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
              Run parameters
            </h3>
            {policyConfig?.requires_task ? (
              <div className="space-y-2">
                <Label htmlFor="task" className="text-sm font-medium text-gray-300">
                  Task description
                </Label>
                <Input
                  id="task"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="e.g., pick up the red block"
                  className="bg-gray-800 border-gray-700 text-white"
                />
                <p className="text-xs text-gray-500">
                  This policy is language-conditioned ({policyConfig.policy_type}).
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="durationS" className="text-sm font-medium text-gray-300">
                Max duration (seconds)
              </Label>
              <NumberInput
                id="durationS"
                min={1}
                value={durationS}
                onChange={(v) => {
                  if (v !== undefined) setDurationS(v);
                }}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
              Cameras
            </h3>
            {policyConfigLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Reading policy config…
              </div>
            ) : policyConfigError ? (
              <Alert className="bg-red-900/40 border-red-700 text-red-100">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Couldn't load policy config: {policyConfigError}
                </AlertDescription>
              </Alert>
            ) : !policyConfig ? null : expectedCameraNames.length === 0 ? (
              <p className="text-xs text-gray-500">
                This policy doesn't use cameras.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Bind a physical camera to each name the policy was trained
                  with. Resolution comes from the checkpoint.
                </p>
                {expectedCameraNames.map((name) => {
                  const dims = policyConfig.image_features[name];
                  const value = cameraBindings[name];
                  const bound =
                    value != null
                      ? availableCameras.find((c) => c.index === value)
                      : undefined;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <div className="flex-1">
                        <Label className="text-sm font-medium text-gray-200">
                          {name}
                        </Label>
                        <p className="text-xs text-gray-500">
                          {dims.width}×{dims.height}
                        </p>
                      </div>
                      <Select
                        value={value != null ? String(value) : undefined}
                        onValueChange={(v) => onCameraBindingChange(name, v)}
                      >
                        <SelectTrigger className="bg-gray-800 border-gray-700 text-white w-56">
                          <SelectValue placeholder="Select a camera" />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-900 border-gray-700 text-white">
                          {availableCameras.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-gray-500">
                              No cameras detected
                            </div>
                          ) : (
                            availableCameras.map((cam) => (
                              <SelectItem
                                key={cam.index}
                                value={String(cam.index)}
                              >
                                #{cam.index} — {cam.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <CameraThumbnail deviceId={bound?.deviceId ?? ""} paused={submitting} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              onClick={handleStart}
              disabled={!canStart}
              className="w-full sm:w-auto bg-green-500 hover:bg-green-600 text-white px-10 py-6 text-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-5 h-5 mr-2" />
              {submitting ? "Starting…" : "Start Inference"}
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="w-full sm:w-auto border-gray-500 hover:border-gray-200 px-10 py-6 text-lg text-zinc-500 bg-zinc-900 hover:bg-zinc-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InferenceModal;
