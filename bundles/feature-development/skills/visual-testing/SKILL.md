---
name: visual-testing
description: Use when a designer's generated HTML needs visual regression checking — "did the design change", "visual test", "screenshot diff", "check the mocks didn't drift", "compare against the baseline", or before promoting a redesign. Screenshots the self-contained pages a designer produces (screen-specs device/web mocks and user-flow-maps posters), diffs each against a committed baseline with reg-cli (MIT, no cloud), and reports what changed as an HTML report plus a pass/fail summary. Capture is agent-driven through whatever browser tool is available — no headless engine is installed. NOT a pixel-perfect design tool, NOT for testing a live production app (that is E2E), and NOT a replacement for reading the spec — a diff proves a picture changed, not that it is correct.
---

# Visual testing

Catch **unintended** visual change in the artifacts a designer generates. The
pages are deterministic (same spec + tokens → same HTML), so a pixel that moved
without a spec change is a regression worth seeing. This skill screenshots each
page and diffs it against a baseline you committed the last time the design was
correct.

Two halves, kept separate on purpose:

- **Capture is agent-driven.** You open each page in the browser tool you have
  (here, the connected browser) and save a PNG. No headless browser is bundled or
  installed — capture rides on the browser that already exists.
- **Diff is browser-free.** `scripts/visual-diff.mjs` shells out to `reg-cli`
  (resolved local-first, else `npx --yes reg-cli@latest`, so nothing is added to
  `package.json`) to compare, manage baselines, and write a report.

## Workflow

1. **Build the artifacts.** Run the generator whose output you're checking:
   - screen-specs → `node .../screen-specs/scripts/build-screens.mjs …`
   - user-flow-maps → `node .../user-flow-maps/scripts/build-flowmaps.mjs …`
2. **Capture** every page you want under coverage into a `current/` directory,
   one PNG per page/variant, named by the scheme below. See
   `references/capturing.md` for how to drive the browser and which variants to
   shoot (breakpoints, device frames, states).
3. **Diff** against the baseline:
   ```bash
   node scripts/visual-diff.mjs --current <current/> --baseline <baselines/> --diff <out/>
   ```
   Exit `0` = no change; exit `1` = something changed (a report is written to
   `<out/>/report.html`).
4. **Review the report.** Open `report.html` and look at each diff.
   - An **intended** change (you redesigned on purpose) → promote it:
     `node scripts/visual-diff.mjs --current <current/> --baseline <baselines/> --diff <out/> --update`
     then commit the updated baselines.
   - An **unintended** change → a finding. Fix the cause, don't update the baseline.

**A green diff is not a green design.** It proves the picture is unchanged since the
last baseline — it says nothing about whether that baseline was ever correct. Read
the spec and `screen-specs`' own `verifying.md`; use this skill to hold a *reviewed*
design steady, not to decide it's right in the first place.

## Naming (this is what lets reg-cli pair a shot with its baseline)

`reg-cli` matches `current/<name>.png` to `baselines/<name>.png` by filename, so
names must be stable and describe exactly one variant:

| Artifact | Filename |
|---|---|
| mobile screen | `screen-<flow>-<screenId>-<state>-<device>.png` |
| web screen | `screen-<flow>-<screenId>-<state>-web-<style>-<bp>.png` |
| flow-map poster | `flow-<flowId>.png` |

`<device>` ∈ iphone / iphone-max / android / iphone-se · `<style>` ∈ material /
neo-flat / minimal-neutral / fluent · `<bp>` ∈ mobile-web / tablet / desktop.

## Keep the baseline set honest (don't let it explode)

Screens × states × styles × breakpoints is a combinatorial trap. Default coverage:
each screen's **default state**, at the device/breakpoint set the design targets,
in **one representative style**. Add more variants only where the risk is real — a
state whose layout is fragile, a style whose depth treatment you're unsure of.
Every variant you snapshot is a baseline someone must re-approve on every
intentional change; a 400-image baseline nobody re-approves is worse than 30 that
people actually look at.

## Files

| Path | What it is |
|---|---|
| `scripts/visual-diff.mjs` | The reg-cli wrapper: build args, local-or-npx, read the JSON report, summary + exit code. `--update` promotes current → baseline. |
| `references/capturing.md` | Driving the browser to capture the right pages/variants, and the naming scheme in practice. |
| `references/baselines.md` | Where baselines live, the promote/approve flow, what to commit, and how to read the report. |
