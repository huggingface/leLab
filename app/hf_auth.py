import logging

from huggingface_hub import whoami
from huggingface_hub.errors import HfHubHTTPError, LocalTokenNotFoundError

logger = logging.getLogger(__name__)

LOGIN_COMMAND = "hf auth login"


def handle_hf_auth_status() -> dict:
    try:
        info = whoami()
        return {
            "authenticated": True,
            "username": info["name"],
            "orgs": [o["name"] for o in info.get("orgs", [])],
            "login_command": LOGIN_COMMAND,
        }
    except (LocalTokenNotFoundError, HfHubHTTPError, OSError) as e:
        logger.info(f"HF auth check: not authenticated ({type(e).__name__})")
        return {
            "authenticated": False,
            "username": None,
            "orgs": [],
            "login_command": LOGIN_COMMAND,
        }
