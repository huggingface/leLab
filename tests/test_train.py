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
"""Tests for lelab.train — request schema and CLI builder."""

from __future__ import annotations

import pytest


def _arg_value(cmd: list[str], flag: str) -> str:
    """Return the value passed to `--flag`. Fails the test if absent."""
    assert flag in cmd, f"{flag} missing from {cmd}"
    return cmd[cmd.index(flag) + 1]


def test_minimal_request_yields_well_formed_argv() -> None:
    from lelab.train import TrainingRequest, build_training_command

    req = TrainingRequest(dataset_repo_id="lerobot/pusht")
    cmd = build_training_command(req, output_dir="/tmp/out")

    assert cmd[:3] == ["python", "-m", "lerobot.scripts.lerobot_train"]
    assert _arg_value(cmd, "--dataset.repo_id") == "lerobot/pusht"
    assert _arg_value(cmd, "--policy.type") == "act"
    assert _arg_value(cmd, "--steps") == "10000"
    assert _arg_value(cmd, "--output_dir") == "/tmp/out"


def test_optional_dataset_fields_only_present_when_set() -> None:
    from lelab.train import TrainingRequest, build_training_command

    req = TrainingRequest(dataset_repo_id="lerobot/pusht")
    cmd = build_training_command(req, "/tmp/out")
    assert "--dataset.revision" not in cmd
    assert "--dataset.root" not in cmd
    assert "--dataset.episodes" not in cmd

    req2 = TrainingRequest(
        dataset_repo_id="lerobot/pusht",
        dataset_revision="v2",
        dataset_root="/data",
        dataset_episodes=[0, 1, 2],
    )
    cmd2 = build_training_command(req2, "/tmp/out")
    assert _arg_value(cmd2, "--dataset.revision") == "v2"
    assert _arg_value(cmd2, "--dataset.root") == "/data"
    # `--dataset.episodes` is followed by 3 string-encoded ints.
    idx = cmd2.index("--dataset.episodes")
    assert cmd2[idx + 1 : idx + 4] == ["0", "1", "2"]


def test_wandb_block_only_serialized_when_enabled() -> None:
    from lelab.train import TrainingRequest, build_training_command

    off = build_training_command(TrainingRequest(dataset_repo_id="x", wandb_enable=False), "/tmp/out")
    assert _arg_value(off, "--wandb.enable") == "false"
    assert "--wandb.project" not in off

    on = build_training_command(
        TrainingRequest(
            dataset_repo_id="x",
            wandb_enable=True,
            wandb_project="proj",
            wandb_entity="me",
            wandb_run_id="abc",
        ),
        "/tmp/out",
    )
    assert _arg_value(on, "--wandb.enable") == "true"
    assert _arg_value(on, "--wandb.project") == "proj"
    assert _arg_value(on, "--wandb.entity") == "me"
    assert _arg_value(on, "--wandb.run_id") == "abc"


def test_push_to_hub_emits_repo_id_only_when_enabled() -> None:
    from lelab.train import TrainingRequest, build_training_command

    off = build_training_command(
        TrainingRequest(dataset_repo_id="x", policy_push_to_hub=False, policy_repo_id="me/x"),
        "/tmp/out",
    )
    assert _arg_value(off, "--policy.push_to_hub") == "false"
    assert "--policy.repo_id" not in off

    on = build_training_command(
        TrainingRequest(dataset_repo_id="x", policy_push_to_hub=True, policy_repo_id="me/x"),
        "/tmp/out",
    )
    assert _arg_value(on, "--policy.push_to_hub") == "true"
    assert _arg_value(on, "--policy.repo_id") == "me/x"


def test_seed_omitted_when_none() -> None:
    from lelab.train import TrainingRequest, build_training_command

    req = TrainingRequest(dataset_repo_id="x", seed=None)
    cmd = build_training_command(req, "/tmp/out")
    assert "--seed" not in cmd

    req2 = TrainingRequest(dataset_repo_id="x", seed=42)
    cmd2 = build_training_command(req2, "/tmp/out")
    assert _arg_value(cmd2, "--seed") == "42"


def test_training_request_validates_required_field() -> None:
    from pydantic import ValidationError

    from lelab.train import TrainingRequest

    with pytest.raises(ValidationError):
        TrainingRequest()  # dataset_repo_id is required


def test_env_eval_freq_flag() -> None:
    from lelab.train import TrainingRequest, build_training_command

    cmd = build_training_command(TrainingRequest(dataset_repo_id="x", env_eval_freq=5000), "/tmp/out")
    # LeRobot main renamed eval_freq -> env_eval_freq (top-level flag, underscore form).
    assert _arg_value(cmd, "--env_eval_freq") == "5000"
    assert "--eval_freq" not in cmd


def test_cloud_target_emits_job_flags_and_skips_push_to_hub() -> None:
    from lelab.jobs import JobTarget
    from lelab.train import TrainingRequest, build_training_command

    # push_to_hub is requested, but for a cloud target lerobot's submit_to_hf owns the
    # model repo and _pod_forwarded_args drops --policy.* — so we must NOT emit them.
    req = TrainingRequest(dataset_repo_id="x", policy_push_to_hub=True, policy_repo_id="me/x")
    cmd = build_training_command(
        req, "/tmp/out", job_target=JobTarget(runner="hf_cloud", flavor="a10g-small")
    )
    assert _arg_value(cmd, "--job.target") == "a10g-small"
    assert _arg_value(cmd, "--job.tags") == '["lelab"]'
    assert "--policy.push_to_hub" not in cmd
    assert "--policy.repo_id" not in cmd
    # An absolute host output_dir would be baked into the staged config and crash the
    # pod (mkdir /Users ...); checkpoints go to the Hub repo, so it must be omitted.
    assert "--output_dir" not in cmd
    # Pod checkpoints are ephemeral, so they must be pushed to the Hub to be reachable.
    assert _arg_value(cmd, "--save_checkpoint_to_hub") == "true"


def test_cloud_resume_omits_save_checkpoint_to_hub() -> None:
    from lelab.jobs import JobTarget
    from lelab.train import TrainingRequest, build_training_command

    # On a cloud resume, submit_to_hf never sets policy.repo_id before validate(), so
    # --save_checkpoint_to_hub would abort the submit. It must be suppressed.
    req = TrainingRequest(dataset_repo_id="x", save_checkpoint=True, resume=True)
    cmd = build_training_command(
        req, "/tmp/out", job_target=JobTarget(runner="hf_cloud", flavor="a10g-small")
    )
    assert "--save_checkpoint_to_hub" not in cmd
    assert _arg_value(cmd, "--job.target") == "a10g-small"


def test_local_target_keeps_push_to_hub() -> None:
    from lelab.jobs import JobTarget
    from lelab.train import TrainingRequest, build_training_command

    req = TrainingRequest(dataset_repo_id="x", policy_push_to_hub=True, policy_repo_id="me/x")
    cmd = build_training_command(req, "/tmp/out", job_target=JobTarget(runner="local"))
    assert _arg_value(cmd, "--policy.push_to_hub") == "true"
    assert _arg_value(cmd, "--policy.repo_id") == "me/x"
    assert "--job.target" not in cmd
