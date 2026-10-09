# Copyright 2026 The HuggingFace Inc. team. All rights reserved.
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
"""Tests for lelab.replay: request schema, mutual exclusion with the other
modes, and the start/stop paths that never move the arm."""

from __future__ import annotations

import pytest


def _replay_request():
    from lelab.replay import ReplayRequest

    return ReplayRequest(
        follower_port="/dev/follower",
        follower_config="follower",
        dataset_repo_id="local/ds",
        episode_index=0,
    )


def test_replay_request_requires_an_episode() -> None:
    from pydantic import ValidationError

    from lelab.replay import ReplayRequest

    with pytest.raises(ValidationError):
        ReplayRequest(follower_port="/dev/follower", follower_config="follower", dataset_repo_id="local/ds")


@pytest.mark.parametrize(
    ("module", "flag"),
    [
        ("record", "recording_active"),
        ("teleoperate", "teleoperation_active"),
        ("rollout", "inference_active"),
    ],
)
def test_replay_refuses_to_start_while_the_arm_is_busy(
    module: str, flag: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import importlib

    import lelab.replay as replay

    monkeypatch.setattr(importlib.import_module(f"lelab.{module}"), flag, True)

    result = replay.handle_start_replay(_replay_request())
    assert result["success"] is False
    assert "Stop it first" in result["message"]
    assert replay.replay_active is False


def test_other_modes_refuse_to_start_during_a_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.replay as replay
    from lelab.record import RecordingRequest, handle_start_recording
    from lelab.rollout import InferenceRequest, handle_start_inference
    from lelab.teleoperate import TeleoperateRequest, handle_start_teleoperation

    monkeypatch.setattr(replay, "replay_active", True)
    ports = {"leader_port": "/dev/leader", "follower_port": "/dev/follower"}
    configs = {"leader_config": "leader", "follower_config": "follower"}

    results = [
        handle_start_teleoperation(TeleoperateRequest(**ports, **configs)),
        handle_start_recording(
            RecordingRequest(**ports, **configs, dataset_repo_id="local/ds", single_task="t")
        ),
        handle_start_inference(
            InferenceRequest(follower_port="/dev/follower", follower_config="follower", policy_ref="p")
        ),
    ]
    for result in results:
        assert result["success"] is False
        assert "Replay" in result["message"]


def test_start_replay_reports_connection_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.replay as replay

    monkeypatch.setattr(replay, "_episode_actions", lambda repo_id, episode: ([{"gripper.pos": 0.0}], 30))
    monkeypatch.setattr(replay, "setup_follower_calibration_file", lambda config: "follower")

    class _Bus:
        def connect(self) -> None:
            raise RuntimeError("serial port unavailable")

    followers = []

    class _Follower:
        def __init__(self, config) -> None:
            self.bus = _Bus()
            self.disconnected = False
            followers.append(self)

        def disconnect(self) -> None:
            self.disconnected = True

    monkeypatch.setattr(replay, "SO101Follower", _Follower)

    result = replay.handle_start_replay(_replay_request())

    assert result["success"] is False
    assert "/dev/follower" in result["message"]
    assert followers[0].disconnected is True
    assert replay.replay_active is False


def test_stop_reports_a_replay_that_still_holds_the_arm(monkeypatch: pytest.MonkeyPatch) -> None:
    import threading

    import lelab.replay as replay

    class _StuckWorker:
        def join(self, timeout: float) -> None:
            pass

        def is_alive(self) -> bool:
            return True

    monkeypatch.setattr(replay, "replay_active", True)
    monkeypatch.setattr(replay, "replay_thread", _StuckWorker())
    monkeypatch.setattr(replay, "_stop", threading.Event())

    assert replay.handle_stop_replay()["success"] is False


def test_stop_replay_when_idle() -> None:
    from lelab.replay import handle_stop_replay

    assert handle_stop_replay()["success"] is False
