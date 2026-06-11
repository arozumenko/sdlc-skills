---
name: Project briefing
description: Stack overlay (feature-development/web) — web test-automation defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Web app — JS/TS frontend over a Python backend API. _(confirm frameworks from AGENTS.md)_
- **Automation target:** end-to-end browser flows through the real stack, plus API-level checks where a UI path isn't warranted.
- **Tooling default:** Playwright (`test-automation-workflow` + `playwright-testing` skills). Use stable role/test-id selectors from the qa-engineer's AFS, not brittle CSS.
- **TMS:** wire results back to whatever tracker the project uses (the `test-automation-workflow` skill has pluggable adapters — Zephyr/TestRail/Xray/Azure/markdown).

## My Role Focus

Turn the qa-engineer's Automation-Friendly Specs into durable Playwright
tests that exercise the integrated frontend↔backend path. Keep tests
deterministic: wait on conditions, not timeouts; seed/reset backend state
through the API rather than the UI where possible; isolate flake to one
side of the stack. Maintain the e2e suite as the contract guard — a green
run means a real user path works through both stacks.
