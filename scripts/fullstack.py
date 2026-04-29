"""
Fullstack script for LeLab
Runs both backend and frontend development servers.
Frontend starts detached first, then backend.
"""

import os
import subprocess
import logging
import webbrowser
import time
import signal
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_PATH = PROJECT_ROOT / "frontend"

frontend_process = None
backend_process = None


def install_frontend_deps():
    logger.info("📦 Installing frontend dependencies...")
    try:
        subprocess.run(["npm", "install"], check=True, cwd=FRONTEND_PATH)
        logger.info("✅ Frontend dependencies installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"❌ Failed to install frontend dependencies: {e}")
        return False
    except FileNotFoundError:
        logger.error("❌ npm not found. Please install Node.js and npm")
        return False


def start_frontend_detached():
    global frontend_process
    logger.info("🎨 Starting Vite frontend development server (detached)...")

    try:
        frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=FRONTEND_PATH,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        logger.info(f"✅ Frontend server started (PID: {frontend_process.pid})")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to start frontend server: {e}")
        return False


def wait_for_frontend_ready():
    logger.info("⏳ Waiting for frontend server to be ready...")

    import socket

    for attempt in range(30):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(("localhost", 8080))
            sock.close()
            if result == 0:
                logger.info("✅ Frontend server is ready!")
                return True
        except Exception:
            pass

        time.sleep(1)
        if attempt % 5 == 0:
            logger.info(f"⏳ Still waiting for frontend... ({attempt}s)")

    logger.warning("⚠️ Frontend server didn't respond within 30 seconds")
    return False


def start_backend_detached():
    global backend_process
    logger.info("🚀 Starting FastAPI backend server (detached)...")

    try:
        backend_process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
                "--reload",
            ],
            cwd=PROJECT_ROOT,
            env=os.environ.copy(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        logger.info(f"✅ Backend server started (PID: {backend_process.pid})")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to start backend server: {e}")
        return False


def wait_for_backend_ready():
    logger.info("⏳ Waiting for backend server to be ready...")

    import socket

    for attempt in range(15):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(("localhost", 8000))
            sock.close()
            if result == 0:
                logger.info("✅ Backend server is ready!")
                return True
        except Exception:
            pass

        time.sleep(1)
        if attempt % 5 == 0:
            logger.info(f"⏳ Still waiting for backend... ({attempt}s)")

    logger.warning("⚠️ Backend server didn't respond within 15 seconds")
    return False


def is_process_running(process):
    if process is None:
        return False
    try:
        return process.poll() is None
    except Exception:
        return False


def cleanup_processes():
    global backend_process, frontend_process

    logger.info("🛑 Shutting down servers...")

    for name, process in [("Backend", backend_process), ("Frontend", frontend_process)]:
        if not process or not is_process_running(process):
            continue

        logger.info(f"🔄 Stopping {name} server (PID: {process.pid})...")
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except Exception:
            process.terminate()

        try:
            process.wait(timeout=5)
            logger.info(f"✅ {name} server stopped gracefully")
        except subprocess.TimeoutExpired:
            logger.warning(f"⚠️ {name} server didn't stop gracefully, force killing...")
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except Exception:
                process.kill()
            logger.info(f"✅ {name} server force stopped")

    logger.info("✅ All servers stopped")


def signal_handler(signum, frame):
    logger.info("\n🛑 Received shutdown signal...")
    cleanup_processes()
    sys.exit(0)


def main():
    logger.info("🚀 Starting LeLab fullstack development servers...")

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if not FRONTEND_PATH.exists():
        logger.error(f"❌ Frontend directory not found at {FRONTEND_PATH}")
        return

    try:
        if not install_frontend_deps():
            return

        if not start_frontend_detached():
            return

        if not wait_for_frontend_ready():
            cleanup_processes()
            return

        if not start_backend_detached():
            cleanup_processes()
            return

        if not wait_for_backend_ready():
            cleanup_processes()
            return

        logger.info("🌐 Opening browser...")
        webbrowser.open("http://localhost:8080?reset_to_localhost=true")

        logger.info("✅ Both servers are running!")
        logger.info("📱 Backend: http://localhost:8000")
        logger.info("🌐 Frontend: http://localhost:8080")
        logger.info("🛑 Press Ctrl+C to stop both servers")

        while True:
            time.sleep(5)
            if not is_process_running(frontend_process):
                logger.error("❌ Frontend process died")
                break
            if not is_process_running(backend_process):
                logger.error("❌ Backend process died")
                break

    except KeyboardInterrupt:
        logger.info("\n🛑 Received interrupt signal")
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
    finally:
        cleanup_processes()


if __name__ == "__main__":
    main()
