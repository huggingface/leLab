# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

LeLab is a FastAPI + React web interface wrapping the [LeRobot](https://github.com/huggingface/lerobot) framework for the SO-101 leader/follower arm. It exposes teleoperation, dataset recording, calibration, replay, and training as HTTP/WebSocket endpoints, replacing LeRobot's CLI + keyboard-driven flows.

The frontend (React + Vite) lives in [`frontend/`](frontend/). The built bundle in [`frontend/dist/`](frontend/dist/) is committed and shipped inside the Python wheel as package data (`frontend.__init__.py` makes setuptools treat it as a package); [`app/main.py`](app/main.py) mounts it as `StaticFiles` at `/` so a single `lelab` process serves both API and UI on `:8000`. The `frontend/` directory is also force-pushed to the [LeLab HF Space](https://huggingface.co/spaces/lerobot/LeLab) by [`.github/workflows/sync_space.yml`](.github/workflows/sync_space.yml) — that's a separate runtime; the Space builds the [Dockerfile](frontend/Dockerfile) (which runs `npm run build` again, so committed `dist/` doesn't matter to it).

## Common commands

Install (editable, requires Python ≥3.10):
```bash
pip install -e .
```
This pulls `lerobot` directly from GitHub (`git+https://github.com/huggingface/lerobot.git`) — installs are slow.

Run servers (entry point defined in [pyproject.toml](pyproject.toml)):
```bash
lelab          # uvicorn on :8000, serves built frontend at /, opens browser
lelab --dev    # spawns Vite dev (:8080) + uvicorn --reload (:8000), opens browser to :8080
```

After touching anything in `frontend/src/`, run `cd frontend && npm run build` to refresh the committed `frontend/dist/` (which ships in the wheel). `lelab --dev` doesn't need this — it serves directly from Vite.

There is **no test suite, no linter config, and no build step** in this repo. Validate changes by running `lelab` and exercising endpoints (curl or via the frontend).

## Architecture

### Backend module layout (`app/`)

[main.py](app/main.py) is a thin FastAPI router. Each feature lives in its own module that owns its global state and exposes `handle_*` functions plus a Pydantic request model:

- [recording.py](app/recording.py) — dataset recording (wraps `lerobot.record.record`); patches `lerobot.common.utils.control_utils` keyboard listener so frontend buttons replace arrow-key controls.
- [teleoperating.py](app/teleoperating.py) — leader→follower teleoperation (wraps `lerobot.teleoperate`).
- [calibrating.py](app/calibrating.py) — step-by-step web calibration with a `CalibrationManager` singleton and `_step_complete` threading.Event.
- [replaying.py](app/replaying.py) — replay recorded episodes on the follower.
- [training.py](app/training.py) — wraps the LeRobot training CLI as a subprocess (psutil for lifecycle, queue for log streaming).
- [config.py](app/config.py) — shared paths and persistence: calibration JSON, saved ports, saved config selections. **Import shared constants from here, do not hardcode paths in feature modules.**

### State model

Each feature module owns module-level globals (e.g. `recording_active`, `teleoperation_active`, `current_robot`) protected by threads/locks where needed. There's no shared session object — features are mutually exclusive in practice (you can't teleoperate and record simultaneously) but this is **not** enforced in code.

### WebSocket broadcast

[main.py](app/main.py#L104-L206) defines a single `ConnectionManager` with a background `_broadcast_worker` thread that drains a `queue.Queue` and forwards joint data to all `/ws/joint-data` clients via a thread-local asyncio loop. Feature modules get the manager passed in (e.g. `handle_start_teleoperation(request, manager)`) and call `manager.broadcast_joint_data_sync(data)` from their worker threads. Don't `await` from these threads — use the sync queue method.

### Persistent state on disk

All under `~/.cache/huggingface/lerobot/` (managed in [config.py](app/config.py)):
- `calibration/teleoperators/so101_leader/*.json` — leader calibration files (also called "teleop")
- `calibration/robots/so101_follower/*.json` — follower calibration files (also called "robot")
- `ports/{leader,follower}_port.txt` — last-used serial ports
- `saved_configs/{leader,follower}_config.txt` — last-selected config name

`device_type` in API requests is `"teleop"` or `"robot"` (mapped to leader/follower paths). `robot_type` in port endpoints is `"leader"` or `"follower"`. Don't conflate the two vocabularies.

### Calibration files: dual-location pattern

[setup_calibration_files](app/config.py#L30-L74) copies user-selected configs from `LEADER_CONFIG_PATH` / `FOLLOWER_CONFIG_PATH` into LeRobot's expected locations under `~/.cache/huggingface/lerobot/calibration/`. Recording, teleoperation, and replay all call this before starting. New features that drive a robot must do the same.

## Hardware target

Hardcoded for **SO-101 leader/follower arms** (`so101_leader`, `so101_follower`). Adding another robot type requires touching every feature module's config construction (search for `SO101LeaderConfig` / `SO101FollowerConfig`).

## Phone camera / HTTPS

Phone-as-camera streaming requires HTTPS. See [PHONE_CAMERA_SETUP.md](PHONE_CAMERA_SETUP.md) and [HTTPS_SETUP.md](HTTPS_SETUP.md). Self-signed certs go in `certs/`. The default `lelab-fullstack` does **not** start with HTTPS — for phone cameras run uvicorn manually with `--ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem`.
