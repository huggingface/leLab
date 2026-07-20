import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import LandingTopBar from "@/components/landing/LandingTopBar";
import Footer from "@/components/Footer";
import RobotConfigManager from "@/components/landing/RobotConfigManager";
import RecordingModal from "@/components/landing/RecordingModal";
import DatasetPicker from "@/components/landing/DatasetPicker";
import JobsSection from "@/components/jobs/JobsSection";

import UsageInstructionsModal from "@/components/landing/UsageInstructionsModal";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { useRobots } from "@/hooks/useRobots";
import { useDatasets } from "@/hooks/useDatasets";
import { DatasetItem } from "@/lib/replayApi";
import { CameraConfig } from "@/components/recording/CameraConfiguration";
import { isHostedSpace } from "@/lib/isHostedSpace";

const ON_SPACE = isHostedSpace();

const Landing = () => {
  const [showUsageModal, setShowUsageModal] = useState(ON_SPACE);
  const { auth } = useHfAuth();

  const {
    selectedName,
    selectedRecord,
    availableNames,
    isLoading: isLoadingRobots,
    selectRobot,
    createRobot,
    deleteRobot,
  } = useRobots();

  const { datasets, loading: datasetsLoading } = useDatasets();

  // Recording modal state
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [singleTask, setSingleTask] = useState("");
  const [numEpisodes, setNumEpisodes] = useState(5);
  const [episodeTimeS, setEpisodeTimeS] = useState(60);
  const [resetTimeS, setResetTimeS] = useState(15);
  const [streamingEncoding, setStreamingEncoding] = useState(true);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);

  const releaseStreamsRef = useRef<(() => void) | null>(null);

  const navigate = useNavigate();
  const { toast } = useToast();

  // Clear camera state and release streams when returning to landing page
  useEffect(() => {
    if (cameras.length > 0) {
      console.log(
        "🧹 Landing page: Cleaning up camera state from previous session",
      );
      if (releaseStreamsRef.current) {
        releaseStreamsRef.current();
      }
      setCameras([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (releaseStreamsRef.current) {
        console.log("🧹 Landing page: Cleaning up camera streams on unmount");
        releaseStreamsRef.current();
      }
    };
  }, []);

  const openRecordingModal = () => {
    setCameras(selectedRecord ? [...(selectedRecord.cameras ?? [])] : []);
    setShowRecordingModal(true);
  };

  const handleRecordingModalClose = (open: boolean) => {
    setShowRecordingModal(open);
    if (!open && releaseStreamsRef.current) {
      console.log("🧹 Modal closed: Releasing camera streams");
      releaseStreamsRef.current();
    }
  };

  const handleTrainingClick = () => navigate("/training");

  const openHubViewer = (repoId: string, isPrivate: boolean) => {
    const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(`/${repoId}`)}`;
    const target = isPrivate
      ? `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`
      : `https://huggingface.co${spacePath}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const handlePickExisting = (item: DatasetItem) => {
    if (item.source === "local" || item.source === "both") {
      navigate("/upload", {
        state: {
          datasetInfo: {
            dataset_repo_id: item.repo_id,
            source: item.source,
          },
        },
      });
      return;
    }
    openHubViewer(item.repo_id, item.private);
  };

  const handleOpenCustom = (repoId: string) => {
    // Custom-typed repo IDs are always treated as Hub paths. We don't know
    // privacy, so route through the login redirect to be safe.
    openHubViewer(repoId, true);
  };

  const handleCreateDataset = (name: string) => {
    setDatasetName(name);
    openRecordingModal();
  };

  const handleStartRecording = async () => {
    if (!selectedRecord) {
      toast({
        title: "No robot selected",
        description: "Select or create a robot on the Landing page first.",
        variant: "destructive",
      });
      return;
    }
    const robot = selectedRecord;
    if (!robot.is_clean) {
      toast({
        title: "Robot not ready",
        description: `${robot.name} is missing a calibration. Configure it before recording.`,
        variant: "destructive",
      });
      return;
    }
    if (!datasetName || !singleTask) {
      toast({
        title: "Missing dataset details",
        description: "Please enter a dataset name and task description.",
        variant: "destructive",
      });
      return;
    }

    const datasetRepoId =
      auth.status === "authenticated"
        ? `${auth.username}/${datasetName}`
        : datasetName;

    if (cameras.length > 0 && releaseStreamsRef.current) {
      console.log("🔓 Releasing camera streams before starting recording...");
      toast({
        title: "Preparing Camera Resources",
        description: `Releasing ${cameras.length} camera stream(s) for recording...`,
      });
      releaseStreamsRef.current();
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("✅ Camera streams released, proceeding with recording...");
      toast({
        title: "Camera Resources Ready",
        description:
          "Camera streams released successfully. Starting recording...",
      });
    }

    const cameraDict = cameras.reduce(
      (acc, cam) => {
        acc[cam.name] = {
          type: cam.type,
          camera_index: cam.camera_index,
          width: cam.width,
          height: cam.height,
          fps: cam.fps,
          ...(cam.fourcc ? { fourcc: cam.fourcc } : {}),
          ...(cam.backend ? { backend: cam.backend } : {}),
        };
        return acc;
      },
      {} as Record<
        string,
        {
          type: string;
          camera_index?: number;
          width: number;
          height: number;
          fps?: number;
          fourcc?: string;
          backend?: string;
        }
      >,
    );

    const recordingConfig = {
      leader_port: robot.leader_port,
      follower_port: robot.follower_port,
      leader_config: robot.leader_config,
      follower_config: robot.follower_config,
      dataset_repo_id: datasetRepoId,
      single_task: singleTask,
      num_episodes: numEpisodes,
      episode_time_s: episodeTimeS,
      reset_time_s: resetTimeS,
      fps: 30,
      video: true,
      push_to_hub: false,
      resume: false,
      streaming_encoding: streamingEncoding,
      cameras: cameraDict,
      robot_type: robot.robot_type || "so101",
    };

    setShowRecordingModal(false);
    navigate("/recording", { state: { recordingConfig } });
  };

  return (
    <div
      className="min-h-screen bg-black text-white pb-16"
      style={{ ["--lelab-topbar-h" as string]: "48px" }}
    >
      <LandingTopBar />

      <div
        className="sticky z-20 bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/70 border-b border-gray-800"
        style={{ top: "var(--lelab-topbar-h)" }}
      >
        <div className="mx-auto max-w-7xl px-4 py-4 grid gap-4 grid-cols-1 lg:grid-cols-[1.2fr_2fr]">
          <RobotConfigManager
            selectedName={selectedName}
            selectedRecord={selectedRecord}
            availableNames={availableNames}
            isLoading={isLoadingRobots}
            selectRobot={selectRobot}
            createRobot={createRobot}
            deleteRobot={deleteRobot}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex flex-col gap-2">
              <h3 className="font-semibold text-lg text-left h-10 flex items-center">
                Dataset
              </h3>
              <DatasetPicker
                datasets={datasets}
                loading={datasetsLoading}
                onPickExisting={handlePickExisting}
                onOpenCustom={handleOpenCustom}
                onCreateNew={handleCreateDataset}
              >
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
                >
                  <span className="truncate text-gray-300">
                    {datasetsLoading
                      ? "Loading datasets…"
                      : "Select or create a dataset…"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DatasetPicker>
            </div>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex flex-col gap-2">
              <h3 className="font-semibold text-lg text-left h-10 flex items-center">
                Create a model
              </h3>
              <Button
                onClick={handleTrainingClick}
                className="w-full bg-green-500 hover:bg-green-600 text-white"
              >
                Training
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <JobsSection />
      </main>

      <Footer />

      <UsageInstructionsModal
        open={showUsageModal}
        onOpenChange={setShowUsageModal}
        dismissible={!ON_SPACE}
      />

      <RecordingModal
        open={showRecordingModal}
        onOpenChange={handleRecordingModalClose}
        robot={selectedRecord}
        datasetName={datasetName}
        setDatasetName={setDatasetName}
        singleTask={singleTask}
        setSingleTask={setSingleTask}
        numEpisodes={numEpisodes}
        setNumEpisodes={setNumEpisodes}
        episodeTimeS={episodeTimeS}
        setEpisodeTimeS={setEpisodeTimeS}
        resetTimeS={resetTimeS}
        setResetTimeS={setResetTimeS}
        streamingEncoding={streamingEncoding}
        setStreamingEncoding={setStreamingEncoding}
        cameras={cameras}
        setCameras={setCameras}
        onStart={handleStartRecording}
        releaseStreamsRef={releaseStreamsRef}
      />
    </div>
  );
};

export default Landing;
