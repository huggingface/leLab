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

import contextlib
import importlib.util
import logging
import queue
import shutil
import subprocess
import sys
import threading
import time
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# Cached at module load — never re-checked. After install, the user must
# restart lelab for a freshly-installed package to be importable.
TRAINING_AVAILABLE: bool = importlib.util.find_spec("accelerate") is not None
TRAINING_INSTALL_HINT: str = "pip install accelerate"

WANDB_AVAILABLE: bool = importlib.util.find_spec("wandb") is not None
WANDB_INSTALL_HINT: str = "pip install wandb"


def _build_install_cmd(package: str) -> list[str]:
    """Pick the best installer for the running Python.

    Venvs created with `uv venv` don't ship pip, so `python -m pip` fails with
    `No module named pip`. Detect uv on PATH and use it with --python pinned to
    sys.executable so the install lands in this Python's site-packages.
    Otherwise fall back to `python -m pip`.
    """
    if shutil.which("uv"):
        return ["uv", "pip", "install", "--python", sys.executable, package]
    return [sys.executable, "-m", "pip", "install", package]


class ExtraStatus(BaseModel):
    available: bool
    install_hint: str


class CudaStatus(BaseModel):
    gpu_present: bool
    cuda_available: bool
    mismatch: bool
    torch_version: str | None = None
    install_hint: str
    docs_url: str


class InstallStartResponse(BaseModel):
    started: bool
    message: str


class InstallStatusResponse(BaseModel):
    state: str  # "idle" | "installing" | "done" | "error"
    error: str | None = None
    logs: list[dict[str, Any]] = []


class InstallManager:
    def __init__(self, package: str) -> None:
        self.package = package
        self.state: str = "idle"
        self.error: str | None = None
        self.process: subprocess.Popen | None = None
        self.log_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self.state == "installing":
                return {"started": False, "message": "Install already in progress"}
            # Reset for a fresh attempt (covers retry from done/error/idle).
            self.state = "installing"
            self.error = None
            self._drain_queue()

        try:
            self.process = subprocess.Popen(
                _build_install_cmd(self.package),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1,
            )
        except Exception as exc:
            logger.exception("Failed to spawn pip subprocess")
            with self._lock:
                self.state = "error"
                self.error = f"Failed to spawn pip: {exc}"
            return {"started": False, "message": str(exc)}

        self._thread = threading.Thread(target=self._monitor, daemon=True)
        self._thread.start()
        return {"started": True, "message": "Install started"}

    def get_status(self) -> dict[str, Any]:
        logs: list[dict[str, Any]] = []
        try:
            while not self.log_queue.empty():
                logs.append(self.log_queue.get_nowait())
        except queue.Empty:
            pass
        return {"state": self.state, "error": self.error, "logs": logs}

    def _monitor(self) -> None:
        assert self.process is not None
        try:
            for line in iter(self.process.stdout.readline, ""):
                if not line:
                    break
                self._enqueue(line.rstrip())
        except Exception as exc:
            logger.exception("Error reading pip output")
            self._enqueue(f"[install-monitor] error reading output: {exc}")

        self.process.wait()
        return_code = self.process.returncode
        with self._lock:
            if return_code == 0:
                self.state = "done"
                self.error = None
            else:
                self.state = "error"
                self.error = f"pip exited with code {return_code}"

    def _enqueue(self, message: str) -> None:
        # Cap queue size so a chatty pip can't grow memory unbounded.
        if self.log_queue.qsize() >= 1000:
            with contextlib.suppress(queue.Empty):
                self.log_queue.get_nowait()
        self.log_queue.put({"timestamp": time.time(), "message": message})

    def _drain_queue(self) -> None:
        try:
            while not self.log_queue.empty():
                self.log_queue.get_nowait()
        except queue.Empty:
            pass


training_install_manager = InstallManager("accelerate")
wandb_install_manager = InstallManager("wandb")


def handle_get_training_extra() -> dict[str, Any]:
    return {"available": TRAINING_AVAILABLE, "install_hint": TRAINING_INSTALL_HINT}


def handle_install_training_extra() -> dict[str, Any]:
    return training_install_manager.start()


def handle_install_training_extra_status() -> dict[str, Any]:
    return training_install_manager.get_status()


def handle_get_wandb_extra() -> dict[str, Any]:
    return {"available": WANDB_AVAILABLE, "install_hint": WANDB_INSTALL_HINT}


def handle_install_wandb_extra() -> dict[str, Any]:
    return wandb_install_manager.start()


def handle_install_wandb_extra_status() -> dict[str, Any]:
    return wandb_install_manager.get_status()


# --------------------------------------------------------------------------- #
# Policy extras
# --------------------------------------------------------------------------- #
# Some LeRobot policies import an optional extra at construction time; training
# (or inference) otherwise dies with a buried ImportError once the subprocess is
# already running. Map each such policy to the module we probe and the
# ``pip install lerobot[extra]`` target. Policies not listed (act, vqbet, tdmpc,
# sac, reward_classifier) need nothing extra.
POLICY_EXTRAS: dict[str, tuple[str, str]] = {
    # policy_type: (probe_module, install_target)
    "smolvla": ("transformers", "lerobot[smolvla]"),
    "pi0": ("transformers", "lerobot[pi]"),
    "pi0_fast": ("transformers", "lerobot[pi]"),
    "diffusion": ("diffusers", "lerobot[diffusion]"),
}

# One install manager per install target (lerobot[smolvla] / lerobot[pi] / …),
# created lazily so pi0 and pi0_fast share the lerobot[pi] install.
_policy_install_managers: dict[str, InstallManager] = {}


def _policy_install_manager(policy_type: str) -> InstallManager | None:
    spec = POLICY_EXTRAS.get(policy_type)
    if spec is None:
        return None
    target = spec[1]
    mgr = _policy_install_managers.get(target)
    if mgr is None:
        mgr = InstallManager(target)
        _policy_install_managers[target] = mgr
    return mgr


def handle_get_policy_extra(policy_type: str) -> dict[str, Any]:
    """Whether the optional extra a policy needs is importable right now.

    Probed live (not cached at import) so a restart after installing is picked
    up. Policies that need nothing report ``available`` so the UI never blocks
    them.
    """
    spec = POLICY_EXTRAS.get(policy_type)
    if spec is None:
        return {
            "policy_type": policy_type,
            "needs_extra": False,
            "available": True,
            "package": "",
            "install_target": "",
            "install_hint": "",
        }
    probe, target = spec
    try:
        available = importlib.util.find_spec(probe) is not None
    except (ImportError, ValueError):
        available = False
    return {
        "policy_type": policy_type,
        "needs_extra": True,
        "available": available,
        "package": probe,
        "install_target": target,
        "install_hint": f"pip install '{target}'",
    }


def handle_install_policy_extra(policy_type: str) -> dict[str, Any]:
    mgr = _policy_install_manager(policy_type)
    if mgr is None:
        return {"started": False, "message": f"'{policy_type}' needs no extra package."}
    return mgr.start()


def handle_install_policy_extra_status(policy_type: str) -> dict[str, Any]:
    mgr = _policy_install_manager(policy_type)
    if mgr is None:
        return {"state": "done", "error": None, "logs": []}
    return mgr.get_status()


# Detect the common Windows/LeLab mismatch where an NVIDIA GPU is visible to the
# OS, but the active PyTorch build cannot use CUDA. Do not auto-install torch.

CUDA_TORCH_DOCS_URL = "https://pytorch.org/get-started/locally/"
CUDA_TORCH_INSTALL_HINT = (
    "To use the GPU, install a CUDA build of PyTorch. Pick your CUDA version at "
    f"{CUDA_TORCH_DOCS_URL} "
    "(for example: pip install torch --index-url https://download.pytorch.org/whl/cu124), "
    "then restart LeLab."
)


def _nvidia_gpu_present() -> bool:
    """True if an NVIDIA GPU is visible to the OS (``nvidia-smi -L`` lists one).

    Dependency-free and cheap: requires nvidia-smi on PATH, then confirms it
    actually reports a GPU. Any failure (no driver, no GPU, timeout) → False.
    """
    if not shutil.which("nvidia-smi"):
        return False
    try:
        result = subprocess.run(
            ["nvidia-smi", "-L"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip().startswith("GPU")


def _torch_cuda() -> tuple[bool, str | None]:
    """Return (cuda_available, torch_version). Missing/broken torch → (False, None)."""
    try:
        import torch
    except Exception:  # torch absent or import error — treat as no CUDA
        logger.debug("torch import failed during CUDA check", exc_info=True)
        return False, None
    try:
        return bool(torch.cuda.is_available()), torch.__version__
    except Exception:
        logger.debug("torch.cuda.is_available() raised", exc_info=True)
        return False, getattr(torch, "__version__", None)


def detect_cuda_status() -> dict[str, Any]:
    """Detect the 'NVIDIA GPU present but PyTorch is CPU-only' mismatch (issue #30)."""
    gpu_present = _nvidia_gpu_present()
    cuda_available, torch_version = _torch_cuda()
    return {
        "gpu_present": gpu_present,
        "cuda_available": cuda_available,
        "mismatch": gpu_present and not cuda_available,
        "torch_version": torch_version,
        "install_hint": CUDA_TORCH_INSTALL_HINT,
        "docs_url": CUDA_TORCH_DOCS_URL,
    }


def handle_get_cuda_status() -> dict[str, Any]:
    return detect_cuda_status()


def warn_if_cuda_mismatch() -> None:
    """Log a prominent warning when a GPU is present but torch is CPU-only.

    Called at server startup so the user sees actionable guidance in the same
    terminal where LeRobot's easily-missed 'Switching to cpu' line appears.
    """
    status = detect_cuda_status()
    if not status["mismatch"]:
        return
    logger.warning(
        "⚠️  NVIDIA GPU detected but PyTorch can't use CUDA (torch=%s). "
        "Training and inference will run on CPU and may be much slower. %s",
        status["torch_version"],
        status["install_hint"],
    )
