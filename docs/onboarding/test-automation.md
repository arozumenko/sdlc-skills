# Test Automation — Onboarding

sdlc-skills brings test-automation capabilities to any repo. This
dispatcher takes you from "I want to use this toolkit" to "the
pipeline is running." Details live in the skills themselves —
follow the links as you go.

**Pick your path:**

- [Existing automation project](#existing-automation-project) — you
  have a framework + app + (optionally) a TMS + MCP tools wired.
- [Greenfield (new project)](#greenfield) — no test framework in the
  repo yet.

## The pipeline, one picture

The pipeline is a **compiler from test cases to test code**. Input:
ready-made cases — from the TMS or from `tasks/<suite>/TC-*.md` (the
manual-qa factory's authored-case format) — plus execution evidence when
it exists. Output: merged automated tests + a TMS back-write + receipts.
The only repo artifacts it produces are **test code** and the **surface
cache** (`.agents/automation/surface/<feature>.md`).

```
User → test-automation-lead
  1. Intake              — one TMS/tasks sweep, resolve the batch, snapshot
                           case bodies, clustering + sizing (un-automatable /
                           already-covered verdicts are made HERE, before
                           any build)
  2. Route per unit      — execution-provider policy:
                           manual-qa-verified | needs-execution | combined
  3. Build loop per unit — engineer (green once, coverage declaration in
                           the spec) → fresh engineer-typed review (static)
                           → merge back into the batch trunk
  4. Hardening gate      — once per batch: N× consecutive green on the
                           batch trunk + one blast-radius regression run
  5. Report + close      — one report, then merge + one TMS/tracker sweep
```

A single case is just a batch of one — same pipeline, nothing skipped.

Role defaults (three agents; personas are assigned per `.agents/team-comms.md`):

| Slot | Agent | Skill |
|---|---|---|
| Orchestrator | `test-automation-lead` (Tal) | `test-automation-workflow` (the orchestrator slot contract) |
| Implementer | `test-automation-engineer` (Axel) | `test-automation-implementation` (six-phase loop; derives what to build straight from the case) |
| Reviewer | **fresh** `test-automation-engineer`-typed dispatch | `code-review` + the reviewer contract — static case↔code walk, no execution; independence comes from clean context + the contract, not a different agent file |
| Hardening gate | fresh agent, dispatched by the lead (never the implementer that built, never the lead itself — a lead-run gate was the measured bottleneck) | once per batch, on the batch trunk — the merge signal; mechanics via `scripts/gate/gate-case.mjs` |

`scout` (Kit) is the fourth file on disk but not a pipeline slot — it
seeds the project once (Step 2 below) and owns the retrospective.

> **`qa-engineer` is removed in v2** — there is no analyst slot anymore.
> Screening moved into the intake clustering + sizing pass, spec derivation
> into the engineer's build dispatch, review into the fresh engineer-typed
> reviewer, live case execution to manual-qa (or the engineer's combined
> mode standalone). Migrating an existing install: after `init --update`,
> re-run scout — its migration pass sweeps `.agents/memory/qa-engineer/`
> through `knowledge-curation` (promote what passes the admission tests,
> then the dir can go) and leaves legacy `test-specs/` files alone — the
> new pipeline ignores them.

`test-automation-lead` is a **top-level orchestrator launched directly
by the user** — not a subagent of `project-manager`. The role owns slot
routing, coverage gating, automation merge, and test-framework
architecture (greenfield bootstrap, framework-scale work, mid-flow
escalations). Tech-lead is no longer in the test-automation path.
`project-manager` remains the orchestrator for feature-development work;
on hybrid projects, PM and `test-automation-lead` coexist as peers, and
PM points TA traffic at `test-automation-lead` via a user-readable
prompt (not a subagent dispatch). Full routing rules:
[`agents/test-automation-lead/AGENT.md`](../../factories/test-automation/agents/test-automation-lead/AGENT.md).

## Co-install with manual-qa — first-class, not an afterthought

Division of labor: **manual-qa writes cases and executes them live; TA
automates them.** Running TA's *own* code (the hardening gate, the
blast-radius regression) stays in TA — that is proving code, not
executing cases.

The ideal setup is both factories in one repo — two sequential installer runs
(factories are additive; these two share no agent or skill id, so order does
not matter):

```bash
npx github:arozumenko/sdlc-skills init --factory manual-qa --target claude --yes
npx github:arozumenko/sdlc-skills init --factory test-automation --target claude --yes
```

Then onboard each front once — `app-profiler` for manual-qa, `scout` for TA
(it detects the co-install and records the provider policy). Adding
manual-qa to an existing TA install later also works: install it, then
re-run scout (`init --update` + re-seed) so `§ Execution provider` flips
from `self` to `manual-qa`.

| Area | Owner | TA access |
|---|---|---|
| `tasks/` (cases) · `reports/` (run records) · `.agents/manual-qa/` | manual-qa | **read-only** — warm start for locators, app map, fragile areas; reference, never copy |
| test code · `.agents/automation/surface/` | test-automation | owns |
| `.agents/knowledge/` | shared | **two-way**, via the `knowledge-curation` skill — the only cross-factory write channel |

Which routes a batch uses degrades gracefully with what's installed —
scout detects the co-install at seeding and records the policy in
`.agents/testing.md § Execution provider`:

| Install | Provider | Routes in play |
|---|---|---|
| standalone | `self` | `combined` for everything — the first green run of the automated test **is** the case's first execution; live probing is targeted investigation, not a walkthrough |
| co-install | `manual-qa` | `manual-qa-verified` — PASS run record + authored case exist → build from that evidence, **no re-execution**, cite the run id; otherwise `needs-execution` — the lead dispatches manual-qa's `test-runner` per case (PASS → build; FAIL → defect filed, case not automated until fixed; dispatch impossible → the unit *stays* `needs-execution` and the report says run the manual-qa suite first — **never** a silent fallback to self-execution) |

---

## Launching the agents — run them as your *main* agent

`scout` and `test-automation-lead` are **top-level agents you launch directly
from the terminal** — you talk to them as the primary driver of the session, not
as subagents picked from a menu. In **Claude Code**, launch with the `--agent`
flag (the value is the agent's `name:` / install directory):

```bash
claude --agent scout                 # Phase 1 — seed the repo (once)
claude --agent test-automation-lead  # Phase 2+ — drive the automation pipeline
```

Inside that session you just talk to the agent ("onboard this repo", "automate
TC-1234") — it stays the orchestrator for the whole session.

### GitHub Copilot

The installer writes Copilot's agents to `.github/agents/<name>.agent.md`, and
**the CLI discovers them from the workspace automatically** — no path flag, no
registration step. Verified on Copilot CLI 1.0.63: pointing `--agent` at a name
that doesn't exist lists the ones it found, and the factory's agents are there.

```bash
# Phase 1 — seed the repo (once). Interactive.
copilot --agent scout

# Phase 2+ — drive the pipeline. --yolo pre-approves tools/paths/URLs, which a
# dispatching orchestrator needs or it stops at every subagent and shell call.
copilot --agent test-automation-lead --yolo

# Non-interactive (CI, a scripted batch): -p implies no prompts, so at minimum
# --allow-all-tools is REQUIRED or the run dies at the first confirmation.
copilot --agent test-automation-lead --allow-all-tools \
  -p "Automate TC-1234, TC-1235, TC-1236."

# Only when the project's MCP servers need auth headers the repo-root .mcp.json
# can't carry (see below) — relocate the config dir to the repo-local one:
COPILOT_HOME=./.copilot copilot --agent test-automation-lead --yolo
```

**MCP: the repo-root `.mcp.json` already works.** The CLI reads two sources —
the repo-root `.mcp.json` as **workspace servers** (automatically, no flag) and
its config dir's `mcp-config.json` as **user servers**. The config dir defaults
to `~/.copilot` and also holds `agents/`, `skills/`, `hooks/`,
`permissions-config.json` and session state
([GitHub's config-dir reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference));
`COPILOT_HOME` relocates it, and this installer writes a repo-local
`.copilot/mcp-config.json` for the Copilot target. Measured on 1.0.63 with
marker servers:

```console
$ copilot mcp list                          # repo-root .mcp.json — no flags needed
Workspace servers:
  marker-root-mcpjson (local)

$ COPILOT_HOME=./.copilot copilot mcp list  # …plus the repo-local config dir
User servers:
  probe-marker-xyz (local)
Workspace servers:
  marker-root-mcpjson (local)
```

So on a repo that also has the Claude target installed, the `.mcp.json` written
for Claude is picked up by Copilot CLI for free, and `COPILOT_HOME` is not
needed for MCP at all. `.vscode/mcp.json` is **not** read by the CLI — that file
serves the VS Code extension only.

**One real gap, and it fails silently.** Claude's `.mcp.json` carries auth for
secret-bearing HTTP/SSE servers in a `headersHelper` field — a shell command
Claude Code runs at launch to build the header from `.env`, so no secret sits on
disk. Copilot has no such mechanism: it parses the entry happily and **ignores
the field**. Verified — all three shapes load without error:

```console
$ copilot mcp list
Workspace servers:
  stdio-ok (local)
  http-plain (http)
  http-claude-auth (sse)      ← listed, but with no Authorization header
```

`stdio` servers and unauthenticated HTTP servers therefore work as-is; a
token-bearing server (OneTest, ELITEA) appears connected and returns 401s. For
those, use the installer's `.copilot/mcp-config.json` (it writes a literal
placeholder to fill in) via `COPILOT_HOME`, or add the header there. Being
listed is not being authorized — check an actual call, not `mcp list`, before
trusting the wiring.

Repointing the config home does **not** affect agent discovery: `.github/agents/`
is a workspace lookup, and the agents were listed under both `COPILOT_HOME`
and the default.

Flags worth knowing, confirmed against 1.0.63:

| Flag | What it does |
|---|---|
| `--yolo` / `--allow-all` | identical: `--allow-all-tools --allow-all-paths --allow-all-urls` |
| `--allow-all-tools` | tools run without confirmation; **required for `-p`** (env: `COPILOT_ALLOW_ALL`) |
| `--mode <interactive\|plan\|autopilot>` | initial agent mode; `--autopilot` is shorthand for the third |
| `--add-dir <dir>` | widen file access beyond the workspace |
| `--allow-tool` / `--deny-tool` | per-tool allow/deny when `--yolo` is too broad |
| `--additional-mcp-config @<file>` | *augments* the config dir's `mcp-config.json` for one session |
| `--config-dir <dir>` | legacy alias for `COPILOT_HOME`; still accepted, prints a deprecation warning |

Two ways exist to reach a repo-local MCP config, and they are not equivalent:
`COPILOT_HOME` **relocates** the whole config dir (so permissions, agents and
skills come from there too), while `--additional-mcp-config @.copilot/mcp-config.json`
only **adds** servers on top of the default home. Prefer `COPILOT_HOME`; reach
for `--additional-mcp-config` when you want your personal `~/.copilot` settings
kept and just need the project's servers added.

**VS Code extension.** Launch the agent from the chat panel's agent picker
(the same `.github/agents/` files back it). By default every tool call waits for
your approval, which makes an orchestrator that dispatches subagents unusable —
switch the session's permission mode to auto-approve / bypass before starting a
batch. The exact control name has moved between Copilot Chat releases, so find
it in your version's chat UI rather than trusting a settings key copied from a
blog post.

Cursor and Windsurf launch their primary agent differently again; see
[README.md](../../README.md) for the per-host form.

**Skipping scout?** If you launch `test-automation-lead` on a repo that was never
scouted, it won't dead-stop — it **self-orients by running the same
`seeding-automation-project` skill scout uses**, seeding the `.agents/*` set
itself and asking you only for the blocking unknowns (TMS, base branch, test
user, base URL), then proceeds. A deliberate scout pass is still richer (full
interview, PR mining, the `session-retrospective` refresh), so prefer it when
you can.

---

## Prerequisites

### Toolchain

```bash
node --version                       # Node 18+ (for the npx installer)
gh --version && gh auth status       # gh CLI for PR creation
git rev-parse --is-inside-work-tree  # inside a git repo
```

Plus:

- An application reachable at `$BASE_URL` (existing-project flow only)
- Host MCP tools wired in (optional — TMS has a markdown fallback)

Your host can be GitHub Copilot CLI, Claude Code, Cursor, or
Windsurf — the installer targets all four. Host-specific launch
syntax and install flags: [README.md](../../README.md).

### Before you seed

Two more things must be in place **before scout runs**, because scout's
tool-wiring step (Step 6.8) inspects **live MCP servers + installed
skills** on the host and derives the pipeline's agent tool-whitelists
from them. Wire these first or scout can't see them and the pipeline
agents can't load them.

#### A. Install project-specific skills (before scout)

The factory install pulls the **default roster's** declared skills — but a given
project usually needs **additional** catalog/external skills for its own
automation technology and domain.

**Discover skills for your stack — two complementary catalogues.**

1. **Generic finder** — [`npx skills`](https://github.com/vercel-labs/skills)
   searches the whole ecosystem by keyword (browse [skills.sh](https://skills.sh))
   and installs any match:

   ```bash
   npx skills find playwright          # try also: appium · "api testing" · cypress · k6
   npx skills add <owner/repo@skill>   # install a match (add -g -y for global, no prompt)
   ```

2. **This registry** — the sdlc-skills catalogue the factory installer knows:
   repo README ([§ Skills](../../README.md#skills) +
   [§ External skills](../../README.md#external-skills-fetched-by-the-installer))
   or [`skills.json`](../../skills.json). Common test-automation mappings:

   | Your automation stack / domain | Registry skills |
   |---|---|
   | Playwright (UI / E2E) | `playwright-cli`, `playwright-best-practices` |
   | Vividus (BDD) · Tricentis Tosca | `vividus` · `tosca-automation` |
   | API (FastAPI services) | `fastapi` |
   | Mobile / iOS (Appium + XCUITest) | `setup-xcuitest`, `xcuitest-real-device-config`, `appium-troubleshooting` |
   | Mobile / Android (Appium + UiAutomator2) | `setup-uiautomator2`, `appium-troubleshooting` |
   | Xray TMS | `xray-testing` |
   | Engineering craft (any stack) | `tdd`, `systematic-debugging`, `verification-before-completion` |

Install **before scout** (so its Step 6.8/6.9 see them and the pipeline agents can
load them): **registry** skills via the factory installer's quoted
`--skills "id1,id2,..."` form ([Explicit `--skills` form](#1-install-sdlc-skills)
under Step 1 has the exact invocation + the shell-whitespace guard); **any other
ecosystem** skill via `npx skills add`. Nothing matches your exact framework
(Cypress / Selenium / WebdriverIO / k6 / …)? Fine — the agents author from the
framework's own docs + your existing tests (*skills are accelerants, not
prerequisites*); add a skill only when there's a real match.

#### B. Wire MCP / connectivity (before scout)

If the project reaches its **TMS / tracker / knowledge base over MCP**
(ELITEA, Atlassian, OneTest, a vendor TestRail/Xray MCP) — or needs any
other MCP connectivity — configure those MCP servers **and their
credentials in the HOST** (`.mcp.json` / `~/.claude.json` / host
settings), **never in the project repo**, before scout.

**Wire them with the installer.** `sdlc-skills init` can write the MCP config in
each host's native form — it works with `--factory test-automation`:

```bash
# interactive menu — pick servers (↑↓ move · space toggle · enter confirm)
npx github:arozumenko/sdlc-skills init --factory test-automation --target claude --interactive

# or wire specific servers non-interactively (--mcp on its own = MCP-only run)
npx github:arozumenko/sdlc-skills init --target claude --mcp playwright,atlassian,onetest,elitea-next
```

Catalogue servers relevant to test automation: `playwright`, `chrome-devtools`,
`browserstack` (real device/browser), `postman` (API), `accessibility-scanner`
(axe-core), `atlassian` (Jira/Confluence), `onetest` / `elitea-next` (test
management), `github`, `snyk`, `sentry`. It writes `.mcp.json` +
`.mcp.json.example` with **placeholder** credentials (and `.env.example` for
token servers) — put the real tokens in your host config / `.env`, **never in
the repo**. For a server not in the catalogue, use Claude Code's native
`claude mcp add`.

**Why before scout:**

- scout's Step 6.8 derives agent tool-whitelists from the **live** MCP
  servers present on the host;
- a TMS adapter with `transport: mcp` needs the server present to
  connect;
- `.agents/test-automation.yaml` names the `mcp_server` it expects.

Without it wired first, scout can't see the tools and the TMS pipeline
can't connect. (No MCP? The **markdown-TMS fallback** still works with
no connectivity at all — see Step 3.)

---

## Existing automation project

You have an existing framework (Playwright / Cypress / WebdriverIO /
pytest + playwright-python / JUnit + Selenium / …), a reachable app,
and ideally TMS MCP tools. If any of these are missing, see the
[Greenfield](#greenfield) path instead.

### 1. Install sdlc-skills

```bash
cd /path/to/your-automation-repo
```

**Easiest path — factory install** (works for Claude Code, Copilot, Cursor, and Windsurf). One command installs the test-automation pipeline (`scout` + `test-automation-lead` + `test-automation-engineer`), their declared skills, per-role briefing overlays, and the pipeline's onboarding instructions:

```bash
npx github:arozumenko/sdlc-skills init --factory test-automation --yes

# or pin a host explicitly
npx github:arozumenko/sdlc-skills init --factory test-automation --target copilot --yes
```

This expands to the same content as the manual `--agents` form below, plus:
- briefing overlays (`factories/test-automation/briefings/*.md`) seeded into each role's `.agents/memory/<role>/project_briefing.md`
- team instructions spliced into `AGENTS.md` / `CLAUDE.md` under `<!-- FACTORY:test-automation -->` markers

See `factories/test-automation/README.md` for what's included.

Swap `--target` per host (`claude` / `cursor` / `windsurf` / `copilot`); omit it to install into every detected IDE directory. The manual `--agents` form below is only needed if you want to hand-pick a subset of the roster instead of the whole factory.

**Simplest manual form — let agent frontmatter resolve the skills automatically.** The installer reads each agent's `skills:` frontmatter, partitions into monorepo + external, fetches the externals, and reports both lists before installing:

```bash
# Quick-start — test-automation roster
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,test-automation/test-automation-lead,test-automation/test-automation-engineer \
  --yes

# Hybrid project (feature dev + test automation) — add PM, tech-lead, devs
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,project-manager,test-automation/test-automation-lead,tech-lead,ba,test-automation/test-automation-engineer \
  --yes
```

The `test-automation/<id>` form pins **this factory's copy** — a bare id
resolves to the alphabetical-first factory that owns it
(`feature-development` here), whose copies diverge by design.

**Explicit `--skills` form** — if you want to install skills not declared in the selected agents' frontmatter (e.g. `xray-testing` because the project uses Xray as its TMS), pass them inline. Quote the list to defend against shell whitespace splitting it:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,test-automation/test-automation-lead,test-automation/test-automation-engineer \
  --skills "test-automation/seeding-automation-project,test-automation/test-automation-workflow,test-automation/test-automation-implementation,test-automation/automation-scoping,test-automation/browser-verify,test-automation/code-review,test-automation/completing-a-task,test-automation/issue-tracking,test-automation/atlassian-content,test-automation/git-workflow,test-automation/plan-feature,test-automation/reproducing-issues,playwright-cli,xray-testing,memory,knowledge-curation,tdd,systematic-debugging,verification-before-completion" \
  --yes
```

> **Pitfalls the installer now catches:** a space inside the comma list (`--skills a,b, c,d`) gets split by the shell — only the first chunk reaches `--skills`. The hardened parser errors loudly on the orphan fragments now and tells you how to fix it.

Swap `--target` per host (`claude` / `cursor` / `windsurf` /
`copilot`). Omit `--target` to install into every detected IDE
directory. For Copilot users who see directories where `.agent.md`
files should be: `npx github:arozumenko/sdlc-skills init fix-copilot`
(see [README.md](../../README.md) for the `--soul` modes).

**External skills are real copies, not symlinks** (since v0.2 of the
installer). Each external skill from `skills.json` is git-cloned to a
shared cache (`~/.cache/sdlc-skills/registry/`) and then **copied** into
your project's `skills/` directory. The project tree is self-contained
— commits survive across machines, CI works without a populated cache,
and `git status` shows real files. Legacy installs that have symlinks
auto-migrate to copies on the next `init --update`.

**Heads-up on the agent roster.** If you skip a dedicated agent for
a workflow slot (e.g. you don't install `test-automation-engineer`),
scout's Step 6.9 substitutes the closest installed agent and writes
the override into `.agents/role-overrides.md` with a fallback-tier
warning. The pipeline runs, but a tech-lead or generic dev filling
test-automation-engineer's slot ships less framework-faithful tests than test-automation-engineer would —
prefer installing the dedicated agent when you can. See
[`skills/seeding-automation-project/references/role-overrides.md`](../../factories/test-automation/skills/seeding-automation-project/references/role-overrides.md)
for the substitution table.

### 2. Seed via scout

Launch scout **as your main agent** and paste the prompt below — in Claude Code:

```bash
claude --agent scout
```

Scout already carries the `seeding-automation-project` skill — the prompt
supplies only project-specific inputs. **This is where you teach the agents this
team's *way of work*:** where tasks come from, whether/how to report to the TMS
and tracker, what kind of issue to file (bug vs subtask) and where, which branch
to cut from, and how PRs get merged. Set each field (or leave `ASK` and scout
asks you) — the pipeline then does exactly what you seed here, no more (the
*external writes follow the seeded way of work* rule). It's recorded in
`.agents/profile.md` + `.agents/workflow.md` and read by every agent at session
start.

```
Onboard this repo for the test-automation workflow. Load the
seeding-automation-project skill. DO NOT scaffold a framework, modify app
code, or rewrite tests — discover and document what's there.

Host: <GitHub Copilot CLI | Claude Code | Cursor | Windsurf>

## Systems + where work comes from
Issue tracker:      <github-issues | jira | gitlab-issues | azure-boards | linear | none | ASK>
Tracker key:        <org/repo or PROJ key | ASK>
TMS:                <zephyr-scale | testrail | xray | azure-test-plans | markdown | none | ASK>
TMS project key:    <... | ASK>
Task source:        <operator-drops-case-ids | tms-folder | tms-suite | jira-board-query | github-issues | ASK>   # how the pipeline receives work to automate
Knowledge base:     <confluence | notion | obsidian | github-wiki | readme-only | none | ASK>
KB space / db:      <... | ASK>

## Way of work — reporting, issues, branching, PRs
Bug filing style:   <github-issue | story-subtask | separate-ticket | ASK>   # a standalone issue, a subtask under the story, or a separate QA project
Bug filing target:  <blank | QA-BUGS style key | ASK>
Bundling policy:    <strict-per-bug | bundle-per-case | ASK>
Link case in bug:   <yes | no | ASK>
TMS back-write:     <yes | no | ASK>          # push pass/fail to the TMS execution record after a run?
Comment PR link:    <yes | no | ASK>          # post the automation PR link on the originating story/issue?
Test case storage:  <tms | markdown | both-synced | ASK>
Automation PR base: <main | develop | feature/<name> | ASK>   # branch automation work out FROM this
Merge policy:       <auto-merge | human-approved | manual | ASK>   # how automation PRs get merged
Merge strategy:     <squash | rebase | merge | ASK>

## Notes
<!-- Free text: anything about this team's way of work that doesn't fit the
     fields above — exceptions, timing constraints, who to loop in, tribal
     knowledge scout should carry into .agents/profile.md. Leave blank if none. -->
```

Scout writes `.agents/testing.md`, `.agents/architecture.md`,
`.agents/workflow.md`, `.agents/profile.md`,
`.agents/test-automation.yaml`, `.agents/team-comms.md` — including
`.agents/testing.md § Execution provider` (`manual-qa` | `self`, detected
from the manual-qa co-install) and `§ Coverage idiom` (the framework-native
carrier for the coverage declaration). Full procedure:
[`skills/seeding-automation-project/SKILL.md`](../../factories/test-automation/skills/seeding-automation-project/SKILL.md).

**Keep the seed as a committed file** — e.g. `SEED_PROMPT.md` at the repo
root — and paste it to scout rather than retyping it. The team then evolves
one shared seed instead of each engineer improvising their own, new members
onboard their agents identically, and seed changes get reviewed like any other
change. A seed can carry much more than the template above — real projects
seed multi-repo layouts, long-lived integration branches, work boards with
human-approval columns, and case-sourcing rules. Scout records whatever way
of work you teach, and the pipeline follows exactly that — no more.

**After scout completes, review `.agents/testing.md`.** If the
framework name, version, run command, CI command, or execution provider
is wrong, fix by hand. The engineer's output quality is entirely
downstream of this file — two minutes here saves a rolled-back staging
environment later.

Fill in every `Unconfirmed` field scout couldn't infer (test
environments, test user accounts, test data strategy, scope
boundaries). The pipeline agents refuse to proceed without these.

### 3. Verify `.agents/test-automation.yaml`

Scout populated this from your pre-fill block + repo inspection.
Open it, fill any `<ASK>` slots (typically `auth_env` for HTTP
transport, or an MCP server name when multiple candidates exist).

Full schema + all adapter variants (Xray / Zephyr / TestRail /
Azure / markdown; MCP vs HTTP transport):
[`skills/test-automation-workflow/references/tms-adapters.md`](../../factories/test-automation/skills/test-automation-workflow/references/tms-adapters.md).

No TMS? The markdown adapter is a one-liner — case files live in the
repo (manual-qa's `tasks/<suite>/TC-*.md` convention), and TA reads them
without ever editing them:

```yaml
tms:
  adapter: markdown
  cases_dir: tasks
```

### 4. Smoke-test test-automation-lead dispatch (30 seconds)

Before running a real case, prove that `test-automation-lead` actually
**dispatches** a subagent on this host — not just narrates what it would
do. Sonnet-tier orchestrators occasionally drift to "I'll route this to
the engineer to do X" without emitting the host-specific dispatch call.
Catching that here is much cheaper than catching it mid-pilot.

Launch `test-automation-lead` as your main agent (`claude --agent test-automation-lead`)
and hand it this no-op routing prompt:

> Smoke-test the routing wiring. Dispatch a one-line task to
> test-automation-engineer asking it to read the first two lines of
> `.agents/testing.md` and return them verbatim. Do **not** read the
> file yourself — the point is to prove that the dispatch actually
> fires, not to retrieve the content.

**Pass criteria:**

- test-automation-lead's reply contains an actual subagent dispatch in the **exact
  form `.agents/team-comms.md` documents for this host** (Claude Code:
  an `Agent(...)` tool call; other hosts differ — the seeded template
  carries the working pattern), **and** test-automation-engineer actually runs.
- test-automation-engineer's reply contains the **actual** two lines from
  `.agents/testing.md`, not a paraphrase or refusal.

**Fail signals:**

- test-automation-lead says "I've routed this to the engineer" but no dispatch
  appears in the same reply — the subagent never spawned (narration without
  dispatch).
- test-automation-lead emits a different host's dispatch form than the one
  `.agents/team-comms.md` documents (e.g. a Claude `Agent(...)` call
  under Copilot). The dispatch prints as plain text and nothing runs.
- test-automation-engineer never runs — whatever test-automation-lead emitted, if
  no subagent actually executed, the wiring is broken.

If the smoke fails, the dispatch wiring is broken on this host. See
[`skills/test-automation-workflow/references/orchestration-playbook.md` § How to dispatch a subagent
(host preflight)](../../factories/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#how-to-dispatch-a-subagent-host-preflight) and re-read
`.agents/team-comms.md` for the per-host invocation pattern. Re-run
the smoke until it passes before continuing.

### 5. Pilot one case end-to-end

Pick a case you already know passes manually. Keep it small — login,
a navigation, a simple form. The point is to prove the pipeline, not
the app.

The full routing flow lives in the orchestration playbook —
[`skills/test-automation-workflow/references/orchestration-playbook.md` § Canonical dispatch templates](../../factories/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#canonical-dispatch-templates).
The engineer's own process (six-phase loop, the three route disciplines,
no-defect-masking, Run Report template) is in
[`skills/test-automation-implementation/SKILL.md`](../../factories/test-automation/skills/test-automation-implementation/SKILL.md);
the coverage grammar in
[`references/coverage-contract.md`](../../factories/test-automation/skills/test-automation-workflow/references/coverage-contract.md).
Shape:

1. **Intake (test-automation-lead)** resolves the case with one TMS/tasks
   sweep and snapshots each case body to
   `.agents/automation/<slug>/cases/<ID>.md` — every worker then
   triangulates against the identical body (tracker/TMS are written at
   intake and the close sweep, not per dispatch). One cheap
   **clustering + sizing pass** over the snapshots screens the batch:
   un-automatable and already-covered verdicts are made **here**, before
   any build — and those verdicts double as the **exclusion budget** the
   reviewer cross-checks later.
2. **Route** — per `.agents/testing.md § Execution provider` (the
   [co-install table](#co-install-with-manual-qa--first-class-not-an-afterthought)
   above): `manual-qa-verified` builds from existing PASS evidence with no
   re-execution; `needs-execution` gets a `test-runner` dispatch per case
   (FAIL → defect filed, the case is not automated until fixed);
   `combined` proceeds straight to build — the first green run of the
   automated test **is** the case's first execution.
3. **Build (test-automation-engineer)** derives what to build straight
   from the case snapshot, writes the test in the existing framework, and
   proves it green **once** locally (determinism is the hardening gate's
   job) — with the **coverage declaration** in the spec: a comment block
   `TC-<id> coverage: …` / `TC-<id> excluded: …`, exclusions only from the
   closed vocabulary (`covered-elsewhere` / `blocked-by-defect` /
   `un-automatable` / `by-seeded-policy`), each with a verifiable referent.
   Locators come cheapest-first: the surface cache → manual-qa knowledge
   (read-only) → the case file → a targeted live probe; whatever probing
   reveals goes back into `.agents/automation/surface/<feature>.md`. Then
   a PR opens.
4. **Review (fresh engineer-typed dispatch + `code-review` + the reviewer
   contract)** walks the case step-by-step against the coverage
   declaration — **static**, no execution — and touches every referent
   (runs the named covering test, opens the defect, checks the taxonomy,
   reads the policy line). Fix rounds until approved, then the unit merges
   back into the batch trunk.
5. **Hardening gate (its own agent, once per batch)** — the merge
   signal; neither the implementer's green-once nor the reviewer's
   `APPROVED` substitutes, and it is deliberately never the agent that
   wrote the code. The batch's specs run **together** on the trunk,
   requiring **N** consecutive deterministic GREEN (default 3) against
   the live env, plus one run of the specs the batch could have broken
   (the blast radius). It never merges, classifies a red, or fixes
   anything.
6. **One report** — `.agents/automation/<slug>/report.{json,md}`: one
   row per case with its outcome (`delivered` · `defect-found` ·
   `blocked` · `un-automatable` · `needs-execution` · `infra-stalled` ·
   `not-started`), its coverage record, and any findings it produced
   along the way. One more appears only when a run was interrupted:
   `merged-ungated` — built, reviewed and merged, but the gate never
   returned a verdict. It means "re-run the gate", never "failed".
7. **test-automation-lead closes** — merges the `delivered` cases per
   `.agents/profile.md` § Automation PR policy (`auto-merge` /
   `human-approved` / `manual`), routes the findings, then runs the one
   close sweep: back-writes the TMS execution (automation executions
   **only** — manual-qa's live runs are their own record) and transitions
   the tracker for the batch, per the seed. Anything not `delivered` is
   simply the next batch's input.

**Don't just wait for the report — watch the pilot.** It is your one cheap
chance to catch mis-wiring before a batch multiplies it:

- **The right tools get called** — TMS/tracker calls go through the MCP
  servers you wired (no auth errors, no silent fallback you didn't ask for).
- **The case is read correctly** — open the intake snapshot at
  `.agents/automation/<slug>/cases/<ID>.md` and compare it with the source
  system: steps, preconditions, and the custom fields you care about all
  made it through.
- **Sub-agents are really dispatched** — the lead hands work to the
  builder/reviewer/gate as separate sub-agents (the active agent
  switches; Ctrl+T lists running tasks), rather than narrating the work
  itself in one session.
- **Actions follow your seed** — bugs filed the way you specified, the PR
  against the branch you chose, TMS back-write happening (or not) exactly
  as seeded.

If any of these look wrong, stop and fix the wiring (MCP config, the seed,
`.agents/testing.md`) before scaling up. And steer: a run is a conversation,
not a fire-and-forget script — interrupt, correct in plain words ("probe the
live page for the real locator instead of guessing"), review the coverage
declaration / PR diff / report row, and ask for a redo when something isn't
right. Fixing course mid-pilot is normal and cheap; that's what the pilot is
for.

### 6. Scale up

The batch — not the case — is the unit of work: Intake resolves the
whole work set, then **units run one at a time on a shared batch
trunk**, each building on what the previous one merged, with **one**
hardening gate over the batch at the end. Nothing overlaps, because one
working tree has one state at a time. Once your pilot case (Step 5)
proves the wiring, hand `test-automation-lead` a real batch instead of
one case — batching is also markedly cheaper per delivered case than
running cases one per session, since a session's context build-up and
the gate are paid once for the whole batch instead of once each.

Beyond one batch, batches compose into **campaigns** — waves, a
foundation pass, and clusters of similar cases planned together:
[`references/campaign-planning.md`](../../factories/test-automation/skills/test-automation-workflow/references/campaign-planning.md).
The loop itself, its defaults and its serialization rules:
[`references/orchestration-playbook.md` § The loop: plan → run → close](../../factories/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#the-loop-plan--run--close), plus
[`references/commands.md`](../../factories/test-automation/skills/test-automation-workflow/references/commands.md)
for host-specific sub-agent spawning recipes.

**Work that isn't a test case** — tech-debt, a migration, framework
improvements, suite health — runs the *same* loop: a
[tech-task brief](../../factories/test-automation/skills/test-automation-workflow/references/tech-task-brief.md)
takes the case's place as the unit contract (source, scope from the real
code, out-of-scope, acceptance criteria, blast radius, verification),
and build → static review → merge → one gate is unchanged. Ask the lead
in plain words: _"finish the stable-handle migration"_, or point it at a
tracker label to sweep.

---

## After the run — improve and measure

**Improve (session retrospective).** Every correction you had to type during a
run is a signal. Periodically launch `scout` and ask *"run a retrospective on
our recent sessions"* — it mines the project's actual past agent sessions
(Claude Code and Copilot alike), finds the corrections you kept repeating and
the durable facts worth keeping, and proposes updates to the shared `.agents/`
config and per-role memory. **Nothing is written without your explicit ack** —
each change comes with the session evidence that motivated it. That loop is
how the team stops needing the same prompt twice.

**Measure (efficiency audit + tokenomics).** Ask *"what did this batch cost?"*
— the `efficiency-audit` skill answers per session, per role, per day and per
sub-agent from live transcripts, with every dollar metered. For the durable,
automatic version, enable the `tokenomics` skill's capture hooks (opt-in:
`node .claude/skills/tokenomics/scripts/install-hooks.mjs`): every finished
session lands in a git-committed ledger, and each batch gets
`.agents/automation/<slug>/cost.json` refreshed automatically — outcomes,
cost per case (direct, measured), overhead shown once, and
avg/median/min/max spreads. Human views:

```bash
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug>              # markdown
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug> --html --out batch.html
```

---

## Greenfield

You have no existing test framework. sdlc-skills doesn't bootstrap
one unilaterally — that's an architectural decision. **`test-automation-lead`
owns it.**

1. **Install** with the test-automation roster — make sure
   `test-automation-lead` is included.
2. **Seed via scout** with `TMS: markdown` and `Automation PR base:
   main` (adjust later). Skip framework-specific fields; scout writes
   a stub `.agents/testing.md` with a note that the framework isn't
   picked yet.
3. **Launch `test-automation-lead`** as your main agent — in Claude Code
   `claude --agent test-automation-lead` — with the `test-automation-workflow`
   skill (already in its frontmatter — preloaded). Hand it:

   > Bootstrap a test-automation scaffold for this empty repo. Pick
   > the framework per the decision flow in
   > [`skills/test-automation-workflow/references/framework-scaffold.md`](../../factories/test-automation/skills/test-automation-workflow/references/framework-scaffold.md)
   > — test surface first (UI / API / mobile / performance), then the
   > project's primary language within that surface.
   > Define page-object style, fixture pattern, naming, run command,
   > and CI command. Write the chosen conventions into
   > `.agents/testing.md`. Then dispatch `test-automation-engineer` to
   > create the initial config files + one smoke test proving the
   > scaffold works.

4. **test-automation-lead dispatches `test-automation-engineer`** with the scaffold
   plan. test-automation-engineer creates the initial config files + one smoke test.
5. **From here, follow the existing-project flow** — Step 4 (smoke-test
   test-automation-lead dispatch) and then Step 5 (pilot one case) above — with the
   first real case (or markdown case).

**Expect the first 2–3 cases to look thin on conventions.** test-automation-engineer
normally reads neighbouring tests for existing patterns before writing —
on a fresh scaffold there are none yet, so it follows the scaffold
test-automation-lead just laid down. That's fine. The convention-matching
gets real once 3–4 cases have shipped and a body of convention exists to
mirror.

test-automation-lead's full framework-architecture contract lives in
[`skills/test-automation-workflow/references/orchestration-playbook.md` § Framework architecture](../../factories/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#framework-architecture).

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote
  directories instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`. See
  [README.md](../../README.md) for `--soul` modes.
- **The reviewer keeps blocking on excluded steps** → the coverage
  grammar is closed by design: every exclusion is one of
  `covered-elsewhere` / `blocked-by-defect` / `un-automatable` /
  `by-seeded-policy` **with a verifiable referent** (the covering test's
  name, the defect id, the taxonomy category, the policy line). Free-text
  reasons ("flaky", "hard") are invalid grammar. And an `un-automatable`
  the intake screening didn't sanction can only be *requested* through
  the lead — the engineer cannot mint it.
- **test-automation-engineer generates off-style tests** → `.agents/testing.md` is
  misleading him. Fix it by hand (framework version, page-object
  convention, run command); ask test-automation-engineer to re-derive
  the test from the corrected file.
- **TMS back-write silently fails** → look in `test-results/unsynced/`
  for the queued payload. Retry manually, or have test-automation-lead
  re-run the close-sweep back-write for that case (playbook § 3. Close) — the implementer only performs it when run
  standalone with no orchestrator.
- **MCP auth errors** → token rotated / scope missing. Fix the MCP
  server config in the host (`~/.claude.json`, `.mcp.json`, Copilot
  settings). Never in the project repo. Restart the agent session.
- **Flaky test at CI but not local** → head vs headless, viewport,
  timing. test-automation-engineer owns root-cause. Never accept "retry three times" as
  a fix.

---

## Maintenance

**Where to tune what — this decides whether you can keep updating.** The
factory is a kickstarter, not a locked product: everything it installs is plain
files, and your copy is *expected* to drift from the original. But in the
majority of cases the right place to tune is **not** the agent files — it's
`.agents/`, the project knowledge every agent reads (`testing.md`,
`profile.md`, `workflow.md`, per-role memory). Land changes there — via
scout's retrospective, or by simply telling an agent to change how it works —
and you can keep pulling newer factory versions with `init --update` without
losing anything. Edit the agents and skills *themselves* only when you intend
to contribute the improvement back, or to deliberately maintain your own
variant: a factory edited in place stops being cleanly updatable.

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md). One
flow specific to the test-automation roster matters often enough to put
inline:

### Adding `test-automation-lead` to an existing install

If you onboarded before test-automation-lead existed (or you originally installed only PM
and now want the TA pipeline), pull just test-automation-lead and its skills:

```bash
npx github:arozumenko/sdlc-skills init --update \
  --agents test-automation/test-automation-lead \
  --skills test-automation/test-automation-workflow,test-automation/code-review,test-automation/completing-a-task,test-automation/issue-tracking,test-automation/atlassian-content
```

Then re-run scout as above so scout's frontmatter audit verifies the
context wiring for the new role.

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # scout-generated project context
├── .agents/
│   ├── testing.md / architecture.md  # scout-owned content docs (incl. execution provider + coverage idiom)
│   ├── team-comms.md / profile.md / workflow.md
│   ├── test-automation.yaml          # TMS + framework config (yours to edit)
│   ├── automation/<slug>/            # intake case snapshots + the run's one report
│   ├── automation/surface/           # surface cache: <feature>.md — accreted handles, waits, quirks
│   └── memory/<role>/                # per-role persistent memory
├── tasks/ · reports/                 # manual-qa's cases + run records (read-only to TA, when co-installed)
├── test-results/                     # run evidence
│   ├── screenshots/ reports/ json/
│   └── unsynced/                     # failed TMS back-writes, to retry
├── tests/                            # YOUR framework — TA's merged specs land here via PRs
└── .github/agents/<role>.agent.md    # or .claude/agents/<role>/ per host
```

Only `.agents/` and `test-results/` are owned by the sdlc-skills
pipeline; `tests/` gains new specs only through reviewed, gated PRs.
`tasks/` and `reports/` belong to the manual-qa factory — TA reads them,
never writes. Your app code and CI config stay untouched.
