# Web QA Team — shared conventions

This is a **standalone manual-QA team** for web apps. These are team-wide
defaults; scout (if present) or setup refines them per project in `AGENTS.md`,
which always wins over this file.

## Pipeline

Each stage hands off to the next; invoke agents in order:

- **`setup`** — run once to onboard the app: explores the UI, records its
  structure and flows, and writes `.agents/web-qa/app_profile.md`.
- **`tc-writer`** — takes a feature or flow description and writes formatted
  test cases under `tasks/<suite>/TC-NNN_<slug>.md`.
- **`orchestrator`** — run as the **active agent** (it uses the Agent tool
  to spawn sub-runs). Discovers the suite to execute, dispatches one
  `executor` sub-run per test case, then triggers `reporter`.
- **`executor`** — receives a single `TC-NNN` file path and a `base_url`;
  runs the case live via Playwright MCP; emits a structured JSON result.
- **`reporter`** — collects executor results and writes the run report to
  `reports/RUN-YYYY-MM-DD-NNN.md`, linking any screenshots.

## Project layout

```
tasks/<suite>/TC-NNN_<slug>.md     test cases (authored by tc-writer)
reports/RUN-YYYY-MM-DD-NNN.md     run reports (written by reporter)
reports/screenshots/               evidence screenshots from executor runs
.agents/web-qa/knowledge/          seeded reference docs (format, template, …)
.agents/web-qa/app_profile.md      app map written by setup
```

## `{{base_url}}` rule

All test-case URLs are written as `{{base_url}}/path`. The executor substitutes
`{{base_url}}` with the real base URL at run time, keeping cases
environment-agnostic (dev / staging / prod).

## Evidence before PASS

The executor must capture a final Playwright snapshot confirming the
**Expected Final State** described in the test case before recording a PASS.
A PASS without a confirming snapshot is invalid.

## Orchestrator is the active agent

Run `orchestrator` directly (not via another agent). It owns the run loop
and dispatches `executor` sub-runs via the Agent tool — do not invoke
`executor` manually when an orchestrated suite run is in progress.
