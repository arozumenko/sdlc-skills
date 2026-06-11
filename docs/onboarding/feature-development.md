# Feature Development — Onboarding

The `feature-development` bundle drops a **cross-platform product team** into a
repo: a BA, a PM orchestrator, a tech-lead, a QA engineer, scout, and whichever
developer roles you pick (Python, JS/TS, iOS, test-automation). This guide takes
you from "I want a delivery team here" to "the team is shipping features."

For the pipeline picture, roster, and overlay model, read the bundle README
first — this guide assumes it and focuses on **adoption**:
[`bundles/feature-development/README.md`](../../bundles/feature-development/README.md).

**Pick your path:**

- [Existing project](#existing-project) — a codebase already exists; you're
  adding the team to it.
- [Greenfield](#greenfield) — a new or near-empty repo.
- [Hybrid](#hybrid--add-the-test-automation-pipeline) — run the delivery team
  *and* the dedicated test-automation pipeline side by side.

## The team, one picture

```
You → ba (story) → project-manager (routes) → tech-lead (decomposes)
        → dev role(s) implement (TDD) → qa-engineer verifies → project-manager merges
```

| Slot | Agent | Persona | Job |
|---|---|---|---|
| Onboarding | `scout` | Kit | Seeds `AGENTS.md` + `.agents/` from the repo |
| Requirements | `ba` | Alex | Turns asks into user stories + acceptance criteria |
| Orchestrator | `project-manager` | Max | Routes tasks, tracks state, owns the merge gate |
| Decomposition | `tech-lead` | Rio | Breaks stories into technical tasks; owns interfaces |
| Implementation | `python-dev` / `js-dev` / `ios-dev` / `test-automation-engineer` | Py / Jay / Io / Axel | Build the change in their stack, with tests |
| Verification | `qa-engineer` | Sage | Tests PRs, reproduces bugs, runs e2e |

`project-manager` is the **top-level orchestrator you launch directly**. The
core `tech-lead` and `qa-engineer` auto-tune to the platforms your dev-role
selection spans (web, iOS, or both) via the bundle's overlay model — see
[`bundles/SPEC.md`](../../bundles/SPEC.md).

---

## Prerequisites

```bash
node --version                       # Node 18+ (for the npx installer)
gh --version && gh auth status       # gh CLI for branch/PR creation
git rev-parse --is-inside-work-tree  # inside a git repo
```

Per-stack tooling — only what your selected dev roles need:

| Role | Needs |
|---|---|
| `python-dev` | Python 3.11+, the project's venv/uv toolchain (FastAPI / FastMCP focus) |
| `js-dev` | Node + the project package manager (npm / pnpm / yarn); React focus |
| `test-automation-engineer` | A Playwright-capable environment + the **Playwright MCP** server wired into your host |
| `ios-dev` | macOS + Xcode toolchain (`xcodebuild`, a scheme); device automation adds Appium |

Your host can be Claude Code, Cursor, Windsurf, or GitHub Copilot CLI. The
bundle install (`--bundle`) currently targets **Claude Code**; other hosts use
the manual `--agents` form below until the bundle's `targets:` list expands.
Host-specific launch syntax and install flags:
[README.md](../../README.md).

---

## Existing project

You have a working codebase and want the delivery team to start shipping into it.

### 1. Install the bundle

```bash
cd /path/to/your-repo
npx github:arozumenko/sdlc-skills init --bundle feature-development
```

The installer always sets up the **core roles** (`scout`, `ba`,
`project-manager`, `tech-lead`, `qa-engineer`) and shows a checklist of
**developer roles** to add. Pick the subset your stack needs — e.g. a Python
backend dev + a JS frontend dev, or just `ios-dev`.

- `--yes` (or a non-interactive shell) installs **all** developer roles.
- `--agents python-dev,js-dev` selects a subset non-interactively.

Picking any **web** role (`python-dev` / `js-dev` / `test-automation-engineer`)
activates the web briefings + skills for `tech-lead` and `qa-engineer`; picking
`ios-dev` activates the iOS ones. Pick both platforms and the shared roles get
the **superset** (e.g. `qa-engineer` keeps Playwright *and* gains the iOS
testing skills).

For Copilot / Cursor / Windsurf, use the manual form and swap `--target`:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,ba,project-manager,tech-lead,qa-engineer,python-dev,js-dev \
  --yes
```

> **Heads-up on the roster.** If you skip a dev role the work needs, scout
> substitutes the closest installed agent and records a fallback-tier warning in
> `.agents/role-overrides.md`. The team still runs, but a generic dev filling a
> stack-specific slot ships less idiomatic code — install the dedicated role
> when you can.

### 2. Seed via scout

Launch scout and paste a prompt like the one below. Scout already carries the
`seeding-a-project` skill; you supply only project-specific inputs:

```
Onboard this repo for feature development. Load the seeding-a-project skill.
DO NOT scaffold or rewrite app code — discover and document what's there.

Host: <Claude Code | GitHub Copilot CLI | Cursor | Windsurf>

## Project systems
Issue tracker:      <github-issues | jira | gitlab-issues | azure-boards | linear | none | ASK>
Tracker key:        <org/repo or PROJ key | ASK>
Knowledge base:     <confluence | notion | obsidian | github-wiki | readme-only | none | ASK>
PR base branch:     <main | develop | ASK>
Merge policy:       <auto-merge | human-approved | manual | ASK>
Merge strategy:     <squash | rebase | merge | ASK>
```

Scout writes `.agents/architecture.md`, `.agents/workflow.md`,
`.agents/profile.md`, `.agents/testing.md`, and `.agents/team-comms.md`, plus a
per-role briefing under `.agents/memory/<role>/`. Full procedure:
[`seeding-a-project/SKILL.md`](../../bundles/feature-development/skills/seeding-a-project/SKILL.md).

**After scout completes, review `.agents/architecture.md` and
`.agents/testing.md`.** If the stack, build command, test command, or the
API-contract seam is wrong, fix it by hand — every dev role's output quality is
downstream of these files.

### 3. Smoke-test PM dispatch (30 seconds)

Before routing real work, prove that `project-manager` actually **dispatches** a
subagent on this host rather than narrating that it would. Launch
`project-manager` and hand it:

> Smoke-test the routing wiring. Dispatch a one-line task to `tech-lead` asking
> it to read the first two lines of `.agents/architecture.md` and return them
> verbatim. Do not read the file yourself.

**Pass:** PM's reply contains an actual subagent **tool call** for this host (a
Claude `Agent(...)` or a Copilot `runSubagent(...)`), and tech-lead returns the
real two lines. **Fail:** prose like "I've routed this to tech-lead" with no
tool call — the subagent never spawned. Re-check `.agents/team-comms.md` for the
per-host invocation pattern and re-run until it passes.

### 4. Pilot one story end-to-end

Pick a small, well-understood change (a field addition, a small endpoint, a UI
tweak). The point is to prove the pipeline, not the feature.

1. **`ba`** turns the ask into a user story with acceptance criteria.
2. **`project-manager`** routes it: tech-lead decomposes, then the right dev
   role(s) implement.
3. **dev role(s)** implement with TDD — backend and frontend stay aligned on the
   API contract (a contract change is two-sided and isn't done until both sides
   are updated). See
   [`instructions.md`](../../bundles/feature-development/instructions.md).
4. **`qa-engineer`** verifies the PR — reproduces, runs e2e where relevant,
   reports with file:line refs.
5. **`project-manager` merges** per `.agents/profile.md`'s merge policy.

**Definition of done is team-wide:** the change builds, its tests pass, and —
for web — the affected side of the API contract is consistent and user-facing
flows are green e2e; for iOS — UI changes are verified in a simulator/preview
and concurrency is race-free. "I wrote the code" is not done.

---

## Greenfield

A new or near-empty repo. The flow is the same as
[Existing project](#existing-project) with two adjustments:

1. **Install** the bundle with the dev roles your product will need from the
   start (you can add more later with `--update --agents <role>`).
2. **Seed via scout** with `PR base branch: main`. Scout writes stub
   `.agents/architecture.md` / `.agents/testing.md` noting the stack isn't built
   yet; fill in the intended stack, build command, and test command so the dev
   roles have conventions to honor from the first commit.
3. **Have `tech-lead` establish the skeleton** before feature work — project
   layout, the API-contract seam (for web), the test harness — then drive the
   normal `ba → project-manager → dev → qa-engineer` loop.

Expect the first couple of changes to feel thin on "follow existing patterns"
guidance — there are no neighbors to mirror yet. That resolves once a few
features have shipped and a body of convention exists.

---

## Hybrid — add the test-automation pipeline

When a project does both feature delivery **and** dedicated TMS-driven test
automation, run the `feature-development` team alongside the `test-automation`
pipeline. `project-manager` (Max) and `test-automation-lead` (Tal) coexist as
**peers**, not parent/child:

- **PM owns feature delivery** — stories, dev routing, the feature merge gate.
- **Tal owns the automation pipeline** — analyst → implementer → reviewer, the
  automation merge gate, and test-framework architecture.
- PM points test-automation traffic at Tal via a **user-readable prompt**, not a
  subagent dispatch.

Install both bundles into the same repo (run each `--bundle` once), or install
the combined agent set manually:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,project-manager,ba,tech-lead,qa-engineer,python-dev,js-dev,test-automation-lead,test-automation-engineer \
  --yes
```

Then seed once with scout (it writes both the feature-dev and the
test-automation config), and follow the
[test-automation onboarding guide](test-automation.md) for the pipeline half
(`.agents/test-automation.yaml`, the single-case pilot, scale-up).

---

## Project systems — where state lives

Scout-seeded context every role reads on each dispatch (re-injected by the
context hooks, so it survives `/clear`, compaction, and resume):

| File | Owner | What it holds |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | scout | Project context; the team conventions block is spliced under `<!-- BUNDLE:feature-development -->` |
| `.agents/architecture.md` | scout | Stack, layout, the API-contract seam |
| `.agents/testing.md` | scout | Frameworks, build + test + CI commands |
| `.agents/workflow.md` | scout | Branching, PR, merge conventions |
| `.agents/profile.md` | scout | Merge policy, environments, scope boundaries |
| `.agents/team-comms.md` | scout | Per-host dispatch syntax + persona assignment |
| `.agents/memory/<role>/` | each role | Per-role persistent memory + briefing |

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote directories
  instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`. See
  [README.md](../../README.md) for `--soul` modes.
- **PM narrates instead of dispatching** → re-run the [dispatch
  smoke](#3-smoke-test-pm-dispatch-30-seconds); the host wiring in
  `.agents/team-comms.md` is wrong or the host needs the right invocation syntax.
- **A dev ships off-stack code** → `.agents/architecture.md` / `.agents/testing.md`
  is misleading it (wrong framework, build command, or convention). Fix by hand;
  the dev re-reads it on the next dispatch.
- **Backend and frontend drift on the API contract** → the change was treated as
  one-sided. A contract change isn't done until the consuming side is updated or
  explicitly versioned — flag the counterpart role.
- **`qa-engineer` lacks the right test skills for your stack** → confirm the dev
  roles you installed activated the right overlay (web vs iOS). Re-run
  `--update` with the missing role to pick up the superset.
- **MCP auth errors** → token rotated / scope missing. Fix the MCP server config
  in the host (`~/.claude.json`, `.mcp.json`, Copilot settings), never in the
  project repo, then restart the session.

---

## Maintenance

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md).
Re-run the same `init` command with `--update` to pull upstream fixes; add a dev
role to an existing install with:

```bash
npx github:arozumenko/sdlc-skills init --update --bundle feature-development --agents ios-dev
```

Then re-run scout so its frontmatter audit verifies the context wiring for the
new role (and so the shared roles pick up the new platform's overlay).

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # scout-generated project context
├── .agents/
│   ├── architecture.md / testing.md  # scout-owned content docs
│   ├── workflow.md / profile.md / team-comms.md
│   └── memory/<role>/                # per-role persistent memory + briefing
├── src/ app/ …                       # YOUR application code (untouched)
└── .claude/agents/<role>/            # or .github/agents/<role>.agent.md per host
```

Only `.agents/` is owned by the sdlc-skills team. Your application code, build
config, and CI stay untouched — the team works *through* them, not over them.
