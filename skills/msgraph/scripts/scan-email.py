"""
scan-email.py — LLM-less script that scans the Microsoft 365 inbox for new messages.

Usage:
    python3 scripts/scan-email.py [--since 1h] [--sender boss@company.com]
                                   [--output .octobots/m365-inbox.json]
                                   [--relay PATH] [--role ROLE]
"""

from __future__ import annotations

import asyncio
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import build_arg_parser, compute_since_dt, append_results, maybe_relay, build_output_item
from auth import get_client

# Base URL for Graph v1.0
_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def _fetch_emails(since_dt: datetime, sender: str | None) -> list[dict]:
    client = get_client()
    since_str = since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    filter_parts = [f"receivedDateTime ge {since_str}"]
    if sender:
        # Escape single-quotes in the address (e.g. o'brien@example.com)
        escaped = sender.replace("'", "''")
        filter_parts.append(f"from/emailAddress/address eq '{escaped}'")
    filter_expr = " and ".join(filter_parts)

    # Use with_url() to pass OData params — the request_configuration object
    # pattern requires exact kiota-generated classes per endpoint, whereas
    # with_url() works with any Graph URL and is version-agnostic.
    url = _GRAPH_BASE + "/me/messages?" + urllib.parse.urlencode({
        "$filter": filter_expr,
        "$select": "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments",
        "$orderby": "receivedDateTime desc",
        "$top": "100",
    })
    result = await client.me.messages.with_url(url).get()

    items = []
    while result:
        for msg in result.value or []:
            received_ts = (
                msg.received_date_time.isoformat()
                if msg.received_date_time
                else since_str
            )
            from_addr = (
                {
                    "name": msg.from_.email_address.name,
                    "address": msg.from_.email_address.address,
                }
                if msg.from_ and msg.from_.email_address
                else None
            )
            detail = {
                "id": msg.id,
                "subject": msg.subject,
                "from": from_addr,
                "receivedDateTime": received_ts,
                "isRead": msg.is_read,
                "hasAttachments": msg.has_attachments,
                "bodyPreview": msg.body_preview,
            }
            sender_label = (
                from_addr["address"] if from_addr else "unknown sender"
            )
            summary = f"{msg.subject or '(no subject)'} — from {sender_label}"
            items.append(
                build_output_item(
                    source="email",
                    ts=received_ts,
                    summary=summary,
                    detail=detail,
                )
            )

        # Pagination: follow @odata.nextLink if present
        next_link = getattr(result, "odata_next_link", None)
        if not next_link:
            break
        result = await client.me.messages.with_url(next_link).get()

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
    items = asyncio.run(_fetch_emails(since_dt, args.sender))

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-email] {len(items)} message(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
