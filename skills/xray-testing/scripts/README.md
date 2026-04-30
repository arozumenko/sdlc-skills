# `xray.py` — CLI quick reference

Stdlib-only Python CLI for Xray Cloud (GraphQL) and Server / DC
(REST). **Fallback only** — when your host has an MCP server
covering Xray (`mcp__Elitea_Dev__…`, `mcp__dmtools-cli__…`,
`mcp__mcp-xray__…`), use the MCP tools instead. See
`../SKILL.md § Transport priority` for the decision order. This
script is what you run when no MCP matches the operation, the MCP
is offline, or you're debugging the transport itself.

For concepts and anti-patterns, read `../SKILL.md`. For the
underlying API shapes, `../references/*.md`. This file covers the
CLI surface only.

## Install

Requires **Python 3.9+**. Zero dependencies.

```bash
# From the project, symlink onto PATH (optional):
ln -s "$(pwd)/.github/skills/xray-testing/scripts/xray.py" ~/.local/bin/xray
# Or invoke directly:
python3 .github/skills/xray-testing/scripts/xray.py --help
```

Swap `.github/` for `.claude/` / `.cursor/` / `.windsurf/`
depending on where sdlc-skills installed.

## Configure via environment

Three ways to get credentials in. Pick one:

```bash
# (a) Interactive — writes/updates .env in cwd, mode 0600
xray config set \
    --client-id "$XRAY_ID" --client-secret "$XRAY_SECRET" \
    --jira-base-url https://<site>.atlassian.net \
    --jira-user you@example.com --jira-token <pat>

# (b) Drop a .env file — auto-loaded by xray.py at startup
cp <install-path>/skills/xray-testing/scripts/.env.example .env
$EDITOR .env

# (c) Pre-export in your shell / direnv / CI runner
export XRAY_CLIENT_ID=… XRAY_CLIENT_SECRET=…
```

**Precedence**: already-exported env vars > `.env` in cwd > nothing.
The script never overrides a value that's already in `os.environ`,
so a stray `.env` won't surprise a CI run that exports its own vars.

**Project-wide config** (e.g. `.agents/test-automation.yaml` from the
project-seeder skill) is read by the agent — not by this script. The
agent translates the YAML into env vars before invoking `xray`. The
CLI itself only knows about env vars + `.env`.

Deployment is auto-detected from the fields you set. Override with
`XRAY_DEPLOYMENT=cloud|server`.

**Cloud** (Xray Cloud):

```bash
export XRAY_CLIENT_ID="..."              # from Jira → Apps → Xray → API Keys
export XRAY_CLIENT_SECRET="..."
export JIRA_BASE_URL="https://<site>.atlassian.net"

# Region: pick `global` (default) or `eu`. This sets the Xray
# Cloud base URL automatically. Set XRAY_BASE_URL below only if
# you need a non-standard endpoint; it overrides the region.
export XRAY_REGION="eu"                  # global | us | eu
# export XRAY_BASE_URL="https://eu.xray.cloud.getxray.app"

# Needed for commands that read issueId / accountId / custom-field IDs
# (anything that touches /rest/api/3/*). Xray JWT does NOT auth Jira REST.
export JIRA_USER="<your-atlassian-email>"
export JIRA_TOKEN="<Jira API token — id.atlassian.com / Security>"
```

Xray-only commands (`config`, `auth-verify`, `statuses`) run without
the JIRA_USER / JIRA_TOKEN pair. Anything that needs to resolve a
Jira key (`test get`, `test create`, `coverage`, …) needs both.

**Server / Data Center**:

```bash
export JIRA_BASE_URL="https://<your-jira>"
export JIRA_TOKEN="<PAT>"              # preferred
# Or basic auth:
# export JIRA_USER="<username>"
# export JIRA_TOKEN="<api-token>"
```

Shared:

```bash
# JWT cache location (cloud only). Default: ~/.cache/xray
# export XRAY_CACHE_DIR=".xray-cache"
```

### Secrets hygiene — gitignore before first write

Mode 0600 on `.env` (set by `xray config set`) only protects against
other unix users. **It does NOT stop `git add`** — one stray commit
and the file is published. Before running `xray config set` for the
first time, make sure `.env` and `token.json` are gitignored:

```bash
# idempotent — appends only if missing
grep -qxF '.env' .gitignore 2>/dev/null || cat >> .gitignore <<'EOF'

# Local creds — never commit
.env
.xray-cache/
EOF

# token.json lives in XRAY_CACHE_DIR (default ~/.cache/xray, outside
# the repo); only relevant if you set XRAY_CACHE_DIR=.xray-cache
```

This matters more if your `.env` already has tokens for other tools
(`DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `GH_TOKEN`, etc.) — `xray
config set` preserves them all verbatim, but anything in the file
travels with `git add`. Audit before staging.

Sanity check:

```bash
xray config              # show effective config (resolved env-vars + .env)
xray auth-verify         # one-shot reachability check
```

## Command surface

Every write (`create`, `add`, `status`, `evidence`, `import`)
re-fetches the target afterwards and compares counts / status.
Exit **3** means the write landed but validation failed — check
the target manually.

### Test

```bash
# Read — by Jira key (Cloud will resolve key → numeric issueId via Jira REST first)
xray test get PROJ-T42
xray test get PROJ-T42 --raw          # structured body (ADF / REST JSON)

# Read — when you already have the issueId (e.g. via Atlassian MCP):
# skips the Jira-REST lookup entirely. Lets the CLI work with only XRAY_*
# creds set; no JIRA_BASE_URL / JIRA_USER / JIRA_TOKEN required.
xray test get --issue-id 10042
xray test get PROJ-T42 --issue-id 10042   # both forms; --issue-id wins

# Create (Manual)
#   --steps file: JSON array of {action,data,result}
#   or plain text: one step per line "action|data|result"
xray test create --project PROJ --summary "login plus-sign email" \
  --type Manual --steps steps.txt --assignee alex@example.com

# Create AND link to the story it covers in one atomic call.
# Uses Xray's coverage link (addTestsToRequirement), not the plain
# Jira issuelinks field — see SKILL.md § "Link Tests to stories".
# The script re-fetches the story's coverage and exits 3 if the
# Test isn't in the list.
xray test create --project PROJ --summary "login plus-sign email" \
  --type Manual --steps steps.txt --link-to PROJ-123

# Create (Cucumber / Generic)
xray test create --project PROJ --summary "plus-sign scenario" \
  --type Cucumber --gherkin scenario.feature
xray test create --project PROJ --summary "perf budget for /login" \
  --type Generic --definition definition.md

# Mutate
xray test add-step PROJ-T42 --action "Click Submit" \
  --data "" --result "Dashboard renders within 2s"
xray test link-requirement PROJ-T42 PROJ-123
```

### Test Set / Test Plan

```bash
xray testset add PROJ-TS10 PROJ-T42 PROJ-T43
xray testplan add PROJ-P7 PROJ-T42 PROJ-T43
```

### Test Execution + Test Run

```bash
# Create an Execution (optionally linked to a Plan)
xray exec create --project PROJ \
  --summary "Smoke 2026-04-22 / staging" \
  --tests PROJ-T42,PROJ-T43 \
  --plan PROJ-P7

# List runs inside an Execution (run-id, status, test key)
xray exec list-runs PROJ-TE7

# Update a run
xray run status <runId> --set PASSED --comment "Verified 04-22 staging"
xray run evidence <runId> --file path/to/screenshot.png
```

### Results import

```bash
# JUnit XML (multipart)
xray import junit target/junit.xml \
  --project PROJ --plan PROJ-P7 --env staging

# Append to an existing Execution
xray import junit target/junit.xml --exec PROJ-TE7

# Cucumber JSON
xray import cucumber cucumber-results.json --project PROJ --plan PROJ-P7

# Canonical Xray JSON (project/plan/env come from the body)
xray import xray-json results.json
```

All import commands check the resulting Test Execution's run
count. **A count of zero is the silent-fail signature of broken
mapping** (runner `classname`/`name` not matching any Jira Test
key) — the script exits 3 in that case. Fix the mapping and
re-import.

### Coverage + statuses

```bash
xray coverage PROJ-123      # tests covering a requirement
xray statuses               # project-allowed Test Run status list
```

## JSON output for scripting

Pass `--json` (global flag, BEFORE the subcommand) to emit pure
JSON:

```bash
xray --json test get PROJ-T42 | jq '.steps | length'
xray --json exec list-runs PROJ-TE7 | jq '.[] | .id'
```

## Mapping conventions for results import

The single biggest import-failure cause is a mismatch between
runner output and Jira Test keys. Document the convention you
choose in `.agents/testing.md`. Common patterns:

| Convention | JUnit shape | Cucumber shape |
|---|---|---|
| Jira key in classname | `<testcase classname="PROJ-T42" name="..."/>` | n/a |
| Tag-based (Cucumber) | n/a | `@TEST_PROJ-T42` on the scenario |
| Jira key in labels | set `automation:<classname>` label on each Test | — |

The script doesn't enforce a convention — it submits the report
as-is and trusts Xray's project configuration. After the first
import, spot-check that `xray exec list-runs <key>` shows the
expected number of runs before automating further.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success; the write was re-fetched and verified against expected counts / status. |
| `2` | Anything that prevented the intended call from completing successfully. Catch-all (see sub-categories below) — the accompanying `xray: <message>` on stderr names the specific cause. |
| `3` | Write landed at the API (2xx) but post-write verification failed — mismatched step / test / run count, or the linked entity didn't appear on both sides. |

`2` is overloaded by design (single exit code keeps shell scripts
simple) — the stderr message disambiguates. Common sub-categories
and the phrasing they use:

| Sub-category | Example stderr line |
|---|---|
| CLI arg / argparse error | `usage: xray …` followed by argparse's own messages |
| Missing env / config | `xray: JIRA_BASE_URL is required on cloud.` |
| Auth failure | `xray: /authenticate returned 401` |
| Network / HTTP error | `xray: HTTP 503 on POST /rest/raven/2.0/api/testexec` |
| Xray GraphQL error | `xray: GraphQL error: field 'testIssueIds' is required` |
| Unresolvable identity | `xray: no user found for query 'alice'` |
| Malformed response | `xray: unexpected /rest/api/2/field response` |

If you're scripting around the CLI and need to distinguish these
programmatically, grep the stderr line (it's always prefixed with
`xray:`). A v0.2 could split `2` into finer-grained codes — but the
current contract is `0` = verified ok, `2` = broke before verify,
`3` = API accepted but verify caught divergence.

## Extending this script

The CLI is a living tool, not frozen source. Agents using it are
**explicitly allowed to fix or extend `xray.py`** when they hit one
of these during real use — modify the script + this README as part
of the same task, don't route around:

- A real bug (auth flow edge case, wrong default, pagination error,
  GraphQL limit mismatch, off-by-one, mis-typed env var)
- A missing capability needed for a legitimate workflow (new import
  format, unused entity operation, richer error output, extra
  subcommand that parallels a new MCP tool)
- Error messages too terse to diagnose from — expand them
- A regional endpoint or tenant variation the script doesn't handle

**What to preserve while editing:**

- Existing subcommand names + env var names — don't break agents or
  humans that already scripted against them
- The `0 / 2 / 3` exit-code contract (success / usage-or-HTTP /
  write-verification-failed)
- The re-fetch-and-verify discipline after every write — if you add
  a new write subcommand, add its matching verification
- Stdlib-only (`urllib.request`, `base64`, `json`, …). No new
  dependencies
- Python 3.9+ compatibility

**After editing:**

- Syntax-check with
  `python3 -c "import ast; ast.parse(open('xray.py').read())"`
  before you claim you're done.
- Run `xray config` + `xray auth-verify` against a reachable Xray
  instance if you have credentials; otherwise state in your reply
  that the change is syntax-verified only.
- Update this README to match (command surface, env vars, exit codes).
- Commit with a message that names the specific case you hit ("Fix
  exec list-runs limit — Xray caps at 100" is good; "update script"
  is not).

## Graceful degradation

If the Xray API is unreachable (rejected credentials, regional
mismatch, outage) you can still do meaningful work via Jira REST
alone — list / filter Tests by type, read issue shells, file
defects. See `../references/jira-rest-fallback.md` for the full
capability matrix in that degraded mode.
