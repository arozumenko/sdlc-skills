# Mobile QA Team — shared conventions

This is a **standalone manual-QA team** for mobile apps. These are team-wide
defaults; `mobile-app-profiler` refines them per project in `AGENTS.md`,
which always wins over this file.

## Pipeline

Onboard once with `mobile-app-profiler`, then drive `mobile-run-lead` — it is the
single orchestrator for a run and brings in the authoring/sizing agents when
the suite needs them. You can still invoke `mobile-test-sizer` or `mobile-test-author`
standalone for authoring work outside a run.

- **`mobile-app-profiler`** — run once to onboard the app: determines platform, app type,
  and runner mode; explores PWA/hybrid apps via Playwright MCP with mobile viewport (or
  guides you to provide screenshots for native apps); writes `.agents/mobile-qa/app_profile.md`.
- **`mobile-run-lead`** — the run orchestrator; run it as the **active agent**. Assembles
  the suite first — dispatching **`mobile-test-author`** to write missing cases and
  **`mobile-test-sizer`** to size unsized ones, *when needed* — then dispatches one
  `mobile-test-runner` per case and triggers `mobile-test-reporter`.
- **`mobile-test-sizer`** — rates cases S/M/L for mobile execution cost: S = simple taps,
  M = form + auth + single permission, L = biometrics / push notifications / background cycling.
  Dispatched by the lead, or run standalone.
- **`mobile-test-author`** — takes a feature or flow description and writes formatted
  mobile test cases under `tasks/<suite>/TC-NNN_<slug>.md`. Uses mobile gesture vocabulary
  (Tap, Swipe, Long-press, etc.), sets `platform`, `app_type`, and `runner_mode` from the
  profile. Dispatched by the lead, or run standalone.
- **`mobile-test-runner`** — receives a single `TC-NNN` file path; routes by `runner_mode`:
  `playwright` → runs via Playwright MCP with mobile viewport and emits a PASS/FAIL JSON result;
  `manual` → generates a human-executable step guide to `reports/manual-guides/` and emits BLOCKED.
- **`mobile-test-reporter`** — collects runner results and writes the run report to
  `reports/RUN-YYYY-MM-DD-NNN.md`, including device/platform/OS context, runner mode breakdown,
  and a Manual Execution Guides section for native runs.

## Runner Modes

| `app_type` | `runner_mode` | What the runner does |
|------------|---------------|----------------------|
| `pwa` | `playwright` | Runs live via Playwright MCP with mobile viewport + touch emulation |
| `hybrid` | `playwright` | Runs web views via Playwright MCP; native screens flagged for manual |
| `native` | `manual` | Generates step guide; human executes on device |

The runner_mode is set in each test case's frontmatter by `mobile-test-author`, derived
from the `app_type` in `app_profile.md`. Do not set it manually.

## Project Layout

```
tasks/<suite>/TC-NNN_<slug>.md        test cases (authored by mobile-test-author)
reports/RUN-YYYY-MM-DD-NNN.md        run reports (written by mobile-test-reporter)
reports/screenshots/                  evidence screenshots
reports/manual-guides/TC-NNN-guide.md step-by-step guides for native manual execution
.agents/mobile-qa/knowledge/          seeded reference docs (format, template, report format)
.agents/mobile-qa/app_profile.md      app map written by mobile-app-profiler
.agents/mobile-qa/screenshots/        exploration screenshots from mobile-app-profiler
```

## `{{base_url}}` Rule (PWA / Hybrid Only)

For `runner_mode: playwright` test cases, all URLs use `{{base_url}}` as a prefix.
The `mobile-test-runner` substitutes the real base URL at run time, keeping cases
environment-agnostic (dev / staging / prod). Native cases do not use `{{base_url}}` —
steps reference screen names.

## Evidence Before PASS (Playwright Mode)

The `mobile-test-runner` must capture a final Playwright snapshot confirming the
**Expected Final State** before recording a PASS. A PASS without a confirming snapshot is invalid.

## Manual BLOCKED is Valid Output (Manual Mode)

When `runner_mode` is `manual`, every TC returns BLOCKED with a guide path. This is the
expected deliverable for native apps — the guide is what the QA engineer uses on the
device. The lead's summary will list the guides; do not treat manual BLOCKED as a test failure.

## mobile-run-lead is the Active Agent

Run `mobile-run-lead` directly as the active agent (not via another agent). It owns the run
and dispatches sub-agents via the Agent tool. Do not invoke `mobile-test-runner` manually
when a led suite run is in progress.
