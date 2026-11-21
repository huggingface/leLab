from __future__ import annotations

import logging

from lerobot.motors import Motor, MotorNormMode, SerialMotorsBus


class _UnresponsiveRustypotBus:
    """Stands in for an open rustypot.Bus whose motors no longer answer."""

    def __init__(self) -> None:
        self.closed = False

    def set_torque(self, ids, enabled, retries=0):
        return dict.fromkeys(ids, "no status packet")

    def close(self) -> None:
        self.closed = True


def _connected_bus() -> SerialMotorsBus:
    bus = SerialMotorsBus(
        port="/dev/null", motors={"gripper": Motor(6, "sts3215", MotorNormMode.RANGE_0_100)}
    )
    bus._bus = _UnresponsiveRustypotBus()
    return bus


def test_safe_disconnect_releases_serial_port_after_disconnect_failure() -> None:
    from lelab.utils.devices import safe_disconnect_device

    class Camera:
        def __init__(self) -> None:
            self.disconnected = False

        def disconnect(self) -> None:
            self.disconnected = True

    class Device:
        def __init__(self) -> None:
            self.bus = _connected_bus()
            self.cameras = {"cam": Camera()}

        def disconnect(self) -> None:
            raise RuntimeError("camera is not connected")

    device = Device()
    port = device.bus._bus
    safe_disconnect_device(device, logging.getLogger(__name__))

    assert port.closed is True  # released even though disabling the torque failed
    assert device.bus.is_connected is False
    assert device.cameras["cam"].disconnected is True


def test_safe_disconnect_uses_normal_disconnect_when_it_succeeds() -> None:
    from lelab.utils.devices import safe_disconnect_device

    class Device:
        def __init__(self) -> None:
            self.bus = _connected_bus()
            self.disconnected = False

        def disconnect(self) -> None:
            self.disconnected = True

    device = Device()
    safe_disconnect_device(device, logging.getLogger(__name__))

    assert device.disconnected is True
    assert device.bus.is_connected is True  # the fallback did not run
