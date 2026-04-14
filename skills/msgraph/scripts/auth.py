"""
Shared authentication helper for skill-msgraph scripts.

Usage as a CLI:
    python3 scripts/auth.py login    # device-code flow, caches token
    python3 scripts/auth.py status   # show token validity + scopes
    python3 scripts/auth.py logout   # clear cache

Usage from other scripts:
    from auth import get_client
    client = get_client()          # v1.0 GraphServiceClient
    client = get_client(beta=True) # beta GraphServiceClient

Environment variables (can also be set in .env at project root or skill root):
    MSGRAPH_CLIENT_ID  - Azure AD app client ID (default: octobots public client)
    MSGRAPH_TENANT_ID  - Azure AD tenant ID (default: "common" for multi-tenant)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _bootstrap  # noqa: F401 — auto-installs deps, re-execs if needed

import tempfile
import time
from typing import Optional

import msal
from azure.core.credentials import AccessToken, TokenCredential

# ---------------------------------------------------------------------------
# .env loading — check skill root, then cwd
# ---------------------------------------------------------------------------

def _load_dotenv() -> None:
    """Load .env files (skill root → cwd → project root) without overwriting
    variables that are already set in the real environment."""
    candidates = [
        Path(__file__).resolve().parent.parent / ".env",  # skill root
        Path.cwd() / ".env",                               # cwd
    ]
    seen: set[str] = set()
    for env_path in candidates:
        if not env_path.is_file():
            continue
        resolved = env_path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        for line in env_path.read_text("utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            # Don't overwrite real env vars
            if key not in os.environ:
                os.environ[key] = value

_load_dotenv()

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CLIENT_ID = "084a3e9f-a9f4-43f7-89f9-d229cf97853e"
DEFAULT_TENANT_ID = "common"

SCOPES = [
    "Mail.Read",
    "Calendars.Read",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "Sites.Read.All",
    "Files.Read.All",
]


def _get_cache_path() -> Path:
    """Return the token cache path.

    Resolution:
      1. ``$SDLC_SKILLS_CACHE_DIR/msgraph/token_cache.json`` — if the env var is set.
      2. ``~/.msgraph-skill/token_cache.json`` — default fallback.

    A single token cache is shared across all projects so the user only
    needs to authenticate once.
    """
    cache_root = os.environ.get("SDLC_SKILLS_CACHE_DIR")
    if cache_root:
        return Path(cache_root) / "msgraph" / "token_cache.json"
    return Path.home() / ".msgraph-skill" / "token_cache.json"


class _MSALCredential(TokenCredential):
    """
    TokenCredential backed by MSAL PublicClientApplication with a
    file-based serialisable token cache.
    """

    def __init__(
        self,
        client_id: str,
        tenant_id: str,
        scopes: list[str],
        cache_path: Path,
    ) -> None:
        self._scopes = scopes
        self._cache_path = cache_path
        self._cache = msal.SerializableTokenCache()
        self._load_cache()
        self._app = msal.PublicClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            token_cache=self._cache,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_cache(self) -> None:
        if self._cache_path.is_file():
            self._cache.deserialize(self._cache_path.read_text("utf-8"))

    def _save_cache(self) -> None:
        """Write the token cache atomically (write-to-temp + os.replace)."""
        if not self._cache.has_state_changed:
            return
        self._cache_path.parent.mkdir(parents=True, exist_ok=True)
        data = self._cache.serialize()
        fd, tmp_path = tempfile.mkstemp(dir=self._cache_path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(data)
            os.replace(tmp_path, self._cache_path)
            try:
                self._cache_path.chmod(0o600)
            except OSError:
                pass
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _acquire_silent(self) -> Optional[dict]:
        accounts = self._app.get_accounts()
        if not accounts:
            return None
        # Try the exact requested scopes first.  If that fails (e.g. cached
        # token was obtained with a different scope set), fall back to the
        # scopes the refresh-token already covers — MSAL will use the RT to
        # mint a new AT with whatever scopes are consented.
        result = self._app.acquire_token_silent(self._scopes, account=accounts[0])
        if not result or "access_token" not in result:
            result = self._app.acquire_token_silent_with_error(
                self._scopes, account=accounts[0]
            )
        if not result or "access_token" not in result:
            # Last resort: ask for just the scopes the RT already has by
            # omitting force_refresh — let MSAL negotiate with the server.
            result = self._app.acquire_token_silent(
                self._scopes, account=accounts[0], force_refresh=True
            )
        self._save_cache()
        return result

    # ------------------------------------------------------------------
    # TokenCredential protocol
    # ------------------------------------------------------------------

    def get_token(self, *_scopes: str, **_kwargs) -> AccessToken:
        result = self._acquire_silent()
        if not result or "access_token" not in result:
            raise RuntimeError(
                "Not authenticated or token expired. "
                "Run: python3 scripts/auth.py login"
            )
        expires_on = int(time.time()) + int(result.get("expires_in", 3600))
        return AccessToken(result["access_token"], expires_on)

    # ------------------------------------------------------------------
    # Auth management (used by CLI)
    # ------------------------------------------------------------------

    def login(self) -> dict:
        """Initiate device-code flow and block until the user completes it."""
        flow = self._app.initiate_device_flow(scopes=self._scopes)
        if "user_code" not in flow:
            raise RuntimeError(f"Failed to initiate device flow: {flow}")

        url = flow.get("verification_uri", "https://microsoft.com/devicelogin")
        code = flow["user_code"]
        # Machine-readable lines for Claude to extract and show to the user
        print(f"LOGIN_URL={url}")
        print(f"LOGIN_CODE={code}")
        print()
        # Human-readable instructions (also visible if run directly in terminal)
        print("=" * 60)
        print("  Microsoft Graph — Device Code Login")
        print("=" * 60)
        print()
        print(f"  1. Open:  {url}")
        print(f"  2. Enter: {code}")
        print()
        print("=" * 60)
        print()
        print("Waiting for you to complete sign-in in the browser …")
        print()

        result = self._app.acquire_token_by_device_flow(flow)
        if "error" in result:
            raise RuntimeError(
                f"Authentication failed: {result.get('error_description', result['error'])}"
            )
        self._save_cache()
        return result

    def status(self) -> dict:
        """Return a dict with token validity and granted scopes."""
        accounts = self._app.get_accounts()
        if not accounts:
            return {"authenticated": False}
        result = self._acquire_silent()
        if not result or "access_token" not in result:
            return {"authenticated": False}
        expires_in = int(result.get("expires_in", 0))
        return {
            "authenticated": True,
            "account": accounts[0].get("username"),
            "expires_in_seconds": expires_in,
            "scopes": result.get("scope", "").split(),
        }

    def logout(self) -> None:
        """Remove cached token and clear all MSAL in-memory accounts."""
        # Remove each account from MSAL's in-memory cache so that
        # get_accounts() returns [] immediately after logout.
        for account in self._app.get_accounts():
            self._app.remove_account(account)
        if self._cache_path.is_file():
            self._cache_path.unlink()
        # Reinitialise with empty cache so the object stays usable.
        self._cache = msal.SerializableTokenCache()
        self._app.token_cache = self._cache


def _build_credential() -> _MSALCredential:
    client_id = os.environ.get("MSGRAPH_CLIENT_ID", DEFAULT_CLIENT_ID)
    if not client_id:
        raise RuntimeError(
            "MSGRAPH_CLIENT_ID is not set. "
            "Register an Azure AD app and export the environment variable. "
            "See SKILL.md § 'Azure AD App Registration' for instructions."
        )
    tenant_id = os.environ.get("MSGRAPH_TENANT_ID", DEFAULT_TENANT_ID)
    cache_path = _get_cache_path()
    return _MSALCredential(client_id, tenant_id, SCOPES, cache_path)


def get_client(beta: bool = False):
    """
    Return a ready-to-use GraphServiceClient.

    Args:
        beta: When True return the beta-endpoint client (msgraph_beta).

    Returns:
        GraphServiceClient (v1.0) or msgraph_beta.GraphServiceClient.
    """
    credential = _build_credential()

    if beta:
        from msgraph_beta import GraphServiceClient as BetaClient  # type: ignore

        return BetaClient(credentials=credential, scopes=SCOPES)

    from msgraph import GraphServiceClient  # type: ignore

    return GraphServiceClient(credentials=credential, scopes=SCOPES)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_login() -> None:
    cred = _build_credential()
    print(f"Client ID : {cred._app.client_id}")
    print(f"Token cache: {cred._cache_path}")
    print()
    result = cred.login()
    account = result.get("id_token_claims", {}).get("preferred_username", "unknown")
    print(f"Logged in as: {account}")
    print(f"Token cache : {cred._cache_path}")


def _cmd_status() -> None:
    cred = _build_credential()
    info = cred.status()
    if not info["authenticated"]:
        print("Not authenticated. Run: python3 scripts/auth.py login")
        sys.exit(1)
    print(f"Authenticated as : {info['account']}")
    print(f"Token expires in : {info['expires_in_seconds']}s")
    print(f"Granted scopes   : {' '.join(info['scopes'])}")
    print(f"Cache path       : {cred._cache_path}")


def _cmd_logout() -> None:
    cred = _build_credential()
    cred.logout()
    print("Logged out. Token cache cleared.")


_COMMANDS = {
    "login": _cmd_login,
    "status": _cmd_status,
    "logout": _cmd_logout,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in _COMMANDS:
        print(f"Usage: python3 {sys.argv[0]} <{'|'.join(_COMMANDS)}>")
        sys.exit(1)
    _COMMANDS[sys.argv[1]]()
