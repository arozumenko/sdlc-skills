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

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _bootstrap  # noqa: F401 — auto-installs deps, re-execs if needed

import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

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


def _ensure_utc(dt_str: str | None) -> str | None:
    if not dt_str:
        return dt_str
    if dt_str.endswith("Z") or "+" in dt_str[10:] or (dt_str.count("-") > 2):
        return dt_str
    return dt_str + "Z"


def _fetch_calendar_events(start_dt: datetime, end_dt: datetime) -> list[dict]:
    credential = _build_credential()

    start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    url = _GRAPH_BASE + "/me/calendarView?" + urllib.parse.urlencode({
        "startDateTime": start_str,
        "endDateTime": end_str,
        "$select": "id,subject,start,end,organizer,attendees,location,bodyPreview,isAllDay,isCancelled",
        "$top": "100",
    })

    items: list[dict] = []
    data = _get(url, credential)
    while True:
        for event in data.get("value", []):
            organizer = None
            org_email = (event.get("organizer") or {}).get("emailAddress")
            if org_email:
                organizer = {"name": org_email.get("name"), "address": org_email.get("address")}

            attendees = []
            for att in event.get("attendees") or []:
                ea = att.get("emailAddress")
                if ea:
                    status = (att.get("status") or {}).get("response")
                    attendees.append({"name": ea.get("name"), "address": ea.get("address"), "status": status})

            raw_start = _ensure_utc((event.get("start") or {}).get("dateTime"))
            ts = raw_start or start_str
            raw_end = _ensure_utc((event.get("end") or {}).get("dateTime"))

            subject = event.get("subject") or "(no title)"
            organizer_label = organizer["address"] if organizer else "unknown organizer"
            summary = f"{subject} — organized by {organizer_label}"

            detail = {
                "id": event.get("id"),
                "subject": event.get("subject"),
                "start": ts,
                "end": raw_end,
                "isAllDay": event.get("isAllDay"),
                "isCancelled": event.get("isCancelled"),
                "organizer": organizer,
                "attendees": attendees,
                "location": (event.get("location") or {}).get("displayName"),
                "bodyPreview": event.get("bodyPreview"),
            }
            items.append(
                build_output_item(source="calendar", ts=ts, summary=summary, detail=detail)
            )

        next_link = data.get("@odata.nextLink")
        if not next_link:
            break
        data = _get(next_link, credential)

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

    items = _fetch_calendar_events(start_dt, end_dt)

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-calendar] {len(items)} event(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
