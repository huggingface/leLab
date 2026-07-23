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
"""Tests for lelab.dataset_repair — rebuilding the episode index of a
recording that was interrupted before `LeRobotDataset.finalize()` ran."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

REPO_ID = "repair_test/session"
EPISODES = 2
FRAMES = 5
FPS = 10


@pytest.fixture
def lerobot_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point LeRobot's dataset cache at a tmp dir.

    HF_LEROBOT_HOME is read from the environment once at import time and then
    copied into the modules that use it, so every binding has to be patched —
    the env var alone is too late by the time a test runs.
    """
    home = tmp_path / "lerobot"
    home.mkdir()
    monkeypatch.setattr("lerobot.utils.constants.HF_LEROBOT_HOME", home)
    monkeypatch.setattr("lerobot.datasets.dataset_metadata.HF_LEROBOT_HOME", home)
    return home


def _record(repo_id: str, *, video: bool, episodes: int = EPISODES) -> Path:
    """Write a small finished dataset and return its root."""
    from lerobot.datasets import LeRobotDataset

    features = {
        "action": {"dtype": "float32", "shape": (2,), "names": ["a", "b"]},
        "observation.state": {"dtype": "float32", "shape": (2,), "names": ["a", "b"]},
    }
    if video:
        features["observation.images.cam"] = {
            "dtype": "video",
            "shape": (32, 32, 3),
            "names": ["h", "w", "c"],
        }

    dataset = LeRobotDataset.create(repo_id, fps=FPS, features=features, use_videos=video)
    for episode in range(episodes):
        for frame in range(FRAMES):
            values = np.full(2, episode * FRAMES + frame, dtype=np.float32)
            item = {"action": values, "observation.state": values, "task": "repair me"}
            if video:
                item["observation.images.cam"] = np.full((32, 32, 3), 100, dtype=np.uint8)
            dataset.add_frame(item)
        dataset.save_episode()
    dataset.finalize()
    return dataset.root


def test_chunk_file_parses_indices_from_path() -> None:
    from lelab.dataset_repair import _chunk_file

    assert _chunk_file(Path("data/chunk-003/file-012.parquet")) == (3, 12)


def test_chunk_file_rejects_unexpected_layout() -> None:
    from lelab.dataset_repair import DatasetRepairError, _chunk_file

    with pytest.raises(DatasetRepairError):
        _chunk_file(Path("data/whatever.parquet"))


def test_absent_dataset_is_left_to_the_normal_hub_path(lerobot_home: Path) -> None:
    from lelab.dataset_repair import repair_local_dataset

    assert repair_local_dataset("someone/never-recorded") is None


def test_readable_dataset_is_not_touched(lerobot_home: Path) -> None:
    from lelab.dataset_repair import repair_local_dataset

    _record(REPO_ID, video=False)

    assert repair_local_dataset(REPO_ID) is None


@pytest.mark.parametrize("repo_id", ["../escape", "repair_test/../../escape", "/etc"])
def test_repo_id_cannot_escape_the_cache_directory(lerobot_home: Path, repo_id: str) -> None:
    from lelab.dataset_repair import DatasetRepairError, repair_local_dataset

    with pytest.raises(DatasetRepairError, match="Invalid dataset id"):
        repair_local_dataset(repo_id)


@pytest.mark.parametrize("video", [False, True])
def test_missing_episode_index_is_rebuilt_from_the_data_files(lerobot_home: Path, video: bool) -> None:
    from lelab.dataset_repair import repair_local_dataset
    from lerobot.datasets import LeRobotDataset

    root = _record(REPO_ID, video=video)
    # What an un-finalized recording leaves behind: frames and videos on disk,
    # no episode index. Loading it in this state is what reaches for the Hub
    # and 404s, so the test never does it — it goes straight to the repair.
    shutil.rmtree(root / "meta" / "episodes")

    message = repair_local_dataset(REPO_ID)
    assert message is not None
    assert f"Recovered {EPISODES} episode(s)" in message

    repaired = LeRobotDataset(REPO_ID)
    assert repaired.num_episodes == EPISODES
    assert repaired.num_frames == EPISODES * FRAMES

    last = repaired[repaired.num_frames - 1]
    assert int(last["episode_index"]) == EPISODES - 1
    assert last["task"] == "repair me"
    np.testing.assert_allclose(last["action"].numpy(), np.full(2, EPISODES * FRAMES - 1))
    if video:
        assert tuple(last["observation.images.cam"].shape) == (3, 32, 32)


def test_repair_is_idempotent(lerobot_home: Path) -> None:
    from lelab.dataset_repair import repair_local_dataset

    root = _record(REPO_ID, video=False)
    shutil.rmtree(root / "meta" / "episodes")

    assert repair_local_dataset(REPO_ID) is not None
    assert repair_local_dataset(REPO_ID) is None


def test_truncated_data_file_is_moved_out_of_the_readers_way(lerobot_home: Path) -> None:
    from lelab.dataset_repair import repair_local_dataset
    from lerobot.datasets import LeRobotDataset

    root = _record(REPO_ID, video=False)
    shutil.rmtree(root / "meta" / "episodes")

    # A file the writer was still appending to when the process died: bytes
    # present, parquet footer missing.
    orphan = root / "data" / "chunk-000" / "file-001.parquet"
    orphan.write_bytes(b"PAR1\x00\x01\x02 no footer here")

    assert repair_local_dataset(REPO_ID) is not None
    assert not orphan.exists()
    assert orphan.with_suffix(".parquet.unreadable").exists()
    assert LeRobotDataset(REPO_ID).num_episodes == EPISODES


def test_episodes_without_video_lose_their_frames_and_stats_too(lerobot_home: Path) -> None:
    """An episode the videos don't cover is dropped from the index, so its rows
    and its contribution to stats.json have to go with it."""
    from lelab.dataset_repair import repair_local_dataset
    from lerobot.datasets import LeRobotDataset

    broken = _record(REPO_ID, video=True, episodes=2)
    # Same recording, one episode shorter: stands in both for the video that
    # was never flushed and for the statistics the repair should end up with.
    reference = _record("repair_test/reference", video=True, episodes=1)

    shutil.rmtree(broken / "meta" / "episodes")
    shutil.copy(
        next((reference / "videos").rglob("*.mp4")),
        next((broken / "videos").rglob("*.mp4")),
    )

    message = repair_local_dataset(REPO_ID)
    assert message is not None
    assert "Recovered 1 episode(s)" in message

    repaired = LeRobotDataset(REPO_ID)
    assert repaired.num_episodes == 1
    assert repaired.num_frames == FRAMES
    # The dropped episode's rows are gone from the shards, not just unreferenced.
    assert len(repaired.hf_dataset) == FRAMES

    repaired_stats = json.loads((broken / "meta" / "stats.json").read_text())
    reference_stats = json.loads((reference / "meta" / "stats.json").read_text())
    assert repaired_stats["action"]["max"] == reference_stats["action"]["max"]
    assert repaired_stats["action"]["mean"] == reference_stats["action"]["mean"]


def test_unrecoverable_dataset_reports_instead_of_hitting_the_hub(lerobot_home: Path) -> None:
    from lelab.dataset_repair import DatasetRepairError, repair_local_dataset

    root = _record(REPO_ID, video=False)
    shutil.rmtree(root / "meta" / "episodes")
    for path in (root / "data").rglob("*.parquet"):
        path.write_bytes(b"PAR1 truncated")

    with pytest.raises(DatasetRepairError, match="Re-record it"):
        repair_local_dataset(REPO_ID)
