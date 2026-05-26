# Project Seeder Templates

## CLAUDE.md Template

Auto-loaded by Claude Code at session start. **Keep under 80 lines.** Every agent reads this on every session — be ruthlessly concise.

```markdown
# Project Name

One sentence: what it does and who it's for.

## Stack

- **Language/Runtime:** Python 3.12 / Node 20 / etc.
- **Framework:** FastAPI / Next.js / Django / etc.
- **Database:** PostgreSQL / SQLite / etc.
- **Key tools:** [only what every dev touches daily]

## Essential Commands

```bash
# Install
[exact command]

# Dev server
[exact command]

# Tests
[exact command]

# Lint / type-check
[exact command]
```

## Critical Conventions

<!-- Only the rules that will cause breakage or pain if ignored -->
- [e.g. "Always run migrations before starting: `alembic upgrade head`"]
- [e.g. "Use `pnpm`, not npm — lockfile is pnpm-lock.yaml"]
- [e.g. "Feature branches only — never commit directly to main"]

## Key Paths

- Entry point: `src/main.py` / `app/page.tsx` / etc.
- Tests: `tests/` — run with `[command]`
- Config: `.env` (copy from `.env.example`)
- [Any other path every dev needs to know]

## Full Reference

See `AGENTS.md` for complete stack details, conventions, CI/CD, and architecture.
```

---

## AGENTS.md Template

```markdown
# Project Name

One-paragraph description: what it does, who it's for, what it's built with.

## Tech Stack

- **Language:** Python 3.12 / TypeScript 5.x / etc.
- **Framework:** FastAPI / Next.js / Django / Express / etc.
- **Database:** PostgreSQL / MongoDB / SQLite / etc.
- **Cache:** Redis / Memcached / none
- **Infra:** Docker / Kubernetes / Vercel / etc.
- **CI:** GitHub Actions / GitLab CI / Jenkins

## Repository Structure

<!-- Annotated directory tree, depth 2-3 -->
```
src/
├── api/            ← Route handlers
├── services/       ← Business logic
├── models/         ← Database models
├── utils/          ← Shared utilities
tests/
├── unit/           ← Fast, no external deps
├── integration/    ← Requires database
docker/
├── Dockerfile
├── docker-compose.yml
```

## Build & Run

```bash
# Install dependencies
[exact command from project]

# Run in development
[exact command]

# Run tests
[exact command]

# Lint / format
[exact command]

# Build for production
[exact command]
```

## Environment Setup

Required environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@localhost/db` |
| `SECRET_KEY` | JWT signing | random string |
| `API_KEY` | External service | from provider dashboard |

Setup: `cp .env.example .env` and fill in values.

## Coding Conventions

<!-- Only include patterns actually detected in the codebase -->

- **Naming:** snake_case for files/vars, PascalCase for classes
- **Imports:** stdlib → third-party → local, absolute imports
- **Error handling:** Custom exception classes in `src/exceptions.py`
- **Code org:** Thin routes → service layer → repository → database
- **Types:** Strict mode, all public functions typed
- **Comments:** Docstrings on public APIs, no inline obvious comments

## Testing

- **Framework:** pytest / jest / vitest
- **Run:** `[exact command]`
- **Structure:** `tests/` mirrors `src/`, one test file per module
- **Fixtures:** Shared in `conftest.py` / `__tests__/setup.ts`
- **Coverage:** `[command]` (currently at X%)

## CI/CD

- **Trigger:** Push to main, PRs
- **Pipeline:** lint → type-check → test → build → deploy
- **Config:** `.github/workflows/ci.yml`

## Notes

<!-- Non-obvious things: why a dep is pinned, known tech debt, gotchas -->
- `libfoo` pinned to 2.3.1 due to breaking change in 2.4
- Database migrations must run before starting the app
- The `/legacy/` directory is deprecated but still serves traffic
```

---

## .agents/profile.md Template

```markdown
---
project: my-project
team: platform
issue-tracker: https://github.com/org/repo/issues
default-branch: main
languages: [python]
---

# My Project

Brief description.

## Tech Stack
- Primary framework + version
- Database
- Key dependencies

## Build & Test
- Install: `command`
- Test: `command`
- Lint: `command`

## Conventions
- Top 3-5 conventions detected

## Deployment mode

_Detected during seeding-a-project Step 6.95._

- **Mode**: <standalone | octobots | taskbox>
- **Detected via**: <which signals present/absent>
- **Octobots-bracketed content stripped**: <yes | no>
- **Agent files touched**: <count>

## Project systems

_Captured during seeding-a-project Step 0.7 from operator input (or
`Unconfirmed` when the operator didn't know yet — fill before the
first test-case-analysis run)._

### Issue tracker
- **System**: <github-issues | jira | gitlab-issues | azure-boards | linear | none>
- **Project / board key**: <e.g. SCRUM, owner/repo, org/project>
- **URL**: <base URL>

### Test Management System (TMS)
- **System**: <zephyr-scale | testrail | xray | azure-test-plans | markdown | none>
- **Project key**: <SCRUM / QA-PROJECT / ...>
- **Configured in**: `.agents/test-automation.yaml` (adapter + transport + credentials)

### Knowledge base
- **System**: <confluence | notion | obsidian | github-wiki | readme-only | none>
- **Space / database**: <ENG / QA-KB / ...>
- **URL**: <base URL>

### Bug filing (when QA discovers a defect during test-case-analysis)

A ticket is always filed — every finding lands in a tracker so
nothing slips through. The following fields configure *where* and
whether lightweight clarifications can bundle.

- **Style**: <github-issue | story-subtask | separate-ticket>
  - `github-issue` — open a standalone issue in the main issue tracker
  - `story-subtask` — create a sub-task linked to the originating
    Jira/Azure story (the one the TMS case is linked to)
  - `separate-ticket` — file in a dedicated QA/bugs tracker different
    from the main development tracker
- **Target project/board**: <leave blank to use main issue tracker;
  set when bugs go to a dedicated QA sub-project, e.g. `QA-BUGS`>
- **Bundling policy**: <strict-per-bug | bundle-per-case>
  - `strict-per-bug` *(default)* — every finding gets its own ticket.
  - `bundle-per-case` — lightweight clarifications / questions about
    the same TMS case may be consolidated into one umbrella ticket
    (new findings added as comments on the existing per-case ticket).
    Real defects (reproducible bugs, blockers) still get their own
    tickets regardless — bundling only applies to the clarification-
    weight tier. The bundling decision is Sage's — she classifies
    each finding at filing time.
- **Link originating case**: <yes | no> — should the ticket reference
  the TMS case ID that surfaced it?

### Test case storage
- **Source of truth**: <tms | markdown | both-synced | none>
  - `tms` — cases live in the TMS only
  - `markdown` — cases live as files under `test-specs/`
  - `both-synced` — TMS is authoritative; markdown mirrors for
    git-tracking / offline access
- **Markdown location**: `test-specs/` (or project-specific path)

### Automation PR policy

_Where automation PRs target, and who merges them. Read by PM
(merge gate) and by Axel (branch base)._

- **Base branch for automation PRs**: <main | master | develop |
  feature/<name> | ASK>
  - The branch automation feature branches are cut FROM and
    target PR AGAINST. Defaults to the project's
    `default-branch` from the frontmatter above unless the team
    uses a dedicated line for test-automation work (common in
    pilot / testing mode — e.g. `feature/test-automation-pilot`).
- **Merge policy**: <auto-merge | human-approved | manual>
  - `auto-merge` *(default)* — PM merges once review + CI pass.
    Closes the loop autonomously; best for mature pipelines.
  - `human-approved` — PM **waits for an explicit human approval
    signal** on the PR (e.g. the `human-approved` label, or a
    reviewer from a designated human set) before merging. PM
    still owns the merge — it just doesn't fire on review-bot
    approval alone.
  - `manual` — PM never merges. Summarizes the green PR and
    hands back to the operator. Right when the project is in
    early pilot mode, or base branch is a protected release
    line.
- **Squash / rebase / merge commit**: <squash | rebase | merge>
  — optional; defaults to `squash`. Override when the project's
  branch-protection rules require a different strategy.
```

---

## .agents/workflow.md Template

Generated by Step 0.5 (PR sampling). Describes **how the team
actually works** — roles, review cadence, branch/commit conventions,
how tests ship relative to code — all derived from classifying +
sampling representative PRs, not inferred from static repo content.

If the repo has no merged PRs yet, write the "No PR history" stub at
the bottom instead of the full structure.

```markdown
# How This Team Works

_Derived from PR sampling on {YYYY-MM-DD}. Refresh when the team's
patterns shift (new leads, process changes, framework overhaul)._

## Git host

- **Host**: GitHub / GitLab / Bitbucket / Azure DevOps / Gitea / other
- **Remote URL pattern**: {e.g. `git@github.com:acme/repo.git`}
- **CLI of choice**: `gh` / `glab` / `bb` / `az repos` / `tea` / curl
- **Unit of change**: Pull Request (GitHub / Bitbucket / Gitea) /
  Merge Request (GitLab) / Pull Request in the Azure sense
- **Any host-specific conventions**: required approvers count,
  merge-queue integration, automerge labels, draft-PR workflow,
  squash-vs-rebase policy — whatever you observed

Downstream agents: use the CLI named above when opening PRs/MRs,
commenting, checking review status, etc. Do NOT assume `gh` —
always read this section first.

## PRs sampled

- Framework / infrastructure: #<n>, #<n>, #<n>
- Test implementation:        #<n>, #<n>, #<n>
- Bugfix + regression:         #<n>, #<n>
- Feature + tests:             #<n>, #<n>, #<n>
- Total merged PRs scanned: <N> (ignored <M> bot / docs / format-only)

## Team & roles

- **Who authors feature tests**: <roles / specific people, derived from
  author patterns on feature-PRs>
- **Who authors regression tests**: <same for bugfix-PRs>
- **Who owns framework / infra changes**: <same for infra PRs>
- **Review / approval gates**: <N reviewers required / specific approvers
  required for specific directories>

## Review gates

- Typical reviewer count: <N>
- Consistently-flagged review comments (from reading comment threads):
  - <pattern 1 — e.g. "no hardcoded selectors, use data-testid">
  - <pattern 2 — e.g. "page objects can't do assertions">
- Code-owner files / directories (from CODEOWNERS if present): <list>

## Branching & commits

- Branch naming: <e.g. `automation/<ticket>-<slug>`,
  `fix/<ticket>-<slug>`, feature branches via `feature/<name>`>
- Commit message style: <Conventional Commits? Plain? Ticket-prefixed?>
  - Example: <actual example from a recent PR>
- Ticket linking: <"Closes #NN" / "Fixes ABC-123" / inline body>

## Test delivery pattern

- Do tests ship **with** the feature PR or **separately** afterward?
  <evidence — cite specific PRs>
- Do bugfixes always include a regression test? <yes / sometimes / rarely>
- Typical test-PR size: <N files / N lines / one test case>

## CI gates

- Required checks that must pass: <list from CI config + observed in PRs>
- Required labels to merge: <if any>
- Auto-merge behavior: <if configured>

## Patterns observed in practice

- <How new page objects are added — evidence from a specific PR>
- <How new fixtures are added — evidence from a specific PR>
- <Any codified "don't do this" patterns from review comments>

## Evolution signals

_Framework / infrastructure change pace, from infra-PR cadence._

- Infra PRs per month (approximate): <N>
- Typical author of infra changes: <role / person>
- Last major framework change: PR #<n> — <one-sentence description>

## Unconfirmed

- <Anything PR sampling couldn't determine — flag for manual fill-in>
```

### No-PR-history stub

For a brand-new project with no merged PRs yet, write this minimal
version:

```markdown
# How This Team Works

_This project has no merged PR history yet, so scout couldn't sample
representative work. Re-run the scout survey once the first ~10 PRs
have landed — patterns only become visible at that point._

## Unconfirmed (everything — populate after first merges)

- Roles — who authors feature tests vs regression vs infra work
- Review cadence — reviewer counts, comment patterns
- Branch & commit conventions
- Test-delivery pattern — tests bundled with features or separate?
- CI gates
```

---

## .agents/architecture.md Template

```markdown
# Architecture

## System Overview

<!-- One paragraph: what the system does at a high level -->

## Components

| Component | Purpose | Tech | Port/Path |
|-----------|---------|------|-----------|
| API Gateway | Request routing, auth | FastAPI | :8000 |
| Worker | Background jobs | Celery | N/A |
| Frontend | User interface | Next.js | :3000 |
| Database | Persistence | PostgreSQL | :5432 |

## Data Flow

```
User → Frontend (Next.js) → API Gateway (FastAPI) → Database (PostgreSQL)
                                    ↓
                              Worker (Celery) → External APIs
```

## API Boundaries

### Internal APIs
- `POST /api/users` — Create user (auth required)
- `GET /api/users/:id` — Get user (auth required)

### External Dependencies
- **Stripe** — Payment processing (webhook at `/webhooks/stripe`)
- **SendGrid** — Email delivery

## Database

### Key Tables
| Table | Purpose | Key Relations |
|-------|---------|---------------|
| users | User accounts | has_many: orders |
| orders | Purchase records | belongs_to: users |

### Migrations
- Tool: Alembic / Prisma / Knex
- Run: `[command]`
- Location: `migrations/`
```

---

## .agents/conventions.md Template

```markdown
# Coding Conventions

Detected from codebase analysis. These are descriptive (what IS), not prescriptive.

## File Naming
- Source: `snake_case.py` / `camelCase.ts` / `PascalCase.tsx`
- Tests: `test_module.py` / `module.test.ts` / `module.spec.ts`
- Components: `ComponentName.tsx` / `ComponentName/index.tsx`

## Code Organization
- Routes/handlers: thin, delegate to services
- Services: business logic, no framework deps
- Models: data layer, ORM definitions
- Utils: shared helpers, no side effects

## Import Style
```python
# 1. stdlib
# 2. third-party
# 3. local (absolute imports)
```

## Error Handling
- Custom exceptions in `src/exceptions.py`
- Global error handler in middleware
- Specific catches only, no bare except

## Naming
- Variables: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Private: `_prefixed`

## Git
- Branch: `feat/`, `fix/`, `chore/`
- Commits: conventional commits / free-form
- PR: squash merge / merge commit
```

---

## .agents/testing.md Template

```markdown
# Test Infrastructure

## Framework
- **Unit/Integration:** pytest / jest / vitest
- **E2E:** Playwright / Cypress / none
- **API:** httpx / supertest / curl

## Commands
```bash
# All tests
[command]

# Unit only
[command]

# Integration (requires DB)
[command]

# E2E (requires running app)
[command]

# Coverage
[command]
```

## Structure
```
tests/
├── unit/              ← No external deps, fast
├── integration/       ← Real DB, slower
├── e2e/               ← Full stack, Playwright
├── conftest.py        ← Shared fixtures
└── fixtures/          ← Test data files
```

## Fixtures & Setup
- Database: [real / mocked / in-memory SQLite]
- Auth: [fixture / factory / skip]
- Test data: [factories / fixtures / inline]

## Patterns Detected
- Arrange-Act-Assert structure
- One test file per source module
- Shared fixtures in conftest.py
- Test markers: @pytest.mark.slow, @pytest.mark.integration

## CI Integration
- Tests run on: [push / PR / both]
- Config: `.github/workflows/test.yml`
- Timeout: [X minutes]
- Coverage threshold: [X% or none]

## Known Issues
- [Any flaky tests, slow tests, skip reasons]
```

---

## `.octobots/roles-manifest.yaml` Template

Source of truth for role configuration. Read by `octobots/scripts/check-spawn-ready.py`.
Update this file if roles change after initial seeding, then re-run the readiness check.

The `persona` field must match an alias registered in `scripts/roles.py` ROLE_ALIASES.
`check-spawn-ready.py` validates this automatically.

```yaml
# .octobots/roles-manifest.yaml
# Generated by scout during onboarding. Update if roles change.
seeded: YYYY-MM-DD
project_type: [godot-game | web-app | data-ml | mobile | rust-cli | library | other]

roles:
  project-manager:
    persona: Max
    description: "Coordination, milestone tracking"
    customized: false

  python-dev:
    persona: Py              # change if repurposed — must match ROLE_ALIASES
    description: "Python backend development"
    customized: false
    # If customized: true, add:
    # repurposed_for: "What this role does on this specific project"

  js-dev:
    persona: Jay
    description: "TypeScript/React frontend development"
    customized: false

  ba:
    persona: Alex
    description: "Business analysis — goals to user stories"
    customized: false

  tech-lead:
    persona: Rio
    description: "Technical decomposition and architecture"
    customized: false

  qa-engineer:
    persona: Sage
    description: "Testing and verification"
    customized: false

  scout:
    persona: Kit
    description: "Codebase exploration and project seeding"
    customized: false
```

---

## `.agents/memory/<role-id>/project_briefing.md` Template

Per-role briefing, seeded by scout as a `type: project` curated entry
conforming to the `memory` skill spec. Scout also appends one line to
`.agents/memory/<role-id>/MEMORY.md` pointing at `project_briefing.md`
(see "Index line" below).

"My Role Focus" is not a template placeholder — scout writes it based on
actual understanding of what this role does on this specific project.

```markdown
---
name: Project briefing
description: Scout-seeded project overview — stack, stage, key paths, and this role's focus
type: project
---

## Project Knowledge

- **Project:** [name — one sentence description]
- **Stack:** [engine / framework / primary language and version]
- **Stage:** [pre-init / alpha / active development / maintenance]
- **Key paths:** [entry point], [test dir], [config file]
- **Issue tracker:** [URL] — [N] open issues, Phase [N] due [date if known]
- **Design docs:** [location — GDD, spec, architecture doc, etc.]

## My Role Focus

[One paragraph specific to this role on this project. What does this role actually
do here? Examples:

- python-dev repurposed as Godot dev:
  "Write GDScript for game systems — state machines, combat, inventory. No Python.
   Engine binary at bin/Godot.app. GDD in gdd/ defines all systems."

- js-dev repurposed as Level Designer:
  "Design TileMap scenes and biome layouts in Godot scenes. No JS/TS.
   Level assets in assets/levels/. See gdd/world-design.md for biome specs."

- qa-engineer on a GUT project:
  "Tests use GUT framework (Godot addon, not installed yet — see issue #42).
   Run from Godot editor or CLI. Phase 1 DoD checklist is in .agents/testing.md."

- project-manager on any project:
  "Coordinate Phase 1 work: [N] issues, deadline [date]. Unblock: [first issue]."
]

## Known gotchas

[Things that would bite this role specifically — pinned versions, flaky
tests, files they must not touch, conventions that are non-obvious.]
```

### Index line

Add this single line to `.agents/memory/<role-id>/MEMORY.md` (creating the
file if it doesn't exist):

```markdown
# Memory index — [role-id]

- [Project briefing](project_briefing.md) — Scout-seeded project overview
```

The agent adds further curated entries (user preferences, feedback,
references, etc.) below during work sessions — same index, same spec.
