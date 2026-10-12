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

"""Reference frames for realigning a stashed rig.

The frontend grabs one frame per camera from its live preview and saves it here,
then overlays it as a ghost on later previews. The backend only stores the PNG
and never opens a camera, so it can't compete with the browser or the recorder
for the device.
"""

from __future__ import annotations

import os

from .utils import config

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_REFERENCE_BYTES = 10 * 1024 * 1024


class InvalidReferenceError(ValueError):
    """The robot/camera name or the image payload is unusable."""


def _reference_path(robot: str, camera: str) -> str:
    # Reuses the robot-name check: neither part may contain path separators or "..".
    if not config.is_valid_robot_name(robot) or not config.is_valid_robot_name(camera):
        raise InvalidReferenceError("Invalid robot or camera name")
    return os.path.join(config.CAMERA_REFERENCES_PATH, robot, f"{camera}.png")


def load_reference(robot: str, camera: str) -> bytes | None:
    path = _reference_path(robot, camera)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def save_reference(robot: str, camera: str, png: bytes) -> None:
    path = _reference_path(robot, camera)
    if not png.startswith(_PNG_SIGNATURE):
        raise InvalidReferenceError("Reference must be a PNG image")
    if len(png) > MAX_REFERENCE_BYTES:
        raise InvalidReferenceError("Reference image is too large")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as f:
        f.write(png)
    os.replace(tmp, path)


def delete_reference(robot: str, camera: str) -> bool:
    path = _reference_path(robot, camera)
    if not os.path.isfile(path):
        return False
    os.remove(path)
    return True
