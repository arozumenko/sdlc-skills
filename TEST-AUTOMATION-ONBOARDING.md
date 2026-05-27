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
[`agents/test-automation-lead/AGENT.md`](agents/test-automation-lead/AGENT.md).

---

## Prerequisites

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
syntax and install flags: [README.md](README.md).

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

**Easiest path — bundle install** (Claude Code today; other hosts pending bundle target support). One command installs the test-automation pipeline (`test-automation-lead` + `qa-engineer` + `test-automation-engineer` + scout), their declared skills, per-role briefing overlays, and the pipeline's onboarding instructions:

```bash
npx github:arozumenko/sdlc-skills init --bundle test-automation --yes
```

This expands to the same content as the manual `--agents` form below, plus:
- briefing overlays (`bundles/test-automation/briefings/*.md`) seeded into each role's `.agents/memory/<role>/project_briefing.md`
- team instructions spliced into `AGENTS.md` / `CLAUDE.md` under `<!-- BUNDLE:test-automation -->` markers

See `bundles/test-automation/README.md` for what's included.

For other IDEs (Copilot, Cursor, Windsurf), use the manual `--agents` form below until the bundle's `targets:` list expands.

**Simplest manual form — let agent frontmatter resolve the skills automatically.** The installer reads each agent's `skills:` frontmatter, partitions into monorepo + external, fetches the externals, and reports both lists before installing:

```bash
# Quick-start — test-automation roster
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,test-automation-lead,qa-engineer,test-automation-engineer \
  --yes

# Hybrid project (feature dev + test automation) — add PM, tech-lead, devs
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,project-manager,test-automation-lead,tech-lead,ba,qa-engineer,test-automation-engineer \
  --yes
```

**Explicit `--skills` form** — if you want to install skills not declared in the selected agents' frontmatter (e.g. `qaspace` because the project uses the EPAM qaspace Test Management Plugin), pass them inline. Quote the list to defend against shell whitespace splitting it:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,test-automation-lead,qa-engineer,test-automation-engineer \
  --skills "seeding-a-project,test-case-analysis,test-automation-workflow,playwright-testing,playwright-cli,browser-verify,bugfix-workflow,code-review,completing-a-task,issue-tracking,atlassian-content,xray-testing,qaspace,memory,tdd,git-workflow,plan-feature,systematic-debugging,verification-before-completion,requesting-code-review,receiving-code-review,writing-skills" \
  --yes
```

> **Pitfalls the installer now catches:** a space inside the comma list (`--skills a,b, c,d`) gets split by the shell — only the first chunk reaches `--skills`. The hardened parser errors loudly on the orphan fragments now and tells you how to fix it.

Swap `--target` per host (`claude` / `cursor` / `windsurf` /
`copilot`). Omit `--target` to install into every detected IDE
directory. For Copilot users who see directories where `.agent.md`
files should be: `npx github:arozumenko/sdlc-skills init fix-copilot`
(see [README.md](README.md) for the `--soul` modes).

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
[`skills/seeding-a-project/references/role-overrides.md`](skills/seeding-a-project/references/role-overrides.md)
for the substitution table.

### 2. Seed via scout

Launch scout and paste the prompt below. Scout already carries the
`seeding-a-project` skill — the prompt supplies only project-specific
inputs:

```
Onboard this repo for the test-automation workflow. Load the
seeding-a-project skill. DO NOT scaffold a framework, modify app code,
or rewrite tests — discover and document what's there.

Host: <GitHub Copilot CLI | Claude Code | Cursor | Windsurf>

## Project systems
Issue tracker:      <github-issues | jira | gitlab-issues | azure-boards | linear | none | ASK>
Tracker key:        <org/repo or PROJ key | ASK>
TMS:                <zephyr-scale | testrail | xray | azure-test-plans | markdown | none | ASK>
TMS project key:    <... | ASK>
Knowledge base:     <confluence | notion | obsidian | github-wiki | readme-only | none | ASK>
KB space / db:      <... | ASK>
Bug filing style:   <github-issue | story-subtask | separate-ticket | ASK>
Bug filing target:  <blank | QA-BUGS style key | ASK>
Bundling policy:    <strict-per-bug | bundle-per-case | ASK>
Link case in bug:   <yes | no | ASK>
Test case storage:  <tms | markdown | both-synced | ASK>
Automation PR base: <main | develop | feature/<name> | ASK>
Merge policy:       <auto-merge | human-approved | manual | ASK>
Merge strategy:     <squash | rebase | merge | ASK>
```

Scout writes `.agents/testing.md`, `.agents/architecture.md`,
`.agents/workflow.md`, `.agents/profile.md`,
`.agents/test-automation.yaml`, `.agents/team-comms.md`. Full
procedure: [`skills/seeding-a-project/SKILL.md`](skills/seeding-a-project/SKILL.md).

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
[`skills/test-automation-workflow/references/tms-adapters.md`](skills/test-automation-workflow/references/tms-adapters.md).

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

Launch `test-automation-lead` and hand it this no-op routing prompt:

> Smoke-test the routing wiring. Dispatch a one-line task to
> qa-engineer asking it to read the first two lines of
> `.agents/testing.md` and return them verbatim. Do **not** read the
> file yourself — the point is to prove that the dispatch actually
> fires, not to retrieve the content.

**Pass criteria:**

- test-automation-lead's reply contains an actual subagent **tool call** matching the
  host declared in `.agents/team-comms.md` — a Claude `Agent(...)`
  tool call or a Copilot `runSubagent(...)` tool call.
- qa-engineer's reply contains the **actual** two lines from
  `.agents/testing.md`, not a paraphrase or refusal.

**Fail signals:**

- test-automation-lead says "I've routed this to qa-engineer" but no tool call appears
  in the same reply — the subagent never spawned (narration without
  dispatch).
- test-automation-lead emits the wrong host syntax — Claude `Agent(...)` under Copilot,
  or `runSubagent(...)` under Claude. The call lands in the wrong
  dispatcher and nothing runs.
- test-automation-lead emits prose like "Use the `qa-engineer` agent to …" under
  *any* host. That's text, not a dispatch call — both Claude and
  Copilot require an actual tool call.

If the smoke fails, the dispatch wiring is broken on this host. See
[`agents/test-automation-lead/AGENT.md` § How you dispatch a subagent
(host preflight)](agents/test-automation-lead/AGENT.md) and re-read
`.agents/team-comms.md` for the per-host invocation pattern. Re-run
the smoke until it passes before continuing.

### 5. Pilot one case end-to-end

Pick a case you already know passes manually. Keep it small — login,
a navigation, a simple form. The point is to prove the pipeline, not
the app.

The full slot-by-slot routing flow lives in test-automation-lead —
[`agents/test-automation-lead/AGENT.md` § The pipeline](agents/test-automation-lead/AGENT.md).
The IC-facing process for each slot (analyst six-phase loop, implementer
six-phase loop, AFS rules, no-defect-masking, run-report template) is in
[`skills/test-automation-workflow/SKILL.md`](skills/test-automation-workflow/SKILL.md).
Shape:

1. **Analyst (qa-engineer + `test-case-analysis`)** executes the
   case, emits an AFS at
   `test-specs/<feature>/l<pri>_<slug>_<tms-id>.md`, returns a status.
2. **Gate on status** — only `ready-for-automation` advances. Fix
   `blocked` / `defect-found` / `un-automatable` upstream.
3. **Implementer (test-automation-engineer)** reads the AFS, writes
   the test in the existing framework, runs it locally and in CI,
   opens a PR, back-writes the TMS execution.
4. **Reviewer (qa-engineer, fresh session, + `code-review` skill)**
   checks assertions, selectors, defect-masking, cleanup. Reports
   with file:line refs.
5. **test-automation-lead merges** per `.agents/profile.md` § Automation PR policy
   (`auto-merge` / `human-approved` / `manual`).

### 6. Scale up

Once one case works end-to-end, batch is safe. Parallelism and
serialization rules (page-object collisions, independent-surface
parallelism, reviewer batching): [`agents/test-automation-lead/AGENT.md` § Batching](agents/test-automation-lead/AGENT.md) and
[`skills/test-automation-workflow/references/commands.md`](skills/test-automation-workflow/references/commands.md)
for host-specific sub-agent spawning recipes.

---

## Greenfield

You have no existing test framework. sdlc-skills doesn't bootstrap
one unilaterally — that's an architectural decision. **`test-automation-lead`
(test-automation-lead) owns it.**

1. **Install** with the test-automation roster — make sure
   `test-automation-lead` is included.
2. **Seed via scout** with `TMS: markdown` and `Automation PR base:
   main` (adjust later). Skip framework-specific fields; scout writes
   a stub `.agents/testing.md` with a note that the framework isn't
   picked yet.
3. **Launch `test-automation-lead`** with the `test-automation-workflow`
   skill (it's already in test-automation-lead's frontmatter — preloaded). Hand it:

   > Bootstrap a test-automation scaffold for this empty repo. Pick
   > the framework per the project's primary language per
   > [`skills/test-automation-workflow/references/framework-scaffold.md`](skills/test-automation-workflow/references/framework-scaffold.md).
   > Define page-object style, fixture pattern, naming, run command,
   > and CI command. Write the chosen conventions into
   > `.agents/testing.md`. Then dispatch `test-automation-engineer` to
   > create the initial config files + one smoke test proving the
   > scaffold works.

4. **test-automation-lead dispatches `test-automation-engineer`** (test-automation-engineer) with the scaffold
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
[`agents/test-automation-lead/AGENT.md` § Framework Architecture](agents/test-automation-lead/AGENT.md).

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote
  directories instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`. See
  [README.md](README.md) for `--soul` modes.
- **qa-engineer returns `ready-for-automation` with a sparse selector
  table** → she skipped exploration. Re-run with: *"Execute every
  step via playwright-testing or browser-verify MCP tools before
  writing the AFS — do not author from the TMS case description
  alone."*
- **test-automation-engineer generates off-style tests** → `.agents/testing.md` is
  misleading him. Fix it by hand (framework version, page-object
  convention, run command); ask test-automation-engineer to `--update` the spec file.
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

General update / sync notes live in [MAINTENANCE.md](MAINTENANCE.md). One
flow specific to the test-automation roster matters often enough to put
inline:

### Adding `test-automation-lead` to an existing install

If you onboarded before test-automation-lead existed (or you originally installed only PM
and now want the TA pipeline), pull just test-automation-lead and its skills:

```bash
npx github:arozumenko/sdlc-skills init --update \
  --agents test-automation-lead \
  --skills test-automation-workflow,test-case-analysis,code-review,completing-a-task,issue-tracking,atlassian-content
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
│   ├── team-comms.md / profile.md
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
