import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight } from "lucide-react";
import LandingHeader from "@/components/landing/LandingHeader";
import RobotModelSelector from "@/components/landing/RobotModelSelector";
import ActionList from "@/components/landing/ActionList";
import PermissionModal from "@/components/landing/PermissionModal";
import TeleoperationModal from "@/components/landing/TeleoperationModal";
import RecordingModal from "@/components/landing/RecordingModal";

import { Action } from "@/components/landing/types";
import UsageInstructionsModal from "@/components/landing/UsageInstructionsModal";
import DirectFollowerModal from "@/components/landing/DirectFollowerModal";
import { useApi } from "@/contexts/ApiContext";
import { CameraConfig } from "@/components/recording/CameraConfiguration";

const Landing = () => {
  const [robotModel, setRobotModel] = useState("SO101");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showTeleoperationModal, setShowTeleoperationModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);

  const [leaderPort, setLeaderPort] = useState("/dev/tty.usbmodem5A460816421");
  const [followerPort, setFollowerPort] = useState(
    "/dev/tty.usbmodem5A460816621"
  );
  const [leaderConfig, setLeaderConfig] = useState("");
  const [followerConfig, setFollowerConfig] = useState("");
  const [leaderConfigs, setLeaderConfigs] = useState<string[]>([]);
  const [followerConfigs, setFollowerConfigs] = useState<string[]>([]);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
  const { baseUrl, fetchWithHeaders } = useApi();

  // Recording state
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [recordLeaderPort, setRecordLeaderPort] = useState(
    "/dev/tty.usbmodem5A460816421"
  );
  const [recordFollowerPort, setRecordFollowerPort] = useState(
    "/dev/tty.usbmodem5A460816621"
  );
  const [recordLeaderConfig, setRecordLeaderConfig] = useState("");
  const [recordFollowerConfig, setRecordFollowerConfig] = useState("");
  const [datasetRepoId, setDatasetRepoId] = useState("");
  const [singleTask, setSingleTask] = useState("");
  const [numEpisodes, setNumEpisodes] = useState(5);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);

  // Camera stream release ref
  const releaseStreamsRef = useRef<(() => void) | null>(null);

  // Direct follower control state
  const [showDirectFollowerModal, setShowDirectFollowerModal] = useState(false);
  const [directFollowerPort, setDirectFollowerPort] = useState(
    "/dev/tty.usbmodem5A460816621"
  );
  const [directFollowerConfig, setDirectFollowerConfig] = useState("");

  const navigate = useNavigate();
  const { toast } = useToast();

  // Clear camera state and release streams when returning to landing page
  useEffect(() => {
    // If we have cameras and returning from a recording session, clear them
    if (cameras.length > 0) {
      console.log(
        "🧹 Landing page: Cleaning up camera state from previous session"
      );
      if (releaseStreamsRef.current) {
        releaseStreamsRef.current();
      }
      setCameras([]); // Clear camera configuration
    }
  }, []); // Only run on mount

  // Cleanup when leaving landing page
  useEffect(() => {
    return () => {
      if (releaseStreamsRef.current) {
        console.log("🧹 Landing page: Cleaning up camera streams on unmount");
        releaseStreamsRef.current();
      }
    };
  }, []);

  const loadConfigs = async () => {
    setIsLoadingConfigs(true);
    try {
      const response = await fetchWithHeaders(`${baseUrl}/get-configs`);
      const data = await response.json();
      setLeaderConfigs(data.leader_configs || []);
      setFollowerConfigs(data.follower_configs || []);
    } catch (error) {
      toast({
        title: "Error Loading Configs",
        description: "Could not load calibration configs from the backend.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingConfigs(false);
    }
  };

  const handleBeginSession = () => {
    if (robotModel) {
      setShowPermissionModal(true);
    }
  };

  const handleTeleoperationClick = () => {
    if (robotModel) {
      setShowTeleoperationModal(true);
      loadConfigs();
    }
  };

  const handleCalibrationClick = () => {
    if (robotModel) {
      navigate("/calibration");
    }
  };

  const handleRecordingClick = () => {
    if (robotModel) {
      setShowRecordingModal(true);
      loadConfigs();
    }
  };

  const handleRecordingModalClose = (open: boolean) => {
    setShowRecordingModal(open);
    // Release camera streams when modal is closed
    if (!open && releaseStreamsRef.current) {
      console.log("🧹 Modal closed: Releasing camera streams");
      releaseStreamsRef.current();
    }
  };

  const handleTrainingClick = () => {
    if (robotModel) {
      navigate("/training");
    }
  };

  const handleReplayDatasetClick = () => {
    if (robotModel) {
      navigate("/replay-dataset");
    }
  };

  const handleDirectFollowerClick = () => {
    if (robotModel) {
      setShowDirectFollowerModal(true);
      loadConfigs();
    }
  };

  const handleStartTeleoperation = async () => {
    if (!leaderConfig || !followerConfig) {
      toast({
        title: "Missing Configuration",
        description:
          "Please select calibration configs for both leader and follower.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetchWithHeaders(`${baseUrl}/move-arm`, {
        method: "POST",
        body: JSON.stringify({
          leader_port: leaderPort,
          follower_port: followerPort,
          leader_config: leaderConfig,
          follower_config: followerConfig,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Teleoperation Started",
          description:
            data.message || "Successfully started teleoperation session.",
        });
        setShowTeleoperationModal(false);
        navigate("/teleoperation");
      } else {
        toast({
          title: "Error Starting Teleoperation",
          description: data.message || "Failed to start teleoperation session.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    }
  };

  const handleStartRecording = async () => {
    if (
      !recordLeaderConfig ||
      !recordFollowerConfig ||
      !datasetRepoId ||
      !singleTask
    ) {
      toast({
        title: "Missing Configuration",
        description:
          "Please fill in all required fields: calibration configs, dataset ID, and task name.",
        variant: "destructive",
      });
      return;
    }

    // 🔓 CRITICAL: Release all camera streams before backend accesses them
    if (cameras.length > 0 && releaseStreamsRef.current) {
      console.log("🔓 Releasing camera streams before starting recording...");

      toast({
        title: "Preparing Camera Resources",
        description: `Releasing ${cameras.length} camera stream(s) for recording...`,
      });

      releaseStreamsRef.current();

      // Wait a moment for camera resources to be fully released
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("✅ Camera streams released, proceeding with recording...");

      toast({
        title: "Camera Resources Ready",
        description:
          "Camera streams released successfully. Starting recording...",
      });
    }

    // Convert cameras to the LeRobot format
    const cameraDict = cameras.reduce((acc, cam) => {
      acc[cam.name] = {
        type: cam.type,
        camera_index: cam.camera_index,
        width: cam.width,
        height: cam.height,
        fps: cam.fps,
      };
      return acc;
    }, {} as Record<string, { type: string; camera_index?: number; width: number; height: number; fps?: number }>);

    const recordingConfig = {
      leader_port: recordLeaderPort,
      follower_port: recordFollowerPort,
      leader_config: recordLeaderConfig,
      follower_config: recordFollowerConfig,
      dataset_repo_id: datasetRepoId,
      single_task: singleTask,
      num_episodes: numEpisodes,
      episode_time_s: 60,
      reset_time_s: 15,
      fps: 30,
      video: true,
      push_to_hub: false,
      resume: false,
      cameras: cameraDict,
    };

    setShowRecordingModal(false);
    navigate("/recording", { state: { recordingConfig } });
  };

  const handleStartDirectFollower = async () => {
    if (!directFollowerConfig) {
      toast({
        title: "Missing Configuration",
        description: "Please select a calibration config for the follower.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch("http://localhost:8000/direct-follower", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          follower_port: directFollowerPort,
          follower_config: directFollowerConfig,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Direct Follower Control Started",
          description:
            data.message || "Successfully started direct follower control.",
        });
        setShowDirectFollowerModal(false);
        navigate("/direct-follower");
      } else {
        toast({
          title: "Error Starting Direct Follower Control",
          description:
            data.message || "Failed to start direct follower control.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    }
  };

  const handlePermissions = async (allow: boolean) => {
    setShowPermissionModal(false);
    if (allow) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        toast({
          title: "Permissions Granted",
          description:
            "Camera and microphone access enabled. Entering control session...",
        });
        navigate("/control");
      } catch (error) {
        toast({
          title: "Permission Denied",
          description:
            "Camera and microphone access is required for robot control.",
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "Permission Denied",
        description: "You can proceed, but with limited functionality.",
        variant: "destructive",
      });
      navigate("/control");
    }
  };

  const actions: Action[] = [
    {
      title: "Calibration",
      description: "Calibrate robot arm positions.",
      handler: handleCalibrationClick,
      color: "bg-indigo-500 hover:bg-indigo-600",
      isWorkInProgress: false,
    },
    {
      title: "Teleoperation",
      description: "Control the robot arm in real-time.",
      handler: handleTeleoperationClick,
      color: "bg-yellow-500 hover:bg-yellow-600",
    },
    {
      title: "Record Dataset",
      description: "Record episodes for training data.",
      handler: handleRecordingClick,
      color: "bg-red-500 hover:bg-red-600",
    },
    {
      title: "Replay Dataset",
      description: "Replay and analyze recorded datasets.",
      handler: handleReplayDatasetClick,
      color: "bg-purple-500 hover:bg-purple-600",
      isWorkInProgress: true,
    },
    {
      title: "Training",
      description: "Train a model on your datasets.",
      handler: handleTrainingClick,
      color: "bg-green-500 hover:bg-green-600",
      isWorkInProgress: true,
    },
    {
      title: "Direct Follower Control",
      description: "Control robot arm with mouse movements.",
      handler: handleDirectFollowerClick,
      color: "bg-blue-500 hover:bg-blue-600",
      isWorkInProgress: true,
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pt-12 sm:pt-20">
      <div className="w-full max-w-7xl mx-auto px-4 mb-12">
        <LandingHeader onShowInstructions={() => setShowUsageModal(true)} />
      </div>

      <div className="p-8 bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl space-y-6 border border-gray-700">
        <RobotModelSelector
          robotModel={robotModel}
          onValueChange={setRobotModel}
        />
        <ActionList actions={actions} robotModel={robotModel} />
      </div>

      <PermissionModal
        open={showPermissionModal}
        onOpenChange={setShowPermissionModal}
        onPermissionsResult={handlePermissions}
      />

      <UsageInstructionsModal
        open={showUsageModal}
        onOpenChange={setShowUsageModal}
      />

      <TeleoperationModal
        open={showTeleoperationModal}
        onOpenChange={setShowTeleoperationModal}
        leaderPort={leaderPort}
        setLeaderPort={setLeaderPort}
        followerPort={followerPort}
        setFollowerPort={setFollowerPort}
        leaderConfig={leaderConfig}
        setLeaderConfig={setLeaderConfig}
        followerConfig={followerConfig}
        setFollowerConfig={setFollowerConfig}
        leaderConfigs={leaderConfigs}
        followerConfigs={followerConfigs}
        isLoadingConfigs={isLoadingConfigs}
        onStart={handleStartTeleoperation}
      />

      <RecordingModal
        open={showRecordingModal}
        onOpenChange={handleRecordingModalClose}
        leaderPort={recordLeaderPort}
        setLeaderPort={setRecordLeaderPort}
        followerPort={recordFollowerPort}
        setFollowerPort={setRecordFollowerPort}
        leaderConfig={recordLeaderConfig}
        setLeaderConfig={setRecordLeaderConfig}
        followerConfig={recordFollowerConfig}
        setFollowerConfig={setRecordFollowerConfig}
        leaderConfigs={leaderConfigs}
        followerConfigs={followerConfigs}
        datasetRepoId={datasetRepoId}
        setDatasetRepoId={setDatasetRepoId}
        singleTask={singleTask}
        setSingleTask={setSingleTask}
        numEpisodes={numEpisodes}
        setNumEpisodes={setNumEpisodes}
        cameras={cameras}
        setCameras={setCameras}
        isLoadingConfigs={isLoadingConfigs}
        onStart={handleStartRecording}
        releaseStreamsRef={releaseStreamsRef}
      />

      <DirectFollowerModal
        open={showDirectFollowerModal}
        onOpenChange={setShowDirectFollowerModal}
        followerPort={directFollowerPort}
        setFollowerPort={setDirectFollowerPort}
        followerConfig={directFollowerConfig}
        setFollowerConfig={setDirectFollowerConfig}
        followerConfigs={followerConfigs}
        isLoadingConfigs={isLoadingConfigs}
        onStart={handleStartDirectFollower}
      />
    </div>
  );
};

export default Landing;
