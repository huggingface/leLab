
export interface TrainingConfig {
  // Dataset configuration
  dataset_repo_id: string;
  dataset_revision?: string;
  dataset_root?: string;
  dataset_episodes?: number[];

  // Policy configuration
  policy_type: string;

  // Core training parameters
  steps: number;
  batch_size: number;
  seed?: number;
  num_workers: number;

  // Logging and checkpointing
  log_freq: number;
  save_freq: number;
  eval_freq: number;
  save_checkpoint: boolean;

  // Output configuration
  output_dir: string;
  resume: boolean;
  job_name?: string;

  // Weights & Biases
  wandb_enable: boolean;
  wandb_project?: string;
  wandb_entity?: string;
  wandb_notes?: string;
  wandb_run_id?: string;
  wandb_mode?: string;
  wandb_disable_artifact: boolean;

  // Environment and evaluation
  env_type?: string;
  env_task?: string;
  eval_n_episodes: number;
  eval_batch_size: number;
  eval_use_async_envs: boolean;

  // Policy-specific parameters
  policy_device?: string;
  policy_use_amp: boolean;

  // Optimizer parameters
  optimizer_type?: string;
  optimizer_lr?: number;
  optimizer_weight_decay?: number;
  optimizer_grad_clip_norm?: number;

  // Advanced configuration
  use_policy_training_preset: boolean;
  config_path?: string;
}

export interface TrainingStatus {
  training_active: boolean;
  current_step: number;
  total_steps: number;
  current_loss?: number;
  current_lr?: number;
  grad_norm?: number;
  epoch_time?: number;
  eta_seconds?: number;
  available_controls: {
    stop_training: boolean;
    pause_training: boolean;
    resume_training: boolean;
  };
}

export interface LogEntry {
  timestamp: number;
  message: string;
}

export interface ConfigComponentProps {
  config: TrainingConfig;
  updateConfig: <T extends keyof TrainingConfig>(
    key: T,
    value: TrainingConfig[T]
  ) => void;
}
