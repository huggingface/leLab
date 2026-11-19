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
"""Tests for lelab.utils.config — path resolution and persistence helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _patch_robots_path(tmp_lerobot_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirect ROBOTS_PATH (not covered by the shared fixture) into tmp."""
    from lelab.utils import config as cfg

    robots_dir = tmp_lerobot_home / "robots"
    robots_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "ROBOTS_PATH", str(robots_dir))


def test_port_persistence_round_trips(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_port("leader", "/dev/ttyUSB0")
    cfg.save_robot_port("follower", "/dev/ttyUSB1")

    assert cfg.get_saved_robot_port("leader") == "/dev/ttyUSB0"
    assert cfg.get_saved_robot_port("follower") == "/dev/ttyUSB1"


def test_get_saved_robot_port_returns_none_when_unset(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    assert cfg.get_saved_robot_port("leader") is None


class _Port:
    def __init__(self, device: str) -> None:
        self.device = device


def _linux_with_ports(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, devices: list[str]) -> Path:
    """A Linux with `devices` as pyserial's comports and an empty /dev/serial/by-id."""
    from serial.tools import list_ports

    from lelab.utils import config as cfg

    monkeypatch.setattr(cfg.platform, "system", lambda: "Linux")
    monkeypatch.setattr(list_ports, "comports", lambda: [_Port(d) for d in devices])
    by_id = tmp_path / "by-id"
    by_id.mkdir()
    monkeypatch.setattr(cfg, "SERIAL_BY_ID_DIR", by_id)
    return by_id


def test_linux_ports_come_from_pyserial_not_every_tty_node(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A Jetson has about 90 /dev/tty* nodes and none of them is an arm unless a USB
    adapter is plugged in; only the serial devices pyserial knows are listed."""
    from lelab.utils import config as cfg

    _linux_with_ports(monkeypatch, tmp_path, ["/dev/ttyACM1", "/dev/ttyACM0"])

    assert cfg.find_available_ports() == ["/dev/ttyACM0", "/dev/ttyACM1"]


def test_linux_ports_use_the_stable_by_id_name(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The by-id link carries the adapter's serial number, so a saved port keeps
    opening the same arm when ttyACM0 and ttyACM1 swap with plug order."""
    from lelab.utils import config as cfg

    by_id = _linux_with_ports(monkeypatch, tmp_path, ["/dev/ttyACM0", "/dev/ttyACM1"])
    (tmp_path / "ttyACM0").touch()
    (by_id / "usb-1a86_USB_Single_Serial_5A46-if00").symlink_to(tmp_path / "ttyACM0")
    monkeypatch.setattr(
        list_ports_module(), "comports", lambda: [_Port(str(tmp_path / "ttyACM0")), _Port("/dev/ttyACM1")]
    )

    ports = cfg.find_available_ports()

    assert ports == sorted([str(by_id / "usb-1a86_USB_Single_Serial_5A46-if00"), "/dev/ttyACM1"])
    # The unplug diff still names the one that vanished.
    monkeypatch.setattr(list_ports_module(), "comports", lambda: [_Port("/dev/ttyACM1")])
    assert cfg.detect_port_after_disconnect(ports, timeout_s=1.0, poll_interval_s=0.01) == str(
        by_id / "usb-1a86_USB_Single_Serial_5A46-if00"
    )


def list_ports_module():
    from serial.tools import list_ports

    return list_ports


def test_windows_and_macos_port_listing_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    from lelab.utils import config as cfg

    monkeypatch.setattr(cfg.platform, "system", lambda: "Windows")
    monkeypatch.setattr(list_ports_module(), "comports", lambda: [_Port("COM7"), _Port("COM3")])
    assert cfg.find_available_ports() == ["COM3", "COM7"]

    monkeypatch.setattr(cfg.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(cfg.Path, "glob", lambda self, pattern: [Path("/dev/tty.usbmodem1")])
    assert cfg.find_available_ports() == ["/dev/tty.usbmodem1"]


def test_saved_robot_config_round_trips(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_config("leader", "my_calib")
    assert cfg.get_saved_robot_config("leader") == "my_calib"


def test_get_default_robot_config_falls_back_to_first_available(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    available = ["alpha", "beta", "gamma"]
    # No saved config → first available wins.
    assert cfg.get_default_robot_config("leader", available) == "alpha"

    # After saving, the saved one wins if it's still available.
    cfg.save_robot_config("leader", "beta")
    assert cfg.get_default_robot_config("leader", available) == "beta"

    # Saved config no longer in the available list → fall back to first.
    cfg.save_robot_config("leader", "deleted")
    assert cfg.get_default_robot_config("leader", available) == "alpha"


def test_is_valid_robot_name_accepts_simple_names(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    assert cfg.is_valid_robot_name("my_robot")
    assert cfg.is_valid_robot_name("robot-1")


def test_is_valid_robot_name_rejects_empty_and_path_separators(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    assert not cfg.is_valid_robot_name("")
    assert not cfg.is_valid_robot_name("a/b")
    assert not cfg.is_valid_robot_name("..")


def test_is_valid_robot_name_rejects_leading_trailing_whitespace(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # name.strip() != name → invalid
    assert not cfg.is_valid_robot_name(" robot")
    assert not cfg.is_valid_robot_name("robot ")


def test_robot_record_save_get_delete_round_trip(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    record = {"name": "lab1", "leader_port": "/dev/ttyUSB0", "follower_port": ""}
    assert cfg.save_robot_record("lab1", record, allow_create=True)

    loaded = cfg.get_robot_record("lab1")
    assert loaded is not None
    assert loaded["name"] == "lab1"
    assert loaded["leader_port"] == "/dev/ttyUSB0"

    listed = cfg.list_robot_records()
    assert any(r["name"] == "lab1" for r in listed)

    assert cfg.delete_robot_record("lab1")
    assert cfg.get_robot_record("lab1") is None


def test_robot_record_allow_create_false_is_noop(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    # Record does not exist and allow_create=False → returns False.
    result = cfg.save_robot_record("nonexistent", {"leader_port": "/dev/x"}, allow_create=False)
    assert result is False
    assert cfg.get_robot_record("nonexistent") is None


def test_robot_record_save_rejects_invalid_name(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    # Path traversal-style names must not write outside the config dir.
    assert not cfg.save_robot_record("../escape", {"name": "x"}, allow_create=True)


def test_robot_record_merges_fields(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_record("merge_test", {"leader_port": "/dev/a"}, allow_create=True)
    cfg.save_robot_record("merge_test", {"follower_port": "/dev/b"}, allow_create=False)

    loaded = cfg.get_robot_record("merge_test")
    assert loaded is not None
    assert loaded["leader_port"] == "/dev/a"
    assert loaded["follower_port"] == "/dev/b"


def test_setup_calibration_files_copies_configs(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # setup_calibration_files reads from LEADER_CONFIG_PATH / FOLLOWER_CONFIG_PATH
    # and writes into those same directories (source dir == target dir).
    # Provide source files there.
    src_leader = Path(cfg.LEADER_CONFIG_PATH) / "demo_leader.json"
    src_leader.write_text(json.dumps({"motors": {}}))

    src_follower = Path(cfg.FOLLOWER_CONFIG_PATH) / "demo_follower.json"
    src_follower.write_text(json.dumps({"motors": {}}))

    result = cfg.setup_calibration_files("demo_leader.json", "demo_follower.json")
    # Returns the stem names.
    assert result == ("demo_leader", "demo_follower")

    # Files should exist (they were already there; function ensures they are present).
    assert src_leader.is_file()
    assert src_follower.is_file()


# DISCOVERED: `setup_calibration_files` sets `leader_calibration_dir = LEADER_CONFIG_PATH`
# (not CALIBRATION_BASE_PATH_TELEOP) and `follower_calibration_dir = FOLLOWER_CONFIG_PATH`
# (not CALIBRATION_BASE_PATH_ROBOTS). This means source and destination are the same
# directory, so the function only validates that the file exists in LEADER_CONFIG_PATH /
# FOLLOWER_CONFIG_PATH; it never writes into CALIBRATION_BASE_PATH_TELEOP or
# CALIBRATION_BASE_PATH_ROBOTS. The plan's assertion about those paths was incorrect.


def test_with_lelab_tag_appends_to_existing_tags() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    assert with_lelab_tag(["robotics", "lerobot"]) == ["robotics", "lerobot", LELAB_TAG]


def test_with_lelab_tag_handles_none_and_empty() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    assert with_lelab_tag(None) == [LELAB_TAG]
    assert with_lelab_tag([]) == [LELAB_TAG]


def test_with_lelab_tag_dedupes() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    # Caller-supplied LeLab is not duplicated, and order is preserved.
    assert with_lelab_tag(["robotics", LELAB_TAG, "lerobot"]) == ["robotics", LELAB_TAG, "lerobot"]
