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
"""Tests for lelab.calibrate — manager initial state and request schema."""

from __future__ import annotations

import threading

import pytest


@pytest.mark.parametrize(
    "pos,expected",
    [
        (-5, False),  # negative — bad frame
        (0, False),  # lower bound is exclusive (old check: pos > 0)
        (1, True),
        (100, True),
        (2000, True),
        (4095, True),  # encoder max
        (4999, True),
        (5000, False),  # upper bound is exclusive (old check: pos < 5000)
        (6000, False),  # extreme — bad frame
    ],
)
def test_is_valid_position_boundaries(pos, expected) -> None:
    """Pins the plausible-encoder-range filter that replaced three duplicated
    inline `pos > 0 and pos < 5000` checks. Boundaries are exclusive on both ends."""
    from lelab.calibrate import _is_valid_position

    assert _is_valid_position(pos) is expected


def test_calibration_status_defaults_to_idle() -> None:
    from lelab.calibrate import CalibrationStatus

    status = CalibrationStatus()
    assert status.calibration_active is False
    assert status.status == "idle"
    assert status.device_type is None
    assert status.error is None
    assert status.step == 0


def test_calibration_request_dataclass_round_trip() -> None:
    from lelab.calibrate import CalibrationRequest

    req = CalibrationRequest(
        device_type="teleop",
        port="/dev/ttyUSB0",
        config_file="my_calib",
    )
    assert req.device_type == "teleop"
    assert req.port == "/dev/ttyUSB0"
    assert req.config_file == "my_calib"
    assert req.robot_name is None


def test_calibration_manager_starts_idle() -> None:
    from lelab.calibrate import CalibrationManager

    mgr = CalibrationManager()
    assert mgr.status.calibration_active is False
    assert mgr.status.status == "idle"
    assert mgr.device is None
    assert mgr.calibration_thread is None


def test_calibration_manager_get_status_when_idle_returns_status_object() -> None:
    from lelab.calibrate import CalibrationManager, CalibrationStatus

    mgr = CalibrationManager()
    s = mgr.get_status()
    assert isinstance(s, CalibrationStatus)
    assert s.status == "idle"


def test_get_status_does_not_read_motor_bus_while_recording() -> None:
    """Status polling only returns the cache populated by the recording worker."""
    from lelab.calibrate import CalibrationManager

    class Bus:
        def __init__(self) -> None:
            self.sync_read_calls = 0

        def sync_read(self, *_args, **_kwargs):
            self.sync_read_calls += 1
            raise AssertionError("get_status must not access the motor bus")

    class Device:
        def __init__(self) -> None:
            self.bus = Bus()
            self.is_connected = True

    mgr = CalibrationManager()
    mgr.device = Device()
    mgr.status.status = "recording"
    mgr.status.recorded_ranges = {
        "joint": {"min": 100, "max": 300, "current": 200},
    }

    status = mgr.get_status()

    assert mgr.device.bus.sync_read_calls == 0
    assert status.recorded_ranges["joint"] == {"min": 100, "max": 300, "current": 200}


def test_get_status_returns_independent_recorded_ranges_snapshot() -> None:
    """A returned status snapshot does not change when the worker publishes again."""
    from lelab.calibrate import CalibrationManager

    mgr = CalibrationManager()
    mgr.status.status = "recording"
    mgr.status.recorded_ranges = {
        "joint": {"min": 100, "max": 200, "current": 150},
    }
    mgr._mins = {"joint": 100}
    mgr._maxes = {"joint": 300}

    status = mgr.get_status()
    mgr._cache_recorded_ranges({"joint": 250})

    assert status.recorded_ranges["joint"] == {"min": 100, "max": 200, "current": 150}
    assert mgr.get_status().recorded_ranges["joint"] == {
        "min": 100,
        "max": 300,
        "current": 250,
    }


def test_status_polling_does_not_wait_for_recording_bus_read() -> None:
    """A slow recording read does not block status polling."""
    from lelab.calibrate import CalibrationManager

    read_started = threading.Event()
    release_read = threading.Event()
    status_returned = threading.Event()

    class Bus:
        def __init__(self) -> None:
            self.read_count = 0

        def sync_read(self, *_args, **_kwargs):
            self.read_count += 1
            if self.read_count == 1:
                return {"joint": 100}
            read_started.set()
            assert release_read.wait(timeout=10)
            return {"joint": 300}

    class Device:
        def __init__(self) -> None:
            self.bus = Bus()
            self.is_connected = True

    mgr = CalibrationManager()
    mgr.device = Device()

    recorder = threading.Thread(target=mgr._step_range_recording)
    recorder.start()
    assert read_started.wait(timeout=2)

    polled_status = []

    def poll_status() -> None:
        polled_status.append(mgr.get_status())
        status_returned.set()

    poller = threading.Thread(target=poll_status)
    poller.start()

    try:
        assert status_returned.wait(timeout=2)
        assert polled_status[0].status == "recording"
    finally:
        mgr._step_complete.set()
        release_read.set()
        poller.join(timeout=2)
        recorder.join(timeout=2)

    assert not poller.is_alive()
    assert not recorder.is_alive()
    assert mgr.get_status().recorded_ranges["joint"] == {
        "min": 100,
        "max": 300,
        "current": 300,
    }


def test_recorded_ranges_cache_does_not_publish_after_recording_stops() -> None:
    """An in-flight read cannot publish stale UI data after recording stops."""
    from lelab.calibrate import CalibrationManager

    mgr = CalibrationManager()
    mgr.status.status = "stopping"
    mgr.status.recorded_ranges = {
        "joint": {"min": 100, "max": 200, "current": 150},
    }
    mgr._mins = {"joint": 100}
    mgr._maxes = {"joint": 300}

    mgr._cache_recorded_ranges({"joint": 300})

    assert mgr.get_status().recorded_ranges["joint"] == {
        "min": 100,
        "max": 200,
        "current": 150,
    }


def test_status_polling_does_not_read_bus_during_calibration_write() -> None:
    """Final calibration writes and status polling must not share the motor bus."""
    from lelab.calibrate import CalibrationManager

    write_started = threading.Event()
    release_write = threading.Event()

    class Motor:
        id = 1
        model = "sts3215"

    class Bus:
        def __init__(self) -> None:
            self.motors = {"joint": Motor()}
            self.sync_read_calls = 0

        def sync_read(self, *_args, **_kwargs):
            self.sync_read_calls += 1
            return {"joint": 200}

        def write_calibration(self, _calibration) -> None:
            write_started.set()
            assert release_write.wait(timeout=2)

    class Device:
        def __init__(self) -> None:
            self.bus = Bus()
            self.is_connected = True
            self.calibration_fpath = "test.json"
            self.calibration = None

        def _save_calibration(self) -> None:
            pass

    mgr = CalibrationManager()
    mgr.device = Device()
    mgr.status.status = "recording"
    mgr.status.recorded_ranges = {
        "joint": {"min": 100, "max": 300, "current": 200},
    }
    mgr._homing_offsets = {"joint": 0}
    mgr._mins = {"joint": 100}
    mgr._maxes = {"joint": 300}

    writer = threading.Thread(target=mgr._complete_calibration)
    writer.start()
    assert write_started.wait(timeout=2)

    try:
        status = mgr.get_status()
        assert status.status == "recording"
        assert mgr.device.bus.sync_read_calls == 0
    finally:
        release_write.set()
        writer.join(timeout=2)

    assert not writer.is_alive()


def test_calibration_manager_rejects_double_start_via_message() -> None:
    """When calibration_active is True, start_calibration returns success=False."""
    from lelab.calibrate import CalibrationManager, CalibrationRequest

    mgr = CalibrationManager()
    mgr.status.calibration_active = True  # simulate already running

    result = mgr.start_calibration(
        CalibrationRequest(device_type="teleop", port="/dev/null", config_file="x")
    )
    assert result.get("success") is False
    assert "already" in result.get("message", "").lower()


def test_cleanup_device_force_releases_and_clears_when_disconnect_fails() -> None:
    """A failed device.disconnect() must still force-close the port and clear the
    device handle — otherwise the COM port stays busy and blocks the next run."""
    from lelab.calibrate import CalibrationManager

    class PortHandler:
        def __init__(self) -> None:
            self.closed = False

        def closePort(self) -> None:  # noqa: N802 - mirrors LeRobot port handler API
            self.closed = True

    class Device:
        def __init__(self) -> None:
            self.bus = type("Bus", (), {"port_handler": PortHandler()})()

        def disconnect(self) -> None:
            raise RuntimeError("Failed to write 'Torque_Enable' on id_=6")

    mgr = CalibrationManager()
    device = Device()
    mgr.device = device

    mgr._cleanup_device()

    assert device.bus.port_handler.closed is True  # force-released despite failure
    assert mgr.device is None  # handle cleared so a new calibration can start
