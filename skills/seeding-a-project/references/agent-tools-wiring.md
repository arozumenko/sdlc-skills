# Agent Tools Wiring

Inject a `tools:` whitelist into each installed agent's frontmatter so
the host (especially Copilot CLI) actually grants them the tools they
need. Scope is per-project and fully autonomous — scout derives every
decision from evidence already on disk or in its own session, with no
operator prompts and no per-agent capability manifest.

Runs as **Step 6.8** of `seeding-a-project`, between team-comms (6.5) and
role customization (7), in the **same scout pass** as the other seed
work. Idempotent — if an agent already declares `tools:`, scout leaves
it alone unless `--update-tools` is passed.

## When this step actually writes anything

The step is host-aware. Tool injection only makes sense when the host
*restricts* tools to the declared list. If the host's default is
"inherit everything," the declaration is noise at best and a
permissions foot-gun at worst.

| Host | Frontmatter default | Action |
|---|---|---|
| **GitHub Copilot CLI** | No `tools:` = agent gets `['agent']` only (near-useless) | **Write `tools:`** — this is the whole point of the step |
| **Claude Code** | No `tools:` = inherit all tools (full access) | **Skip** — permissive default is correct for sdlc-skills agents; tool restrictions happen via the permission model, not per-agent frontmatter |
| **Cursor** | Host-dependent; check the target version | Write only when Cursor's default is restrictive for the version in use |
| **Windsurf** | Host-dependent | Same as Cursor |

Scout detects the host from `.agents/team-comms.md` (authoritative) or
by inspecting install directories (`.github/agents/` vs.
`.claude/agents/` etc.) and acts accordingly.

## Inputs scout reads (all evidence-based, no operator prompts)

Ordered by declarative strength — earlier inputs override later ones
when they conflict.

1. **Each skill's `setup.yaml`** — **authoritative** for what MCP a
   skill needs. Example:

   ```yaml
   # skills/playwright-testing/setup.yaml
   dependencies:
     mcp:
       - name: playwright
         command: npx
         args: ["@playwright/mcp@latest"]
   ```

   This says: any agent with `playwright-testing` in its `skills:`
   needs the Playwright MCP. The `name:` is the **logical role name**
   scout matches against live MCP servers by name heuristic (see
   input 3). Skills without an MCP `dependencies` block don't
   contribute MCP tools — they only contribute base host tools like
   `read` / `edit` / `execute` (see heuristics below).

2. **`.agents/test-automation.yaml`** (if present) — authoritative
   for the TMS mapping scout can't derive from a skill file (TMS is
   project-specific, not skill-specific):
   - `tms.mcp_server` + `tms.mcp_toolset` → TMS tool prefix
   - `tms.jira_toolset` → Jira tool prefix
   - When this file exists, its bindings are final. No name-heuristic
     overrides it.

3. **Live MCP servers in the host config** — scout's own session
   already has these loaded. Enumerate by:
   - Reading what's registered: `~/.claude.json`, `.mcp.json` in the
     project, Copilot settings at the OS path for this system
   - Tools already visible in scout's own tool list (authoritative —
     if scout can see the tool, the host has it)

   Match each live server to the logical roles from inputs 1-2 by name:
   - Logical role `playwright` matches a live server whose name
     contains `playwright` (case-insensitive): `playwright`,
     `playwright_banca`, `playwright-remote`, etc.
   - Logical role `browser` matches the same family
   - TMS `zephyr-scale` adapter matches a server with
     `ZephyrConnector` / `zephyr` in its toolset names, or — if
     `.agents/test-automation.yaml` names `mcp_server` explicitly —
     that exact server
   - Similar patterns for `testrail`, `xray`, `azure-test-plans`

   When exactly one live server matches a role, use it. When multiple
   match (two Playwright MCPs), prefer in this order:
   1. The one whose name **exactly** matches `mcp_server:` in
      `.agents/test-automation.yaml`
   2. The one whose name includes the project name (e.g.
      `playwright_<repo-name>`)
   3. The most specific / namespaced one (`playwright_banca` over
      `playwright`)
   4. Include all matches as a union — liberal for read-only tools
      (TMS `get_*` / `list_*`), conservative for write tools

4. **`.agents/testing.md`** — secondary signal when a framework isn't
   explicitly declared via a skill. If the project uses Cypress (no
   Cypress skill in the monorepo yet), scout still adds the Cypress
   MCP prefix to agents whose skills hint at UI testing.

5. **Each agent's own frontmatter** — determines which roles apply
   to that specific agent:
   - `skills: [...]` — primary signal: for every skill listed, scout
     reads its `setup.yaml` and aggregates the MCP roles it needs
   - `group:` — coarse classification (qa / dev / pm / core) — shapes
     the base-set additions (execute / edit / write)
   - `description:` — disambiguation keywords: "executes cases" →
     read-intent TMS tools; "implements tests" / "writes code" →
     write-intent TMS tools + edit

## Scout self-service — probe MCP, write per-agent `tools:`

Scout's role at Step 6.8 is **read MCP config, write agent
frontmatter** — nothing else. The MCP config files belong to the
operator and their host; scout never edits them. The agent
frontmatter files belong to the install surface and scout adjusts
them per evidence.

### Two things scout does

1. **Probe what MCP servers are available.** Read-only inventory
   from sources in priority order:
   - Scout's own loaded tool list (authoritative — if a server's
     tools are visible in-session, the host has the server
     enabled).
   - Host MCP config files on disk (**read-only**, for discovery):
     - Claude Code: `~/.claude.json` + project-level `.mcp.json`
     - Copilot CLI: `~/.config/copilot/mcp.json` (or OS-specific
       equivalent) and `./.copilot/mcp-config.json` when the
       project uses `--additional-mcp-config`
     - Cursor / Windsurf: their respective settings files
   - Cross-reference: the session's visible tools must match the
     config's listed servers. If config says `Elitea_Dev` is
     enabled but scout can't see its tools in-session, the server
     is misconfigured (bad URL, dead token, crashed process) —
     flag it in the Step 6.8 report, don't pretend it's fine.
   - **No phantom tools.** Only tools from servers actually
     present in the config files (and actually returning tool
     lists at runtime) land in any agent's `tools:`. Never emit
     references to servers the project doesn't have configured.

2. **Write `tools:` frontmatter into each installed agent file,
   in the format that host expects.** Each host has a different
   convention; scout must emit the one that matches the target.

   ---

   **Copilot CLI** (`.github/agents/<name>.agent.md`) — inline
   YAML array, single-quoted strings, split across lines for
   readability. Two categories of tool names:

   - **Built-in tools** (Copilot's own): `vscode`, `execute`,
     `read`, `edit`, `search`, `web`, `agent`, `todo`. Not
     `bash` (that's Claude's built-in name), not `write` (covered
     by `edit`).
   - **MCP tools**: `<server_lowercase>/<tool_name>` — forward
     slash separator, server name **always lowercased regardless
     of its casing in `.copilot/mcp-config.json`**. Wildcard form:
     `<server_lowercase>/*` to match every tool from that server.

   Example (matches the format Copilot CLI actually accepts):

   ```yaml
   tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web',
           'agent', 'todo',
           'playwright_banca/*',
           'elitea_dev/JiraIntegration_search_using_jql',
           'elitea_dev/JiraIntegration_add_comments',
           'elitea_dev/ZephyrBanka_get_test_case',
           'elitea_dev/ZephyrBanka_create_test_execution']
   ```

   Note the lowercasing: config has `Elitea_Dev`, but the tools
   list references it as `elitea_dev`. That's intentional —
   Copilot resolves the lowercased form back to the config entry.

   No `tools:` = Copilot grants `['agent']` only (near-useless).
   This is why scout writes the `tools:` line at all.

   GitHub operations are **not** an MCP server by default on
   Copilot CLI — access GitHub via `gh` CLI through the
   `execute` built-in. Don't emit `github-mcp-server-*` or any
   such prefix unless the project actually wires a GitHub MCP.

   ---

   **Claude Code** (`.claude/agents/<name>/AGENT.md`) — permissive
   default. Scout **skips this step on Claude Code** (see the
   host-awareness table at the top of this reference): writing
   `tools:` there would *restrict* an agent artificially. Tool
   restrictions on Claude Code happen via the permission model
   (`allow` / `deny` / `ask` lists) and `--allowedTools` flag,
   not per-agent frontmatter. If a project genuinely wants to
   restrict a Claude agent — which is rare for sdlc-skills — the
   convention is:
   - Built-ins: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`,
     etc. (mixed case).
   - MCP tools: `mcp__<server>__<tool>` with **double
     underscores** as the separator, server casing preserved
     from config. Wildcards: `mcp__<server>__*`.
   - Different from Copilot in **every** dimension: built-in
     names, separator, case handling, wildcard form.

   ---

   **Cursor / Windsurf** — host-dependent. Recent versions are
   permissive like Claude Code (skip). Older restrictive versions
   take a YAML list; detect by inspecting an already-installed
   example agent and matching its shape. When in doubt, skip
   writing `tools:` — worst case is permissive, which matches
   the sdlc-skills intent.

   ---

   When scout does write `tools:`, it reports the tool-count
   delta per agent in the Step 6.8 summary so the operator can
   audit what changed.

### What scout does NOT do at Step 6.8

- **Never edit MCP config files.** `.mcp.json`, `mcp-config.json`,
  `~/.claude.json`, `~/.config/copilot/mcp.json`, Cursor /
  Windsurf settings — all read-only for scout. If scout detects
  a gap (the project needs a server that isn't enabled), it
  names the gap in the Step 6.8 report and leaves the fix to
  the operator. Editing MCP config is out of scope: those files
  can carry personal settings across projects (user-level) or
  ship with the repo (project-level), and scout has no authority
  over either.
- **Never prompt the operator.** Step 6.8 runs end-to-end from
  evidence; any ambiguity resolves to the liberal default (union
  + wildcard, see § When scout pauses below).
- **Never modify env / shell / `.env`.** Scout reads env vars
  but doesn't write them. If a required env var is unset, that
  goes in the report as "operator action required" — the
  operator sets it and re-runs.
- **Never touch agent source files in this repo.** Only the
  installed copies under `.github/agents/`, `.claude/agents/`,
  `.cursor/agents/`, `.windsurf/agents/` are rewritten. Source
  stays canonical so `npx init --update` can always overwrite
  cleanly.

### When this triggers

Usually during Step 3 (enumerate live MCP) or Step 4 (match
roles). If a role from Step 2's logical-role registry has no
match in the live enumeration, scout doesn't immediately mark
it "unmatched and drop it" — it first checks whether the config
file *declares* that server (just offline or misconfigured)
and surfaces the gap in the report so the operator can fix
their MCP config.

## When scout pauses (rare)

**Scout never prompts during seed.** The only case scout cannot
resolve deterministically from evidence: two live MCP servers match
a role, and `.agents/test-automation.yaml` doesn't name one, and
neither name is project-specific. Example: three generic
`playwright` servers all differently named but none scoped to this
project.

Default: include all of them as a union with wildcard form
(`<server>/*`). This is liberal but safe — redundant tools don't break
anything, and Axel/Sage will discover which one actually works
against this app. The operator can narrow it later.

## Decision heuristics

Scout uses these as defaults. If evidence contradicts, evidence wins.

### Base set (every agent, all hosts that need explicit tools)

```
Copilot: ['vscode', 'read', 'search', 'web', 'agent', 'todo']
Claude:  not written — inherit default
```

Reading, searching, and agent delegation are universal. `vscode`
covers the IDE surface scout sees under Copilot.

### + `execute` (shell / terminal)

Added when the agent's skills include any of:
`git-workflow`, `completing-a-task`, `bugfix-workflow`, `tdd`,
`implement-feature`, `systematic-debugging`, or
`test-automation-workflow`.

Rationale: these workflows run commands (tests, git, gh).

### + `edit` (file modification)

Added when the agent's skills include any of:
`implement-feature`, `bugfix-workflow`, `code-review`, `tdd`,
`test-automation-workflow`, `plan-feature`, `seeding-a-project`.

The skill `seeding-a-project` itself implies doc-writing; `code-review`
implies suggesting edits.

### + browser / Playwright MCP

Added when the agent's skills include `playwright-testing` or
`browser-verify`. Scout picks the Playwright MCP prefix by asking the
host (or reading MCP config) — wildcard form `<server>/*`.

### + TMS MCP tools

Added when **both**:
- `.agents/test-automation.yaml` declares `tms.transport: mcp` with an
  `mcp_server` + `mcp_toolset`, **and**
- The agent's skills include `test-automation-workflow` OR
  `issue-tracking` OR the description mentions TMS terms (test case,
  execution, Zephyr, TestRail, Xray)

Scope the TMS tool set by intent:

- **Read-only / exploration** sessions (qa-engineer running
  `test-case-analysis`, project-manager, qa-engineer as reviewer) →
  `get_*`, `list_*`, `search_*`
- **Write / back-write** sessions (test-automation-engineer) → add
  `create_*`, `update_*`, `sync_*`
- **Jira integration** → add `jira_toolset` tools when the agent
  touches stories (PM, qa-engineer in analysis). Prefer
  `search_using_jql` +
  `execute_generic_rq` / `getIssue` rather than blanket `*`.

The intent is detected from `group:` + skill list + description. If
ambiguous, default to read-only (safer).

### + Orchestrator inheritance (PM and tech-lead)

Coordinator-tier agents (`project-manager` and `tech-lead`, typically
`group: core`) don't usually declare TMS or Jira skills themselves,
but they **route and review** work that other agents do. If they
can't read the team's tickets and stories, they can't preview what
they're routing or catch issues during review. Treat them as
**read-only inheritors**: whenever the team's worker agents get a
given MCP role, the coordinators also get the read slice.

Concretely:

- **`project-manager`** — whenever any other installed agent gets
  TMS MCP tools, PM is given the read slice (`get_*` / `list_*` /
  `search_*`) regardless of her own skill list. Same for Jira
  (`search_using_jql`, `getIssue` / equivalent). Rationale: PM needs
  to open `SCRUM-T101` to see what she's routing to Mira, and open
  the linked `SCRUM-42` story to catch context mismatches.
- **`tech-lead`** — always gets Jira read (he decomposes stories
  into tasks). Gets TMS read only when the team is doing
  test-automation work (detected by any other agent having
  `test-case-analysis`, `test-automation-workflow`, or
  `playwright-testing` in its skills). Rationale: Rio reviews PRs
  and needs to trace a test back to its originating case.

Inheritance is **read-only**. Write/create/update/delete flavors of
the same toolset stay scoped to the worker agents that own the
workflow. Coordinators never back-write executions or edit tickets.

Scout implements this after the primary per-agent pass: once every
worker's `tools:` line is computed, scout scans the roster for TMS
/ Jira role assignments and fills in the coordinator inheritance
slice. If the project has no TMS / Jira MCP configured at all, this
step is a no-op.

### + host-native scaffolding tools

- Copilot CLI: always add `'agent'` (delegation) and `'todo'` (task
  tracking). These are cheap and universally useful.

## Sketch of the per-agent result (Copilot CLI, Elitea MCP, Playwright)

Illustrative only — scout derives each list from the rules above:

```yaml
# qa-engineer (Sage) — analysis pass via test-case-analysis skill:
# reads TMS, drives browser, emits AFS. No code writing.
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo',
        'playwright_<server>/*',
        'elitea_dev/ZephyrConnector_get_test_case',
        'elitea_dev/ZephyrConnector_get_test_case_test_steps',
        'elitea_dev/ZephyrConnector_get_test_case_links',
        'elitea_dev/ZephyrConnector_get_issue_link_test_cases',
        'elitea_dev/JiraIntegration_search_using_jql',
        'elitea_dev/JiraIntegration_execute_generic_rq']

# test-automation-engineer (Axel) — codes, runs tests, back-writes TMS
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo',
        'playwright_<server>/*',
        'elitea_dev/ZephyrConnector_get_test_case',
        'elitea_dev/ZephyrConnector_get_test_case_test_steps',
        'elitea_dev/ZephyrConnector_create_test_execution',
        'elitea_dev/ZephyrConnector_update_test_execution',
        'elitea_dev/ZephyrConnector_update_test_execution_test_steps',
        'elitea_dev/ZephyrConnector_sync_test_execution_script']

# qa-engineer (Sage) — verifies tests, reads stories
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo',
        'playwright_<server>/*',
        'elitea_dev/JiraIntegration_search_using_jql']

# project-manager (Max) — routes, reviews, delegates
# Read-only TMS + Jira inherited from the worker roster (see § Orchestrator
# inheritance): PM needs to preview cases she's routing and story context.
tools: ['vscode', 'read', 'search', 'agent', 'todo',
        'elitea_dev/ZephyrConnector_get_test_case',
        'elitea_dev/ZephyrConnector_get_test_case_test_steps',
        'elitea_dev/ZephyrConnector_get_test_case_links',
        'elitea_dev/ZephyrConnector_get_issue_link_test_cases',
        'elitea_dev/JiraIntegration_search_using_jql',
        'elitea_dev/JiraIntegration_execute_generic_rq']

# tech-lead (Rio) — decomposes, reviews code
# Jira read always. TMS read inherited when the team does test-automation
# work (see § Orchestrator inheritance).
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo',
        'elitea_dev/JiraIntegration_search_using_jql',
        'elitea_dev/ZephyrConnector_get_test_case',
        'elitea_dev/ZephyrConnector_get_test_case_links']

# scout (Kit) — maps the repo, no MCP needed
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']

# js-dev / python-dev / ios-dev — code, run tests, git
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
```

## Procedure (scout executes, autonomously)

1. **Detect host.** Read `.agents/team-comms.md` (authoritative);
   fall back to install-directory presence (`.github/agents/*.agent.md`
   vs. `.claude/agents/<name>/AGENT.md` vs. `.cursor/` vs.
   `.windsurf/`). If the host's default tool-permission model is
   permissive (Claude Code), **skip the step entirely** and log it —
   writing `tools:` there would *restrict* agents artificially.

2. **Build the logical-role registry.** For every skill in
   `skills/<name>/`, read `setup.yaml`. If it declares
   `dependencies.mcp[].name`, add the role:
   ```
   role "playwright"   ← needed by any agent with skill playwright-testing
   role "zephyr-scale" ← needed when test-automation.yaml adapter matches
   role "jira"         ← needed when test-automation.yaml jira_toolset present
   ```
   Most skills contribute nothing here — only the ones with explicit
   MCP dependencies.

3. **Enumerate live MCP.** Parse the host's MCP config on disk
   (`~/.claude.json` / `.mcp.json` / Copilot's MCP settings file for
   the current OS, plus `./.copilot/mcp-config.json` if the project
   uses `--additional-mcp-config`) AND check scout's own loaded tool
   list. Capture server names, toolset names, and individual tool
   names. Cross-check: anything the config says is enabled should
   also be visible to scout; mismatches indicate a dead server.

4. **Self-service gap-fill** (see § Scout self-service). For each
   logical role from step 2 that didn't find a match in step 3:
   - If `.agents/test-automation.yaml` names a specific `mcp_server`
     and that server isn't in the host config, offer to add it
     (project-level config preferred; user-level config only with
     explicit go-ahead).
   - If a `mcp-config.example.json` is present, compare to the real
     config, offer to copy over any missing servers.
   - Any edit triggers a **reload request**: scout stops, reports
     the edit, and asks the operator to restart the host and re-run
     this step. Scout does not retry on its own — the host has to
     reload to pick up new MCP servers.
   - If nothing is fixable (no signal about what the missing server
     should be), mark the role unmatched and continue.

5. **Match roles to live servers** by the preference order in "Inputs
   scout reads" § 3. Produce a map:
   ```
   role "playwright"   → live server "playwright_banca"
   role "zephyr-scale" → live server "Elitea_Dev" / toolset "ZephyrConnector"
   role "jira"         → live server "Elitea_Dev" / toolset "JiraIntegration"
   ```
   If a role has no match *and* step 4 couldn't fix it, drop it
   silently. If multiple, use the union rule (see § 3). No prompts.

6. **For each installed worker agent** (i.e., anything that isn't an
   orchestrator):
   - Parse its frontmatter
   - If it already declares `tools:`, skip unless `--update-tools`
   - Start with the host's base set (see heuristics below)
   - For every skill in the agent's `skills:`, expand to any MCP
     roles the skill declares via its setup.yaml; look up the live
     server for that role from step 4; add the appropriate tool
     prefixes
   - Apply intent-based TMS scoping (read vs. write) from
     `description:` / `group:`
   - Write the `tools:` line immediately before the closing `---` of
     the frontmatter block

7. **Orchestrator pass (PM + tech-lead).** After step 6, scan the
   worker roster for TMS / Jira role assignments. Apply orchestrator
   inheritance (see § Orchestrator inheritance):
   - `project-manager` gets the read slice of every TMS / Jira
     toolset any worker has.
   - `tech-lead` gets Jira read always; TMS read only when any
     worker has a test-automation skill (`test-case-analysis`,
     `test-automation-workflow`, `playwright-testing`).
   - Read slice = `get_*` / `list_*` / `search_*` variants. Never
     include `create_*` / `update_*` / `sync_*` — orchestrators
     don't back-write.

8. **Validate.** Re-read each modified agent, confirm `tools:` is
   valid YAML and every MCP tool name actually appears in the live
   enumeration from step 3. Drop any phantom entries.

9. **Report.** In the scout summary, log:
   - Host detected + permissiveness mode (wrote / skipped)
   - MCP servers enumerated (names only)
   - Any MCP config edits scout made in step 4 (with before/after
     paths) and any reload request issued
   - Logical-role → live-server matches
   - Per-agent tool count (was → now), with a note on which
     coordinators received inherited read tools
   - Agents skipped because they already had `tools:`
   - Any roles with no live-server match (so the operator knows what
     the agents can't do)

## What scout does NOT do

- **No capability manifest.** There is intentionally no
  `agent-capabilities.yaml` — evidence comes from each skill's own
  `setup.yaml`, the host's live MCP config, and the agent's own
  frontmatter. A manifest would drift.
- **No tool invention.** If an MCP tool isn't in the live enumeration,
  it doesn't land in the `tools:` line.
- **No operator prompts during seed.** Step 6.8 runs end-to-end
  from evidence; any ambiguity resolves to the liberal default
  (union + wildcard).
- **No MCP config edits.** `.mcp.json`, `mcp-config.json`,
  `~/.claude.json`, `~/.config/copilot/mcp.json`, Cursor / Windsurf
  settings — all read-only for scout. Gaps surface in the Step 6.8
  report; the operator fixes them.
- **No destructive rewrite.** Existing `tools:` declarations are
  preserved unless the operator asks for `--update-tools`.
- **No cross-host leakage.** Copilot-short-names don't land in a
  Claude Code agent frontmatter and vice versa.
- **No agent source-file mutation.** Scout writes only into the
  installed copies (`.github/agents/`, `.claude/agents/`, etc.),
  never the canonical source under `agents/` in this repo.

## Failure modes + what scout does about them

| Failure | Action |
|---|---|
| Host cannot be detected | Skip the step, log a warning, tell the operator to set it manually |
| MCP config files missing and scout's own tool list has no MCPs | Continue with base-set only; log "no MCP servers visible — skipped TMS / browser wiring" |
| `.agents/test-automation.yaml` specifies an `mcp_server` that isn't running / visible | Check the host MCP config files (read-only). If config *declares* the server (just offline or misconfigured), flag "MCP server declared but not reachable — check server logs" in the Step 6.8 report and include the server's tool names anyway (yaml is authoritative about intent). If config doesn't declare it at all, flag "MCP server required by `.agents/test-automation.yaml` not configured — add it to your host config and re-run scout". |
| Config declares a server that scout can't see in its own tool list | Flag as misconfigured (bad URL, dead token, crashed process) in the Step 6.8 report — don't include its tools in any agent's `tools:` line. Suggest operator check the server's logs. |
| Two live servers match a role and none of them match the project name | Union them with wildcard (`<server>/*`) — liberal on read; let the operator narrow later |
| Agent has malformed frontmatter | Skip that agent, log the error, continue with the rest |
| Role declared in a skill's `setup.yaml` has no matching live server *and* no config signal | Skip the role silently; log "role 'playwright' unmatched — no live MCP server available" so the operator knows why the agent didn't get those tools |
