# `tosca_cli.py` — CLI quick reference

Python CLI for Tricentis TOSCA Cloud REST APIs: Identity, MBT/Builder
v2 (test cases, modules, reusable blocks), Playlists v2, Inventory v3
+ v1 folder ops, Simulations v1, E2G (execution logs).

Upstream: <https://github.com/bermudas/toscacloud_cli>. Redistributed
here under Apache-2.0.

**MCP is first. This CLI is the build-and-fallback path.** See
`../SKILL.md § Transport priority` for the rules — briefly: prefer
`mcp__ToscaCloudMcpServer__*` when a matching tool exists, but still
use the CLI for build-time mutations (create / update / patch /
move / TSU) and for shared-agent runs. Personal-agent runs go through
MCP (the service token can't see them).

## Install

Python 3.10+.

```bash
# Into a project-local venv:
python3 -m venv .venv && source .venv/bin/activate
pip install -r <install-path>/skills/tosca-automation/scripts/requirements.txt

# Optional: shim `tosca` onto PATH
ln -s "$(pwd)/<install-path>/skills/tosca-automation/scripts/tosca_cli.py" ~/.local/bin/tosca
chmod +x ~/.local/bin/tosca
```

Swap `<install-path>` for `.claude/` / `.cursor/` / `.windsurf/` /
`.github/` depending on where sdlc-skills installed.

Dependencies: `httpx`, `typer[all]`, `rich`, `python-dotenv` (see
`requirements.txt`).

> **Before your first `tosca` command: gitignore the secrets.** The
> CLI writes `token.json` (live bearer) and reads `.env` (OAuth
> credentials) in the current working directory. See
> § [Secrets hygiene](#secrets-hygiene--append-to-your-gitignore).

## Configure via environment

Two options: `tosca config set …` (writes to `.env` in the project
root), or export env vars directly.

```bash
# Tenant
export TOSCA_TENANT_URL="https://<your-tenant>.my.tricentis.com"
export TOSCA_SPACE_ID="<space-uuid>"   # UUID from the portal URL, or "default"

# OAuth2 (client_credentials — find the Okta URL in the Swagger UI's
# Authorize dialog)
export TOSCA_TOKEN_URL="https://<org>-tricentis.okta.com/oauth2/default/v1/token"
export TOSCA_CLIENT_ID="<client-id>"
export TOSCA_CLIENT_SECRET="<client-secret>"
export TOSCA_SCOPE="tta"               # default — do not change unless Tricentis tells you to

# Optional
# export TOSCA_TIMEOUT="30"
# export TOSCA_VERIFY_SSL="false"      # only for self-signed dev tenants
# export TOSCA_OPENAI_KEY="sk-…"       # only for the `ask` command
```

Config discovery order (first hit wins):
1. `.env` in the current working directory
2. `TOSCA_*` env vars already exported

Token is cached in `./token.json` (mode 0600) and auto-refreshed 60 s
before expiry. The cache is project-local on purpose — never under
`~/.tosca_cli/` — so per-tenant isolation is trivial.

### Secrets hygiene — append to your `.gitignore`

Before running any `tosca` command in a repo, ensure these patterns
are in the repo's `.gitignore`. The CLI auto-creates `token.json`
(contains a live bearer) on first use; `.env` holds your OAuth
credentials. MCP config files carry the tenant URL + redirect port.

```gitignore
# TOSCA Cloud CLI — secrets & runtime
.env
config.env
token.json

# Tenant-specific swagger exports (re-download from /apiDocs/swagger)
swaggers/

# MCP wiring (tenant URL + PKCE callback port)
.mcp.json
.vscode/mcp.json

# Playwright MCP runtime cruft
.playwright-mcp/
```

Quick one-liner to patch an existing `.gitignore` idempotently:

```bash
grep -qxF 'token.json' .gitignore 2>/dev/null || cat >> .gitignore <<'EOF'

# TOSCA Cloud CLI — secrets & runtime
.env
config.env
token.json
swaggers/
.mcp.json
.vscode/mcp.json
.playwright-mcp/
EOF
```

If a credential or `token.json` has already been committed, rotate
the secret (`tosca identity new-secret <appId>` for the OAuth
client) and then remove the blob from history — don't rely on a
subsequent delete-commit.

## Getting credentials

Official guide: [Get a client secret — TOSCA Cloud docs](https://docs.tricentis.com/tosca-cloud/en-us/content/admin_guide/get_client_secret.htm).

```bash
tosca identity apps                    # list OAuth apps on the tenant
tosca identity secrets <appId>         # list existing secrets
tosca identity new-secret <appId>      # generate (shown once — copy immediately)
```

**Space ID** is the UUID in the portal URL:
`https://<tenant>/<space-uuid>/…`. Or use `default`.

## Smoke test

```bash
tosca config test                      # token round-trip + Identity ping
tosca inventory search "" --type TestCase | head
tosca playlists list
```

`config test` prints `Token obtained successfully. / Identity API
reachable. Found N application(s).` on success.

## MCP wiring — `ToscaCloudMcpServer`

The CLI covers build / discovery / shared-agent runs. **Personal-agent
runs go through the TOSCA Cloud MCP server**, which the tenant exposes
at `/<spaceId>/_mcp/api/mcp`. Most hosts wire it via `mcp-remote` so
the server URL + PKCE OAuth happen in a subprocess; the developer logs
in to Okta once and the refresh token is cached.

### Claude Code (`.mcp.json`)

```jsonc
{
  "mcpServers": {
    "ToscaCloudMcpServer": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@latest",
        "https://<tenant>.my.tricentis.com/<spaceId>/_mcp/api/mcp",
        "56874",
        "--host", "127.0.0.1",
        "--static-oauth-client-info",  "{\"client_id\":\"MCPServer\"}",
        "--static-oauth-client-metadata", "{\"scope\":\"tta\"}"
      ]
    }
  }
}
```

### VS Code Copilot (`.vscode/mcp.json`)

Same `command` / `args` block under `servers.ToscaCloudMcpServer`.

### What each arg does

- `56874` — PKCE callback port. Any free port works; `mcp-remote`
  starts a tiny HTTP server there to receive the Okta redirect.
- `--host 127.0.0.1` — bind loopback only.
- `--static-oauth-client-info '{"client_id":"MCPServer"}'` — the
  tenant's pre-registered public client ID for MCP. Do not invent
  another.
- `--static-oauth-client-metadata '{"scope":"tta"}'` — same scope the
  CLI uses. `tta` = TOSCA Testing API.

### First-call handshake

On the first MCP tool call (e.g. `mcp__ToscaCloudMcpServer__GetRecentRuns`):
1. `mcp-remote` opens a browser to the tenant's Okta login.
2. Developer logs in as themselves (not the service account).
3. Refresh token is cached locally (under `~/.mcp-auth/` by default).
4. Every subsequent MCP call carries the developer's user identity —
   which is what authorizes dispatch to that developer's personal
   Local Runner agent.

### Tool naming convention

MCP tools are `mcp__ToscaCloudMcpServer__<MethodName>` — **double
underscore**, PascalCase server name, PascalCase method. Do not write
`mcp_toscacloudmcp_*` (single underscore, lowercase) — that form is
an autocomplete mistake and will not resolve.

### MCP writes are scaffolding-only — never use `ScaffoldTestCase` to clone

MCP's write tools are **scaffolding-only**. They drop attribute
bindings, `ControlFlowItemV2` nodes, and parameter values. When the
user asks to copy / clone / duplicate an existing case, use the CLI
— never `ScaffoldTestCase`.

| Capability | Tool |
|---|---|
| Search, read, analyze | MCP: `SearchArtifacts`, `AnalyzeTestCaseItems`, `GetModulesSummary` |
| Dispatch + inspect runs | MCP: `RunPlaylist`, `GetRecentRuns`, `GetRecentPlaylistRunLogs`, `GetFailedTestSteps` |
| New-from-scratch test cases | MCP: `ScaffoldTestCase` (scaffolding only — no bindings) |
| **Clone / copy / duplicate** an existing case | **CLI: `cases clone <id>`** (preserves module/attr refs + ControlFlow + parameters) |
| Write with full fidelity | CLI: `cases update`/`modules update`/`blocks update --json-file` |
| PATCH writes (confirm-GET required) | CLI: `cases patch`, `inventory patch` |
| Delete a playlist | MCP: `DeletePlaylistById` |
| Delete case / module / block | Portal UI (service token lacks delete) |

### When the MCP server is right vs wrong

| Operation | CLI or MCP? |
|---|---|
| Build: create/update/patch cases / modules / blocks / folders, TSU export/import | CLI (service token works; MCP's write surface is narrower) |
| Discovery: inventory search, cases get/steps, modules get | Either — CLI is faster; MCP works too |
| Run on shared / grid / team agent | CLI: `tosca playlists run <id> --wait` |
| Run on developer's personal Local Runner | **MCP** — `RunPlaylist(playlistId, runOnAPersonalAgent=true)` (CLI's service token is 403'd on personal agents) |
| Poll recent runs by name | **MCP** — `GetRecentRuns({nameFilter:"<exact playlist name>"})` |
| Per-step failure tree | **MCP** — `GetFailedTestSteps({runIds:[<executionId>]})` (needs the executionId, not `playlistRun.id`) |

See `../SKILL.md § Iterative test-development loop` for the full
build → run → inspect cadence.

## CLI surface

```bash
# Discovery
tosca inventory search "<name>" [--type TestCase|Module|folder] [--include-ancestors]
tosca inventory get TestCase <entityId> --include-ancestors
tosca inventory folder-tree --folder-ids "<parentId>"

# Test cases
tosca cases get <id> --json
tosca cases steps <id> --json
tosca cases create --name "…" --state Planned
tosca cases update <id> --json-file case.json      # full PUT
tosca cases patch  <id> --operations '[{"op":"replace","path":"/workState","value":"Completed"}]'
tosca cases clone  <id> --name "…"
tosca cases export-tsu --ids "id1,id2" --output file.tsu
tosca cases import-tsu --file file.tsu

# Modules
tosca modules get <id> [--json]
tosca modules create --name "…" --iface Gui
tosca modules update <id> --json-file body.json

# Reusable blocks
tosca blocks get <id>
tosca blocks add-param <id> --name <name> [--value-range '1,2,3']
tosca blocks set-value-range <id> <paramName> --values '1,2,3,4'
tosca blocks delete <id> --force

# Playlists (service-token = grid / team agents only)
tosca playlists list
tosca playlists list-runs
tosca playlists run <id> --wait
tosca playlists results <runId>
tosca playlists logs   <runId>                     # per-unit E2G transcripts
tosca playlists logs   <runId> --save ./logs
tosca playlists attachments <runId>                # SAS URLs

# Folders (inventory v1, undocumented but stable)
tosca inventory create-folder --name "…" [--parent-id "…"]
tosca inventory rename-folder <folderId> --name "…"
tosca inventory delete-folder <folderId> [--delete-children] --force
tosca inventory move testCase <entityId> --folder-id <folderEntityId>

# Identity
tosca identity apps
tosca identity secrets <appId>
tosca identity new-secret <appId>
tosca identity get-secret <appId> <secretId>
```

All commands accept `--json` (**place before positional args**) and
`--help`.

See `../SKILL.md § Key CLI commands` for the wider table and
`../SKILL.md § Critical caveats` for the 27-row trap list.

## Extending this script

Agents are allowed — encouraged — to fix or extend `tosca_cli.py`
when they hit a bug or missing capability. The upstream project
treats this as a **self-improvement protocol**: never leave a
discovered bug unfixed, never let a one-off script linger alongside
the CLI. Fold the fix in, keep the style consistent, and re-run.

### When to trigger

| Trigger | Action |
|---|---|
| Command fails / produces wrong output | Fix the `ToscaClient` method or the Typer command, re-run against the live tenant |
| New API behavior / undocumented endpoint / required field | Add a `ToscaClient` method + Typer command; add a row to `../SKILL.md § Critical caveats` if it's a quirk future agents will hit |
| New workflow pattern worth codifying | Add a branch to `../SKILL.md § Decision tree` |
| Workaround was a one-off `.py` script | Move the logic into a proper CLI command |

### Architecture (so your edit fits in)

Single file, no sub-packages:

- `ToscaClient` class — every HTTP call lives here, **one method per
  endpoint**, docstring = `VERB /path → ReturnType`. Use the URL
  builders, never construct URLs by hand:
  ```python
  client.identity(path)          # /_identity/api/v1/{path}
  client.mbt(path)               # /{spaceId}/_mbt/api/v2/builder/{path}
  client.playlist(path)          # /{spaceId}/_playlists/api/v2/{path}
  client.inventory_url(path)     # /{spaceId}/_inventory/api/v3/{path}
  client.inventory_v1_url(path)  # /{spaceId}/_inventory/api/v1/{path}
  client.simulations_url(path)   # /{spaceId}/_simulations/api/v1/{path}
  client.e2g_url(path)           # /{spaceId}/_e2g/api/{path}
  ```
- Typer sub-apps: `config_app`, `identity_app`, `cases_app`,
  `modules_app`, `blocks_app`, `playlists_app`, `inventory_app`,
  `simulations_app`. New command → pick the right sub-app.
- `_output_json(data)` — Rich syntax-highlighted JSON when stdout is
  a tty; plain `print()` for piping. Use this — don't hand-roll
  output.
- `_exit_err(msg)` — red stderr + `typer.Exit(1)` for user-facing
  errors.
- `_generate_ulid()` — Crockford base32 ULID. Use wherever a fresh
  ULID is needed (block params, `parameterLayerId`, etc.).
- `_get_access_token()` — OAuth2 client_credentials, cached in
  `token.json` (0600), auto-refreshed 60 s before expiry.

### Style rules

- Python 3.10+, type hints throughout. `X | Y` unions, not
  `Optional[X]` where avoidable.
- Every new Typer command has a `--json` flag and a Rich
  table/panel for the human view.
- Single file. Do not split into sub-packages.
- Re-fetch-and-verify discipline after every write: GET the
  artifact, confirm `version` bumped and the specific field
  changed. Don't trust the server's 204 or `{}` — see
  `../SKILL.md § Critical caveats`.

### Ship checklist for a new command

1. Add the `ToscaClient` method (with the `VERB /path → ReturnType`
   docstring).
2. Add the Typer command on the right `*_app` with `--json` and
   short `--help`.
3. Validate against the live tenant (not just `--help`).
4. If it exposes a new quirk, add a row to `../SKILL.md § Critical
   caveats`.
5. If it opens a new workflow, add a branch to `../SKILL.md §
   Decision tree`.

## API surfaces

Seven HTTP surfaces. Each has a live Swagger UI on the tenant —
useful when the CLI disagrees with docs or you're adding a new
command. Published swagger occasionally diverges from runtime
(filter casing, PATCH shape, response `Content-Type`); **trust the
CLI's observed behavior and cross-check the Swagger UI on your
tenant** rather than a downloaded spec.

| Surface | Base path | Swagger UI |
|---|---|---|
| Identity | `/_identity/api/v1/` | `/_identity/apiDocs/swagger` |
| MBT / Builder | `/{spaceId}/_mbt/api/v2/builder/` | `/{spaceId}/_mbt/apiDocs/swagger` |
| Playlists | `/{spaceId}/_playlists/api/v2/` | `/{spaceId}/_playlists/apiDocs/swagger` |
| Inventory v3 | `/{spaceId}/_inventory/api/v3/` | `/{spaceId}/_inventory/apiDocs/swagger` |
| Inventory v1 | `/{spaceId}/_inventory/api/v1/` | — (undocumented) |
| Simulations | `/{spaceId}/_simulations/api/v1/` | `/{spaceId}/_simulations/apiDocs/swagger` |
| E2G (execution logs) | `/{spaceId}/_e2g/api/` | — (undocumented) |

### Undocumented endpoints (reverse-engineered)

These were pulled from the portal JS bundle; no Swagger. They're
implemented in the CLI — only edit them if you're fixing a bug or
adding coverage.

**Inventory v1 — folder ops** (under `/{spaceId}/_inventory/api/v1/`):

| Method | Endpoint | Purpose |
|---|---|---|
| `PUT` | `folders/artifacts` | Move artifacts into a folder |
| `POST` | `folders` | Create a folder |
| `PATCH` | `folders/{folderId}` | Rename (JSON Patch array body) |
| `DELETE` | `folders/{folderId}` | Delete (body: `{"childBehavior":"moveToParent"\|"deleteRecursively"\|"abort"}`) |
| `GET` | `folders/{folderId}/ancestors` | Ancestor chain |
| `POST` | `folders/tree-items` | List folder tree |

**MBT / Builder v2 — TSU** (under `/{spaceId}/_mbt/api/v2/builder/`):

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `tsu/exports` | Body `TsuExportRequestV2 { testCaseIds, moduleIds, reusableTestStepBlockIds }` → binary blob |
| `POST` | `tsu/imports` | multipart/form-data |

The request field is spelled `reusableTestStepBlockIds` (correct
English) even though the **API path** uses the typo `reuseeable`.
Both stay misspelled — the typo is the wire format.

**MBT / Builder v2 — reusable blocks** (note path typo:
`/{spaceId}/_mbt/api/v2/builder/reuseableTestStepBlocks/`):

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `{id}` | Full block + `businessParameters` |
| `PUT` | `{id}` | Replace body (strip `version` first — CLI does) |
| `PATCH` | `{id}` | RFC 6902 JSON Patch |
| `DELETE` | `{id}` | 403 on service token; see `../SKILL.md § Critical caveats` |

**E2G — execution logs** (under `/{spaceId}/_e2g/api/`):

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `executions/{executionId}` | Execution doc — `items[]` is one `UnitV1` per test case |
| `GET` | `executions/{executionId}/units/{unitId}/attachments` | SAS-signed Azure Blob URLs |

`executionId` comes from `PlaylistRunV1.executionId`, NOT the
playlist run's `id`. Attachment record shape:

```json
{
  "name": "logs",           // logs | JUnit | TBoxResults | TestSteps | Recording
  "fileExtension": "txt",   // txt  | xml   | tas         | json       | mp4
  "contentDownloadUri": "https://e2g<region>prod001resblobs.blob.core.windows.net/.../?sv=…&sig=…",
  "appendUri": "https://…?sp=a&sig=…"
}
```

SAS TTL ≈ 30 min; the blob GET must **not** carry `Authorization` —
the SAS signature is the entire auth. CLI's `download_blob()`
strips headers; if you call the URI by hand, use `curl` with no
bearer.

## Provenance

Source: <https://github.com/bermudas/toscacloud_cli>. Ported into
sdlc-skills at `skills/tosca-automation/`. License: Apache-2.0 (this
repo); upstream was MIT and remains MIT at its origin.
