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

"""
LeLab launcher.

Default mode starts FastAPI on :8000 and serves the committed frontend/dist
bundle from the same process. Dev mode starts Vite on :8080 and uvicorn
--reload on :8000.
"""

from __future__ import annotations

import argparse
import contextlib
import logging
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Sequence
from pathlib import Path
from typing import NoReturn

import psutil
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
FRONTEND_PATH = PROJECT_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_PATH / "dist"
FRONTEND_NODE_MODULES = FRONTEND_PATH / "node_modules"
HOST = "127.0.0.1"
BACKEND_PORT = 8000
FRONTEND_DEV_PORT = 8080


def _fail(message: str) -> NoReturn:
    logger.error(message)
    raise SystemExit(1)


def _is_port_open(port: int, host: str = HOST) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex((host, port)) == 0


def _wait_for_port(port: int, timeout: int = 30, host: str = HOST) -> bool:
    for _ in range(timeout):
        if _is_port_open(port, host):
            return True
        time.sleep(1)
    return False


def _ensure_port_available(name: str, port: int, host: str = HOST) -> None:
    if not _is_port_open(port, host):
        return
    _fail(
        f"{name} port {port} is already in use on {host}. "
        "If a previous LeLab run is still holding it, run `lelab --stop` to free it, "
        "then run the command again."
    )


def _find_lelab_pids() -> dict[int, str]:
    """PIDs that look like a running LeLab dev backend/frontend, with a reason.

    On Windows the uvicorn --reload worker inherits the listening socket from
    its supervisor, so the OS attributes :8000 to a PID that may already be
    gone — neither the global connection table nor `taskkill` finds the live
    holder. So match three independent signals and stay scoped to LeLab so we
    never touch unrelated dev servers:
      1. cmdline runs `uvicorn ... lelab.server`  (the reload supervisor / prod)
      2. an orphaned reload worker (`multiprocessing.spawn`) whose cwd is this
         project
      3. anything actually LISTENING on :8000 / :8080  (per-process scan, which
         is more reliable than the global table on Windows)
    """
    me = os.getpid()
    ports = {BACKEND_PORT, FRONTEND_DEV_PORT}
    targets: dict[int, str] = {}
    for proc in psutil.process_iter(["pid", "cmdline"]):
        pid = proc.info["pid"]
        if pid == me:
            continue
        cmdline = " ".join(proc.info.get("cmdline") or [])
        if "lelab.server" in cmdline:
            targets[pid] = "uvicorn (lelab.server)"
            continue
        if "multiprocessing.spawn" in cmdline:
            try:
                if Path(proc.cwd()) == PROJECT_ROOT:
                    targets[pid] = "orphaned reload worker"
                    continue
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                pass
        try:
            get_conns = getattr(proc, "net_connections", None) or proc.connections
            for conn in get_conns(kind="inet"):
                if conn.laddr and conn.laddr.port in ports and conn.status == psutil.CONN_LISTEN:
                    targets[pid] = f"listening on :{conn.laddr.port}"
                    break
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass
    return targets


def _run_stop() -> None:
    """Stop a running LeLab and free :8000 / :8080.

    The escape hatch for when a previous run left an orphaned Vite or uvicorn
    process holding the ports.
    """
    targets = _find_lelab_pids()
    if not targets:
        logger.info("Nothing to stop: no LeLab process found on :%d / :%d.", BACKEND_PORT, FRONTEND_DEV_PORT)
        return
    for pid, reason in targets.items():
        logger.info("Stopping pid %d (%s)...", pid, reason)
        _terminate_tree(pid)
    logger.info("LeLab stopped.")


def _require_command(command: str) -> str:
    resolved = _resolve_command(command)
    if resolved:
        return resolved
    _fail(
        f"`{command}` was not found on PATH. Install Node.js LTS from https://nodejs.org/, "
        "restart your terminal, then run LeLab again."
    )


def _resolve_command(command: str) -> str | None:
    if os.name == "nt" and not Path(command).suffix:
        for suffix in (".cmd", ".exe", ".bat"):
            resolved = shutil.which(f"{command}{suffix}")
            if resolved:
                return resolved
    return shutil.which(command)


def _ensure_frontend_path() -> None:
    if FRONTEND_PATH.exists():
        return
    _fail(
        f"Frontend source not found at {FRONTEND_PATH}. Run LeLab from a complete checkout or reinstall it."
    )


def _ensure_frontend_dist() -> None:
    index_html = FRONTEND_DIST / "index.html"
    if index_html.exists():
        return
    _fail(
        f"Built frontend not found at {index_html}. Run `lelab --rebuild`, "
        "or run `cd frontend && npm run build`, then start LeLab again."
    )


def _frontend_deps_installed() -> bool:
    return FRONTEND_NODE_MODULES.exists()


def _run_checked(command: Sequence[str], cwd: Path, failure_hint: str) -> None:
    executable = _require_command(command[0])
    resolved_command = [executable, *command[1:]]
    try:
        subprocess.run(resolved_command, cwd=cwd, check=True)
    except FileNotFoundError as exc:
        _fail(f"Could not run `{command[0]}`: {exc}. {failure_hint}")
    except subprocess.CalledProcessError as exc:
        _fail(f"`{' '.join(command)}` failed with exit code {exc.returncode}. {failure_hint}")


def _ensure_frontend_deps() -> None:
    _ensure_frontend_path()
    _require_command("node")
    _require_command("npm")
    if _frontend_deps_installed():
        logger.info("Frontend dependencies found; skipping npm install.")
        return
    logger.info("Installing frontend dependencies...")
    _run_checked(
        ["npm", "install"],
        FRONTEND_PATH,
        "Run `cd frontend && npm install` to inspect the npm error.",
    )


def _run_frontend_build() -> None:
    _ensure_frontend_deps()
    logger.info("Building frontend/dist...")
    _run_checked(
        ["npm", "run", "build"],
        FRONTEND_PATH,
        "Run `cd frontend && npm run build` to inspect the build error.",
    )


def _child_process_kwargs(cwd: Path, env: dict[str, str] | None = None) -> dict[str, object]:
    kwargs: dict[str, object] = {"cwd": cwd}
    if env is not None:
        kwargs["env"] = env

    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        if creationflags:
            kwargs["creationflags"] = creationflags
    else:
        kwargs["start_new_session"] = True
    return kwargs


def _start_process(
    name: str,
    command: Sequence[str],
    cwd: Path,
    env: dict[str, str] | None = None,
) -> subprocess.Popen:
    executable = _require_command(command[0])
    resolved_command = [executable, *command[1:]]
    logger.info("Starting %s: %s", name, " ".join(command))
    try:
        return subprocess.Popen(resolved_command, **_child_process_kwargs(cwd, env))
    except FileNotFoundError as exc:
        _fail(f"Could not start {name}: {exc}. Check that `{command[0]}` is installed and on PATH.")


def _terminate_tree(pid: int, timeout: int = 5) -> None:
    """Terminate a process and every descendant.

    Dev mode's children are themselves process trees (npm.cmd -> node -> vite,
    and uvicorn --reload -> reloader -> worker). Signalling only the direct
    child leaves the grandchildren orphaned on Windows, where they keep holding
    ports 8000/8080 and block the next launch. Walk the whole tree instead.
    """
    try:
        parent = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    procs = parent.children(recursive=True)
    procs.append(parent)
    for proc in procs:
        with contextlib.suppress(psutil.NoSuchProcess):
            proc.terminate()
    _gone, alive = psutil.wait_procs(procs, timeout=timeout)
    for proc in alive:
        with contextlib.suppress(psutil.NoSuchProcess):
            proc.kill()


def _stop_process(name: str, process: subprocess.Popen, timeout: int = 5) -> None:
    if process.poll() is not None:
        logger.info("%s already stopped.", name)
        return

    logger.info("Stopping %s...", name)
    _terminate_tree(process.pid, timeout)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
    logger.info("%s stopped.", name)


def _shutdown_processes(processes: Sequence[tuple[str, subprocess.Popen]]) -> None:
    for name, process in reversed(processes):
        _stop_process(name, process)


def _open_browser_url(url: str, no_open: bool) -> None:
    if no_open:
        logger.info("Browser launch disabled. Open %s when ready.", url)
        return
    logger.info("Opening browser: %s", url)
    webbrowser.open(url)


def _open_browser_when_ready(port: int, no_open: bool) -> None:
    if no_open:
        logger.info("Browser launch disabled. Open http://localhost:%d/ when ready.", port)
        return

    for _ in range(60):
        if _is_port_open(port):
            _open_browser_url(f"http://localhost:{port}/", no_open=False)
            return
        time.sleep(0.5)


def _install_signal_handlers() -> None:
    # Teardown of the child processes is owned by _run_dev's
    # `except BaseException` — the handler only needs to unwind.
    def shutdown(_signum, _frame) -> None:
        logger.info("Shutting down LeLab...")
        raise SystemExit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)


def _monitor_processes(processes: Sequence[tuple[str, subprocess.Popen]]) -> None:
    while True:
        time.sleep(2)
        for name, process in processes:
            returncode = process.poll()
            if returncode is not None:
                logger.error("%s stopped with exit code %s.", name, returncode)
                raise SystemExit(returncode)


def _run_prod(*, no_open: bool = False, rebuild: bool = False) -> None:
    """Serve built frontend from backend on a single port."""
    _ensure_port_available("Backend", BACKEND_PORT)
    if rebuild:
        _run_frontend_build()
    _ensure_frontend_dist()

    logger.info("Starting LeLab on http://localhost:%d ...", BACKEND_PORT)
    threading.Thread(target=_open_browser_when_ready, args=(BACKEND_PORT, no_open), daemon=True).start()

    config = uvicorn.Config(
        "lelab.server:app",
        host=HOST,
        port=BACKEND_PORT,
        log_level="info",
        reload=False,
        timeout_graceful_shutdown=2,
    )
    server = uvicorn.Server(config)

    if os.name == "nt":
        # On Windows, uvicorn's graceful shutdown frequently hangs on Ctrl+C
        # (the asyncio Proactor loop doesn't wind down cleanly), leaving the
        # terminal stuck. Take over signal handling: stop hard and reap any
        # child subprocesses (training/recording/inference) so the prompt
        # always returns. On other platforms uvicorn's native handlers give
        # us the graceful shutdown above, so leave them in place.
        server.install_signal_handlers = lambda: None

        def _shutdown(_signum, _frame) -> None:
            logger.info("Shutting down LeLab...")
            try:
                for child in psutil.Process().children(recursive=True):
                    with contextlib.suppress(psutil.NoSuchProcess):
                        child.terminate()
            except Exception:
                pass
            os._exit(0)

        signal.signal(signal.SIGINT, _shutdown)
        for _name in ("SIGTERM", "SIGBREAK"):
            _sig = getattr(signal, _name, None)
            if _sig is not None:
                with contextlib.suppress(ValueError, OSError):
                    signal.signal(_sig, _shutdown)

    server.run()


def _run_dev(*, no_open: bool = False) -> None:
    """Start Vite HMR plus uvicorn reload."""
    _ensure_frontend_path()
    _require_command("node")
    _require_command("npm")
    _ensure_port_available("Backend", BACKEND_PORT)
    _ensure_port_available("Frontend", FRONTEND_DEV_PORT)
    _ensure_frontend_deps()

    processes: list[tuple[str, subprocess.Popen]] = []
    frontend_url = f"http://localhost:{FRONTEND_DEV_PORT}/?api=http://localhost:{BACKEND_PORT}"

    try:
        frontend_process = _start_process(
            "frontend",
            ["npm", "run", "dev", "--", "--host", HOST, "--port", str(FRONTEND_DEV_PORT)],
            FRONTEND_PATH,
        )
        processes.append(("frontend", frontend_process))
        if not _wait_for_port(FRONTEND_DEV_PORT):
            if frontend_process.poll() is not None:
                _fail(
                    f"Frontend exited early with code {frontend_process.returncode}. Check the Vite output above."
                )
            _fail(f"Frontend never became ready on http://localhost:{FRONTEND_DEV_PORT}.")

        backend_process = _start_process(
            "backend",
            [
                sys.executable,
                "-m",
                "uvicorn",
                "lelab.server:app",
                "--host",
                HOST,
                "--port",
                str(BACKEND_PORT),
                "--reload",
            ],
            PROJECT_ROOT,
            env=os.environ.copy(),
        )
        processes.append(("backend", backend_process))
        # Importing lelab.server pulls in torch via lerobot, which can take
        # 20-30s cold on Windows; 15s made dev mode die on slower machines.
        if not _wait_for_port(BACKEND_PORT, timeout=90):
            if backend_process.poll() is not None:
                _fail(
                    f"Backend exited early with code {backend_process.returncode}. Check the uvicorn output above."
                )
            _fail(f"Backend never became ready on http://localhost:{BACKEND_PORT}.")

        _open_browser_url(frontend_url, no_open=no_open)
        logger.info("Dev mode running. Press Ctrl+C to stop.")
        logger.info("Frontend: http://localhost:%d", FRONTEND_DEV_PORT)
        logger.info("Backend:  http://localhost:%d", BACKEND_PORT)
        _install_signal_handlers()
        _monitor_processes(processes)
    except BaseException:
        if processes:
            _shutdown_processes(processes)
        raise


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lelab", description="Run LeLab")
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Start Vite hot reload on :8080 plus uvicorn --reload on :8000.",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Rebuild frontend/dist before starting production mode.",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Do not open a browser automatically.",
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Stop a running LeLab (free ports 8000/8080) and exit.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.stop:
        _run_stop()
        return

    if args.dev and args.rebuild:
        parser.error("--rebuild is for production mode; dev mode serves from Vite.")

    if args.dev:
        _run_dev(no_open=args.no_open)
    else:
        _run_prod(no_open=args.no_open, rebuild=args.rebuild)


if __name__ == "__main__":
    main()
