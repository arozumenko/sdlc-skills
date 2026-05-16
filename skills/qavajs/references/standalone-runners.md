# standalone-runners.md — choosing between cucumber-js mode and the standalone runners

By default qavajs runs on top of CucumberJS via `qavajs run` (`@qavajs/core`). For some teams a different runner topology fits better — qavajs ships **three standalone variants** that wrap a different test runner while keeping the same skills (memory, validation, page object, step packages):

| Runner | Package | Config files | When to pick it |
|---|---|---|---|
| **cucumber-js** (default, this skill's main subject) | `@qavajs/core` | `config.ts` | Most projects. Best ergonomics for Gherkin authors; richest formatter ecosystem. |
| **Playwright Test** | `@qavajs/playwright` | `qavajs.config.ts` + `playwright.config.ts` | Already invested in Playwright Test (`projects`, `expect()`-based fixtures, parallel browser-context model). Want Playwright's HTML report and trace viewer integration as the primary report. |
| **Playwright Test + WDIO fixtures** | `@qavajs/playwright-wdio` | `qavajs.config.ts` + `playwright.config.ts` | Need WebdriverIO's automation backend (e.g. real-device mobile) but want Playwright Test's runner topology. Niche — mostly useful when migrating from WDIO to Playwright Test gradually. |
| **Cypress** | `@qavajs/cypress` (+ `@qavajs/cypress-runner-adapter`) | `cypress.config.js` + Cypress support file | Already on Cypress and want Gherkin scenarios + qavajs memory/page-object. |

This skill is **primarily about cucumber-js mode**. Standalone modes share most concepts — locator DSL, memory expressions, validation phrases — but their config files and runner CLIs differ.

## Standalone Playwright (`@qavajs/playwright`)

```bash
npm init playwright
npm install @qavajs/playwright
```

```typescript
// qavajs.config.ts  ← yes, this name (NOT plain config.ts)
import { defineConfig } from '@qavajs/playwright';
import Memory from './memory';
import App from './page_object';

export default defineConfig({
    paths: ['features/*.feature'],
    require: [
        'node_modules/@qavajs/playwright/steps.js',
        'step_definitions/*.ts',
    ],
    memory: new Memory(),
    pageObject: new App(),
});
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testMatch: 'qavajs.config.ts',     // Playwright Test loads qavajs's config as a "test file"
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
});
```

Run:

```bash
npx playwright test                    # NOT npx qavajs run
npx playwright show-report             # Playwright HTML report; scenarios appear as test cases
```

What you gain over cucumber-js mode:

- Playwright's first-class report and trace integration (one URL → drill into the failure).
- Playwright `projects` matrix (browsers × viewports × envs) without writing profile spreads.
- Native Playwright fixtures (`use`, `extend`) alongside qavajs's `Fixture`.

What you lose:

- Cucumber-flavoured CLI (`--tags`, `--shard x/y`, `--memory-values`) — replaced by Playwright Test's CLI.
- Some formatters (Allure, ReportPortal) lose their cucumber-event source; they may need different adapters or be skipped.
- The `executeTest` primitive (cucumber-mode-only).

Demo: <https://github.com/qavajs/demo/tree/main/playwright-runner-v2>

## Standalone Playwright + WDIO fixtures (`@qavajs/playwright-wdio`)

Same shape as standalone Playwright but the underlying browser automation is WebdriverIO. Use Playwright Test's runner with WDIO's drivers and capabilities.

```typescript
// qavajs.config.ts
import { defineConfig } from '@qavajs/playwright';
import Memory from './memory';
import App from './page_object';

export default defineConfig({
    paths: ['features/*.feature'],
    require: ['node_modules/@qavajs/playwright-wdio/steps.js'],
    memory: new Memory(),
    pageObject: new App(),
});
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testMatch: 'qavajs.config.ts',
    projects: [
        {
            name: 'chrome',
            use: {
                wdioLaunchOptions: {
                    logLevel: 'error',
                    capabilities: {
                        browserName: 'chrome',
                        'goog:chromeOptions': { args: ['headless=new'] },
                    },
                },
            },
        },
    ],
});
```

Demo: <https://github.com/qavajs/demo/tree/main/playwright-wdio-runner>

## Standalone Cypress (`@qavajs/cypress` + `@qavajs/cypress-runner-adapter`)

```bash
npm install cypress
npm install @qavajs/cypress @qavajs/cypress-runner-adapter @qavajs/memory
```

```javascript
// cypress.config.js
const { defineConfig } = require('cypress');
const cucumber = require('@qavajs/cypress-runner-adapter/adapter');

module.exports = defineConfig({
    e2e: {
        specPattern: 'cypress/features/**/*.feature',
        supportFile: 'cypress/support/e2e.js',
        setupNodeEvents(on, config) {
            on('file:preprocessor', cucumber);
        },
    },
});
```

```typescript
// cypress/support/e2e.ts
import defineQavajs from '@qavajs/cypress/defineQavajs';
import '@qavajs/cypress';
import PageObject from '../../page_object';
import Memory from '../../memory';

defineQavajs({
    pageObject: new PageObject(),
    memory: new Memory(),
});
```

Run:

```bash
npx cypress open                       # interactive
npx cypress run                        # headless
TAGS='@smoke and not @wip' npx cypress run
MODE=it npx cypress open               # default 'describe' translates Scenario→describe / step→it; 'it' makes Scenario→it
```

Demo: <https://github.com/qavajs/demo/tree/main/cypress-v2>

What you gain: Cypress's time-travel debugger and reactive UI. What you lose: Cucumber's `--tags`/`--shard` flags (replaced by `TAGS=` env var), and some qavajs primitives that depend on the Cucumber lifecycle (`Fixture`, `BeforeExecution`/`AfterExecution`).

## How to choose — quick decision tree

```
Are you already using a non-cucumber runner?
├── Yes, Playwright Test  →  @qavajs/playwright (standalone-playwright)
├── Yes, Playwright Test + WDIO drivers  →  @qavajs/playwright-wdio
├── Yes, Cypress  →  @qavajs/cypress
└── No / starting fresh  →  cucumber-js mode (this skill's default — qavajs run)
```

If you're comfortable with vanilla Cucumber, **stay in cucumber-js mode**. The standalone runners are escape valves for organisations whose CI already understands a different runner.

## Caveats common to all standalone modes

- **`config.ts` vs `qavajs.config.ts` matters.** cucumber-js mode uses `config.ts`. Standalone Playwright modes use `qavajs.config.ts` (and pair it with `playwright.config.ts`). Don't mix them up — the `defineConfig` factory comes from a different package in each case.
- **Step packages aren't fully interchangeable.** `@qavajs/playwright` ships its own `steps.js` entrypoint distinct from `@qavajs/steps-playwright`. Don't `require` both in the same project.
- **Formatters need to match the runner.** Cucumber formatters (`@qavajs/console-formatter`, Allure-cucumberjs, ReportPortal) work in cucumber-js mode. Standalone modes lean on the host runner's reporter ecosystem.

## Live links

- Cucumber-js mode (default): this skill's [`architecture.md`](architecture.md)
- Standalone Playwright docs: <https://qavajs.github.io/docs/StandaloneSolutions/playwright>
- Standalone Playwright+WDIO docs: <https://qavajs.github.io/docs/StandaloneSolutions/playwright-wdio>
- Standalone Cypress docs: <https://qavajs.github.io/docs/StandaloneSolutions/cypress>
- Demos: <https://github.com/qavajs/demo>
