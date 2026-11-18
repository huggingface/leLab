"""Windows camera backend override (LELAB_WINDOWS_CAMERA_BACKEND)."""

import pytest

from lelab.utils import camera_backend


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, "DSHOW"), ("MSMF", "MSMF"), ("msmf", "MSMF"), (" dshow ", "DSHOW"), ("bogus", "DSHOW")],
)
def test_backend_name_from_env(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv(camera_backend.ENV_VAR, raising=False)
    else:
        monkeypatch.setenv(camera_backend.ENV_VAR, value)
    assert camera_backend.windows_camera_backend_name() == expected


def test_record_backend_follows_override(monkeypatch):
    from lelab import record
    from lerobot.cameras.configs import Cv2Backends

    monkeypatch.setattr("platform.system", lambda: "Windows")
    monkeypatch.delenv(camera_backend.ENV_VAR, raising=False)
    assert record._platform_backend() == Cv2Backends.DSHOW
    monkeypatch.setenv(camera_backend.ENV_VAR, "MSMF")
    assert record._platform_backend() == Cv2Backends.MSMF


def test_rollout_cameras_arg_pins_msmf(monkeypatch):
    from lelab import rollout

    cams = {"wrist": {"type": "opencv", "camera_index": 0, "width": 640, "height": 480, "fps": 30}}
    monkeypatch.setattr(camera_backend, "windows_uses_msmf", lambda: False)
    assert "backend" not in rollout._format_cameras_arg(cams)
    monkeypatch.setattr(camera_backend, "windows_uses_msmf", lambda: True)
    assert "backend: 1400" in rollout._format_cameras_arg(cams)
    # an explicit per-camera backend wins
    cams["wrist"]["backend"] = 700
    arg = rollout._format_cameras_arg(cams)
    assert "backend: 1400" not in arg


def test_msmf_names_none_off_windows(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Linux")
    assert camera_backend.msmf_camera_names() is None
