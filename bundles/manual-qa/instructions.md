# Web QA Team — shared conventions

This is a **standalone manual-QA team** for web apps. These are team-wide
defaults; scout (if present) or app-profiler refines them per project in `AGENTS.md`,
which always wins over this file.

## Pipeline

Onboard once with `app-profiler`, then drive `test-run-lead` — it is the
single orchestrator for a run and brings in the authoring/sizing agents when
the suite needs them. You can still invoke `test-sizer` or `test-author`
standalone for authoring work outside a run.

- **`app-profiler`** — run once to onboard the app: explores the UI, records its
  structure and flows, and writes `.agents/manual-qa/app_profile.md`.
- **`test-run-lead`** — the run orchestrator; run it as the **active agent**
  (it uses the Agent tool to spawn sub-runs). Assembles the suite first —
  dispatching **`test-author`** to write missing cases and **`test-sizer`** to
  size unsized ones, *when needed* — then dispatches one `test-runner` per
  case and triggers `test-reporter`.
- **`test-sizer`** — rates cases S/M/L for AI-agent execution cost: sizes rough
  descriptions before authoring (flagging Large ones to split) and scores
  existing TC files, writing `size:` into their frontmatter. Dispatched by the
  lead, or run standalone.
- **`test-author`** — takes a feature or flow description and writes formatted
  test cases under `tasks/<suite>/TC-NNN_<slug>.md`. Dispatched by the lead, or
  run standalone.
- **`test-runner`** — receives a single `TC-NNN` file path and a `base_url`;
  runs the case live via Playwright MCP; emits a structured JSON result.
- **`test-reporter`** — collects test-runner results and writes the run report to
  `reports/RUN-YYYY-MM-DD-NNN.md`, linking any screenshots.

## Project layout

```
tasks/<suite>/TC-NNN_<slug>.md     test cases (authored by test-author)
reports/RUN-YYYY-MM-DD-NNN.md     run reports (written by test-reporter)
reports/screenshots/               evidence screenshots from test-runner runs
.agents/manual-qa/knowledge/          seeded reference docs (format, template, …)
.agents/manual-qa/app_profile.md      app map written by app-profiler
```

## `{{base_url}}` rule

All test-case URLs are written as `{{base_url}}/path`. The test-runner substitutes
`{{base_url}}` with the real base URL at run time, keeping cases
environment-agnostic (dev / staging / prod).

## Evidence before PASS

The test-runner must capture a final Playwright snapshot confirming the
**Expected Final State** described in the test case before recording a PASS.
A PASS without a confirming snapshot is invalid.

## Test-run-lead is the active agent

Run `test-run-lead` directly (not via another agent). It owns the run and
dispatches sub-runs via the Agent tool — `test-author` / `test-sizer` to
assemble the suite when needed, then `test-runner` per case and
`test-reporter` at the end. Do not invoke `test-runner` manually when a led
suite run is in progress.
