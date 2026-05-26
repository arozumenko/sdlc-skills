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

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _bootstrap  # noqa: F401 — auto-installs deps, re-execs if needed

import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

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


def _item_to_record(item: dict, since_dt: datetime) -> dict | None:
    """Convert a drive item dict to an output record, or None if skipped."""
    modified_str = item.get("lastModifiedDateTime")
    if not modified_str:
        return None
    modified_dt = datetime.fromisoformat(modified_str.replace("Z", "+00:00"))
    if modified_dt < since_dt:
        return None
    # Skip folders
    if "file" not in item:
        return None

    modified_by = None
    lmb = item.get("lastModifiedBy", {}).get("user")
    if lmb:
        modified_by = {"displayName": lmb.get("displayName"), "id": lmb.get("id")}

    parent_path = None
    pr = item.get("parentReference")
    if pr:
        parent_path = pr.get("path")

    ts = modified_dt.isoformat()
    name = item.get("name", "(unknown)")
    modifier = (modified_by or {}).get("displayName", "unknown user")
    summary = f"File modified: {name} by {modifier}"

    detail = {
        "id": item.get("id"),
        "name": name,
        "lastModifiedDateTime": ts,
        "size": item.get("size"),
        "webUrl": item.get("webUrl"),
        "mimeType": item.get("file", {}).get("mimeType"),
        "parentPath": parent_path,
        "lastModifiedBy": modified_by,
    }
    return build_output_item(source="sharepoint", ts=ts, summary=summary, detail=detail)


def _fetch_modified_files(since_dt: datetime, site_id: str | None) -> list[dict]:
    credential = _build_credential()
    items: list[dict] = []

    select = "id,name,lastModifiedDateTime,size,webUrl,file,createdBy,lastModifiedBy,parentReference"
    if site_id:
        url = (
            _GRAPH_BASE
            + f"/sites/{site_id}/drive/root/delta?"
            + urllib.parse.urlencode({"$select": select, "$top": "100"})
        )
    else:
        url = (
            _GRAPH_BASE
            + "/me/drive/recent?"
            + urllib.parse.urlencode({"$select": select, "$top": "100"})
        )

    data = _get(url, credential)
    while True:
        for raw_item in data.get("value", []):
            record = _item_to_record(raw_item, since_dt)
            if record:
                items.append(record)
        next_link = data.get("@odata.nextLink")
        if not next_link:
            break
        data = _get(next_link, credential)

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
    items = _fetch_modified_files(since_dt, args.site_id)

    if not items:
        sys.exit(0)

    output_path = append_results(items, args.output)
    print(f"[scan-sharepoint] {len(items)} file(s) → {output_path}")
    maybe_relay(args.relay, args.role, output_path)


if __name__ == "__main__":
    main()
