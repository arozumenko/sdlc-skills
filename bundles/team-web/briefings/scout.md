---
name: Project briefing
description: Stack overlay (team-web) — fullstack web detection hints; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Fullstack web — JS/TS frontend + Python backend over an HTTP API. _(confirm exact frameworks when you explore)_
- **Detect frontend:** `package.json` (scripts, deps), lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`), framework markers (`next.config.*`, `vite.config.*`, `angular.json`, `svelte.config.*`), `tsconfig.json` for TS.
- **Detect backend:** `pyproject.toml` / `requirements.txt` / `setup.cfg`, framework markers (`manage.py` → Django, `main.py` + `fastapi` dep, Flask app factory), `.venv/` / `.python-version`.
- **The API seam:** look for the contract — OpenAPI/Swagger spec, a generated client, or hand-written API modules. Record where it lives; it's the integration point between the two devs.
- **Run/test commands:** capture both sides separately (e.g. `npm run dev` / `pytest`, `npm test` / `npm run build`) plus any combined dev script or docker-compose.

## My Role Focus

Onboard a two-language repo: identify the frontend/backend split (often
`frontend/` + `backend/`, or separate repos), the API contract between
them, and the build/test command for **each** side. In `AGENTS.md`, keep
frontend and backend conventions clearly separated so `js-dev` and
`python-dev` each find their own stack's rules. Flag if the API contract
is undocumented — that's the team's highest-risk seam.
