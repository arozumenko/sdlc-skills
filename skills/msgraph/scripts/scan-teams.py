"""
scan-teams.py — LLM-less script that scans Microsoft Teams channels for new messages.

Usage:
    python3 scripts/scan-teams.py [--since 1h] [--team-id TEAM_ID]
                                   [--output .octobots/m365-inbox.json]
                                   [--relay PATH] [--role ROLE]
"""

from __future__ import annotations

import asyncio
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import build_arg_parser, compute_since_dt, append_results, maybe_relay, build_output_item
from auth import get_client

# The beta endpoint supports $filter on createdDateTime for channel messages;
# v1.0 does not, so we use beta here for server-side time-range filtering.
_GRAPH_BETA = "https://graph.microsoft.com/beta"
_GRAPH_V1 = "https://graph.microsoft.com/v1.0"


async def _with_backoff(async_fn, *args, max_retries: int = 3, **kwargs):
    """Call an async function with exponential backoff on HTTP 429 throttling."""
    delay = 2.0
    for attempt in range(max_retries + 1):
        try:
            return await async_fn(*args, **kwargs)
        except Exception as exc:
            # Kiota raises ODataError / APIError with response_status_code
            status = getattr(exc, "response_status_code", None)
            if status == 429 and attempt < max_retries:
                print(
                    f"[scan-teams] Rate limited (429), retrying in {delay:.0f}s "
                    f"(attempt {attempt + 1}/{max_retries}) …",
                    file=sys.stderr,
                )
                await asyncio.sleep(delay)
                delay *= 2
            else:
                raise
async def _fetch_teams_messages(since_dt: datetime, team_id_filter: str | None) -> list[dict]:
    # Use the beta client for server-side createdDateTime filter support
    client = get_client(beta=True)
    items: list[dict] = []
    since_iso_str = since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Determine which teams to scan
    if team_id_filter:
        # Fetch just the one team's metadata so we have the display name
        try:
            team_obj = await client.teams.by_team_id(team_id_filter).get()
            teams = [team_obj] if team_obj else []
        except Exception:
            teams = []
    else:
        # List all joined teams, following pagination (use v1.0 URL pattern)
        joined_url = _GRAPH_BETA + "/me/joinedTeams"
        teams_response = await client.me.joined_teams.with_url(joined_url).get()
        teams = list(teams_response.value or []) if teams_response else []
        next_link = getattr(teams_response, "odata_next_link", None)
        while next_link:
            teams_response = await client.me.joined_teams.with_url(next_link).get()
            teams.extend(teams_response.value or [])
            next_link = getattr(teams_response, "odata_next_link", None)

    for team in teams:
        if not team.id:
            continue

        # List channels for this team, following pagination
        channels_url = _GRAPH_BETA + f"/teams/{team.id}/channels"
        channels_response = await _with_backoff(
            client.teams.by_team_id(team.id).channels.with_url(channels_url).get
        )
        channels = list(channels_response.value or []) if channels_response else []
        next_link = getattr(channels_response, "odata_next_link", None)
        while next_link:
            channels_response = await _with_backoff(
                client.teams.by_team_id(team.id).channels.with_url(next_link).get
            )
            channels.extend(channels_response.value or [])
            next_link = getattr(channels_response, "odata_next_link", None)

        for channel in channels:
            if not channel.id:
                continue

            # Server-side filter on createdDateTime (beta endpoint only)
            msgs_url = (
                _GRAPH_BETA
                + f"/teams/{team.id}/channels/{channel.id}/messages?"
                + urllib.parse.urlencode({
                    "$filter": f"createdDateTime ge {since_iso_str}",
                    "$select": "id,createdDateTime,from,body,importance,messageType",
                    "$top": "50",
                })
            )

            try:
                msgs_response = await _with_backoff(
                    client.teams.by_team_id(team.id)
                    .channels.by_channel_id(channel.id)
                    .messages.with_url(msgs_url)
                    .get
                )
            except Exception:
                continue

            # Follow pagination — no client-side date filter needed since the
            # server already filters by createdDateTime ge since_iso_str.
            while msgs_response:
                for msg in msgs_response.value or []:
                    if not msg.created_date_time:
                        continue
                    msg_dt = msg.created_date_time
                    if msg_dt.tzinfo is None:
                        msg_dt = msg_dt.replace(tzinfo=timezone.utc)
                    # Guard against server returning slightly out-of-range items
                    if msg_dt < since_dt:
                        continue

                    from_user = None
                    if msg.from_ and msg.from_.user:
                        from_user = {
                            "id": msg.from_.user.id,
                            "displayName": msg.from_.user.display_name,
                        }

                    body_content = None
                    if msg.body:
                        body_content = msg.body.content

                    ts = msg.created_date_time.isoformat()
                    sender_display_name = (from_user or {}).get("displayName", "unknown")
                    channel_name = channel.display_name or channel.id
                    summary = f"New message in #{channel_name} from {sender_display_name}"

                    detail = {
                        "id": msg.id,
                        "teamId": team.id,
                        "teamName": team.display_name,
                        "channelId": channel.id,
                        "channelName": channel_name,
                        "createdDateTime": ts,
                        "from": from_user,
                        "body": body_content,
                        "importance": str(msg.importance) if msg.importance else None,
                    }
                    items.append(
                        build_output_item(
                            source="teams",
                            ts=ts,
                            summary=summary,
                            detail=detail,
                        )
                    )

                next_link = getattr(msgs_response, "odata_next_link", None)
                if not next_link:
                    break
                try:
                    msgs_response = await _with_backoff(
                        client.teams.by_team_id(team.id)
                        .channels.by_channel_id(channel.id)
                        .messages.with_url(next_link)
                        .get
                    )
                except Exception:
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
    items = asyncio.run(_fetch_teams_messages(since_dt, args.team_id))

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-teams] {len(items)} message(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
