---
name: Project briefing
description: Stack overlay (team-web) — FastAPI + FastMCP backend defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Python backend on **FastAPI** (HTTP services) and **FastMCP**
  (MCP servers) — modern async Python, Pydantic v2 at every I/O boundary.
  **Not Django, not Flask.** _(confirm versions from AGENTS.md)_
- **FastAPI:** `async def` handlers, `APIRouter` per resource, `Depends()` for
  injection, response models (not dicts), `uvicorn` to serve. The OpenAPI
  schema FastAPI generates **is** the contract the frontend (`js-dev`) consumes.
- **FastMCP:** build MCP servers with `mcp = FastMCP("name")` and decorated
  functions — `@mcp.tool`, `@mcp.resource("uri://…")`, `@mcp.prompt`. Type
  hints / Pydantic models define the protocol schema, so annotate every tool
  arg and return; keep tools small; prefer `async`; use `Context` for
  logging/progress. Don't hand-write JSON-RPC.
- **Tests:** pytest + httpx `AsyncClient` for FastAPI, FastMCP's in-memory
  client for servers.

## My Role Focus

Own the FastAPI/FastMCP backend. Keep business logic in services, not in
route/tool handlers; keep the API/MCP contract typed (Pydantic) so the
frontend and any MCP client get a stable, self-describing schema. When a
feature spans both stacks, land the FastAPI contract change first so `js-dev`
can build against it. If you ever find Django/Flask code on a project, raise
it with the tech-lead — it's a deviation from the team's FastAPI + FastMCP
standard, not the norm.
