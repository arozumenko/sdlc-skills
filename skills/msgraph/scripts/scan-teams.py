"""
scan-teams.py — LLM-less script that scans Microsoft Teams channels for new messages.

Usage:
    python3 scripts/scan-teams.py [--since 1h] [--team-id TEAM_ID]
                                   [--output .octobots/m365-inbox.json]
                                   [--relay PATH] [--role ROLE]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _bootstrap  # noqa: F401 — auto-installs deps, re-execs if needed

import json
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

from _common import build_arg_parser, compute_since_dt, append_results, maybe_relay, build_output_item
from auth import _build_credential, SCOPES

# The beta endpoint supports $filter on createdDateTime for channel messages;
# v1.0 does not, so we use beta here for server-side time-range filtering.
_GRAPH_BETA = "https://graph.microsoft.com/beta"


def _get(url: str, credential, max_retries: int = 3) -> dict:
    """GET with exponential backoff on 429 throttling."""
    delay = 2.0
    for attempt in range(max_retries + 1):
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
            if exc.code == 429 and attempt < max_retries:
                print(
                    f"[scan-teams] Rate limited (429), retrying in {delay:.0f}s "
                    f"(attempt {attempt + 1}/{max_retries}) …",
                    file=sys.stderr,
                )
                time.sleep(delay)
                delay *= 2
                continue
            body = exc.read().decode("utf-8", errors="replace")
            raise SystemExit(f"Graph API error {exc.code}: {body}") from None
    return {}  # unreachable


def _fetch_teams_messages(since_dt: datetime, team_id_filter: str | None) -> list[dict]:
    credential = _build_credential()
    items: list[dict] = []
    since_iso_str = since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Determine which teams to scan
    if team_id_filter:
        url = _GRAPH_BETA + f"/teams/{team_id_filter}?$select=id,displayName"
        try:
            team_data = _get(url, credential)
            teams = [team_data] if team_data.get("id") else []
        except SystemExit:
            teams = []
    else:
        url = _GRAPH_BETA + "/me/joinedTeams?$select=id,displayName"
        data = _get(url, credential)
        teams = data.get("value", [])
        while data.get("@odata.nextLink"):
            data = _get(data["@odata.nextLink"], credential)
            teams.extend(data.get("value", []))

    for team in teams:
        team_id = team.get("id")
        if not team_id:
            continue

        # List channels
        channels_url = _GRAPH_BETA + f"/teams/{team_id}/channels?$select=id,displayName"
        try:
            ch_data = _get(channels_url, credential)
        except SystemExit:
            continue
        channels = ch_data.get("value", [])
        while ch_data.get("@odata.nextLink"):
            ch_data = _get(ch_data["@odata.nextLink"], credential)
            channels.extend(ch_data.get("value", []))

        for channel in channels:
            channel_id = channel.get("id")
            if not channel_id:
                continue

            msgs_url = (
                _GRAPH_BETA
                + f"/teams/{team_id}/channels/{channel_id}/messages?"
                + urllib.parse.urlencode({
                    "$filter": f"createdDateTime ge {since_iso_str}",
                    "$select": "id,createdDateTime,from,body,importance,messageType",
                    "$top": "50",
                })
            )

            try:
                msgs_data = _get(msgs_url, credential)
            except SystemExit:
                continue

            while True:
                for msg in msgs_data.get("value", []):
                    created = msg.get("createdDateTime")
                    if not created:
                        continue
                    msg_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    if msg_dt < since_dt:
                        continue

                    from_user = None
                    from_obj = (msg.get("from") or {}).get("user")
                    if from_obj:
                        from_user = {"id": from_obj.get("id"), "displayName": from_obj.get("displayName")}

                    body_content = (msg.get("body") or {}).get("content")
                    channel_name = channel.get("displayName") or channel_id
                    sender_display_name = (from_user or {}).get("displayName", "unknown")
                    summary = f"New message in #{channel_name} from {sender_display_name}"

                    detail = {
                        "id": msg.get("id"),
                        "teamId": team_id,
                        "teamName": team.get("displayName"),
                        "channelId": channel_id,
                        "channelName": channel_name,
                        "createdDateTime": created,
                        "from": from_user,
                        "body": body_content,
                        "importance": msg.get("importance"),
                    }
                    items.append(
                        build_output_item(source="teams", ts=created, summary=summary, detail=detail)
                    )

                next_link = msgs_data.get("@odata.nextLink")
                if not next_link:
                    break
                try:
                    msgs_data = _get(next_link, credential)
                except SystemExit:
                    break

    return items


def main() -> None:
    parser = build_arg_parser("Scan Teams channels for new messages.")
    parser.add_argument(
        "--team-id",
        default=None,
        dest="team_id",
        help="Limit scan to a specific team ID (default: all joined teams)",
    )
    args = parser.parse_args()

    since_dt = compute_since_dt(args.since)
    items = _fetch_teams_messages(since_dt, args.team_id)

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-teams] {len(items)} message(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
