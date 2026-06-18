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
"""Tests for lelab.record — request schemas and handler entry points."""

from __future__ import annotations

import pytest


def test_recording_request_rejects_missing_required_fields() -> None:
    from pydantic import ValidationError

    from lelab.record import RecordingRequest

    with pytest.raises(ValidationError):
        RecordingRequest()


def test_recording_status_handler_exposes_state_fields() -> None:
    from lelab.record import handle_recording_status

    result = handle_recording_status()
    assert isinstance(result, dict)
    # Pinning the exact keys so a rename in handle_recording_status surfaces here.
    assert "recording_active" in result
    assert "current_phase" in result
    assert "session_ended" in result
    assert "available_controls" in result


def test_handle_stop_recording_when_idle_returns_dict(tmp_lerobot_home) -> None:
    from lelab.record import handle_stop_recording

    result = handle_stop_recording()
    assert isinstance(result, dict)


def test_create_record_config_pins_dshow_on_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    """On Windows, recording must use the DSHOW backend so a camera_index opens
    the same device /available-cameras enumerated (via pygrabber, DSHOW order).
    """
    import lelab.record as record
    from lerobot.cameras.configs import Cv2Backends

    monkeypatch.setattr("platform.system", lambda: "Windows")
    monkeypatch.setattr(record, "setup_calibration_files", lambda leader, follower: ("leader", "follower"))

    request = record.RecordingRequest(
        leader_port="COM_LEADER",
        follower_port="COM_FOLLOWER",
        leader_config="leader",
        follower_config="follower",
        dataset_repo_id="user/dataset",
        single_task="pick up the cube",
        cameras={"wrist": {"type": "opencv", "camera_index": 0, "width": 640, "height": 480, "fps": 30}},
    )

    config = record.create_record_config(request)
    assert config.robot.cameras["wrist"].backend == Cv2Backends.DSHOW


def test_recording_status_disables_advance_while_stopping(monkeypatch) -> None:
    from lelab import record

    monkeypatch.setattr(record, "recording_active", True)
    monkeypatch.setattr(record, "recording_events", {"stop_recording": True, "exit_early": True})
    monkeypatch.setattr(record, "recording_config", None)
    monkeypatch.setattr(record, "current_phase", "stopping")

    result = record.handle_recording_status()

    assert result["recording_active"] is True
    assert result["current_phase"] == "stopping"
    assert result["available_controls"]["stop_recording"] is False
    assert result["available_controls"]["exit_early"] is False
    assert result["available_controls"]["rerecord_episode"] is False


def test_recording_status_exposes_error_message(monkeypatch) -> None:
    from lelab import record

    monkeypatch.setattr(record, "recording_active", False)
    monkeypatch.setattr(record, "recording_config", None)
    monkeypatch.setattr(record, "current_phase", "error")
    monkeypatch.setattr(record, "session_end_elapsed_seconds", 2)
    monkeypatch.setattr(record, "last_recording_info", {"success": False, "error": "camera failed"})

    result = record.handle_recording_status()

    assert result["session_ended"] is True
    assert result["error"] == "camera failed"


def test_recording_connect_uses_existing_calibration_input() -> None:
    from lelab.record import _use_existing_calibration_input

    with _use_existing_calibration_input():
        assert input("Press ENTER to use provided calibration file") == ""


def test_bare_dataset_repo_id_gets_hf_namespace(monkeypatch) -> None:
    from lelab import record

    monkeypatch.setattr(record, "cached_whoami", lambda: {"name": "links7"})

    result = record._normalize_dataset_repo_id("soarm 101", resume=False)

    assert result.startswith("links7/soarm_101_")


def test_bare_dataset_repo_id_uses_local_namespace_without_hf(monkeypatch) -> None:
    from lelab import record

    monkeypatch.setattr(record, "cached_whoami", lambda: None)

    result = record._normalize_dataset_repo_id("soarm_101", resume=False)

    assert result.startswith("local/soarm_101_")


def test_namespaced_dataset_repo_id_keeps_namespace(monkeypatch) -> None:
    from lelab import record

    monkeypatch.setattr(record, "cached_whoami", lambda: {"name": "other"})

    result = record._normalize_dataset_repo_id("links7/soarm 101", resume=False)

    assert result.startswith("links7/soarm_101_")


@pytest.mark.parametrize(
    ("events", "should_rerecord"),
    [
        ({"exit_early": False, "rerecord_episode": False}, False),
        ({"exit_early": False, "_exit_early_triggered": True, "rerecord_episode": False}, False),
        ({"exit_early": True, "rerecord_episode": True}, True),
    ],
)
def test_recording_phase_rerecord_only_when_requested(events, should_rerecord) -> None:
    from lelab.record import _recording_phase_should_rerecord

    assert _recording_phase_should_rerecord(events) is should_rerecord


def test_build_camera_configs_uses_default_backend_when_unset() -> None:
    from lelab.record import _build_camera_configs
    from lerobot.cameras.configs import Cv2Backends

    cameras = {"cam": {"type": "opencv", "camera_index": 0, "width": 640, "height": 480, "fps": 30}}
    configs = _build_camera_configs(cameras, Cv2Backends.AVFOUNDATION)

    assert configs["cam"].backend == Cv2Backends.AVFOUNDATION
    assert configs["cam"].fourcc is None
    assert configs["cam"].index_or_path == 0


def test_build_camera_configs_passes_fourcc_through() -> None:
    from lelab.record import _build_camera_configs
    from lerobot.cameras.configs import Cv2Backends

    cameras = {"cam": {"type": "opencv", "camera_index": 0, "fourcc": "MJPG"}}
    configs = _build_camera_configs(cameras, Cv2Backends.ANY)

    assert configs["cam"].fourcc == "MJPG"


def test_build_camera_configs_explicit_backend_overrides_default() -> None:
    from lelab.record import _build_camera_configs
    from lerobot.cameras.configs import Cv2Backends

    cameras = {"cam": {"type": "opencv", "camera_index": 0, "backend": "V4L2"}}
    configs = _build_camera_configs(cameras, Cv2Backends.AVFOUNDATION)

    assert configs["cam"].backend == Cv2Backends.V4L2


def test_build_camera_configs_invalid_backend_raises() -> None:
    from lelab.record import _build_camera_configs
    from lerobot.cameras.configs import Cv2Backends

    cameras = {"cam": {"type": "opencv", "camera_index": 0, "backend": "NOPE"}}
    with pytest.raises(KeyError):
        _build_camera_configs(cameras, Cv2Backends.ANY)


def test_build_camera_configs_skips_non_opencv_type() -> None:
    from lelab.record import _build_camera_configs
    from lerobot.cameras.configs import Cv2Backends

    cameras = {"cam": {"type": "realsense", "camera_index": 0}}
    configs = _build_camera_configs(cameras, Cv2Backends.ANY)

    assert configs == {}
