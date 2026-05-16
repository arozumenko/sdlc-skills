# workflow-create-test.md — author a new qavajs scenario

Use when the user asks to "create a test", "add a scenario", "write a test case", or describes a new flow to cover.

> Source: distilled from <https://github.com/qavajs/demo/blob/main/agentic/.claude/skills/create-test/SKILL.md> (MIT) and made config-aware so it works in any qavajs project.

## Step 1 — discover the project layout

Read the project's config first; **don't hardcode paths**. qavajs uses two filename conventions:

| Mode | Config file | Discovered fields |
|---|---|---|
| cucumber-js (default) | `config.ts` (sometimes `cucumber.config.ts` in standalone Playwright mode) | `paths` (features glob), `pageObject`, `memory`, `require` |
| Standalone Playwright | `qavajs.config.ts` | same fields, plus a separate `playwright.config.ts` |

```bash
ls *.config.ts cucumber.config.ts qavajs.config.ts 2>/dev/null
```

From the config:

1. **Features glob** — read `paths` (e.g. `['features/**/*.feature']`). Pick the most populated `*.feature` file as the canonical one to extend, unless the user names a target.
2. **Page-object class** — follow the `pageObject: new App()` import to its source file (commonly `page_object/index.ts`). Read it. List every property name and every `locator.template(...)` you find.
3. **Memory class** — follow `memory: new Constants()` (commonly `memory/index.ts`). Read it. Note `$key` resolvable names like `app`, `baseUrl`, credentials.
4. **Custom step definitions** — scan any `step_definitions/**/*.ts`. These take precedence over packaged steps with the same regex.

If the project doesn't yet have a feature file, ask before creating one.

## Step 1.5 — verify each new locator on the live page

Before you reference a page-object name in Gherkin (or add one to
`page_object/`), make sure the underlying CSS / accessibility selector
**actually exists and is unique** on the live app. Use one of the two
in-repo exploration skills — they replace `npx playwright codegen` and
ad-hoc DevTools work:

- **[`playwright-testing`](../../playwright-testing/) (Playwright MCP)** — default. `browser_navigate(url)` → `browser_snapshot()` for the accessibility tree, then `browser_evaluate("document.querySelectorAll('…').length")` to confirm uniqueness. Returned element refs are stable across the same snapshot.
- **[`browser-verify`](../../browser-verify/) (CDP)** — when you need computed styles, cookies, storage, or a real mouse event the MCP can't deliver.

Skip the live-page check **only** when the user explicitly said "use
the existing `Foo` locator" — i.e., you're not adding a new selector.
Inventing selectors from memory is the #1 cause of "Element not found"
failures in qavajs (see [`workflow-fix-test.md`](workflow-fix-test.md) Step 3).

## Step 2 — draft the scenario

Match the existing Gherkin style in the target file. Default conventions:

- **Locator references** use **PascalCase property names** with spaces inserted: `Username Input`, `Cart Badge`, `Login Button`.
- **Template locators** use parentheses for the template arg: `Product (Sauce Labs Backpack)`.
- **Hierarchy** uses ` > `: `Product (Sauce Labs Backpack) > Add To Cart`.
- **Memory** values use `$` prefix: `$app`, `$baseUrl`, `$user.email`.
- **Look up step phrases in the catalog before inventing**, in this priority order: `references/steps-memory.md` → the runner-specific catalog (`steps-playwright.md` or `steps-wdio.md`) → the domain catalogs (`steps-api.md`, etc.). Common patterns:
  - `I open '$app' url`
  - `I type 'value' to 'Element Name'`
  - `I click 'Element Name'`
  - `I expect text of 'Element Name' to equal 'value'`
  - `I expect 'Element Name' to be visible`
  - `I expect 'Element Name' not to be visible`
  - `I expect number of elements in 'Collection Name' collection to equal 'N'`

Add a brief comment block above the scenario in the project's existing style — preconditions, steps, expected results — so a human can read intent without parsing Gherkin.

## Step 3 — append, don't replace

- Append to the **existing** feature file unless the user explicitly asks for a new one.
- Keep scenarios self-contained: each scenario should set up its own state (login, navigate, etc.) so it can run in isolation under `--parallel`.

## Step 4 — verify it passes

Use the project's actual test command — read `package.json` `scripts.test` and `scripts.debug`. Then narrow to the new scenario:

```bash
# qavajs cucumber-js mode
npx qavajs run --config config.ts -t "@<unique-tag>"
npx qavajs run --config config.ts -t "<scenario name>"

# standalone Playwright mode (qavajs.config.ts + playwright.config.ts)
PLAYWRIGHT_HTML_OPEN=never npx playwright test --grep "<scenario name>"
```

Tag the new scenario uniquely (e.g. `@new-flow`) for cheap targeting under `-t`.

If it **passes** → report.
If it **fails** → fall through to [`workflow-fix-test.md`](workflow-fix-test.md). Loop until green.

## Constraints

- **Don't add page-object locators** unless the user explicitly asks; if a needed element is missing, surface that and ask before editing the page object.
- **Don't create new feature files** when the existing layout has one — keep tests close to siblings.
- **Don't paraphrase a step phrase** that exists in the catalog; copy it verbatim. qavajs's step-matcher is strict and a one-character drift produces "Undefined step" errors.
- **Don't put credentials inline.** Use `memory/index.ts` for fixed values and `--memory-values` or env vars for secrets.

## Reporting back

After a passing run, report:

- The new scenario name and which feature file it landed in.
- Any new template-locator parameter used (so the user can review).
- Whether existing scenarios still pass (run a smoke selection if cheap).
