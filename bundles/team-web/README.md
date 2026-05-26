# Web Team

A fullstack web delivery team: **JS/TS frontend** talking to a **Python
backend** over an HTTP API, with QA, automation, and core coordination
roles.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle team-web
```

Installs the agents below into your IDE (`.claude/`, `.cursor/`, …), pulls
each agent's skills, seeds per-role stack briefings into
`.agents/memory/<role>/`, and splices the team conventions into
`AGENTS.md` / `CLAUDE.md`.

## Roster

| Role | Alias | Group | Does |
|---|---|---|---|
| `scout` | kit | core | Onboards the repo — finds the FE/BE split, the API contract, and per-side build/test commands |
| `ba` | alex | core | Turns requests into clear requirements and acceptance criteria |
| `tech-lead` | rio | core | Owns architecture and the frontend↔backend API contract |
| `project-manager` | max | core | Sequences work, tracks issues, coordinates the team |
| `python-dev` | py | dev | **Backend** — FastAPI services + FastMCP servers (async Python, Pydantic), data, business logic, API |
| `js-dev` | jay | dev | **Frontend** — JS/TS SPA/SSR, UI, client state, API client |
| `qa-engineer` | sage | qa | Executes tests against the running app + API; writes Automation-Friendly Specs |
| `test-automation-engineer` | axel | qa | Durable Playwright e2e through the real stack |

## How this team works

The **API contract is the seam.** Frontend and backend integrate through
the API schema; contract changes are two-sided and coordinated by the
tech-lead. Business logic lives in the backend; the frontend owns UI and
client state only. See [`instructions.md`](instructions.md) for the full
working agreements (installed into your project's `AGENTS.md`).

## What this bundle adds

- **Agents + skills** — the 8 roles above and their declared skills.
- **Instructions** — [`instructions.md`](instructions.md) → spliced into `AGENTS.md` / `CLAUDE.md`.
- **Briefings** — stack overlays in [`briefings/`](briefings/) → seeded into `.agents/memory/<role>/project_briefing.md` for `scout`, `tech-lead`, `python-dev`, `qa-engineer`, `test-automation-engineer` (scout refines them per project).
- **Skill overlays** — per-role capability tuning (fetched from `skills.json`): `fastapi` + `fastmcp-server` for `python-dev` and `tech-lead`; `vercel-react-best-practices` for `js-dev` and `tech-lead`.
- **Hooks** — _(none yet)_.

See [`bundle.json`](bundle.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how bundles are defined and installed.
