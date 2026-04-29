"""
Frontend-only script for LeLab
Runs the Vite dev server from the bundled `frontend/` directory.
"""

import subprocess
import logging
import webbrowser
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_PATH = Path(__file__).parent.parent / "frontend"


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


def start_frontend_dev_server():
    logger.info("🎨 Starting Vite frontend development server...")
    process = None
    try:
        process = subprocess.Popen(["npm", "run", "dev"], cwd=FRONTEND_PATH)
        time.sleep(3)
        logger.info("🌐 Opening browser...")
        webbrowser.open("http://localhost:8080")
        process.wait()
    except FileNotFoundError:
        logger.error("❌ npm not found. Please install Node.js and npm")
    except KeyboardInterrupt:
        logger.info("🛑 Frontend server stopped by user")
        if process:
            process.terminate()


def main():
    logger.info("🎨 Starting LeLab frontend development server...")

    if not FRONTEND_PATH.exists():
        logger.error(f"❌ Frontend directory not found at {FRONTEND_PATH}")
        return

    if not install_frontend_deps():
        return

    start_frontend_dev_server()


if __name__ == "__main__":
    main()
