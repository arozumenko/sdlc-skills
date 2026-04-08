---
name: msgraph
description: Microsoft 365 signal scanning — email, Teams channels, calendar, SharePoint. LLM-less scripts for scheduled scans; query.py for interactive Claude use via Bash tool.
license: Apache-2.0
compatibility: Requires Python 3.10+, Azure AD app registration with delegated Graph permissions.
metadata:
  author: octobots
  version: "0.1.0"
  dependencies:
    pip:
      - msgraph-sdk
      - msgraph-beta-sdk
      - msal
      - azure-core
  permissions:
    network: true
    filesystem: read-write
---

# Microsoft Graph Skill

Provides Microsoft 365 data access via the Microsoft Graph API. Two operating modes:

## Mode 1 — LLM-less Scan Scripts (Scheduled)

Four scripts run autonomously on a schedule without involving an LLM:

| Script | What it scans |
|---|---|
| `scripts/scan-email.py` | Inbox messages newer than `--since` |
| `scripts/scan-teams.py` | Teams channel messages newer than `--since` |
| `scripts/scan-calendar.py` | Calendar events starting within `--since` window |
| `scripts/scan-sharepoint.py` | SharePoint/OneDrive files modified within `--since` |

### Common CLI arguments

```
--since     Lookback window, e.g. 1h, 4h, 24h, 7d  (default: 1h)
--output    Path for JSON output                     (default: .octobots/m365-inbox.json)
--relay     Path to a relay/taskbox script to call when items are found
--role      Role name passed to the relay for routing
```

### Per-script additional arguments

| Script | Extra flag | Purpose |
|---|---|---|
| `scan-email.py` | `--sender boss@company.com` | Filter to a specific sender |
| `scan-teams.py` | `--team-id TEAM_ID` | Limit to a single team |
| `scan-calendar.py` | `--hours-ahead 24` | Look forward N hours instead of backward |
| `scan-sharepoint.py` | `--site-id SITE_ID` | Scan a SharePoint site instead of personal OneDrive |

### How results are delivered

1. If no items are found the script exits silently (exit code 0).
2. If items are found they are **appended** (not overwritten) to `--output` as a JSON array.
3. If `--relay` is provided the script calls:
   ```
   python3 <relay> --role <role> --data <output_path>
   ```
   The relay is responsible for pushing a taskbox notification to the named role.

### Output record shape

Every item in the output JSON array has the following fields:

```json
{
  "source":  "email | teams | calendar | sharepoint",
  "ts":      "2026-04-04T11:00:00+00:00",
  "summary": "one-line description",
  "detail":  { /* raw API fields */ },
  "urgent":  false
}
```

### Example cron entry

```
0 * * * *  cd /path/to/project && python3 scripts/scan-email.py --since 1h --relay .octobots/relay.py --role triage
```

## Mode 2 — Interactive Query via Claude (Bash Tool)

`scripts/query.py` is called by Claude during a session when the user asks about their Microsoft 365 data.

**Typed subcommands (recommended):**
```bash
python3 scripts/query.py email --filter "isRead eq false" --select "subject,from" --top 20
python3 scripts/query.py teams channels --team-id TEAM_ID
python3 scripts/query.py teams messages --team-id TEAM_ID --channel-id CHANNEL_ID --top 20
python3 scripts/query.py calendar --start 2026-04-04 --end 2026-04-11
python3 scripts/query.py sharepoint files --drive-id DRIVE_ID --path /Documents
```

**Sample file mode:**
```bash
python3 scripts/query.py --sample samples/email/unread-today.yaml
```

**Raw endpoint mode:**
```bash
python3 scripts/query.py --endpoint "/me/messages" --filter "isRead eq false" --select "subject,from" --top 20
python3 scripts/query.py --endpoint "/me/calendarView" --params "startDateTime=2024-01-01T00:00:00Z&endDateTime=2024-01-07T23:59:59Z"
```

Results are printed as pretty-printed JSON to stdout. Claude reads and summarises them for the user.
All pages are fetched automatically via `@odata.nextLink` pagination.

Sample YAML files in `samples/` describe pre-built queries that Claude can run by name.

## Authentication

All scripts share authentication state managed by `scripts/auth.py`:

```
python3 scripts/auth.py login    # Device-code flow — opens browser once, caches token
python3 scripts/auth.py status   # Show token validity and granted scopes
python3 scripts/auth.py logout   # Clear cached credentials
```

The token cache is stored at `.octobots/msgraph/token_cache.json` (project-local, when
`.octobots/` exists) or `~/.msgraph-skill/token_cache.json` (home fallback).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MSGRAPH_CLIENT_ID` | *(required — no default)* | Azure AD app client ID |
| `MSGRAPH_TENANT_ID` | `common` | Azure AD tenant (use tenant ID for single-org) |

### Azure AD App Registration

You must register your own Azure AD application before using this skill:

1. Go to [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps) and click **New registration**.
2. Set a name (e.g. *octobots-msgraph*), choose **Accounts in this organizational directory only** or **Personal Microsoft accounts**, then click **Register**.
3. Copy the **Application (client) ID** from the Overview page and export it:
   ```bash
   export MSGRAPH_CLIENT_ID="<your-application-id>"
   # optional, for single-tenant orgs:
   export MSGRAPH_TENANT_ID="<your-tenant-id>"
   ```
4. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add:
   `Mail.Read`, `Calendars.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`,
   `ChannelMessage.Read.All`, `Sites.Read.All`, `Files.Read.All`
5. Under **Authentication → Add a platform → Mobile and desktop applications**, enable the
   `https://login.microsoftonline.com/common/oauth2/nativeclient` redirect URI.
6. Run `python3 scripts/auth.py login` to complete the device-code flow.

### Required Microsoft Graph permissions (delegated)

`Mail.Read`, `Calendars.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`,
`ChannelMessage.Read.All`, `Sites.Read.All`, `Files.Read.All`

## Setup

```bash
pip install -r requirements.txt
export MSGRAPH_CLIENT_ID="<your-application-id>"
python3 scripts/auth.py login
```
