# architecture.md — qavajs runner, config, and CLI

The default runner is `@qavajs/core` — a CucumberJS extension invoked via `qavajs run`. All configuration is a default-export of an object from **`config.ts`**; named exports become CLI **profiles**.

> **Naming convention matters.** Cucumber-js mode (this page) uses **`config.ts`** at the project root. The standalone runners (`@qavajs/playwright`, `@qavajs/playwright-wdio`) instead use **`qavajs.config.ts`** *paired with* a `playwright.config.ts`, and they're invoked via `npx playwright test` rather than `qavajs run`. If you see `qavajs.config.ts` referenced in another project or doc, that's the standalone-runner topology — see [`standalone-runners.md`](standalone-runners.md).

Source of truth: <https://github.com/qavajs/core/blob/main/README.md>

## CLI: `qavajs run`

`npx qavajs run --config <config> [--profile <profile>] [...flags]`

`cucumber-js` is also exposed as an alias of `qavajs run` for parity with vanilla Cucumber.

| Flag | Type | Notes |
|---|---|---|
| `--config` | string | Path to the config file (`config.ts` by convention). |
| `--profile` | string | Pick a named export from the config (e.g. `headless`). |
| `--paths` | string[] | Override `paths` in config (feature files). |
| `--tags`, `-t` | string[] | Tag expression filter. Multiple flags are AND-ed. |
| `--format`, `-f` | string[] | Formatter name/path with optional output file. |
| `--format-options` | string | JSON options forwarded to formatters. |
| `--import`, `-i` | string[] | ESM support code paths. |
| `--require`, `-r` | string[] | CJS support code paths. |
| `--require-module` | string[] | Transpilers loaded via `require()` (e.g. `ts-node/register`). |
| `--name` | string[] | Scenario name regex filter. |
| `--order` | string | `defined` or `random`. |
| `--parallel` | number | Worker count. |
| `--retry` | number | Retry failing scenarios N times. |
| `--retry-tag-filter` | string[] | Tag expression scoping retries. |
| `--dry-run`, `-d` | boolean | Resolve everything without executing. |
| `--backtrace`, `-b` | boolean | Show full stacktraces. |
| `--fail-fast` | boolean | Stop on first failure. |
| `--force-exit` | boolean | `process.exit()` after the run. |
| `--strict` | boolean | Fail on pending steps. |
| `--shard` | string | `x/y` shard split (e.g. `1/4`, `2/4`, …). |
| `--world-parameters` | string | JSON injected into the Cucumber `World`. |
| `--memory-values` | string | JSON merged into the memory store at startup. |
| `--no-error-exit` | boolean | Always exit 0 even on test failures. |

All arguments are forwarded to child workers via the `CLI_ARGV` env var so step definitions can read them.

## Config schema (the `IQavajsConfig` interface)

The default export of `config.ts` is the **default profile**; any named export is a **named profile** selectable with `--profile`. Standard CucumberJS keys are accepted alongside the qavajs-specific ones.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `paths` | string[] | `[]` | Glob paths to `.feature` files. |
| `require` | string[] | `[]` | CJS step / hook files. **Required entry point for step packages** (`'node_modules/@qavajs/steps-playwright/index.js'`). |
| `import` | string[] | `[]` | ESM equivalent of `require`. |
| `requireModule` | string[] | `[]` | Transpiler modules — typically `['ts-node/register', '@qavajs/template']`. |
| `format` | (string | [string,string])[] | `[]` | Formatter list. Each entry is the formatter name or `[formatter, outputPath]`. |
| `formatOptions` | object | `{}` | Per-formatter JSON options (e.g. `{ console: { showLogs: true } }`). |
| `memory` | object | `{}` | A `Memory` instance (or any class with public fields). Registered with the memory singleton at boot. |
| `pageObject` | object | — | The root page-object class (registered with `po.register(...)`). |
| `defaultTimeout` | number | `10_000` | Per-step timeout in ms. |
| `parallel` | number | `1` | Worker count. |
| `tags` | string | `''` | Default tag expression. |
| `retry` | number | `0` | Default retry count. |
| `retryTagFilter` | string | `''` | Default retry tag expression. |
| `worldParameters` | object | `{}` | JSON forwarded to the Cucumber World. |
| `browser` | object | — | Runner-specific (Playwright/WDIO). See runner reference. |
| `service` | array | `[]` | **Deprecated.** Use `BeforeExecution`/`AfterExecution` instead. |
| `serviceTimeout` | number | `60_000` | **Deprecated.** |

Every key from CucumberJS's [configuration docs](https://github.com/cucumber/cucumber-js/blob/main/docs/configuration.md) is also valid here.

## Profiles in practice

```typescript
// config.ts
const defaultConfig = {
    paths: ['features/**/*.feature'],
    require: ['node_modules/@qavajs/steps-playwright/index.js'],
    memory: new Constants(),
    pageObject: new App(),
    browser: { capabilities: { browserName: 'chromium', headless: false } },
};

export const headless = {
    ...defaultConfig,
    browser: { ...defaultConfig.browser, capabilities: { browserName: 'chromium', headless: true } },
};

export const ci = {
    ...headless,
    parallel: 4,
    retry: 1,
    retryTagFilter: '@flaky',
};

export default defaultConfig;
```

```bash
qavajs run --config config.ts             # default
qavajs run --config config.ts -p headless # headless export
qavajs run --config config.ts -p ci       # parallel + retries
```

## World extensions (`IQavajsWorld`)

Inside any step definition, `this` is a Cucumber `World` augmented by `@qavajs/core`:

| Property/method | Description |
|---|---|
| `this.config` | The loaded config object (selected profile). |
| `this.memory` | The memory instance. |
| `await this.executeStep(stepText, dataTable?)` | Programmatically run a Gherkin step from inside another step. |
| `await this.executeTest(featurePath, scenarioTitle)` | Run another scenario inline. |
| `this.setValue(key, value)` | Set memory. Equivalent to `this.memory[key] = value` for a flat map. |
| `await this.getValue(expression)` | Resolve an expression (`'$user.name'`, `'$js(...)'`) against memory. |
| `await this.validation(phrase)` | Returns a validation function (e.g. `await this.validation('to equal')`). |

Typed steps:

```typescript
import { When, IQavajsWorld } from '@qavajs/core';

When('I do something', async function (this: IQavajsWorld) {
    const url = await this.getValue('$baseUrl');
    // ...
});
```

## Common config pitfalls

- **`require` paths are paths, not specifiers.** `'node_modules/@qavajs/steps-playwright/index.js'` works; `'@qavajs/steps-playwright'` does not (Cucumber treats them as files).
- **Order of `require` matters.** Custom `Override` calls must run after the package whose step they replace.
- **Memory must be an *instance***, not a class — `memory: new Constants()`, not `memory: Constants`.
- **`--memory-values` only sets top-level keys.** For nested overrides use a memory map function.
- **Profiles inherit by spread, not by chain.** Always `...defaultConfig` and override what you need; don't mutate the default.

## Live links

- Core README (canonical): <https://github.com/qavajs/core/blob/main/README.md>
- Configuration tutorial: <https://qavajs.github.io/docs/Commons/writing-tests>
- Standalone solutions (alternative runners): <https://qavajs.github.io/docs/StandaloneSolutions/>
