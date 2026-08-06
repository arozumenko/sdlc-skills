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

```
User → test-automation-lead → analyst slot → AFS → implementer slot → reviewer slot → test-automation-lead merges
```

Role defaults (personas are assigned per `.agents/team-comms.md`):

| Slot | Agent | Skill |
|---|---|---|
| Orchestrator | `test-automation-lead` | `test-automation-workflow` (routing lives in the agent's AGENT.md) |
| Analyst | `qa-engineer` | `test-case-analysis` |
| Implementer | `test-automation-engineer` | `test-automation-workflow` (IC-facing six-phase loop) |
| Reviewer | `qa-engineer` (fresh session) | `code-review` |

`test-automation-lead` is a **top-level orchestrator launched directly
by the user** — not a subagent of `project-manager`. The role owns slot
routing, AFS gating, automation merge, and test-framework architecture
(greenfield bootstrap, framework-scale work, mid-flow escalations).
Tech-lead is no longer in the test-automation path. `project-manager`
remains the orchestrator for feature-development work; on hybrid
projects, PM and `test-automation-lead` coexist as peers, and PM points
TA traffic at `test-automation-lead` via a user-readable prompt (not a
subagent dispatch). Full routing rules:
[`agents/test-automation-lead/AGENT.md`](../../bundles/test-automation/agents/test-automation-lead/AGENT.md).

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
TC-1234") — it stays the orchestrator for the whole session. Other hosts
(Copilot CLI, Cursor, Windsurf) launch their primary agent differently; see
[README.md](../../README.md) for the per-host form.

**Skipping scout?** If you launch `test-automation-lead` on a repo that was never
scouted, it won't dead-stop — it **self-orients by running the same
`seeding-a-project` skill scout uses**, seeding the `.agents/*` set itself and
asking you only for the blocking unknowns (TMS, base branch, test user, base
URL), then proceeds. A deliberate scout pass is still richer (full interview, PR
mining, the `session-retrospective` refresh), so prefer it when you can.

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

The bundle install pulls the **default roster's** declared skills — but a given
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

2. **This registry** — the sdlc-skills catalogue the bundle installer knows:
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
load them): **registry** skills via the bundle installer's quoted
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
each host's native form — it works with `--bundle test-automation`:

```bash
# interactive menu — pick servers (↑↓ move · space toggle · enter confirm)
npx github:arozumenko/sdlc-skills init --bundle test-automation --target claude --interactive

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

**Easiest path — bundle install** (works for Claude Code, Copilot, Cursor, and Windsurf). One command installs the test-automation pipeline (`test-automation-lead` + `qa-engineer` + `test-automation-engineer` + scout), their declared skills, per-role briefing overlays, and the pipeline's onboarding instructions:

```bash
npx github:arozumenko/sdlc-skills init --bundle test-automation --yes

# or pin a host explicitly
npx github:arozumenko/sdlc-skills init --bundle test-automation --target copilot --yes
```

This expands to the same content as the manual `--agents` form below, plus:
- briefing overlays (`bundles/test-automation/briefings/*.md`) seeded into each role's `.agents/memory/<role>/project_briefing.md`
- team instructions spliced into `AGENTS.md` / `CLAUDE.md` under `<!-- BUNDLE:test-automation -->` markers

See `bundles/test-automation/README.md` for what's included.

Swap `--target` per host (`claude` / `cursor` / `windsurf` / `copilot`); omit it to install into every detected IDE directory. The manual `--agents` form below is only needed if you want to hand-pick a subset of the roster instead of the whole bundle.

**Simplest manual form — let agent frontmatter resolve the skills automatically.** The installer reads each agent's `skills:` frontmatter, partitions into monorepo + external, fetches the externals, and reports both lists before installing:

```bash
# Quick-start — test-automation roster
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,test-automation/test-automation-lead,test-automation/qa-engineer,test-automation/test-automation-engineer \
  --yes

# Hybrid project (feature dev + test automation) — add PM, tech-lead, devs
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,project-manager,test-automation/test-automation-lead,tech-lead,ba,test-automation/qa-engineer,test-automation/test-automation-engineer \
  --yes
```

The `test-automation/<id>` form pins **this bundle's copy** — a bare id
resolves to the alphabetical-first bundle that owns it
(`feature-development` here), whose copies diverge by design.

**Explicit `--skills` form** — if you want to install skills not declared in the selected agents' frontmatter (e.g. `xray-testing` because the project uses Xray as its TMS), pass them inline. Quote the list to defend against shell whitespace splitting it:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents test-automation/scout,test-automation/test-automation-lead,test-automation/qa-engineer,test-automation/test-automation-engineer \
  --skills "test-automation/seeding-a-project,test-automation/test-case-analysis,test-automation/test-automation-workflow,test-automation/playwright-testing,playwright-cli,test-automation/browser-verify,test-automation/bugfix-workflow,test-automation/code-review,test-automation/completing-a-task,test-automation/issue-tracking,test-automation/atlassian-content,xray-testing,test-automation/memory,tdd,test-automation/git-workflow,test-automation/plan-feature,systematic-debugging,verification-before-completion,requesting-code-review,receiving-code-review,writing-skills" \
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
[`skills/seeding-a-project/references/role-overrides.md`](../../bundles/test-automation/skills/seeding-a-project/references/role-overrides.md)
for the substitution table.

### 2. Seed via scout

Launch scout **as your main agent** and paste the prompt below — in Claude Code:

```bash
claude --agent scout
```

Scout already carries the `seeding-a-project` skill — the prompt supplies only
project-specific inputs. **This is where you teach the agents this team's *way of
work*:** where tasks come from, whether/how to report to the TMS and tracker,
what kind of issue to file (bug vs subtask) and where, which branch to cut from,
and how PRs get merged. Set each field (or leave `ASK` and scout asks you) — the
pipeline then does exactly what you seed here, no more (the *external writes
follow the seeded way of work* rule). It's recorded in `.agents/profile.md` +
`.agents/workflow.md` and read by every agent at session start.

```
Onboard this repo for the test-automation workflow. Load the
seeding-a-project skill. DO NOT scaffold a framework, modify app code,
or rewrite tests — discover and document what's there.

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
`.agents/test-automation.yaml`, `.agents/team-comms.md`. Full
procedure: [`skills/seeding-a-project/SKILL.md`](../../bundles/test-automation/skills/seeding-a-project/SKILL.md).

**After scout completes, review `.agents/testing.md`.** If the
framework name, version, run command, or CI command is wrong, fix
by hand. test-automation-engineer's output quality is entirely downstream of this file
— two minutes here saves a rolled-back staging environment later.

Fill in every `Unconfirmed` field scout couldn't infer (test
environments, test user accounts, test data strategy, scope
boundaries). qa-engineer and test-automation-engineer refuse to proceed without these.

### 3. Verify `.agents/test-automation.yaml`

Scout populated this from your pre-fill block + repo inspection.
Open it, fill any `<ASK>` slots (typically `auth_env` for HTTP
transport, or an MCP server name when multiple candidates exist).

Full schema + all adapter variants (Xray / Zephyr / TestRail /
Azure / markdown; MCP vs HTTP transport):
[`skills/test-automation-workflow/references/tms-adapters.md`](../../bundles/test-automation/skills/test-automation-workflow/references/tms-adapters.md).

No TMS? The markdown fallback is a one-liner:

```yaml
tms:
  adapter: markdown
  cases_dir: test-specs
```

### 4. Smoke-test test-automation-lead dispatch (30 seconds)

Before running a real case, prove that `test-automation-lead` actually
**dispatches** a subagent on this host — not just narrates what it would
do. Sonnet-tier orchestrators occasionally drift to "I'll route this to
qa-engineer to do X" without emitting the host-specific dispatch call.
Catching that here is much cheaper than catching it mid-pilot.

Launch `test-automation-lead` as your main agent (`claude --agent test-automation-lead`)
and hand it this no-op routing prompt:

> Smoke-test the routing wiring. Dispatch a one-line task to
> qa-engineer asking it to read the first two lines of
> `.agents/testing.md` and return them verbatim. Do **not** read the
> file yourself — the point is to prove that the dispatch actually
> fires, not to retrieve the content.

**Pass criteria:**

- test-automation-lead's reply contains an actual subagent dispatch in the **exact
  form `.agents/team-comms.md` documents for this host** (Claude Code:
  an `Agent(...)` tool call; other hosts differ — the seeded template
  carries the working pattern), **and** qa-engineer actually runs.
- qa-engineer's reply contains the **actual** two lines from
  `.agents/testing.md`, not a paraphrase or refusal.

**Fail signals:**

- test-automation-lead says "I've routed this to qa-engineer" but no dispatch appears
  in the same reply — the subagent never spawned (narration without
  dispatch).
- test-automation-lead emits a different host's dispatch form than the one
  `.agents/team-comms.md` documents (e.g. a Claude `Agent(...)` call
  under Copilot). The dispatch prints as plain text and nothing runs.
- qa-engineer never runs — whatever test-automation-lead emitted, if no subagent
  actually executed, the wiring is broken.

If the smoke fails, the dispatch wiring is broken on this host. See
[`skills/test-automation-workflow/references/orchestration-playbook.md` § How to dispatch a subagent
(host preflight)](../../bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#how-to-dispatch-a-subagent-host-preflight) and re-read
`.agents/team-comms.md` for the per-host invocation pattern. Re-run
the smoke until it passes before continuing.

### 5. Pilot one case end-to-end

Pick a case you already know passes manually. Keep it small — login,
a navigation, a simple form. The point is to prove the pipeline, not
the app.

The full slot-by-slot routing flow lives in the orchestration playbook —
[`skills/test-automation-workflow/references/orchestration-playbook.md` § Canonical dispatch templates](../../bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#canonical-dispatch-templates).
The IC-facing process for each slot (analyst six-phase loop, implementer
six-phase loop, AFS rules, no-defect-masking, run-report template) is in
[`skills/test-automation-workflow/SKILL.md`](../../bundles/test-automation/skills/test-automation-workflow/SKILL.md).
Shape:

1. **Analyst (qa-engineer + `test-case-analysis`)** executes the
   case, emits an AFS at
   `test-specs/<feature>/l<pri>_<slug>_<tms-id>.md`, returns a status.
2. **Gate on status** — `ready-for-automation` and `extend-existing`
   advance. Fix `blocked` / `defect-found` / `un-automatable` upstream.
3. **Implementer (test-automation-engineer)** reads the AFS, writes
   the test in the existing framework, runs it locally and in CI,
   opens a PR, and verifies the TMS reporter wiring is in place.
4. **Reviewer (qa-engineer, fresh session, + `code-review` skill)**
   checks assertions, selectors, defect-masking, cleanup. Reports
   with file:line refs.
5. **test-automation-lead merges** per `.agents/profile.md` § Automation PR policy
   (`auto-merge` / `human-approved` / `manual`), then back-writes the
   TMS execution per the seed — the back-write is the orchestrator's
   post-merge step, not the implementer's.

### 6. Scale up

Once one case works end-to-end, batch is safe. Parallelism and
serialization rules (page-object collisions, independent-surface
parallelism, reviewer batching): [`skills/test-automation-workflow/references/orchestration-playbook.md` § Batching](../../bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#batching) and
[`skills/test-automation-workflow/references/commands.md`](../../bundles/test-automation/skills/test-automation-workflow/references/commands.md)
for host-specific sub-agent spawning recipes.

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
   > [`skills/test-automation-workflow/references/framework-scaffold.md`](../../bundles/test-automation/skills/test-automation-workflow/references/framework-scaffold.md)
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

**Expect the first 2–3 cases to look thin on Phase 3 (Automate).** test-automation-engineer's
"conventions sweep" normally reads neighbouring tests for existing
patterns — on a fresh scaffold there are none yet, so the sweep will
produce a short note ("no neighbours; following the scaffold test-automation-lead just
laid down"). That's fine. The sweep gets real once 3–4 cases have
shipped and a body of convention exists to mirror.

test-automation-lead's full framework-architecture contract lives in
[`skills/test-automation-workflow/references/orchestration-playbook.md` § Framework architecture](../../bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md#framework-architecture).

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote
  directories instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`. See
  [README.md](../../README.md) for `--soul` modes.
- **qa-engineer returns `ready-for-automation` with a sparse selector
  table** → she skipped exploration. Re-run with: *"Execute every
  step against the live surface (playwright-testing / browser-verify
  for UI, the project's API client for API cases) before writing the
  AFS — do not author from the TMS case description alone."*
- **test-automation-engineer generates off-style tests** → `.agents/testing.md` is
  misleading him. Fix it by hand (framework version, page-object
  convention, run command); ask test-automation-engineer to re-derive
  the spec from the corrected file.
- **TMS back-write silently fails** → look in `test-results/unsynced/`
  for the queued payload. Retry manually or re-run the back-write
  step through test-automation-engineer.
- **MCP auth errors** → token rotated / scope missing. Fix the MCP
  server config in the host (`~/.claude.json`, `.mcp.json`, Copilot
  settings). Never in the project repo. Restart the agent session.
- **Flaky test at CI but not local** → head vs headless, viewport,
  timing. test-automation-engineer owns root-cause. Never accept "retry three times" as
  a fix.

---

## Maintenance

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md). One
flow specific to the test-automation roster matters often enough to put
inline:

### Adding `test-automation-lead` to an existing install

If you onboarded before test-automation-lead existed (or you originally installed only PM
and now want the TA pipeline), pull just test-automation-lead and its skills:

```bash
npx github:arozumenko/sdlc-skills init --update \
  --agents test-automation/test-automation-lead \
  --skills test-automation/test-automation-workflow,test-automation/test-case-analysis,test-automation/code-review,test-automation/completing-a-task,test-automation/issue-tracking,test-automation/atlassian-content
```

Then re-run scout as above so scout's frontmatter audit verifies the
context wiring for the new role.

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # scout-generated project context
├── .agents/
│   ├── testing.md / architecture.md  # scout-owned content docs
│   ├── team-comms.md / profile.md / workflow.md
│   ├── test-automation.yaml          # TMS + framework config (yours to edit)
│   └── memory/<role>/                # per-role persistent memory
├── test-specs/                       # AFS files (analyst emits)
│   └── <feature>/l<pri>_<slug>_<tms-id>.md
├── test-results/                     # evidence (both phases)
│   ├── screenshots/ reports/ json/
│   └── unsynced/                     # failed TMS back-writes, to retry
├── tests/                            # YOUR framework (untouched)
└── .github/agents/<role>.agent.md    # or .claude/agents/<role>/ per host
```

Only `.agents/`, `test-specs/`, and `test-results/` are owned by the
sdlc-skills pipeline. Your framework, app code, and CI config stay
untouched.
