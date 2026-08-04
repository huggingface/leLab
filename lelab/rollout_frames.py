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

"""lerobot_rollout wrapper with a live camera tee.

The rollout subprocess has exclusive access to the cameras (OpenCV/DSHOW),
so neither the LeLab server nor the browser can read them during inference.
This wrapper monkeypatches ``OpenCVCamera.async_read`` to also write each
camera's latest frame (throttled, atomically) as a JPEG under the directory
given by ``LELAB_DEMO_FRAMES_DIR``. The LeLab server then serves those files
to the demo page for a live preview.

The tee must never break the rollout: every failure path is swallowed.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from pathlib import Path

logger = logging.getLogger("lelab.rollout_frames")

_TEE_INTERVAL_S = 0.1  # ~10 fps is plenty for a preview
_JPEG_QUALITY = 80


class _Accum:
    """Thread-safe running total + count for a timed section."""

    def __init__(self) -> None:
        self.total = 0.0
        self.count = 0
        self.max = 0.0
        self._lock = threading.Lock()

    def add(self, dt: float) -> None:
        with self._lock:
            self.total += dt
            self.count += 1
            if dt > self.max:
                self.max = dt

    def drain(self) -> tuple[float, int, float]:
        with self._lock:
            avg = (self.total / self.count) if self.count else 0.0
            out = (avg, self.count, self.max)
            self.total = 0.0
            self.count = 0
            self.max = 0.0
            return out


def _install_profiler() -> None:
    """Time obs-gather, camera reads, and inference; log a summary each second.

    Enabled by LELAB_PROFILE=1. The variability of the rollout's control-loop
    rate (0.6-29 Hz in logs) points at an I/O stall rather than compute; this
    tells us definitively which stage costs the time.
    """
    if os.environ.get("LELAB_PROFILE") != "1":
        return
    try:
        cam_read = _Accum()
        obs_gather = _Accum()
        inference = _Accum()

        from lerobot.cameras.opencv import OpenCVCamera
        from lerobot.robots.so_follower import SO101Follower

        def time_method(cls, name, accum):
            orig = getattr(cls, name, None)
            if orig is None:
                return

            def wrapper(self, *args, **kwargs):
                t0 = time.perf_counter()
                try:
                    return orig(self, *args, **kwargs)
                finally:
                    accum.add((time.perf_counter() - t0) * 1000)

            setattr(cls, name, wrapper)

        time_method(OpenCVCamera, "read_latest", cam_read)
        time_method(SO101Follower, "get_observation", obs_gather)

        # Inference engine: time the per-tick get_action.
        try:
            from lerobot.rollout.inference.sync import SyncInferenceEngine

            time_method(SyncInferenceEngine, "get_action", inference)
        except Exception:
            pass

        def report_loop():
            while True:
                time.sleep(1.0)
                c_avg, c_n, c_max = cam_read.drain()
                o_avg, o_n, o_max = obs_gather.drain()
                i_avg, i_n, i_max = inference.drain()
                logger.warning(
                    "[PROFILE] obs_gather avg=%.0fms max=%.0fms n=%d | "
                    "cam_read avg=%.0fms max=%.0fms n=%d | "
                    "inference avg=%.0fms max=%.0fms n=%d",
                    o_avg, o_max, o_n, c_avg, c_max, c_n, i_avg, i_max, i_n,
                )

        threading.Thread(target=report_loop, name="lelab-profiler", daemon=True).start()
        logger.warning("[PROFILE] profiler installed")
    except Exception:
        pass


def _install_camera_tee() -> None:
    frames_dir = os.environ.get("LELAB_DEMO_FRAMES_DIR")
    if not frames_dir:
        return
    try:
        out_dir = Path(frames_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for stale in out_dir.glob("*.jpg"):
            stale.unlink(missing_ok=True)

        import cv2
        from lerobot.cameras.opencv import OpenCVCamera

        def _tee(cam, frame):
            try:
                now = time.time()
                if now - getattr(cam, "_lelab_tee_last", 0.0) >= _TEE_INTERVAL_S:
                    cam._lelab_tee_last = now
                    cam_id = getattr(cam.config, "index_or_path", "0")
                    target = out_dir / f"cam{cam_id}.jpg"
                    tmp = out_dir / f"cam{cam_id}.tmp.jpg"
                    # lerobot frames are RGB by default; cv2 writes BGR.
                    bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                    if cv2.imwrite(str(tmp), bgr, [cv2.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY]):
                        os.replace(tmp, target)
            except Exception:
                pass

        # The rollout control loop reads frames with read_latest(); setup and
        # warmup paths use async_read(). Tee both so the preview stays live
        # for the whole run.
        for method_name in ("async_read", "read_latest"):
            original = getattr(OpenCVCamera, method_name, None)
            if original is None:
                continue

            def make_wrapper(orig):
                def wrapper(self, *args, **kwargs):
                    frame = orig(self, *args, **kwargs)
                    if frame is not None:
                        _tee(self, frame)
                    return frame

                return wrapper

            setattr(OpenCVCamera, method_name, make_wrapper(original))
    except Exception:
        # Preview is best-effort; inference must run regardless.
        pass


def main() -> None:
    _install_camera_tee()
    _install_profiler()
    from lerobot.scripts.lerobot_rollout import main as rollout_main

    rollout_main()


if __name__ == "__main__":
    main()
