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

import json
import logging
import os
import platform
import shutil
import time
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

RobotSide = Literal["leader", "follower"]

# Define the calibration config paths (shared between features)
CALIBRATION_BASE_PATH_TELEOP = os.path.expanduser("~/.cache/huggingface/lerobot/calibration/teleoperators")
CALIBRATION_BASE_PATH_ROBOTS = os.path.expanduser("~/.cache/huggingface/lerobot/calibration/robots")
LEADER_CONFIG_PATH = os.path.join(CALIBRATION_BASE_PATH_TELEOP, "so_leader")
FOLLOWER_CONFIG_PATH = os.path.join(CALIBRATION_BASE_PATH_ROBOTS, "so_follower")


def is_omx_robot_type(robot_type: str | None) -> bool:
    """OMX arms come pre-calibrated and self-calibrate on first connect (see
    OmxFollower/OmxLeader.connect() in lerobot), so LeLab's web calibration
    step and its "calibration file must already exist" checks don't apply."""
    return "omx" in (robot_type or "so101").lower().replace("-", "_")


def get_calibration_path(robot_type: str | None, side: Literal["leader", "follower"]) -> str:
    """Get the directory where calibration configurations are stored for a given robot model."""
    base_config_path = LEADER_CONFIG_PATH if side == "leader" else FOLLOWER_CONFIG_PATH
    base = os.path.dirname(base_config_path)
    model = (robot_type or "so101").lower().replace("-", "_")
    if "so" in model:
        folder = f"so_{side}"
    elif "omx" in model:
        folder = f"omx_{side}"
    else:
        folder = f"so_{side}"
    return os.path.join(base, folder)

# Define port storage path
PORT_CONFIG_PATH = os.path.expanduser("~/.cache/huggingface/lerobot/ports")
LEADER_PORT_FILE = os.path.join(PORT_CONFIG_PATH, "leader_port.txt")
FOLLOWER_PORT_FILE = os.path.join(PORT_CONFIG_PATH, "follower_port.txt")

# Define configuration storage path
CONFIG_STORAGE_PATH = os.path.expanduser("~/.cache/huggingface/lerobot/saved_configs")
LEADER_CONFIG_FILE = os.path.join(CONFIG_STORAGE_PATH, "leader_config.txt")
FOLLOWER_CONFIG_FILE = os.path.join(CONFIG_STORAGE_PATH, "follower_config.txt")

# Robot config records (per-robot JSON metadata)
ROBOTS_PATH = os.path.expanduser("~/.cache/huggingface/lerobot/robots")

# Tag stamped on every dataset pushed to the Hub from LeLab, so we can later
# query the Hub for LeLab-produced datasets and compute usage metrics.
LELAB_TAG = "LeLab"


def with_lelab_tag(tags: list[str] | None) -> list[str]:
    """Return `tags` with LELAB_TAG appended (deduped, order preserved)."""
    out = list(tags or [])
    if LELAB_TAG not in out:
        out.append(LELAB_TAG)
    return out


def _atomic_write_text(path: str, content: str) -> None:
    """Write to <path>.tmp then os.replace, so a crash mid-write never leaves
    a half-written file on disk."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        f.write(content)
    os.replace(tmp, path)


def _port_file_for(robot_type: RobotSide) -> str:
    if robot_type == "leader":
        return LEADER_PORT_FILE
    if robot_type == "follower":
        return FOLLOWER_PORT_FILE
    raise ValueError(f"robot_type must be 'leader' or 'follower', got {robot_type!r}")


def _config_file_for(robot_type: RobotSide) -> str:
    rt = robot_type.lower() if isinstance(robot_type, str) else robot_type
    if rt == "leader":
        return LEADER_CONFIG_FILE
    if rt == "follower":
        return FOLLOWER_CONFIG_FILE
    raise ValueError(f"robot_type must be 'leader' or 'follower', got {robot_type!r}")


def setup_calibration_files(leader_config: str, follower_config: str, robot_type: str = "so101"):
    """Setup calibration files in the correct locations for teleoperation and recording"""
    # Extract config names from file paths (remove .json extension)
    leader_config_name = os.path.splitext(leader_config)[0]
    follower_config_name = os.path.splitext(follower_config)[0]

    # Resolve dynamic configuration paths based on robot_type
    leader_calib_path = get_calibration_path(robot_type, "leader")
    follower_calib_path = get_calibration_path(robot_type, "follower")

    # Log the full paths to check if files exist
    leader_config_full_path = os.path.join(leader_calib_path, leader_config)
    follower_config_full_path = os.path.join(follower_calib_path, follower_config)

    logger.info("Checking calibration files:")
    logger.info(f"Leader config path: {leader_config_full_path}")
    logger.info(f"Follower config path: {follower_config_full_path}")
    logger.info(f"Leader config exists: {os.path.exists(leader_config_full_path)}")
    logger.info(f"Follower config exists: {os.path.exists(follower_config_full_path)}")

    # Create calibration directories if they don't exist
    os.makedirs(leader_calib_path, exist_ok=True)
    os.makedirs(follower_calib_path, exist_ok=True)

    # Copy calibration files to the correct locations if they're not already there
    leader_target_path = os.path.join(leader_calib_path, f"{leader_config_name}.json")
    follower_target_path = os.path.join(follower_calib_path, f"{follower_config_name}.json")

    omx = is_omx_robot_type(robot_type)

    if not os.path.exists(leader_target_path):
        if os.path.exists(leader_config_full_path):
            shutil.copy2(leader_config_full_path, leader_target_path)
            logger.info(f"Copied leader calibration to {leader_target_path}")
        elif omx:
            logger.info(f"No leader calibration yet for OMX at {leader_target_path}; will self-calibrate on connect")
        else:
            raise FileNotFoundError(f"Leader calibration file not found: {leader_config_full_path}")
    else:
        logger.info(f"Leader calibration already exists at {leader_target_path}")

    if not os.path.exists(follower_target_path):
        if os.path.exists(follower_config_full_path):
            shutil.copy2(follower_config_full_path, follower_target_path)
            logger.info(f"Copied follower calibration to {follower_target_path}")
        elif omx:
            logger.info(f"No follower calibration yet for OMX at {follower_target_path}; will self-calibrate on connect")
        else:
            raise FileNotFoundError(f"Follower calibration file not found: {follower_config_full_path}")
    else:
        logger.info(f"Follower calibration already exists at {follower_target_path}")

    return leader_config_name, follower_config_name


def setup_follower_calibration_file(follower_config: str, robot_type: str = "so101"):
    """Setup follower calibration file in the correct location for replay functionality"""
    # Extract config name from file path (remove .json extension)
    follower_config_name = os.path.splitext(follower_config)[0]

    # Resolve dynamic configuration path based on robot_type
    follower_calib_path = get_calibration_path(robot_type, "follower")

    # Log the full path to check if file exists
    follower_config_full_path = os.path.join(follower_calib_path, follower_config)

    logger.info("Checking follower calibration file:")
    logger.info(f"Follower config path: {follower_config_full_path}")
    logger.info(f"Follower config exists: {os.path.exists(follower_config_full_path)}")

    # Create calibration directory if it doesn't exist
    os.makedirs(follower_calib_path, exist_ok=True)

    # Copy calibration file to the correct location if it's not already there
    follower_target_path = os.path.join(follower_calib_path, f"{follower_config_name}.json")

    if not os.path.exists(follower_target_path):
        if os.path.exists(follower_config_full_path):
            shutil.copy2(follower_config_full_path, follower_target_path)
            logger.info(f"Copied follower calibration to {follower_target_path}")
        elif is_omx_robot_type(robot_type):
            logger.info(f"No follower calibration yet for OMX at {follower_target_path}; will self-calibrate on connect")
        else:
            raise FileNotFoundError(f"Follower calibration file not found: {follower_config_full_path}")
    else:
        logger.info(f"Follower calibration already exists at {follower_target_path}")

    return follower_config_name


def find_available_ports():
    """Find all available serial ports on the system"""
    try:
        from serial.tools import list_ports  # Part of pyserial library
    except ImportError as exc:
        raise ImportError("pyserial library is required. Install it with: pip install pyserial") from exc

    if platform.system() == "Windows":
        # List COM ports using pyserial
        ports = [port.device for port in list_ports.comports()]
    else:  # Linux/macOS
        # List /dev/tty* ports for Unix-based systems
        ports = [str(path) for path in Path("/dev").glob("tty*")]
    return sorted(ports)


def find_robot_port(robot_type="robot"):
    """
    Find the port for a robot by detecting the difference when disconnecting/reconnecting

    Args:
        robot_type (str): Type of robot ("leader" or "follower" or generic "robot")

    Returns:
        str: The detected port
    """
    logger.info(f"Finding port for {robot_type}")

    # Get initial ports
    ports_before = find_available_ports()
    logger.info(f"Ports before disconnecting: {ports_before}")

    # This function returns the port detection logic, but the actual user interaction
    # should be handled by the frontend
    return {"ports_before": ports_before, "robot_type": robot_type}


def detect_port_after_disconnect(ports_before, timeout_s: float = 15.0, poll_interval_s: float = 0.3):
    """
    Wait for the user to unplug the robot and detect which port disappeared.

    Polls the available ports until exactly one entry from ``ports_before`` vanishes,
    or until ``timeout_s`` elapses. Polling avoids racing the user — they may need
    several seconds to physically pull the USB cable.

    Args:
        ports_before (list): List of ports before disconnection
        timeout_s (float): Maximum seconds to wait for a port to disappear
        poll_interval_s (float): Seconds between checks

    Returns:
        str: The detected port

    Raises:
        OSError: If the timeout elapses with no change, or more than one port disappears.
    """
    before_set = set(ports_before)
    deadline = time.monotonic() + timeout_s
    last_diff: list = []

    while time.monotonic() < deadline:
        ports_after = find_available_ports()
        ports_diff = list(before_set - set(ports_after))
        last_diff = ports_diff

        if len(ports_diff) == 1:
            port = ports_diff[0]
            logger.info(f"Detected port: {port}")
            return port
        if len(ports_diff) > 1:
            raise OSError(f"Could not detect the port. More than one port disappeared: {ports_diff}.")

        time.sleep(poll_interval_s)

    logger.info(f"Timed out waiting for unplug. Final diff: {last_diff}")
    raise OSError(
        "Timed out waiting for the robot to be unplugged. Please try again and unplug the USB cable when prompted."
    )


def save_robot_port(robot_type: RobotSide, port: str) -> None:
    """Persist the robot port for `robot_type` ('leader' or 'follower')."""
    port_file = _port_file_for(robot_type)
    _atomic_write_text(port_file, port)
    logger.info(f"Saved {robot_type} port: {port}")


def get_saved_robot_port(robot_type: RobotSide) -> str | None:
    """Return the saved port for `robot_type`, or None if no file exists."""
    port_file = _port_file_for(robot_type)
    if not os.path.exists(port_file):
        logger.info(f"No saved port found for {robot_type}")
        return None
    with open(port_file) as f:
        port = f.read().strip()
    logger.info(f"Retrieved saved {robot_type} port: {port}")
    return port


def get_default_robot_port(robot_type: RobotSide) -> str:
    """Saved port if present, else a platform-typical default."""
    saved_port = get_saved_robot_port(robot_type)
    if saved_port:
        return saved_port
    if platform.system() == "Windows":
        return "COM3"
    return "/dev/ttyUSB0"


def save_robot_config(robot_type: RobotSide, config_name: str) -> bool:
    try:
        config_file_path = _config_file_for(robot_type)
    except ValueError as e:
        logger.error(str(e))
        return False
    try:
        _atomic_write_text(config_file_path, config_name.strip())
    except Exception as e:
        logger.error(f"Error saving {robot_type} configuration: {e}")
        return False
    logger.info(f"Saved {robot_type} configuration: {config_name}")
    return True


def get_saved_robot_config(robot_type: RobotSide) -> str | None:
    try:
        config_file_path = _config_file_for(robot_type)
    except ValueError as e:
        logger.error(str(e))
        return None
    if not os.path.exists(config_file_path):
        logger.info(f"No saved {robot_type} configuration found")
        return None
    try:
        with open(config_file_path) as f:
            config_name = f.read().strip()
    except OSError as e:
        logger.error(f"Error reading saved {robot_type} configuration: {e}")
        return None
    if not config_name:
        return None
    logger.info(f"Found saved {robot_type} configuration: {config_name}")
    return config_name


def get_default_robot_config(robot_type: str, available_configs: list):
    """Get the default configuration for a robot, checking saved configs first"""
    saved_config = get_saved_robot_config(robot_type)
    if saved_config and saved_config in available_configs:
        return saved_config

    # Return first available config as fallback
    if available_configs:
        return available_configs[0]

    return None


# ---------------------------------------------------------------------------
# Robot record helpers
# ---------------------------------------------------------------------------

# Characters disallowed in a robot name (filesystem safety)
_INVALID_NAME_CHARS = ("/", "\\", "..")
_ROBOT_STRING_FIELDS = ("leader_port", "follower_port", "leader_config", "follower_config", "robot_type")
_ROBOT_LIST_FIELDS = ("cameras",)


def _robot_record_path(name: str) -> str:
    return os.path.join(ROBOTS_PATH, f"{name}.json")


def is_valid_robot_name(name: str) -> bool:
    """Check that a robot name is safe to use as a filename."""
    if not name or not isinstance(name, str):
        return False
    if name.strip() != name:
        return False
    return not any(bad in name for bad in _INVALID_NAME_CHARS)


def _empty_record(name: str) -> dict:
    record: dict = {"name": name}
    for field in _ROBOT_STRING_FIELDS:
        record[field] = ""
    for field in _ROBOT_LIST_FIELDS:
        record[field] = []
    record["robot_type"] = "so101"
    return record


def get_robot_record(name: str) -> dict | None:
    """Return the robot record by name, or None if missing."""
    path = _robot_record_path(name)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to read robot record {name}: {e}")
        return None
    # Ensure all expected fields exist (forward/back compat)
    record = _empty_record(name)
    record.update({k: v for k, v in data.items() if k in record})
    record["name"] = name
    return record


def list_robot_records() -> list[dict]:
    """Return all robot records on disk."""
    if not os.path.exists(ROBOTS_PATH):
        return []
    records = []
    for filename in sorted(os.listdir(ROBOTS_PATH)):
        if not filename.endswith(".json"):
            continue
        name = os.path.splitext(filename)[0]
        record = get_robot_record(name)
        if record is not None:
            records.append(record)
    return records


def save_robot_record(name: str, data: dict, allow_create: bool = True) -> bool:
    """
    Upsert a robot record. Merges `data` into the existing record, preserving
    fields not provided. Returns True if a write occurred, False if no-oped.

    - If the record exists: merge and write.
    - If the record does not exist and `allow_create` is True: create with empty
      fields then merge.
    - If the record does not exist and `allow_create` is False: log and no-op.
    """
    if not is_valid_robot_name(name):
        logger.error(f"Invalid robot name: {name!r}")
        return False

    os.makedirs(ROBOTS_PATH, exist_ok=True)
    existing = get_robot_record(name)
    if existing is None and not allow_create:
        logger.info(f"save_robot_record no-op: {name} does not exist (allow_create=False)")
        return False

    record = existing if existing is not None else _empty_record(name)
    for field in _ROBOT_STRING_FIELDS:
        if field in data and isinstance(data[field], str):
            record[field] = data[field]
    for field in _ROBOT_LIST_FIELDS:
        if field in data and isinstance(data[field], list):
            record[field] = data[field]
    record["name"] = name

    # OMX arms don't go through LeLab's step-based web calibration wizard (it's
    # SO-101-specific joint-range recording); OMX self-calibrates with fixed
    # factory-default values on first connect, so any calibration id works.
    # Default one in from the robot name so the record can become "clean"
    # without ever running calibration.
    if is_omx_robot_type(record.get("robot_type")):
        if not record.get("leader_config", "").strip():
            record["leader_config"] = f"{name}.json"
        if not record.get("follower_config", "").strip():
            record["follower_config"] = f"{name}.json"

    path = _robot_record_path(name)
    _atomic_write_text(path, json.dumps(record, indent=2))
    logger.info(f"Saved robot record {name}: {record}")
    return True


def delete_robot_record(name: str) -> bool:
    """Delete a robot record. Returns True if a file was removed."""
    if not is_valid_robot_name(name):
        return False
    path = _robot_record_path(name)
    if not os.path.exists(path):
        return False
    os.remove(path)
    logger.info(f"Deleted robot record {name}")
    return True


def is_robot_record_clean(record: dict) -> bool:
    """
    A record is 'clean' when all four operational fields are populated AND both
    referenced calibration files exist on disk. Cameras are optional and don't
    affect cleanliness.

    OMX arms are exempt from the calibration-file-exists check: they don't go
    through LeLab's web calibration flow and self-calibrate on first connect
    (see is_omx_robot_type / OmxFollower.connect() in lerobot), so ports+config
    names being set is enough to be considered ready for teleoperation.
    """
    if not record:
        return False
    # We check only the four original operational fields for cleanliness.
    # robot_type is a metadata field and doesn't need to be non-empty,
    # but it defaults to so101.
    clean_fields = ("leader_port", "follower_port", "leader_config", "follower_config")
    for field in clean_fields:
        value = record.get(field, "")
        if not isinstance(value, str) or not value.strip():
            return False

    robot_type = record.get("robot_type", "so101")
    if is_omx_robot_type(robot_type):
        return True

    leader_calib_path = get_calibration_path(robot_type, "leader")
    follower_calib_path = get_calibration_path(robot_type, "follower")

    leader_path = os.path.join(leader_calib_path, record["leader_config"])
    follower_path = os.path.join(follower_calib_path, record["follower_config"])
    return os.path.exists(leader_path) and os.path.exists(follower_path)
