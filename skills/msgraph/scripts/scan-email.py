"""
scan-email.py — LLM-less script that scans the Microsoft 365 inbox for new messages.

Usage:
    python3 scripts/scan-email.py [--since 1h] [--sender boss@company.com]
                                   [--output .octobots/m365-inbox.json]
                                   [--relay PATH] [--role ROLE]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _bootstrap  # noqa: F401 — auto-installs deps, re-execs if needed

import json
import urllib.parse
import urllib.request
import urllib.error

from _common import build_arg_parser, compute_since_dt, append_results, maybe_relay, build_output_item
from auth import _build_credential, SCOPES

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def _get(url: str, credential) -> dict:
    token = credential.get_token(*SCOPES)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token.token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Graph API error {exc.code}: {body}") from None


def _fetch_emails(since_str: str, sender: str | None) -> list[dict]:
    credential = _build_credential()

    filter_parts = [f"receivedDateTime ge {since_str}"]
    if sender:
        escaped = sender.replace("'", "''")
        filter_parts.append(f"from/emailAddress/address eq '{escaped}'")
    filter_expr = " and ".join(filter_parts)

    url = _GRAPH_BASE + "/me/messages?" + urllib.parse.urlencode({
        "$filter": filter_expr,
        "$select": "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments",
        "$orderby": "receivedDateTime desc",
        "$top": "100",
    })

    items = []
    data = _get(url, credential)
    while True:
        for msg in data.get("value", []):
            received_ts = msg.get("receivedDateTime", since_str)
            from_obj = msg.get("from", {}).get("emailAddress")
            from_addr = (
                {"name": from_obj.get("name"), "address": from_obj.get("address")}
                if from_obj
                else None
            )
            detail = {
                "id": msg.get("id"),
                "subject": msg.get("subject"),
                "from": from_addr,
                "receivedDateTime": received_ts,
                "isRead": msg.get("isRead"),
                "hasAttachments": msg.get("hasAttachments"),
                "bodyPreview": msg.get("bodyPreview"),
            }
            sender_label = from_addr["address"] if from_addr else "unknown sender"
            summary = f"{msg.get('subject') or '(no subject)'} — from {sender_label}"
            items.append(
                build_output_item(
                    source="email",
                    ts=received_ts,
                    summary=summary,
                    detail=detail,
                )
            )
        next_link = data.get("@odata.nextLink")
        if not next_link:
            break
        data = _get(next_link, credential)

    return items


def main() -> None:
    parser = build_arg_parser("Scan inbox for new email messages.")
    parser.add_argument(
        "--sender",
        default=None,
        help="Filter to messages from this email address (e.g. boss@company.com)",
    )
    args = parser.parse_args()

    since_dt = compute_since_dt(args.since)
    since_str = since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    items = _fetch_emails(since_str, args.sender)

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-email] {len(items)} message(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
