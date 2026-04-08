"""
query.py — Interactive Microsoft Graph query tool for use by Claude via the Bash tool.

Two interfaces are supported:

1. Typed subcommands (recommended):
    python3 scripts/query.py email --filter "from/emailAddress/address eq 'boss@co.com'" \\
        --select subject,bodyPreview,receivedDateTime --top 10

    python3 scripts/query.py teams channels --team-id TEAM_ID

    python3 scripts/query.py teams messages --team-id TEAM_ID --channel-id CHANNEL_ID --top 20

    python3 scripts/query.py calendar --start 2026-04-04 --end 2026-04-11 \\
        --select subject,start,end,location

    python3 scripts/query.py sharepoint files --drive-id DRIVE_ID --path /Documents

2. Flexible endpoint mode:
    python3 scripts/query.py --endpoint "/me/messages" \\
        --filter "isRead eq false" --select "subject,from,receivedDateTime,bodyPreview" --top 20

    python3 scripts/query.py --endpoint "/me/calendarView" \\
        --params "startDateTime=2024-01-01T00:00:00Z&endDateTime=2024-01-07T23:59:59Z"

3. Sample YAML file mode:
    python3 scripts/query.py --sample samples/email/unread-today.yaml

Sample YAML format:
    task: "Unread messages received today"
    script: scan-email.py
    sdk: msgraph-sdk
    endpoint: GET /me/messages
    params:
      $filter: "isRead eq false and receivedDateTime ge {today}"
      $select: "subject,from,receivedDateTime,bodyPreview"
      $top: 20
    scopes: [Mail.Read]
    notes: "Replace {today} with the desired start date if needed"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from auth import _build_credential, SCOPES

try:
    import yaml  # type: ignore
    _YAML_AVAILABLE = True
except ImportError:
    _YAML_AVAILABLE = False


# ---------------------------------------------------------------------------
# Template expansion
# ---------------------------------------------------------------------------

def _expand_template(value: str) -> str:
    """Replace built-in placeholders in filter/param strings.

    Supported placeholders:
      {now}          Current UTC timestamp (ISO 8601)
      {today}        Start of today in UTC (ISO 8601)
      {date}         Today's date (YYYY-MM-DD)
      {now+Nh}       N hours after now (e.g. {now+24h})
      {now-Nh}       N hours before now
      {now+Nd}       N days after now
      {now-Nd}       N days before now
      {week_start}   Start of the current ISO week (Monday 00:00 UTC)
      {week_end}     End of the current ISO week (Sunday 23:59:59 UTC)
    """
    now = datetime.now(tz=timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Calculate week start (Monday) and week end (Sunday)
    week_start = today_start - timedelta(days=today_start.weekday())
    week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)

    static = {
        "{now}": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "{today}": today_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "{date}": date.today().isoformat(),
        "{week_start}": week_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "{week_end}": week_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for placeholder, expanded in static.items():
        value = value.replace(placeholder, expanded)

    # Dynamic: {now+Nh}, {now-Nh}, {now+Nd}, {now-Nd}
    def _replace_dynamic(m: re.Match) -> str:
        sign = 1 if m.group(1) == "+" else -1
        amount = int(m.group(2))
        unit = m.group(3)
        if unit == "h":
            delta = timedelta(hours=amount * sign)
        else:  # d
            delta = timedelta(days=amount * sign)
        return (now + delta).strftime("%Y-%m-%dT%H:%M:%SZ")

    value = re.sub(r"\{now([+\-])(\d+)([hd])\}", _replace_dynamic, value)
    return value


# ---------------------------------------------------------------------------
# YAML sample loading
# ---------------------------------------------------------------------------

def _load_sample(path: str) -> dict:
    sample_path = Path(path)
    if not sample_path.is_file():
        # Try relative to repo root
        repo_root = Path(__file__).parent.parent
        sample_path = repo_root / path
    if not sample_path.is_file():
        raise FileNotFoundError(f"Sample file not found: {path}")

    content = sample_path.read_text("utf-8")
    if _YAML_AVAILABLE:
        data = yaml.safe_load(content)
    else:
        # Minimal fallback: parse simple key: value lines (no nested structures)
        data = {}
        for line in content.splitlines():
            if ":" in line and not line.startswith(" ") and not line.startswith("#"):
                key, _, val = line.partition(":")
                data[key.strip()] = val.strip()
    return data or {}


def _normalise_endpoint(endpoint: str) -> str:
    """Strip an optional 'GET ' method prefix from a Graph endpoint string."""
    if endpoint.upper().startswith("GET "):
        return endpoint[4:].strip()
    return endpoint


# ---------------------------------------------------------------------------
# Graph API call (with automatic pagination)
# ---------------------------------------------------------------------------

def _execute_query(
    endpoint: str,
    query_params: dict[str, Any],
    beta: bool = False,
) -> Any:
    """Execute a GET request against the Graph API and return the parsed response.

    If the response contains @odata.nextLink, all pages are fetched and the
    'value' arrays are merged into a single response object.

    The token is acquired fresh on every HTTP request via MSAL silent-acquire,
    so long paginated result sets get a refreshed token automatically.
    """
    credential = _build_credential()

    base_url = (
        "https://graph.microsoft.com/beta"
        if beta
        else "https://graph.microsoft.com/v1.0"
    )

    # Strip a leading "GET " prefix that sample YAML files may include
    endpoint = _normalise_endpoint(endpoint)

    url = base_url + endpoint
    if query_params:
        url += "?" + urllib.parse.urlencode(
            {k: str(v) for k, v in query_params.items()}
        )

    def _get(request_url: str) -> dict:
        # Acquire token inside each request so MSAL can silently refresh it
        # across long paginated result sets without the caller noticing.
        token = credential.get_token(*SCOPES)
        req = urllib.request.Request(
            request_url,
            headers={
                "Authorization": f"Bearer {token.token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                error_detail = json.loads(body)
            except json.JSONDecodeError:
                error_detail = body
            raise SystemExit(
                f"Graph API error {exc.code}: {json.dumps(error_detail, indent=2)}"
            ) from None

    first = _get(url)

    # Follow pagination if the response has a 'value' list
    if "value" in first and isinstance(first["value"], list):
        all_values = list(first["value"])
        next_link = first.get("@odata.nextLink")
        while next_link:
            page = _get(next_link)
            all_values.extend(page.get("value", []))
            next_link = page.get("@odata.nextLink")
        first["value"] = all_values
        first.pop("@odata.nextLink", None)

    return first


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def _cmd_email(args: argparse.Namespace) -> None:
    params: dict[str, Any] = {}
    params["$select"] = args.select or "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments"
    params["$orderby"] = "receivedDateTime desc"
    if args.filter:
        params["$filter"] = _expand_template(args.filter)
    if args.top is not None:
        params["$top"] = args.top
    result = _execute_query("/me/messages", params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


def _cmd_teams_channels(args: argparse.Namespace) -> None:
    params: dict[str, Any] = {
        "$select": args.select or "id,displayName,description,membershipType,createdDateTime",
    }
    if args.top is not None:
        params["$top"] = args.top
    result = _execute_query(f"/teams/{args.team_id}/channels", params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


def _cmd_teams_messages(args: argparse.Namespace) -> None:
    params: dict[str, Any] = {
        "$select": args.select or "id,createdDateTime,from,body,importance,messageType",
    }
    if args.top is not None:
        params["$top"] = args.top
    if args.filter:
        params["$filter"] = _expand_template(args.filter)
    endpoint = f"/teams/{args.team_id}/channels/{args.channel_id}/messages"
    result = _execute_query(endpoint, params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


def _cmd_calendar(args: argparse.Namespace) -> None:
    now = datetime.now(tz=timezone.utc)
    start = args.start or now.strftime("%Y-%m-%dT%H:%M:%SZ")
    end = args.end or (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Accept plain dates (YYYY-MM-DD) and expand to ISO timestamps
    if len(start) == 10:
        start += "T00:00:00Z"
    if len(end) == 10:
        end += "T23:59:59Z"
    params: dict[str, Any] = {
        "startDateTime": start,
        "endDateTime": end,
        "$select": args.select or "id,subject,start,end,organizer,location,isAllDay,isCancelled,bodyPreview",
        # Note: calendarView does not support $orderby — results are always
        # ordered by start time. Adding $orderby would cause a 400 error.
    }
    if args.top is not None:
        params["$top"] = args.top
    result = _execute_query("/me/calendarView", params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


def _cmd_sharepoint_files(args: argparse.Namespace) -> None:
    if args.drive_id:
        if args.path:
            # Encode path to item ID-style endpoint
            encoded_path = urllib.parse.quote(args.path.lstrip("/"), safe="")
            endpoint = f"/drives/{args.drive_id}/root:/{encoded_path}:/children"
        else:
            endpoint = f"/drives/{args.drive_id}/root/children"
    else:
        endpoint = "/me/drive/root/children"
    params: dict[str, Any] = {
        "$select": args.select or "id,name,size,lastModifiedDateTime,webUrl,file,folder,createdBy,lastModifiedBy",
        "$orderby": "lastModifiedDateTime desc",
    }
    if args.top is not None:
        params["$top"] = args.top
    result = _execute_query(endpoint, params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


# ---------------------------------------------------------------------------
# Parser construction
# ---------------------------------------------------------------------------

def _add_common_flags(p: argparse.ArgumentParser) -> None:
    """Add flags shared across most subcommands."""
    p.add_argument("--filter", dest="filter", default=None, help="OData $filter expression")
    p.add_argument("--select", dest="select", default=None, help="Comma-separated fields to return")
    p.add_argument("--top", dest="top", type=int, default=None, help="Max results per page")
    p.add_argument("--beta", action="store_true", default=False, help="Use the beta endpoint")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a Microsoft Graph API query and print results as JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # ---- legacy flat-interface flags (kept for backward compatibility) ----
    legacy = parser.add_argument_group("legacy flat interface")
    group = legacy.add_mutually_exclusive_group()
    group.add_argument("--sample", help="Path to a sample YAML file in samples/")
    group.add_argument("--endpoint", help="Graph API endpoint path, e.g. /me/messages")
    legacy.add_argument("--filter", dest="filter", default=None, help="OData $filter expression")
    legacy.add_argument("--select", dest="select", default=None, help="Comma-separated fields")
    legacy.add_argument("--orderby", dest="orderby", default=None, help="OData $orderby")
    legacy.add_argument("--top", dest="top", type=int, default=None, help="Max results")
    legacy.add_argument(
        "--params", dest="params", default=None,
        help="Additional raw query string params, e.g. startDateTime=...&endDateTime=..."
    )
    legacy.add_argument("--beta", action="store_true", default=False, help="Use the beta endpoint")

    # ---- typed subcommands ----
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")

    # email
    email_p = subparsers.add_parser(
        "email",
        help="Query inbox messages. Example: query.py email --filter \"isRead eq false\" --top 10",
    )
    _add_common_flags(email_p)

    # teams
    teams_p = subparsers.add_parser(
        "teams",
        help="Query Teams data. Subcommands: channels, messages",
    )
    teams_sub = teams_p.add_subparsers(dest="teams_sub", metavar="SUBCOMMAND")

    teams_channels_p = teams_sub.add_parser(
        "channels",
        help="List channels in a team. Example: query.py teams channels --team-id TEAM_ID",
    )
    teams_channels_p.add_argument("--team-id", dest="team_id", required=True, help="Team ID")
    _add_common_flags(teams_channels_p)

    teams_messages_p = teams_sub.add_parser(
        "messages",
        help="Read messages from a channel. Example: query.py teams messages --team-id T --channel-id C --top 20",
    )
    teams_messages_p.add_argument("--team-id", dest="team_id", required=True, help="Team ID")
    teams_messages_p.add_argument("--channel-id", dest="channel_id", required=True, help="Channel ID")
    _add_common_flags(teams_messages_p)

    # calendar
    calendar_p = subparsers.add_parser(
        "calendar",
        help="Query calendar events. Example: query.py calendar --start 2026-04-04 --end 2026-04-11",
    )
    calendar_p.add_argument(
        "--start", default=None,
        help="Start of time range (ISO date or datetime, e.g. 2026-04-04 or 2026-04-04T00:00:00Z)",
    )
    calendar_p.add_argument(
        "--end", default=None,
        help="End of time range (ISO date or datetime)",
    )
    _add_common_flags(calendar_p)

    # sharepoint
    sp_p = subparsers.add_parser(
        "sharepoint",
        help="Query SharePoint/OneDrive files. Subcommands: files",
    )
    sp_sub = sp_p.add_subparsers(dest="sp_sub", metavar="SUBCOMMAND")

    sp_files_p = sp_sub.add_parser(
        "files",
        help="List files in a drive folder. Example: query.py sharepoint files --drive-id ID --path /Documents",
    )
    sp_files_p.add_argument("--drive-id", dest="drive_id", default=None, help="Drive ID (omit for personal OneDrive)")
    sp_files_p.add_argument("--path", default=None, help="Folder path within the drive (e.g. /Documents)")
    _add_common_flags(sp_files_p)

    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    # ---- typed subcommand dispatch ----
    if args.command == "email":
        _cmd_email(args)
        return

    if args.command == "teams":
        if not getattr(args, "teams_sub", None):
            # Print help for `teams` subcommands
            parser.parse_args(["teams", "--help"])
            return
        if args.teams_sub == "channels":
            _cmd_teams_channels(args)
        elif args.teams_sub == "messages":
            _cmd_teams_messages(args)
        return

    if args.command == "calendar":
        _cmd_calendar(args)
        return

    if args.command == "sharepoint":
        if not getattr(args, "sp_sub", None):
            parser.parse_args(["sharepoint", "--help"])
            return
        if args.sp_sub == "files":
            _cmd_sharepoint_files(args)
        return

    # ---- legacy flat interface ----
    query_params: dict[str, Any] = {}
    endpoint: str = ""

    if args.sample:
        sample = _load_sample(args.sample)
        # Support both "GET /me/messages" and "/me/messages" in the endpoint field
        endpoint = _normalise_endpoint(sample.get("endpoint", ""))
        raw_params = sample.get("params", {}) or {}
        for k, v in raw_params.items():
            query_params[k] = _expand_template(str(v))
    elif args.endpoint:
        endpoint = args.endpoint
    else:
        parser.print_help()
        sys.exit(1)

    # Merge CLI overrides on top of sample params
    if args.filter:
        query_params["$filter"] = _expand_template(args.filter)
    if args.select:
        query_params["$select"] = args.select
    if args.orderby:
        query_params["$orderby"] = args.orderby
    if args.top is not None:
        query_params["$top"] = args.top
    if args.params:
        parsed = urllib.parse.parse_qs(args.params, keep_blank_values=True)
        for k, v in parsed.items():
            query_params[k] = v[0] if len(v) == 1 else v

    if not endpoint:
        print(
            "Error: no endpoint specified (use a subcommand, --endpoint, or --sample)",
            file=sys.stderr,
        )
        sys.exit(1)

    result = _execute_query(endpoint, query_params, beta=args.beta)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
