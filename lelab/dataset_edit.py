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

"""Dataset editing operations: merge and delete episodes."""

import logging
import threading
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Merge job state ────────────────────────────────────────────────────────────

_merge_lock = threading.Lock()
_merge_state: dict[str, Any] = {
    "running": False,
    "success": None,
    "message": "Idle",
    "progress": "idle",
    "output_repo_id": None,
    "steps": [],
}


# ── Request models ─────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    source_repo_ids: list[str]
    output_repo_id: str


class DeleteEpisodesRequest(BaseModel):
    dataset_repo_id: str
    episode_indices: list[int]
    output_repo_id: str | None = None


class DeleteEpisodesInplaceRequest(BaseModel):
    dataset_repo_id: str
    episode_indices: list[int]


# ── Handlers ───────────────────────────────────────────────────────────────────

def handle_get_editable_datasets() -> list[dict[str, Any]]:
    """List local datasets enriched with episode / frame counts."""
    from .datasets import list_local_datasets

    raw = list_local_datasets()
    result: list[dict[str, Any]] = []
    for ds in raw:
        repo_id = ds["repo_id"]
        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset

            dataset = LeRobotDataset(repo_id)
            tasks: list[str] = []
            if hasattr(dataset.meta, "tasks") and dataset.meta.tasks is not None:
                t = dataset.meta.tasks
                import pandas as pd
                if isinstance(t, pd.DataFrame) and not t.empty:
                    tasks = list(t.index.tolist())
                elif isinstance(t, dict) and t:
                    tasks = list(t.values())
            result.append(
                {
                    **ds,
                    "num_episodes": dataset.num_episodes,
                    "num_frames": dataset.num_frames,
                    "fps": dataset.fps,
                    "robot_type": getattr(dataset.meta, "robot_type", None),
                    "tasks": tasks,
                    "loadable": True,
                }
            )
        except Exception as e:
            logger.debug(f"Could not load dataset {repo_id}: {e}")
            result.append({**ds, "num_episodes": None, "num_frames": None, "fps": None, "robot_type": None, "tasks": [], "loadable": False})
    return result


def handle_start_merge(request: MergeRequest) -> dict[str, Any]:
    """Start a background merge of *source_repo_ids* into *output_repo_id*."""
    global _merge_state

    if len(request.source_repo_ids) < 2:
        return {"success": False, "message": "Select at least 2 datasets to merge."}

    with _merge_lock:
        if _merge_state["running"]:
            return {"success": False, "message": "A merge is already running. Wait for it to finish."}
        _merge_state = {
            "running": True,
            "success": None,
            "message": "Starting…",
            "progress": "starting",
            "output_repo_id": request.output_repo_id,
            "steps": [],
        }

    thread = threading.Thread(
        target=_run_merge,
        args=(request.source_repo_ids, request.output_repo_id),
        daemon=True,
        name="lelab-merge",
    )
    thread.start()
    return {"success": True, "message": "Merge started."}


def handle_merge_status() -> dict[str, Any]:
    with _merge_lock:
        return dict(_merge_state)


def handle_delete_episodes(request: DeleteEpisodesRequest) -> dict[str, Any]:
    """Delete episodes from a dataset; result is saved as a new dataset."""
    try:
        from lerobot.datasets.dataset_tools import delete_episodes
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
        from lerobot.utils.constants import HF_LEROBOT_HOME

        dataset = LeRobotDataset(request.dataset_repo_id)

        output_repo_id = request.output_repo_id or f"{request.dataset_repo_id}_cleaned"
        output_dir = Path(HF_LEROBOT_HOME) / output_repo_id

        delete_episodes(
            dataset=dataset,
            episode_indices=request.episode_indices,
            output_dir=output_dir,
            repo_id=output_repo_id,
        )
        return {
            "success": True,
            "message": (
                f"Deleted {len(request.episode_indices)} episode(s) from "
                f"'{request.dataset_repo_id}'. "
                f"New dataset saved as '{output_repo_id}'."
            ),
            "output_repo_id": output_repo_id,
        }
    except Exception as e:
        logger.error(f"Delete episodes failed: {e}")
        return {"success": False, "message": str(e)}


def handle_get_episode_video_info(repo_id: str, episode_index: int) -> dict[str, Any]:
    """Return video file paths and timestamps for a single episode.

    The frontend uses these to build video src URLs (with #t=from,to fragments
    so the browser plays only the episode's segment inside the shared mp4).
    """
    try:
        from lerobot.datasets.lerobot_dataset import LeRobotDataset

        dataset = LeRobotDataset(repo_id)
        eps = dataset.meta.episodes
        if episode_index >= len(eps):
            return {"success": False, "message": f"Episode {episode_index} not found"}
        row = eps[episode_index]

        # Extract video keys from column names: "videos/{key}/from_timestamp"
        video_keys = sorted({
            col.split("/", 2)[1]
            for col in eps.column_names
            if col.startswith("videos/") and col.endswith("/from_timestamp")
        })

        cameras: list[dict[str, Any]] = []
        for key in video_keys:
            chunk_idx = int(row[f"videos/{key}/chunk_index"])
            file_idx = int(row[f"videos/{key}/file_index"])
            from_ts = float(row[f"videos/{key}/from_timestamp"])
            to_ts = float(row[f"videos/{key}/to_timestamp"])
            rel_path = f"videos/{key}/chunk-{chunk_idx:03d}/file-{file_idx:03d}.mp4"
            cameras.append({
                "key": key,
                "rel_path": rel_path,
                "from_timestamp": from_ts,
                "to_timestamp": to_ts,
            })

        return {"success": True, "cameras": cameras, "episode_index": episode_index}
    except Exception as e:
        logger.error(f"get_episode_video_info failed: {e}")
        return {"success": False, "message": str(e), "cameras": []}


def handle_serve_video_file(repo_id: str, rel_path: str) -> Path:
    """Resolve and validate a video file path inside a local dataset root.

    Returns the absolute Path if safe; raises ValueError on path traversal.
    """
    from lerobot.utils.constants import HF_LEROBOT_HOME

    root = Path(HF_LEROBOT_HOME).resolve()
    dataset_root = (root / repo_id).resolve()
    target = (dataset_root / rel_path).resolve()

    # Reject path traversal: target must be strictly inside the dataset root
    if root not in target.parents and dataset_root not in target.parents:
        raise ValueError(f"Path traversal attempt: {rel_path}")
    if not target.exists():
        raise FileNotFoundError(f"Video not found: {rel_path}")
    return target


def handle_get_episodes(repo_id: str) -> dict[str, Any]:
    """Return the episode list for a local dataset (index, length, task)."""
    try:
        from lerobot.datasets.lerobot_dataset import LeRobotDataset

        dataset = LeRobotDataset(repo_id)
        eps = dataset.meta.episodes
        episodes: list[dict[str, Any]] = []
        for i in range(len(eps)):
            row = eps[i]
            task_list = row.get("tasks", []) or []
            if not isinstance(task_list, list):
                task_list = [str(task_list)]
            episodes.append({
                "episode_index": int(row["episode_index"]),
                "length": int(row["length"]),
                "task": task_list[0] if task_list else "",
            })
        return {
            "success": True,
            "episodes": episodes,
            "num_episodes": dataset.num_episodes,
        }
    except Exception as e:
        logger.error(f"get_episodes failed for {repo_id}: {e}")
        return {"success": False, "message": str(e), "episodes": []}


def handle_delete_episodes_inplace(request: DeleteEpisodesInplaceRequest) -> dict[str, Any]:
    """Delete episodes from a dataset and replace the dataset in-place.

    Reads from the source, writes to a temp directory, then atomically
    replaces the source with the cleaned copy (same repo_id / root path).
    """
    import shutil

    from lerobot.datasets.dataset_tools import delete_episodes
    from lerobot.datasets.lerobot_dataset import LeRobotDataset
    from lerobot.utils.constants import HF_LEROBOT_HOME

    try:
        root = Path(HF_LEROBOT_HOME)
        source_dir = root / request.dataset_repo_id
        if not source_dir.exists():
            return {"success": False, "message": f"Dataset not found: {request.dataset_repo_id}"}

        # Write cleaned copy into a sibling temp dir (same filesystem → move is atomic)
        owner, name = (request.dataset_repo_id.split("/", 1) + [""])[:2]
        temp_dir = root / owner / f"_temp_rerecord_{name}" if owner else root / f"_temp_rerecord_{name}"
        if temp_dir.exists():
            shutil.rmtree(temp_dir)

        dataset = LeRobotDataset(request.dataset_repo_id)
        original_total = dataset.num_episodes

        delete_episodes(
            dataset=dataset,
            episode_indices=request.episode_indices,
            output_dir=temp_dir,
            repo_id=request.dataset_repo_id,
        )

        # Swap: move original aside, move cleaned into its place, clean up
        backup_dir = source_dir.parent / f"_backup_{source_dir.name}"
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        shutil.move(str(source_dir), str(backup_dir))
        shutil.move(str(temp_dir), str(source_dir))
        shutil.rmtree(backup_dir)

        remaining = original_total - len(request.episode_indices)
        return {
            "success": True,
            "message": (
                f"Deleted {len(request.episode_indices)} episode(s). "
                f"Dataset now has {remaining} episode(s)."
            ),
            "dataset_repo_id": request.dataset_repo_id,
            "num_episodes_remaining": remaining,
        }
    except Exception as e:
        logger.error(f"delete_episodes_inplace failed: {e}", exc_info=True)
        # Clean up temp dir if it exists
        try:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
        except Exception:
            pass
        return {"success": False, "message": str(e)}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _log_step(msg: str) -> None:
    logger.info(f"[merge] {msg}")
    with _merge_lock:
        _merge_state["message"] = msg
        _merge_state["steps"].append(msg)


def _run_merge(source_repo_ids: list[str], output_repo_id: str) -> None:
    global _merge_state
    try:
        from lerobot.datasets.dataset_tools import merge_datasets
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
        from lerobot.utils.constants import HF_LEROBOT_HOME

        with _merge_lock:
            _merge_state["progress"] = "loading"

        datasets: list[LeRobotDataset] = []
        for repo_id in source_repo_ids:
            _log_step(f"Loading dataset '{repo_id}'…")
            datasets.append(LeRobotDataset(repo_id))

        output_dir = Path(HF_LEROBOT_HOME) / output_repo_id
        _log_step(f"Merging {len(datasets)} datasets → '{output_repo_id}'…")

        with _merge_lock:
            _merge_state["progress"] = "merging"

        merge_datasets(
            datasets=datasets,
            output_repo_id=output_repo_id,
            output_dir=output_dir,
        )

        total_episodes = sum(ds.num_episodes for ds in datasets)
        _log_step(
            f"Done! Merged {total_episodes} episodes into '{output_repo_id}'."
        )

        with _merge_lock:
            _merge_state.update(
                {
                    "running": False,
                    "success": True,
                    "progress": "done",
                }
            )

    except Exception as exc:
        logger.error(f"Merge failed: {exc}", exc_info=True)
        with _merge_lock:
            _merge_state.update(
                {
                    "running": False,
                    "success": False,
                    "message": f"Error: {exc}",
                    "progress": "error",
                }
            )
