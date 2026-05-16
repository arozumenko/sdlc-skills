---
name: qavajs
description: Guide to qavajs (https://qavajs.github.io), a BDD framework on CucumberJS with memory, validation, page-object DSL, fixtures, templates, and step libraries for Playwright, WebdriverIO, REST/GraphQL/WebSocket, Appium, Electron, SQL, files, Gmail, Lighthouse, visual-diff and axe a11y. Covers `npm create @qavajs`, `config.ts` schema, `qavajs run` CLI, `{value}`/`{validation}` types, memory (`$key`, `{$x}`, `$js()`), `locator()` DSL, composition (`executeStep`, `Template`, `Fixture`, `BeforeExecution`), parallel/sharding, ~300 literal Gherkin patterns from 11 `@qavajs/steps-*` packages, and standalone runners (Cypress, Playwright Test). Apply when the user mentions qavajs or `@qavajs/*`, writes Gherkin with `'A > B > C'` locators or `$`-prefixed memory refs, edits `config.ts` with `paths`/`require`/`memory`/`pageObject`/`browser`, configures Allure/ReportPortal/console formatters, or works on Cucumber+Playwright/WDIO/API tests — even without "qavajs" when patterns match (`locator().as()`, `executeStep`).
license: Apache-2.0
compatibility: Requires Node.js 18+. Uses `npm` / `npx`. qavajs itself ships no MCP server — for live-page locator discovery, pair with the [`playwright-testing`](../playwright-testing/) MCP skill or the CDP-based [`browser-verify`](../browser-verify/) skill (see § Live-page exploration).
metadata:
  author: octobots
  version: "0.1.0"
  framework_version: "qavajs 2.x"
  upstream_repo: https://github.com/qavajs
  upstream_docs: https://qavajs.github.io
  upstream_demo: https://github.com/qavajs/demo
---

# qavajs — BDD test automation on top of CucumberJS

This skill teaches Claude to use **qavajs** correctly: scaffolding projects, authoring feature files, writing step definitions, modelling pages, configuring runners and reporters, composing tests, and debugging failures. The hard knowledge — every literal Gherkin step pattern, the full config schema, the page-object DSL, every CLI flag — lives in `references/`. This file teaches the *workflow* and routes to those references.

## When this skill applies

Trigger as soon as you spot any of:

- The string `qavajs`, `@qavajs/`, or one of its packages (`@qavajs/core`, `@qavajs/steps-playwright`, `@qavajs/steps-wdio`, `@qavajs/steps-api`, `@qavajs/memory`, `@qavajs/validation`, `@qavajs/template`, `@qavajs/po-playwright`).
- A `config.ts` whose default export contains `paths`, `require`, `memory`, `pageObject`, or `browser` together.
- Gherkin steps such as `I open '$baseUrl' url`, `I click 'A > B > C'`, `I expect text of 'X' to equal 'Y'`, `I save 'k' to memory as 'v'`, `I send 'GET' request to '$url' and save response as 'r'`.
- Page-object code using `locator(...)`, `locator.template(...)`, `.as(SomeClass)`, or imports from `@qavajs/steps-playwright/po` / `@qavajs/po-playwright` / `@qavajs/po`.
- Cucumber output in the `@qavajs/console-formatter` style, or an Allure / `cucumber-html-formatter` / ReportPortal report originating from `qavajs run`.

If a request mentions "Cucumber + Playwright" or "Cucumber + WebdriverIO" without naming qavajs, **still consider this skill** — qavajs is the most ergonomic way to do that combo, and the user may not know its name yet. Suggest it explicitly.

## Live-page exploration — discover locators before you author them

qavajs steps drive Playwright / WebdriverIO under the hood, but the
*selectors* you encode in `page_object/index.ts` only have value if they
match the live DOM uniquely. **Never invent a selector from a remembered
DOM shape** — the page may have shipped a redesign since the last time
you saw it. Verify against the running app first, then write the
locator.

This repo ships two skills that fill that gap. Pair them with qavajs
instead of reaching for `npx playwright codegen` or hand-running queries
in DevTools:

| Tool | When to load | What it gives you |
|---|---|---|
| [`playwright-testing`](../playwright-testing/) (Playwright MCP) | Default for web — `browser_navigate` → `browser_snapshot` → click/type → re-snapshot | Accessibility-tree element refs, screenshots, console + network logs. Single-shot uniqueness check via `browser_evaluate("document.querySelectorAll('…').length")` before pasting a CSS selector into `locator(...)`. |
| [`browser-verify`](../browser-verify/) (CDP) | When the MCP can't reach the signal — computed styles, cookies, storage, real mouse events, device emulation | Lower-level DOM/CSS introspection; useful for the `'button'` vs `'[role="button"]'` class of failures (see [`troubleshooting.md`](references/troubleshooting.md) § 8). |

The pairing is identical to the one [`tosca-automation`](../tosca-automation/)
uses for module discovery: an MCP / CDP exploration tool **first**, then
the framework-side authoring (here: qavajs). Verifying a selector with
`browser_snapshot` + `browser_evaluate` in the same session you write
the locator is the single highest-leverage habit for keeping qavajs
suites green — qavajs accepts an ambiguous selector at save time and
surfaces the failure only at runtime.

The CLI alternatives (`npx playwright codegen`, `npx playwright open`)
still work in projects that already use them, but they require a
separate terminal and don't return programmatic uniqueness counts. Use
them as fallback only.

## How qavajs is organised

qavajs is a **monorepo of small packages** orbiting a CucumberJS extension. Mental model:

```
@qavajs/core        ← test runner (CLI, config, World extensions, hooks, composition)
@qavajs/memory      ← shared memory store + $-resolver (singleton, used by World.getValue)
@qavajs/validation  ← matchers + natural-language phrase parser ({validation} param type)
@qavajs/template    ← compose multiple Gherkin steps into one reusable step
@qavajs/po-playwright (or @qavajs/po for wdio)  ← page-object DSL

@qavajs/steps-memory     ← 15 generic data steps (save/set/expect)
@qavajs/steps-playwright ← 107 web/electron steps (powered by Playwright)
@qavajs/steps-wdio       ← 111 web/mobile steps (powered by WebdriverIO + Appium)
@qavajs/steps-api        ← 33 REST/GraphQL/WebSocket steps

Reporters: @qavajs/console-formatter, @qavajs/html-formatter, allure-cucumberjs,
           @qavajs/format-report-portal, JUnit, etc.
```

Always name packages explicitly when generating `package.json` or `require:` arrays — the framework discovers steps by `require`-ing the package's `index.js`.

## Workflow: starting from zero

### 1. Scaffold (fastest path)

```bash
npm create @qavajs
```

This wizard asks for project name, runner (Playwright / WebdriverIO / Cypress / API-only / Mobile), TypeScript on/off, formatters, and writes a runnable starter. Prefer it over hand-crafting a project unless the user already has one.

If the user wants to wire qavajs into an existing repo, install the bare minimum:

```bash
npm i -D @qavajs/core @qavajs/console-formatter @qavajs/html-formatter \
         @qavajs/memory @qavajs/validation
# pick one of:
npm i -D @qavajs/steps-playwright   # web/electron
npm i -D @qavajs/steps-wdio         # web/mobile
npm i -D @qavajs/steps-api          # API
# usually also:
npm i -D @qavajs/steps-memory       # generic data steps
npm i -D typescript ts-node @types/node @cucumber/cucumber dotenv
```

A copy-paste starter `config.ts`, feature file, page object and memory class live in [`assets/`](assets/) — read them when you scaffold by hand.

### 2. Project anatomy

A typical project (mirrors `qavajs/demo/web-playwright`):

```
project/
├── config.ts                  ← default-export config object + named profiles
├── package.json               ← scripts: "test": "qavajs run --config config.ts"
├── tsconfig.json
├── features/                  ← *.feature Gherkin files
│   └── Login.feature
├── page_object/               ← locator() classes, optionally nested per page
│   └── index.ts               ← root App class registered as config.pageObject
├── memory/                    ← Memory class registered as config.memory
│   └── index.ts
└── step_definitions/          ← project-specific custom steps (optional)
```

`paths` in `config.ts` finds features. `require` points at packaged step libraries (and any custom `step_definitions/**/*.ts`).

### 3. The smallest runnable config

```typescript
// config.ts
import { Constants } from './memory';
import { App } from './page_object';

export default {
    paths: ['features/**/*.feature'],
    require: [
        'node_modules/@qavajs/steps-playwright/index.js',
        'node_modules/@qavajs/steps-memory/index.js',
    ],
    format: [
        ['@qavajs/console-formatter'],
        ['@qavajs/html-formatter', 'report/report.html'],
    ],
    memory: new Constants(),
    pageObject: new App(),
    defaultTimeout: 25_000,
    parallel: 1,
    browser: {
        capabilities: { browserName: 'chromium', headless: true },
    },
};

// Named exports become --profile names: `qavajs run --profile headless`
export const headless = { /* override of defaultConfig */ };
```

Full schema, every field, every profile pattern → [`references/architecture.md`](references/architecture.md).

### 4. Run

```bash
npx qavajs run --config config.ts                  # default profile
npx qavajs run --config config.ts --profile headless
npx qavajs run --config config.ts -t '@smoke and not @wip' --parallel 4 --retry 1
npx qavajs run --config config.ts --memory-values '{"baseUrl":"https://staging"}'
```

All CLI flags → [`references/architecture.md`](references/architecture.md) §CLI.

## Authoring tests — the ten things to internalise

The patterns below are what make qavajs Gherkin different from vanilla Cucumber. Read these before writing any test.

### 1. Locator paths use `>` for hierarchy

`'Wikipedia > Search Input'` resolves the `Wikipedia` component on the root `App` page object, then its `SearchInput` field. Indices and text-filters use parentheses: `'#1 of Todos'`, `'Todo (Buy milk)'`, `'Todo (Buy milk) > Checkbox'`. See [`references/page-object.md`](references/page-object.md).

### 2. Memory references start with `$`

`$baseUrl` reads `memory.baseUrl`. `$user.name`, `$items[0]` walk the structure. `{$baseUrl}/api/{$id}` interpolates inside a larger string. `$js(JSON.stringify($user))` evaluates arbitrary JS against memory. `$add(1, 2)` calls a computed function in the memory map. Escape with `\\$`. See [`references/memory.md`](references/memory.md).

### 3. Validation is natural-language

Inside any step that takes the `{validation}` parameter (which most assertion steps do), write phrases like `to equal`, `does not contain`, `to deeply equal`, `to softly match`, `to be greater than`. The phrase pattern is `[is|do|does|to] [not|to not] [to] [be] [softly] <validation>`. Full matcher list and the equivalent `expect()` API → [`references/validation.md`](references/validation.md).

### 4. `softly` keeps the scenario going

`I expect '2' to softly equal '1'` records a failure but lets later steps run. Soft failures are reported at scenario end. Use it whenever you want multiple independent assertions in one scenario — UI smoke tests, response-shape checks.

### 5. The `{value}` parameter is *lazy*

In step definitions, the argument is a `MemoryValue` object, not a string. Call `await arg.value()` to resolve. Call `arg.set(x)` to write back to memory. Do not stringify it.

### 6. Use `executeStep` and `Template` to compose

Don't reinvent steps. From inside a custom step: `await this.executeStep("I click 'Login Button'")`. To wrap a multi-step macro into a single step, use `Template((a, b) => "I click 'X'\nI type '${b}' to 'Y'")`. To run another scenario as a setup: `await this.executeTest('features/Login.feature', 'User logs in')`. Full patterns in [`references/composition.md`](references/composition.md).

### 7. `Fixture` replaces messy `Before` hooks

Tag-scoped setup with optional teardown:

```typescript
import { Fixture } from '@qavajs/core';
Fixture({ name: 'pdp', tags: '@pdp' }, async function () {
    await this.playwright.page.goto('https://shop/pdp');
    return async function () { await this.playwright.page.request.get('/cleanCart'); };
});
```

### 8. Lifecycle: `BeforeExecution`/`AfterExecution`

For test-suite-scoped setup (start a server, seed a DB, spin up Docker), use `BeforeExecution`/`AfterExecution` from `@qavajs/core` — they run **once per `qavajs run`**, outside any worker. The deprecated `service` config option is the same idea but on its way out.

### 9. Override third-party steps with `Override`

`Override('I do test', async function () { ... })` replaces a step definition supplied by a shared library without producing an "ambiguous step" error. Useful in monorepos with house style.

### 10. Step libraries are loaded by `require`

Every step package exports an `index.js` that registers its steps when imported. To activate `@qavajs/steps-playwright`, you literally write `'node_modules/@qavajs/steps-playwright/index.js'` in `config.require`. Don't try to import individual step files.

## Routing — which reference to read for which job

### Core authoring

| Job | Read |
|---|---|
| Editing `config.ts` or troubleshooting CLI flags | [`references/architecture.md`](references/architecture.md) |
| Writing or debugging memory expressions / parameter types | [`references/memory.md`](references/memory.md) |
| Picking the right matcher / phrase, soft assertions, polling | [`references/validation.md`](references/validation.md) |
| Modelling pages with `locator()`, components, dynamic templates | [`references/page-object.md`](references/page-object.md) |
| `executeStep`, `executeTest`, `Template`, `Override`, `Fixture`, hooks | [`references/composition.md`](references/composition.md) |
| Looking up an exact Gherkin step phrase before writing it | the matching `references/steps-*.md` |

### Runners & domains

| Job | Read |
|---|---|
| Configuring Playwright runner (browser, screenshots, traces, video, electron, mocks) | [`references/playwright-runner.md`](references/playwright-runner.md) |
| Configuring WebdriverIO + mobile/Appium | [`references/wdio-runner.md`](references/wdio-runner.md) |
| REST / GraphQL / WebSocket / SOAP request and verification recipes | [`references/api-testing.md`](references/api-testing.md) |
| Database checks (MySQL, PostgreSQL, custom DBClient) | [`references/sql-testing.md`](references/sql-testing.md) |
| File-system steps — wait, validate, load PDF/Word/Excel/CSV | [`references/file-testing.md`](references/file-testing.md) |
| Email verification via Gmail API | [`references/email-testing.md`](references/email-testing.md) |
| Lighthouse perf / SEO / a11y audits | [`references/lighthouse.md`](references/lighthouse.md) |
| Pixel-diff screenshot tests | [`references/visual-testing.md`](references/visual-testing.md) |
| Accessibility (axe-core, IBM Equal Access) | [`references/accessibility.md`](references/accessibility.md) |
| Cloud providers — SauceLabs / BrowserStack / Mobitru / LambdaTest | [`references/cloud-providers.md`](references/cloud-providers.md) |
| Choosing between cucumber-js mode and Cypress / Playwright-Test / Playwright+WDIO | [`references/standalone-runners.md`](references/standalone-runners.md) |

### Operations

| Job | Read |
|---|---|
| Parallel execution, sharding, parallel test data | [`references/parallel.md`](references/parallel.md) |
| TypeScript setup (CJS or ESM) | [`references/typescript.md`](references/typescript.md) |
| VS Code / WebStorm extension setup | [`references/vscode.md`](references/vscode.md) |
| WDIO services (selenium-standalone, appium, vendor) | [`references/wdio-adapter.md`](references/wdio-adapter.md) |
| GitHub Actions / GitLab / Azure DevOps / Jenkins pipelines | [`references/cicd.md`](references/cicd.md) |
| Console / HTML / JUnit / Allure / ReportPortal / XRay output | [`references/formatters.md`](references/formatters.md) |
| Migrating a v1 project to v2 | [`references/migration-v1-to-v2.md`](references/migration-v1-to-v2.md) |
| Common task recipes (login, file upload, mock, switch frame, deep-link) | [`references/recipes.md`](references/recipes.md) |
| Test failed and you don't know why | [`references/troubleshooting.md`](references/troubleshooting.md) |
| Refresh this skill against the latest qavajs release | [`references/update.md`](references/update.md) |

### Workflows (agent-driven dev loop)

| Job | Read |
|---|---|
| User asks to "create a test" / "add a scenario" / "write a test case" | [`references/workflow-create-test.md`](references/workflow-create-test.md) |
| User asks to "run tests" / wants paste-ready bug-report blocks | [`references/workflow-run-test.md`](references/workflow-run-test.md) |
| User asks to "fix a test" / pastes a failure | [`references/workflow-fix-test.md`](references/workflow-fix-test.md) |
| Scaffolding a new project and adding `CLAUDE.md` | [`assets/example-CLAUDE.md`](assets/example-CLAUDE.md) |

## Step catalog — when to read which

Before writing any Gherkin step, **scan the relevant catalog** to find the canonical phrasing — qavajs steps are deliberately granular and you'll save invented-step debugging by copying.

| Domain | Catalog (literal patterns) | Step count |
|---|---|---|
| Generic data, math, save/set, array assertions | [`references/steps-memory.md`](references/steps-memory.md) | 15 |
| Browser/Electron/visual via Playwright | [`references/steps-playwright.md`](references/steps-playwright.md) | 107 |
| Browser + native mobile via WebdriverIO + Appium | [`references/steps-wdio.md`](references/steps-wdio.md) | 111 |
| REST, GraphQL, WebSocket, SOAP | [`references/steps-api.md`](references/steps-api.md) | 33 |
| Relational databases (MySQL, PostgreSQL, custom) | [`references/steps-sql.md`](references/steps-sql.md) | 8 |
| Filesystem (wait, validate, load Excel/PDF/Word/CSV) | [`references/steps-files.md`](references/steps-files.md) | 9 |
| Gmail API (login, search, save email) | [`references/steps-gmail.md`](references/steps-gmail.md) | 4 |
| Lighthouse audits | [`references/steps-lighthouse.md`](references/steps-lighthouse.md) | 3 |
| Pixelmatch screenshot diffs | [`references/steps-visual-testing.md`](references/steps-visual-testing.md) | 2 |
| axe-core accessibility | [`references/steps-accessibility.md`](references/steps-accessibility.md) | 4 |
| IBM Equal Access accessibility | [`references/steps-accessibility-ea.md`](references/steps-accessibility-ea.md) | 4 |

**~300 literal step patterns total.** Each catalog row has the literal `Given/When/Then` pattern and the source-extracted `@example` lines so you can copy-paste a working scenario fragment.

> ⚠️ **Don't load both `steps-accessibility` and `steps-accessibility-ea`** in the same project — they share identical step phrasing and will produce "ambiguous step definition" errors. See [`accessibility.md`](references/accessibility.md) for the workaround.

## Self-improvement

Two things to remember whenever you use this skill:

1. **The catalogs were extracted from upstream source** — they're literal step regexes, not paraphrases. If you ever need a step phrase that isn't there, **first** open the actual upstream source (links in `references/update.md`); only invent a custom step if the package doesn't ship one. Inventing duplicates is the most common cause of "ambiguous step" errors in qavajs projects.

2. **You are allowed (encouraged) to edit this skill.** When you discover something the references don't cover — a new step phrase, a useful pattern, a gotcha that bit you — append it to the right reference and add a one-line note to the top of [`references/update.md`](references/update.md) so the user can review the change. Keep edits surgical: add, don't rewrite. If a step in a catalog is wrong (qavajs renamed it), fix it in place and bump `metadata.version` in this file's frontmatter to a higher patch number.

To re-pull the catalogs from upstream wholesale, run [`scripts/refresh-catalogs.sh`](scripts/refresh-catalogs.sh) — it shallow-clones the four `steps-*` repos and rewrites `references/steps-*.md`. The user must approve the diff.

## Working assets

- [`assets/example-config.ts`](assets/example-config.ts) — minimal Playwright web config with `default`, `headless` and a cloud-provider profile.
- [`assets/example-feature.feature`](assets/example-feature.feature) — runnable feature using memory, locator hierarchy, validation, soft assertions, scenario outline.
- [`assets/example-page-object.ts`](assets/example-page-object.ts) — root `App` with simple, component, collection, and template locators.
- [`assets/example-memory.ts`](assets/example-memory.ts) — constants, computed values, and the `parallel(...)` helper for sharded data.
- [`assets/example-CLAUDE.md`](assets/example-CLAUDE.md) — `CLAUDE.md` skeleton for a new qavajs project; copy the body to repo root and fill in the bracketed placeholders.

When the user asks for "a starter" or "an example", read these and adapt — don't write new ones from scratch.

## Don'ts

- Don't write `qavajs.config.ts` — the convention is plain `config.ts`.
- Don't import individual step files; require the package's `index.js`.
- Don't pass plain strings to `setValue` and expect `$key` resolution to happen — qavajs resolves on read (`getValue`), not on write.
- Don't await `validation()` itself; await `validation.poll(...)` only when you want polling. The synchronous form throws on failure.
- Don't put absolute paths in `config.ts` or in any reference here — qavajs projects are checked into source control and run on CI.
- Don't conflate `@qavajs/po`, `@qavajs/po-playwright`, and `@qavajs/steps-playwright/po` — they're related but distinct DSLs. See `references/page-object.md`.

## Live links (for re-checking)

- Docs: <https://qavajs.github.io>
- Org: <https://github.com/qavajs>
- Demo monorepo: <https://github.com/qavajs/demo>
- Core repo: <https://github.com/qavajs/core>
