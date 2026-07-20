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
"""Tests for lelab.rollout — request schema, pure helpers, and the
non-subprocess branches of the start/stop/status handlers.

handle_start_inference's happy path spawns a real subprocess and a stdout-
pumping thread; covering it would require mocking subprocess.Popen, threading,
and setup_follower_calibration_file. We test only the early-return mutex
branches here — the parts that matter for safety."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_rollout_globals(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset rollout's module-level state around each test so a leaking
    `inference_active=True` from one case can't poison the next."""
    from lelab import rollout

    monkeypatch.setattr(rollout, "inference_active", False)
    monkeypatch.setattr(rollout, "_inference_proc", None)
    monkeypatch.setattr(rollout, "_inference_started_at", None)
    monkeypatch.setattr(rollout, "_inference_rollout_started_at", None)
    monkeypatch.setattr(rollout, "_inference_meta", {})


def test_inference_request_rejects_missing_required_fields() -> None:
    from pydantic import ValidationError

    from lelab.rollout import InferenceRequest

    with pytest.raises(ValidationError):
        InferenceRequest()


def test_inference_request_has_expected_defaults() -> None:
    from lelab.rollout import InferenceRequest

    req = InferenceRequest(
        follower_port="/dev/ttyUSB0",
        follower_config="robot_a",
        policy_ref="user/repo@checkpoints/000050",
    )
    assert req.task == ""
    assert req.cameras == {}
    assert req.duration_s == 60


def test_detect_device_returns_cpu_when_neither_cuda_nor_mps(monkeypatch: pytest.MonkeyPatch) -> None:
    import torch

    from lelab.rollout import _detect_device

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    assert _detect_device() == "cpu"


def test_detect_device_prefers_cuda_over_mps(monkeypatch: pytest.MonkeyPatch) -> None:
    import torch

    from lelab.rollout import _detect_device

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    assert _detect_device() == "cuda"


def test_detect_device_falls_back_to_mps_when_no_cuda(monkeypatch: pytest.MonkeyPatch) -> None:
    import torch

    from lelab.rollout import _detect_device

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    assert _detect_device() == "mps"


def test_detect_device_returns_cpu_when_torch_probe_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """The function wraps both probes in a broad try/except — if torch is
    broken at runtime we still need a sensible fallback."""
    import torch

    from lelab.rollout import _detect_device

    def _boom() -> bool:
        raise RuntimeError("simulated torch.cuda failure")

    monkeypatch.setattr(torch.cuda, "is_available", _boom)
    assert _detect_device() == "cpu"


def test_resolve_policy_path_returns_local_dir_unchanged(tmp_path) -> None:
    from lelab.rollout import _resolve_policy_path

    pretrained = tmp_path / "pretrained_model"
    pretrained.mkdir()
    assert _resolve_policy_path(str(pretrained)) == str(pretrained)


def test_resolve_policy_path_raises_on_unparsable_ref() -> None:
    from lelab.rollout import _resolve_policy_path

    with pytest.raises(ValueError, match="Unrecognised policy ref"):
        _resolve_policy_path("not-a-real-ref-no-at-sign")


def test_resolve_policy_path_resolves_hub_ref(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """Hub refs ('user/repo@checkpoints/000050') must be passed through
    snapshot_download and joined to the standard checkpoints/<step>/pretrained_model
    layout."""
    from lelab.rollout import _resolve_policy_path

    fake_root = tmp_path / "snapshot"
    fake_root.mkdir()
    seen_kwargs: dict = {}

    def fake_snapshot_download(**kwargs):
        seen_kwargs.update(kwargs)
        return str(fake_root)

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)

    result = _resolve_policy_path("user/my-repo@checkpoints/000050")

    assert seen_kwargs["repo_id"] == "user/my-repo"
    assert seen_kwargs["repo_type"] == "model"
    assert seen_kwargs["allow_patterns"] == ["checkpoints/000050/pretrained_model/*"]
    assert result == str(fake_root / "checkpoints" / "000050" / "pretrained_model")


def test_resolve_policy_path_resolves_hub_root_ref(monkeypatch, tmp_path) -> None:
    """A flat-model ref ('user/repo@root') downloads the whole repo and
    returns its root."""
    from lelab.rollout import _resolve_policy_path

    fake_root = tmp_path / "snapshot"
    fake_root.mkdir()
    seen = {}

    def fake_snapshot_download(**kwargs):
        seen.update(kwargs)
        return str(fake_root)

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)
    result = _resolve_policy_path("user/repo@root")
    assert seen["repo_id"] == "user/repo"
    assert "allow_patterns" not in seen
    assert result == str(fake_root)


def test_format_cameras_arg_empty_yields_empty_braces() -> None:
    from lelab.rollout import _format_cameras_arg

    assert _format_cameras_arg({}) == "{}"


def test_format_cameras_arg_renames_camera_index_to_index_or_path() -> None:
    """lerobot's CLI expects `index_or_path`, but the frontend posts
    `camera_index`. The rename is the whole point of this helper."""
    from lelab.rollout import _format_cameras_arg

    result = _format_cameras_arg(
        {"front": {"type": "opencv", "camera_index": 0, "width": 640, "height": 480, "fps": 30}}
    )
    assert "index_or_path: 0" in result
    assert "camera_index" not in result
    assert result.startswith("{front: {")
    assert result.endswith("}}")


def test_format_cameras_arg_omits_none_values() -> None:
    from lelab.rollout import _format_cameras_arg

    result = _format_cameras_arg({"front": {"camera_index": 0, "fps": None}})
    assert "fps" not in result
    assert "index_or_path: 0" in result


def test_format_cameras_arg_handles_multiple_cameras() -> None:
    from lelab.rollout import _format_cameras_arg

    result = _format_cameras_arg(
        {
            "front": {"camera_index": 0, "fps": 30},
            "wrist": {"camera_index": 1, "fps": 30},
        }
    )
    assert "front: {" in result
    assert "wrist: {" in result


def test_handle_stop_inference_when_idle_returns_409() -> None:
    from lelab.rollout import handle_stop_inference

    result = handle_stop_inference()
    assert result["success"] is False
    assert result["status_code"] == 409


def test_handle_inference_status_when_idle_returns_dict_with_expected_keys() -> None:
    from lelab.rollout import handle_inference_status

    result = handle_inference_status()
    assert isinstance(result, dict)
    assert result["inference_active"] is False
    for key in ("started_at", "rollout_started_at", "elapsed_s", "rollout_elapsed_s"):
        assert key in result


def _stub_request():
    from lelab.rollout import InferenceRequest

    return InferenceRequest(
        follower_port="/dev/ttyUSB0",
        follower_config="robot_a",
        policy_ref="user/repo@checkpoints/000050",
    )


def test_handle_start_inference_blocked_when_teleoperation_active(monkeypatch) -> None:
    """If teleop owns the bus, inference must refuse rather than race for
    the serial port."""
    from lelab.rollout import handle_start_inference

    monkeypatch.setattr("lelab.teleoperate.teleoperation_active", True)
    result = handle_start_inference(_stub_request())
    assert result["success"] is False
    assert result["status_code"] == 409
    assert "Teleoperation" in result["message"]


def test_handle_start_inference_blocked_when_recording_active(monkeypatch) -> None:
    from lelab.rollout import handle_start_inference

    monkeypatch.setattr("lelab.record.recording_active", True)
    result = handle_start_inference(_stub_request())
    assert result["success"] is False
    assert result["status_code"] == 409
    assert "Recording" in result["message"]


def test_handle_start_inference_blocked_when_already_active(monkeypatch) -> None:
    from lelab import rollout

    monkeypatch.setattr(rollout, "inference_active", True)
    result = rollout.handle_start_inference(_stub_request())
    assert result["success"] is False
    assert result["status_code"] == 409
    assert "already active" in result["message"]


def test_classify_outcome_ok_warns_and_fails() -> None:
    from lelab.rollout import _classify_outcome

    # rc 0/None => the run was fine.
    assert _classify_outcome(0, True, "overload") == "ok"
    assert _classify_outcome(None, True, None) == "ok"
    # Non-zero AFTER the rollout started, with a torque-disable/overload on
    # shutdown => the skill ran; only cleanup tripped.
    assert _classify_outcome(1, True, "Motor 6 overload, torque_enable failed") == "ran_with_warning"
    # Never started, or an unrelated error => a real failure.
    assert _classify_outcome(1, False, "overload") == "failed"
    assert _classify_outcome(1, True, "could not connect to the arm") == "failed"
    # A connection lost mid-run (cable bumped while the policy is driving)
    # is a real failure, not a shutdown/cleanup warning.
    assert _classify_outcome(1, True, "DeviceNotConnectedError: follower is not connected") == "failed"


def test_friendly_hint_maps_common_failures() -> None:
    from lelab.utils.devices import friendly_hint

    assert "gripper" in (friendly_hint("Motor overload detected") or "").lower()
    assert "connect" in (friendly_hint("Failed to connect to the follower") or "").lower()
    assert friendly_hint("some unrecognised traceback") is None
    assert friendly_hint(None) is None


def test_extract_error_from_log_pulls_exception_tail(tmp_path) -> None:
    from lelab.rollout import _extract_error_from_log

    log = tmp_path / "rollout.log"
    log.write_text(
        "INFO starting rollout\n"
        "Traceback (most recent call last):\n"
        '  File "x.py", line 1\n'
        "RuntimeError: gripper overload during shutdown\n",
        encoding="utf-8",
    )
    out = _extract_error_from_log(str(log))
    assert out is not None and "RuntimeError: gripper overload during shutdown" in out
    assert _extract_error_from_log(None) is None
    assert _extract_error_from_log(str(tmp_path / "missing.log")) is None
