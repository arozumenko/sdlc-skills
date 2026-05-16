# workflow-run-test.md — run qavajs tests and report results

Use when the user asks to "run tests", "run a test", "execute tests", "run a scenario", or wants to trigger the suite.

> Source: distilled from <https://github.com/qavajs/demo/blob/main/agentic/.claude/skills/run-test/SKILL.md> (MIT). Bug-report block format kept verbatim — it's the strongest part.

## Step 1 — pick the run command

Look at `package.json` `scripts` first; prefer the project's own commands.

```bash
# Whole suite via the project's own script
npm test
npm run debug      # if defined — usually opens UI mode

# Direct cucumber-js / qavajs
npx qavajs run --config config.ts
npx qavajs run --config config.ts --profile headless
npx qavajs run --config config.ts -t '@smoke and not @wip'

# Standalone Playwright mode (qavajs.config.ts + playwright.config.ts present)
PLAYWRIGHT_HTML_OPEN=never npx playwright test
```

For a **specific scenario or keyword**, prefer tag selection over name grep when feasible:

```bash
# By tag (cleanest)
npx qavajs run --config config.ts -t '@checkout'

# By scenario name (works in both modes)
npx qavajs run --config config.ts -t '"User logs in successfully"'
PLAYWRIGHT_HTML_OPEN=never npx playwright test --grep "User logs in"
```

In CI or when iterating, set `PLAYWRIGHT_HTML_OPEN=never` so the run doesn't try to open a report viewer.

## Step 2 — report results concisely

Default report shape:

- Scenarios: passed / failed / skipped.
- For each failure: scenario name + first meaningful error line.
- Where artifacts landed (HTML report, traces, videos, screenshots) — read `format` in `config.ts` and the runner config to find the output paths. Common defaults: `report/`, `test-results/`.

## Step 3 — emit a paste-ready bug report per failure

For every **failed** scenario, append a block in **this exact format** so the user can paste it into a tracker:

```
**Scenario:** <scenario name>

**Steps:**
<numbered list of all Gherkin steps in the scenario, exactly as written>

**Expected result:**
<what the last step or assertion was expecting — derive from the failing step text>

**Actual result:**
<the actual error or failure message from the test output>
```

Rules:

- Derive the **steps list from the feature file source**, not the log output. Read `paths` from `config.ts`, find the matching `*.feature`, and copy the steps verbatim. Log lines are sometimes truncated or reformatted.
- The **expected result** comes from parsing the failing step's intent: `"to equal '400'"` → "response status 400"; `"to be visible"` → "<element> visible".
- The **actual result** is the framework error verbatim (qavajs validation messages, Playwright timeout reasons, `expect()` mismatches). Don't paraphrase.

## Step 4 — surface artifacts

- HTML report — open path: `report/report.html` or `playwright-report/index.html`.
- Traces — `test-results/**/trace.zip`. Tell the user how to view: `npx playwright show-trace test-results/.../trace.zip`.
- Videos — `test-results/**/*.webm` if `video: 'on'` (Playwright runner) or `outputDir` is set.
- Allure / ReportPortal — note the destination URL or directory if those reporters are configured.

## Don'ts

- **Don't run the whole suite to verify a one-line change** — narrow with `-t` or `--grep`.
- **Don't strip stack traces** when reporting — keep at least the top frame so the user can locate the failing step.
- **Don't open the HTML report interactively** in headless / CI sessions — that blocks. Pass `PLAYWRIGHT_HTML_OPEN=never`.
