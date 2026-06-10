from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


CONFIG_PATH_ENV = "LELAB_SEEED_CLOUD_CONFIG_PATH"
DEFAULT_API_URL = "https://sensecraft-gpu.seeed.cc/api"
DEFAULT_WEB_URL = "https://sensecraft-gpu.seeed.cc"


@dataclass(frozen=True)
class SeeedCloudConfig:
    api_url: str = ""
    web_url: str = ""
    token: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.api_url and self.token)

    def public_dict(self) -> dict[str, str | bool]:
        return {
            "configured": self.configured,
            "api_url": self.api_url,
            "web_url": self.web_url,
        }


def config_path() -> Path:
    override = os.environ.get(CONFIG_PATH_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".config" / "lelab" / "seeed-cloud.json"


def load_config() -> SeeedCloudConfig:
    path = config_path()
    if not path.exists():
        return SeeedCloudConfig(
            api_url=os.environ.get("SEEED_CLOUD_API_URL", "").strip(),
            web_url=os.environ.get("SEEED_CLOUD_WEB_URL", "").strip(),
            token=os.environ.get("SEEED_CLOUD_TOKEN", "").strip(),
        )
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return SeeedCloudConfig()
    if not isinstance(data, dict):
        return SeeedCloudConfig()
    return SeeedCloudConfig(
        api_url=str(data.get("api_url") or "").strip(),
        web_url=str(data.get("web_url") or "").strip(),
        token=str(data.get("token") or "").strip(),
    )


def save_config(*, api_url: str, token: str, web_url: str = "") -> SeeedCloudConfig:
    cfg = SeeedCloudConfig(
        api_url=api_url.strip() or DEFAULT_API_URL,
        web_url=web_url.strip() or DEFAULT_WEB_URL,
        token=token.strip(),
    )
    if not cfg.token:
        raise ValueError("token is required")

    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "api_url": cfg.api_url,
                "web_url": cfg.web_url,
                "token": cfg.token,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return cfg
