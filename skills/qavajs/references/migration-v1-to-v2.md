# migration-v1-to-v2.md — qavajs v1 → v2 migration

This skill targets **qavajs 2.x**. If you're staring at a v1 project and want to migrate (or maintain it without losing your mind), this is the cheat sheet.

Source of truth: <https://qavajs.github.io/docs/v2>

## Headline changes

1. **Page object DSL replaced**. `$('selector')` / `$$('selector')` → `locator('selector')`. Components defined via `.as(Class)`, not by extending a `Component` base class.
2. **`@qavajs/cli` is now `@qavajs/core`** and exports shared types (`MemoryValue`, `Validation`, `IQavajsWorld`).
3. **No more globals.** `global.browser`, `global.page`, `global.context`, `memory.*`, `getValidation`, `getElement` are gone — use `this.*` instead.
4. **`I wait until ...` steps removed** in favour of polling `I expect ...` / `I refresh page until ...` phrases.
5. **`Response ...` API steps removed** in favour of `I expect "$response.payload.x" ...` plus the validation parameter type.
6. **Frame switching changed.** No more `I switch to frame ...` step in Playwright — use a `frameLocator(...)` inside the page object via `locator.native(...)`.

## Page-object renames

| v1 | v2 |
|---|---|
| `Element = $('selector')` | `Element = locator('selector')` |
| `Collection = $$('selector')` | `Collection = locator('selector')` |
| `Component = $(new Component('selector'))` | `Component = locator('selector').as(Component)` |
| `class CustomComponent extends Component {}` | `class CustomComponent {}` (no base class) |
| ``Element = $(Selector(text => `//*[@text="${text}"]`))`` | ``Element = locator.template(text => `//*[@text="${text}"]`)`` |
| `Element = $(NativeSelector(page => page.locator('selector')))` | `Element = locator.native(({ page }) => page.locator('selector'))` |

## World / API renames

| v1 | v2 |
|---|---|
| `getElement('Button')` | `this.element()` or use `{wdioLocator}` / `{playwrightLocator}` parameter type |
| `getCollection('Button')` | `this.element().collection()` or the locator parameter types |
| `memory.getValue('$key')` | `this.getValue('$key')` or use `{value}` parameter type |
| `memory.setValue('key', 42)` | `this.setValue('key', 42)` or use `{value}` parameter type |
| `getValidation('to equal')` | `this.validation('to equal')` or use `{validation}` parameter type |
| `global.config` | `this.config` |
| `global.browser` (wdio) | `this.wdio.browser` |
| `global.driver` (wdio) | `this.wdio.driver` |
| `global.browser` (playwright) | `this.playwright.browser` |
| `global.context` (playwright) | `this.playwright.context` |
| `global.page` (playwright) | `this.playwright.page` |

## Step phrase migrations

- `I wait until X to be visible` → `I expect 'X' to be visible` (the polling is built into `{playwrightCondition}` / `{wdioCondition}` params).
- `Response status equals to 200` → `I expect "$response.status" to equal "200"`.
- `Response payload property X equals Y` → `I expect "$response.payload.X" to equal "Y"`.
- `I switch to frame 'iframeId'` (Playwright) → declare the frame as a native locator: `IFrame = locator.native(({ page }) => page.frameLocator('#iframeId').locator('body'))`.

## New parameter types

| Type | Resolves to | Example |
|---|---|---|
| `{value}` | `MemoryValue` (lazy memory accessor) | `When I save {value} to memory as {value}` |
| `{validation}` | `Validation` (assertion fn with `.poll()`) | `Then I expect {value} {validation} {value}` |
| `{playwrightLocator}` | `Locator` (resolved against the active `Page`) | `When I click {playwrightLocator}` |
| `{wdioLocator}` | accessor function returning a WDIO element | `When I click {wdioLocator}` |
| `{playwrightCondition}` | element-state predicate (visible / clickable / enabled) | `Then I expect {playwrightLocator} {playwrightCondition}` |
| `{playwrightTimeout}` / `{wdioTimeout}` | optional `<duration> ms` clause | `When I refresh page until X to be visible (5000)` |

## Deprecated modules

These v1 add-on modules have been **folded into `@qavajs/core`**:

| Old module | Replacement |
|---|---|
| `@qavajs/soft-assertion` | Built-in `softly` keyword in any validation phrase (e.g. `to softly equal`). See [`validation.md`](validation.md). |
| `@qavajs/template` (the standalone module) | `Template((...) => '...')` from `@qavajs/core`. See [`composition.md`](composition.md). The `templates: [...]` config option still works for shipping `.feature`-based templates. |
| `service` config field | `BeforeExecution(fn)` / `AfterExecution(fn)` from `@qavajs/core`. |

You can keep the deprecated modules installed during migration — they still work — but new code should use the core versions.

## Mechanical migration playbook

1. Bump dependencies: `@qavajs/core@^2`, `@qavajs/steps-*@^2`, drop `@qavajs/cli`.
2. **Rename**: rename `qavajs.config.*` → `config.ts` (cucumber-js mode), unless you're moving to `@qavajs/playwright` standalone (which keeps `qavajs.config.ts`).
3. **Page objects**: project-wide regex find/replace:
   - `\$\(new (\w+)\('([^']+)'\)\)` → `locator('$2').as($1)`
   - `\$\(([^)]+)\)` → `locator($1)` (then audit; `locator.template` and `locator.native` need manual edits)
   - `\$\$\(([^)]+)\)` → `locator($1)`
   - Drop `extends Component` from component class declarations.
4. **Step files**: replace `global.browser` / `global.page` / `memory.*` / `getElement` / `getValidation` per the table above.
5. **Feature files**: replace `I wait until X` with `I expect X to be visible` (the wait is implicit through condition timeouts).
6. **Run with `--dry-run`** to surface unresolved steps before executing.
7. **Run a single tag** (`-t '@smoke'`) and fix one cluster of failures at a time.
8. Re-enable parallel and the full suite.

## Caveats during migration

- **Mixed v1/v2 packages will silently fail.** All `@qavajs/steps-*` packages must be on v2 — installing v1 step package alongside v2 core breaks parameter types.
- **Globals leak**. If your custom step files still reference `global.browser`, they'll fail at first invocation. Search `global\.` across the codebase before claiming the migration is done.
- **Frame switching**: v1 `I switch to frame` worked for both Playwright and WDIO; v2 keeps the WDIO version but Playwright projects must use `locator.native(...)` with `frameLocator`.
- **Custom step phrases that reused v1's `{string}` for memory aliases** (e.g. `When I read {string}` to look up a key) won't auto-resolve in v2 — switch the parameter type to `{value}` and call `await arg.value()`.

## Live links

- v2 changelog page: <https://qavajs.github.io/docs/v2>
- Side-by-side demos: <https://github.com/qavajs/demo>
