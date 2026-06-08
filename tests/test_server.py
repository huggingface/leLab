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
"""Tests for lelab.server — FastAPI app and ConnectionManager."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

# A browser sends an Accept header that prefers HTML on navigations/hard-reloads.
BROWSER_ACCEPT = {"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

REQUIRED_PATHS = {
    "/health",
    "/get-configs",
    "/move-arm",
    "/stop-teleoperation",
    "/teleoperation-status",
    "/joint-positions",
    "/start-recording",
    "/stop-recording",
    "/recording-status",
    "/start-calibration",
    "/stop-calibration",
    "/calibration-status",
    "/datasets",
    "/jobs",
    "/available-ports",
    "/available-cameras",
    "/hf-auth-status",
    "/ws/joint-data",
}


def test_app_exposes_required_endpoints() -> None:
    from lelab.server import app

    paths = {route.path for route in app.routes}
    missing = REQUIRED_PATHS - paths
    assert not missing, f"missing routes: {missing}"


def test_health_endpoint_returns_200(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200


def test_health_endpoint_returns_dict(client: TestClient) -> None:
    response = client.get("/health")
    body = response.json()
    assert isinstance(body, dict)


def test_unknown_route_returns_404(client: TestClient) -> None:
    response = client.get("/this-does-not-exist")
    assert response.status_code == 404


@pytest.mark.parametrize("unsafe_name", ["evil..name", "..config", "back\\door"])
def test_delete_calibration_config_rejects_unsafe_name(client: TestClient, unsafe_name: str) -> None:
    """A config name with path-traversal characters is rejected before any
    filesystem access — distinct from the "not found" path, so the guard is
    proven to fire. The validator also blocks "/" and "\\"."""
    response = client.delete(f"/calibration-configs/teleop/{unsafe_name}")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "Invalid configuration name" in body["message"]


def _spa_mounted(client: TestClient) -> bool:
    return any(getattr(route, "name", None) == "frontend" for route in client.app.routes)


def test_spa_deep_link_serves_index_html(client: TestClient) -> None:
    """A browser hard-reload of a client-side route returns the SPA shell, not a 404."""
    if not _spa_mounted(client):
        pytest.skip("frontend/dist not built; SPA not mounted")
    response = client.get("/recording", headers=BROWSER_ACCEPT)
    assert response.status_code == 200
    assert response.text.lstrip().lower().startswith("<!doctype html")


def test_spa_fallback_does_not_mask_api_404(client: TestClient) -> None:
    """Non-HTML clients (XHR, curl, API typos) still get a real 404, not the SPA shell."""
    response = client.get("/recording", headers={"accept": "application/json"})
    assert response.status_code == 404


def test_spa_fallback_respects_explicit_html_refusal(client: TestClient) -> None:
    """`text/html;q=0` is an explicit refusal — it must not get the SPA shell."""
    response = client.get("/recording", headers={"accept": "application/json,text/html;q=0"})
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("accept", "expected"),
    [
        ("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", True),
        ("text/html", True),
        ("text/html;q=0.5", True),
        ("application/json", False),
        ("*/*", False),
        ("", False),
        ("text/html;q=0", False),
        ("application/json,text/html;q=0", False),
        ("text/html;q=bogus", False),
    ],
)
def test_accepts_html(accept: str, expected: bool) -> None:
    from lelab.server import _accepts_html

    assert _accepts_html(accept) is expected


def test_connection_manager_tracks_connect_and_disconnect() -> None:
    from lelab.server import ConnectionManager

    mgr = ConnectionManager()
    fake_ws = MagicMock()
    fake_ws.accept = AsyncMock()

    import asyncio

    asyncio.run(mgr.connect(fake_ws))
    assert fake_ws in mgr.active_connections

    mgr.disconnect(fake_ws)
    assert fake_ws not in mgr.active_connections


def test_connection_manager_broadcast_sync_does_not_block_without_loop() -> None:
    from lelab.server import ConnectionManager

    mgr = ConnectionManager()
    # Should enqueue without raising even if there are no consumers.
    mgr.broadcast_joint_data_sync({"shoulder_pan.pos": 1.0})


def _install_fake_pygrabber(monkeypatch: pytest.MonkeyPatch, filter_graph_cls) -> None:
    import sys
    import types

    module = types.ModuleType("pygrabber.dshow_graph")
    module.FilterGraph = filter_graph_cls
    monkeypatch.setitem(sys.modules, "pygrabber", types.ModuleType("pygrabber"))
    monkeypatch.setitem(sys.modules, "pygrabber.dshow_graph", module)


def test_windows_cameras_uses_real_directshow_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Windows path returns pygrabber's real device names in index order so
    the frontend can match each camera to its browser deviceId (issues #12/#16).
    """
    from lelab import server

    class _FakeGraph:
        def get_input_devices(self) -> list[str]:
            return ["USB2.0_CAM1", "ASUS FHD webcam"]

    _install_fake_pygrabber(monkeypatch, _FakeGraph)

    assert server._windows_cameras() == [
        {"index": 0, "name": "USB2.0_CAM1", "available": True},
        {"index": 1, "name": "ASUS FHD webcam", "available": True},
    ]


def test_windows_cameras_falls_back_when_pygrabber_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If pygrabber is missing or its COM init fails, enumeration degrades to the
    generic cv2 probe instead of erroring."""
    from lelab import server

    class _BoomGraph:
        def __init__(self) -> None:
            raise RuntimeError("DirectShow/COM unavailable")

    _install_fake_pygrabber(monkeypatch, _BoomGraph)
    sentinel = [{"index": 0, "name": "Camera 0", "available": True}]
    monkeypatch.setattr(server, "_generic_cv2_cameras", lambda backend: sentinel)

    assert server._windows_cameras() == sentinel


def test_v4l2_camera_name_reads_sysfs(monkeypatch: pytest.MonkeyPatch) -> None:
    import io

    from lelab import server

    monkeypatch.setattr("builtins.open", lambda *a, **k: io.StringIO("HD Pro Webcam C920\n"))
    assert server._v4l2_camera_name(0) == "HD Pro Webcam C920"


def test_v4l2_camera_name_returns_none_when_missing() -> None:
    from lelab import server

    # No such sysfs node (also the case on non-Linux): graceful None, not error.
    assert server._v4l2_camera_name(999999) is None


def test_import_model_route_returns_record(client, monkeypatch) -> None:
    from lelab import server

    fake = {
        "id": "act_imported_x",
        "name": "Imported · model",
        "state": "done",
        "config": {"dataset_repo_id": "(imported)", "policy_type": "act"},
        "output_dir": "/tmp/model",
        "started_at": 1.0,
        "ended_at": 1.0,
        "runner": "imported",
        "hf_repo_id": None,
    }
    from lelab.jobs import JobRecord

    monkeypatch.setattr(
        server.job_registry,
        "register_imported",
        lambda source, name=None: JobRecord(**fake),
    )
    resp = client.post("/jobs/import", json={"source": "/tmp/model"})
    assert resp.status_code == 201
    assert resp.json()["runner"] == "imported"


def test_import_model_route_maps_value_error_to_400(client, monkeypatch) -> None:
    from lelab import server

    def boom(source, name=None):
        raise ValueError("No usable model at '/tmp/x'")

    monkeypatch.setattr(server.job_registry, "register_imported", boom)
    resp = client.post("/jobs/import", json={"source": "/tmp/x"})
    assert resp.status_code == 400
    assert "No usable model" in resp.json()["detail"]
