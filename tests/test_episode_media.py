# Copyright 2026 Vibe Embodied AI Inc. and The HuggingFace Inc. team. All rights reserved.
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
"""Tests for lelab.episode_media — on-disk layout reads and frame decoding.

Builds a real (tiny) LeRobot v3.0 dataset on disk — a genuine mp4 encoded with
PyAV plus the parquet metadata — rather than mocking the readers. The whole
point of this module is that it agrees with the on-disk format, which a mock
cannot check.
"""

from __future__ import annotations

from pathlib import Path

import pytest


def _write_dataset(
    root: Path,
    repo_id: str,
    *,
    episodes: list[tuple[int, int]],  # (episode_index, length)
    cameras: tuple[str, ...] = ("top", "wrist"),
    fps: int = 10,
    dof: int = 3,
    packed: bool = True,
) -> Path:
    """Write a minimal but real v3.0 dataset. Returns its directory.

    ``packed=True`` puts every episode in one mp4 with from/to windows (the
    modern layout); ``packed=False`` omits the windows so the fallback path is
    exercised.
    """
    import av
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as pq

    d = root / repo_id
    (d / "meta" / "episodes" / "chunk-000").mkdir(parents=True)
    (d / "data" / "chunk-000").mkdir(parents=True)

    features = {f"observation.images.{c}": {"dtype": "video", "shape": [24, 32, 3]} for c in cameras}
    features["action"] = {"dtype": "float32", "shape": [dof]}
    (d / "meta" / "info.json").write_text(
        __import__("json").dumps(
            {
                "codebase_version": "v3.0",
                "fps": fps,
                "robot_type": "test_follower",
                "total_episodes": len(episodes),
                "total_frames": sum(n for _, n in episodes),
                "features": features,
            }
        )
    )

    total = sum(n for _, n in episodes)
    for cam in cameras:
        vdir = d / "videos" / f"observation.images.{cam}" / "chunk-000"
        vdir.mkdir(parents=True)
        with av.open(str(vdir / "file-000.mp4"), "w") as c:
            s = c.add_stream("libx264", rate=fps)
            s.width, s.height, s.pix_fmt = 32, 24, "yuv420p"
            for i in range(total):
                # A per-frame ramp so a decoded frame is identifiable.
                img = np.full((24, 32, 3), (i * 3) % 256, dtype=np.uint8)
                c.mux(s.encode(av.VideoFrame.from_ndarray(img, format="rgb24")))
            c.mux(s.encode(None))

    # Episode metadata: windows laid end to end, matching how episodes are packed.
    meta: dict[str, list] = {"episode_index": [], "length": [], "tasks": []}
    for cam in cameras:
        meta[f"videos/observation.images.{cam}/chunk_index"] = []
        meta[f"videos/observation.images.{cam}/file_index"] = []
        if packed:
            meta[f"videos/observation.images.{cam}/from_timestamp"] = []
            meta[f"videos/observation.images.{cam}/to_timestamp"] = []
    meta["data/chunk_index"] = []
    meta["data/file_index"] = []

    cursor = 0.0
    for ep, n in episodes:
        meta["episode_index"].append(ep)
        meta["length"].append(n)
        meta["tasks"].append(["do the thing"])
        meta["data/chunk_index"].append(0)
        meta["data/file_index"].append(0)
        for cam in cameras:
            meta[f"videos/observation.images.{cam}/chunk_index"].append(0)
            meta[f"videos/observation.images.{cam}/file_index"].append(0)
            if packed:
                meta[f"videos/observation.images.{cam}/from_timestamp"].append(cursor)
                meta[f"videos/observation.images.{cam}/to_timestamp"].append(cursor + n / fps)
        cursor += n / fps
    pq.write_table(pa.table(meta), d / "meta" / "episodes" / "chunk-000" / "file-000.parquet")

    # Frames: a per-joint ramp so motion is a known constant.
    ep_col, act_col = [], []
    for ep, n in episodes:
        for i in range(n):
            ep_col.append(ep)
            act_col.append([float(i)] * dof)
    pq.write_table(
        pa.table({"episode_index": ep_col, "action": act_col}),
        d / "data" / "chunk-000" / "file-000.parquet",
    )
    return d


@pytest.fixture
def dataset(tmp_lerobot_home: Path) -> str:
    _write_dataset(tmp_lerobot_home, "acme/demo", episodes=[(0, 12), (1, 8), (2, 15)])
    return "acme/demo"


# ── dataset resolution ──────────────────────────────────────────────────────


def test_resolve_dataset_dir_rejects_traversal(tmp_lerobot_home: Path) -> None:
    from lelab.episode_media import DatasetNotFoundError, resolve_dataset_dir

    with pytest.raises(DatasetNotFoundError):
        resolve_dataset_dir("../../../etc")


def test_resolve_dataset_dir_rejects_root_itself(tmp_lerobot_home: Path) -> None:
    from lelab.episode_media import DatasetNotFoundError, resolve_dataset_dir

    with pytest.raises(DatasetNotFoundError):
        resolve_dataset_dir(".")


def test_resolve_dataset_dir_rejects_non_dataset(tmp_lerobot_home: Path) -> None:
    from lelab.episode_media import DatasetNotFoundError, resolve_dataset_dir

    (tmp_lerobot_home / "not-a-dataset").mkdir()
    with pytest.raises(DatasetNotFoundError):
        resolve_dataset_dir("not-a-dataset")


def test_list_cameras_only_returns_video_features(dataset: str) -> None:
    from lelab.episode_media import list_cameras, resolve_dataset_dir

    # `action` is a feature too, but it isn't a video and must not appear.
    assert list_cameras(resolve_dataset_dir(dataset)) == ["top", "wrist"]


# ── episode index ───────────────────────────────────────────────────────────


def test_read_episode_index_duration_is_length_over_fps(dataset: str) -> None:
    from lelab.episode_media import read_episode_index, resolve_dataset_dir

    rows = read_episode_index(resolve_dataset_dir(dataset))
    assert [r.episode_idx for r in rows] == [0, 1, 2]
    assert [r.length for r in rows] == [12, 8, 15]
    assert [r.duration_s for r in rows] == [1.2, 0.8, 1.5]
    assert rows[0].tasks == ("do the thing",)


def test_read_episode_index_prefers_length_over_video_window(tmp_lerobot_home: Path) -> None:
    """An early-accepted episode's window over-reports the demonstration.

    The window says 5s because that's how long the camera ran; the parquet says
    10 frames at 10fps = 1s, which is the honest duration. Length must win.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    from lelab.episode_media import read_episode_index, resolve_dataset_dir

    d = _write_dataset(tmp_lerobot_home, "acme/early", episodes=[(0, 10)], cameras=("top",))
    meta_path = d / "meta" / "episodes" / "chunk-000" / "file-000.parquet"
    t = pq.read_table(meta_path).to_pydict()
    t["videos/observation.images.top/to_timestamp"] = [5.0]  # camera ran 5s
    pq.write_table(pa.table(t), meta_path)

    row = read_episode_index(resolve_dataset_dir("acme/early"))[0]
    assert row.duration_s == 1.0  # not 5.0
    assert row.to_timestamp == 5.0  # window still exposed for the transport


def test_read_episode_index_empty_when_meta_missing(tmp_lerobot_home: Path) -> None:
    from lelab.episode_media import read_episode_index

    d = tmp_lerobot_home / "bare"
    (d / "meta").mkdir(parents=True)
    (d / "meta" / "info.json").write_text("{}")
    assert read_episode_index(d) == []


# ── video location ──────────────────────────────────────────────────────────


def test_locate_episode_video_resolves_window(dataset: str) -> None:
    from lelab.episode_media import locate_episode_video, resolve_dataset_dir

    d = resolve_dataset_dir(dataset)
    # Episode 1 follows episode 0 (12 frames @10fps = 1.2s) in the same file.
    loc = locate_episode_video(d, 1, camera="top")
    assert loc.path.name == "file-000.mp4"
    assert loc.from_timestamp == pytest.approx(1.2)
    assert loc.to_timestamp == pytest.approx(2.0)
    assert loc.fps == 10


def test_locate_episode_video_unknown_camera(dataset: str) -> None:
    from lelab.episode_media import EpisodeNotFoundError, locate_episode_video, resolve_dataset_dir

    with pytest.raises(EpisodeNotFoundError):
        locate_episode_video(resolve_dataset_dir(dataset), 0, camera="nope")


def test_locate_episode_video_missing_episode(dataset: str) -> None:
    from lelab.episode_media import EpisodeNotFoundError, locate_episode_video, resolve_dataset_dir

    with pytest.raises(EpisodeNotFoundError):
        locate_episode_video(resolve_dataset_dir(dataset), 99)


def test_locate_episode_video_defaults_to_first_camera(dataset: str) -> None:
    from lelab.episode_media import locate_episode_video, resolve_dataset_dir

    assert locate_episode_video(resolve_dataset_dir(dataset), 0).camera == "top"


def test_locate_falls_back_to_unpacked_layout(tmp_lerobot_home: Path) -> None:
    """Older datasets carry no from/to window: the episode is the whole file."""
    from lelab.episode_media import locate_episode_video, resolve_dataset_dir

    _write_dataset(tmp_lerobot_home, "acme/old", episodes=[(0, 6)], cameras=("top",), packed=False)
    loc = locate_episode_video(resolve_dataset_dir("acme/old"), 0, camera="top")
    assert loc.from_timestamp is None
    assert loc.to_timestamp is None
    assert loc.path.exists()


# ── decoding ────────────────────────────────────────────────────────────────


def test_extract_frame_png_returns_a_png(dataset: str) -> None:
    from lelab.episode_media import extract_frame_png, locate_episode_video, resolve_dataset_dir

    loc = locate_episode_video(resolve_dataset_dir(dataset), 0, camera="top")
    png = extract_frame_png(loc, 3)
    assert png[:4] == b"\x89PNG"


def test_extract_frame_png_respects_max_width(dataset: str) -> None:
    import io

    from PIL import Image

    from lelab.episode_media import extract_frame_png, locate_episode_video, resolve_dataset_dir

    loc = locate_episode_video(resolve_dataset_dir(dataset), 0, camera="top")
    img = Image.open(io.BytesIO(extract_frame_png(loc, 0, max_width=16)))
    assert img.width == 16
    assert img.height == 12  # 32x24 halved, aspect preserved


def test_extract_frame_decodes_inside_the_right_episode(dataset: str) -> None:
    """Frame 0 of episode 1 must not be frame 0 of the file.

    Each frame carries a distinct grey level, so decoding the wrong window
    yields a visibly different pixel — this is the check that the from_timestamp
    offset is actually applied.
    """
    import io

    from PIL import Image

    from lelab.episode_media import extract_frame_png, locate_episode_video, resolve_dataset_dir

    d = resolve_dataset_dir(dataset)
    ep0 = Image.open(io.BytesIO(extract_frame_png(locate_episode_video(d, 0, camera="top"), 0)))
    ep1 = Image.open(io.BytesIO(extract_frame_png(locate_episode_video(d, 1, camera="top"), 0)))
    # Episode 1 starts 12 frames into the file; its first frame is a later ramp
    # value than episode 0's. Lossy encoding blurs exact values, so compare with
    # tolerance rather than equality.
    assert abs(ep0.getpixel((16, 12))[0] - ep1.getpixel((16, 12))[0]) > 10


def test_extract_thumbnails_one_pass(dataset: str) -> None:
    from lelab.episode_media import extract_thumbnails, locate_episode_video, resolve_dataset_dir

    loc = locate_episode_video(resolve_dataset_dir(dataset), 0, camera="top")
    thumbs = extract_thumbnails(loc, [0, 4, 8], max_width=16)
    # (frame_index, png) pairs, each index bound to its own image.
    assert [idx for idx, _ in thumbs] == [0, 4, 8]
    assert all(png[:4] == b"\x89PNG" for _, png in thumbs)


def test_extract_thumbnails_empty_request(dataset: str) -> None:
    from lelab.episode_media import extract_thumbnails, locate_episode_video, resolve_dataset_dir

    loc = locate_episode_video(resolve_dataset_dir(dataset), 0, camera="top")
    assert extract_thumbnails(loc, []) == []


def test_extract_thumbnails_keeps_index_when_a_frame_drops(
    dataset: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A mid-strip decode failure must not shift later tiles onto wrong frames.

    Simulate a corrupt recording where one requested frame won't decode: the
    surviving thumbnails have to keep their true frame indices, not slide up to
    fill the gap. Because the index rides with the png, the dropped frame simply
    goes missing instead of relabelling everything after it.
    """
    import lelab.episode_media as em

    loc = em.locate_episode_video(em.resolve_dataset_dir(dataset), 0, camera="top")

    real_decode = em._decode_at
    calls = {"n": 0}

    def flaky_decode(container, stream, target_s):
        # Fail the second requested frame only.
        calls["n"] += 1
        if calls["n"] == 2:
            return None
        return real_decode(container, stream, target_s)

    monkeypatch.setattr(em, "_decode_at", flaky_decode)

    thumbs = em.extract_thumbnails(loc, [0, 4, 8], max_width=16)
    # Frame 4 dropped; 0 and 8 survive with their real indices — 8 is NOT
    # relabelled as 4.
    assert [idx for idx, _ in thumbs] == [0, 8]
    assert all(png[:4] == b"\x89PNG" for _, png in thumbs)


# ── action stream / motion ──────────────────────────────────────────────────


def test_load_episode_actions_filters_to_the_episode(dataset: str) -> None:
    from lelab.episode_media import load_episode_actions, resolve_dataset_dir

    d = resolve_dataset_dir(dataset)
    assert len(load_episode_actions(d, 0)) == 12
    assert len(load_episode_actions(d, 1)) == 8
    assert load_episode_actions(d, 1)[0] == [0.0, 0.0, 0.0]


def test_motion_trace_shape_and_values(dataset: str) -> None:
    from lelab.episode_media import episode_motion_trace, resolve_dataset_dir

    trace = episode_motion_trace(resolve_dataset_dir(dataset), 0)
    assert len(trace) == 12  # one value per frame
    assert trace[0] == 0.0  # frame 0 has no predecessor
    # Each joint steps by 1 per frame across 3 joints.
    assert trace[1] == pytest.approx(3.0)


def test_motion_trace_missing_episode(dataset: str) -> None:
    from lelab.episode_media import EpisodeNotFoundError, episode_motion_trace, resolve_dataset_dir

    with pytest.raises(EpisodeNotFoundError):
        episode_motion_trace(resolve_dataset_dir(dataset), 99)
