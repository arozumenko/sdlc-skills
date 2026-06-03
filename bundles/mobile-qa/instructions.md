# Mobile QA Team — shared conventions

This is a **standalone manual-QA team** for mobile apps. These are team-wide
defaults; `mobile-app-profiler` refines them per project in `AGENTS.md`,
which always wins over this file.

## MCP Setup

Install the MCP servers your runner mode needs — once per project:

```bash
# Mobitru device farm (runner_mode: device-farm — real cloud devices)
# 1. Copy .env.example → .env and fill in MOBITRU_API_TOKEN
# 2. Export the variable, then register:
claude mcp add mobitru -e MOBITRU_API_TOKEN=$MOBITRU_API_TOKEN -- npx -y @mobitru/mcp@latest

# Local Appium (runner_mode: appium — simulator / emulator / USB device)
claude mcp add appium-mcp -- npx -y appium-mcp@latest

# Playwright (runner_mode: playwright — PWA / hybrid only; usually pre-installed)
claude mcp add playwright -- npx -y @playwright/mcp@latest
```

See `.env.example` for the full list of required environment variables and how to obtain them.

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
- **`mobile-test-runner`** — receives a single `TC-NNN` file path; handles `playwright` and `appium` modes:
  `playwright` → runs via Playwright MCP with mobile viewport, emits PASS/FAIL;
  `appium` → runs via Appium MCP (native automation), emits PASS/FAIL.
- **`mobile-guide-writer`** — handles `manual` mode: reads the TC file and writes a human-executable
  step checklist to `reports/manual-guides/TC-NNN-guide.md`, emits BLOCKED. Fallback when Appium MCP
  is not available.
- **`mobile-test-reporter`** — collects all results (runner + guide-writer) and writes the run report to
  `reports/RUN-YYYY-MM-DD-NNN.md`, including device/platform/OS context, runner mode breakdown,
  and a Manual Execution Guides section for native runs.

## Runner Modes

| `app_type` | `runner_mode` | What the runner does |
|------------|---------------|----------------------|
| `pwa` | `playwright` | Runs live via Playwright MCP with mobile viewport + touch emulation |
| `hybrid` | `playwright` | Runs web views via Playwright MCP |
| `native` (Mobitru MCP available) | `device-farm` | Runs via Mobitru MCP — real device from cloud farm; supports biometrics (`inject_touch`), camera injection (`inject_image`), network throttling, and screen recording |
| `native` (local Appium available) | `appium` | Runs via Appium MCP — native automation on local simulator/emulator/real device |
| `native` (neither available) | `manual` | `mobile-guide-writer` generates a step checklist; human executes on device |

The runner_mode is set in each test case's frontmatter by `mobile-test-author`, derived
from `app_type` and MCP availability in `app_profile.md`. Do not set it manually.
When both Mobitru and local Appium are available, `mobile-app-profiler` defaults to `device-farm`
(real devices preferred). Specify `runner_mode: appium` explicitly to override.

To upgrade to `device-farm`: `claude mcp add mobitru -- npx -y @mobitru/mcp@latest`
(verify exact package name at mobitru.com/docs), then re-run `mobile-app-profiler`.
To upgrade from `manual` to `appium`: `claude mcp add appium-mcp -- npx -y appium-mcp@latest`,
then re-run `mobile-app-profiler`.

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
