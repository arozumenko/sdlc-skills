"""
scan-sharepoint.py — LLM-less script that scans OneDrive/SharePoint for recently modified files.

Usage:
    python3 scripts/scan-sharepoint.py [--since 1h] [--site-id SITE_ID]
                                        [--output .octobots/m365-inbox.json]
                                        [--relay PATH] [--role ROLE]

When --site-id is omitted the user's default OneDrive is scanned via
``/me/drive/recent`` which returns recently accessed/modified items with strong
consistency (unlike the search endpoint which has eventual consistency).

When --site-id is provided the document library drive of that SharePoint site is
scanned via ``/sites/{siteId}/drive/root/delta`` to find recently modified items.
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

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def _item_to_record(drive_item, since_dt: datetime) -> dict | None:
    """Convert a DriveItem to an output record, or None if it should be skipped."""
    if not drive_item.last_modified_date_time:
        return None
    modified_dt = drive_item.last_modified_date_time
    if modified_dt.tzinfo is None:
        modified_dt = modified_dt.replace(tzinfo=timezone.utc)
    if modified_dt < since_dt:
        return None
    # Skip folders (only files have the 'file' facet)
    if not drive_item.file:
        return None

    modified_by = None
    if drive_item.last_modified_by and drive_item.last_modified_by.user:
        modified_by = {
            "displayName": drive_item.last_modified_by.user.display_name,
            "id": drive_item.last_modified_by.user.id,
        }

    parent_path = None
    if drive_item.parent_reference:
        parent_path = drive_item.parent_reference.path

    ts = modified_dt.isoformat()  # use the tz-aware modified_dt, not the raw attribute
    name = drive_item.name or "(unknown)"
    modifier = (modified_by or {}).get("displayName", "unknown user")
    summary = f"File modified: {name} by {modifier}"

    detail = {
        "id": drive_item.id,
        "name": name,
        "lastModifiedDateTime": ts,
        "size": drive_item.size,
        "webUrl": drive_item.web_url,
        "mimeType": (
            drive_item.file.mime_type if drive_item.file else None
        ),
        "parentPath": parent_path,
        "lastModifiedBy": modified_by,
    }
    return build_output_item(source="sharepoint", ts=ts, summary=summary, detail=detail)


async def _fetch_modified_files(since_dt: datetime, site_id: str | None) -> list[dict]:
    client = get_client()
    items: list[dict] = []

    if site_id:
        # SharePoint site: use /delta to enumerate all recently modified items.
        # delta() provides consistent, change-tracking semantics.
        url = (
            _GRAPH_BASE
            + f"/sites/{site_id}/drive/root/delta?"
            + urllib.parse.urlencode({
                "$select": "id,name,lastModifiedDateTime,size,webUrl,file,createdBy,lastModifiedBy,parentReference",
                "$top": "100",
            })
        )
        result = await client.sites.by_site_id(site_id).drive.root.delta().with_url(url).get()
    else:
        # Personal OneDrive: /me/drive/recent returns recently viewed/modified items
        # with strong consistency, unlike search(q='') which has eventual consistency.
        url = (
            _GRAPH_BASE
            + "/me/drive/recent?"
            + urllib.parse.urlencode({
                "$select": "id,name,lastModifiedDateTime,size,webUrl,file,createdBy,lastModifiedBy,parentReference",
                "$top": "100",
            })
        )
        result = await client.me.drive.recent().with_url(url).get()

    while result:
        for drive_item in result.value or []:
            record = _item_to_record(drive_item, since_dt)
            if record:
                items.append(record)

        # Pagination: follow @odata.nextLink if present
        next_link = getattr(result, "odata_next_link", None)
        if not next_link:
            break
        if site_id:
            result = await client.sites.by_site_id(site_id).drive.root.delta().with_url(next_link).get()
        else:
            result = await client.me.drive.recent().with_url(next_link).get()

    return items


def main() -> None:
    parser = build_arg_parser("Scan SharePoint/OneDrive for recently modified files.")
    parser.add_argument(
        "--site-id",
        default=None,
        dest="site_id",
        help="SharePoint site ID to scan (default: user's default OneDrive)",
    )
    args = parser.parse_args()

    since_dt = compute_since_dt(args.since)
    items = asyncio.run(_fetch_modified_files(since_dt, args.site_id))

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-sharepoint] {len(items)} file(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
