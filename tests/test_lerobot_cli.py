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
"""The argv LeLab builds, run through the installed LeRobot's own CLI parsers.

The argv-shape tests elsewhere cannot see a flag LeRobot renamed or dropped:
they all passed while every training run died on `--wandb.enable`.
"""

# No `from __future__ import annotations`: parser.wrap reads the config class off the annotation.
import re
import sys
from pathlib import Path

import pytest

import lerobot.scripts.lerobot_train  # noqa: F401  registers the policy configs, as the CLI does
from lerobot.configs import parser
from lerobot.configs.policies import PreTrainedConfig
from lerobot.configs.train import TrainPipelineConfig

_ESSENTIALS_CARD = Path(__file__).parent.parent / "frontend/src/components/training/config/EssentialsCard.tsx"


@parser.wrap()
def _parse_training(cfg: TrainPipelineConfig) -> TrainPipelineConfig:
    return cfg


def test_every_policy_the_ui_offers_is_a_lerobot_policy_type() -> None:
    offered = set(re.findall(r'<SelectItem value="(\w+)">', _ESSENTIALS_CARD.read_text()))
    assert offered, "policy list not found in EssentialsCard.tsx"
    assert offered - set(PreTrainedConfig.get_known_choices()) == set()


@pytest.mark.parametrize(
    ("policy_type", "runner"), [("act", "local"), ("act", "hf_cloud"), ("groot", "local")]
)
def test_training_argv_parses(monkeypatch, policy_type, runner) -> None:
    from lelab.jobs import JobTarget
    from lelab.train import TrainingRequest, build_training_command

    request = TrainingRequest(
        dataset_repo_id="me/dataset",
        policy_type=policy_type,
        policy_device="cpu",
        policy_use_amp=True,
        trackio_enable=True,
        trackio_project="lelab",
        trackio_space_id="me/lelab-trackio",
        optimizer_lr=1e-4,
        **(
            {"policy_embodiment_tag": "new_embodiment", "policy_relative_exclude_joints": ["gripper"]}
            if policy_type == "groot"
            else {}
        ),
    )
    target = JobTarget(runner=runner, flavor="a10g-small") if runner == "hf_cloud" else None
    cmd = build_training_command(request, "/tmp/out", job_target=target)
    monkeypatch.setattr(sys, "argv", ["lerobot-train", *cmd[3:]])

    cfg = _parse_training()

    assert cfg.policy.type == policy_type
    assert cfg.trackio.space_id == "me/lelab-trackio"


def test_rollout_argv_parses(monkeypatch, tmp_path) -> None:
    import lerobot.scripts.lerobot_rollout as lerobot_rollout
    from lelab import rollout
    from lelab.rollout import InferenceRequest
    from lerobot.configs.types import FeatureType, PolicyFeature
    from lerobot.policies.act.configuration_act import ACTConfig

    checkpoint = tmp_path / "checkpoints" / "000050" / "pretrained_model"
    checkpoint.mkdir(parents=True)
    ACTConfig(
        input_features={
            "observation.state": PolicyFeature(type=FeatureType.STATE, shape=(6,)),
            "observation.images.front": PolicyFeature(type=FeatureType.VISUAL, shape=(3, 480, 640)),
        },
        output_features={"action": PolicyFeature(type=FeatureType.ACTION, shape=(6,))},
    )._save_pretrained(checkpoint)

    commands: list[list[str]] = []

    def capture(cmd, **kwargs):
        commands.append(cmd)
        raise OSError("stop before spawning")

    monkeypatch.setattr(rollout, "inference_active", False)
    monkeypatch.setattr(rollout, "setup_follower_calibration_file", lambda name: "robot_a")
    monkeypatch.setattr(rollout.subprocess, "Popen", capture)
    rollout.handle_start_inference(
        InferenceRequest(
            follower_port="/dev/ttyUSB0",
            follower_config="robot_a",
            policy_ref=str(checkpoint),
            task="step 1: grab the cube",
            cameras={"front": {"type": "opencv", "camera_index": 0, "width": 640, "height": 480, "fps": 30}},
        )
    )

    parsed = []

    class _StopBeforeHardwareError(Exception):
        pass

    def stop_before_hardware(cfg, _shutdown_event):
        parsed.append(cfg)
        raise _StopBeforeHardwareError

    monkeypatch.setattr(lerobot_rollout, "build_rollout_context", stop_before_hardware)
    monkeypatch.setattr(sys, "argv", ["lerobot-rollout", *commands[0][3:]])
    with pytest.raises(_StopBeforeHardwareError):
        lerobot_rollout.main()

    (cfg,) = parsed
    assert cfg.robot.port == "/dev/ttyUSB0"
    assert cfg.robot.id == "robot_a"
    assert cfg.task == "step 1: grab the cube"
    assert set(cfg.robot.cameras) == {"front"}
