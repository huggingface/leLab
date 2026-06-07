import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { RobotRecord } from "@/hooks/useRobots";
import { CameraConfig } from "@/components/recording/CameraConfiguration";

/**
 * Owns the recording-modal state and the "start recording" orchestration so it
 * can be shared between the Landing page (create a new dataset) and the
 * EditDataset page (resume / append episodes into an existing dataset).
 *
 * Pass the currently selected robot; cameras are seeded from it each time the
 * modal opens.
 */
export const useRecording = (robot: RobotRecord | null) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { auth } = useHfAuth();

  const [showModal, setShowModal] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [singleTask, setSingleTask] = useState("");
  const [numEpisodes, setNumEpisodes] = useState(5);
  const [episodeTimeS, setEpisodeTimeS] = useState(60);
  const [resetTimeS, setResetTimeS] = useState(15);
  const [streamingEncoding, setStreamingEncoding] = useState(true);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  // When set, the modal appends episodes to this existing dataset (resume)
  // instead of creating a new one. Holds the exact on-disk repo_id.
  const [resumeRepoId, setResumeRepoId] = useState<string | null>(null);

  const releaseStreamsRef = useRef<(() => void) | null>(null);

  const seedCameras = () => {
    setCameras(robot ? [...(robot.cameras ?? [])] : []);
  };

  /** Open the modal to record into a brand-new dataset. */
  const openForNew = (name: string) => {
    setResumeRepoId(null);
    setDatasetName(name);
    seedCameras();
    setShowModal(true);
  };

  const onOpenChange = (open: boolean) => {
    setShowModal(open);
    if (!open && releaseStreamsRef.current) {
      releaseStreamsRef.current();
    }
  };

  const startRecording = async () => {
    if (!robot) {
      toast({
        title: "No robot selected",
        description: "Select or create a robot before recording.",
        variant: "destructive",
      });
      return;
    }
    if (!robot.is_clean) {
      toast({
        title: "Robot not ready",
        description: `${robot.name} is missing a calibration. Configure it before recording.`,
        variant: "destructive",
      });
      return;
    }

    const isResuming = resumeRepoId !== null;

    if ((!isResuming && !datasetName) || !singleTask) {
      toast({
        title: "Missing dataset details",
        description: isResuming
          ? "Please enter a task description."
          : "Please enter a dataset name and task description.",
        variant: "destructive",
      });
      return;
    }

    // When resuming, use the existing dataset's exact repo_id verbatim — the
    // backend skips its timestamp stamp for resume, so the id must already
    // match the on-disk directory (namespace included).
    const datasetRepoId = isResuming
      ? (resumeRepoId as string)
      : auth.status === "authenticated"
        ? `${auth.username}/${datasetName}`
        : datasetName;

    if (cameras.length > 0 && releaseStreamsRef.current) {
      toast({
        title: "Preparing Camera Resources",
        description: `Releasing ${cameras.length} camera stream(s) for recording...`,
      });
      releaseStreamsRef.current();
      await new Promise((resolve) => setTimeout(resolve, 500));
      toast({
        title: "Camera Resources Ready",
        description: "Camera streams released successfully. Starting recording...",
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
      resume: isResuming,
      streaming_encoding: streamingEncoding,
      cameras: cameraDict,
    };

    setShowModal(false);
    navigate("/recording", { state: { recordingConfig } });
  };

  return {
    // modal visibility + lifecycle
    showModal,
    onOpenChange,
    openForNew,
    startRecording,
    releaseStreamsRef,
    // form state (passed straight through to RecordingModal / settings fields)
    resumeRepoId,
    setResumeRepoId,
    datasetName,
    setDatasetName,
    singleTask,
    setSingleTask,
    numEpisodes,
    setNumEpisodes,
    episodeTimeS,
    setEpisodeTimeS,
    resetTimeS,
    setResetTimeS,
    streamingEncoding,
    setStreamingEncoding,
    cameras,
    setCameras,
  };
};
