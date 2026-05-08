# troubleshooting.md — diagnosing failing qavajs runs

A failing test in qavajs is usually one of seven things. Match the symptom to the section, fix in place.

## 1. "Step is undefined" / "Did not find any matching step definition"

**Symptom**: Cucumber prints the failing line and offers an example snippet.

**Likely causes**

- The step package isn't required. Add `'node_modules/@qavajs/steps-<x>/index.js'` to `config.require`.
- You handwrote the Gherkin and there's a typo or a one-letter difference. Open the relevant catalog (`references/steps-*.md`) and copy the canonical phrase.
- Pluralisation / parenthesisation mismatch — qavajs uses `(s)` and `(in)to` patterns; `'I type X into Y'` and `'I type X to Y'` are both valid. `'I types …'` is not.
- A custom step file is missing from `require`/`import`.

## 2. "Ambiguous step definition"

**Symptom**: Cucumber lists two regex matches.

**Causes**

- Two packages defining overlapping phrases (rare).
- You wrote a custom step duplicating a packaged one. Either delete it or use `Override(...)` from `@qavajs/core` if you want to *replace* the packaged behaviour.
- Multiple `require` entries pulling in the same package twice (check for both `@qavajs/steps-playwright` and `node_modules/@qavajs/steps-playwright/index.js`).

## 3. "Cannot read properties of undefined (reading 'value')"

**Symptom**: Crash inside a step that uses `{value}` parameters.

**Causes**

- You stringified or otherwise unwrapped a `MemoryValue` instead of calling `await arg.value()`.
- The memory key doesn't exist — `getValue` returns `undefined` for missing top-level keys. Verify with `console.log(this.memory)` or the memory logger (`memory.setLogger({ log })`).
- The expression is malformed (`'$user .name'` with a stray space) — qavajs only resolves `$identifier`, not `$identifier .x`.

## 4. Element not found / locator returns nothing

**Symptom**: `Locator did not match any element` (Playwright) or `element not found` (WDIO) on a step like `I click 'X > Y'`.

**Diagnostic checklist**

1. Is the page-object path correct? Walk it: does `App.X` exist? Does `X.Y` exist on the component class? Capitalisation in Gherkin maps to camelCase property names with spaces stripped.
2. Are you passing through a templated component (`'X (foo) > Y'`) without defining `X` as `locator.template(...)`?
3. Is the parent's selector still right? Re-check against the live page — preferred order: [`playwright-testing`](../../playwright-testing/) MCP (`browser_snapshot` for the a11y tree, `browser_evaluate("document.querySelectorAll('…').length")` for uniqueness), then [`browser-verify`](../../browser-verify/) (CDP) when you need computed styles, shadow-DOM access, or device emulation. DevTools is a fallback when neither skill is loaded. If the count is `0` or `>1`, the page changed.
4. Is the element inside a frame/shadow root? Use `NativeSelector` (Playwright `frameLocator`) or `ignoreHierarchy: true` for global elements.
5. Check for race conditions: can you reach for `I refresh page until …` or `I expect X to be visible` before clicking?

## 5. Validation passes when it shouldn't (or vice versa)

**Symptom**: a `Then I expect …` doesn't behave as expected.

**Causes**

- Wrong matcher. `equal` is `==`; for objects/arrays, use `deeply equal`. For strict, use `strictly equal`.
- Stale memory: assertion compares against a value captured earlier, not the current state. Re-save before re-asserting.
- Soft vs hard: a missing `softly` makes the scenario abort early; an accidental `softly` hides failures. Both are common.
- For arrays: `to have member` is exact-set; `to include member` is superset. Mixing them up is the #1 array assertion bug.

## 6. Test passes locally, fails in CI

**Standard checklist**

- Headless vs headed differences — set `headless: true` locally to reproduce.
- Viewport: CI VMs often have a default viewport that breaks responsive layouts. Set `browser.capabilities.viewport`.
- Timing: bump `defaultTimeout`, `browser.timeout.value`, `browser.timeout.pageRefreshInterval`.
- Parallelism causing data collisions — see [`parallel.md`](parallel.md). Use `parallel(...)` for unique users.
- Network: the staging URL may not be reachable from CI without a VPN/secret; check `--memory-values`.
- File system: `'fixtures/cat.png'` is relative to *cwd* of the worker, not the feature file.

## 7. Reports look weird / are empty

- Allure report is empty: forgot the `allure-cucumberjs/reporter` entry in `format`, or you ran `allure generate` against the wrong dir.
- HTML report missing screenshots: `attach: true` not set on `screenshot`/`trace`/`video`, or the event didn't fire (e.g. test passed and you only requested `onFail`).
- Console formatter shows nothing: another formatter raised an error before its handler ran. Run with `-f @qavajs/console-formatter` only and add others back one at a time.

## Useful debug levers

- `qavajs run --dry-run` — proves config + step resolution without running.
- `qavajs run --backtrace` — full stack traces.
- `qavajs run --no-error-exit` — keep the run going for full reports even on failures.

## 8. Element found in DevTools / MCP but `button:has-text()` returns nothing

**Symptom**: you can see the element in the live DOM and the [`playwright-testing`](../../playwright-testing/) MCP (or [`browser-verify`](../../browser-verify/) CDP) confirms it exists, but Playwright's `locator('button:has-text("X")')` times out.

**Cause**: Many UI component libraries (Material UI, Ant Design, Mantine, Radix, etc.) render clickable elements as `<div role="button">` rather than a native `<button>`. CSS `button` tag selectors will miss them entirely.

**Fix**: Replace the `button` tag selector with an attribute selector:

```
# Wrong  — misses MUI Chip, ListItemButton, etc.
locator('button:has-text("Code Repositories")')

# Correct — matches any role=button element
locator('[role="button"]:has-text("Code Repositories")')

# Or for MUI Chip specifically
locator('[class*="MuiChip-root"]:has-text("Code Repositories")')
```

**MUI cheat-sheet**:

| MUI component       | Rendered element         | Selector pattern                                   |
|---------------------|--------------------------|----------------------------------------------------|
| MuiChip (clickable) | `div[role="button"]`     | `[class*="MuiChip-root"]:has-text("X")`            |
| MuiListItemButton   | `div[role="button"]` in `<li>` | Click the `li[aria-label="X"]` directly      |
| MuiIconButton       | `<button>`               | `button[aria-label="X"]`                           |
| MuiToggleButton     | `<button>`               | `button:has-text("X")` (works normally)            |

**Diagnostic**: run `node cdp.mjs query "button:has-text('X')"` — if count=0 but the element is visible, inspect its `tagName` and `role` attributes.
- `qavajs run --tags '@only'` + a `@only` tag on the failing scenario — fastest reproduction.
- `qavajs run --memory-values '{"baseUrl":"http://localhost:3000"}'` — point at a local server.
- `memory.setLogger({ log })` — trace value resolution.
- Playwright trace viewer: enable `trace.event: ['onFail']`, then `npx playwright show-trace traces/<scenario>.zip`.

## Live links

- Q&A: <https://qavajs.github.io/docs/qna>
- Issues: <https://github.com/qavajs/qavajs.github.io/issues>
