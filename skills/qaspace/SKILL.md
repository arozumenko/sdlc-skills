---
name: qaspace
description: Query and navigate EPAM qaspace Test Management Plugin tests in a Jira Server / Data Center instance. Load when the user asks about qaspace (sometimes mistakenly called "qtest") test runs, test folders, test status, folder trees, or any JQL involving the qaspace TM custom fields (cf[23100] test run id, cf[23101] folder id, cf[24000] run name, cf[24001] folder path, cf[31500] Test Type, cf[31501] Test Status). Phrases like "show me tests in run X", "which tests failed in folder Y", "get the folder tree for project Z", "list manual tests not yet automated", "fetch tests by folder ID" all trigger this skill. Works via an MCP-wired Jira tool or direct REST API.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

# EPAM qaspace Test Management Plugin — Jira Server Test Query Skill

The **EPAM qaspace Test Management Plugin** (the `TM` plugin —
*not* Tricentis qTest, despite the common "qtest" misnomer)
stores test runs, test folders, and test executions inside a
Jira Server / Data Center instance as standard `Test`-issuetype
issues plus a set of TM custom fields. Querying it is just JQL
with a handful of custom fields — once you know which ones and
what their types are.

This skill is for **Jira Server / Data Center** deployments
(REST API v2, Bearer-token auth). If you're on a different TMS
(Xray, Zephyr, TestRail, qTest by Tricentis), use the matching
skill instead.

**Core principle:** *Resolve the test run first, then the folder,
then narrow by status/type. Paginate. Fetch only the fields you
need.*

See `references/field-reference.md` for the full field table and
known type quirks. See `references/jql-patterns.md` for
copy-paste JQL recipes. See
`references/folder-tree-reconstruction.md` when you need to
rebuild the folder hierarchy from JQL only (fallback when the
TM plugin folder-list API isn't reachable). See
`references/folder-map.md` for the template you can fill in per
project.

---

## When to load this skill

Load when the task involves reading or navigating TM Plugin
entities in Jira Server:

- Listing tests in a TM test run (by run ID or run name)
- Discovering the TM folder tree for a project
- Fetching tests from a specific TM folder (by folder ID or path)
- Filtering tests by `Test Status` and/or `Test Type` for
  automation triage
- Resolving test-run-id / folder-id quirks (the TM custom-field
  type gotchas)

Do NOT load for:

- Authoring Jira issues / comments (use `atlassian-content`)
- Xray-specific Test / Test Execution / Test Run CRUD (use
  `xray-testing` — Xray is a different plugin with a different
  data model)
- Plain Jira Cloud workflows — this plugin is Server / DC only
- Result imports — the TM Plugin doesn't expose an import
  endpoint comparable to Xray's; report results directly on the
  Test issue.

---

## Transport: which tool to use

The skill is **transport-agnostic** — it works the same way
whether you call Jira via an MCP server, an HTTP client, or
`curl`. Priority is the same as every other Jira-touching skill
in this repo (mirrors `xray-testing § Transport priority`):

1. **MCP tools first** — if your host has a Jira MCP server
   wired (e.g. an Elitea-style `mcp__<server>__<connector>_execute_generic_rq`
   or `mcp__<server>__<connector>_search_using_jql` tool),
   prefer it. The MCP layer handles auth headers, retries, and
   keeps Jira credentials out of agent context. The tool name
   pattern in MCP-wired projects is usually:

   ```
   mcp__<jira-mcp-server>__<connector>_execute_generic_rq
   mcp__<jira-mcp-server>__<connector>_search_using_jql
   ```

   Discover the actual tool name via the host's MCP listing
   (`claude mcp list`, `copilot --list-mcp`, IDE MCP settings).

2. **Direct REST** — `POST https://<your-jira-server>/rest/api/2/search`
   with `Authorization: Bearer <PAT>`. Use when MCP isn't
   available or the operation isn't covered.

3. **`curl` / `httpx`** — last resort, mostly for debugging.

**Always POST, never GET, for field-filtered searches.** GET with
a `fields` query-string parameter triggers parsing issues in
Jira Server's search endpoint when the field list grows. POST
with a JSON body is reliable.

---

## Core workflow

### 0. First contact with a new instance — verify the custom-field IDs

**Do this once per Jira Server instance before relying on any
JQL recipe in this skill.** The TM plugin's *field names*
(`"Test run id"`, `"Folder"`, `"Test Status"`, `"Test Type"`)
are stable across installations, but the numeric IDs
(`customfield_23100`, `customfield_23101`, …) depend on the
order plugins were installed in your Jira. The defaults
documented in this skill are common but not universal — a
project that installed other custom-field-heavy plugins first
will see different numbers.

#### Discovery recipe

```
GET /rest/api/2/field
```

Returns an array of every field in the instance. Filter by the
TM plugin's stable names and read the actual `id`:

```python
# Pseudocode against the response.
TM_FIELD_NAMES = {
    "Test run id":   "test_run_id",
    "Folder":        "folder_path",     # cf[24001]
    "Test Status":   "test_status",
    "Test Type":     "test_type",
}
# Some installs use a slightly different label for cf[23101] —
# look for any field whose `name` contains "Folder" and whose
# `schema.custom` mentions TM/qaspace if you don't find an exact
# "Folder id" entry.

mapping = {}
for f in response_array:
    if f["name"] in TM_FIELD_NAMES:
        mapping[TM_FIELD_NAMES[f["name"]]] = f["id"]   # e.g. "customfield_12345"
```

In JQL you can usually keep using the aliases
(`"test run id"`, `Folder`, `"Test Status"`, `"Test Type"`) —
those are registered by the plugin and don't depend on numeric
IDs. Use the numeric IDs **for the `fields` request body** and
when reading the response payload (`issue.fields.customfield_XXXXX`).

#### Cache the mapping per project

Once you've resolved the real IDs, capture them somewhere the
next agent session can find them. The cheapest pattern that
fits this repo's conventions:

```yaml
# .agents/profile.md  (or a per-project notes file)
tms:
  adapter: qaspace
  jira_base_url: https://<your-jira-server>
  project_key: <PROJECT>
  canonical_run_name: "Test Library"
  canonical_run_id: "<RUN_ID>"   # filled in after step 1 below
  custom_fields:
    test_run_id:   customfield_23100
    folder_id:     customfield_23101
    test_run_name: customfield_24000
    folder_path:   customfield_24001
    test_type:     customfield_31500
    test_status:   customfield_31501
```

Subsequent sessions read this block instead of re-querying
`/rest/api/2/field`. If the mapping isn't there yet, run the
discovery recipe and write it. If a JQL query starts erroring
with `Field 'customfield_23100' does not exist`, the mapping is
stale — re-run discovery.

#### Quick smoke test after discovery

Run one tiny query against the resolved IDs to confirm the
plumbing works end-to-end:

```json
POST /rest/api/2/search
{
  "jql": "project = <PROJECT> AND issuetype = Test",
  "maxResults": 1,
  "fields": ["key", "<resolved-test-run-id>", "<resolved-folder-path>"]
}
```

If the response includes the two custom-field values, you're
ready. If they come back `null`, double-check the IDs — some
MCP wrappers silently drop unknown `fields` instead of
erroring.

### 1. Identify the test run

Every TM query starts with a **test run ID** (`cf[23100]`). If
the user gave a run name instead, resolve it first:

```json
POST /rest/api/2/search
{
  "jql": "project = <PROJECT> AND issuetype = Test AND cf[24000] = \"<RUN_NAME>\"",
  "maxResults": 1,
  "fields": ["customfield_23100"]
}
```

Extract `customfield_23100` from the first result — that's the
run ID you'll reuse for every subsequent query. Many TM-plugin
projects have one canonical run named something like
`"Test Library"` that contains the full test repository.

### 2. Build the folder tree

**Try the TM Plugin folder list API first** — single call, full
recursive hierarchy. See § "TM Plugin folder list API" below.

**Fall back to a JQL sweep** when the plugin API is unreachable
(some hardened installs return 403; some MCP wrappers don't
proxy `/rest/tm/1.0/*`). The JQL route works against every
install because it reads only standard issue fields:

#### Step 2.a — Fetch only the two folder fields (lean payload)

```json
POST /rest/api/2/search
{
  "jql": "project = <PROJECT> AND issuetype = Test AND cf[23100] = \"<RUN_ID>\" ORDER BY cf[23101] ASC",
  "maxResults": 100,
  "startAt": 0,
  "fields": ["customfield_23101", "customfield_24001"]
}
```

Requesting only these two fields makes each issue ~300 bytes
instead of ~3 KB. A five-thousand-test run sweep costs ~50 calls
this way vs. minutes of payload-heavy paging.

#### Step 2.b — Paginate to exhaustion

Loop `startAt = 0, 100, 200, …` until `issues.length < maxResults`
or `startAt >= total` (the response always includes `total`).
See § Paginate for the cost table.

#### Step 2.c — Collect unique `(cf[23101], cf[24001])` pairs

Deduplicate across all pages. Each unique pair is one folder
node:

| `cf[24001]` (path) | `cf[23101]` (leaf folder ID) |
|---|---|
| `<PROJECT>` | `<RUN_ID>` ← root (folder ID = run ID) |
| `E2E` | `<id-A>` |
| `Smoke/Regression` | `<id-B>` |
| `Smoke/Regression/SubA` | `<id-C>` |

#### Step 2.d — Parse path strings to infer hierarchy

Split each `cf[24001]` on `/`:

```
"<PROJECT>"          → depth 0 → root node
"E2E"                → depth 1 → child of root
"Smoke/Regression"   → depth 2 → "Regression" child of "Smoke"
"A/B/C"              → depth 3 → C → B → A → root
```

The `cf[23101]` ID belongs to the **deepest** segment only. If
"Smoke" has no tests directly inside it, only `"Smoke/Regression"`
appears — `"Smoke"` is an intermediate folder with **no
discoverable ID**. Walk it via path-string matching, not ID.

For the full reconstruction algorithm (with Python pseudocode
you can adapt), see
`references/folder-tree-reconstruction.md`.

#### Caveats — don't get caught by these

| Caveat | Detail |
|---|---|
| Root signal | `cf[23101] == cf[23100]` → test is at root. Root `cf[24001]` value = project key. |
| Intermediate folders | Folders with no direct tests get no ID. Only leaf folders surface a `cf[23101]`. |
| Flat runs are common | Many runs have single-level folder names (no `/`). Don't assume depth. |
| Special chars in names | `"12438 - [AL][N] Emails templates (Agent)"` — always quote folder names in JQL. |
| Folders without any tests | Don't appear in a JQL sweep at all. Use the folder-list API to see them. |

### 3. Fetch tests from a folder

By folder ID (exact, reliable):

```json
{
  "jql": "project = <PROJECT> AND issuetype = Test AND cf[23100] = \"<RUN_ID>\" AND cf[23101] = \"<FOLDER_ID>\"",
  "maxResults": 100,
  "startAt": 0,
  "fields": ["key", "summary", "customfield_24001", "customfield_31500", "customfield_31501"]
}
```

By folder name (exact match only — `cf[24001]` does **not**
support `~`, `LIKE`, `startsWith`):

```json
{"jql": "... AND cf[24001] = \"Smoke/Regression\"", ...}
```

To query an entire subtree when you only know partial names,
fetch the full folder tree first (step 2), collect exact
`cf[24001]` strings for all matching nodes, then `OR` them:

```jql
AND (cf[24001] = "Smoke/Regression" OR cf[24001] = "Smoke/Regression/SubA")
```

### 4. Filter by status and/or type (automation triage)

For test automation work — selecting what to run, what to
triage, what to skip — combine status and type filters on any
folder query:

```jql
project = <PROJECT>
AND issuetype = Test
AND "test run id" = "<RUN_ID>"
AND Folder = "Smoke/Regression"
AND "Test Status" not in ("Out of Scope")
AND "Test Type" = Manual
```

Use `not in (...)` to **exclude** irrelevant statuses rather
than listing every valid status — the TM plugin adds new status
values occasionally, and exclusion lists are forward-compatible.

Common automation slices:

| Goal | JQL fragment |
|---|---|
| Runnable manual tests | `"Test Status" not in ("Out of Scope", "Skipped") AND "Test Type" = Manual` |
| Automated, pending run | `"Test Type" = "Automated" AND "Test Status" in ("Not Run", "Untested")` |
| Failed triage | `"Test Status" = "Failed"` |
| All active (exclude OoS) | `"Test Status" not in ("Out of Scope")` |

Valid status values (verified): `Passed`, `Failed`, `In Progress`,
`Not Run`, `Untested`, `Out of Scope`, `Blocked`, `Skipped`.

Type filter (`cf[31500]` is an object — JQL still uses the label
string):

```jql
AND "Test Type" = "Automated"
```

### 5. Paginate large result sets

Jira Server's `/rest/api/2/search` caps each call at 100 results
(soft cap on most instances). Loop `startAt`:

```
Call 1: startAt = 0,    maxResults = 100
Call 2: startAt = 100,  maxResults = 100
Call 3: startAt = 200,  maxResults = 100
...
```

Stop when `issues.length < maxResults` or `startAt >= total`.
The first response's `"total"` field tells you the page count
upfront — use `ceil(total / 100)` to budget calls.

**Sweep cost table** (folder-tree-only, two-field payload):

| Run size | Pages at 100/page | Approx wall time |
|---|---|---|
| < 100 tests | 1 | sub-second |
| ~500 tests | 5 | a few seconds |
| ~1 000 tests | 10 | ~10 seconds |
| ~5 000 tests | 50 | ~1 minute |

Request only `["customfield_23101", "customfield_24001"]` for
folder-tree sweeps — full-field payloads can be 10× slower.

---

## Field selection by use case

Pick the smallest `fields` array that answers the question. Every
extra field costs payload and parse time per issue, and adds up
fast across pages.

| Goal | `fields` to request |
|---|---|
| **Resolve run ID from run name** | `["customfield_23100"]` |
| **Folder tree sweep** (just paths + leaf IDs) | `["customfield_23101", "customfield_24001"]` |
| **Test listing** (key, name, folder, status, type) | `["key", "summary", "customfield_24001", "customfield_31500", "customfield_31501"]` |
| **Automation triage** (+ assignee, priority) | above + `["assignee", "priority", "labels"]` |
| **Test content** (steps & expected results) | above + `["customfield_19206", "customfield_19207"]` |
| **Full inspection** (one or a few tests only) | omit `fields` or pass `["*all"]` — but **never** for a paginated sweep |

`"*all"` returns every field on every issue. On a thousand-test
run that's typically 30+ MB of JSON. Only use it for spot
checks of a single key.

---

## MCP transport — call pattern

Most Jira MCP servers expose a generic-request tool. The shape
is consistent across implementations:

```
tool: mcp__<jira-mcp-server>__<connector>_execute_generic_rq
  method: "POST"
  relative_url: "/rest/api/2/search"
  params: "{\"jql\":\"...\",\"maxResults\":100,\"startAt\":0,\"fields\":[...]}"
```

`params` is usually a **JSON string** (not an object). The tool
adds auth headers automatically.

For quick spot-checks (≤5 results), many MCP servers also expose
a `*_search_using_jql` tool that takes the JQL string directly —
simpler to call but capped at 5 results in most implementations.
Use the generic-request tool for any production sweep.

---

## TM Plugin folder list API (preferred for folder discovery)

The TM Plugin exposes its own REST API at `/rest/tm/1.0/...`
which returns the **full recursive folder hierarchy in a single
call** — much faster than sweeping JQL pages to reconstruct the
tree.

```
GET /rest/tm/1.0/folder/list?projectKey=<PROJECT>&folderId=<rootFolderId>
```

The root folder ID is conventionally **equal to the canonical
test-run ID** for that project (the "Test Library" run / project
root). If you don't have it yet, run step 1 above first.

**MCP call shape:**

```
tool: mcp__<jira-mcp-server>__<connector>_execute_generic_rq
  method: "GET"
  relative_url: "/rest/tm/1.0/folder/list"
  params: "{\"projectKey\":\"<PROJECT>\",\"folderId\":\"<rootFolderId>\"}"
```

**Response shape — important quirk:**

When called through an MCP server, the response often arrives as
a **doubly-encoded** JSON string (the MCP wrapper escapes the
HTTP body, then escapes that again). Parse in two steps:

```python
import json, re

outer = json.loads(file_content)          # parse the MCP wrapper
text  = json.loads(outer[0]['text'])      # decode the inner escaped string
match = re.search(r'-> 200 OK (.+)$', text, re.DOTALL)
tree  = json.loads(match.group(1))        # now a proper Python dict/list
```

Run `scripts/parse-tm-folder-tree.py` to get a printable tree or
to search for a node by ID — it handles the double-decode for
you.

When called directly via REST (no MCP wrapper), the response is
plain JSON — skip the unwrap step.

**When to use this API vs. JQL:**

| Use case | Use |
|---|---|
| Discover folder IDs and hierarchy | TM Plugin `/rest/tm/1.0/folder/list` (single call) |
| Fetch tests from a known folder ID | JQL `cf[23101] = <folderId>` |
| Filter by status / type | JQL (the folder API does not filter by test fields) |

---

## Critical constraints (don't break these)

| Rule | Why |
|---|---|
| `cf[24001]` only supports `=` operator | TM field type — `~`, `LIKE`, `startsWith` will error |
| `*_search_using_jql` MCP tool returns max 5 results | Use `*_execute_generic_rq` POST for full result sets |
| Always POST, never GET, for field-filtered searches | GET with `fields` param has parsing issues on Jira Server |
| Quote folder names in JQL | Names contain spaces, brackets, slashes, hyphens |
| TM Plugin API response is doubly encoded when proxied via MCP | Use the two-step `json.loads` decode pattern shown above |
| `cf[23101]` is the **leaf** folder ID only | No ancestor chain — to query a subtree, build the path list first |

---

## Field type gotchas (verified against live TM-plugin data)

- **`cf[31501]` Test Status** → plain **string** (`"Untested"`,
  `"Failed"`, …) — read as `issue.fields.customfield_31501`.
- **`cf[31500]` Test Type** → **object** (`{ self, value, id,
  disabled }`) — read as `issue.fields.customfield_31500.value`
  (e.g. `"Manual"`).
- **`cf[24001]` Folder path** → plain **string**
  (`"Smoke/Regression"`).
- **`cf[24000]` Test run name** → plain **string**
  (`"Test Library"` is the common default).

Full field reference: `references/field-reference.md`.

---

## Anti-patterns

- **"I queried `Folder ~ "Smoke"` and got an error."** —
  `cf[24001]` doesn't support `~`. Build the folder list via the
  TM folder list API or by sweeping `cf[23101]` / `cf[24001]`
  pairs, then `OR` exact matches.
- **"I used the `search_using_jql` MCP tool and only got 5
  results."** — That tool is capped at 5 for quick checks. Use
  the `execute_generic_rq` tool with `POST /rest/api/2/search`
  and paginate.
- **"I requested `fields=*all` and the response timed out."** —
  Request only the fields you need. For folder-tree sweeps,
  `["customfield_23101", "customfield_24001"]` is enough. For
  test listings, add `key`, `summary`, and the status/type
  customfields.
- **"I parsed the TM folder API JSON and got a string back."** —
  When proxied via MCP it's doubly encoded. Use the two-step
  decode in `scripts/parse-tm-folder-tree.py`.
- **"I confused TM `Test Status` (cf[31501]) with the Jira
  workflow `status`."** — They're independent. A test issue can
  be Jira-workflow `Open` and TM-Status `Passed` at the same
  time. Always say which one you mean.
- **"I cached the run ID once and reused it forever."** — Most
  projects only have one canonical run, but some teams create a
  new TM run per release. If results look stale, re-resolve the
  run ID by name.

---

## Escalation

Ask the operator when:

- The project key, canonical run name, or Jira Server URL aren't
  declared anywhere (no `.agents/profile.md`, no project README
  hint, no MCP config). Don't guess.
- A folder filter returns zero results but the user is sure
  tests exist — likely an exact-match vs. path-segment mismatch.
  Ask the user for the folder ID or run the folder-tree sweep
  and confirm the exact path string.
- The discovery step (§ 0) returns **no field matching the TM
  plugin's stable names** (`"Test run id"`, `"Folder"`,
  `"Test Status"`, `"Test Type"`). That means either the TM
  plugin isn't installed on this Jira, or it's been customized
  with renamed fields. Don't guess at IDs — confirm with the
  operator which plugin is in use.
- The skill's defaults (`cf[23100]` / `cf[23101]` / `cf[24000]` /
  `cf[24001]` / `cf[31500]` / `cf[31501]`) don't match the
  discovered IDs **and** the JQL aliases also fail. That's
  unusual — most installs preserve at least the aliases. Ask
  the operator to confirm the plugin version and field
  registrations.

---

## References

- `references/field-reference.md` — TM-plugin custom-field IDs,
  types, and read-paths; Test Status / Test Type value tables.
- `references/jql-patterns.md` — copy-paste JQL recipes for
  automation triage, folder queries, and run-wide sweeps.
- `references/folder-tree-reconstruction.md` — full step-by-step
  algorithm (with Python pseudocode) for reconstructing the TM
  folder hierarchy from a JQL sweep when the folder-list API
  isn't reachable. Includes pagination cost table, dedup logic,
  and the parent-pointer build.
- `references/folder-map.md` — template for documenting a
  project's folder hierarchy once you've discovered it (fill in
  per project; treat as a working artifact, not a generic
  reference).
- `scripts/parse-tm-folder-tree.py` — stdlib Python script that
  parses a saved TM-folder-list response (handles the
  double-encoded MCP wrapper), prints the tree, drills into a
  node by ID, or filters by keyword.

External — primary sources:

- Jira Server / DC REST API v2 reference:
  https://docs.atlassian.com/software/jira/docs/api/REST/latest/
- TM Plugin documentation — usually published by the project /
  EPAM internally; the field IDs documented here are stable
  across installations but custom-field numbers can vary if the
  plugin was installed alongside other custom fields. Verify
  with `GET /rest/api/2/field` if in doubt.
