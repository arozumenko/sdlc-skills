# TMS Adapters

The workflow is TMS-agnostic. All TMS interaction flows through an
adapter — a thin layer with a fixed contract. Swap one config line, the
workflow keeps running.

## At a glance

| Concern | Where it lives |
|---|---|
| **Which TMS, which transport, which project key** | `.agents/test-automation.yaml` § `tms` |
| **TMS adapter contract** (fetch / list / update / create / link) | this file — *Contract* section below |
| **Per-TMS auth + URL shape** | this file — adapter blocks (Zephyr / TestRail / Xray / Azure / markdown) |
| **Which MCP toolset each adapter uses** | this file — *Toolset mapping* table |
| **Concrete invocation examples** (analyst fetch, back-write) | `commands.md` (Phase 2 + Phase 8) |
| **TMS status verbs** (passed / failed / blocked / not-executed / skipped) | this file — adapter contract |
| **When the TMS is unreachable** | this file — *Failure modes* |

If you're onboarding a new project:

1. Pick the adapter row matching your TMS.
2. Pick the transport (MCP if already wired in the host; HTTP
   otherwise).
3. Copy the config block into `.agents/test-automation.yaml`.
4. Wire any required env vars (`auth_env` line names them).
5. Done — the workflow doesn't care which adapter you picked.

No TMS at all? `adapter: markdown` is a one-liner; AFS files in
`test-specs/` become the source of truth.

## Transports

Two transports satisfy the adapter contract. Pick whichever the project
already has set up:

- **HTTP** — the TMS's public REST/GraphQL API, credentials in env
  vars. Works everywhere, no host dependency.
- **MCP** — an MCP server (e.g. Elitea, Atlassian Remote MCP, a
  vendor-provided TestRail / Xray MCP) already wired into the host
  (Claude Code, Cursor, Copilot, Windsurf, taskbox). The adapter
  invokes MCP tools instead of raw HTTP; auth lives in the MCP server
  config (`.mcp.json` / `settings.json`), not in the project repo.

Prefer MCP when it's already configured — no secrets in the repo, no
retry/backoff/auth plumbing for the workflow to own. Fall back to HTTP
when no MCP server exists.

## Configuration file

`.agents/test-automation.yaml` at the project root:

```yaml
tms:
  adapter: zephyr-scale   # zephyr-scale | testrail | xray | azure-test-plans | markdown
  transport: http         # http | mcp
  project_key: SCRUM      # TMS project / workspace key
  # adapter-specific fields follow:

  # --- zephyr-scale over HTTP ---
  jira_base_url: https://your-company.atlassian.net
  zephyr_base_url: https://api.zephyrscale.smartbear.com/v2
  auth_env: ZEPHYR_TOKEN

  # --- zephyr-scale over MCP ---
  # transport: mcp
  # mcp_server: Elitea_Dev           # name as registered in the host's MCP config
  # mcp_toolset: ZephyrConnector     # logical tool namespace inside the server
  # jira_toolset: JiraIntegration    # optional — for story lookup / linking

  # --- testrail ---
  # base_url: https://your-company.testrail.io
  # auth_env: TESTRAIL_CREDS   # format: "user:api_key"

  # --- xray ---
  # base_url: https://xray.cloud.getxray.app/api/v2
  # auth_env: XRAY_CLIENT      # format: "client_id:client_secret"
  # jira_base_url: https://your-company.atlassian.net

  # --- azure-test-plans ---
  # organization: your-org
  # project: your-project
  # auth_env: AZURE_DEVOPS_PAT

  # --- markdown (default fallback) ---
  # cases_dir: test-specs

framework:
  language: typescript       # typescript | javascript | python | java | csharp
  runner: playwright         # playwright | cypress | pytest | junit | nunit | xunit | wdio
  tests_dir: tests
  pages_dir: tests/pages
  fixtures: tests/fixtures
  env_file: .env
  run_command: "npm run test:ci"
  headed_command: "npm run test:headed"

evidence:
  screenshots_dir: test-results/screenshots
  reports_dir: test-results/reports
  json_dir: test-results/json
```

Only the `tms.adapter` plus the adapter's own fields are mandatory. The
`framework:` block is filled from scout output — regenerate it via
[`project-seeder`](../../project-seeder/) if absent.

## Adapter contract

Every adapter exposes the same verbs. Language is per project — most
projects will invoke these through CLI wrappers, MCP tools, or
direct HTTP calls — the *contract*, not the implementation, is what
matters.

```
fetch_case(id)
  → { id, key, name, preconditions, steps, expected, cleanup,
      links, priority, labels, attachments }

list_cases(filter)
  → [ id, ... ]   # filter: jql, tag, folder, story link, execution cycle, etc.

update_execution(case_id, { status, evidence_urls, duration_ms, notes })
  → { execution_id, synced: bool }

create_case(afs_markdown)          # optional — not all adapters support
  → { id }

link_case_to_story(case_id, story) # optional
  → { success: bool }
```

Status vocabulary is normalized to:

```
passed | failed | blocked | not-executed | skipped
```

Each adapter maps these to its native statuses.

## Supported adapters

### zephyr-scale

- **Fetch**: `GET /testcases/{caseKey}`, `GET /testcases/{caseKey}/teststeps`
- **Update execution**: `POST /testexecutions` then
  `POST /testexecutions/{id}/teststeps`
- **List by cycle**: `GET /testcycles/{cycleKey}/testexecutions`
- **Auth**: Bearer token in `Authorization: Bearer $ZEPHYR_TOKEN`
- **Known quirks**: step-level execution results must be sent separately
  from the execution record; order matters.

### testrail

- **Fetch**: `GET /index.php?/api/v2/get_case/{id}`
- **Update execution**: `POST /add_result_for_case/{run_id}/{case_id}`
- **List by run**: `GET /get_tests/{run_id}`
- **Auth**: Basic `user:api_key` base64
- **Status mapping**: 1=passed, 2=blocked, 4=retest, 5=failed

### xray

- **Fetch**: GraphQL against `/graphql` — `getTests(jql: ...)`
- **Update execution**: `POST /import/execution` with multipart or JSON
- **Auth**: client-credentials → bearer token
- **Jira link**: test cases are Jira issues; use Jira API for linking

### azure-test-plans

- **Fetch**: `GET {org}/{project}/_apis/test/plans/{plan}/suites/{suite}/testcases`
- **Update execution**: `POST /testRuns/{runId}/results`
- **Auth**: PAT in `Authorization: Basic base64(:$PAT)`

### markdown

- **Fetch**: read file at `test-specs/{feature}/{id}.md`
- **Update execution**: append to `test-specs/{feature}/{id}.md` under
  a `## Executions` section, plus write JSON to `evidence.json_dir`
- No auth. No network. Zero dependency. Always works.

## MCP transport — tool mapping

When `transport: mcp`, the adapter calls MCP tools exposed by the
configured server instead of issuing HTTP requests. Tool names follow
the host's convention — Claude Code exposes them as
`mcp__<server>__<tool>`. The adapter contract is satisfied by the
following mappings (examples; substitute your server's actual tool
names):

### Elitea — Zephyr Scale + Jira

| Contract verb | MCP tool |
|---|---|
| `fetch_case(id)` | `mcp__<server>__ZephyrConnector_get_test_case` + `..._get_test_case_test_steps` + `..._get_test_case_links` |
| `list_cases(story)` | `mcp__<server>__ZephyrConnector_get_issue_link_test_cases` |
| `list_cases(cycle)` | `mcp__<server>__ZephyrConnector_get_test_cycle_links` + `..._list_test_executions` |
| `update_execution()` | `mcp__<server>__ZephyrConnector_create_test_execution` + `..._update_test_execution_test_steps` |
| `create_case()` | `mcp__<server>__ZephyrConnector_create_test_case` + `..._create_test_case_test_steps` |
| `link_case_to_story()` | `mcp__<server>__ZephyrConnector_create_test_case_issue_link` |
| Jira story lookup | `mcp__<server>__JiraIntegration_search_using_jql` / `..._execute_generic_rq` |

### Atlassian Remote MCP (generic Jira + Confluence)

Use when the project tracks test cases as Jira issues rather than
Zephyr entries. Map `fetch_case` → `getJiraIssue`, `list_cases` →
`searchJiraIssuesUsingJql` with a label or issuetype filter.

### TestRail / Xray MCP (vendor or community)

Same pattern — locate the server's `get_case`, `add_result_for_case` /
`importExecution` equivalents and wire them into the contract verbs.

### Host-side configuration

MCP server credentials live in the host's config, never in the project
repo:

- **Claude Code** → `~/.claude.json` or project-level `.mcp.json`
- **Cursor / Windsurf** → respective `mcp.json`
- **GitHub Copilot** → `.github/copilot/` MCP settings
- **Taskbox** → its own `mcp.yaml`

Tokens with no expiry (`exp: null` in the JWT) are especially worth
keeping out of the repo — rotate them via the host's secrets
mechanism, not via commits.

## Choosing an adapter

- **Project already uses a TMS?** Use it — back-writing results is the
  whole point of TMS visibility.
- **Project has no TMS / throwaway repo / CTF / demo?** `markdown`.
- **Multi-TMS org?** Still pick one per project — cases don't cross
  TMS boundaries cleanly.

## When the adapter fails

Fetch failures (network, auth, deleted case) — fall back to the TMS's
web UI: analyst opens the case in the browser, copies content into
`markdown` format, proceeds. Do not block the workflow on a flaky TMS.

Back-write failures (execution update) — queue the update, log it in
`test-results/unsynced/`, surface a warning at end-of-run. Humans can
sync manually; the test result is already on disk.

## Writing a new adapter

Adapter lives outside this repo — in the project's own scripts — unless
it's common enough to upstream. Minimum requirements:

- Implements `fetch_case` and `update_execution`
- Declares its `adapter` name in `.agents/test-automation.yaml`
- For `transport: http` — reads secrets from env vars named in
  `auth_env`, never inline
- For `transport: mcp` — references only the `mcp_server` / `mcp_toolset`
  names; secrets stay in the host's MCP config
- Maps status vocabulary both ways
- Tolerates the TMS being down (returns structured error, does not crash
  the workflow)

A reference implementation for `markdown` ships with this skill and is
worth reading before writing a new one.
