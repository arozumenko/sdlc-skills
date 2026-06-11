---
name: Project briefing
description: Stack overlay (feature-development/web) — fullstack web architecture defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** JS/TS frontend + Python backend, integrated over an HTTP API. _(confirm frameworks from AGENTS.md)_
- **The seam you own:** the API contract between frontend and backend. Schema changes ripple to both sides — coordinate `js-dev` and `python-dev` before merging contract changes.
- **Typical layering:** frontend (UI + client state) → API client → backend (routes → services → data). Keep business logic in the backend; the frontend should not encode domain rules it can't enforce.

## My Role Focus

Hold the line on the **frontend/backend contract**. When a feature spans
both, decompose it into a backend task (endpoint + tests + contract update)
and a frontend task (consume + render + tests) and sequence them so the
contract lands first. Watch for: domain logic leaking into the frontend,
the two sides drifting on request/response shapes, and auth/secrets
crossing into the client bundle. Prefer a generated/shared type for the
boundary over duplicated interfaces. Review both stacks against their own
conventions — don't apply Python idioms to TS or vice versa.
