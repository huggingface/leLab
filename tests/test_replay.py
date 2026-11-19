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


def test_ramp_moves_from_the_present_pose_to_the_first_action_at_a_bounded_speed() -> None:
    from lelab.replay import MIN_RAMP_S, RAMP_SPEED, ramp_steps

    present = {"shoulder_pan": -10.0, "elbow_flex": 20.0, "gripper": 0.0}
    first = {"shoulder_pan.pos": 50.0, "elbow_flex.pos": 20.0, "gripper.pos": 30.0}

    steps = ramp_steps(present, first, fps=30)

    # 60 degrees at RAMP_SPEED deg/s, sampled at 30 fps.
    assert len(steps) == round(max(60.0 / RAMP_SPEED, MIN_RAMP_S) * 30)
    assert steps[-1] == first
    pans = [s["shoulder_pan.pos"] for s in steps]
    assert pans == sorted(pans) and pans[0] > -10.0
    assert all(s["elbow_flex.pos"] == 20.0 for s in steps)
    # One step moves at most RAMP_SPEED / fps.
    assert max(b - a for a, b in zip([-10.0, *pans[:-1]], pans, strict=True)) <= RAMP_SPEED / 30 + 1e-9


def test_ramp_is_clamped_between_half_a_second_and_three_seconds() -> None:
    from lelab.replay import MAX_RAMP_S, MIN_RAMP_S, ramp_steps

    assert len(ramp_steps({"gripper": 0.0}, {"gripper.pos": 1.0}, fps=30)) == round(MIN_RAMP_S * 30)
    assert len(ramp_steps({"gripper": 0.0}, {"gripper.pos": 1000.0}, fps=30)) == round(MAX_RAMP_S * 30)


def _fake_follower(monkeypatch: pytest.MonkeyPatch, present: dict[str, float]):
    import lelab.replay as replay

    class _Bus:
        def connect(self) -> None:
            pass

        def disable_torque(self) -> None:
            pass

        def write_calibration(self, calibration) -> None:
            pass

        def sync_read(self, register: str) -> dict[str, float]:
            assert register == "Present_Position"
            return dict(present)

    class _Follower:
        instances: list = []

        def __init__(self, config) -> None:
            self.bus = _Bus()
            self.calibration = {}
            self.sent: list[dict[str, float]] = []
            self.disconnected = False
            _Follower.instances.append(self)

        def configure(self) -> None:
            pass

        def send_action(self, action: dict[str, float]) -> dict[str, float]:
            self.sent.append(dict(action))
            return action

        def disconnect(self) -> None:
            self.disconnected = True

    monkeypatch.setattr(replay, "SO101Follower", _Follower)
    monkeypatch.setattr(replay, "setup_follower_calibration_file", lambda config: "follower")
    monkeypatch.setattr(replay, "precise_sleep", lambda seconds: None)
    return _Follower


def test_start_replay_ramps_to_the_first_action_before_playing(monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.replay as replay

    episode = [{"shoulder_pan.pos": 30.0}, {"shoulder_pan.pos": 31.0}, {"shoulder_pan.pos": 32.0}]
    monkeypatch.setattr(replay, "_episode_actions", lambda repo_id, episode_index: (episode, 30))
    follower = _fake_follower(monkeypatch, {"shoulder_pan": 0.0})

    result = replay.handle_start_replay(_replay_request())
    assert result["success"] is True
    replay.replay_thread.join(timeout=5.0)

    sent = follower.instances[-1].sent
    ramp, played = sent[: -len(episode)], sent[-len(episode) :]
    assert played == episode
    assert len(ramp) == round(replay.MIN_RAMP_S * 30)
    assert ramp[-1] == episode[0]
    assert all(0.0 < s["shoulder_pan.pos"] <= 30.0 for s in ramp)
    assert follower.instances[-1].disconnected is True
    assert replay.replay_active is False


def test_stop_during_the_ramp_releases_the_arm_without_playing(monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.replay as replay

    episode = [{"shoulder_pan.pos": 30.0}, {"shoulder_pan.pos": 31.0}]
    monkeypatch.setattr(replay, "_episode_actions", lambda repo_id, episode_index: (episode, 30))
    follower = _fake_follower(monkeypatch, {"shoulder_pan": 0.0})
    original = replay.ramp_steps

    def stop_after_first_step(present, first, fps):
        steps = original(present, first, fps)
        replay._stop.set()
        return steps

    monkeypatch.setattr(replay, "ramp_steps", stop_after_first_step)

    result = replay.handle_start_replay(_replay_request())

    assert result["success"] is False
    assert "stopped" in result["message"]
    assert follower.instances[-1].sent == []
    assert follower.instances[-1].disconnected is True
    assert replay.replay_active is False
