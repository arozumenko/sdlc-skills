# formatters.md — reporting in qavajs

`format` in `config.ts` accepts a list of `[formatter, outputFile?]` tuples. Workers each emit events; the formatter handles aggregation. Formatters live in different packages — install only what you use.

## The kit

| Formatter | Package | Output | Best for |
|---|---|---|---|
| Console (qavajs flavour) | `@qavajs/console-formatter` | stdout | Local dev — colourised, interleaving-aware. |
| HTML | `@qavajs/html-formatter` | static HTML | Quick local report. |
| Cucumber's bundled HTML | (from `@cucumber/cucumber`) | HTML | Stock cucumber report. |
| JUnit XML | `'junit'` | XML | CI integration / coverage tools. |
| Allure | `allure-cucumberjs/reporter` | results dir → `allure serve` | Rich dashboards, screenshots, trends. |
| ReportPortal | `@qavajs/format-report-portal` | ReportPortal API | EPAM ReportPortal SaaS / self-hosted. |
| Xray | (`@qavajs/format-xray` or similar) | Xray Cloud / DC | Jira-integrated test management. |

## The canonical config

```typescript
format: [
    ['@qavajs/console-formatter'],
    ['@qavajs/html-formatter', 'report/report.html'],
    ['junit', 'report/junit.xml'],
    ['allure-cucumberjs/reporter', 'allure-results/out.txt'],
],
formatOptions: {
    console: { showLogs: true },        // surface this.log() output
},
```

Add or remove tuples to taste. The runner does not de-dupe — each formatter sees every event independently.

## Console formatter (`@qavajs/console-formatter`)

Drop-in replacement for the stock console formatter. Highlights:

- Worker prefixes for parallel runs.
- Failure summaries at the bottom of the run.
- Configurable `showLogs` to forward `this.log(...)` calls.
- Step duration markers helpful for spotting flakiness.

Source: <https://github.com/qavajs/console-formatter>

## HTML formatter (`@qavajs/html-formatter`)

Standalone single-file HTML report with embedded screenshots/videos when the runner attaches them (Playwright `screenshot`/`video` config attaches automatically when `attach: true`).

Source: <https://github.com/qavajs/html-formatter> (referenced from demos)

## Allure

Install `allure-cucumberjs` and the Allure CLI. Add the reporter to `format`. Build with:

```bash
allure generate allure-results -o allure-report --clean
allure open allure-report
```

In `package.json`:

```json
{
  "scripts": {
    "test": "qavajs run --config config.ts",
    "report": "allure generate allure-results -o allure-report --clean && allure open allure-report"
  }
}
```

The Playwright runner automatically attaches screenshots / traces / videos when `attach: true` in their respective blocks.

## ReportPortal (`@qavajs/format-report-portal`)

EPAM-built formatter that streams events to a ReportPortal server. Requires:

- A ReportPortal endpoint and API token (env vars).
- `formatOptions.reportportal` block with `endpoint`, `project`, `apiKey`, `launch`, `attributes`, `description`.

Source: <https://github.com/qavajs/format-report-portal>

## Choosing your stack

- **Local-only dev**: console + HTML.
- **CI with PR checks**: JUnit (PR annotation) + Allure (artifact) + console.
- **Org-wide visibility**: ReportPortal or Allure-server.
- **Jira-managed test cases**: Xray.

## Live links

- Formatter overviews: <https://qavajs.github.io/docs/Formatters/>
