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


# --- handle_dataset_sync_status: manifest (path+size) diff ------------------

REPO_ID = "user/ds"


def _make_local(cache_root, files: dict[str, int]):
    """Write a fake local dataset tree under <cache_root>/REPO_ID."""
    from pathlib import Path

    local_root = Path(cache_root) / REPO_ID
    for rel, size in files.items():
        p = local_root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * size)
    return local_root


def _fake_api(*, siblings: list[tuple[str, int]] | None = None, missing: bool = False):
    from types import SimpleNamespace

    from huggingface_hub.errors import RepositoryNotFoundError

    def dataset_info(repo_id, files_metadata=False):
        if missing:
            raise RepositoryNotFoundError("not found", response=SimpleNamespace(headers={}, request=None))
        return SimpleNamespace(
            siblings=[SimpleNamespace(rfilename=name, size=size) for name, size in siblings]
        )

    return SimpleNamespace(dataset_info=dataset_info)


def _sync_status(monkeypatch, cache_root, api):
    import lelab.record as rec
    from lelab.record import DatasetInfoRequest, handle_dataset_sync_status

    monkeypatch.setattr(rec, "HF_LEROBOT_HOME", str(cache_root))
    monkeypatch.setattr(rec, "shared_hf_api", lambda: api)
    return handle_dataset_sync_status(DatasetInfoRequest(dataset_repo_id=REPO_ID))


def test_sync_status_not_local_returns_no_sync(tmp_path, monkeypatch) -> None:
    # No local dir at all → nothing to push, never touches the Hub.
    result = _sync_status(monkeypatch, tmp_path, _fake_api(siblings=[]))
    assert result == {"on_hub": False, "needs_sync": False, "local_files": 0, "hub_files": 0}


def test_sync_status_appended_episode_needs_sync(tmp_path, monkeypatch) -> None:
    hub = {"meta/info.json": 10, "data/chunk-000/episode_000.parquet": 100}
    local = {**hub, "data/chunk-000/episode_001.parquet": 120}
    _make_local(tmp_path, local)
    result = _sync_status(monkeypatch, tmp_path, _fake_api(siblings=list(hub.items())))
    assert result["needs_sync"] is True


def test_sync_status_deleted_episode_needs_sync(tmp_path, monkeypatch) -> None:
    # Hub has an episode the local copy no longer holds — the deep-write blind
    # spot of the directory-mtime approach.
    local = {"meta/info.json": 10, "data/chunk-000/episode_000.parquet": 100}
    hub = {**local, "data/chunk-000/episode_001.parquet": 120}
    _make_local(tmp_path, local)
    result = _sync_status(monkeypatch, tmp_path, _fake_api(siblings=list(hub.items())))
    assert result["needs_sync"] is True


def test_sync_status_edited_episode_needs_sync(tmp_path, monkeypatch) -> None:
    # Same path, different size → in-place edit is caught.
    _make_local(tmp_path, {"data/chunk-000/episode_000.parquet": 100})
    siblings = [("data/chunk-000/episode_000.parquet", 140)]
    result = _sync_status(monkeypatch, tmp_path, _fake_api(siblings=siblings))
    assert result["needs_sync"] is True


def test_sync_status_not_on_hub_needs_sync(tmp_path, monkeypatch) -> None:
    _make_local(tmp_path, {"meta/info.json": 10})
    result = _sync_status(monkeypatch, tmp_path, _fake_api(missing=True))
    assert result == {"on_hub": False, "needs_sync": True, "local_files": 1, "hub_files": 0}
