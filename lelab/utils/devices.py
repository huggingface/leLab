"""Device cleanup helpers for LeRobot hardware wrappers.

Serial ports are a trust boundary on Windows: if a normal disconnect fails
while disabling torque, the COM handle can stay open until the Python process
exits. These helpers preserve LeRobot's normal disconnect behavior, then force
close the underlying port/cameras as a last resort.
"""

from __future__ import annotations

import logging
from contextlib import suppress
from typing import Any


def safe_disconnect_device(device: Any, logger: logging.Logger, context: str = "cleanup") -> None:
    """Disconnect a LeRobot device and force-release resources on failure."""
    if device is None:
        return

    try:
        device.disconnect()
        return
    except Exception as exc:
        logger.warning("Error disconnecting device during %s: %s", context, exc)

    _force_close_device_resources(device, logger)


def _force_close_device_resources(device: Any, logger: logging.Logger) -> None:
    """Best-effort release for serial/camera resources after disconnect fails."""
    bus = getattr(device, "bus", None)
    port_handler = getattr(bus, "port_handler", None)
    if port_handler is not None:
        with suppress(Exception):
            port_handler.clearPort()
        with suppress(Exception):
            port_handler.is_using = False
        try:
            port_handler.closePort()
            logger.info("Force-closed serial port after disconnect failure")
        except Exception as exc:
            logger.warning("Failed to force-close serial port after disconnect failure: %s", exc)

    cameras = getattr(device, "cameras", None)
    if isinstance(cameras, dict):
        for cam in cameras.values():
            try:
                cam.disconnect()
            except Exception as exc:
                logger.warning("Failed to disconnect camera after device cleanup failure: %s", exc)
