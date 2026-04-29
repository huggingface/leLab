"""
Backend script for LeLab.

Starts the FastAPI server on :8000, opens a Cloudflare quick-tunnel,
and launches the HF Space frontend in a browser pointed at the tunnel
URL so a user can go from `lelab` to a working app with no setup.
"""

import logging
import signal
import threading
import time
import webbrowser
from urllib.parse import quote

import uvicorn
from pycloudflared import try_cloudflare

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SPACE_URL = "https://lerobot-lelab.hf.space"
BACKEND_PORT = 8000


def _open_space_with_tunnel():
    """Start a Cloudflare quick-tunnel and open the Space pointed at it."""
    logger.info("☁️  Starting Cloudflare tunnel...")
    try:
        urls = try_cloudflare(port=BACKEND_PORT, verbose=False)
    except Exception as e:
        logger.error(f"❌ Cloudflare tunnel failed: {e}")
        logger.error("   Run `lelab-fullstack` for a fully-local fallback.")
        return None

    tunnel_url = urls.tunnel.rstrip("/")
    logger.info(f"🌍 Backend exposed at: {tunnel_url}")

    space_url = f"{SPACE_URL}/?api={quote(tunnel_url, safe=':/')}"
    logger.info(f"🌐 Opening browser: {space_url}")
    webbrowser.open(space_url)
    return urls


def main():
    logger.info("🚀 Starting LeLab FastAPI backend server...")

    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=BACKEND_PORT,
        log_level="info",
        reload=False,
    )
    server = uvicorn.Server(config)

    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    while not server.started:
        time.sleep(0.1)

    urls = _open_space_with_tunnel()

    def shutdown(signum, frame):
        logger.info("🛑 Shutting down...")
        if urls and urls.process:
            try:
                urls.process.terminate()
            except Exception:
                pass
        server.should_exit = True

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    server_thread.join()


if __name__ == "__main__":
    main()
