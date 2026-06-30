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
"""Tests for lelab.runners.hf_cloud.

With LeRobot's native remote-training feature, HfCloudJobRunner is a thin
subprocess tailer: it runs `lerobot-train --job.target=<flavor>` locally and
parses the submission markers lerobot prints to stdout. The credential / dataset
/ checkpoint-upload work is now lerobot's. The unit-testable surface is the
stdout parser (`_on_line`) — it must stay in lockstep with the exact strings
lerobot's submit_to_hf emits. Submission against HF Jobs is left to integration
tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from lelab.jobs import TrainingMetrics
from lelab.runners.hf_cloud import HfCloudJobRunner


def _runner(tmp_path: Path) -> HfCloudJobRunner:
    return HfCloudJobRunner(TrainingMetrics(), tmp_path / "log.jsonl", flavor="t4-small")


def _stage_info(stage: str) -> MagicMock:
    """A fake huggingface_hub JobInfo with .status.stage."""
    info = MagicMock()
    info.status.stage = stage
    return info


def test_on_line_parses_submission_markers(tmp_path: Path) -> None:
    """Feed the exact lines lerobot's submit_to_hf prints and assert the
    runner picks up the job id, page URL, and (bare) model repo id."""
    runner = _runner(tmp_path)
    for line in [
        "Submitting job to HF Jobs (flavor=t4-small, image=huggingface/lerobot-gpu:latest) ...",
        "Job submitted: 0123abcd",
        "  Job page:   https://huggingface.co/jobs/me/0123abcd",
        "  Model repo: https://huggingface.co/me/act_dataset_2026-06-30",
        "  Monitor:    hf jobs logs 0123abcd",
    ]:
        runner._on_line(line)

    assert runner.hf_job_id() == "0123abcd"
    assert runner.hf_job_url() == "https://huggingface.co/jobs/me/0123abcd"
    assert runner.hf_repo_id() == "me/act_dataset_2026-06-30"


def test_on_line_ignores_unrelated_lines(tmp_path: Path) -> None:
    runner = _runner(tmp_path)
    runner._on_line("INFO step:250 loss:0.42 lr:1e-4")
    runner._on_line("Training:   1%| | 125/10000 [02:02<2:36:10,  1.05step/s]")

    assert runner.hf_job_id() is None
    assert runner.hf_job_url() is None
    assert runner.hf_repo_id() is None


def test_on_line_keeps_first_job_id(tmp_path: Path) -> None:
    """Once parsed, ids are sticky — a later spurious match must not clobber."""
    runner = _runner(tmp_path)
    runner._on_line("Job submitted: first")
    runner._on_line("Job submitted: second")
    assert runner.hf_job_id() == "first"


# -- reattach: re-stream remote logs via the Python API (no `hf` CLI) ----------


def test_reattach_streams_remote_logs_through_pipeline(tmp_path: Path) -> None:
    """reattach() must re-stream the job's logs via HfApi.fetch_job_logs(follow=True)
    — not the `hf` CLI — feeding the same parse/persist/queue pipeline as the
    subprocess path: markers parsed, metrics updated, lines queued + persisted."""
    runner = _runner(tmp_path)
    remote_lines = [
        "Job submitted: jb_42\n",
        "  Model repo: https://huggingface.co/me/act_run\n",
        "INFO step:250 loss:0.42 lr:1e-4\n",
    ]
    api = MagicMock()
    api.fetch_job_logs.return_value = iter(remote_lines)

    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.reattach("jb_42")
        assert runner._reattach_thread is not None
        runner._reattach_thread.join(timeout=5)

    api.fetch_job_logs.assert_called_once_with(job_id="jb_42", follow=True)
    assert runner.hf_repo_id() == "me/act_run"  # parsed from the streamed marker
    assert runner._metrics.current_step == 250  # metrics parsed from the streamed line
    messages = [line.message for line in runner.stream_log_lines()]
    assert "Job submitted: jb_42" in messages
    assert (tmp_path / "log.jsonl").exists()  # lines were persisted


def test_reattach_survives_fetch_job_logs_error(tmp_path: Path) -> None:
    """If the job is already gone, fetch_job_logs raises; reattach must not crash."""
    runner = _runner(tmp_path)
    api = MagicMock()
    api.fetch_job_logs.side_effect = RuntimeError("job not found")

    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.reattach("gone")
        assert runner._reattach_thread is not None
        runner._reattach_thread.join(timeout=5)

    assert runner.stream_log_lines() == []  # nothing queued, no exception escaped


# -- stop(): cancel the remote job too -----------------------------------------


def test_stop_cancels_remote_job_when_id_known(tmp_path: Path) -> None:
    runner = _runner(tmp_path)
    runner._hf_job_id = "jb_99"
    api = MagicMock()
    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.stop()
    api.cancel_job.assert_called_once_with(job_id="jb_99")


def test_stop_without_id_does_not_cancel(tmp_path: Path) -> None:
    """Before the submission marker is parsed there is no id; stop() must not
    call cancel_job (killing only the local tail would leave the pod running,
    but there is nothing we can cancel yet) and must not raise."""
    runner = _runner(tmp_path)
    assert runner.hf_job_id() is None
    api = MagicMock()
    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.stop()
    api.cancel_job.assert_not_called()


def test_stop_ignores_cancel_job_failure(tmp_path: Path) -> None:
    """An already-finished job 404s on cancel; stop() must swallow it."""
    runner = _runner(tmp_path)
    runner._hf_job_id = "done"
    api = MagicMock()
    api.cancel_job.side_effect = RuntimeError("404 not found")
    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.stop()  # must not raise


# -- reattach liveness/returncode derived from the remote stage ----------------


def test_reattach_stage_maps_to_liveness_and_returncode(tmp_path: Path) -> None:
    """On the reattach path, inspect_job's stage is authoritative: non-terminal
    → running/None; COMPLETED → done/0; ERROR or CANCELED → done/1."""
    runner = _runner(tmp_path)
    runner._reattached_job_id = "jb_1"  # force the reattach branch
    api = MagicMock()

    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner._stage_fetched_at = 0.0
        api.inspect_job.return_value = _stage_info("RUNNING")
        assert runner.is_running() is True
        runner._stage_fetched_at = 0.0
        assert runner.returncode() is None

        runner._stage_fetched_at = 0.0
        api.inspect_job.return_value = _stage_info("COMPLETED")
        assert runner.is_running() is False
        runner._stage_fetched_at = 0.0
        assert runner.returncode() == 0

        for bad in ("ERROR", "CANCELED"):
            runner._stage_fetched_at = 0.0
            api.inspect_job.return_value = _stage_info(bad)
            assert runner.is_running() is False
            runner._stage_fetched_at = 0.0
            assert runner.returncode() == 1


def test_reattach_stage_poll_is_throttled(tmp_path: Path) -> None:
    """inspect_job is cached for the poll interval so the ~1Hz watchdog calling
    is_running()/returncode() repeatedly doesn't hammer the /jobs API."""
    runner = _runner(tmp_path)
    runner._reattached_job_id = "jb_1"
    api = MagicMock()
    api.inspect_job.return_value = _stage_info("RUNNING")
    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        runner.is_running()
        runner.is_running()
        runner.returncode()
    api.inspect_job.assert_called_once()  # subsequent calls hit the TTL cache


def test_reattach_handles_jobstage_enum(tmp_path: Path) -> None:
    """huggingface_hub may return status.stage as a JobStage enum rather than a
    str. _remote_stage must unwrap `.value`; otherwise str(enum).upper() yields
    'JOBSTAGE.COMPLETED', never matches a terminal stage, and the reattached job
    is stranded as 'running' forever."""
    from enum import Enum

    class _JobStage(Enum):
        COMPLETED = "COMPLETED"

    runner = _runner(tmp_path)
    runner._reattached_job_id = "jb_1"
    api = MagicMock()
    info = MagicMock()
    info.status.stage = _JobStage.COMPLETED
    api.inspect_job.return_value = info
    with patch("lelab.runners.hf_cloud.shared_hf_api", return_value=api):
        assert runner.is_running() is False
        runner._stage_fetched_at = 0.0
        assert runner.returncode() == 0
