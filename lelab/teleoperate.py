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

import logging
import math
import threading
import time
from typing import Any

from pydantic import BaseModel

from .utils.config import setup_calibration_files
from .utils.devices import make_device, make_device_config, safe_disconnect_device

logger = logging.getLogger(__name__)

# sts3215 motor resolution; lerobot's _normalize uses (resolution - 1).
_STS3215_MAX_RES = 4095

# SO-101 URDF (so101_new_calib.urdf) is authored with the all-zeros pose at the
# arm's sleep position, not the "middle of range" pose where calibration's
# set_half_turn_homings is performed. To make the URDF track the real arm:
#   URDF_value = sign * (motor_normalized_deg - motor_at_urdf_zero_deg)
# where motor_at_urdf_zero_deg = (urdf_zero_ticks - mid) * 360 / max_res, and
# `urdf_zero_ticks` is the raw Present_Position when the robot is at sleep.
# That tick value is a property of the SO-101 mechanics + URDF design, so it's
# constant across calibrations as long as the user pressed ENTER at the "middle
# of range" pose during set_half_turn_homings.
# Joints not listed here use lerobot's default convention (URDF = motor).
_SO101_URDF_CORRECTIONS = {
    # motor_name: (sign, urdf_zero_present_position_ticks)
    "shoulder_lift": (+1, 3252),
    "elbow_flex": (+1, 1029),
}

# Global variables for teleoperation state
teleoperation_active = False
teleoperation_thread: threading.Thread | None = None
current_robot = None
current_teleop = None
current_robot_type = "so101"
# Guards the start path; the worker owns disconnect so stop() does not race.
_state_lock = threading.Lock()


class TeleoperateRequest(BaseModel):
    leader_port: str
    follower_port: str
    leader_config: str
    follower_config: str
    robot_type: str = "so101"


_SO101_URDF_MAPPING = {
    "shoulder_pan": "Rotation",
    "shoulder_lift": "Pitch",
    "elbow_flex": "Elbow",
    "wrist_flex": "Wrist_Pitch",
    "wrist_roll": "Wrist_Roll",
    "gripper": "Jaw",
}

# OMX motor names match SO-101's convention, but the joint names in
# omx_f.urdf (frontend/public/omx-urdf/) are the arm's own joint1..joint5 +
# gripper_joint_1 (gripper_joint_2 mirrors it via a <mimic> tag).
_OMX_URDF_MAPPING = {
    "shoulder_pan": "joint1",
    "shoulder_lift": "joint2",
    "elbow_flex": "joint3",
    "wrist_flex": "joint4",
    "wrist_roll": "joint5",
    "gripper": "gripper_joint_1",
}


def get_joint_positions_from_robot(robot, robot_type: str = "so101") -> dict[str, float]:
    """
    Extract current joint positions from the robot and convert to URDF joint format.

    Args:
        robot: The robot instance (SO101Follower or OmxFollower)
        robot_type: Selects the URDF joint-name mapping and unit conversion.

    Returns:
        Dictionary mapping URDF joint names to radian values
    """
    is_omx = "omx" in robot_type.lower()
    motor_to_urdf_mapping = _OMX_URDF_MAPPING if is_omx else _SO101_URDF_MAPPING

    try:
        observation = robot.get_observation()

        joint_positions: dict[str, float] = {}
        debug_rows = []
        for motor_name, urdf_joint_name in motor_to_urdf_mapping.items():
            motor_key = f"{motor_name}.pos"
            if motor_key not in observation:
                logger.warning(f"Motor {motor_key} not found in observation")
                joint_positions[urdf_joint_name] = 0.0
                continue

            raw_value = observation[motor_key]

            if is_omx:
                # OMX reports position as a percentage of its calibrated range
                # (MotorNormMode.RANGE_M100_100 for the arm, RANGE_0_100 for
                # the gripper) rather than SO-101's degrees. Approximate the
                # arm joints' +-100% as +-180 degrees (Dynamixel's one-turn
                # 4096-tick convention) and the gripper's 0-100% as a small
                # opening swing - this is a visualization approximation, not
                # a precisely calibrated angle.
                angle_degrees = (raw_value / 100.0) * 60.0 if motor_name == "gripper" else raw_value * 1.8
            else:
                angle_degrees = raw_value
                calibration = robot.calibration or {}
                correction = _SO101_URDF_CORRECTIONS.get(motor_name)
                if correction is not None and motor_name in calibration:
                    sign, urdf_zero_ticks = correction
                    cal = calibration[motor_name]
                    mid = (cal.range_min + cal.range_max) / 2
                    motor_at_urdf_zero = (urdf_zero_ticks - mid) * 360 / _STS3215_MAX_RES
                    angle_degrees = sign * (raw_value - motor_at_urdf_zero)

            joint_positions[urdf_joint_name] = angle_degrees * math.pi / 180.0
            debug_rows.append(
                f"{motor_name:14s} raw={raw_value:+8.2f} → {urdf_joint_name:11s} = {angle_degrees:+8.2f}°"
            )

        # Throttled debug print (~once per second at 20 Hz broadcast).
        now = time.time()
        if now - getattr(get_joint_positions_from_robot, "_last_log", 0) > 1.0:
            get_joint_positions_from_robot._last_log = now
            logger.info("[joint-debug]\n  " + "\n  ".join(debug_rows))

        return joint_positions

    except Exception as e:
        logger.error(f"Error getting joint positions: {e}")
        return dict.fromkeys(motor_to_urdf_mapping.values(), 0.0)


def _safe_disconnect(device) -> None:
    """Disconnect a robot/teleop device, swallowing (but logging) any error.

    Used on the connection-failure cleanup path so one device's failure can't
    leave the other holding its serial port open.
    """
    safe_disconnect_device(device, logger)


def handle_start_teleoperation(request: TeleoperateRequest, websocket_manager=None) -> dict[str, Any]:
    """Handle start teleoperation request.

    Connects to both arms *synchronously* so that a connection failure (arm
    unplugged, port busy, power off) is reported back to the caller, rather than
    dying silently in the worker thread while the API has already claimed
    success. Only the teleoperation loop runs in the background thread.
    """
    global teleoperation_active, teleoperation_thread, current_robot, current_teleop, current_robot_type

    from . import record as _record, rollout as _rollout

    with _state_lock:
        if teleoperation_active:
            return {"success": False, "message": "Teleoperation is already active"}
        if _record.recording_active:
            return {"success": False, "message": "Recording is currently active. Stop it first."}
        if _rollout.inference_active:
            return {"success": False, "message": "Inference is currently active. Stop it first."}
        teleoperation_active = True

    robot = None
    teleop_device = None
    try:
        logger.info(
            f"Starting teleoperation with leader port: {request.leader_port}, follower port: {request.follower_port}"
        )

        # Setup calibration files
        leader_config_name, follower_config_name = setup_calibration_files(
            request.leader_config, request.follower_config, request.robot_type
        )

        # Create robot and teleop configs
        robot_config = make_device_config(
            robot_type=request.robot_type,
            side="follower",
            port=request.follower_port,
            config_id=follower_config_name,
        )

        teleop_config = make_device_config(
            robot_type=request.robot_type,
            side="leader",
            port=request.leader_port,
            config_id=leader_config_name,
        )

        # Connect synchronously. If either device fails to connect, clean up the
        # other (so its serial port is released) and report the error — do NOT
        # leave the caller thinking teleoperation started.
        logger.info("Initializing robot and teleop device...")
        robot = make_device(request.robot_type, "follower", robot_config)
        teleop_device = make_device(request.robot_type, "leader", teleop_config)

        # Connect each arm separately so the error names which one failed and
        # tells the user what to do, instead of a generic "failed to start".
        logger.info("Connecting to follower arm...")
        try:
            robot.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the follower arm on {request.follower_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e

        logger.info("Connecting to leader arm...")
        try:
            teleop_device.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the leader arm on {request.leader_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e

        # Write calibration to motors' memory. When no calibration file existed on
        # disk (OMX arms, which self-calibrate rather than going through LeLab's
        # web calibration wizard), `device.calibration` is empty at this point —
        # call `calibrate()` so the device writes+caches+saves its own values
        # instead of pushing an empty calibration to the bus.
        logger.info("Writing calibration to motors...")
        if robot.calibration:
            robot.bus.write_calibration(robot.calibration)
        else:
            robot.calibrate()
        if teleop_device.calibration:
            teleop_device.bus.write_calibration(teleop_device.calibration)
        else:
            teleop_device.calibrate()

        # Connect cameras and configure motors
        logger.info("Connecting cameras and configuring motors...")
        for cam in robot.cameras.values():
            cam.connect()
        robot.configure()
        teleop_device.configure()
        logger.info("Successfully connected to both devices")

        current_robot = robot
        current_teleop = teleop_device
        current_robot_type = request.robot_type

        # Stream the arms in the background; the worker owns disconnect so stop()
        # does not race the serial bus from the request thread.
        def teleoperation_worker():
            global teleoperation_active, current_robot, current_teleop

            logger.info("Starting teleoperation loop...")
            try:
                last_broadcast_time = 0
                broadcast_interval = 0.05  # 20 FPS

                while teleoperation_active:
                    action = teleop_device.get_action()
                    robot.send_action(action)

                    current_time = time.time()
                    if current_time - last_broadcast_time >= broadcast_interval:
                        try:
                            joint_positions = get_joint_positions_from_robot(robot, request.robot_type)
                            joint_data = {
                                "type": "joint_update",
                                "joints": joint_positions,
                                "timestamp": current_time,
                            }
                            if websocket_manager and websocket_manager.active_connections:
                                websocket_manager.broadcast_joint_data_sync(joint_data)
                            last_broadcast_time = current_time
                        except Exception as e:
                            logger.error(f"Error broadcasting joint data: {e}")

                    time.sleep(0.001)
            except Exception as e:
                logger.error(f"Error during teleoperation loop: {e}")
            finally:
                _safe_disconnect(robot)
                _safe_disconnect(teleop_device)
                logger.info("Teleoperation stopped")
                teleoperation_active = False
                current_robot = None
                current_teleop = None

        teleoperation_thread = threading.Thread(
            target=teleoperation_worker, name="teleoperation-worker", daemon=True
        )
        teleoperation_thread.start()

        return {
            "success": True,
            "message": "Teleoperation started successfully",
            "leader_port": request.leader_port,
            "follower_port": request.follower_port,
        }

    except Exception as e:
        # Connection (or setup) failed before the loop started: release any
        # device that did open, reset state, and surface the error.
        _safe_disconnect(robot)
        _safe_disconnect(teleop_device)
        teleoperation_active = False
        current_robot = None
        current_teleop = None
        logger.error(f"Failed to start teleoperation: {e}")
        # str(e) is already a user-facing message for the connection failures
        # raised above; the toast title supplies the "error starting" context.
        return {"success": False, "message": str(e)}


def handle_stop_teleoperation() -> dict[str, Any]:
    """Handle stop teleoperation request.

    Signals the worker via `teleoperation_active = False` and waits for it to
    exit. The worker owns the disconnect call, so this avoids racing the
    serial bus from the request thread.
    """
    global teleoperation_active, teleoperation_thread

    if not teleoperation_active:
        return {"success": False, "message": "No teleoperation session is active"}

    logger.info("Stop teleoperation triggered from web interface")
    teleoperation_active = False

    worker = teleoperation_thread
    if worker is not None and worker.is_alive():
        worker.join(timeout=5.0)
        if worker.is_alive():
            logger.warning("Teleoperation worker did not exit within 5s")
    teleoperation_thread = None

    return {"success": True, "message": "Teleoperation stopped successfully"}


def handle_teleoperation_status() -> dict[str, Any]:
    """Handle teleoperation status request"""
    return {
        "teleoperation_active": teleoperation_active,
        "available_controls": {
            "stop_teleoperation": teleoperation_active,
        },
        "message": "Teleoperation status retrieved successfully",
    }


def handle_get_joint_positions() -> dict[str, Any]:
    """Handle get current robot joint positions request"""
    global current_robot

    if not teleoperation_active or current_robot is None:
        return {"success": False, "message": "No active teleoperation session"}

    try:
        joint_positions = get_joint_positions_from_robot(current_robot, current_robot_type)
        return {"success": True, "joint_positions": joint_positions, "timestamp": time.time()}
    except Exception as e:
        logger.error(f"Error getting joint positions: {e}")
        return {"success": False, "message": f"Failed to get joint positions: {str(e)}"}
