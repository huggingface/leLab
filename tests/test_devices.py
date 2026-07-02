from __future__ import annotations

import logging


def test_safe_disconnect_force_closes_serial_port_after_disconnect_failure() -> None:
    from lelab.utils.devices import safe_disconnect_device

    class PortHandler:
        def __init__(self) -> None:
            self.cleared = False
            self.closed = False
            self.is_using = True

        def clearPort(self) -> None:  # noqa: N802 - mirrors LeRobot port handler API
            self.cleared = True

        def closePort(self) -> None:  # noqa: N802 - mirrors LeRobot port handler API
            self.closed = True

    class Camera:
        def __init__(self) -> None:
            self.disconnected = False

        def disconnect(self) -> None:
            self.disconnected = True

    class Device:
        def __init__(self) -> None:
            self.bus = type("Bus", (), {"port_handler": PortHandler()})()
            self.cameras = {"cam": Camera()}

        def disconnect(self) -> None:
            raise RuntimeError("Failed to write 'Torque_Enable' on id_=6")

    device = Device()
    safe_disconnect_device(device, logging.getLogger(__name__))

    assert device.bus.port_handler.cleared is True
    assert device.bus.port_handler.is_using is False
    assert device.bus.port_handler.closed is True
    assert device.cameras["cam"].disconnected is True


def test_safe_disconnect_uses_normal_disconnect_when_it_succeeds() -> None:
    from lelab.utils.devices import safe_disconnect_device

    class PortHandler:
        def __init__(self) -> None:
            self.closed = False

        def closePort(self) -> None:  # noqa: N802 - mirrors LeRobot port handler API
            self.closed = True

    class Device:
        def __init__(self) -> None:
            self.bus = type("Bus", (), {"port_handler": PortHandler()})()
            self.disconnected = False

        def disconnect(self) -> None:
            self.disconnected = True

    device = Device()
    safe_disconnect_device(device, logging.getLogger(__name__))

    assert device.disconnected is True
    assert device.bus.port_handler.closed is False
