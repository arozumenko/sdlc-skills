# visual-testing skill — design + plan

**Date:** 2026-08-16
**Skill:** `bundles/feature-development/skills/visual-testing` (new)
**Owner:** feature-development `designer` agent (`skills-on-demand`)
**Branch:** feat/designer-web-screenspecs

## Purpose

Catch unintended visual changes in the designer's generated HTML artifacts —
`screen-specs` device/web mocks AND `user-flow-maps` posters — by screenshotting
them and diffing against committed baselines. Built on `reg-cli` (MIT, browser-free
diff + baseline + approve + HTML report). Capture is **agent-driven** via whatever
browser tool is available (no bundled headless engine, per user constraint).

## Decisions (locked)

- Scope: all designer HTML output (screen-specs + user-flow-maps).
- Diff tool: `reg-cli`, invoked local-or-`npx -y reg-cli` (the repo's existing ccusage
  fallback pattern, commit c006792) — no new `package.json` dependency.
- Capture: agent-driven browser screenshot to deterministic filenames.
- Baselines: committed in the CONSUMER repo (e.g. `docs/design/visual-baselines/`).

## Workflow (SKILL.md)

build artifacts → capture PNGs to `current/` → `reg-cli current baseline diff` →
review HTML report → promote intended changes (`-U`), treat unintended as findings.

## Deterministic capture names (reg-cli matches actual↔expected by filename)

- mobile: `screen-<flow>-<screenId>-<state>-<device>.png`
- web:    `screen-<flow>-<screenId>-<state>-web-<style>-<bp>.png`
- flow:   `flow-<flowId>.png`

Combinatorial guard: default = each screen's DEFAULT state across the relevant
device/breakpoint set + one representative style; opt into more variants explicitly.

## Files

| Path | What |
|---|---|
| `SKILL.md` | Workflow; frontmatter description free of `": "`. |
| `scripts/visual-diff.mjs` | Thin ESM wrapper over reg-cli: resolves dirs, local-or-npx fallback, builds args, runs, reads reg-cli's JSON report, prints summary, sets exit code. `--update` promotes. |
| `references/capturing.md` | How to drive the browser to capture the right pages/breakpoints/states/devices + the naming scheme. |
| `references/baselines.md` | Baseline layout, promote/approve flow, what to commit, reading the report. |

## reg-cli interface (for the wrapper)

`reg-cli <actualDir> <expectedDir> <diffDir> -R <report.html> -J <report.json> -A [-U]`
- `-A` enable anti-alias tolerance; `-U` update expected from actual; `-J` JSON report.
- Wrapper reads the JSON (`failedItems`/`newItems`/`deletedItems`/`passedItems`) →
  summary; exits non-zero when failed/new/deleted is non-empty (unless `--update`).

## Testable seams (Node --test, stdlib, NO network)

The reg-cli spawn is isolated; unit-test the pure pieces:
1. `buildArgs({current,baseline,diff,report,json,update})` → correct arg array (with/without `-U`).
2. `summarize(reportObj)` → `{ok, message, counts}` — ok=false when failed/new/deleted non-empty; ok=true all-passed; `--update` path always ok.
3. `runnerCommand(hasLocalRegCli)` → `['reg-cli']` vs `['npx','-y','reg-cli']`.
Do NOT shell out to the network-fetched reg-cli in tests.

## Plan (bite-sized)

- **T1:** TDD `scripts/visual-diff.mjs` — write `visual-diff.test.mjs` for buildArgs/summarize/runnerCommand (fail), implement the wrapper (pass), commit.
- **T2:** Author `SKILL.md` + `references/capturing.md` + `references/baselines.md` (prose; grounded in the real screen-specs/user-flow-maps output + naming scheme), commit.
- **T3:** Wire — add `visual-testing` to feature-development `bundle.json` localSkills and the designer's `skills-on-demand`; `gen:marketplaces`; `npm test` + `npm run validate` green; commit.
- **Final:** fresh-eyes review of the whole skill diff.

## Out of scope
- Actually running reg-cli against real captures in CI (needs a browser + network; that's the agent-driven runtime step, documented not automated).
- product-management designer adoption for flow-maps (future).
