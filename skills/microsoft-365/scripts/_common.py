"""
_common.py — Shared helpers for scan scripts.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_arg_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--since",
        default="1h",
        help="Lookback window, e.g. 1h, 4h, 24h, 7d (default: 1h)",
    )
    parser.add_argument(
        "--output",
        default=".octobots/m365-inbox.json",
        help="Path for JSON output (default: .octobots/m365-inbox.json)",
    )
    parser.add_argument(
        "--relay",
        default=None,
        help="Path to a relay/taskbox script called when items are found",
    )
    parser.add_argument(
        "--role",
        default=None,
        help="Role name passed to the relay for routing",
    )
    return parser


# ---------------------------------------------------------------------------
# Output item builder
# ---------------------------------------------------------------------------

def build_output_item(
    source: str,
    ts: str,
    summary: str,
    detail: dict,
    urgent: bool = False,
) -> dict:
    """
    Build a standardised output record in the shape consumed by the PA:

        {
          "source":  "email" | "teams" | "calendar" | "sharepoint",
          "ts":      ISO-8601 UTC timestamp string,
          "summary": one-line human description,
          "detail":  original API fields dict,
          "urgent":  bool
        }
    """
    return {
        "source": source,
        "ts": ts,
        "summary": summary,
        "detail": detail,
        "urgent": urgent,
    }


# ---------------------------------------------------------------------------
# Duration parsing
# ---------------------------------------------------------------------------

_UNIT_SECONDS = {
    "s": 1,
    "m": 60,
    "h": 3600,
    "d": 86400,
    "w": 604800,
}


def compute_since_dt(since: str) -> datetime:
    """Parse a duration string like '1h', '24h', '7d' and return a UTC datetime.

    Raises:
        SystemExit: on invalid format, so callers get a clean error message.
    """
    since = since.strip().lower()
    unit = since[-1] if since else ""
    if unit not in _UNIT_SECONDS:
        print(
            f"Error: unsupported --since value '{since}'. "
            "Use s/m/h/d/w (e.g. 1h, 24h, 7d).",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        value = int(since[:-1])
    except ValueError:
        print(
            f"Error: invalid --since value '{since}'. "
            "Expected a number followed by s/m/h/d/w (e.g. 4h).",
            file=sys.stderr,
        )
        sys.exit(1)
    delta = timedelta(seconds=value * _UNIT_SECONDS[unit])
    return datetime.now(tz=timezone.utc) - delta


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def append_results(items: list[dict], output: str) -> Path:
    """Append items to the output JSON file (creates if missing).

    Writes atomically via a temp file + os.replace() to prevent data
    corruption when multiple scan scripts run concurrently.
    """
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)

    existing: list[dict] = []
    if path.is_file():
        try:
            existing = json.loads(path.read_text("utf-8"))
            if not isinstance(existing, list):
                existing = []
        except (json.JSONDecodeError, OSError):
            existing = []

    existing.extend(items)
    data = json.dumps(existing, indent=2, ensure_ascii=False)

    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return path


# ---------------------------------------------------------------------------
# Relay notification
# ---------------------------------------------------------------------------

def maybe_relay(relay: str | None, role: str | None, output_path: Path) -> None:
    """Call the relay script if --relay was provided."""
    if not relay:
        return
    cmd = [sys.executable, relay]
    if role:
        cmd += ["--role", role]
    cmd += ["--data", str(output_path)]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(
            f"[relay] Warning: relay script exited with code {result.returncode}",
            file=sys.stderr,
        )
