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

"""HF Jobs runner — runs a training as an HF Jobs job on HuggingFace's GPUs.

Uses huggingface/lerobot-gpu:latest as the runtime image (lerobot pre-installed).
Tails logs via HfApi.fetch_job_logs and reuses the existing parse_metrics_into
parser since stdout format is identical to a local lerobot run.
"""

from __future__ import annotations

import contextlib
import logging
import netrc
import os
import threading
import time
from pathlib import Path
from queue import Empty, Queue

from huggingface_hub import get_token
from huggingface_hub.errors import RepositoryNotFoundError

from ..jobs import LogLine, TrainingMetrics, extract_wandb_run_url, parse_metrics_into
from ..train import TrainingRequest, build_training_command
from ..utils.config import with_lelab_tag
from ..utils.hf_auth import cached_whoami, shared_hf_api

logger = logging.getLogger(__name__)

LEROBOT_IMAGE = "huggingface/lerobot-gpu:latest"

# Where the trainer writes checkpoints inside the HF Jobs container. The host
# path the registry hands us (under ~/.cache/...) doesn't exist on the remote
# pod, so we ignore it and pin a writable container-local path instead. The
# wrapper reads --output_dir from the trainer argv and uploads checkpoints from
# here to the Hub, so the lelab UI never reads this path directly.
_CONTAINER_OUTPUT_DIR = "/tmp/lelab/train"  # nosec B108 — fixed path inside the remote HF Jobs container, not host-local

# Inlined sidecar uploader for HF Jobs. Spawns the lerobot trainer as a
# subprocess and concurrently uploads new <output_dir>/checkpoints/<step>/
# directories to the Hub model repo, so the lelab UI can list them while
# training is in progress.
#
# Sent verbatim as the value of `python -c '...'`. Anything after `--` in
# the command argv is forwarded to the trainer.
WRAPPER_SOURCE = r'''
import os, re, sys, threading, subprocess
from pathlib import Path
from huggingface_hub import HfApi

argv = sys.argv[1:]
if "--" not in argv:
    print("[wrapper] missing -- separator", flush=True)
    sys.exit(2)
sep = argv.index("--")
trainer_argv = argv[sep + 1:]


def _arg(name):
    """Return the value of --name=foo or --name foo from trainer_argv."""
    for i, tok in enumerate(trainer_argv):
        if tok == name and i + 1 < len(trainer_argv):
            return trainer_argv[i + 1]
        if tok.startswith(name + "="):
            return tok.split("=", 1)[1]
    return None


output_dir = _arg("--output_dir")
repo_id = _arg("--policy.repo_id")
if not output_dir or not repo_id:
    print(f"[wrapper] need --output_dir and --policy.repo_id; got {output_dir} / {repo_id}", flush=True)
    sys.exit(2)

api = HfApi()
# lerobot only calls push_to_hub at the end of training, so the repo doesn't
# exist when our checkpoint watcher fires. Create it up front (idempotent).
try:
    api.create_repo(repo_id=repo_id, repo_type="model", exist_ok=True)
    print(f"[wrapper] repo ready: {repo_id}", flush=True)
except Exception as exc:
    print(f"[wrapper] create_repo failed: {exc}", flush=True)

seen = set()
stop_event = threading.Event()


def _scan_and_upload():
    root = Path(output_dir) / "checkpoints"
    if not root.is_dir():
        return
    # Snapshot before iterating so deletions during the walk do not raise.
    entries = sorted(p for p in root.iterdir() if p.is_dir() and not p.is_symlink())
    for entry in entries:
        if not re.fullmatch(r"\d+", entry.name):
            continue
        config_json = entry / "pretrained_model" / "config.json"
        if not config_json.is_file():
            continue
        if entry.name in seen:
            continue
        try:
            api.upload_folder(
                folder_path=str(entry),
                repo_id=repo_id,
                path_in_repo=f"checkpoints/{entry.name}",
                commit_message=f"checkpoint {entry.name}",
            )
            seen.add(entry.name)
            print(f"[wrapper] uploaded checkpoint {entry.name}", flush=True)
        except Exception as exc:
            print(f"[wrapper] upload failed for {entry.name}: {exc}", flush=True)


def _watch():
    while not stop_event.is_set():
        try:
            _scan_and_upload()
        except Exception as exc:
            print(f"[wrapper] scan error: {exc}", flush=True)
        stop_event.wait(15)


watch_thread = threading.Thread(target=_watch, name="ckpt-watcher", daemon=True)
watch_thread.start()

print(f"[wrapper] launching trainer: {' '.join(trainer_argv)}", flush=True)
proc = subprocess.Popen(list(trainer_argv), env=os.environ.copy())
try:
    rc = proc.wait()
finally:
    stop_event.set()
    # One final pass picks up any checkpoint saved in the last 15s window.
    try:
        _scan_and_upload()
    except Exception as exc:
        print(f"[wrapper] final scan error: {exc}", flush=True)

print(f"[wrapper] trainer exited with rc={rc}", flush=True)
sys.exit(rc)
'''

# HF Jobs' platform default timeout has killed legitimate runs that pushed
# the model successfully but were still uploading auxiliary files. 2h covers
# our typical ACT/SmolVLA runs on t4-small with comfortable headroom.
HF_JOB_TIMEOUT = "2h"

# Cadence at which the status poller hits inspect_job. inspect_job is the
# authoritative source for job liveness; the log stream is best-effort and
# may drop during long runs (NAT eviction, laptop sleep, proxy idle timeout)
# without the job actually ending.
_STATUS_POLL_INTERVAL_S = 5.0

# Stages we treat as terminal. Allowlist (not "anything except RUNNING") so
# freshly-submitted jobs in transient stages like QUEUED / BUILDING / STARTING
# aren't mistaken for failures before they get a chance to run.
_TERMINAL_STAGES = frozenset({"COMPLETED", "CANCELED", "ERROR", "DELETED"})

# How long _tail_loop waits before reconnecting after a clean stream end
# (gives the status poller a chance to confirm the job is actually terminal,
# so we don't reconnect and re-replay the entire buffered log).
_TAIL_CLEAN_END_WAIT_S = 15.0

# How long _tail_loop waits before reconnecting after an SSE exception
# (transient network blip during a long training).
_TAIL_RECONNECT_BACKOFF_S = 5.0


def resolve_wandb_api_key() -> str | None:
    """Look up the host's wandb API key for forwarding to a cloud job.

    Checks WANDB_API_KEY first, then falls back to ~/.netrc (where
    `wandb login` writes the key under machine api.wandb.ai). Returns None
    if neither source has it; the caller decides how to surface that.
    """
    key = os.environ.get("WANDB_API_KEY")
    if key:
        return key
    try:
        rc = netrc.netrc()
    except (FileNotFoundError, netrc.NetrcParseError, OSError):
        return None
    auth = rc.authenticators("api.wandb.ai")
    if auth is None:
        return None
    _login, _account, password = auth
    return password or None


class HfCloudJobRunner:
    """Run a training as an HF Jobs job. Single-shot — instantiate per job."""

    def __init__(
        self,
        metrics: TrainingMetrics,
        log_file_path: Path,
        flavor: str,
    ) -> None:
        self._metrics = metrics
        self._log_file_path = log_file_path
        self._flavor = flavor
        # Shared HfApi: its in-process whoami cache covers run_job's
        # internal self.whoami(token=...) call too (see utils/hf_auth.py),
        # so submitting many jobs doesn't hammer /whoami-v2.
        self._api = shared_hf_api()
        self._hf_job_id: str | None = None
        self._hf_job_url: str | None = None
        self._log_queue: Queue[LogLine] = Queue()
        self._tail_thread: threading.Thread | None = None
        # _status_thread polls inspect_job and is the sole writer of
        # _terminal_status (except for stop(), which pre-sets CANCELED).
        # Decoupling liveness from the log stream means a flaky SSE
        # connection no longer makes us declare a running job as failed.
        self._status_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._log_file = None  # type: ignore[assignment]
        # Cached terminal status once the job ends; None while live.
        self._terminal_status: str | None = None
        # Status.message at the terminal tick (e.g. "Job timeout"), so the
        # registry can surface it to the UI instead of a synthetic exit code.
        self._terminal_message: str | None = None
        self._wandb_run_url: str | None = None
        # Count of log lines processed across (possibly multiple) SSE
        # connections, so reconnects skip the replayed prefix.
        self._lines_processed: int = 0

    def start(self, job_id: str, config: TrainingRequest, output_dir: str) -> None:
        # output_dir is the host-local path the registry pins for local jobs;
        # it doesn't exist on the remote pod, so cloud jobs write to a
        # container-local path instead (checkpoints reach the UI via the Hub).
        del output_dir
        if self._hf_job_id is not None:
            raise RuntimeError("HfCloudJobRunner already started")

        token = get_token()
        if not token:
            raise RuntimeError("HF token not found. Run 'hf auth login' before launching cloud jobs.")

        whoami = cached_whoami()
        username = whoami.get("name") if whoami else None
        if not username:
            raise RuntimeError("Could not resolve HF username from whoami()")

        # Open the log file early so dataset-upload progress is recorded
        # before the cloud job is submitted.
        self._log_file_path.parent.mkdir(parents=True, exist_ok=True)
        self._log_file = self._log_file_path.open("a", buffering=1)

        # Cloud pods can't see the host's LeRobot cache. If the dataset
        # only exists locally, push it to the Hub before submitting.
        self._ensure_dataset_on_hub(config.dataset_repo_id)

        # Mutate the config so build_training_command emits the right flags.
        # The mutated config is what gets persisted in JobRecord.config, so
        # the historical record reflects what actually ran.
        config.policy_push_to_hub = True
        # job_id is already a unique slug like "act_dataset_2026-05-04_10-22-03".
        config.policy_repo_id = f"{username}/{job_id}"

        trainer_argv = build_training_command(config, _CONTAINER_OUTPUT_DIR)
        # The wrapper expects `python -c WRAPPER_SOURCE -- <trainer argv>`.
        # `python -c` consumes the first non-option argument as the script,
        # so we prepend a "--" sentinel of our own.
        wrapped_command = ["python", "-c", WRAPPER_SOURCE, "--", *trainer_argv]
        logger.info(
            "Submitting HF Cloud job %s on %s (wrapped trainer): %s",
            job_id,
            self._flavor,
            " ".join(trainer_argv),
        )

        # HF_TOKEN goes via `secrets` (not `env`) so it doesn't show up in
        # the job's environment variable inspection / logs.
        secrets = {"HF_TOKEN": token}
        if config.wandb_enable:
            wandb_key = resolve_wandb_api_key()
            if not wandb_key:
                # ValueError so main.py maps it to a 400 + detail the UI shows.
                raise ValueError(
                    "WANDB_API_KEY not found on this machine. "
                    "Run `wandb login` or export WANDB_API_KEY before launching "
                    "cloud jobs with W&B enabled."
                )
            secrets["WANDB_API_KEY"] = wandb_key

        job = self._api.run_job(
            image=LEROBOT_IMAGE,
            command=wrapped_command,
            flavor=self._flavor,
            secrets=secrets,
            timeout=HF_JOB_TIMEOUT,
        )
        self._hf_job_id = job.id
        self._hf_job_url = getattr(job, "url", None)

        self._start_worker_threads(job_id)

    def reattach(self, hf_job_id: str) -> None:
        """Take over an existing HF job after a process restart.

        Skips submission; just opens the log file in append mode and starts
        the log-tailing + status-polling threads.
        """
        if self._hf_job_id is not None:
            raise RuntimeError("HfCloudJobRunner already started")
        self._hf_job_id = hf_job_id
        self._log_file_path.parent.mkdir(parents=True, exist_ok=True)
        self._log_file = self._log_file_path.open("a", buffering=1)
        self._start_worker_threads(f"{hf_job_id}-reattach")

    def _start_worker_threads(self, label: str) -> None:
        """Start the log tail and status poll threads. Both run for the
        life of the runner; the status poller is what marks the job terminal."""
        self._tail_thread = threading.Thread(target=self._tail_loop, name=f"hf-job-{label}-logs", daemon=True)
        self._tail_thread.start()
        self._status_thread = threading.Thread(
            target=self._status_poll_loop, name=f"hf-job-{label}-status", daemon=True
        )
        self._status_thread.start()

    def _set_terminal(self, status: str, message: str | None = None) -> None:
        """Record the job's terminal stage. Idempotent. Wakes the tail loop."""
        if self._terminal_status is not None:
            return
        self._terminal_status = status
        if message:
            self._terminal_message = message
        self._stop_event.set()

    def _log_line(self, message: str) -> None:
        """Append a wrapper-style line to the job's log file."""
        if self._log_file is None:
            return
        line = LogLine(timestamp=time.time(), message=message)
        try:
            self._log_file.write(line.model_dump_json() + "\n")
        except Exception as exc:
            logger.warning("Could not write upload log line: %s", exc)

    def _ensure_dataset_on_hub(self, repo_id: str) -> None:
        """If the dataset is local-only, push it to the Hub.

        The cloud pod resolves the dataset by repo_id; it can't see the
        host's `~/.cache/huggingface/lerobot`. We push synchronously and
        let any failure bubble up — JobRegistry.start marks the record
        as failed with the exception message.
        """
        try:
            self._api.dataset_info(repo_id)
            return
        except RepositoryNotFoundError:
            pass

        cache_root = Path(os.environ.get("HF_LEROBOT_HOME", "~/.cache/huggingface/lerobot")).expanduser()
        if not (cache_root / repo_id / "meta" / "info.json").is_file():
            # Neither local nor on Hub. Let the trainer surface the error
            # — same behaviour as before.
            return

        self._log_line(f"[upload] dataset {repo_id} not on Hub; pushing local copy...")
        from lerobot.datasets import LeRobotDataset

        try:
            LeRobotDataset(repo_id).push_to_hub(tags=with_lelab_tag(None), private=False)
        except Exception as exc:
            msg = f"Failed to upload local dataset {repo_id} to Hub: {exc}"
            self._log_line(f"[upload] {msg}")
            raise RuntimeError(msg) from exc
        self._log_line(f"[upload] dataset {repo_id} uploaded.")

    def _tail_loop(self) -> None:
        """Stream HfApi.fetch_job_logs, teeing each line to disk and the
        in-memory queue. Reconnects on stream end or transient error while
        the status poller still says the job is alive — SSE death is no
        longer fatal. Exits when _stop_event is set (status poller saw a
        terminal stage, or stop() was called).
        """
        assert self._hf_job_id is not None
        try:
            while not self._stop_event.is_set():
                clean_end = False
                try:
                    seen = 0
                    for raw in self._api.fetch_job_logs(job_id=self._hf_job_id, follow=True):
                        if self._stop_event.is_set():
                            return
                        seen += 1
                        # Skip the replayed prefix from a reconnect.
                        if seen <= self._lines_processed:
                            continue
                        self._lines_processed = seen
                        stripped = raw.rstrip()
                        if not stripped:
                            continue
                        parse_metrics_into(stripped, self._metrics)
                        if self._wandb_run_url is None:
                            url = extract_wandb_run_url(stripped)
                            if url is not None:
                                self._wandb_run_url = url
                        log_line = LogLine(timestamp=time.time(), message=stripped)
                        if self._log_file is not None:
                            try:
                                self._log_file.write(log_line.model_dump_json() + "\n")
                            except Exception as exc:  # pragma: no cover
                                logger.exception("Error writing HF log: %s", exc)
                        if self._log_queue.qsize() >= 1000:
                            with contextlib.suppress(Empty):
                                self._log_queue.get_nowait()
                        self._log_queue.put(log_line)
                    clean_end = True
                except Exception as exc:
                    logger.info("HF log tail disconnected, will reconnect: %s", exc)

                wait_s = _TAIL_CLEAN_END_WAIT_S if clean_end else _TAIL_RECONNECT_BACKOFF_S
                if self._stop_event.wait(wait_s):
                    return
        finally:
            if self._log_file is not None:
                with contextlib.suppress(Exception):
                    self._log_file.close()
                self._log_file = None

    def _status_poll_loop(self) -> None:
        """Poll inspect_job until the job reaches a terminal stage.

        Sole writer of _terminal_status under normal operation. Decoupled
        from the log stream: a dropped SSE connection during a long run
        (NAT eviction, sleep, proxy idle timeout) no longer causes LeLab
        to declare a still-running job as failed.
        """
        assert self._hf_job_id is not None
        while not self._stop_event.is_set():
            try:
                info = self._api.inspect_job(job_id=self._hf_job_id)
                status_obj = getattr(info, "status", None)
                stage = getattr(status_obj, "stage", None) if status_obj is not None else None
                if stage is not None:
                    stage_str = str(stage).upper()
                    if stage_str in _TERMINAL_STAGES:
                        msg = getattr(status_obj, "message", None)
                        self._set_terminal(stage_str, str(msg) if msg else None)
                        return
            except Exception as exc:
                logger.warning("inspect_job poll failed for %s: %s", self._hf_job_id, exc)
            if self._stop_event.wait(_STATUS_POLL_INTERVAL_S):
                return

    def stop(self) -> None:
        if self._hf_job_id is None:
            return
        # Pre-set CANCELED so the watchdog finalises as canceled regardless
        # of whether the status poller observed a terminal stage first.
        self._set_terminal("CANCELED")
        try:
            self._api.cancel_job(job_id=self._hf_job_id)
        except Exception as exc:
            # Already-completed jobs may 404; that's fine.
            logger.info("cancel_job(%s) ignored: %s", self._hf_job_id, exc)

    def is_running(self) -> bool:
        # Liveness is driven by _status_poll_loop's inspect_job calls.
        if self._hf_job_id is None:
            return False
        return self._terminal_status is None

    def returncode(self) -> int | None:
        if self._terminal_status is None:
            return None
        return 0 if self._terminal_status == "COMPLETED" else 1

    def stream_log_lines(self) -> list[LogLine]:
        out: list[LogLine] = []
        try:
            while True:
                out.append(self._log_queue.get_nowait())
        except Empty:
            pass
        return out

    def hf_job_id(self) -> str | None:
        return self._hf_job_id

    def hf_job_url(self) -> str | None:
        return self._hf_job_url

    def wandb_run_url(self) -> str | None:
        return self._wandb_run_url

    def terminal_message(self) -> str | None:
        """Status.message captured when the job reached a terminal stage.

        Set by _status_poll_loop when it observes a terminal stage. Used by
        the registry watchdog to surface platform reasons like 'Job timeout'
        rather than a synthetic 'exit code 1'.
        """
        return self._terminal_message
