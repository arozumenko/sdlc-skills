"""
scan-calendar.py — LLM-less script that scans the Microsoft 365 calendar for events.

Usage:
    # Backward look (events that started in the past window):
    python3 scripts/scan-calendar.py [--since 1h] [--output .octobots/m365-inbox.json]
                                      [--relay PATH] [--role ROLE]

    # Forward look (upcoming events):
    python3 scripts/scan-calendar.py --hours-ahead 24 [--output .octobots/m365-inbox.json]
                                      [--relay PATH] [--role ROLE]
"""

from __future__ import annotations

import asyncio
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import build_arg_parser, compute_since_dt, append_results, maybe_relay, build_output_item
from auth import get_client

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def _fetch_calendar_events(start_dt: datetime, end_dt: datetime) -> list[dict]:
    client = get_client()

    start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Use calendarView for a proper time-range query.
    # Note: calendarView does NOT support $orderby — results are always ordered
    # by start/dateTime and attempting to set $orderby causes a 400 error.
    url = _GRAPH_BASE + "/me/calendarView?" + urllib.parse.urlencode({
        "startDateTime": start_str,
        "endDateTime": end_str,
        "$select": "id,subject,start,end,organizer,attendees,location,bodyPreview,isAllDay,isCancelled",
        "$top": "100",
    })
    result = await client.me.calendar_view.with_url(url).get()

    items: list[dict] = []
    while result:
        for event in result.value or []:
            organizer = None
            if event.organizer and event.organizer.email_address:
                organizer = {
                    "name": event.organizer.email_address.name,
                    "address": event.organizer.email_address.address,
                }

            attendees = []
            if event.attendees:
                for att in event.attendees:
                    if att.email_address:
                        attendees.append(
                            {
                                "name": att.email_address.name,
                                "address": att.email_address.address,
                                "status": (
                                    str(att.status.response)
                                    if att.status and att.status.response
                                    else None
                                ),
                            }
                        )

            # event.start.date_time is in UTC when calendarView is queried
            # with UTC-expressed startDateTime/endDateTime (as we always do).
            # Append an explicit 'Z' suffix if the string has no timezone marker,
            # so that the ts field is unambiguous ISO-8601 UTC.
            def _ensure_utc(dt_str: str | None) -> str | None:
                if not dt_str:
                    return dt_str
                # Already has a timezone marker (Z or ±HH:MM offset)
                if dt_str.endswith("Z") or "+" in dt_str[10:] or (dt_str.count("-") > 2):
                    return dt_str
                return dt_str + "Z"

            raw_start = _ensure_utc(event.start.date_time if event.start else None)
            ts = raw_start or start_str
            raw_end = _ensure_utc(event.end.date_time if event.end else None)

            subject = event.subject or "(no title)"
            organizer_label = organizer["address"] if organizer else "unknown organizer"
            summary = f"{subject} — organized by {organizer_label}"

            detail = {
                "id": event.id,
                "subject": event.subject,
                "start": ts,
                "end": raw_end,
                "isAllDay": event.is_all_day,
                "isCancelled": event.is_cancelled,
                "organizer": organizer,
                "attendees": attendees,
                "location": (
                    event.location.display_name
                    if event.location
                    else None
                ),
                "bodyPreview": event.body_preview,
            }
            items.append(
                build_output_item(
                    source="calendar",
                    ts=ts,
                    summary=summary,
                    detail=detail,
                )
            )

        # Pagination: follow @odata.nextLink if present
        next_link = getattr(result, "odata_next_link", None)
        if not next_link:
            break
        result = await client.me.calendar_view.with_url(next_link).get()

    return items


def main() -> None:
    parser = build_arg_parser(
        "Scan calendar for events within a lookback or lookahead window."
    )
    parser.add_argument(
        "--hours-ahead",
        type=int,
        default=None,
        dest="hours_ahead",
        help="Look forward N hours from now instead of backward (e.g. 24). "
             "When set, --since is ignored.",
    )
    args = parser.parse_args()

    now = datetime.now(tz=timezone.utc)
    if args.hours_ahead is not None:
        start_dt = now
        end_dt = now + timedelta(hours=args.hours_ahead)
    else:
        start_dt = compute_since_dt(args.since)
        end_dt = now

    items = asyncio.run(_fetch_calendar_events(start_dt, end_dt))

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-calendar] {len(items)} event(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
