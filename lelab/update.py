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
"""Notify users when a newer LeLab is available on GitHub.

LeLab installs from git (`pip install git+https://github.com/.../leLab.git`),
so "newer" means the default branch has moved past the installed commit. We
read the installed commit from pip's `direct_url.json` and compare it to the
repo HEAD via the GitHub API. Editable/local clones have no commit_id, so they
are deliberately excluded — developers shouldn't be nagged to update.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import time
import urllib.request
from importlib.metadata import PackageNotFoundError, distribution
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"
_HTTP_TIMEOUT = 5  # seconds — GitHub check must never stall the UI
_CACHE_TTL = 600  # seconds — avoid hammering the GitHub API on every page load

# Cached UpdateStatus dict + monotonic timestamp of when it was computed.
_cache: dict[str, Any] | None = None
_cache_time: float = 0.0


class UpdateStatus(BaseModel):
    update_available: bool
    current_commit: str | None = None
    latest_commit: str | None = None
    commits_behind: int | None = None
    compare_url: str | None = None
    update_command: str | None = None
    can_auto_update: bool = False


class UpdateResult(BaseModel):
    success: bool
    message: str
    output: str = ""


def _parse_github_repo(url: str) -> tuple[str, str] | None:
    """Extract ``(owner, repo)`` from a GitHub clone URL, or None if not GitHub."""
    if not url or "github.com" not in url:
        return None
    u = url.strip().removeprefix("git+")
    if u.startswith("git@"):
        # git@github.com:owner/repo.git
        _, _, path = u.partition(":")
    else:
        # https://github.com/owner/repo(.git)
        path = u.split("github.com", 1)[1].lstrip("/:")
    path = path.removesuffix(".git").strip("/")
    parts = path.split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def get_installed_source() -> dict[str, str] | None:
    """Read the installed git commit and origin repo from pip metadata.

    Returns ``{"commit", "owner", "repo"}`` for a git install, or None for
    editable/local/non-git installs (where there's nothing meaningful to
    compare against).
    """
    try:
        dist = distribution("lelab")
    except PackageNotFoundError:
        return None
    raw = dist.read_text("direct_url.json")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    commit = (data.get("vcs_info") or {}).get("commit_id")
    if not commit:
        return None
    repo = _parse_github_repo(data.get("url", ""))
    if repo is None:
        return None
    owner, name = repo
    return {"commit": commit, "owner": owner, "repo": name}


def _github_json(path: str) -> Any | None:
    """GET a GitHub API path and parse JSON. Any failure returns None (silent)."""
    req = urllib.request.Request(
        f"{GITHUB_API}{path}",
        headers={
            "User-Agent": "lelab-update-check",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except Exception as exc:  # noqa: BLE001 — network check must never raise
        logger.debug("GitHub API call failed for %s: %s", path, exc)
        return None


def _update_command(owner: str, repo: str) -> str:
    return f"pip install --upgrade --force-reinstall git+https://github.com/{owner}/{repo}.git"


def _build_update_cmd(owner: str, repo: str) -> list[str]:
    """Pick the installer for the running Python (uv venvs ship no pip)."""
    target = f"git+https://github.com/{owner}/{repo}.git"
    flags = ["--upgrade", "--force-reinstall", target]
    if shutil.which("uv"):
        return ["uv", "pip", "install", "--python", sys.executable, *flags]
    return [sys.executable, "-m", "pip", "install", *flags]


def _compute_status() -> dict[str, Any]:
    source = get_installed_source()
    if source is None:
        return UpdateStatus(update_available=False).model_dump()

    current = source["commit"]
    owner, repo = source["owner"], source["repo"]
    base = UpdateStatus(
        update_available=False,
        current_commit=current,
        update_command=_update_command(owner, repo),
        can_auto_update=True,
    )

    head = _github_json(f"/repos/{owner}/{repo}/commits/HEAD")
    latest = head.get("sha") if isinstance(head, dict) else None
    if not latest:
        return base.model_dump()  # GitHub unreachable — stay silent

    base.latest_commit = latest
    if latest == current:
        base.commits_behind = 0
        return base.model_dump()

    compare = _github_json(f"/repos/{owner}/{repo}/compare/{current}...{latest}")
    if isinstance(compare, dict):
        base.commits_behind = compare.get("ahead_by")
        base.compare_url = compare.get("html_url")
    base.update_available = True
    return base.model_dump()


def check_for_update(force: bool = False) -> dict[str, Any]:
    """Return the cached update status, refreshing past the TTL or when forced."""
    global _cache, _cache_time
    now = time.monotonic()
    if not force and _cache is not None and (now - _cache_time) < _CACHE_TTL:
        return _cache
    _cache = _compute_status()
    _cache_time = now
    return _cache


def handle_update_check() -> dict[str, Any]:
    return check_for_update()


def handle_run_update() -> UpdateResult:
    """Run the pip upgrade in-process (best-effort). User must restart after."""
    source = get_installed_source()
    if source is None:
        return UpdateResult(
            success=False,
            message="This install can't auto-update (editable or non-git). "
            "Update it the way you installed it.",
        )
    try:
        proc = subprocess.run(
            _build_update_cmd(source["owner"], source["repo"]),
            capture_output=True,
            text=True,
            timeout=600,
        )
    except Exception as exc:  # noqa: BLE001 — surface failure to the UI
        logger.exception("Auto-update subprocess failed")
        return UpdateResult(success=False, message=f"Update failed: {exc}")

    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0:
        global _cache
        _cache = None  # bust cache so the next check reflects the new install
        return UpdateResult(
            success=True,
            message="Updated. Restart lelab to apply the new version.",
            output=output,
        )
    return UpdateResult(
        success=False,
        message="Update failed. See the output, or run the command manually.",
        output=output,
    )
