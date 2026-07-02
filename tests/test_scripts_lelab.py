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
"""Tests for the LeLab launcher.

The launcher owns local process startup, so these tests mock child processes
instead of running Vite or uvicorn.
"""

from __future__ import annotations

import socket
import threading
from pathlib import Path
from unittest.mock import MagicMock

import pytest


class FakeProcess:
    def __init__(self, returncode: int | None = None) -> None:
        self.pid = 1234
        self.returncode = returncode
        self.signals: list[int] = []
        self.terminated = False
        self.killed = False
        self.wait_calls: list[int] = []

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)
        self.returncode = 0

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def wait(self, timeout: int | None = None) -> int | None:
        if timeout is not None:
            self.wait_calls.append(timeout)
        return self.returncode


class _ImmediateThread:
    """Runs the target synchronously on .start() so launcher threads are testable.

    Accepts the same kwargs the launcher passes to threading.Thread (including
    ``name=``) so it can stand in for it without arg-mismatch errors.
    """

    def __init__(self, target, args=(), daemon=False, name=None) -> None:
        self._target = target
        self._args = args

    def start(self) -> None:
        self._target(*self._args)


def _bind_listener() -> tuple[socket.socket, int]:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    return server, server.getsockname()[1]


def test_wait_for_port_returns_true_when_port_is_open() -> None:
    from lelab.scripts.lelab import _wait_for_port

    server, port = _bind_listener()
    try:
        assert _wait_for_port(port, timeout=2) is True
    finally:
        server.close()


def test_wait_for_port_returns_false_when_port_never_opens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from lelab.scripts.lelab import _wait_for_port

    monkeypatch.setattr("lelab.scripts.lelab.time.sleep", lambda _s: None)
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()

    assert _wait_for_port(port, timeout=2) is False


def test_wait_for_port_returns_true_immediately_for_already_open_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from lelab.scripts.lelab import _wait_for_port

    sleep_calls = []
    monkeypatch.setattr("lelab.scripts.lelab.time.sleep", lambda s: sleep_calls.append(s))

    server, port = _bind_listener()
    accept_thread = threading.Thread(target=lambda: server.accept() if server else None, daemon=True)
    accept_thread.start()

    try:
        assert _wait_for_port(port, timeout=5) is True
        assert sleep_calls == []
    finally:
        server.close()


def test_ensure_port_available_exits_with_actionable_message(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import lelab.scripts.lelab as launcher

    monkeypatch.setattr(launcher, "_is_port_open", lambda _port, _host=launcher.HOST: True)

    with pytest.raises(SystemExit):
        launcher._ensure_port_available("Backend", 8000)

    assert "Backend port 8000 is already in use" in caplog.text
    assert "lelab --stop" in caplog.text


def test_frontend_install_is_skipped_when_node_modules_exists(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    frontend = tmp_path / "frontend"
    node_modules = frontend / "node_modules"
    node_modules.mkdir(parents=True)
    run_checked = MagicMock()

    monkeypatch.setattr(launcher, "FRONTEND_PATH", frontend)
    monkeypatch.setattr(launcher, "FRONTEND_NODE_MODULES", node_modules)
    monkeypatch.setattr(launcher, "_require_command", lambda _command: _command)
    monkeypatch.setattr(launcher, "_run_checked", run_checked)

    launcher._ensure_frontend_deps()

    run_checked.assert_not_called()


def test_frontend_install_runs_when_node_modules_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    frontend = tmp_path / "frontend"
    frontend.mkdir()
    node_modules = frontend / "node_modules"
    run_checked = MagicMock()

    monkeypatch.setattr(launcher, "FRONTEND_PATH", frontend)
    monkeypatch.setattr(launcher, "FRONTEND_NODE_MODULES", node_modules)
    monkeypatch.setattr(launcher, "_require_command", lambda _command: _command)
    monkeypatch.setattr(launcher, "_run_checked", run_checked)

    launcher._ensure_frontend_deps()

    run_checked.assert_called_once_with(
        ["npm", "install"],
        frontend,
        "Run `cd frontend && npm install` to inspect the npm error.",
    )


def test_browser_can_be_suppressed(monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.scripts.lelab as launcher

    browser_open = MagicMock()
    monkeypatch.setattr(launcher.webbrowser, "open", browser_open)

    launcher._open_browser_url("http://localhost:8000/", no_open=True)

    browser_open.assert_not_called()


def test_run_prod_no_open_reaches_uvicorn_without_browser(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>")
    browser_open = MagicMock()
    server = MagicMock()
    captured: dict[str, object] = {}

    def fake_config(_app, **kwargs):
        captured.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(launcher, "FRONTEND_DIST", dist)
    monkeypatch.setattr(launcher, "_ensure_port_available", lambda _name, _port: None)
    monkeypatch.setattr(launcher.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(launcher.uvicorn, "Config", fake_config)
    monkeypatch.setattr(launcher.uvicorn, "Server", lambda _config: server)
    monkeypatch.setattr(launcher.signal, "signal", lambda *_a, **_k: None)
    monkeypatch.setattr(launcher.webbrowser, "open", browser_open)

    launcher._run_prod(no_open=True)

    server.run.assert_called_once()
    assert captured["host"] == "127.0.0.1"
    assert captured["port"] == 8000
    browser_open.assert_not_called()


def test_run_prod_rebuilds_before_starting_uvicorn(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>")
    order: list[str] = []
    server = MagicMock()
    server.run.side_effect = lambda: order.append("uvicorn")

    monkeypatch.setattr(launcher, "FRONTEND_DIST", dist)
    monkeypatch.setattr(launcher, "_ensure_port_available", lambda _name, _port: None)
    monkeypatch.setattr(launcher, "_run_frontend_build", lambda: order.append("build"))
    monkeypatch.setattr(launcher.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(launcher.uvicorn, "Config", lambda *_a, **_k: MagicMock())
    monkeypatch.setattr(launcher.uvicorn, "Server", lambda _config: server)
    monkeypatch.setattr(launcher.signal, "signal", lambda *_a, **_k: None)

    launcher._run_prod(no_open=True, rebuild=True)

    assert order == ["build", "uvicorn"]


def test_dev_launcher_builds_expected_subprocess_commands(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    frontend = tmp_path / "frontend"
    frontend.mkdir()
    started: list[tuple[str, list[str], Path]] = []
    browser_open = MagicMock()

    def fake_start_process(name, command, cwd, env=None):
        started.append((name, list(command), cwd))
        return FakeProcess()

    def stop_after_start(_processes):
        raise SystemExit(0)

    monkeypatch.setattr(launcher, "FRONTEND_PATH", frontend)
    monkeypatch.setattr(launcher, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(launcher, "_require_command", lambda _command: _command)
    monkeypatch.setattr(launcher, "_ensure_port_available", lambda _name, _port: None)
    monkeypatch.setattr(launcher, "_ensure_frontend_deps", lambda: None)
    monkeypatch.setattr(launcher, "_wait_for_port", lambda _port, timeout=30: True)
    monkeypatch.setattr(launcher, "_start_process", fake_start_process)
    monkeypatch.setattr(launcher, "_install_signal_handlers", lambda: None)
    monkeypatch.setattr(launcher, "_monitor_processes", stop_after_start)
    monkeypatch.setattr(launcher.webbrowser, "open", browser_open)

    with pytest.raises(SystemExit) as exc:
        launcher._run_dev(no_open=True)

    assert exc.value.code == 0
    assert started[0] == (
        "frontend",
        ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "8080"],
        frontend,
    )
    assert started[1][0] == "backend"
    assert started[1][1][:4] == [launcher.sys.executable, "-m", "uvicorn", "lelab.server:app"]
    assert "--reload" in started[1][1]
    assert started[1][2] == tmp_path
    browser_open.assert_not_called()


def test_child_process_kwargs_use_windows_creation_group(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    monkeypatch.setattr(launcher.os, "name", "nt")
    monkeypatch.setattr(launcher.subprocess, "CREATE_NEW_PROCESS_GROUP", 512, raising=False)

    kwargs = launcher._child_process_kwargs(tmp_path)

    assert kwargs["creationflags"] == 512
    assert "start_new_session" not in kwargs


def test_stop_process_terminates_tree_without_unix_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import lelab.scripts.lelab as launcher

    fake = FakeProcess()  # poll() -> None, so it is treated as still running
    killpg = MagicMock()
    terminated: list[int] = []

    class _FakeProc:
        def __init__(self, pid: int) -> None:
            self.pid = pid

        def children(self, recursive: bool = False) -> list:
            return []

        def terminate(self) -> None:
            terminated.append(self.pid)

        def kill(self) -> None:  # pragma: no cover - alive list is empty here
            terminated.append(-self.pid)

    monkeypatch.setattr(launcher.os, "killpg", killpg, raising=False)
    monkeypatch.setattr(launcher.psutil, "Process", lambda pid: _FakeProc(pid))
    monkeypatch.setattr(launcher.psutil, "wait_procs", lambda procs, timeout=None: ([], []))

    launcher._stop_process("frontend", fake, timeout=5)

    # The whole process tree is terminated via psutil (cross-platform), not a
    # Unix process group and not a Ctrl-Break signal to the child handle.
    assert terminated == [fake.pid]
    assert fake.signals == []
    assert fake.wait_calls == [5]
    killpg.assert_not_called()


def test_missing_command_reports_install_hint(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import lelab.scripts.lelab as launcher

    monkeypatch.setattr(launcher.shutil, "which", lambda _command: None)

    with pytest.raises(SystemExit):
        launcher._require_command("npm")

    assert "`npm` was not found on PATH" in caplog.text
    assert "Install Node.js LTS" in caplog.text


def test_resolve_command_prefers_cmd_shim_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import lelab.scripts.lelab as launcher

    def fake_which(command: str) -> str | None:
        if command == "npm.cmd":
            return r"C:\Program Files\nodejs\npm.cmd"
        if command == "npm":
            return r"C:\Program Files\nodejs\npm"
        return None

    monkeypatch.setattr(launcher.os, "name", "nt")
    monkeypatch.setattr(launcher.shutil, "which", fake_which)

    assert launcher._resolve_command("npm") == r"C:\Program Files\nodejs\npm.cmd"


def test_start_process_uses_resolved_executable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import lelab.scripts.lelab as launcher

    popen = MagicMock(return_value=FakeProcess())
    monkeypatch.setattr(launcher, "_resolve_command", lambda _command: r"C:\Program Files\nodejs\npm.cmd")
    monkeypatch.setattr(launcher.subprocess, "Popen", popen)

    launcher._start_process("frontend", ["npm", "run", "dev"], tmp_path)

    popen.assert_called_once()
    assert popen.call_args.args[0] == [r"C:\Program Files\nodejs\npm.cmd", "run", "dev"]


def test_missing_frontend_dist_reports_rebuild_hint(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import lelab.scripts.lelab as launcher

    monkeypatch.setattr(launcher, "FRONTEND_DIST", tmp_path / "dist")

    with pytest.raises(SystemExit):
        launcher._ensure_frontend_dist()

    assert "Built frontend not found" in caplog.text
    assert "Run `lelab --rebuild`" in caplog.text


def test_dev_launcher_reports_frontend_exit_before_ready(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import lelab.scripts.lelab as launcher

    frontend = tmp_path / "frontend"
    frontend.mkdir()

    monkeypatch.setattr(launcher, "FRONTEND_PATH", frontend)
    monkeypatch.setattr(launcher, "_require_command", lambda _command: _command)
    monkeypatch.setattr(launcher, "_ensure_port_available", lambda _name, _port: None)
    monkeypatch.setattr(launcher, "_ensure_frontend_deps", lambda: None)
    monkeypatch.setattr(launcher, "_wait_for_port", lambda _port, timeout=30: False)
    monkeypatch.setattr(launcher, "_start_process", lambda *_args, **_kwargs: FakeProcess(returncode=7))

    with pytest.raises(SystemExit):
        launcher._run_dev(no_open=True)

    assert "Frontend exited early with code 7" in caplog.text
    assert "Check the Vite output above" in caplog.text
