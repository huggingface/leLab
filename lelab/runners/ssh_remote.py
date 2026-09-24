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

"""SSH runner — runs a training on a server the user owns and controls
directly over SSH, rather than a HF-managed cloud container.

Deliberately makes no assumption about what's already set up on the remote
host (lerobot install, venv, CUDA...) — `SshConnectionConfig.remote_python_cmd`
is a free-form shell fragment the user provides, and lelab just uses SSH/scp
as a plain transport: sync the dataset up, run the training command remotely,
tail its output, pull checkpoints back down on request.

Known limitation: the dataset sync (`sync_dataset_up`) runs synchronously
before the training subprocess is spawned, so job start blocks the request
thread for as long as the scp takes — fine for a quick test dataset, but a
large video dataset could make the "start training" request hang for
minutes. Moving the sync into the background (state="staging" before
"running") is a reasonable follow-up once this has a real server to test
against.
"""

from __future__ import annotations

import logging
import shlex
import subprocess
from pathlib import Path

from ..jobs import SshConnectionConfig, SubprocessJobRunner, TrainingMetrics
from ..train import TrainingRequest, build_training_command

logger = logging.getLogger(__name__)

# No TTY is attached to these subprocess calls, so an interactive
# "authenticity of host ... can't be established, continue connecting?"
# prompt would hang forever. accept-new trusts (and pins) an unseen host key
# automatically but still rejects a *changed* one — same safety net `ssh`
# gives you interactively, minus the prompt.
_SSH_OPTS = ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes"]


def _resolve_local_dataset_root(config: TrainingRequest) -> Path:
    """Same default-local-directory logic as record.py's resume fix: an
    explicit dataset_root wins, otherwise fall back to the standard local
    cache location for this repo_id."""
    if config.dataset_root:
        return Path(config.dataset_root).expanduser().resolve()
    from lerobot.utils.constants import HF_LEROBOT_HOME

    return (Path(HF_LEROBOT_HOME) / config.dataset_repo_id).resolve()


def _ssh_base_args(ssh: SshConnectionConfig) -> list[str]:
    args = ["ssh", *_SSH_OPTS, "-p", str(ssh.port)]
    if ssh.ssh_key_path:
        args += ["-i", ssh.ssh_key_path]
    args.append(f"{ssh.username}@{ssh.host}")
    return args


def _scp_base_args(ssh: SshConnectionConfig) -> list[str]:
    # scp's port flag is -P (capital), unlike ssh's -p — easy to typo.
    args = ["scp", "-r", *_SSH_OPTS, "-P", str(ssh.port)]
    if ssh.ssh_key_path:
        args += ["-i", ssh.ssh_key_path]
    return args


def _run_ssh_command(ssh: SshConnectionConfig, remote_command: str, timeout: float = 20.0) -> str:
    """Run one short remote command over a fresh SSH connection and return
    its stdout. Raises RuntimeError with stderr on a non-zero exit."""
    result = subprocess.run(
        [*_ssh_base_args(ssh), remote_command],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ssh command failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout


def sync_dataset_up(ssh: SshConnectionConfig, local_root: Path, remote_datasets_dir: str) -> str:
    """scp -r the local dataset directory under remote_datasets_dir on the
    remote host. Returns the resulting remote dataset directory (mirrors
    local_root's own directory name, so this never has to guess the
    <org>/<name> split of a repo_id).

    No timeout: dataset video directories can be many GB, and this call is
    expected to block for a while — see the module docstring's caveat about
    that blocking the start-job request.
    """
    if not local_root.is_dir():
        raise FileNotFoundError(
            f"Dataset not found locally at {local_root} — record or download it before "
            "training on a remote server (lelab only syncs what's already on this machine)."
        )
    _run_ssh_command(ssh, f"mkdir -p {shlex.quote(remote_datasets_dir)}")
    scp_cmd = [*_scp_base_args(ssh), str(local_root), f"{ssh.username}@{ssh.host}:{remote_datasets_dir}/"]
    logger.info("Syncing dataset to remote host: %s", " ".join(scp_cmd))
    result = subprocess.run(scp_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"scp dataset sync failed ({result.returncode}): {result.stderr.strip()}")
    return f"{remote_datasets_dir}/{local_root.name}"


def pull_checkpoints(ssh: SshConnectionConfig, remote_output_dir: str, local_output_dir: str) -> None:
    """scp -r the remote checkpoints/ tree down into local_output_dir, so the
    existing local-checkpoint listing code (which just scans the filesystem)
    picks them up unchanged. Standalone function (not a method) so a fresh
    JobRegistry can pull checkpoints for a job whose SshRemoteJobRunner
    instance didn't survive a lelab restart — record.ssh_config /
    record.ssh_remote_dir are enough on their own.

    Best-effort: raises on any failure (missing remote dir before the first
    checkpoint is saved, network hiccup, ...) and the caller is expected to
    swallow it — see JobRegistry._maybe_pull_ssh_checkpoints.
    """
    Path(local_output_dir).mkdir(parents=True, exist_ok=True)
    remote_checkpoints_dir = f"{remote_output_dir}/checkpoints"
    scp_cmd = [
        *_scp_base_args(ssh),
        f"{ssh.username}@{ssh.host}:{remote_checkpoints_dir}",
        str(local_output_dir),
    ]
    result = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"scp checkpoint pull failed ({result.returncode}): {result.stderr.strip()}")


class SshRemoteJobRunner(SubprocessJobRunner):
    """Run a training on a user-owned remote server over SSH.

    Reuses SubprocessJobRunner's spawn/pump/parse pipeline exactly like
    HfCloudJobRunner does, but the tailed subprocess here is the local `ssh`
    client itself: its stdout mirrors the remote training command's stdout
    for as long as the SSH session stays open, so no separate "tail -f"
    round-trip is needed. `start_new_session=True` (set in `_spawn`) lets
    that local ssh client — and therefore the log stream — survive a uvicorn
    --reload the same way a local job's subprocess does.

    stop() has to reach the *remote* process explicitly: killing the local
    ssh client doesn't reliably propagate a signal to whatever it's running
    remotely. It pattern-matches the remote output dir (unique per job, since
    it's passed as --output_dir) via `pkill -f` over a fresh connection.
    """

    def __init__(
        self,
        metrics: TrainingMetrics,
        log_file_path: Path,
        ssh: SshConnectionConfig,
    ) -> None:
        super().__init__(metrics, log_file_path)
        self._ssh = ssh
        self._remote_output_dir: str | None = None

    def start(self, job_id: str, config: TrainingRequest, output_dir: str) -> None:
        # `output_dir` is the local path JobRegistry reserves for this job
        # (used later to land pulled-back checkpoints) — it's not a path on
        # the remote host, so the actual --output_dir the remote process gets
        # is a fresh one under the user's configured remote_workdir instead.
        local_dataset_root = _resolve_local_dataset_root(config)
        remote_datasets_dir = f"{self._ssh.remote_workdir}/datasets"
        remote_dataset_root = sync_dataset_up(self._ssh, local_dataset_root, remote_datasets_dir)

        remote_output_dir = f"{self._ssh.remote_workdir}/outputs/{job_id}"
        self._remote_output_dir = remote_output_dir

        remote_config = config.model_copy(update={"dataset_root": remote_dataset_root})

        # Build with a placeholder interpreter, then splice in
        # remote_python_cmd unquoted — it may be a shell fragment like
        # "source ~/venv/bin/activate && python", which shlex.quote would
        # otherwise mangle into a single inert token.
        cmd = build_training_command(remote_config, remote_output_dir, "__LELAB_PYEXEC__")
        assert cmd[0] == "__LELAB_PYEXEC__"
        quoted_rest = " ".join(shlex.quote(a) for a in cmd[1:])
        remote_train_cmd = f"{self._ssh.remote_python_cmd} {quoted_rest}"

        remote_shell = (
            f"mkdir -p {shlex.quote(remote_output_dir)} && "
            f"cd {shlex.quote(self._ssh.remote_workdir)} && "
            f"{remote_train_cmd}"
        )
        ssh_cmd = [*_ssh_base_args(self._ssh), remote_shell]
        logger.info("Starting ssh_remote job %s on %s: %s", job_id, self._ssh.host, remote_shell)
        self._spawn(ssh_cmd, thread_name=f"job-{job_id}-ssh")

    def remote_output_dir(self) -> str:
        assert self._remote_output_dir is not None, "remote_output_dir() called before start()"
        return self._remote_output_dir

    def stop(self) -> None:
        if self._remote_output_dir:
            try:
                _run_ssh_command(self._ssh, f"pkill -f {shlex.quote(self._remote_output_dir)}")
            except Exception as exc:
                # Already finished, or pkill matched nothing — fine either way.
                logger.info("Remote pkill for %s ignored: %s", self._remote_output_dir, exc)
        super().stop()
