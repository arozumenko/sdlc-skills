"""
Auto-bootstrap: ensure Python dependencies are available.

Every script in this skill should start with:

    import _bootstrap  # noqa: F401  — auto-installs deps, re-execs if needed

How it works:
  1. Try to import `msal` (lightest required dep).
  2. If it succeeds, do nothing — deps are already available.
  3. If it fails:
     a. Look for an existing venv at ~/.msgraph-skill/.venv/
     b. If no venv exists, create one and pip-install requirements.txt
     c. Re-exec the current script under the venv's python (os.execv).

The venv lives in ~/.msgraph-skill/.venv/ so it is shared across projects
and survives plugin cache invalidation.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_VENV_DIR = Path.home() / ".msgraph-skill" / ".venv"
_REQUIREMENTS = Path(__file__).resolve().parent.parent / "requirements.txt"


def _is_inside_venv() -> bool:
    """Return True if we are already running inside *our* managed venv."""
    return sys.prefix != sys.base_prefix and Path(sys.prefix).resolve() == _VENV_DIR.resolve()


def _venv_python() -> Path:
    if sys.platform == "win32":
        return _VENV_DIR / "Scripts" / "python.exe"
    return _VENV_DIR / "bin" / "python3"


def _create_venv_and_install() -> None:
    """Create the venv and install requirements (runs once)."""
    print(f"[msgraph] Installing dependencies into {_VENV_DIR} …", file=sys.stderr)
    subprocess.check_call(
        [sys.executable, "-m", "venv", str(_VENV_DIR)],
        stdout=subprocess.DEVNULL,
    )
    pip = _VENV_DIR / ("Scripts" if sys.platform == "win32" else "bin") / "pip"
    subprocess.check_call(
        [str(pip), "install", "-q", "-r", str(_REQUIREMENTS)],
        stdout=subprocess.DEVNULL,
    )
    print("[msgraph] Dependencies installed.", file=sys.stderr)


def _reexec() -> None:
    """Replace the current process with the same script under the venv python."""
    python = str(_venv_python())
    os.execv(python, [python] + sys.argv)


# ---------------------------------------------------------------------------
# Entry point — runs on import
# ---------------------------------------------------------------------------

try:
    import msal  # noqa: F401
except ImportError:
    # Not available — need to bootstrap.
    if _is_inside_venv():
        # We're already in the venv but msal is still missing — install.
        _create_venv_and_install()
        _reexec()
    else:
        # Not in the venv. Create if needed, then re-exec.
        if not _venv_python().is_file():
            _create_venv_and_install()
        _reexec()
