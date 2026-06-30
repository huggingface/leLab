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

"""HF Jobs runner — submits a training to HuggingFace's GPUs via LeRobot's
native remote-training feature (`lerobot-train --job.target=<flavor>`).

With the native feature the LOCAL machine runs `lerobot-train --job.target=...`;
that local process submits the job to HF Jobs and streams the remote pod's logs
to its own stdout. So the cloud path is "spawn a local subprocess and tail its
stdout" — the exact machinery LocalJobRunner already provides. This runner just
adds a stdout parser for the HF job id / page URL / model repo that lerobot's
`submit_to_hf` prints, and a stop() that cancels the remote job too.
"""

from __future__ import annotations

import contextlib
import logging
import re
import sys
import threading
import time
from pathlib import Path

from ..jobs import JobTarget, SubprocessJobRunner, TrainingMetrics
from ..train import TrainingRequest, build_training_command
from ..utils.hf_auth import shared_hf_api

logger = logging.getLogger(__name__)

# HF Jobs stages we treat as terminal (job is no longer making progress).
_TERMINAL_STAGES = frozenset({"COMPLETED", "CANCELED", "ERROR", "DELETED"})

# Min seconds between inspect_job calls on the reattach path. The watchdog calls
# is_running()/returncode() at ~1Hz; without throttling that hammers /jobs.
_STAGE_POLL_INTERVAL_S = 5.0

# Markers printed by lerobot's submit_to_hf (src/lerobot/jobs/hf.py). Kept in
# sync with the exact f-strings emitted on submission:
#   print(f"Job submitted: {job_id}")
#   print(f"  Job page:   {job_url}")
#   print(f"  Model repo: https://huggingface.co/{repo_id}")
_JOB_ID_RE = re.compile(r"^Job submitted:\s*(\S+)")
_JOB_PAGE_RE = re.compile(r"^\s*Job page:\s*(\S+)")
_MODEL_REPO_RE = re.compile(r"^\s*Model repo:\s*(https://huggingface\.co/\S+)")


class HfCloudJobRunner(SubprocessJobRunner):
    """Run a training on HF Jobs. Single-shot — instantiate per job.

    Reuses SubprocessJobRunner's spawn/pump/parse pipeline: the tailed
    subprocess is the local `lerobot-train --job.target=<flavor>` process,
    whose stdout carries both the remote training logs and the submission
    markers we parse for the HF job id / page URL / model repo.

    hf_job_id / hf_job_url / hf_repo_id are discovered ASYNCHRONOUSLY by
    parsing that local stdout (lerobot's submit_to_hf prints them a few
    seconds after start), so all three return None until the markers appear.
    JobRegistry._tick → _sync_cloud_ids polls the getters and persists the
    values onto the JobRecord once present.
    """

    def __init__(
        self,
        metrics: TrainingMetrics,
        log_file_path: Path,
        flavor: str,
    ) -> None:
        super().__init__(metrics, log_file_path)
        self._flavor = flavor
        self._hf_job_id: str | None = None
        self._hf_job_url: str | None = None
        self._hf_repo_id: str | None = None
        # Set on reattach so is_running()/returncode() derive liveness from the
        # remote job stage rather than the log stream (which just ends when the
        # job is terminal, carrying no exit code).
        self._reattached_job_id: str | None = None
        self._reattach_thread: threading.Thread | None = None
        # 5s-TTL cache over inspect_job for the reattach path.
        self._stage_cache: str | None = None
        self._stage_fetched_at: float = 0.0

    def start(self, job_id: str, config: TrainingRequest, output_dir: str) -> None:
        # The submission runs LOCALLY (lerobot's submit_to_hf), so the
        # subprocess must use lelab's own interpreter — same as LocalJobRunner.
        cmd = build_training_command(
            config,
            output_dir,
            sys.executable,
            job_target=JobTarget(runner="hf_cloud", flavor=self._flavor),
        )
        logger.info("Submitting HF Cloud job %s on %s: %s", job_id, self._flavor, " ".join(cmd))
        self._spawn(cmd, thread_name=f"hf-job-{job_id}-logs")

    def reattach(self, hf_job_id: str) -> None:
        """Take over an existing HF job after a uvicorn --reload restart.

        The local lerobot-train process that submitted the job is gone, but
        the remote job persists. We re-stream its logs via the always-available
        Python API HfApi.fetch_job_logs(follow=True) in a daemon thread feeding
        the SAME _consume_lines pipeline as the subprocess path — no dependency
        on the `hf` CLI being on PATH. A terminal job's follow stream just ends;
        liveness/outcome are read from inspect_job in is_running()/returncode().
        """
        self._hf_job_id = hf_job_id
        self._reattached_job_id = hf_job_id
        self._open_log_file()
        self._reattach_thread = threading.Thread(
            target=self._stream_remote_logs, name=f"hf-job-{hf_job_id}-reattach", daemon=True
        )
        self._reattach_thread.start()

    def _stream_remote_logs(self) -> None:
        """Feed the remote job's followed log stream into _consume_lines.
        fetch_job_logs yields text lines and ends when the job is terminal; if
        it raises (job already gone / transient error) we log and stop — the
        terminal state is still recoverable via inspect_job."""
        try:
            lines = shared_hf_api().fetch_job_logs(job_id=self._reattached_job_id, follow=True)
        except Exception as exc:
            logger.warning("fetch_job_logs(%s) failed on reattach: %s", self._reattached_job_id, exc)
            if self._log_file is not None:
                with contextlib.suppress(Exception):
                    self._log_file.close()
                self._log_file = None
            return
        self._consume_lines(lines)

    def _on_line(self, line: str) -> None:
        if self._hf_job_id is None:
            m = _JOB_ID_RE.match(line)
            if m:
                self._hf_job_id = m.group(1)
        if self._hf_job_url is None:
            m = _JOB_PAGE_RE.match(line)
            if m:
                self._hf_job_url = m.group(1)
        if self._hf_repo_id is None:
            m = _MODEL_REPO_RE.match(line)
            if m:
                # Store the bare repo id; the rest of lelab keys checkpoints on it.
                self._hf_repo_id = m.group(1).removeprefix("https://huggingface.co/")

    def stop(self) -> None:
        # Signal the consumer to break, then on the start path kill the local
        # lerobot-train subprocess (graceful→force via the shared impl). The
        # reattach path has no subprocess; setting the event unblocks
        # _consume_lines on its next yield. Either way the local side only
        # detaches the log stream, so also cancel the remote job if we have its id.
        self._stop_event.set()
        super().stop()
        if self._hf_job_id is not None:
            try:
                shared_hf_api().cancel_job(job_id=self._hf_job_id)
            except Exception as exc:
                # Already-finished jobs may 404; that's fine.
                logger.info("cancel_job(%s) ignored: %s", self._hf_job_id, exc)

    def is_running(self) -> bool:
        if self._reattached_job_id is None:
            return super().is_running()
        # Reattach: the followed log stream ending doesn't mean the run is over,
        # and a terminal run may keep it open during finalization. inspect_job
        # is authoritative.
        return self._remote_stage() not in _TERMINAL_STAGES

    def returncode(self) -> int | None:
        if self._reattached_job_id is None:
            return super().returncode()
        stage = self._remote_stage()
        if stage not in _TERMINAL_STAGES:
            return None
        return 0 if stage == "COMPLETED" else 1

    def hf_job_id(self) -> str | None:
        return self._hf_job_id

    def hf_job_url(self) -> str | None:
        return self._hf_job_url

    def hf_repo_id(self) -> str | None:
        return self._hf_repo_id

    # -- internals --

    def _remote_stage(self) -> str | None:
        """Current HF Jobs stage for the reattached job, upper-cased, or None
        if it can't be resolved (transient API error → treated as running).
        Cached for _STAGE_POLL_INTERVAL_S so the ~1Hz watchdog doesn't spam
        inspect_job."""
        now = time.time()
        if now - self._stage_fetched_at < _STAGE_POLL_INTERVAL_S:
            return self._stage_cache
        self._stage_fetched_at = now
        try:
            info = shared_hf_api().inspect_job(job_id=self._reattached_job_id)
            status_obj = getattr(info, "status", None)
            stage = getattr(status_obj, "stage", None) if status_obj is not None else None
            # huggingface_hub may give a plain str ("COMPLETED") or a JobStage enum;
            # unwrap the enum so `str(...).upper()` yields the bare value, not
            # "JOBSTAGE.COMPLETED" (which would never match _TERMINAL_STAGES).
            stage = getattr(stage, "value", stage)
            self._stage_cache = str(stage).upper() if stage is not None else None
        except Exception as exc:
            logger.warning("inspect_job poll failed for %s: %s", self._reattached_job_id, exc)
            self._stage_cache = None
        return self._stage_cache
