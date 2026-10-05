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

"""Camera rotation contracts across request validation, recording, and rollout."""

from copy import deepcopy
from unittest.mock import Mock

import draccus
import numpy as np
import pytest
import yaml

from lelab.camera_config import lerobot_camera_settings
from lelab.record import RecordingRequest, _build_camera_configs
from lelab.rollout import InferenceRequest, _format_cameras_arg
from lerobot.cameras.configs import CameraConfig, Cv2Backends, Cv2Rotation
from lerobot.cameras.opencv import OpenCVCamera


@pytest.mark.parametrize(
    ("rotation", "enum", "turns"),
    [
        (0, Cv2Rotation.NO_ROTATION, 0),
        (90, Cv2Rotation.ROTATE_90, -1),
        (180, Cv2Rotation.ROTATE_180, 2),
        (270, Cv2Rotation.ROTATE_270, 1),
    ],
)
def test_recording_and_rollout_produce_same_oriented_frame(rotation, enum, turns) -> None:
    """Exercise actual LeRobot configuration decoding and image processing."""
    cameras = {
        "wrist": {"type": "opencv", "camera_index": 1, "width": 3, "height": 2, "rotation": rotation},
        "front": {"type": "opencv", "camera_index": 0, "width": 3, "height": 2},
    }
    original = deepcopy(cameras)
    recording_request = RecordingRequest(
        leader_port="test-leader",
        follower_port="test-follower",
        leader_config="leader",
        follower_config="follower",
        dataset_repo_id="user/dataset",
        single_task="test rotation",
        cameras=cameras,
    )
    inference_request = InferenceRequest(
        follower_port="test-follower",
        follower_config="follower",
        policy_ref="user/policy@root",
        cameras=cameras,
    )
    assert recording_request.cameras == original
    assert inference_request.cameras == original
    recording = _build_camera_configs(cameras, Cv2Backends.ANY)
    cli_config = yaml.safe_load(_format_cameras_arg(cameras))
    rollout = {name: draccus.decode(CameraConfig, config) for name, config in cli_config.items()}

    # Distinct rows and columns expose rotation direction and shape errors.
    native_frame = np.arange(18, dtype=np.uint8).reshape(2, 3, 3)
    expected = np.rot90(native_frame[:, :, ::-1], turns)
    for configs in (recording, rollout):
        camera = OpenCVCamera(configs["wrist"])
        assert configs["wrist"].rotation is enum
        assert (camera.capture_width, camera.capture_height) == (3, 2)
        np.testing.assert_array_equal(camera._postprocess_image(native_frame), expected)
        front = OpenCVCamera(configs["front"])
        np.testing.assert_array_equal(front._postprocess_image(native_frame), native_frame[:, :, ::-1])
    assert cameras == original


def test_legacy_camera_payload_uses_no_rotation_and_preserves_cli_omission() -> None:
    camera = {"type": "opencv", "camera_index": 2, "width": 640, "height": 480}
    config = _build_camera_configs({"front": camera}, Cv2Backends.ANY)["front"]
    assert config.rotation is Cv2Rotation.NO_ROTATION
    assert (config.width, config.height) == (640, 480)
    assert "rotation" not in _format_cameras_arg({"front": camera})


def test_quarter_turn_without_dimensions_preserves_automatic_resolution() -> None:
    camera = {"type": "opencv", "camera_index": 2, "rotation": 270}
    config = _build_camera_configs({"front": camera}, Cv2Backends.ANY)["front"]
    assert config.width is None
    assert config.height is None
    assert config.rotation is Cv2Rotation.ROTATE_270
    assert "width" not in _format_cameras_arg({"front": camera})
    assert "height" not in _format_cameras_arg({"front": camera})


def test_unsupported_camera_type_retains_previous_behavior() -> None:
    camera = {"type": "realsense", "camera_index": 1, "width": 640, "height": 480, "rotation": 45}
    assert lerobot_camera_settings(camera) == camera
    assert _build_camera_configs({"depth": camera}, Cv2Backends.ANY) == {}
    assert "rotation: 45" in _format_cameras_arg({"depth": camera})


@pytest.mark.parametrize("rotation", [True, False, "90", 90.0, None, -90, 45, 360])
@pytest.mark.parametrize(
    ("route", "handler_name", "required"),
    [
        (
            "/start-recording",
            "handle_start_recording",
            {
                "leader_port": "test-leader",
                "follower_port": "test-follower",
                "leader_config": "leader",
                "follower_config": "follower",
                "dataset_repo_id": "user/dataset",
                "single_task": "test rotation",
            },
        ),
        (
            "/start-inference",
            "handle_start_inference",
            {
                "follower_port": "test-follower",
                "follower_config": "follower",
                "policy_ref": "user/policy@root",
            },
        ),
    ],
)
def test_api_rejects_invalid_rotation_before_handler(
    client, monkeypatch, rotation, route, handler_name, required
):
    """No calibration, worker thread, or rollout process starts for invalid input."""
    from lelab import record, rollout, server

    handler = Mock()
    monkeypatch.setattr(server, handler_name, handler)
    recording_active = record.recording_active
    inference_active = rollout.inference_active
    response = client.post(
        route,
        json={**required, "cameras": {"wrist": {"type": "opencv", "camera_index": 1, "rotation": rotation}}},
    )
    assert response.status_code == 422
    assert "rotation must be an integer" in response.json()["detail"][0]["msg"]
    handler.assert_not_called()
    assert record.recording_active == recording_active
    assert rollout.inference_active == inference_active
