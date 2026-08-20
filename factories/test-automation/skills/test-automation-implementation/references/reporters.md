# Reporters — diagnostics tiers and TMS result-reporting gates

Read this when a run's artifacts are not informative enough to debug, or when
any reporter that posts results to a TMS / tracker is in play. The parent
[SKILL.md](../SKILL.md) § Phase 5 keeps the hard rule (never remove or replace
an existing reporter mid-PR); this file carries the mechanics.

**When the artifacts aren't informative.** Three tiers of logging enhancement, three different authorities:

| Tier | What to do | Authority |
|---|---|---|
| **In-test logging** — `test.step()` annotations, `console.log` for one-off noise, richer POM error messages | Add freely — local to the spec/POM, no config touched | Implementer's call |
| **Additive reporter** — wire a SECONDARY reporter alongside the existing one (Playwright `reporter: [['html'], ['junit'], ['list']]`, pytest `-v` plugin, Cypress `mocha-multi-reporters`, custom log file utility) | Implementer adds in the PR; **PR description flags the addition explicitly** so the orchestrator reviews specifically for: existing reporter output unchanged, CI/TMS consumers still work, no significant runtime/disk cost | Implementer adds, the orchestrator reviews — never silent |
| **Reporter replacement / removal** — swap `['junit']` for `['allure']`, change output schema, drop an existing reporter | Return `needs-escalation` to the orchestrator. Framework-scale decision; the existing reporter is almost certainly feeding TMS back-write or CI dashboards | the orchestrator only |

**Hard rule: never remove or replace an existing reporter mid-PR.** The reporter contract is downstream-facing. Additive is reversible (one line removed and you're back to baseline); replacement breaks integrations silently. If the existing reporter is "wrong format" or "noisy," that's a `needs-escalation` escalation.

**Recommended pattern: parallel verbose reporter.** Add a stdout-only reporter alongside the existing file reporter:

```ts
// playwright.config.ts — example
reporter: [
  ['html', { open: 'never' }],   // existing — keep verbatim
  ['junit', { outputFile: 'test-results/junit.xml' }],  // existing — keep verbatim
  ['list'],  // ADDED — stdout only, no file
],
```

The existing reporter's output file (`junit.xml` above) is unchanged, so anything parsing it (TMS adapter, CI pipeline, dashboard) keeps working. The stdout `['list']` gives the implementer richer console output during debug runs.

#### TMS / result-reporting reporters — gate them

The three-tier table above governs reporters added for **diagnostics** (richer console / extra report files). A different class of reporter **pushes results to the TMS / tracker** — a framework-wired reporter (e.g. a Playwright `jira-reporter` / an Xray results-import reporter) or an adapter back-write. Those need an extra discipline beyond "additive and reviewed":

**TMS result-reporting must be gated, graceful, and config-validated — never fire on every local run.** Any mechanism that posts results to the TMS / tracker — a framework-wired reporter (e.g. a Playwright `jira-reporter` / an Xray results-import reporter) or an adapter back-write — MUST:

1. **Gate on CI or an explicit opt-in env flag** (`process.env.CI`, `TMS_SYNC=1`, or the framework equivalent). A developer running the suite locally (`npx playwright test …`) to iterate must NOT trigger TMS network calls — default OFF locally.
2. **Degrade gracefully** — on missing credentials, an unreachable host, or an auth redirect, log ONCE and continue. Never emit a per-test error, never spam the console, never fail the test run. The test result is the product; TMS sync is a best-effort side-effect.
3. **Validate the endpoint before posting** — confirm the TMS base URL resolves without a redirect loop. (`redirect count exceeded` / a `fetch failed` repeated per test is the classic symptom of a wrong base URL or an auth redirect to a login page — fix the config or gate the reporter; don't let it spam.)

When you meet an ungated reporter spamming a local run, treat it as a defect to fix (gate it + make it graceful), not noise to ignore.
