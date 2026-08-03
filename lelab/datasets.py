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

import base64
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from huggingface_hub.errors import HfHubHTTPError

from . import episode_media
from .utils.hf_auth import cached_whoami, shared_hf_api

logger = logging.getLogger(__name__)


def _lerobot_cache_root() -> Path:
    return episode_media.lerobot_cache_root()


def _is_dataset_dir(path: Path) -> bool:
    """A directory is a LeRobot dataset iff <dir>/meta/info.json exists."""
    try:
        return (path / "meta" / "info.json").is_file()
    except OSError:
        return False


def _dir_mtime_iso(path: Path) -> str | None:
    try:
        ts = path.stat().st_mtime
        return datetime.fromtimestamp(ts, tz=UTC).isoformat()
    except OSError:
        return None


def list_local_datasets() -> list[dict[str, Any]]:
    """Scan the LeRobot cache for local datasets (dirs containing meta/info.json).

    Walks one level deep: a top-level dataset dir is recorded as "<name>"; if a
    top-level dir is not itself a dataset, each subdir that is a dataset is
    recorded as "<top>/<sub>". Does not descend further.
    """
    root = _lerobot_cache_root()
    if not root.is_dir():
        return []

    out: list[dict[str, Any]] = []
    try:
        top_entries = list(root.iterdir())
    except OSError as e:
        logger.warning(f"Could not read LeRobot cache root {root}: {e}")
        return []

    for top in top_entries:
        try:
            if not top.is_dir():
                continue
        except OSError:
            continue

        if _is_dataset_dir(top):
            out.append(
                {
                    "repo_id": top.name,
                    "last_modified": _dir_mtime_iso(top),
                    "private": False,
                }
            )
            continue

        # Not a dataset itself — descend one level.
        try:
            sub_entries = list(top.iterdir())
        except OSError:
            continue
        for sub in sub_entries:
            try:
                if not sub.is_dir():
                    continue
            except OSError:
                continue
            if _is_dataset_dir(sub):
                out.append(
                    {
                        "repo_id": f"{top.name}/{sub.name}",
                        "last_modified": _dir_mtime_iso(sub),
                        "private": False,
                    }
                )

    out.sort(key=lambda d: d["last_modified"] or "", reverse=True)
    return out


def list_user_datasets() -> list[dict[str, Any]]:
    info = cached_whoami()
    if info is None:
        return []

    authors = [info["name"]] + [o["name"] for o in info.get("orgs", [])]
    api = shared_hf_api()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for author in authors:
        try:
            for ds in api.list_datasets(author=author, filter="LeRobot", limit=200):
                if ds.id in seen:
                    continue
                seen.add(ds.id)
                out.append(
                    {
                        "repo_id": ds.id,
                        "last_modified": ds.last_modified.isoformat() if ds.last_modified else None,
                        "private": bool(getattr(ds, "private", False)),
                    }
                )
        except HfHubHTTPError as e:
            logger.warning(f"list_datasets({author}) failed: {e}")

    out.sort(key=lambda d: d["last_modified"] or "", reverse=True)
    return out


def list_all_datasets() -> list[dict[str, Any]]:
    """Merged listing: Hub datasets + local cache, with `source` field.

    A repo_id present in both lists is collapsed to one entry with
    source="both" and last_modified set to the more recent of the two.
    """
    hub = list_user_datasets()
    local = list_local_datasets()

    merged: dict[str, dict[str, Any]] = {}
    for item in hub:
        merged[item["repo_id"]] = {**item, "source": "hub"}
    for item in local:
        rid = item["repo_id"]
        if rid in merged:
            existing = merged[rid]
            existing["source"] = "both"
            # Keep the newer timestamp; ISO strings sort lexically.
            a = existing.get("last_modified") or ""
            b = item.get("last_modified") or ""
            existing["last_modified"] = max(a, b) or None
        else:
            merged[rid] = {**item, "source": "local"}

    out = list(merged.values())
    out.sort(key=lambda d: d["last_modified"] or "", reverse=True)
    return out


# ── episode browsing ────────────────────────────────────────────────────────
#
# Everything below reads a *local* dataset only. Browsing a Hub-only dataset
# would mean pulling its videos down first, so the frontend offers the episode
# browser for entries whose `source` is "local" or "both" and keeps sending
# Hub-only ones to the visualize_dataset Space.


def handle_list_episodes(repo_id: str) -> dict[str, Any]:
    """Episode listing for one local dataset: per-episode length, duration, tasks."""
    try:
        dataset_dir = episode_media.resolve_dataset_dir(repo_id)
        info = episode_media.read_info(dataset_dir)
        cameras = episode_media.list_cameras(dataset_dir)
        rows = episode_media.read_episode_index(dataset_dir)
    except episode_media.DatasetNotFoundError as e:
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.warning(f"Could not list episodes for {repo_id}: {e}")
        return {"success": False, "message": f"Could not read dataset: {e}"}

    return {
        "success": True,
        "repo_id": repo_id,
        "fps": info.get("fps"),
        "robot_type": info.get("robot_type"),
        "total_episodes": info.get("total_episodes", len(rows)),
        "total_frames": info.get("total_frames"),
        "cameras": cameras,
        "episodes": [
            {
                "episode_index": r.episode_idx,
                "length": r.length,
                "duration_s": r.duration_s,
                "tasks": list(r.tasks),
            }
            for r in rows
        ],
    }


def handle_episode_detail(repo_id: str, episode_index: int) -> dict[str, Any]:
    """One episode: its per-camera video windows, plus neighbours for paging.

    Each camera reports its own ``from_timestamp``. They agree in practice, but
    the player must not assume that — a secondary camera is synced by mapping
    through *its own* offset, not by copying the driver's ``currentTime``.
    """
    try:
        dataset_dir = episode_media.resolve_dataset_dir(repo_id)
        info = episode_media.read_info(dataset_dir)
        rows = episode_media.read_episode_index(dataset_dir)
    except episode_media.DatasetNotFoundError as e:
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.warning(f"Could not read episode {episode_index} of {repo_id}: {e}")
        return {"success": False, "message": f"Could not read dataset: {e}"}

    row = next((r for r in rows if r.episode_idx == episode_index), None)
    if row is None:
        return {"success": False, "message": f"Episode {episode_index} not found in {repo_id}"}

    cameras: list[dict[str, Any]] = []
    for cam in episode_media.list_cameras(dataset_dir):
        try:
            loc = episode_media.locate_episode_video(dataset_dir, episode_index, camera=cam)
        except episode_media.EpisodeNotFoundError as e:
            logger.warning(f"{repo_id} ep{episode_index}: camera {cam} unavailable: {e}")
            continue
        cameras.append(
            {
                "name": cam,
                "from_timestamp": loc.from_timestamp,
                "to_timestamp": loc.to_timestamp,
                "chunk": loc.chunk,
                "file_index": loc.file_index,
            }
        )

    indices = [r.episode_idx for r in rows]
    position = indices.index(episode_index)

    return {
        "success": True,
        "repo_id": repo_id,
        "episode_index": episode_index,
        "length": row.length,
        "duration_s": row.duration_s,
        "tasks": list(row.tasks),
        "fps": info.get("fps"),
        "robot_type": info.get("robot_type"),
        "cameras": cameras,
        "prev_episode": indices[position - 1] if position > 0 else None,
        "next_episode": indices[position + 1] if position < len(indices) - 1 else None,
        "total_episodes": len(indices),
    }


def load_episode_frame_png(
    repo_id: str, episode_index: int, camera: str | None, frame_index: int, max_width: int | None
) -> bytes:
    """One decoded frame as PNG bytes. Raises on any miss; the route maps to 404.

    The bounds check matters on a packed mp4: episodes sit back to back in one
    file, so an out-of-range ``frame_index`` would otherwise decode cleanly —
    and serve a frame of the *next* episode with a 200.
    """
    dataset_dir = episode_media.resolve_dataset_dir(repo_id)
    rows = episode_media.read_episode_index(dataset_dir)
    row = next((r for r in rows if r.episode_idx == episode_index), None)
    if frame_index < 0 or (row and row.length and frame_index >= row.length):
        raise episode_media.EpisodeNotFoundError(
            f"Frame {frame_index} out of range for episode {episode_index}"
            + (f" (length {row.length})" if row and row.length else "")
        )
    location = episode_media.locate_episode_video(dataset_dir, episode_index, camera=camera)
    return episode_media.extract_frame_png(location, frame_index, max_width=max_width)


def handle_episode_thumbnails(
    repo_id: str, episode_index: int, camera: str | None, count: int
) -> dict[str, Any]:
    """``count`` evenly-spaced thumbnails for the film strip, decoded in one pass."""
    try:
        dataset_dir = episode_media.resolve_dataset_dir(repo_id)
        location = episode_media.locate_episode_video(dataset_dir, episode_index, camera=camera)
        rows = episode_media.read_episode_index(dataset_dir)
    except (episode_media.DatasetNotFoundError, episode_media.EpisodeNotFoundError) as e:
        return {"success": False, "message": str(e)}

    row = next((r for r in rows if r.episode_idx == episode_index), None)
    length = row.length if row and row.length else 0
    if length <= 0:
        return {"success": False, "message": f"Episode {episode_index} has no frames"}

    count = max(1, min(count, length))
    # Evenly spaced across the whole episode, inclusive of both ends: a strip
    # that stops short of the last frame hides how an episode finishes, which is
    # usually the part you are checking.
    last = length - 1
    indices = [0] if count == 1 else sorted({round(i * last / (count - 1)) for i in range(count)})

    try:
        # (frame_index, png) pairs — a frame that fails to decode is absent, not
        # a positional gap, so the surviving tiles keep their true frame labels.
        thumbnails = episode_media.extract_thumbnails(location, indices)
    except episode_media.EpisodeNotFoundError as e:
        return {"success": False, "message": str(e)}

    return {
        "success": True,
        "episode_index": episode_index,
        "camera": location.camera,
        "thumbnails": [
            {
                "frame_index": idx,
                "data_uri": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
            }
            for idx, png in thumbnails
        ],
    }


def locate_video_file(repo_id: str, camera: str, chunk: int, file_index: int) -> Path:
    """On-disk mp4 for one camera's chunk/file. Raises on any miss; the route 404s.

    Addressed by *file* rather than by episode on purpose. Several episodes share
    one mp4, so a file-addressed URL stays byte-identical as the viewer pages
    between them — the browser reuses the already-buffered video and the player
    only seeks. Keying on the episode instead would give each one its own URL for
    the same bytes, forcing a reload and dropping playback on every switch.
    """
    dataset_dir = episode_media.resolve_dataset_dir(repo_id)
    return episode_media.resolve_video_file(dataset_dir, camera, chunk, file_index)


def handle_episode_motion(repo_id: str, episode_index: int) -> dict[str, Any]:
    """Per-frame aggregate joint motion for one episode."""
    try:
        dataset_dir = episode_media.resolve_dataset_dir(repo_id)
        trace = episode_media.episode_motion_trace(dataset_dir, episode_index)
    except (episode_media.DatasetNotFoundError, episode_media.EpisodeNotFoundError) as e:
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.warning(f"Could not read motion for {repo_id} ep{episode_index}: {e}")
        return {"success": False, "message": f"Could not read action stream: {e}"}

    return {
        "success": True,
        "episode_index": episode_index,
        "motion": trace,
        "max_motion": max(trace) if trace else 0.0,
    }
