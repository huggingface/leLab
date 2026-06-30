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

"""Job lifecycle and registry for trainings (and, in future, other long-running
work). One JobRunner instance owns one subprocess; the JobRegistry owns the
overall state, including history persisted to disk under outputs/train/."""

from __future__ import annotations

import builtins
import contextlib
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterable
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel

from .train import TrainingRequest

logger = logging.getLogger(__name__)


JobState = Literal["running", "done", "failed", "interrupted"]


class JobTarget(BaseModel):
    """Where a job should run. `local` ⇒ LocalJobRunner. `hf_cloud` requires
    a non-empty `flavor` from HfApi.list_jobs_hardware()."""

    runner: Literal["local", "hf_cloud"] = "local"
    flavor: str | None = None


class TrainingMetrics(BaseModel):
    current_step: int = 0
    total_steps: int = 0
    current_loss: float | None = None
    current_lr: float | None = None
    grad_norm: float | None = None
    eta_seconds: float | None = None


class LogLine(BaseModel):
    timestamp: float
    message: str


class JobRecord(BaseModel):
    id: str
    name: str
    state: JobState
    config: TrainingRequest
    output_dir: str
    started_at: float
    ended_at: float | None = None
    exit_code: int | None = None
    error_message: str | None = None
    metrics: TrainingMetrics = TrainingMetrics()
    runner: Literal["local", "hf_cloud", "imported"] = "local"
    # PID of the detached subprocess (local runner only); survives uvicorn
    # --reload so a fresh registry can re-attach by tailing the log file.
    process_pid: int | None = None
    # HF Jobs identifiers (hf_cloud runner only)
    hf_job_id: str | None = None
    hf_flavor: str | None = None
    hf_repo_id: str | None = None
    hf_job_url: str | None = None
    # Captured from training stdout the first time wandb prints the run URL.
    wandb_run_url: str | None = None
    # Number of checkpoints currently visible (local: filesystem; cloud:
    # Hub repo). Filled in by JobRegistry.list/get; persisted as zero.
    checkpoint_count: int = 0


class JobCheckpoint(BaseModel):
    """One checkpoint produced by a training job.

    `ref` is opaque to the frontend; the inference handler resolves it back
    to a usable `--policy.path` value (a local dir for both sources, after
    snapshot_download for hub refs)."""

    step: int
    source: Literal["local", "hub"]
    ref: str


class MetricsHistoryPoint(BaseModel):
    """One (step, metrics) sample reconstructed from a job's log.jsonl.

    Used by GET /jobs/{id}/metrics-history to seed the monitoring charts.
    A point is emitted for each log line that carried a `step: ... loss: ...`
    payload (the log-freq lines from lerobot). Tqdm progress lines are
    skipped — they carry step + ETA but no loss/lr/grdn."""

    step: int
    loss: float | None = None
    lr: float | None = None
    grad_norm: float | None = None


def _pid_alive(pid: int) -> bool:
    """Return True if a process with this PID exists. Cheap; uses signal 0."""
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


@runtime_checkable
class JobRunner(Protocol):
    """Backend interface for running one job. LocalJobRunner is the only impl
    today; remote runners (SSH, Slurm) drop in here later. @runtime_checkable
    lets `isinstance(r, JobRunner)` work in tests / sanity checks."""

    def start(self, job_id: str, config: TrainingRequest, output_dir: str) -> None: ...
    def stop(self) -> None: ...
    def is_running(self) -> bool: ...
    def returncode(self) -> int | None: ...
    def stream_log_lines(self) -> list[LogLine]: ...
    def wandb_run_url(self) -> str | None: ...


# tqdm progress: "Training:   1%|▏         | 125/10000 [02:02<2:36:10,  1.05step/s]"
_TQDM_RE = re.compile(r"Training:\s*\d+%[^|]*\|[^|]*\|\s*(\d+)/(\d+)\s*\[(?:[\d:]+)<([\d:]+)")

# Wandb prints something like "wandb: 🚀 View run at https://wandb.ai/<entity>/<project>/runs/<id>"
# when it boots. We capture the first URL of that shape we see.
_WANDB_URL_RE = re.compile(r"https://wandb\.ai/[^\s/]+/[^\s/]+/runs/[A-Za-z0-9]+")


def extract_wandb_run_url(line: str) -> str | None:
    match = _WANDB_URL_RE.search(line)
    return match.group(0) if match else None


def _parse_duration(s: str) -> float | None:
    """Parse tqdm's HH:MM:SS or MM:SS into seconds. Returns None on '?'."""
    parts = s.split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return None
    return None


def parse_metrics_into(line: str, metrics: TrainingMetrics) -> None:
    """Update `metrics` in-place from one stdout line.

    Two complementary sources:
      * tqdm progress for current_step + total_steps + ETA (~1s cadence).
      * 'INFO ... step:N smpl:... loss:X grdn:Y lr:Z ...' for loss/lr/grdn
        (only at log_freq cadence, default every 250 steps).
    """
    try:
        tqdm_match = _TQDM_RE.search(line)
        if tqdm_match:
            try:
                metrics.current_step = int(tqdm_match.group(1))
                total = int(tqdm_match.group(2))
                if total > 0:
                    metrics.total_steps = total
                eta = _parse_duration(tqdm_match.group(3))
                if eta is not None:
                    metrics.eta_seconds = eta
            except (ValueError, IndexError):
                pass

        if "step:" in line and "loss:" in line:
            with contextlib.suppress(ValueError):
                metrics.current_step = int(line.split("step:")[1].split()[0].replace(",", ""))
            with contextlib.suppress(ValueError):
                metrics.current_loss = float(line.split("loss:")[1].split()[0])
            if "lr:" in line:
                with contextlib.suppress(ValueError):
                    metrics.current_lr = float(line.split("lr:")[1].split()[0])
            if "grdn:" in line:
                with contextlib.suppress(ValueError):
                    metrics.grad_norm = float(line.split("grdn:")[1].split()[0])

    except Exception as exc:
        logger.debug("Error parsing log line %r: %s", line, exc)


class SubprocessJobRunner:
    """Spawn a subprocess and pump its stdout into a log file + in-memory queue.

    The shared engine behind both LocalJobRunner (which runs `lerobot-train`
    directly) and HfCloudJobRunner (which runs `lerobot-train --job.target=...`,
    a local process that submits the job and streams the remote logs to its own
    stdout). Subclasses override `_on_line` to inspect each stdout line for
    runner-specific markers (e.g. the HF job id / page URL).
    """

    def __init__(
        self,
        metrics: TrainingMetrics,
        log_file_path: Path | None = None,
    ) -> None:
        self._metrics = metrics
        self._process: subprocess.Popen | None = None
        self._log_queue: Queue[LogLine] = Queue()
        self._monitor_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._log_file_path = log_file_path
        self._log_file = None  # type: ignore[assignment]
        self._wandb_run_url: str | None = None

    def _open_log_file(self) -> None:
        """Open the persistent log sink (one JSON line per consumed line).
        Held open for the consumer thread's lifetime so we don't reopen per
        write; _consume_lines closes it when its iterator is exhausted."""
        if self._log_file_path is not None:
            self._log_file_path.parent.mkdir(parents=True, exist_ok=True)
            self._log_file = self._log_file_path.open("a", buffering=1)

    def _spawn(self, cmd: list[str], thread_name: str) -> None:
        """Open the log sink, launch `cmd`, and start the stdout pump thread."""
        if self._process is not None:
            raise RuntimeError(f"{type(self).__name__} already started")

        self._open_log_file()

        # PYTHONUNBUFFERED makes the child's stdout flush per line. Without it
        # block-buffering hides log lines from our parser for many seconds.
        child_env = os.environ.copy()
        child_env["PYTHONUNBUFFERED"] = "1"

        # start_new_session=True puts the child in its own session/process
        # group. Without it, signals sent to the uvicorn worker (e.g. when
        # --reload restarts it on a .py file change) cascade to the child
        # and kill the training. With it, the child survives reloads; the
        # next worker re-attaches via the reattach path.
        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
            env=child_env,
            start_new_session=True,
        )

        self._monitor_thread = threading.Thread(target=self._pump_stdout, name=thread_name, daemon=True)
        self._monitor_thread.start()

    def pid(self) -> int | None:
        return self._process.pid if self._process is not None else None

    def stop(self) -> None:
        if self._process is None or self._process.poll() is not None:
            return
        self._stop_event.set()
        try:
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                logger.warning("Subprocess did not terminate in 10s, killing")
                self._process.kill()
                self._process.wait()
        except Exception as exc:
            logger.exception("Error stopping subprocess: %s", exc)

    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def returncode(self) -> int | None:
        if self._process is None:
            return None
        return self._process.poll()

    def stream_log_lines(self) -> list[LogLine]:
        """Drain whatever has accumulated since the last call."""
        out: list[LogLine] = []
        try:
            while True:
                out.append(self._log_queue.get_nowait())
        except Empty:
            pass
        return out

    def wandb_run_url(self) -> str | None:
        return self._wandb_run_url

    # -- internals --

    def _on_line(self, line: str) -> None:
        """Hook for subclasses to inspect each stdout line. Default: no-op."""

    def _consume_lines(self, lines: Iterable[str]) -> None:
        """Drive each text line through the metric/marker parse + log.jsonl
        append + in-memory queue. Source-agnostic: a subprocess's stdout
        (LocalJobRunner) or a remote log stream iterator (cloud reattach) feed
        the same pipeline. Closes the log file when the iterator is exhausted.
        """
        try:
            for line in lines:
                if self._stop_event.is_set():
                    break
                stripped = line.rstrip()
                if not stripped:
                    continue
                parse_metrics_into(stripped, self._metrics)
                if self._wandb_run_url is None:
                    url = extract_wandb_run_url(stripped)
                    if url is not None:
                        self._wandb_run_url = url
                self._on_line(stripped)
                log_line = LogLine(timestamp=time.time(), message=stripped)
                if self._log_file is not None:
                    try:
                        self._log_file.write(log_line.model_dump_json() + "\n")
                    except Exception as exc:  # pragma: no cover — best-effort persist
                        logger.exception("Error writing to log file: %s", exc)
                # Cap queue so a chatty source can't grow memory unbounded.
                if self._log_queue.qsize() >= 1000:
                    with contextlib.suppress(Empty):
                        self._log_queue.get_nowait()
                self._log_queue.put(log_line)
        except Exception as exc:
            logger.exception("Error consuming log lines: %s", exc)
        finally:
            if self._log_file is not None:
                with contextlib.suppress(Exception):
                    self._log_file.close()
                self._log_file = None

    def _pump_stdout(self) -> None:
        assert self._process is not None
        self._consume_lines(iter(self._process.stdout.readline, ""))


class LocalJobRunner(SubprocessJobRunner):
    """Run a training as a local subprocess.

    The runner is single-shot: instantiate a fresh one per job. Lifetime of
    the underlying subprocess is bounded by this object's existence in memory.
    """

    def start(
        self,
        job_id: str,
        config: TrainingRequest,
        output_dir: str,
    ) -> None:
        # Build the command via the helper that lives in train.py.
        from .train import build_training_command  # avoid import cycle at module load

        cmd = build_training_command(config, output_dir, sys.executable)
        logger.info("Starting job %s: %s", job_id, " ".join(cmd))
        self._spawn(cmd, thread_name=f"job-{job_id}-stdout")


class TailingJobRunner:
    """Re-attaches to a detached subprocess after a uvicorn reload.

    We can't recover the original Popen object across processes, so we don't
    own stdout. Instead we tail the persisted log file and watch the pid.
    Implements the JobRunner Protocol so JobRegistry can use it interchangeably
    with LocalJobRunner.
    """

    def __init__(
        self,
        metrics: TrainingMetrics,
        log_file_path: Path,
        pid: int,
    ) -> None:
        self._metrics = metrics
        self._log_file_path = log_file_path
        self._pid = pid
        self._log_queue: Queue[LogLine] = Queue()
        self._tail_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        # Replay everything that's already on disk so the parser catches up
        # on metrics, then tail from the current EOF.
        self._tail_offset = 0
        self._wandb_run_url: str | None = None

    def start(self, job_id: str, config: TrainingRequest, output_dir: str) -> None:
        # Required by JobRunner Protocol but irrelevant here; the subprocess
        # we're tailing was started by a previous uvicorn worker.
        raise RuntimeError("TailingJobRunner reattaches to an existing pid; use start_tailing() instead")

    def start_tailing(self) -> None:
        if self._tail_thread is not None:
            return
        self._tail_thread = threading.Thread(
            target=self._tail_loop, name=f"job-tail-{self._pid}", daemon=True
        )
        self._tail_thread.start()

    def stop(self) -> None:
        with contextlib.suppress(ProcessLookupError):
            os.kill(self._pid, signal.SIGTERM)
        self._stop_event.set()

    def is_running(self) -> bool:
        return _pid_alive(self._pid)

    def returncode(self) -> int | None:
        # We can't reap a process from another session, so we don't know the
        # actual exit code. Return 0 once the pid is gone — the watchdog
        # finalises as "done" rather than "failed", which is the better
        # default for a detached training that completed normally.
        if _pid_alive(self._pid):
            return None
        return 0

    def stream_log_lines(self) -> list[LogLine]:
        out: list[LogLine] = []
        try:
            while True:
                out.append(self._log_queue.get_nowait())
        except Empty:
            pass
        return out

    def pid(self) -> int | None:
        return self._pid

    def wandb_run_url(self) -> str | None:
        return self._wandb_run_url

    # -- internals --

    def _tail_loop(self) -> None:
        """Read lines as they arrive in log_file_path. Exits when pid dies
        AND there are no more new lines to read."""
        try:
            while not self._stop_event.is_set():
                if not self._log_file_path.exists():
                    if not _pid_alive(self._pid):
                        return
                    self._stop_event.wait(0.5)
                    continue
                with self._log_file_path.open() as f:
                    f.seek(self._tail_offset)
                    while not self._stop_event.is_set():
                        raw = f.readline()
                        if not raw:
                            self._tail_offset = f.tell()
                            if not _pid_alive(self._pid):
                                return
                            self._stop_event.wait(0.5)
                            continue
                        try:
                            log_line = LogLine.model_validate_json(raw.strip())
                        except Exception:
                            continue
                        parse_metrics_into(log_line.message, self._metrics)
                        if self._wandb_run_url is None:
                            url = extract_wandb_run_url(log_line.message)
                            if url is not None:
                                self._wandb_run_url = url
                        if self._log_queue.qsize() >= 1000:
                            with contextlib.suppress(Empty):
                                self._log_queue.get_nowait()
                        self._log_queue.put(log_line)
        except Exception as exc:
            logger.exception("Tailing loop error: %s", exc)


_PERSIST_THROTTLE_SECONDS = 1.0


def _list_local_checkpoints(output_dir: str) -> list[JobCheckpoint]:
    """Scan an output dir for valid checkpoint subdirectories.

    A directory under <output_dir>/checkpoints/ is a valid checkpoint iff
    its name parses to an int and it contains pretrained_model/config.json.
    """
    root = Path(output_dir) / "checkpoints"
    if not root.is_dir():
        return []
    out: list[JobCheckpoint] = []
    for entry in root.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            continue
        try:
            step = int(entry.name)
        except ValueError:
            continue
        config_json = entry / "pretrained_model" / "config.json"
        if not config_json.is_file():
            continue
        out.append(
            JobCheckpoint(
                step=step,
                source="local",
                ref=str((entry / "pretrained_model").resolve()),
            )
        )
    out.sort(key=lambda c: c.step)
    return out


_CLOUD_CKPT_TTL_SECONDS = 30.0
_CKPT_PATH_RE = re.compile(r"^checkpoints/(\d+)/pretrained_model/config\.json$")


def _hub_checkpoints_from_files(files, repo_id: str) -> list[JobCheckpoint]:
    """Parse a repo file listing into checkpoints. The ref preserves the
    original zero-padded directory name (e.g. 000050); JobCheckpoint.step is
    the int form for sorting and UI display."""
    seen: dict[int, JobCheckpoint] = {}
    for path in files:
        m = _CKPT_PATH_RE.match(path)
        if not m:
            continue
        step_dir = m.group(1)
        step = int(step_dir)
        seen[step] = JobCheckpoint(
            step=step,
            source="hub",
            ref=f"{repo_id}@checkpoints/{step_dir}",
        )
    out = list(seen.values())
    out.sort(key=lambda c: c.step)
    return out


def _list_imported_local(path: str) -> list[JobCheckpoint]:
    """Auto-detect the layout of an imported local directory.

    A checkpoints/<step>/pretrained_model tree → reuse _list_local_checkpoints.
    Otherwise, if the dir itself is a pretrained_model (config.json present) →
    a single step-0 checkpoint. Neither → empty (source moved/unusable)."""
    tree = _list_local_checkpoints(path)
    if tree:
        return tree
    if (Path(path) / "config.json").is_file():
        return [JobCheckpoint(step=0, source="local", ref=str(Path(path).resolve()))]
    return []


def _list_imported_hub(api, repo_id: str) -> list[JobCheckpoint]:
    """Auto-detect the layout of an imported Hub model repo.

    A checkpoints/<step>/pretrained_model tree → reuse the tree parse.
    Otherwise, a root config.json → a single step-0 checkpoint with a
    'repo@root' ref (the whole repo is the pretrained_model)."""
    try:
        files = api.list_repo_files(repo_id, repo_type="model")
    except Exception:
        return []
    tree = _hub_checkpoints_from_files(files, repo_id)
    if tree:
        return tree
    if "config.json" in files:
        return [JobCheckpoint(step=0, source="hub", ref=f"{repo_id}@root")]
    return []


_LANGUAGE_CONDITIONED_POLICY_TYPES = {"smolvla", "pi0", "pi0_fast", "pi05"}


_HUB_CKPT_REF_RE = re.compile(r"^(?P<repo>[^@]+)@checkpoints/(?P<step_dir>\d+)$")
_HUB_ROOT_REF_RE = re.compile(r"^(?P<repo>[^@]+)@root$")


def _read_checkpoint_config(ckpt: JobCheckpoint) -> dict[str, object]:
    """Load the pretrained_model/config.json for one checkpoint.

    Keyed on the checkpoint's own source/ref shape so it works for training
    jobs and imports alike:
      * local  → ckpt.ref is the absolute pretrained_model dir.
      * hub    → 'repo@checkpoints/<step_dir>' (a tree) or 'repo@root' (a flat
                 model repo); both resolve via hf_hub_download.
    """
    if ckpt.source == "local":
        with open(Path(ckpt.ref) / "config.json") as f:
            return json.load(f)
    from huggingface_hub import hf_hub_download

    m = _HUB_CKPT_REF_RE.match(ckpt.ref)
    if m:
        repo_id = m.group("repo")
        filename = f"checkpoints/{m.group('step_dir')}/pretrained_model/config.json"
    else:
        m = _HUB_ROOT_REF_RE.match(ckpt.ref)
        if not m:
            raise ValueError(f"Bad hub ref: {ckpt.ref!r}")
        repo_id = m.group("repo")
        filename = "config.json"
    local_path = hf_hub_download(repo_id=repo_id, filename=filename, repo_type="model")
    with open(local_path) as f:
        return json.load(f)


def _generate_job_id(policy_type: str, dataset_repo_id: str) -> str:
    """Build a sortable, collision-free job id from policy type and dataset slug."""
    from .train import _SLUG_RE

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dataset_slug = _SLUG_RE.sub("_", dataset_repo_id).strip("_") or "dataset"
    return f"{policy_type}_{dataset_slug}_{timestamp}"


def _job_dir(output_root: Path, job_id: str) -> Path:
    return output_root / job_id


def _job_log_path(output_root: Path, job_id: str) -> Path:
    return _job_dir(output_root, job_id) / "log.jsonl"


def _job_meta_path(output_root: Path, job_id: str) -> Path:
    return _job_dir(output_root, job_id) / "job.json"


class JobAlreadyRunningError(Exception):
    """Raised when start() is called while another local job is running."""


class JobNotFoundError(Exception):
    """Raised when a lookup hits an unknown id."""


class JobNotRunningError(Exception):
    """Raised when stop() is called on a non-running job."""


class JobRegistry:
    """Owns the registry of training jobs and their persistence.

    On instantiation, scans outputs/train/ for existing job.json files. For
    each record marked 'running': local jobs reattach if the pid is alive
    (else 'interrupted'); hf_cloud jobs always reattach and let the tail loop
    drive finalisation.
    """

    def __init__(self, output_root: Path) -> None:
        self._output_root = output_root.resolve()
        self._output_root.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._records: dict[str, JobRecord] = {}
        self._runners: dict[str, JobRunner] = {}
        self._last_persist_at: dict[str, float] = {}

        self._stop_watchdog = threading.Event()
        self._watchdog_thread: threading.Thread | None = None

        # repo_id -> (expires_at_epoch, checkpoint list)
        self._cloud_ckpt_cache: dict[str, tuple[float, list[JobCheckpoint]]] = {}

        # Fired (best-effort) on every state change: new job, stop initiated,
        # watchdog finalisation, delete. Server wires this to a WebSocket
        # broadcast so the frontend can refetch on-event instead of polling.
        self._on_change: Callable[[], None] | None = None

        # Fired from the watchdog at ~1Hz with a compact snapshot of every
        # running job (id, state, metrics, wandb url, checkpoint count) so
        # the dashboard keeps the progress bar live without refetching /jobs.
        self._on_progress: Callable[[builtins.list[dict]], None] | None = None

        self._migrate_legacy_cwd_jobs()
        self._load_from_disk()
        self._start_watchdog()

    def _migrate_legacy_cwd_jobs(self) -> None:
        """One-shot migration from cwd-relative `outputs/train/` to the new
        absolute root.

        Older lelab versions wrote job dirs to `<cwd>/outputs/train/`, which
        meant history disappeared when you launched from a different cwd. We
        now anchor to ~/.cache/.../outputs/train. On first boot under the new
        layout, move any pre-existing cwd-relative job dirs over and rewrite
        each job.json's `output_dir` field to the new absolute path.

        Idempotent: skipped if (a) the new root is the legacy one itself
        (LELAB_OUTPUT_ROOT=outputs/train still wins for tests), or (b) the
        legacy dir is absent / already empty.
        """
        legacy_root = (Path.cwd() / "outputs" / "train").resolve()
        if legacy_root == self._output_root or not legacy_root.is_dir():
            return

        legacy_dirs = [p for p in legacy_root.iterdir() if p.is_dir()]
        if not legacy_dirs:
            return

        logger.info(
            "Migrating %d legacy job dirs from %s to %s",
            len(legacy_dirs),
            legacy_root,
            self._output_root,
        )
        for src in legacy_dirs:
            dst = self._output_root / src.name
            if dst.exists():
                logger.warning("Migration: %s already exists at destination; skipping", src.name)
                continue
            try:
                shutil.move(str(src), str(dst))
            except Exception as exc:
                logger.warning("Migration: failed to move %s: %s", src.name, exc)
                continue
            self._rewrite_output_dir_in_meta(dst)

        # If the legacy dir is now empty, remove it so subsequent boots skip
        # the scan. A leftover non-dir file keeps it around — that's fine.
        with contextlib.suppress(OSError):
            legacy_root.rmdir()

    def _rewrite_output_dir_in_meta(self, job_dir: Path) -> None:
        """Repoint `output_dir` in a migrated job.json to its new absolute
        path. Pre-migration records stored `outputs/train/<id>/run` which
        no longer resolves once cwd has moved."""
        meta = job_dir / "job.json"
        if not meta.is_file():
            return
        try:
            data = json.loads(meta.read_text())
        except Exception as exc:
            logger.warning("Migration: could not parse %s: %s", meta, exc)
            return
        data["output_dir"] = str(job_dir / "run")
        tmp = meta.with_suffix(meta.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.replace(tmp, meta)

    def set_on_change(self, callback: Callable[[], None] | None) -> None:
        """Register a single observer fired when registry state changes."""
        self._on_change = callback

    def set_on_progress(self, callback: Callable[[builtins.list[dict]], None] | None) -> None:
        """Register an observer fired each watchdog tick with one dict per
        running job. Quiet when no job runs: a tick with no running jobs
        produces no callback."""
        self._on_progress = callback

    def _notify_change(self) -> None:
        cb = self._on_change
        if cb is None:
            return
        try:
            cb()
        except Exception as exc:
            logger.exception("JobRegistry on_change callback failed: %s", exc)

    def _notify_progress(self, snapshots: builtins.list[dict]) -> None:
        cb = self._on_progress
        if cb is None or not snapshots:
            return
        try:
            cb(snapshots)
        except Exception as exc:
            logger.exception("JobRegistry on_progress callback failed: %s", exc)

    # -- public API --

    def list(self, limit: int = 10) -> builtins.list[JobRecord]:
        with self._lock:
            records = list(self._records.values())
        records.sort(key=lambda r: r.started_at, reverse=True)
        records = records[:limit]
        for r in records:
            r.checkpoint_count = self._count_checkpoints(r)
        return records

    def get(self, job_id: str) -> JobRecord:
        with self._lock:
            record = self._records.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        record.checkpoint_count = self._count_checkpoints(record)
        return record

    def start(self, config: TrainingRequest, target: JobTarget | None = None) -> JobRecord:
        from .runners.hf_cloud import HfCloudJobRunner  # lazy import to avoid circular import

        target = target or JobTarget()
        if target.runner == "hf_cloud" and not target.flavor:
            raise ValueError("flavor is required when runner is hf_cloud")

        with self._lock:
            # Local trainings are bounded by this machine's GPU/USB resources,
            # so at most one runs at a time. Cloud trainings each get their
            # own remote container, so any number can be in flight in parallel.
            if target.runner == "local":
                for r in self._records.values():
                    if r.state == "running" and r.runner == "local":
                        raise JobAlreadyRunningError(r.id)

            job_id = _generate_job_id(config.policy_type, config.dataset_repo_id)
            job_dir = _job_dir(self._output_root, job_id)
            lerobot_output_dir = str(job_dir / "run")
            name = f"{config.policy_type.upper()} · {config.dataset_repo_id}"
            record = JobRecord(
                id=job_id,
                name=name,
                state="running",
                config=config,
                output_dir=lerobot_output_dir,
                started_at=time.time(),
                runner=target.runner,
                hf_flavor=target.flavor,
            )

            job_dir.mkdir(parents=True, exist_ok=True)
            self._records[job_id] = record
            self._persist(record, force=True)

            log_path = _job_log_path(self._output_root, job_id)
            if target.runner == "local":
                runner = LocalJobRunner(record.metrics, log_file_path=log_path)
            else:
                runner = HfCloudJobRunner(record.metrics, log_path, target.flavor)

            try:
                runner.start(job_id, config, lerobot_output_dir)
            except Exception as exc:
                logger.exception("Failed to start runner for job %s", job_id)
                record.state = "failed"
                record.ended_at = time.time()
                record.error_message = f"Failed to start runner: {exc}"
                self._persist(record, force=True)
                raise

            # Capture runner-specific identifiers. For cloud jobs the HF job id
            # / page URL / model repo are printed by lerobot's submit_to_hf and
            # only appear in stdout a few seconds after start, so they're None
            # here; the watchdog (_tick) parses and persists them once they land.
            if target.runner == "local":
                record.process_pid = runner.pid()

            self._persist(record, force=True)
            self._runners[job_id] = runner
        self._notify_change()
        return record

    def register_imported(self, source: str, name: str | None = None) -> JobRecord:
        """Register an externally-trained model as a pointer-only pseudo-job.

        `source` is either an existing local directory (its path is stored in
        output_dir) or, failing that, a Hugging Face repo id (stored in
        hf_repo_id). The source must expose at least one checkpoint under the
        auto-detect rules, else ValueError. Nothing is copied; delete only
        removes the pointer."""
        src = source.strip()
        if not src:
            raise ValueError("source is required")

        local_path = Path(src).expanduser()
        if local_path.is_dir():
            resolved = str(local_path.resolve())
            ckpts = _list_imported_local(resolved)
            output_dir, hf_repo_id = resolved, None
            label = local_path.name or resolved
        else:
            from .utils.hf_auth import shared_hf_api

            ckpts = _list_imported_hub(shared_hf_api(), src)
            output_dir, hf_repo_id = "", src
            label = src

        if not ckpts:
            raise ValueError(
                f"No usable model at {src!r}. For a local path, expected a "
                "pretrained_model (config.json) or a checkpoints/<step>/"
                "pretrained_model tree. For a Hugging Face repo, the repo may "
                "not exist, be private without auth, or lack a model config."
            )

        # Best-effort policy type for the display name; inference reads the
        # real config from the checkpoint, so a wrong guess here is harmless.
        policy_type = "model"
        with contextlib.suppress(Exception):
            policy_type = str(_read_checkpoint_config(ckpts[-1]).get("type") or "model")

        job_id = _generate_job_id(policy_type, "imported")
        record = JobRecord(
            id=job_id,
            name=name or f"Imported · {label}",
            state="done",
            config=TrainingRequest(dataset_repo_id="(imported)", policy_type=policy_type),
            output_dir=output_dir,
            started_at=time.time(),
            ended_at=time.time(),
            runner="imported",
            hf_repo_id=hf_repo_id,
        )
        with self._lock:
            self._records[job_id] = record
            self._persist(record, force=True)
        self._notify_change()
        return record

    def stop(self, job_id: str) -> JobRecord:
        with self._lock:
            record = self._records.get(job_id)
            if record is None:
                raise JobNotFoundError(job_id)
            runner = self._runners.get(job_id)
        if record.state != "running" or runner is None:
            raise JobNotRunningError(job_id)
        runner.stop()
        # The watchdog will finalise the record (state, ended_at, exit_code).
        # Wait briefly so the caller sees the new state in the response.
        for _ in range(20):
            time.sleep(0.1)
            with self._lock:
                if record.state != "running":
                    return record
        return record

    def drain_logs(self, job_id: str) -> builtins.list[LogLine]:
        with self._lock:
            if job_id not in self._records:
                raise JobNotFoundError(job_id)
            runner = self._runners.get(job_id)
        if runner is None:
            return []
        return runner.stream_log_lines()

    def read_persisted_logs(self, job_id: str) -> builtins.list[LogLine]:
        """Read all log lines that have been written to disk for this job.

        Used by the frontend on Monitoring-page mount to seed the log panel
        with history (e.g. after navigating away and back, or after a lelab
        restart marked the job 'interrupted').
        """
        with self._lock:
            if job_id not in self._records:
                raise JobNotFoundError(job_id)
        path = _job_log_path(self._output_root, job_id)
        if not path.exists():
            return []
        out: list[LogLine] = []
        with path.open() as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    out.append(LogLine.model_validate_json(raw))
                except Exception:
                    continue  # skip a malformed line rather than 500ing
        return out

    def read_metrics_history(self, job_id: str) -> builtins.list[MetricsHistoryPoint]:
        """Reconstruct the per-step loss/lr/grad-norm series from log.jsonl.

        Used by the frontend on Monitoring-page mount to seed the curves so
        they survive page reloads, navigation, and lelab restarts. Re-parses
        on every call; cache later if a slow file ever shows up.
        """
        with self._lock:
            if job_id not in self._records:
                raise JobNotFoundError(job_id)
        path = _job_log_path(self._output_root, job_id)
        if not path.exists():
            return []
        points: list[MetricsHistoryPoint] = []
        with path.open() as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    log_line = LogLine.model_validate_json(raw)
                except Exception:
                    continue  # skip malformed line, same as read_persisted_logs
                msg = log_line.message
                # Only the log-freq lines carry per-step metric values.
                # Tqdm lines have a step but no loss/lr — skip them so we
                # don't emit a flat-line point per tqdm tick.
                if "step:" not in msg or "loss:" not in msg:
                    continue
                fresh = TrainingMetrics()
                parse_metrics_into(msg, fresh)
                if fresh.current_step <= 0:
                    continue
                point = MetricsHistoryPoint(
                    step=fresh.current_step,
                    loss=fresh.current_loss,
                    lr=fresh.current_lr,
                    grad_norm=fresh.grad_norm,
                )
                # Dedupe by step: overwrite on consecutive same-step lines.
                if points and points[-1].step == point.step:
                    points[-1] = point
                else:
                    points.append(point)
        points.sort(key=lambda p: p.step)
        return points

    def _checkpoints_for(self, record: JobRecord) -> builtins.list[JobCheckpoint]:
        if record.runner == "imported":
            if record.hf_repo_id:
                return self._list_cloud_cached(record.hf_repo_id)
            return _list_imported_local(record.output_dir)
        if record.runner == "local":
            return _list_local_checkpoints(record.output_dir)
        # Cloud: _list_imported_hub prefers the checkpoints/<step>/ tree (pushed when
        # save_checkpoint_to_hub is on) and falls back to the final model at the repo
        # root, so a finished run is always reachable even with no per-step tree.
        return self._list_cloud_cached(record.hf_repo_id)

    def list_checkpoints(self, job_id: str) -> builtins.list[JobCheckpoint]:
        """Return checkpoints saved for this job, ascending by step.

        Local jobs scan <output_dir>/checkpoints/. Cloud jobs introspect the
        Hub repo (30s TTL cache). Imported jobs auto-detect single-model vs
        checkpoints-tree from their local path or Hub repo id."""
        with self._lock:
            record = self._records.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        return self._checkpoints_for(record)

    def _list_cloud_cached(self, repo_id: str | None) -> builtins.list[JobCheckpoint]:
        """30s-TTL cache over the hub checkpoint listing (`_list_imported_hub`:
        the checkpoints/<step>/ tree, else the root model). All hub listings —
        cloud-trained and imported alike — share this cache + rate-limit budget."""
        if not repo_id:
            return []
        now = time.time()
        cached = self._cloud_ckpt_cache.get(repo_id)
        if cached is not None and cached[0] > now:
            return cached[1]
        from .utils.hf_auth import shared_hf_api  # lazy: keeps unit-test imports cheap

        result = _list_imported_hub(shared_hf_api(), repo_id)
        self._cloud_ckpt_cache[repo_id] = (now + _CLOUD_CKPT_TTL_SECONDS, result)
        return result

    def _count_checkpoints(self, record: JobRecord) -> int:
        return len(self._checkpoints_for(record))

    def get_policy_config_summary(self, job_id: str, step: int) -> dict[str, object]:
        """Read the checkpoint's pretrained_model/config.json and return only
        the UX-relevant slice: policy type, expected camera names + their
        height/width, and whether the policy needs a --task string."""
        with self._lock:
            record = self._records.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        ckpts = self.list_checkpoints(job_id)
        match = next((c for c in ckpts if c.step == step), None)
        if match is None:
            raise FileNotFoundError(f"No checkpoint at step {step} for job {record.id}")
        cfg = _read_checkpoint_config(match)
        policy_type = cfg.get("type")
        image_features: dict[str, dict[str, int]] = {}
        for full_name, feat in (cfg.get("input_features") or {}).items():
            if feat.get("type") != "VISUAL":
                continue
            shape = feat.get("shape") or []
            if len(shape) != 3:
                continue
            _channels, height, width = shape
            # The policy keys are 'observation.images.<name>'; the rollout CLI
            # takes just the suffix.
            name = full_name.split(".")[-1]
            image_features[name] = {"height": int(height), "width": int(width)}
        return {
            "policy_type": policy_type,
            "image_features": image_features,
            "requires_task": policy_type in _LANGUAGE_CONDITIONED_POLICY_TYPES,
        }

    def delete(self, job_id: str) -> None:
        with self._lock:
            record = self._records.get(job_id)
            if record is None:
                raise JobNotFoundError(job_id)
            if record.state == "running":
                raise JobNotRunningError(job_id)
            self._records.pop(job_id, None)
            self._runners.pop(job_id, None)
            self._last_persist_at.pop(job_id, None)
        with contextlib.suppress(FileNotFoundError):
            shutil.rmtree(_job_dir(self._output_root, job_id))
        self._notify_change()

    def shutdown(self) -> None:
        """For tests / orderly process exit. Not wired to FastAPI lifespan today."""
        self._stop_watchdog.set()

    # -- internals --

    def _load_from_disk(self) -> None:
        for job_dir in self._output_root.glob("*/"):
            meta = job_dir / "job.json"
            if not meta.exists():
                continue
            try:
                data = json.loads(meta.read_text())
                record = JobRecord.model_validate(data)
            except Exception as exc:
                logger.warning("Skipping malformed job.json at %s: %s", meta, exc)
                continue
            if record.state == "running":
                if record.runner == "local":
                    pid = record.process_pid
                    if pid is not None and _pid_alive(pid):
                        logger.info(
                            "Re-attaching to detached local job %s (pid %d)",
                            record.id,
                            pid,
                        )
                        runner = TailingJobRunner(
                            record.metrics,
                            _job_log_path(self._output_root, record.id),
                            pid,
                        )
                        runner.start_tailing()
                        self._runners[record.id] = runner
                    else:
                        record.state = "interrupted"
                        if record.ended_at is None:
                            record.ended_at = time.time()
                        self._write_meta(record)
                elif record.runner == "hf_cloud" and record.hf_job_id and record.hf_flavor:
                    # Always reattach; the status poller is the source of truth
                    # for terminal state. If the HF job already finished, the
                    # next inspect_job call resolves the final stage and the
                    # watchdog finalises the record. A transient HF API hiccup
                    # at startup no longer strands the record as "interrupted".
                    logger.info(
                        "Re-attaching to HF Cloud job %s (hf_job_id=%s)",
                        record.id,
                        record.hf_job_id,
                    )
                    from .runners.hf_cloud import HfCloudJobRunner

                    runner = HfCloudJobRunner(
                        record.metrics,
                        _job_log_path(self._output_root, record.id),
                        record.hf_flavor,
                    )
                    runner.reattach(record.hf_job_id)
                    self._runners[record.id] = runner
                else:
                    # Malformed running record — mark interrupted.
                    record.state = "interrupted"
                    if record.ended_at is None:
                        record.ended_at = time.time()
                    self._write_meta(record)
            self._records[record.id] = record

    def _start_watchdog(self) -> None:
        self._watchdog_thread = threading.Thread(
            target=self._watchdog_loop, name="job-registry-watchdog", daemon=True
        )
        self._watchdog_thread.start()

    def _watchdog_loop(self) -> None:
        while not self._stop_watchdog.is_set():
            try:
                self._tick()
            except Exception as exc:
                logger.exception("Watchdog tick failed: %s", exc)
            self._stop_watchdog.wait(1.0)

    def _tick(self) -> None:
        with self._lock:
            running_ids = [jid for jid, r in self._records.items() if r.state == "running"]

        progress_snapshots: builtins.list[dict] = []

        for jid in running_ids:
            with self._lock:
                runner = self._runners.get(jid)
                record = self._records.get(jid)
            if runner is None or record is None:
                continue
            if runner.is_running():
                # Pull the wandb run URL once it appears in stdout.
                if record.wandb_run_url is None:
                    url = runner.wandb_run_url()
                    if url is not None:
                        with self._lock:
                            record.wandb_run_url = url
                        self._persist(record, force=True)
                # Cloud jobs print their HF job id / page URL / model repo a few
                # seconds after start; capture them onto the record once parsed.
                if record.runner == "hf_cloud":
                    self._sync_cloud_ids(record, runner)
                # Persist metric snapshot at most once per second.
                self._persist(record, force=False)
                progress_snapshots.append(
                    {
                        "id": record.id,
                        "state": record.state,
                        "metrics": record.metrics.model_dump(),
                        "wandb_run_url": record.wandb_run_url,
                        "checkpoint_count": self._count_checkpoints(record),
                    }
                )
                continue

            # Subprocess exited since the last tick. Finalise.
            # Capture any cloud ids printed right before exit (e.g. a job that
            # submitted then failed fast) so checkpoint listing has the repo id.
            if record.runner == "hf_cloud":
                self._sync_cloud_ids(record, runner)
            rc = runner.returncode()
            with self._lock:
                if record.wandb_run_url is None:
                    record.wandb_run_url = runner.wandb_run_url()
                record.state = "done" if rc == 0 else "failed"
                record.ended_at = time.time()
                record.exit_code = rc
                if rc != 0 and record.error_message is None:
                    record.error_message = f"Job exited with code {rc}"
                self._runners.pop(jid, None)
            self._persist(record, force=True)
            self._notify_change()

        self._notify_progress(progress_snapshots)

    def _sync_cloud_ids(self, record: JobRecord, runner: JobRunner) -> None:
        """Copy HF job id / page URL / model repo from a cloud runner onto the
        record once lerobot's submit_to_hf has printed them. Persists on first
        appearance so the ids survive a uvicorn --reload (which drives reattach).
        """
        changed = False
        for attr in ("hf_job_id", "hf_job_url", "hf_repo_id"):
            if getattr(record, attr) is not None:
                continue
            getter = getattr(runner, attr, None)
            value = getter() if callable(getter) else None
            if value is not None:
                with self._lock:
                    setattr(record, attr, value)
                changed = True
        if changed:
            self._persist(record, force=True)

    def _persist(self, record: JobRecord, force: bool) -> None:
        now = time.time()
        last = self._last_persist_at.get(record.id, 0.0)
        if not force and (now - last) < _PERSIST_THROTTLE_SECONDS:
            return
        self._last_persist_at[record.id] = now
        self._write_meta(record)

    def _write_meta(self, record: JobRecord) -> None:
        path = _job_meta_path(self._output_root, record.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write so a crash mid-write never strands a half-written file
        # that would skip the job on next _load_from_disk.
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(record.model_dump_json(indent=2))
        os.replace(tmp, path)


# Module-level singleton. Anchored to ~/.cache so history survives launches
# from different cwds. JobRegistry.__init__ migrates legacy `<cwd>/outputs/train/`
# job dirs into this root on first boot. LELAB_OUTPUT_ROOT overrides for tests.
_DEFAULT_OUTPUT_ROOT = Path(
    os.environ.get("LELAB_OUTPUT_ROOT")
    or (Path.home() / ".cache" / "huggingface" / "lerobot" / "outputs" / "train")
).expanduser()
job_registry = JobRegistry(_DEFAULT_OUTPUT_ROOT)

__all__ = [
    "JobState",
    "JobTarget",
    "TrainingMetrics",
    "LogLine",
    "JobRecord",
    "JobCheckpoint",
    "MetricsHistoryPoint",
    "JobRunner",
    "SubprocessJobRunner",
    "LocalJobRunner",
    "JobRegistry",
    "JobAlreadyRunningError",
    "JobNotFoundError",
    "JobNotRunningError",
    "job_registry",
    "parse_metrics_into",
]
