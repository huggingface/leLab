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
"""Tests for the GitHub update-notifier module."""

from __future__ import annotations

import json

import pytest

from lelab import update


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test starts with a cold update cache."""
    update._cache = None
    update._cache_time = 0.0
    yield
    update._cache = None
    update._cache_time = 0.0


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://github.com/huggingface/leLab.git", ("huggingface", "leLab")),
        ("https://github.com/huggingface/leLab", ("huggingface", "leLab")),
        ("git+https://github.com/huggingface/leLab.git", ("huggingface", "leLab")),
        ("git@github.com:huggingface/leLab.git", ("huggingface", "leLab")),
        ("https://gitlab.com/foo/bar.git", None),
        ("file:///home/me/leLab", None),
        ("", None),
    ],
)
def test_parse_github_repo(url, expected):
    assert update._parse_github_repo(url) == expected


def _fake_dist(direct_url: dict | None):
    class _Dist:
        def read_text(self, name):
            if name != "direct_url.json" or direct_url is None:
                return None
            return json.dumps(direct_url)

    return _Dist()


def test_installed_source_from_vcs(monkeypatch):
    monkeypatch.setattr(
        update,
        "distribution",
        lambda name: _fake_dist(
            {
                "url": "https://github.com/huggingface/leLab.git",
                "vcs_info": {"vcs": "git", "commit_id": "abc123"},
            }
        ),
    )
    src = update.get_installed_source()
    assert src == {"commit": "abc123", "owner": "huggingface", "repo": "leLab"}


def test_installed_source_editable_returns_none(monkeypatch):
    """Editable / local installs have no commit_id — no nagging developers."""
    monkeypatch.setattr(
        update,
        "distribution",
        lambda name: _fake_dist({"url": "file:///home/me/leLab", "dir_info": {"editable": True}}),
    )
    assert update.get_installed_source() is None


def test_installed_source_no_direct_url_returns_none(monkeypatch):
    monkeypatch.setattr(update, "distribution", lambda name: _fake_dist(None))
    assert update.get_installed_source() is None


def test_check_no_source_means_no_update(monkeypatch):
    monkeypatch.setattr(update, "get_installed_source", lambda: None)
    status = update.check_for_update()
    assert status["update_available"] is False
    assert status["current_commit"] is None


def test_check_up_to_date(monkeypatch):
    monkeypatch.setattr(
        update,
        "get_installed_source",
        lambda: {"commit": "abc123", "owner": "huggingface", "repo": "leLab"},
    )
    monkeypatch.setattr(update, "_github_json", lambda path: {"sha": "abc123"})
    status = update.check_for_update()
    assert status["update_available"] is False
    assert status["latest_commit"] == "abc123"
    assert status["commits_behind"] == 0


def test_check_update_available(monkeypatch):
    monkeypatch.setattr(
        update,
        "get_installed_source",
        lambda: {"commit": "abc123", "owner": "huggingface", "repo": "leLab"},
    )

    def fake_github(path: str):
        if path.endswith("/commits/HEAD"):
            return {"sha": "def456"}
        if "/compare/" in path:
            return {"ahead_by": 7, "html_url": "https://github.com/huggingface/leLab/compare/abc123...def456"}
        return None

    monkeypatch.setattr(update, "_github_json", fake_github)
    status = update.check_for_update()
    assert status["update_available"] is True
    assert status["latest_commit"] == "def456"
    assert status["commits_behind"] == 7
    assert status["compare_url"].endswith("abc123...def456")
    assert "git+https://github.com/huggingface/leLab.git" in status["update_command"]
    assert status["can_auto_update"] is True


def test_check_github_unreachable_is_silent(monkeypatch):
    monkeypatch.setattr(
        update,
        "get_installed_source",
        lambda: {"commit": "abc123", "owner": "huggingface", "repo": "leLab"},
    )
    monkeypatch.setattr(update, "_github_json", lambda path: None)
    status = update.check_for_update()
    assert status["update_available"] is False


def test_run_update_no_source(monkeypatch):
    monkeypatch.setattr(update, "get_installed_source", lambda: None)
    result = update.handle_run_update()
    assert result.success is False
