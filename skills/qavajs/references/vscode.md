# vscode.md — qavajs VS Code extension

Test Explorer integration + Gherkin step autocomplete for qavajs projects.

Source of truth: <https://qavajs.github.io/docs/Guides/vscode>, <https://github.com/qavajs/vscode>, <https://marketplace.visualstudio.com/items?itemName=qavajs.qavajs>

## Install

Marketplace → search "qavajs" → Install. Or:

```bash
code --install-extension qavajs.qavajs
```

## What you get

- **Test Explorer**: every `Scenario` becomes a runnable item; click to run with `qavajs run` and stream output.
- **Step autocomplete**: as you type Gherkin, the extension suggests matching step phrases from registered packages.
- **Go-to-definition** for steps (jump from `.feature` to the `When(...)` call in the step source).

## Settings

Add to `.vscode/settings.json` (project-local) or your user settings:

```json
{
    "files.associations": {
        "*.feature": "cucumber"
    },
    "cucumber.features": [
        "features/**/*.feature"
    ],
    "cucumber.glue": [
        "node_modules/@qavajs/**/src/*.ts",
        "step_definitions/*.ts"
    ],
    "qavajs.launchCommand": "npx qavajs run --config config.ts"
}
```

| Setting | Purpose |
|---|---|
| `cucumber.features` | Where to find `.feature` files (array of glob patterns) |
| `cucumber.glue` | Where to find step definitions (qavajs packages + your custom steps) |
| `qavajs.launchCommand` | Command the Test Explorer runs. Override per-environment with `--profile`, `--memory-values`, etc. |
| `files.associations` | Treat `.feature` as Cucumber syntax for highlighting |

## Recommended companion extensions

- **Cucumber (Gherkin) Full Support** — richer Gherkin highlighting and snippets.
- **Playwright Test for VSCode** (if you also have a `@qavajs/playwright` standalone runner) — surfaces Playwright-test cases alongside qavajs.

## Caveats

- **`cucumber.glue` matters.** If a step package is missing from this list, autocomplete won't suggest its phrases — even though the test runs fine. Mirror your `config.require` array here.
- **Test Explorer runs the active profile.** If you have profile-specific timeouts (e.g. `headless`), invoke from CLI instead so the right profile applies, or pass `--profile` in `qavajs.launchCommand`.
- **Step autocomplete is regex-driven.** Templates like `'Component (text) > Field'` won't always autocomplete the parenthesised arg — you'll need to type the literal value yourself.

## WebStorm equivalent

A separate `webstorm-plugin` exists in the qavajs org (<https://github.com/qavajs/webstorm-plugin>) with similar Test Explorer integration. The IntelliJ-family configuration shape is similar.

## Live links

- Docs: <https://qavajs.github.io/docs/Guides/vscode>
- Extension repo: <https://github.com/qavajs/vscode>
- Marketplace: <https://marketplace.visualstudio.com/items?itemName=qavajs.qavajs>
