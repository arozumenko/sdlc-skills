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

## .octobots/profile.md Template

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
```

---

## .octobots/architecture.md Template

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

## .octobots/conventions.md Template

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

## .octobots/testing.md Template

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

## `.claude/memory/<role-id>.md` Template

Scout fills "Project Knowledge" and "My Role Focus" at seeding time.
The agent fills "Lessons Learned" and "Notes" during work sessions.

"My Role Focus" is not a template placeholder — scout writes it based on actual
understanding of what this role does on this specific project.

```markdown
# Memory — [role-id]

Persistent learnings from past conversations. Read this before starting work.

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
   Run from Godot editor or CLI. Phase 1 DoD checklist is in .octobots/testing.md."

- project-manager on any project:
  "Coordinate Phase 1 work: [N] issues, deadline [date]. Unblock: [first issue]."
]

## Lessons Learned

[Agent fills this during sessions — non-obvious discoveries, decisions made, gotchas.]

## Notes

[Agent fills this during sessions — anything worth remembering across conversations.]
```
