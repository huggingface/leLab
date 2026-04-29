
import React, { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { TrainingConfig, TrainingStatus, LogEntry } from "@/components/training/types";
import TrainingHeader from "@/components/training/TrainingHeader";
import TrainingTabs from "@/components/training/TrainingTabs";
import ConfigurationTab from "@/components/training/ConfigurationTab";
import MonitoringTab from "@/components/training/MonitoringTab";
import TrainingControls from "@/components/training/TrainingControls";

const Training = () => {
  const { toast } = useToast();
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [trainingConfig, setTrainingConfig] = useState<TrainingConfig>({
    dataset_repo_id: "",
    policy_type: "act",
    steps: 10000,
    batch_size: 8,
    seed: 1000,
    num_workers: 4,
    log_freq: 250,
    save_freq: 1000,
    eval_freq: 0,
    save_checkpoint: true,
    output_dir: "outputs/train",
    resume: false,
    wandb_enable: false,
    wandb_mode: "online",
    wandb_disable_artifact: false,
    eval_n_episodes: 10,
    eval_batch_size: 50,
    eval_use_async_envs: false,
    policy_device: "cuda",
    policy_use_amp: false,
    optimizer_type: "adam",
    use_policy_training_preset: true,
  });

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus>({
    training_active: false,
    current_step: 0,
    total_steps: 0,
    available_controls: {
      stop_training: false,
      pause_training: false,
      resume_training: false,
    },
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStartingTraining, setIsStartingTraining] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "monitoring">("config");

  // Poll for training status and logs
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      if (trainingStatus.training_active) {
        try {
          // Get status
          const statusResponse = await fetch("/training-status");
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            setTrainingStatus(status);
          }

          // Get logs
          const logsResponse = await fetch("/training-logs");
          if (logsResponse.ok) {
            const logsData = await logsResponse.json();
            if (logsData.logs && logsData.logs.length > 0) {
              setLogs((prevLogs) => [...prevLogs, ...logsData.logs]);
            }
          }
        } catch (error) {
          console.error("Error polling training status:", error);
        }
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [trainingStatus.training_active]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStartTraining = async () => {
    if (!trainingConfig.dataset_repo_id.trim()) {
      toast({
        title: "Error",
        description: "Dataset repository ID is required",
        variant: "destructive",
      });
      return;
    }

    setIsStartingTraining(true);
    try {
      const response = await fetch("/start-training", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(trainingConfig),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          toast({
            title: "Training Started",
            description: "Training session has been started successfully",
          });
          setActiveTab("monitoring");
          setLogs([]);
        } else {
          toast({
            title: "Error",
            description: result.message || "Failed to start training",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to start training",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error starting training:", error);
      toast({
        title: "Error",
        description: "Failed to start training",
        variant: "destructive",
      });
    } finally {
      setIsStartingTraining(false);
    }
  };

  const handleStopTraining = async () => {
    try {
      const response = await fetch("/stop-training", {
        method: "POST",
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          toast({
            title: "Training Stopped",
            description: "Training session has been stopped",
          });
        } else {
          toast({
            title: "Error",
            description: result.message || "Failed to stop training",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Error stopping training:", error);
      toast({
        title: "Error",
        description: "Failed to stop training",
        variant: "destructive",
      });
    }
  };

  const updateConfig = <T extends keyof TrainingConfig>(
    key: T,
    value: TrainingConfig[T]
  ) => {
    setTrainingConfig((prev) => ({ ...prev, [key]: value }));
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgressPercentage = () => {
    if (trainingStatus.total_steps === 0) return 0;
    return (trainingStatus.current_step / trainingStatus.total_steps) * 100;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        <TrainingHeader trainingStatus={trainingStatus} />
        <TrainingTabs activeTab={activeTab} setActiveTab={setActiveTab} />
        
        {activeTab === "config" && (
          <ConfigurationTab config={trainingConfig} updateConfig={updateConfig} />
        )}

        {activeTab === "monitoring" && (
          <MonitoringTab
            trainingStatus={trainingStatus}
            logs={logs}
            logContainerRef={logContainerRef}
            getProgressPercentage={getProgressPercentage}
            formatTime={formatTime}
          />
        )}
        
        <TrainingControls
          trainingStatus={trainingStatus}
          isStartingTraining={isStartingTraining}
          trainingConfig={trainingConfig}
          handleStartTraining={handleStartTraining}
          handleStopTraining={handleStopTraining}
        />
      </div>
    </div>
  );
};

export default Training;
