# lighthouse.md — `@qavajs/steps-lighthouse` for performance / SEO / a11y audits

Runs Google Lighthouse against the current page (driven by Playwright or WebdriverIO), attaches the HTML report to the Cucumber output, and exposes the raw results in memory for further assertions.

Source of truth: <https://qavajs.github.io/docs/Steps/lighthouse>, <https://github.com/qavajs/steps-lighthouse>

## Installation

```bash
npm install @qavajs/steps-lighthouse
```

## Configuration

The driver library must be loaded **before** `steps-lighthouse`:

```typescript
export default {
    require: [
        'node_modules/@qavajs/steps-wdio/index.js',          // or steps-playwright
        'node_modules/@qavajs/steps-lighthouse/index.js',
    ],
    format: [
        ['@qavajs/html-formatter', 'report.html'],           // Lighthouse attaches its own HTML report into Cucumber attachments
    ],
};
```

## Steps (3 total)

```gherkin
When I perform lighthouse audit and save results as 'lh'
When I perform lighthouse audit and save results as 'lh':
  """
  { "extends": "lighthouse:default", "settings": { ... } }
  """
```

Full patterns → [`steps-lighthouse.md`](steps-lighthouse.md).

## Common shapes

### Smoke audit with the default config

```gherkin
Scenario: Home page meets Lighthouse defaults
  Given I open '$baseUrl' url
  When  I perform lighthouse audit and save results as 'lh'
  Then  I expect '$lh.lhr.categories.performance.score' to be greater than '0.7'
  And   I expect '$lh.lhr.categories.accessibility.score' to be greater than '0.9'
  And   I expect '$lh.lhr.categories["best-practices"].score' to be greater than '0.85'
  And   I expect '$lh.lhr.categories.seo.score' to be greater than '0.9'
```

### Custom config — desktop emulation

```gherkin
Scenario: Desktop performance budget
  Given I open '$baseUrl' url
  When  I perform lighthouse audit and save results as 'lh':
    """
    {
      "extends": "lighthouse:default",
      "settings": {
        "formFactor": "desktop",
        "screenEmulation": {
          "mobile": false,
          "width": 1350,
          "height": 940,
          "deviceScaleFactor": 1,
          "disabled": false
        },
        "throttlingMethod": "simulate"
      }
    }
    """
  Then  I expect '$lh.lhr.audits["largest-contentful-paint"].numericValue' to be less than '2500'
  And   I expect '$lh.lhr.audits["cumulative-layout-shift"].numericValue' to be less than '0.1'
```

### Audit only specific categories

```gherkin
When I perform lighthouse audit and save results as 'lh':
  """
  {
    "extends": "lighthouse:default",
    "settings": {
      "onlyCategories": ["performance", "accessibility"]
    }
  }
  """
```

## Result shape

`$lh` is the result of the underlying `lighthouse(url, ...)` call. Keys you'll use:

| Path | Type | Meaning |
|---|---|---|
| `$lh.lhr.categories.performance.score` | number 0–1 | weighted performance score |
| `$lh.lhr.categories.accessibility.score` | number 0–1 | weighted a11y score |
| `$lh.lhr.audits["<id>"].numericValue` | number | individual metric (e.g. `largest-contentful-paint`, `total-blocking-time`) |
| `$lh.lhr.audits["<id>"].score` | number 0–1 or null | per-audit score |
| `$lh.lhr.audits["<id>"].displayValue` | string | pretty value (e.g. `"2.5 s"`) |
| `$lh.lhr.runWarnings` | string[] | env warnings (e.g. throttling missing) |
| `$lh.report` | string (HTML) | full report; the package attaches it automatically |

## Caveats

- **Lighthouse drives a fresh Chrome via remote debugging port** — it does not reuse the Playwright/WDIO browser. The audit takes ~10–30 s; treat the audit step as expensive and don't sprinkle it across every scenario.
- **Tag a small set of `@perf` scenarios and run them only on `main` / nightly** — full Lighthouse on every PR is rarely worth the time.
- **CI determinism**: throttling defaults vary on CI runners. Pin `throttlingMethod` to `"simulate"` (CPU-modelled) or `"provided"` (off) to keep numbers comparable.
- **Soft assertions are your friend** for perf budgets: `to softly be greater than` lets you collect *all* threshold breaches in one run.
- **Bundle size with the HTML report**: per-scenario reports add ~300 KB each. Keep the audit count modest or strip the HTML attachment in CI.

## Live links

- Step catalog: [`steps-lighthouse.md`](steps-lighthouse.md)
- Source: <https://github.com/qavajs/steps-lighthouse>
- Docs: <https://qavajs.github.io/docs/Steps/lighthouse>
- Lighthouse config schema: <https://github.com/GoogleChrome/lighthouse/blob/main/docs/configuration.md>
