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

"""Replay a recorded episode on the follower arm: an in-process take on
lerobot-replay, so the dataset browser can stop it."""

import logging
import threading
import time
from typing import Any

from pydantic import BaseModel

from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
from lerobot.utils.robot_utils import precise_sleep

from . import episode_media
from .utils.config import setup_follower_calibration_file
from .utils.devices import follower_lock, safe_disconnect_device

logger = logging.getLogger(__name__)

# Only the worker (or a failed start) clears this, so the follower stays
# claimed until it is actually released.
replay_active = False
replay_thread: threading.Thread | None = None
replay_error: str | None = None
_stop = threading.Event()

# The arm is wherever it was left when a replay starts; the episode's first
# action is wherever the leader was when the recording started. The gap is
# closed at RAMP_SPEED (degrees per second for the joints, points of the 0-100
# gripper range for the gripper), within these bounds, before playback.
RAMP_SPEED = 60.0
MIN_RAMP_S = 0.5
MAX_RAMP_S = 3.0


class ReplayRequest(BaseModel):
    follower_port: str
    follower_config: str
    dataset_repo_id: str
    episode_index: int


def _episode_actions(repo_id: str, episode_index: int) -> tuple[list[dict[str, float]], int]:
    """The episode's recorded actions as follower commands, and the dataset fps."""
    dataset_dir = episode_media.resolve_dataset_dir(repo_id)
    info = episode_media.read_info(dataset_dir)
    names = info["features"]["action"]["names"]
    rows = episode_media.load_episode_actions(dataset_dir, episode_index)
    return [dict(zip(names, row, strict=True)) for row in rows], info["fps"]


def ramp_steps(present: dict[str, float], first: dict[str, float], fps: int) -> list[dict[str, float]]:
    """The actions that take the arm from `present` to `first` before an episode plays.

    `present` is keyed by motor (as `bus.sync_read` returns it), `first` by action
    name (`<motor>.pos`). A linear move at RAMP_SPEED, MIN_RAMP_S..MAX_RAMP_S long,
    sampled at the replay rate; the last step is `first` itself.
    """
    start = {name: present.get(name.removesuffix(".pos"), value) for name, value in first.items()}
    farthest = max((abs(first[name] - start[name]) for name in first), default=0.0)
    ramp_s = min(max(farthest / RAMP_SPEED, MIN_RAMP_S), MAX_RAMP_S)
    steps = max(1, round(ramp_s * fps))
    return [
        {name: start[name] + (first[name] - start[name]) * (i / steps) for name in first}
        for i in range(1, steps + 1)
    ]


def _move_to_first_action(robot, first: dict[str, float], fps: int) -> bool:
    """Bring the arm to the episode's start pose at a safe speed. Sending the first
    recorded action straight away makes the motors jump there at full speed from
    wherever the arm was left, which with a gripper full of object or an arm at
    rest on the table is a hit, not a move. Returns False when stopped midway."""
    present = robot.bus.sync_read("Present_Position")
    for action in ramp_steps(present, first, fps):
        if _stop.is_set():
            return False
        start = time.perf_counter()
        robot.send_action(action)
        precise_sleep(1 / fps - (time.perf_counter() - start))
    return True


def handle_start_replay(request: ReplayRequest) -> dict[str, Any]:
    """Connect the follower synchronously, so a failure reaches the caller,
    then send the episode's actions at the recording's rate in the background."""
    global replay_active, replay_thread, replay_error

    from . import record as _record, rollout as _rollout, teleoperate as _teleoperate

    with follower_lock:
        if replay_active:
            return {"success": False, "message": "A replay is already running"}
        if _record.recording_active:
            return {"success": False, "message": "Recording is currently active. Stop it first."}
        if _teleoperate.teleoperation_active:
            return {"success": False, "message": "Teleoperation is currently active. Stop it first."}
        if _rollout.inference_active:
            return {"success": False, "message": "Inference is currently active. Stop it first."}
        replay_active = True
        replay_error = None
        _stop.clear()

    robot = None
    try:
        actions, fps = _episode_actions(request.dataset_repo_id, request.episode_index)

        follower_id = setup_follower_calibration_file(request.follower_config)
        robot = SO101Follower(SO101FollowerConfig(port=request.follower_port, id=follower_id))
        try:
            robot.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the follower arm on {request.follower_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e
        # Feetech motors only store calibration registers with the torque off.
        robot.bus.disable_torque()
        robot.bus.write_calibration(robot.calibration)
        robot.configure()
        # Before the caller is told the replay runs, so the footage it starts
        # alongside stays in step with the arm.
        if actions and not _move_to_first_action(robot, actions[0], fps):
            safe_disconnect_device(robot, logger)
            replay_active = False
            return {"success": False, "message": "Replay stopped before the episode started"}
    except Exception as e:
        safe_disconnect_device(robot, logger)
        replay_active = False
        logger.error(f"Failed to start replay: {e}")
        return {"success": False, "message": str(e)}

    def replay_worker():
        global replay_active, replay_error

        try:
            for action in actions:
                if _stop.is_set():
                    break
                start = time.perf_counter()
                robot.send_action(action)
                precise_sleep(1 / fps - (time.perf_counter() - start))
        except Exception as e:
            logger.error(f"Replay failed: {e}")
            replay_error = str(e)
        finally:
            safe_disconnect_device(robot, logger)
            replay_active = False
            logger.info("Replay ended")

    replay_thread = threading.Thread(target=replay_worker, name="replay-worker", daemon=True)
    replay_thread.start()

    return {"success": True, "message": "Replay started"}


def handle_stop_replay() -> dict[str, Any]:
    """Signal the worker and wait for it to release the arm."""
    if not replay_active:
        return {"success": False, "message": "No replay is running"}

    _stop.set()
    worker = replay_thread
    if worker is not None:
        worker.join(timeout=5.0)
        if worker.is_alive():
            logger.warning("Replay worker did not exit within 5s")
            return {"success": False, "message": "The replay has not released the arm yet"}

    return {"success": True, "message": "Replay stopped"}


def handle_replay_status() -> dict[str, Any]:
    return {"replay_active": replay_active, "error": replay_error}
