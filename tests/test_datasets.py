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
"""Tests for lelab.datasets — local cache walk, merge logic, episode browsing."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from .test_episode_media import _write_dataset


@pytest.fixture
def browsable_dataset(tmp_lerobot_home: Path) -> str:
    """A real v3.0 dataset on disk: 3 episodes, 2 cameras, 10fps."""
    _write_dataset(tmp_lerobot_home, "acme/demo", episodes=[(0, 12), (1, 8), (2, 15)])
    return "acme/demo"


def _make_dataset(root: Path, repo_id: str) -> None:
    """Create the minimal layout `_is_dataset_dir` recognizes."""
    d = root / repo_id
    (d / "meta").mkdir(parents=True)
    (d / "meta" / "info.json").write_text("{}")


def test_list_local_datasets_empty_when_root_missing(
    tmp_lerobot_home: Path,
) -> None:
    # tmp_lerobot_home creates the cache; remove it so the function sees the
    # "missing root" branch.
    import shutil

    from lelab.datasets import list_local_datasets

    shutil.rmtree(tmp_lerobot_home)
    assert list_local_datasets() == []


def test_list_local_datasets_finds_top_level_dataset(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.datasets import list_local_datasets

    _make_dataset(tmp_lerobot_home, "pusht")
    result = list_local_datasets()
    repo_ids = [d["repo_id"] for d in result]
    assert "pusht" in repo_ids


def test_list_local_datasets_finds_nested_user_dataset(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.datasets import list_local_datasets

    _make_dataset(tmp_lerobot_home, "alice/pusht")
    result = list_local_datasets()
    repo_ids = [d["repo_id"] for d in result]
    assert "alice/pusht" in repo_ids


def test_list_local_datasets_skips_non_dataset_dirs(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.datasets import list_local_datasets

    (tmp_lerobot_home / "calibration").mkdir(exist_ok=True)
    (tmp_lerobot_home / "ports").mkdir(exist_ok=True)
    _make_dataset(tmp_lerobot_home, "real_dataset")

    result = list_local_datasets()
    repo_ids = [d["repo_id"] for d in result]
    assert "real_dataset" in repo_ids
    assert "calibration" not in repo_ids
    assert "ports" not in repo_ids


def test_list_user_datasets_returns_empty_when_not_logged_in(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.datasets import list_user_datasets

    with patch("lelab.datasets.cached_whoami", return_value=None):
        assert list_user_datasets() == []


def test_list_all_datasets_merges_hub_and_local(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.datasets import list_all_datasets

    _make_dataset(tmp_lerobot_home, "alice/pusht")

    with patch(
        "lelab.datasets.list_user_datasets",
        return_value=[
            {"repo_id": "alice/pusht", "last_modified": "2026-01-01T00:00:00Z", "private": False},
            {"repo_id": "alice/aloha", "last_modified": "2026-02-01T00:00:00Z", "private": True},
        ],
    ):
        result = list_all_datasets()

    by_id = {d["repo_id"]: d for d in result}
    assert by_id["alice/pusht"]["source"] == "both"
    assert by_id["alice/aloha"]["source"] == "hub"


# ── episode browsing ────────────────────────────────────────────────────────
#
# The handlers are covered end-to-end through the routes, so the query-param
# contract and the 404 mapping for binary endpoints are checked too. The
# dataset fixture builds a real v3.0 layout (see tests/test_episode_media.py).


def test_list_episodes_unknown_dataset(client: TestClient, tmp_lerobot_home: Path) -> None:
    r = client.get("/dataset-episodes", params={"repo_id": "nope/nope"})
    assert r.status_code == 200
    assert r.json()["success"] is False


def test_list_episodes_returns_rows(client: TestClient, browsable_dataset: str) -> None:
    r = client.get("/dataset-episodes", params={"repo_id": browsable_dataset})
    body = r.json()
    assert body["success"] is True
    assert body["fps"] == 10
    assert body["cameras"] == ["top", "wrist"]
    assert [e["episode_index"] for e in body["episodes"]] == [0, 1, 2]


def test_episode_detail_reports_neighbours(client: TestClient, browsable_dataset: str) -> None:
    r = client.get("/dataset-episode", params={"repo_id": browsable_dataset, "episode_index": 1})
    body = r.json()
    assert body["success"] is True
    assert body["prev_episode"] == 0
    assert body["next_episode"] == 2
    assert {c["name"] for c in body["cameras"]} == {"top", "wrist"}


def test_episode_detail_unknown_episode(client: TestClient, browsable_dataset: str) -> None:
    r = client.get("/dataset-episode", params={"repo_id": browsable_dataset, "episode_index": 99})
    assert r.status_code == 200
    assert r.json()["success"] is False


def test_frame_route_returns_png(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-frame",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "frame_index": 2},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:4] == b"\x89PNG"


def test_frame_route_404s_on_traversal(client: TestClient, tmp_lerobot_home: Path) -> None:
    r = client.get("/dataset-frame", params={"repo_id": "../../etc", "episode_index": 0})
    assert r.status_code == 404


def test_frame_route_404s_on_unknown_episode(client: TestClient, browsable_dataset: str) -> None:
    r = client.get("/dataset-frame", params={"repo_id": browsable_dataset, "episode_index": 99})
    assert r.status_code == 404


def test_frame_route_404s_past_episode_end(client: TestClient, browsable_dataset: str) -> None:
    """Episodes are packed back to back in one mp4, so an out-of-range frame
    index decodes *cleanly* — into the next episode's footage. It must 404,
    not quietly serve a neighbour's frame with a 200."""
    # Episode 0 has 12 frames (0..11). Frame 14 would land on episode 1's
    # footage; the huge and negative indices are the fuzzing cases.
    for bad in (12, 14, 10_000_000, -1):
        r = client.get(
            "/dataset-frame",
            params={
                "repo_id": browsable_dataset,
                "episode_index": 0,
                "camera": "top",
                "frame_index": bad,
            },
        )
        assert r.status_code == 404, f"frame_index={bad} must 404, got {r.status_code}"

    # The boundary itself still works: the last real frame decodes.
    r = client.get(
        "/dataset-frame",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "frame_index": 11},
    )
    assert r.status_code == 200
    assert r.content[:4] == b"\x89PNG"


def test_frame_route_404s_past_end_without_a_usable_length(
    client: TestClient, browsable_dataset: str, tmp_lerobot_home: Path
) -> None:
    """A row with no usable ``length`` never reaches the route's length check;
    the video window must still bound the decode."""
    import pyarrow.parquet as pq

    p = tmp_lerobot_home / browsable_dataset / "meta" / "episodes" / "chunk-000" / "file-000.parquet"
    pq.write_table(pq.read_table(p).drop_columns(["length"]), p)

    r = client.get(
        "/dataset-frame",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "frame_index": 14},
    )
    assert r.status_code == 404
    # In-window frames still decode.
    r = client.get(
        "/dataset-frame",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "frame_index": 2},
    )
    assert r.status_code == 200


def test_frame_route_tolerates_nonpositive_max_width(client: TestClient, browsable_dataset: str) -> None:
    for max_width in (0, -5):
        r = client.get(
            "/dataset-frame",
            params={
                "repo_id": browsable_dataset,
                "episode_index": 0,
                "camera": "top",
                "frame_index": 0,
                "max_width": max_width,
            },
        )
        assert r.status_code == 200, f"max_width={max_width} must be a no-op, got {r.status_code}"


def test_frame_route_404s_on_nul_byte_repo_id(client: TestClient) -> None:
    r = client.get("/dataset-frame", params={"repo_id": "acme\x00etc", "episode_index": 0})
    assert r.status_code == 404


def test_video_route_is_inline_and_range_capable(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-video", params={"repo_id": browsable_dataset, "camera": "top", "chunk": 0, "file": 0}
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "video/mp4"
    # "attachment" would make the browser download the file instead of playing it.
    assert "inline" in r.headers["content-disposition"]
    assert r.headers.get("accept-ranges") == "bytes"


def test_video_route_serves_a_range(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-video",
        params={"repo_id": browsable_dataset, "camera": "top", "chunk": 0, "file": 0},
        headers={"Range": "bytes=0-31"},
    )
    assert r.status_code == 206
    assert len(r.content) == 32


def test_video_url_is_shared_by_episodes_in_one_file(client: TestClient, browsable_dataset: str) -> None:
    """Every episode of this dataset lives in one mp4, so they must share a URL.

    The video route is addressed by chunk/file precisely so the player can page
    between episodes without the src changing — an episode-addressed URL would
    hand the browser a new identifier for the same bytes, forcing a reload and
    dropping playback on every switch.
    """
    detail = [
        client.get("/dataset-episode", params={"repo_id": browsable_dataset, "episode_index": i}).json()
        for i in (0, 1, 2)
    ]
    top = [next(c for c in d["cameras"] if c["name"] == "top") for d in detail]
    assert {(c["chunk"], c["file_index"]) for c in top} == {(0, 0)}
    # ...while each still reports its own window inside that shared file.
    assert len({c["from_timestamp"] for c in top}) == 3


def test_video_route_404s_on_unknown_camera(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-video", params={"repo_id": browsable_dataset, "camera": "nope", "chunk": 0, "file": 0}
    )
    assert r.status_code == 404


def test_video_route_404s_on_missing_file(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-video", params={"repo_id": browsable_dataset, "camera": "top", "chunk": 9, "file": 9}
    )
    assert r.status_code == 404


def test_thumbnails_span_the_whole_episode(client: TestClient, browsable_dataset: str) -> None:
    r = client.get(
        "/dataset-thumbnails",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "count": 4},
    )
    body = r.json()
    assert body["success"] is True
    frames = [t["frame_index"] for t in body["thumbnails"]]
    # Episode 0 is 12 frames: the strip must reach the last one, not stop short.
    assert frames[0] == 0
    assert frames[-1] == 11
    assert all(t["data_uri"].startswith("data:image/png;base64,") for t in body["thumbnails"])


def test_thumbnails_clamped_to_episode_length(client: TestClient, browsable_dataset: str) -> None:
    # Episode 1 has 8 frames; asking for 50 must not invent any.
    r = client.get(
        "/dataset-thumbnails",
        params={"repo_id": browsable_dataset, "episode_index": 1, "count": 50},
    )
    assert len(r.json()["thumbnails"]) <= 8


def test_thumbnails_drop_a_bad_frame_without_relabelling(
    client: TestClient, browsable_dataset: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A frame that fails to decode is omitted, not swapped under a wrong label.

    End-to-end guard for the whole strip: on a corrupt recording, a tile must
    never show one frame's image under another frame's number — clicking it
    would seek the player to a position the picture never depicted.
    """
    import lelab.episode_media as em

    real_decode = em._decode_at
    calls = {"n": 0}

    def flaky_decode(container, stream, target_s):
        calls["n"] += 1
        if calls["n"] == 2:  # drop the second requested frame
            return None
        return real_decode(container, stream, target_s)

    monkeypatch.setattr(em, "_decode_at", flaky_decode)

    r = client.get(
        "/dataset-thumbnails",
        params={"repo_id": browsable_dataset, "episode_index": 0, "camera": "top", "count": 4},
    )
    body = r.json()
    assert body["success"] is True
    frames = [t["frame_index"] for t in body["thumbnails"]]
    # One tile missing, the rest keep their true indices and stay sorted — no
    # later frame slides down into the dropped one's slot.
    assert len(frames) == 3
    assert frames == sorted(frames)
    assert frames[-1] == 11  # last frame still labelled 11, not shifted


def test_motion_route_returns_one_value_per_frame(client: TestClient, browsable_dataset: str) -> None:
    r = client.get("/dataset-motion", params={"repo_id": browsable_dataset, "episode_index": 0})
    body = r.json()
    assert body["success"] is True
    assert len(body["motion"]) == 12
    assert body["motion"][0] == 0.0


def test_motion_route_unknown_dataset(client: TestClient, tmp_lerobot_home: Path) -> None:
    r = client.get("/dataset-motion", params={"repo_id": "nope/nope", "episode_index": 0})
    assert r.json()["success"] is False
