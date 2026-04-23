# Jira-REST fallback — what works without Xray Cloud credentials

When the Xray Cloud API is unreachable — credentials rejected,
`client_id`/`client_secret` not yet issued, regional endpoint
mis-set, or the tenant is mid-outage — you can still do a
**significant chunk of diagnostic / discovery work** using
Jira REST alone (any API token that authenticates against
`<site>.atlassian.net/rest/api/3/*` via Basic auth).

This reference documents precisely what's reachable in that
degraded mode, so an agent can keep working instead of dead-
ending. It does NOT replace the Xray API — anything to do with
structured Test bodies, Test Runs, or results import still
requires working Xray creds.

## Authentication (Jira REST only)

Jira Cloud API tokens (the `ATATT3x…` format) **only** work with
Basic auth. The token is the "password" half; your Atlassian email
is the "username" half:

```bash
curl -u "you@example.com:ATATT3x..." -H 'Accept: application/json' \
  https://<site>.atlassian.net/rest/api/3/myself
```

Bearer auth is explicitly rejected (`403 Failed to parse Connect
Session Auth Token`). If you only have the token and not the email,
you cannot authenticate — ask the operator for the email.

## What IS reachable

### 1. Discover Xray issue types in a project

All six Xray entities are Jira issues with specific types:

```
POST /rest/api/3/issue/createmeta?projectKeys=<PROJ>
→ response.projects[0].issuetypes[*].name
```

Look for: `Test`, `Pre condition`, `Test Set`, `Test Plan`,
`Test Execution`. All five present ⇒ the project has Xray
installed.

### 2. List / filter Tests with JQL

Atlassian Cloud's search API migrated to `/rest/api/3/search/jql`
(POST) in late 2025. The old `/rest/api/3/search` (GET) is
deprecated.

```
POST /rest/api/3/search/jql
{
  "jql":         "project = PROJ AND issuetype = Test",
  "fields":      ["summary","status","labels"],
  "maxResults":  100
}
```

Pagination uses `nextPageToken` / `isLast`, not `startAt`.

For an exact count, use the approximate-count endpoint:

```
POST /rest/api/3/search/approximate-count
{ "jql": "project = PROJ AND issuetype = Test" }
→ { "count": 1305 }
```

### 3. Filter Tests by Test Type via entity-property JQL

Xray stores each issue's Test Type in a Jira **entity property**
(not a custom field, on recent Xray Cloud versions). JQL supports
`issue.property["<key>"].<field>` syntax:

```
jql: project = PROJ AND issuetype = Test
     AND issue.property["testType"].kind = "Manual"
```

Allowed `kind` values: `Manual`, `Cucumber`, `Generic` (lowercase
form may vary — the property also has a `name` field with capital
casing).

### 4. Read Test Type + Xray-issue-type per issue

```
GET /rest/api/3/issue/<KEY>/properties
→ list of property keys (filter for the ones below)

GET /rest/api/3/issue/<KEY>/properties/testType
→ { "key":"testType",
    "value":{ "id":"...", "name":"Manual", "kind":"manual" } }

GET /rest/api/3/issue/<KEY>/properties/xrayIssueType
→ { "key":"xrayIssueType",
    "value":{ "name":"Test" } }
```

The UI-panel marker properties (prefix
`com.xpandit.plugins.xray_xray-test-*-panel-new`) carry only
`{"added": "<panel-key>"}` and are useless for data — don't fetch
them expecting content.

### 5. Read Jira-side fields on a Test

Standard fields always work:

```
GET /rest/api/3/issue/<KEY>?fields=summary,status,description,labels,assignee,reporter,priority,issuelinks,attachment,comment
```

Useful for: building a catalogue, filtering by labels, reading
links / attachments / comments the author put directly on the
Jira issue.

### 6. File a bug / clarification issue

Standard Jira issue-create works:

```
POST /rest/api/3/issue
{
  "fields": {
    "project":    { "key": "PROJ" },
    "summary":    "Login returns 500 on plus-sign email",
    "issuetype":  { "name": "Bug" },
    "description": { /* ADF — see atlassian-content skill */ }
  }
}
```

Use the **`atlassian-content`** skill for ADF shape + mentions +
post-creation verification.

### 7. Find Jira-link-based coverage

Some teams use standard Jira `issuelinks` (`Tests` / `Is tested by`)
on top of or instead of Xray's coverage link:

```
GET /rest/api/3/issue/<STORY-KEY>?fields=issuelinks
→ fields.issuelinks[] with type.name like "Tests" / "Is tested by"
```

Fast and cheap; works without Xray. But this is NOT Xray's
official coverage — coverage rollups still need the Xray API.

## What is NOT reachable via Jira REST

All of these live in Xray Cloud's own store and require the Xray
API (`xray.cloud.getxray.app/api/v2` or regional):

- **Manual Test step list** — the `action / data / result` rows.
  Not in custom fields, not in entity properties. Xray-Cloud-only.
- **Cucumber Test scenario** — the Gherkin body beyond whatever
  the author typed into the Jira `description`.
- **Generic Test "definition"** (when separated from `description`).
- **Preconditions** linked to a Test — the Xray link type is not
  a standard Jira issue link on modern Xray Cloud installs.
- **Test Set / Test Plan → Test membership** — again, not a Jira
  issue-link type on modern installs.
- **Test Execution → Test Run contents** — statuses, timestamps,
  evidence, per-step results, executor. The Test Execution Jira
  issue only exposes UI-panel markers via entity properties.
- **Coverage rollups** — "which requirements have passing tests,
  across which test environments, in the current Test Plan".
- **Results import** — JUnit / Cucumber / Xray JSON. The `import/
  execution/*` endpoints are Xray-API-only.
- **Any write operation** on Test Type, step list, scenario, or
  Test Run status.

## Decision tree for degraded mode

```
Can the agent reach xray.cloud.getxray.app with valid JWT?
├─ YES  → use the Xray API (SKILL.md § Transport priority)
└─ NO   → Jira-REST fallback (this doc)
         ├─ Need: list / count / filter Tests by type or label?
         │        → JQL search + issue-property filter ✓
         ├─ Need: Test Type per issue, summary, status, links?
         │        → /rest/api/3/issue + /properties ✓
         ├─ Need: file a bug / clarification?
         │        → standard Jira POST + atlassian-content skill ✓
         ├─ Need: structured step list, scenario, run status?
         │        → BLOCKED. Surface the blocker to the operator;
         │          ask them to re-issue Xray API keys.
         └─ Need: upload results / create Test Runs?
                  → BLOCKED. Same ask.
```

## Surfacing the blocker

If the agent lands in "BLOCKED" branches above, do not silently
drop the work. Report clearly:

```
Xray API unreachable (<reason>: 401 invalid client credentials /
network error / regional endpoint mismatch). Operating in Jira-
REST fallback mode — can still list / filter / update issue
shells and file defects. Cannot read test bodies, runs, or
import results until the operator re-issues Xray API keys and
populates XRAY_CLIENT_ID / XRAY_CLIENT_SECRET. See
scripts/README.md § Configure via environment.
```

Then continue on whatever it can do, and leave the degraded items
as `Unconfirmed` or `Blocked` in the deliverable.
