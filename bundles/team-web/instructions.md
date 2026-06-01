# Web Team — shared conventions

This is a **fullstack web team**: a JS/TS frontend talking to a Python
backend over an HTTP API. These are team-wide defaults — scout refines
them per project in `AGENTS.md`, which always wins over this file.

## Architecture shape

- **Frontend** (`js-dev`): JS/TS SPA or SSR app. Owns UI, client state,
  and calls to the backend API. Does not reach into the database.
- **Backend** (`python-dev`): **FastAPI** HTTP service, plus **FastMCP**
  for any MCP servers — modern async Python, Pydantic at the boundaries.
  (Not Django, not Flask — if scout finds those on a project, it's a
  deviation to flag.) Owns data, business logic, and the API contract the
  frontend consumes.
- **The contract is the seam.** Frontend and backend integrate through the
  API schema (FastAPI's OpenAPI / a typed client). Changes to the contract
  are a tech-lead concern and need both devs aligned before merge.

## Cross-stack working agreements

- **API changes are two-sided.** A backend endpoint change that the
  frontend consumes is not done until the frontend is updated (or
  explicitly versioned/back-compat). Flag the counterpart role.
- **Types at the boundary.** Prefer a generated or shared type definition
  for request/response shapes over hand-copied interfaces.
- **Tests own the contract.** Backend tests assert the API; frontend tests
  mock it against the same shapes. `test-automation-engineer` covers the
  end-to-end path through the real stack (Playwright).
- **Env & secrets** never land in the frontend bundle. Backend owns
  secrets; frontend gets only public config.

## Definition of done (team-wide)

A change is done when it compiles, its tests pass, the affected side of the
API contract is consistent, and — for user-facing flows — the e2e path is
green. For changed user-facing pages, a `quality-architect` shift-left audit
(PM-dispatched) leaves **no open p0/p1 dimensional findings**
(accessibility / performance / privacy / responsive / UX). "I wrote the
code" is not done.
