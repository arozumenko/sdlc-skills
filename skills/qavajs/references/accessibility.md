# accessibility.md — a11y audits via `steps-accessibility` (axe-core) and `steps-accessibility-ea` (IBM Equal Access)

Two independent step packages, **interchangeable in Gherkin** because they register identical step phrases. Pick one, install one — installing both yields "ambiguous step definition" errors.

Source of truth: <https://qavajs.github.io/docs/Steps/accessibility>, <https://qavajs.github.io/docs/Steps/accessibility-ea>

## Choose the engine

| Engine | Package | When to use |
|---|---|---|
| **axe-core** (Deque) | `@qavajs/steps-accessibility` | Default. Most widely used, well-documented, broad rule coverage, CI-friendly. |
| **IBM Equal Access** | `@qavajs/steps-accessibility-ea` | When your org standardises on IBM's accessibility-checker, or you need its richer severity tiers (`violation` / `potentialviolation` / `recommendation`). |

Both engines work on top of either Playwright or WebdriverIO.

## ⚠️ Critical: don't install both at once

Both packages register exactly the same step text:

```
I perform accessibility check
I perform accessibility check:
I perform accessibility check and save results as {value}
I perform accessibility check and save results as {value}:
```

If both `steps-accessibility` and `steps-accessibility-ea` end up in `config.require`, qavajs throws **ambiguous step definition** at parse time. Pick one per project, OR — if you must run both engines — author project-local custom steps with distinct phrases (e.g. `I perform axe accessibility check`, `I perform ea accessibility check`) using `Override` or `executeStep` to call each engine.

## axe-core flavour (`@qavajs/steps-accessibility`)

### Install + configure

```bash
npm install @qavajs/steps-accessibility
```

```typescript
export default {
    require: [
        'node_modules/@qavajs/steps-playwright/index.js',     // or steps-wdio
        'node_modules/@qavajs/steps-accessibility/index.js',  // load AFTER the driver
    ],
    format: [
        ['@qavajs/html-formatter', 'report.html'],            // axe attaches its HTML report
    ],
};
```

### Steps

```gherkin
# fail on any violation
When I perform accessibility check

# pass an axe.run options object
When I perform accessibility check:
  """
  {
    "runOnly": ["wcag2a", "wcag2aa"],
    "context": ["main"],
    "saveAs": "results/report.json"
  }
  """

# capture the report into memory; never throws
When I perform accessibility check and save results as 'axeReport'
Then I expect '$axeReport.violations.length' to equal '0'
```

Options accept everything axe's [`axe.run`](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#api-name-axerun) takes, **plus** two qavajs extras:

| Property | Type | What it does |
|---|---|---|
| `context` | `string[]` | CSS selectors scoping the analysis (in addition to `include`/`exclude`) |
| `saveAs` | `string` | Path to dump the raw JSON results |

### Result shape (when saved to memory)

`$axeReport` is the standard [axe results object](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#results-object):

| Path | Type | Meaning |
|---|---|---|
| `$axeReport.violations` | `Result[]` | rules that failed |
| `$axeReport.violations[i].id` | string | rule id (e.g. `color-contrast`) |
| `$axeReport.violations[i].impact` | `'minor' \| 'moderate' \| 'serious' \| 'critical'` | severity |
| `$axeReport.violations[i].nodes[j].target` | string[] | CSS selectors for offending elements |
| `$axeReport.passes` | `Result[]` | rules that passed |
| `$axeReport.incomplete` | `Result[]` | rules that need manual review |
| `$axeReport.inapplicable` | `Result[]` | rules that didn't apply to this page |

## IBM Equal Access flavour (`@qavajs/steps-accessibility-ea`)

### Install + configure

```bash
npm install @qavajs/steps-accessibility-ea
```

```typescript
export default {
    require: [
        'node_modules/@qavajs/steps-playwright/index.js',         // or steps-wdio
        'node_modules/@qavajs/steps-accessibility-ea/index.js',   // load AFTER the driver
    ],
    format: [['@qavajs/html-formatter', 'report.html']],
};
```

Add an `.achecker.yml` (or pass `aceDir` in EA config) per [IBM's setup docs](https://github.com/IBMa/equal-access/blob/master/accessibility-checker/src/README.md#configuration) if you want non-default policies.

### Steps (same Gherkin text as axe!)

```gherkin
When I perform accessibility check
When I perform accessibility check:
  """
  {
    "context": "[aria-label='main navigation']",
    "outputFormat": ["html", "json"],
    "failLevels": ["violation"],
    "reportLevels": ["violation", "potentialviolation", "recommendation"]
  }
  """
When I perform accessibility check and save results as 'report'
Then I expect '$report.summary.counts.violation' to equal '0'
```

EA-specific options:

| Property | Type | Meaning |
|---|---|---|
| `context` | `string` | CSS selector to scope the audit |
| `outputFormat` | `('html' \| 'json' \| 'csv' \| 'xlsx' \| 'disable')[]` | which report formats to generate |
| `failLevels` | `('violation' \| 'potentialviolation' \| 'recommendation')[]` | issue levels that fail the step |
| `reportLevels` | same | levels to include in the report |

### Result shape

`$report.summary.counts.<level>` gives counts per severity. `$report.results[]` holds the individual issues with selectors and rule IDs.

## Common shapes

### Page-level smoke check on every navigation

```gherkin
Background:
  Given I open '$baseUrl' url

Scenario: Home page is a11y-clean
  Then I perform accessibility check
```

Tag with `@a11y` and run on a smaller cadence than full UI smoke if the page count is large — a11y checks add ~1–3 s per scenario.

### Soft-fail with explicit budget

```gherkin
Scenario: Cart page allows minor violations only
  Given I open '$baseUrl/cart' url
  When  I perform accessibility check and save results as 'a11y'
  Then  I expect '$a11y.violations' to softly have length '0'
  And   I expect '$js($a11y.violations.filter(v => v.impact === "critical").length)' to equal '0'
  And   I expect '$js($a11y.violations.filter(v => v.impact === "serious").length)' to equal '0'
```

The save-form never throws, so you can express graduated budgets explicitly.

### Scoped to a specific component

```gherkin
When I perform accessibility check:
  """
  { "context": ["[data-testid='checkout-form']"], "runOnly": ["wcag2a", "wcag2aa"] }
  """
```

## Caveats

- **Both engines tag dynamic content as violations** if it loads after audit. Wait for the page to settle (`I refresh page until 'Spinner' not present`) before auditing.
- **Color-contrast rules are the noisiest.** If you audit on a CI Linux box without the same fonts/anti-aliasing as designers' Macs, expect drift. Pin `runOnly: ["wcag2a"]` for blocking checks; keep `wcag2aa`/`wcag2aaa` advisory.
- **`context` semantics differ.** axe takes a `string[]` of selectors; EA takes a single `string`. Don't paste options between engines.
- **EA requires network access** to download policies on first run; cache `~/.cache/accessibility-checker` in CI.

## Live links

- axe step catalog: [`steps-accessibility.md`](steps-accessibility.md)
- EA step catalog: [`steps-accessibility-ea.md`](steps-accessibility-ea.md)
- Source — axe binding: <https://github.com/qavajs/steps-accessibility>
- Source — EA binding: <https://github.com/qavajs/steps-accessibility-ea>
- axe-core docs: <https://github.com/dequelabs/axe-core/blob/develop/doc/API.md>
- IBM Equal Access docs: <https://github.com/IBMa/equal-access/blob/master/accessibility-checker/src/README.md>
