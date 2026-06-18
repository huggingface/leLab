# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Training-specific helpers: the request schema and the LeRobot CLI builder.

The actual job lifecycle (subprocess management, registry, log streaming)
lives in app/jobs.py.
"""

import re

from pydantic import BaseModel, field_validator, model_validator

_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")

OFFLINE_TRAINING_POLICY_TYPES = (
    "act",
    "diffusion",
    "pi0",
    "pi05",
    "pi0_fast",
    "smolvla",
    "vqbet",
)
_OFFLINE_TRAINING_POLICY_TYPE_SET = set(OFFLINE_TRAINING_POLICY_TYPES)
_POLICY_OPTION_SUPPORT = {
    "policy_dtype": {"pi0", "pi05", "pi0_fast"},
    "policy_gradient_checkpointing": {"pi0", "pi05", "pi0_fast"},
    "policy_freeze_vision_encoder": {"pi0", "pi05", "smolvla"},
    "policy_train_expert_only": {"pi0", "pi05", "smolvla"},
}


class TrainingRequest(BaseModel):
    # Dataset configuration
    dataset_repo_id: str
    dataset_revision: str | None = None
    dataset_root: str | None = None
    dataset_episodes: list[int] | None = None

    # Policy configuration
    policy_type: str = "act"

    @field_validator("policy_type")
    @classmethod
    def _validate_policy_type(cls, value: str) -> str:
        if value not in _OFFLINE_TRAINING_POLICY_TYPE_SET:
            supported = ", ".join(OFFLINE_TRAINING_POLICY_TYPES)
            raise ValueError(
                f"policy_type {value!r} is not supported by this offline training flow; "
                f"supported policies: {supported}"
            )
        return value

    # Core training parameters
    steps: int = 10000
    batch_size: int = 8
    seed: int | None = 1000
    num_workers: int = 4

    # Logging and checkpointing
    log_freq: int = 250
    save_freq: int = 1000
    eval_freq: int = 0
    save_checkpoint: bool = True

    # Output configuration
    output_dir: str = "outputs/train"
    resume: bool = False
    job_name: str | None = None

    # Weights & Biases
    wandb_enable: bool = False
    wandb_project: str | None = None
    wandb_entity: str | None = None
    wandb_notes: str | None = None
    wandb_run_id: str | None = None
    wandb_mode: str | None = "online"
    wandb_disable_artifact: bool = False

    # Environment / evaluation
    env_type: str | None = None
    env_task: str | None = None
    eval_n_episodes: int = 10
    eval_batch_size: int = 10
    eval_use_async_envs: bool = False

    # Policy-specific
    policy_device: str | None = "cuda"
    policy_use_amp: bool = False
    policy_dtype: str | None = None
    policy_gradient_checkpointing: bool | None = None
    policy_freeze_vision_encoder: bool | None = None
    policy_train_expert_only: bool | None = None
    # Hub upload (set by HfCloudJobRunner; not exposed in the form)
    policy_push_to_hub: bool = False
    policy_repo_id: str | None = None

    # Optimizer
    optimizer_type: str | None = "adam"
    optimizer_lr: float | None = None
    optimizer_weight_decay: float | None = None
    optimizer_grad_clip_norm: float | None = None

    # Advanced
    use_policy_training_preset: bool = True
    config_path: str | None = None

    @model_validator(mode="after")
    def _validate_policy_specific_options(self) -> "TrainingRequest":
        for field_name, supported_policies in _POLICY_OPTION_SUPPORT.items():
            if getattr(self, field_name) is None:
                continue
            if self.policy_type not in supported_policies:
                supported = ", ".join(sorted(supported_policies))
                raise ValueError(
                    f"policy_type {self.policy_type!r} does not support {field_name}; "
                    f"supported policies: {supported}"
                )
        return self


def build_training_command(
    request: TrainingRequest, output_dir: str, python_executable: str = "python"
) -> list[str]:
    """Build the argv list to invoke `<python_executable> -m lerobot.scripts.lerobot_train`.

    `output_dir` is supplied separately from the request so the caller (the
    JobRegistry) can pin it to the per-job directory rather than relying on
    request.output_dir, which the frontend doesn't even send in the new world.

    `python_executable` defaults to "python" for the cloud runner (whose
    container has lerobot on PATH); the local runner must pass sys.executable
    so the subprocess uses the same interpreter as lelab itself — otherwise
    PATH lookup picks up a different env (uv tool venv, miniforge3 base, etc.)
    that lacks lerobot.
    """
    cmd: list[str] = [python_executable, "-m", "lerobot.scripts.lerobot_train"]

    # Dataset
    cmd.extend(["--dataset.repo_id", request.dataset_repo_id])
    if request.dataset_revision:
        cmd.extend(["--dataset.revision", request.dataset_revision])
    if request.dataset_root:
        cmd.extend(["--dataset.root", request.dataset_root])
    if request.dataset_episodes:
        cmd.extend(["--dataset.episodes"] + [str(ep) for ep in request.dataset_episodes])

    # Policy
    cmd.extend(["--policy.type", request.policy_type])

    # Core training params
    cmd.extend(["--steps", str(request.steps)])
    cmd.extend(["--batch_size", str(request.batch_size)])
    cmd.extend(["--num_workers", str(request.num_workers)])
    if request.seed is not None:
        cmd.extend(["--seed", str(request.seed)])

    # Policy device / AMP / hub
    if request.policy_device:
        cmd.extend(["--policy.device", request.policy_device])
    cmd.extend(["--policy.use_amp", "true" if request.policy_use_amp else "false"])
    if request.policy_dtype:
        cmd.extend(["--policy.dtype", request.policy_dtype])
    if request.policy_gradient_checkpointing is not None:
        cmd.extend(
            [
                "--policy.gradient_checkpointing",
                "true" if request.policy_gradient_checkpointing else "false",
            ]
        )
    if request.policy_freeze_vision_encoder is not None:
        cmd.extend(
            [
                "--policy.freeze_vision_encoder",
                "true" if request.policy_freeze_vision_encoder else "false",
            ]
        )
    if request.policy_train_expert_only is not None:
        cmd.extend(
            [
                "--policy.train_expert_only",
                "true" if request.policy_train_expert_only else "false",
            ]
        )
    # LeRobot defaults push_to_hub=True and demands --policy.repo_id when so.
    # Local jobs keep it off; HF Cloud jobs flip it on via the runner.
    cmd.extend(["--policy.push_to_hub", "true" if request.policy_push_to_hub else "false"])
    if request.policy_push_to_hub and request.policy_repo_id:
        cmd.extend(["--policy.repo_id", request.policy_repo_id])

    # Logging / checkpointing
    cmd.extend(["--log_freq", str(request.log_freq)])
    cmd.extend(["--save_freq", str(request.save_freq)])
    cmd.extend(["--eval_freq", str(request.eval_freq)])
    cmd.extend(["--save_checkpoint", "true" if request.save_checkpoint else "false"])

    # Output
    cmd.extend(["--output_dir", output_dir])
    cmd.extend(["--resume", "true" if request.resume else "false"])
    if request.job_name:
        cmd.extend(["--job_name", request.job_name])

    # W&B
    cmd.extend(["--wandb.enable", "true" if request.wandb_enable else "false"])
    if request.wandb_enable:
        if request.wandb_project:
            cmd.extend(["--wandb.project", request.wandb_project])
        if request.wandb_entity:
            cmd.extend(["--wandb.entity", request.wandb_entity])
        if request.wandb_notes:
            cmd.extend(["--wandb.notes", request.wandb_notes])
        if request.wandb_run_id:
            cmd.extend(["--wandb.run_id", request.wandb_run_id])
        if request.wandb_mode:
            cmd.extend(["--wandb.mode", request.wandb_mode])
        cmd.extend(["--wandb.disable_artifact", "true" if request.wandb_disable_artifact else "false"])

    # Env
    if request.env_type:
        cmd.extend(["--env.type", request.env_type])
    if request.env_task:
        cmd.extend(["--env.task", request.env_task])

    # Eval
    cmd.extend(["--eval.n_episodes", str(request.eval_n_episodes)])
    cmd.extend(["--eval.batch_size", str(request.eval_batch_size)])
    cmd.extend(["--eval.use_async_envs", "true" if request.eval_use_async_envs else "false"])

    # Optimizer
    if request.optimizer_type:
        cmd.extend(["--optimizer.type", request.optimizer_type])
    if request.optimizer_lr is not None:
        cmd.extend(["--optimizer.lr", str(request.optimizer_lr)])
    if request.optimizer_weight_decay is not None:
        cmd.extend(["--optimizer.weight_decay", str(request.optimizer_weight_decay)])
    if request.optimizer_grad_clip_norm is not None:
        cmd.extend(["--optimizer.grad_clip_norm", str(request.optimizer_grad_clip_norm)])

    # Advanced
    cmd.extend(["--use_policy_training_preset", "true" if request.use_policy_training_preset else "false"])
    if request.config_path:
        cmd.extend(["--config_path", request.config_path])

    return cmd
