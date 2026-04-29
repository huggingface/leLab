# HF CLI auth check on first load

## Goal

On first page load, detect whether the Hugging Face CLI is configured. If not, surface the login command. If yes, fetch the username (and orgs) and make them available across pages so future iterations can populate dataset/team/repo selectors.

## Non-goals

- Auto-prefilling `dataset_repo_id` with the username.
- Dropdowns for user-vs-org selection on dataset fields.
- Listing existing user repos.
- Inline per-page warnings on Record / Replay / Training.

These are explicit follow-ups, not part of this spec.

## UX

When the user is **not authenticated**, a soft, non-blocking banner appears above the header on the Landing page. It displays:

- A short explanation that uploads, training, and replay-from-Hub require a logged-in HF CLI.
- The login command (`hf auth login`) in a copyable `<pre>` block, matching the style of `UsageInstructionsModal`.
- A "I've logged in — recheck" button that re-runs the auth check without a page reload.

When the user is **authenticated**, the banner shows a subtle confirmation line (`Logged in as <username>`). While the initial fetch is in flight, nothing is rendered (avoids a flash of "not logged in").

Other pages (Record, Replay, Training, Upload) are unchanged in this iteration but gain access to `useHfAuth()` for future use.

## Architecture

### Backend

New module `app/hf_auth.py`:

```python
from huggingface_hub import whoami
from huggingface_hub.errors import LocalTokenNotFoundError, HfHubHTTPError

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
    except (LocalTokenNotFoundError, HfHubHTTPError, OSError):
        return {
            "authenticated": False,
            "username": None,
            "orgs": [],
            "login_command": LOGIN_COMMAND,
        }
```

`app/main.py` adds a single route:

```python
@app.get("/hf-auth-status")
def hf_auth_status():
    return handle_hf_auth_status()
```

All auth/network failures are folded into `authenticated: false`. The endpoint never returns a 500 for the expected unauthenticated case.

### Frontend

New context `frontend/src/contexts/HfAuthContext.tsx`:

```ts
type HfAuthState =
  | { status: "loading" }
  | { status: "authenticated"; username: string; orgs: string[] }
  | { status: "unauthenticated"; loginCommand: string };

interface HfAuthValue {
  auth: HfAuthState;
  refetch: () => Promise<void>;
}
```

- Provider fetches `/hf-auth-status` once on mount via `fetchWithHeaders` from `useApi()`.
- `refetch()` re-runs the same fetch.
- Exposes `useHfAuth()` hook.

Wired in `frontend/src/App.tsx` as `<HfAuthProvider>` nested **inside** `<ApiProvider>` (it depends on `useApi`).

New component `frontend/src/components/landing/HfAuthBanner.tsx` rendered at the top of `Landing.tsx`, above `LandingHeader`. Behavior:

- `loading` → renders nothing.
- `authenticated` → subtle "Logged in as `<username>`" line.
- `unauthenticated` → amber banner with explanation, copyable command, and refetch button.

## Data flow

1. App mounts → `HfAuthProvider` calls `GET /hf-auth-status` once.
2. Backend `whoami()` succeeds → `{ authenticated: true, username, orgs, login_command }` → context state becomes `authenticated`.
3. Backend `whoami()` raises (`LocalTokenNotFoundError`, 401, network) → `{ authenticated: false, ... }` → context state becomes `unauthenticated` → banner renders.
4. User runs `hf auth login` in their terminal → clicks "I've logged in" → `refetch()` re-hits the endpoint → state flips.

## Error handling

- Backend: all expected failure modes return `authenticated: false`. Unexpected exceptions still propagate (would surface as a fetch error in the frontend).
- Frontend: fetch failure (e.g., backend down) leaves state in `loading`. The banner stays hidden. Other parts of the app already break visibly when the backend is down, so this is acceptable.

## Testing (manual; repo has no test suite)

- **Logged-in**: `lelab --dev`, verify banner shows `Logged in as <username>`.
- **Logged-out**: move `~/.cache/huggingface/token` aside, reload, verify amber banner with login command.
- **Refetch**: with banner visible, run `hf auth login` in another terminal, click "I've logged in", verify banner swaps to authenticated state.

## Files touched

- `app/hf_auth.py` (new)
- `app/main.py` (add `/hf-auth-status` route + import)
- `frontend/src/contexts/HfAuthContext.tsx` (new)
- `frontend/src/components/landing/HfAuthBanner.tsx` (new)
- `frontend/src/App.tsx` (wrap with `HfAuthProvider`)
- `frontend/src/pages/Landing.tsx` (render `HfAuthBanner`)
