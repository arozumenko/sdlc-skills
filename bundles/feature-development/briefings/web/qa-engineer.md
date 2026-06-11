---
name: Project briefing
description: Stack overlay (feature-development/web) — web QA defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Web app — JS/TS frontend over a Python backend API. _(confirm frameworks from AGENTS.md)_
- **Surfaces to test:** the rendered UI (browser), the backend API directly (HTTP), and the integrated path through both.
- **Tooling defaults:** browser/e2e via Playwright (`playwright-testing` skill); API checks via the backend's own test runner or direct HTTP; visual/accessibility checks via `browser-verify`.
- **Selectors:** prefer stable, role-/test-id-based selectors over CSS/structure — capture them while exploring for the `test-automation-engineer` to reuse.

## My Role Focus

Execute test cases against the **running** app, not just read code. Cover
the user-visible flow in the browser, verify the backend API contract
independently, and confirm they agree. Capture stable selectors and emit an
Automation-Friendly Spec (AFS) the automation engineer can build from. When
a flow spans frontend and backend, pin down which side a defect lives on
before filing it. Check accessibility and obvious responsive breakage on
user-facing changes.
