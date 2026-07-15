# Copyright 2026 VibeCuisine. All rights reserved.
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

"""Read-only episode media access for local LeRobot datasets.

This is the read half of the dataset browser: it locates the mp4 holding a given
episode/camera and decodes frames out of it. It deliberately reads the on-disk
layout directly (``meta/episodes/*.parquet`` + ``videos/``) rather than going
through ``LeRobotDataset``, so listing and previewing a dataset stays cheap and
never constructs a robot config or touches torch.

Decoding uses PyAV, which already ships with ``lerobot[dataset]``. Frames are
decoded in-process; there is no ffmpeg subprocess.

The layout this understands (LeRobot v3.0)::

    <dataset>/meta/info.json
    <dataset>/meta/episodes/chunk-000/file-000.parquet
    <dataset>/videos/observation.images.<camera>/chunk-000/file-000.mp4

Several episodes usually share one mp4. Each episode's slice of the file is
recorded in the episodes parquet as ``.../from_timestamp`` and
``.../to_timestamp``, so locating an episode means resolving both the file *and*
the time window inside it. Older datasets store one mp4 per episode and carry no
window; :func:`_locate_fallback` covers those.
"""

from __future__ import annotations

import io
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

VIDEO_KEY_PREFIX = "observation.images."


class DatasetNotFoundError(LookupError):
    """No local dataset directory for the requested repo_id."""


class EpisodeNotFoundError(LookupError):
    """The requested episode/camera/frame combination doesn't exist on disk."""


# ── dataset resolution ──────────────────────────────────────────────────────


def lerobot_cache_root() -> Path:
    """Root of the local LeRobot dataset cache.

    Reads the environment at call time rather than importing lerobot's
    ``HF_LEROBOT_HOME`` constant, which is frozen at import. Same source of
    truth as ``datasets._lerobot_cache_root``, and it keeps this module free of
    a torch-pulling import it doesn't otherwise need.
    """
    return Path(os.environ.get("HF_LEROBOT_HOME", "~/.cache/huggingface/lerobot")).expanduser().resolve()


def resolve_dataset_dir(repo_id: str) -> Path:
    """Resolve ``repo_id`` to a local dataset directory.

    Rejects path traversal the same way ``handle_delete_dataset`` does: the
    resolved target must stay strictly inside the cache root. ``repo_id`` comes
    from a query string, so this is load-bearing rather than defensive.
    """
    root = lerobot_cache_root()
    target = (root / repo_id).resolve()
    if target == root or root not in target.parents:
        raise DatasetNotFoundError(f"Invalid dataset path: {repo_id}")
    if not (target / "meta" / "info.json").is_file():
        raise DatasetNotFoundError(f"Dataset not found locally: {repo_id}")
    return target


def read_info(dataset_dir: Path) -> dict[str, Any]:
    """Parsed ``meta/info.json``."""
    try:
        with open(dataset_dir / "meta" / "info.json") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise DatasetNotFoundError(f"Unreadable meta/info.json in {dataset_dir}: {e}") from e


def list_cameras(dataset_dir: Path) -> list[str]:
    """Camera names stored as video features (``observation.images.<name>``)."""
    features = read_info(dataset_dir).get("features") or {}
    return sorted(
        key.removeprefix(VIDEO_KEY_PREFIX)
        for key, feat in features.items()
        if key.startswith(VIDEO_KEY_PREFIX) and isinstance(feat, dict) and feat.get("dtype") == "video"
    )


# ── episode index ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EpisodeIndexRow:
    episode_idx: int
    length: int
    duration_s: float | None
    from_timestamp: float | None
    to_timestamp: float | None
    tasks: tuple[str, ...]


def _maybe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_episode_index(dataset_dir: Path) -> list[EpisodeIndexRow]:
    """Per-episode metadata from ``meta/episodes/*.parquet``, sorted by index.

    ``duration_s`` is derived from ``length / fps``, *not* from the video's
    ``to_timestamp - from_timestamp`` window. An episode the operator accepted
    early stops its parquet at accept while its video still spans the full
    configured window, so the window over-reports the demonstration — a 2.6s
    episode reads as the configured 10.0s. The window is kept on
    ``from_/to_timestamp`` for the video transport and used for ``duration_s``
    only when a row has no usable length/fps.

    Returns ``[]`` rather than raising when the meta dir is missing or
    unreadable, so a partially-synced dataset still lists.
    """
    import pyarrow.parquet as pq

    eps_dir = dataset_dir / "meta" / "episodes"
    if not eps_dir.is_dir():
        return []

    info = read_info(dataset_dir)
    fps = float(info.get("fps") or 0.0)
    cameras = list_cameras(dataset_dir)
    # The window is read from the first camera so the listing is stable
    # regardless of camera; in practice every camera shares the same window.
    cam = cameras[0] if cameras else None
    from_col = f"videos/{VIDEO_KEY_PREFIX}{cam}/from_timestamp" if cam else None
    to_col = f"videos/{VIDEO_KEY_PREFIX}{cam}/to_timestamp" if cam else None

    rows: list[EpisodeIndexRow] = []
    for f in sorted(eps_dir.rglob("*.parquet")):
        try:
            schema = pq.read_schema(f)
        except Exception as e:
            logger.warning(f"Skipping unreadable episodes parquet {f}: {e}")
            continue
        wanted = [
            c for c in ("episode_index", "length", "tasks", from_col, to_col) if c and c in schema.names
        ]
        if "episode_index" not in wanted:
            continue
        try:
            t = pq.read_table(f, columns=wanted).to_pydict()
        except Exception as e:
            logger.warning(f"Skipping unreadable episodes parquet {f}: {e}")
            continue

        n = len(t["episode_index"])
        for i in range(n):
            length = int(t.get("length", [0] * n)[i] or 0)
            ft = _maybe_float(t[from_col][i]) if from_col in t else None
            tt = _maybe_float(t[to_col][i]) if to_col in t else None
            if length and fps:
                duration = length / fps
            elif ft is not None and tt is not None:
                duration = max(0.0, tt - ft)
            else:
                duration = None
            tasks_raw = t.get("tasks", [[]] * n)[i] if "tasks" in t else []
            rows.append(
                EpisodeIndexRow(
                    episode_idx=int(t["episode_index"][i]),
                    length=length,
                    duration_s=duration,
                    from_timestamp=ft,
                    to_timestamp=tt,
                    tasks=tuple(str(x) for x in (tasks_raw or [])),
                )
            )

    rows.sort(key=lambda r: r.episode_idx)
    return rows


# ── video location ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EpisodeVideoLocation:
    camera: str
    chunk: int
    file_index: int
    episode_idx: int
    path: Path
    fps: float
    # None when one episode owns the whole file (older layouts): the episode
    # spans the entire video rather than a window inside it.
    from_timestamp: float | None = None
    to_timestamp: float | None = None


def _locate_via_meta(
    dataset_dir: Path, episode_idx: int, camera: str, fps: float
) -> EpisodeVideoLocation | None:
    import pyarrow.parquet as pq

    eps_dir = dataset_dir / "meta" / "episodes"
    if not eps_dir.is_dir():
        return None

    base = f"videos/{VIDEO_KEY_PREFIX}{camera}"
    chunk_col, file_col = f"{base}/chunk_index", f"{base}/file_index"
    from_col, to_col = f"{base}/from_timestamp", f"{base}/to_timestamp"

    for f in sorted(eps_dir.rglob("*.parquet")):
        try:
            schema = pq.read_schema(f)
        except Exception:
            continue
        wanted = ["episode_index"] + [c for c in (chunk_col, file_col, from_col, to_col) if c in schema.names]
        if "episode_index" not in schema.names:
            continue
        try:
            t = pq.read_table(f, columns=wanted).to_pydict()
        except Exception:
            continue

        for i, ep in enumerate(t.get("episode_index", [])):
            if int(ep) != episode_idx:
                continue
            chunk = int(t[chunk_col][i]) if chunk_col in t else 0
            file_idx = int(t[file_col][i]) if file_col in t else episode_idx
            return EpisodeVideoLocation(
                camera=camera,
                chunk=chunk,
                file_index=file_idx,
                episode_idx=episode_idx,
                path=(
                    dataset_dir
                    / "videos"
                    / f"{VIDEO_KEY_PREFIX}{camera}"
                    / f"chunk-{chunk:03d}"
                    / f"file-{file_idx:03d}.mp4"
                ),
                fps=fps,
                from_timestamp=_maybe_float(t[from_col][i]) if from_col in t else None,
                to_timestamp=_maybe_float(t[to_col][i]) if to_col in t else None,
            )
    return None


def _resolve_action_file(dataset_dir: Path, episode_idx: int) -> Path | None:
    """Which ``data/chunk-N/file-M.parquet`` holds this episode's frames.

    The episodes meta pins the chunk/file for the action stream the same way it
    does for video. Older datasets don't, so fall back to the single-file layout.
    """
    import pyarrow.parquet as pq

    eps_dir = dataset_dir / "meta" / "episodes"
    if eps_dir.is_dir():
        for f in sorted(eps_dir.rglob("*.parquet")):
            try:
                schema = pq.read_schema(f)
            except Exception:
                continue
            if "episode_index" not in schema.names:
                continue
            wanted = ["episode_index"] + [
                c for c in ("data/chunk_index", "data/file_index") if c in schema.names
            ]
            try:
                t = pq.read_table(f, columns=wanted).to_pydict()
            except Exception:
                continue
            for i, ep in enumerate(t.get("episode_index", [])):
                if int(ep) != episode_idx:
                    continue
                chunk = int(t["data/chunk_index"][i]) if "data/chunk_index" in t else 0
                file_idx = int(t["data/file_index"][i]) if "data/file_index" in t else 0
                target = dataset_dir / "data" / f"chunk-{chunk:03d}" / f"file-{file_idx:03d}.parquet"
                if target.is_file():
                    return target

    fallback = dataset_dir / "data" / "chunk-000" / "file-000.parquet"
    return fallback if fallback.is_file() else None


def load_episode_actions(dataset_dir: Path, episode_idx: int) -> list[list[float]]:
    """This episode's per-frame commanded action vectors, in file order.

    Returns a ``(T, dof)`` nested list. Kept as plain Python rather than numpy so
    the caller can hand it straight to the JSON encoder.
    """
    import pyarrow.parquet as pq

    file_path = _resolve_action_file(dataset_dir, episode_idx)
    if file_path is None:
        raise EpisodeNotFoundError(f"No data parquet for episode {episode_idx}")
    try:
        table = pq.read_table(file_path, columns=["episode_index", "action"])
    except Exception as e:
        raise EpisodeNotFoundError(f"Could not read {file_path.name}: {e}") from e

    if "action" not in table.column_names:
        raise EpisodeNotFoundError(f"{file_path.name} has no 'action' column")

    indices = table["episode_index"].to_pylist()
    actions = table["action"].to_pylist()
    rows = [a for ep, a in zip(indices, actions, strict=False) if int(ep) == episode_idx]
    if not rows:
        raise EpisodeNotFoundError(f"Episode {episode_idx} has no action rows")
    # Some datasets store a scalar action per frame; normalise to 2-D.
    return [list(r) if isinstance(r, (list, tuple)) else [r] for r in rows]


def episode_motion_trace(dataset_dir: Path, episode_idx: int) -> list[float]:
    """Per-frame aggregate joint motion: the sum of absolute joint deltas.

    One scalar per frame collapsing the whole action vector, so a single trace
    shows where the arm was busy and where it sat idle — which is what makes the
    idle head and tail of a demonstration visible at a glance. Frame 0 has no
    predecessor and is reported as 0.
    """
    actions = load_episode_actions(dataset_dir, episode_idx)
    trace = [0.0]
    for prev, cur in zip(actions, actions[1:], strict=False):
        trace.append(float(sum(abs(c - p) for p, c in zip(prev, cur, strict=False))))
    return trace


def _locate_fallback(
    dataset_dir: Path, episode_idx: int, camera: str, fps: float
) -> EpisodeVideoLocation | None:
    """Pre-packing layouts: one mp4 per episode, no time window."""
    cam_dir = dataset_dir / "videos" / f"{VIDEO_KEY_PREFIX}{camera}"
    for candidate in (
        cam_dir / "chunk-000" / f"file-{episode_idx:03d}.mp4",
        cam_dir / f"episode_{episode_idx:06d}.mp4",
    ):
        if candidate.exists():
            return EpisodeVideoLocation(
                camera=camera,
                chunk=0,
                file_index=episode_idx,
                episode_idx=episode_idx,
                path=candidate,
                fps=fps,
            )
    return None


def resolve_video_file(dataset_dir: Path, camera: str, chunk: int, file_index: int) -> Path:
    """The mp4 at ``videos/observation.images.<camera>/chunk-N/file-M.mp4``.

    ``chunk``/``file_index`` are ints, so the path can't escape the dataset; the
    camera is checked against the declared video features rather than
    interpolated blind.
    """
    if camera not in list_cameras(dataset_dir):
        raise EpisodeNotFoundError(f"Camera {camera!r} not in this dataset")
    path = (
        dataset_dir
        / "videos"
        / f"{VIDEO_KEY_PREFIX}{camera}"
        / f"chunk-{int(chunk):03d}"
        / f"file-{int(file_index):03d}.mp4"
    )
    if not path.is_file():
        raise EpisodeNotFoundError(f"No video at {path.name} for camera {camera!r}")
    return path


def locate_episode_video(
    dataset_dir: Path, episode_idx: int, *, camera: str | None = None
) -> EpisodeVideoLocation:
    """Resolve the mp4 (and time window) holding ``episode_idx`` for one camera."""
    info = read_info(dataset_dir)
    fps = float(info.get("fps") or 0.0)
    cameras = list_cameras(dataset_dir)
    if not cameras:
        raise EpisodeNotFoundError(f"No camera videos in {dataset_dir.name}")
    cam = camera or cameras[0]
    if cam not in cameras:
        raise EpisodeNotFoundError(f"Camera {cam!r} not in {cameras}")

    location = _locate_via_meta(dataset_dir, episode_idx, cam, fps) or _locate_fallback(
        dataset_dir, episode_idx, cam, fps
    )
    if location is None or not location.path.exists():
        raise EpisodeNotFoundError(f"Episode {episode_idx} for camera {cam!r} not found on disk")
    return location


# ── decoding ────────────────────────────────────────────────────────────────


def _frame_time(location: EpisodeVideoLocation, frame_index: int) -> float:
    """Absolute timestamp *inside the mp4* for an episode-relative frame index."""
    offset = location.from_timestamp or 0.0
    if not location.fps:
        return offset
    return offset + (frame_index / location.fps)


def _decode_at(container, stream, target_s: float):
    """Decode the first frame at or after ``target_s``.

    Seeks to the keyframe at or before the target, then walks forward. Returns
    the last decoded frame if the target is past the end (a short episode
    shouldn't 500 on its final thumbnail).
    """
    # Every real mp4 stream carries a time_base; the fallback keeps a synthetic
    # or damaged stream from dividing by None.
    seek_target = int(target_s / stream.time_base) if stream.time_base else int(target_s * 1_000_000)
    try:
        container.seek(max(seek_target, 0), stream=stream, backward=True, any_frame=False)
    except Exception:
        container.seek(0)

    last = None
    for frame in container.decode(stream):
        last = frame
        if frame.time is not None and frame.time >= target_s - 1e-4:
            return frame
    return last


def extract_frame_png(
    location: EpisodeVideoLocation, frame_index: int, *, max_width: int | None = None
) -> bytes:
    """Decode one episode-relative frame to PNG bytes."""
    import av
    from PIL import Image

    target = _frame_time(location, frame_index)
    try:
        with av.open(str(location.path)) as container:
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            frame = _decode_at(container, stream, target)
            if frame is None:
                raise EpisodeNotFoundError(f"No frame at {target:.3f}s in {location.path.name}")
            img = frame.to_image()
    except EpisodeNotFoundError:
        raise
    except Exception as e:
        raise EpisodeNotFoundError(f"Could not decode {location.path.name}: {e}") from e

    if max_width and img.width > max_width:
        height = max(1, round(img.height * max_width / img.width))
        img = img.resize((max_width, height), Image.BILINEAR)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def extract_thumbnails(
    location: EpisodeVideoLocation,
    frame_indices: list[int],
    *,
    max_width: int = 160,
) -> list[bytes]:
    """Decode several frames in a single pass over the file.

    The film strip wants N frames from one episode; opening, seeking and tearing
    down the container N times is the obvious way and the wasteful one. Frames
    are requested in ascending order, so one forward walk serves them all.
    """
    import av
    from PIL import Image

    targets = sorted({int(i) for i in frame_indices})
    if not targets:
        return []

    out: list[bytes] = []
    try:
        with av.open(str(location.path)) as container:
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            for idx in targets:
                frame = _decode_at(container, stream, _frame_time(location, idx))
                if frame is None:
                    continue
                img = frame.to_image()
                if img.width > max_width:
                    height = max(1, round(img.height * max_width / img.width))
                    img = img.resize((max_width, height), Image.BILINEAR)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                out.append(buf.getvalue())
    except Exception as e:
        raise EpisodeNotFoundError(f"Could not decode {location.path.name}: {e}") from e
    return out
