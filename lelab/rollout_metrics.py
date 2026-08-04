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

"""lerobot_rollout wrapper that measures the real control-loop rate.

lerobot logs a warning when the control loop misses its target rate, but only
per missed iteration and only into the inference log. A run that quietly drops
from 30 Hz to 10 Hz therefore looks, in the UI, exactly like one that holds —
which matters, because a policy behaves differently when it is stepped at a
fraction of the rate it was trained at.

Rather than patch lerobot, this wrapper counts ``ThreadSafeRobot.get_observation``
calls: the rollout control loop makes exactly one per iteration, so counting
them over a window *is* the loop rate. One ``[LELAB_FPS]`` line is printed per
second; ``lelab/rollout.py``'s stdout pump parses it and exposes the numbers on
``/inference-status``.

Metering must never break the rollout: every failure path is swallowed, and a
run whose meter fails to install simply reports no rate.
"""

from __future__ import annotations

import threading
import time

_RATE_WINDOW_S = 1.0  # matches the UI's 1 Hz status poll


class _RateMeter:
    """Counts control-loop ticks and the worst gap between two of them.

    A window is timed from its own first to its own last tick, not by the
    reporter's wall clock: a window the loop only half-filled (it just started,
    or the run just ended) then reports the rate it actually saw instead of a
    phantom slowdown."""

    def __init__(self) -> None:
        self.ticks = 0
        self.max_gap = 0.0
        self._first: float | None = None
        self._newest: float | None = None
        # Kept across drains so a gap straddling two windows is still measured.
        self._last: float | None = None
        self._lock = threading.Lock()

    def tick(self, now: float) -> None:
        with self._lock:
            if self._last is not None:
                gap = now - self._last
                if gap > self.max_gap:
                    self.max_gap = gap
            self._last = now
            if self._first is None:
                self._first = now
            self._newest = now
            self.ticks += 1

    def drain(self) -> tuple[int, float, float]:
        """(ticks, seconds spanned by those ticks, worst gap)."""
        with self._lock:
            span = (self._newest - self._first) if self.ticks >= 2 else 0.0
            out = (self.ticks, span, self.max_gap)
            self.ticks = 0
            self.max_gap = 0.0
            self._first = None
            self._newest = None
            return out


def _install_rate_meter() -> None:
    """Report the real control-loop rate once a second on stdout."""
    try:
        from lerobot.rollout.robot_wrapper import ThreadSafeRobot

        meter = _RateMeter()
        original = ThreadSafeRobot.get_observation

        def get_observation(self, *args, **kwargs):
            try:
                return original(self, *args, **kwargs)
            finally:
                meter.tick(time.perf_counter())

        ThreadSafeRobot.get_observation = get_observation

        def report_loop() -> None:
            total_ticks, intervals, measured = 0, 0, 0.0
            worst_fps: float | None = None
            worst_gap = 0.0
            started = False
            while True:
                time.sleep(_RATE_WINDOW_S)
                ticks, span, max_gap = meter.drain()
                # Under two ticks means the control loop isn't running: setup,
                # or the run has ended. Nothing to report, and staying quiet is
                # what lets the server flag the sample stale.
                if ticks < 2 or span <= 0:
                    continue
                # Setup takes one observation of its own and the first live
                # window straddles warmup; both would smear the average, so
                # discard the first window that looks like a running loop.
                if not started:
                    started = True
                    continue
                total_ticks += ticks
                intervals += ticks - 1
                measured += span
                fps_now = (ticks - 1) / span
                worst_fps = fps_now if worst_fps is None else min(worst_fps, fps_now)
                worst_gap = max(worst_gap, max_gap)
                # print(), not logger: this must reach stdout whatever lerobot's
                # init_logging() decided, and the server tees stdout to the log
                # file anyway, so the run stays diagnosable after the fact.
                print(
                    f"[LELAB_FPS] now={fps_now:.1f} avg={intervals / measured:.1f} "
                    f"min={worst_fps:.1f} gap={worst_gap * 1000:.0f} n={total_ticks}",
                    flush=True,
                )

        threading.Thread(target=report_loop, name="lelab-rate-meter", daemon=True).start()
    except Exception:
        # Telemetry is best-effort; inference must run regardless.
        pass


def main() -> None:
    _install_rate_meter()
    from lerobot.scripts.lerobot_rollout import main as rollout_main

    rollout_main()


if __name__ == "__main__":
    main()
