"""Windows camera backend selection (DirectShow vs Media Foundation).

Upstream LeLab pins Windows to DirectShow so that a camera index matches the
pygrabber-enumerated DirectShow name. Some UVC cameras are only exposed through
Media Foundation (MSMF) and never show up in DirectShow at all, e.g. the
0C45:636B "USB Camera" used as an SO-101 wrist camera. Setting

    LELAB_WINDOWS_CAMERA_BACKEND=MSMF

switches enumeration, recording and inference to MSMF consistently. Default
stays DSHOW, so behavior is unchanged unless the variable is set.

MSMF note: the OpenCV wheel from PyPI (opencv-python[-headless]) lists MSMF but
may fail to open devices; an OpenCV build with working MSMF must be importable,
and `OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS=0` (LeRobot sets it) avoids a
~60 s open timeout.
"""

from __future__ import annotations

import ctypes
import logging
import os
import platform
import uuid
from ctypes import wintypes

logger = logging.getLogger(__name__)

ENV_VAR = "LELAB_WINDOWS_CAMERA_BACKEND"
_VALID = ("DSHOW", "MSMF")


def windows_camera_backend_name() -> str:
    """Backend name ("DSHOW" or "MSMF") to use on Windows."""
    value = os.environ.get(ENV_VAR, "DSHOW").strip().upper()
    if value not in _VALID:
        logger.warning("%s=%r is not one of %s; using DSHOW", ENV_VAR, value, _VALID)
        return "DSHOW"
    return value


def windows_uses_msmf() -> bool:
    return platform.system() == "Windows" and windows_camera_backend_name() == "MSMF"


# --------------------------------------------------------------------------- Media Foundation names
class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]

    @classmethod
    def of(cls, text: str) -> _GUID:
        u = uuid.UUID(text)
        g = cls()
        g.Data1, g.Data2, g.Data3 = u.fields[0], u.fields[1], u.fields[2]
        g.Data4[:] = u.bytes[8:]
        return g


_MF_VERSION = 0x00020070
_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE = "c60ac5fe-252a-478f-a0ef-bc8fa5f7cad3"
_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID = "8ac3587a-4ae7-42d8-99e0-0a6013eef90f"
_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME = "60d0e559-52f8-4fa2-bbce-acdb34a8ec01"

# IMFAttributes vtable slots (IUnknown 0-2, then the IMFAttributes methods in header order).
_RELEASE = 2
_GET_ALLOCATED_STRING = 13
_SET_GUID = 24


def _vcall(obj: ctypes.c_void_p, slot: int, restype, *argtypes):
    vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(vtbl[slot])


def msmf_camera_names() -> list[str] | None:
    """Friendly names of video capture devices in MFEnumDeviceSources order.

    That is the order OpenCV's MSMF backend uses for `VideoCapture(index, CAP_MSMF)`,
    so names[i] is the device behind index i. Returns None if Media Foundation is
    unavailable. The caller must have COM initialized on this thread.
    """
    if platform.system() != "Windows":
        return None
    try:
        mfplat = ctypes.WinDLL("mfplat")
        mf = ctypes.WinDLL("mf")
        ole32 = ctypes.WinDLL("ole32")
    except OSError as e:
        logger.warning("Media Foundation not available: %s", e)
        return None

    hr = mfplat.MFStartup(wintypes.ULONG(_MF_VERSION), wintypes.DWORD(0))
    if hr < 0:
        logger.warning("MFStartup failed: 0x%08x", hr & 0xFFFFFFFF)
        return None
    attrs = ctypes.c_void_p()
    devices = ctypes.POINTER(ctypes.c_void_p)()
    count = wintypes.UINT(0)
    names: list[str] = []
    try:
        if mfplat.MFCreateAttributes(ctypes.byref(attrs), wintypes.UINT(1)) < 0:
            return None
        key, val = (
            _GUID.of(_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE),
            _GUID.of(_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID),
        )
        set_guid = _vcall(attrs, _SET_GUID, ctypes.c_long, ctypes.POINTER(_GUID), ctypes.POINTER(_GUID))
        if set_guid(attrs, ctypes.byref(key), ctypes.byref(val)) < 0:
            return None
        if mf.MFEnumDeviceSources(attrs, ctypes.byref(devices), ctypes.byref(count)) < 0:
            return None
        name_key = _GUID.of(_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)
        for i in range(count.value):
            dev = ctypes.c_void_p(devices[i])
            pwsz, length = ctypes.c_wchar_p(), wintypes.UINT(0)
            get_str = _vcall(
                dev,
                _GET_ALLOCATED_STRING,
                ctypes.c_long,
                ctypes.POINTER(_GUID),
                ctypes.POINTER(ctypes.c_wchar_p),
                ctypes.POINTER(wintypes.UINT),
            )
            if get_str(dev, ctypes.byref(name_key), ctypes.byref(pwsz), ctypes.byref(length)) >= 0:
                names.append(pwsz.value or f"Camera {i}")
                ole32.CoTaskMemFree(pwsz)
            else:
                names.append(f"Camera {i}")
            _vcall(dev, _RELEASE, wintypes.ULONG)(dev)
        return names
    except Exception as e:  # never let name lookup break camera listing
        logger.warning("MSMF device enumeration failed: %s", e)
        return None
    finally:
        if devices:
            ole32.CoTaskMemFree(devices)
        if attrs:
            _vcall(attrs, _RELEASE, wintypes.ULONG)(attrs)
        mfplat.MFShutdown()
