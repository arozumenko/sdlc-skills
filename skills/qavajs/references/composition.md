# composition.md — composing tests in qavajs

Five primitives let you build large suites without duplicating step text or hooks. Pick the one that matches your problem.

## Decision matrix

| Problem | Use |
|---|---|
| Combine 2-5 existing steps into a new step in code | `executeStep` |
| Combine N existing steps into a new step purely in Gherkin | `Template` |
| Run an entire scenario from another scenario as setup | `executeTest` |
| Tag-scoped before/after with optional teardown | `Fixture` |
| One-time setup/teardown for the whole `qavajs run` | `BeforeExecution` / `AfterExecution` |
| Replace someone else's step implementation | `Override` |

All imports come from `@qavajs/core`.

## `executeStep` — code-level composition

Call any registered Gherkin step from inside another step:

```typescript
import { When, IQavajsWorld, DataTable } from '@qavajs/core';

When('I log in as {string}', async function (this: IQavajsWorld, username: string) {
    await this.executeStep(`I open '$baseUrl' url`);
    await this.executeStep(`I type '${username}' to 'Login Form > Username'`);
    await this.executeStep(`I type 'secret' to 'Login Form > Password'`);
    await this.executeStep(`I click 'Login Form > Button'`);
});
```

You can pass a `DataTable` (or a docstring) as a second argument when the underlying step expects one:

```typescript
await this.executeStep(`I fill following fields`, new DataTable([
    ['Order', '123'],
    ['Delivery Location', 'New York'],
]));
```

When to reach for it: parameterised macros that don't need to be visible in feature files.

## `Template` — Gherkin-level composition

Define a new step **whose body is more Gherkin**. The framework expands it lazily:

```typescript
import { When, Template } from '@qavajs/core';

When('I click {string} and verify {string}', Template((locator, expected) => `
    I click '${locator}'
    I expect '${locator} > Value' to equal '${expected}'
`));
```

Gherkin author writes:

```gherkin
When I click 'Total' and verify '$42'
```

When to reach for it: shared "click + assert" patterns, common UI flows, anything you'd want autocompleted by the VS Code plugin.

## `@qavajs/template` package — feature-file templates

> **The standalone `@qavajs/template` module is deprecated.** Its functionality lives in `@qavajs/core` now — both `Template((...) => '...')` shown above and the `templates: [...]` config option for `.feature`-file templates work without the extra package. The configuration shown below still works for backwards compatibility, but new projects should not add `@qavajs/template` as a dependency.

Same idea as `Template`, but the templates themselves live in `.feature` files. Activate the package, point to the templates, and they resolve as steps:

```typescript
// config.ts
export default {
    requireModule: ['@qavajs/template'],
    templates: ['templates/*.feature'],
    // ...
};
```

```gherkin
# templates/auth.feature
Scenario: I login as '<username>' with '<password>'
  When I open '$baseUrl' url
  And I type '<username>' to 'Login > Username'
  And I type '<password>' to 'Login > Password'
  And I click 'Login > Button'
```

```gherkin
# features/checkout.feature
Scenario: User checks out
  When I login as 'admin' with 'secret'
  Then I expect 'Header' to be visible
```

Special parameters: `<param>` (any value), `<qavajsMultiline>` (docstring body), key-value tables (column headers become parameters).

## `executeTest` — scenario-as-setup

Run another **complete scenario** by feature path + title:

```typescript
import { When } from '@qavajs/core';

When('I am logged in', async function () {
    await this.executeTest('features/Login.feature', 'User logs in');
});
```

When to reach for it: long pre-conditions you've already authored as a scenario; smoke chains where one journey is "checkout = login → add → pay".

Caveats: the called scenario shares the same `this`, so its assertions count, and its setup/teardown hooks run nested. If you only need a few steps, `executeStep` is lighter.

## `Fixture` — tagged setup/teardown

```typescript
import { Fixture } from '@qavajs/core';

Fixture({ name: 'pdp', tags: '@pdp' }, async function () {
    await this.playwright.page.goto('https://shop.example/pdp');
    // teardown is the returned function (optional)
    return async function () {
        await this.playwright.page.request.get('/api/cleanCart');
    };
});
```

```gherkin
@pdp
Scenario: Add item to cart
  When I click 'Add to Cart'
  Then I expect 'Cart Badge' to be visible
```

Why this beats raw `Before`/`After`:

- Tags are explicit and visible in feature files.
- Multiple fixtures can target overlapping tags.
- Teardown is co-located with setup.

## `BeforeExecution` / `AfterExecution` — suite-level lifecycle

Runs **once** for the whole `qavajs run`, before/after any worker spins up. Use for things that should outlive scenarios: spin up a Docker compose, seed a database, start a mock server.

```typescript
import { BeforeExecution, AfterExecution } from '@qavajs/core';
import { Server } from './server';

const server = new Server();
BeforeExecution(async function () { await server.start(); });
AfterExecution(async function () { await server.stop(); });
```

The deprecated `service` config field is the same idea but on its way out — migrate.

## `Override` — replace a step you don't own

When you import a step package and want one of its steps to do something different in your project:

```typescript
import { Override } from '@qavajs/core';

// step from a shared library: When('I log in', loginAsAdmin);
Override('I log in', async function () {
    await this.executeStep(`I open '$myBaseUrl' url`);
    // ... house-style login
});
```

Equivalent in spirit to monkey-patching, but with no "ambiguous step definition" error.

## Anti-patterns to avoid

- **Don't use `executeStep` to glue 50 steps together** — at that size, the macro is a scenario; reach for `executeTest` or write a real flow.
- **Don't use `Fixture` for global setup** — it runs per-tagged-scenario; for once-per-run use `BeforeExecution`.
- **Don't `Template` something a custom step would express more clearly.** Templates inflate Cucumber output and make stack traces harder to read.
- **Don't reach for `Override` to fork a library** — open a PR upstream first.

## Live links

- Core README composition section: <https://github.com/qavajs/core/blob/main/README.md>
- `@qavajs/template` source: <https://github.com/qavajs/template>
- Docs: <https://qavajs.github.io/docs/Commons/composing-steps>, <https://qavajs.github.io/docs/Modules/template>
