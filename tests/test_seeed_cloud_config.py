from __future__ import annotations

import json

from fastapi.testclient import TestClient


def test_seeed_cloud_config_api_persists_local_connection(monkeypatch, tmp_path) -> None:
    from lelab import server

    config_path = tmp_path / "seeed-cloud.json"
    monkeypatch.setenv("LELAB_SEEED_CLOUD_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "lelab.compute_providers.get_compute_provider",
        lambda provider_id: type(
            "Provider",
            (),
            {"auth_status": lambda self: (False, "invalid or expired token"), "is_configured": lambda self: True},
        )(),
    )

    client = TestClient(server.app)
    response = client.post(
        "/compute/seeed-cloud/config",
        json={
            "api_url": "https://gpu.example.com/api",
            "web_url": "https://gpu.example.com",
            "token": "token-123",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "authenticated": False,
        "auth_error": "invalid or expired token",
        "api_url": "https://gpu.example.com/api",
        "web_url": "https://gpu.example.com",
    }
    assert json.loads(config_path.read_text()) == {
        "api_url": "https://gpu.example.com/api",
        "web_url": "https://gpu.example.com",
        "token": "token-123",
    }

    saved = client.get("/compute/seeed-cloud/config")
    assert saved.status_code == 200
    assert saved.json() == {
        "configured": True,
        "authenticated": False,
        "auth_error": "invalid or expired token",
        "api_url": "https://gpu.example.com/api",
        "web_url": "https://gpu.example.com",
    }


def test_seeed_cloud_config_api_uses_env_defaults_without_saved_file(monkeypatch, tmp_path) -> None:
    from lelab import server

    monkeypatch.setenv("LELAB_SEEED_CLOUD_CONFIG_PATH", str(tmp_path / "missing.json"))
    monkeypatch.setenv("SEEED_CLOUD_API_URL", "http://127.0.0.1:5173/api")
    monkeypatch.setenv("SEEED_CLOUD_WEB_URL", "http://127.0.0.1:5173")
    monkeypatch.delenv("SEEED_CLOUD_TOKEN", raising=False)
    monkeypatch.setattr(
        "lelab.compute_providers.get_compute_provider",
        lambda provider_id: type(
            "Provider",
            (),
            {"auth_status": lambda self: (False, "missing token"), "is_configured": lambda self: False},
        )(),
    )

    client = TestClient(server.app)
    response = client.get("/compute/seeed-cloud/config")

    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "authenticated": False,
        "auth_error": "missing token",
        "api_url": "http://127.0.0.1:5173/api",
        "web_url": "http://127.0.0.1:5173",
    }
