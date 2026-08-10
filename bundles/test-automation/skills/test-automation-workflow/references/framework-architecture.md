# Framework architecture — orchestrator reference

Rare-path playbook section, loaded on demand: greenfield bootstrap,
framework-scale work, mid-flow architectural escalation, reporter review.
When a slot returns `needs-escalation` with a framework gap, load this file
(and the `plan-feature` skill if a written plan is warranted) and follow the
matching flow.

## Framework architecture

The orchestrator absorbs the three framework-architecture responsibilities that previously routed through tech-lead. Tech-lead remains the system architect for application code; the orchestrator is the architect for the test framework.

### The division of labour — you plan, the implementer writes the code

**You do NOT edit framework code yourself.** The tool-edit guardrail (orchestrator's own AGENT.md should carry the path-specific stops) applies here too — the framework config (`playwright.config.*` / `cypress.config.*` / `pytest.ini` / `pom.xml`), the abstraction layer (`pages/**`), `fixtures/**`, `package.json`, etc. are off-limits to your `Edit` / `Write` tool. The pattern is the same one PM uses with devs:

| You (orchestrator) | Implementer |
|---|---|
| Decide the framework choice, scaffold shape, fixture pattern, reporter wiring | Write the actual config files, abstraction layer (page objects / API clients / screen objects), fixtures, test runner setup |
| Write the plan into `.agents/testing.md` / `.agents/test-automation.yaml` | Read the plan, execute it in a feature branch, open the PR |
| Pair on the PR review since the change is architectural | Return Run Report with PR URL |

Your editable paths in this section are limited to:

- `.agents/testing.md` — framework conventions, run commands, stable-handle strategy (locator strategy for UI), **Reporters** sub-section
- `.agents/test-automation.yaml` — TMS adapter + framework block
- `.agents/architecture.md` — when the test-framework decision interacts with system-side architecture (rare)

Everything else — config files, the abstraction layer (page objects / API clients / screen objects), fixtures, package manifests — is **dispatched** to the implementer with an explicit plan. If you find yourself reaching for `Edit` on the framework config (e.g. `playwright.config.ts`), stop and dispatch instead.

### 1. Greenfield framework bootstrap

No existing test framework in the repo. Your call to make, the implementer's hands to write it:

- Pick the scaffold per project surface and language from [`framework-scaffold.md`](./framework-scaffold.md) — match the project's surface (UI / API / mobile / perf) and primary language; don't import a foreign stack. (For a UI/TypeScript app that resolves to Playwright; an API suite to the language's HTTP-test stack; and so on — the file carries the worked examples.)
- Define the initial conventions: the project's abstraction-layer style (page object for UI, API client / service object / screen object on other surfaces), fixture pattern, naming, run command, CI command. **Write these into `.agents/testing.md` yourself** so downstream agents inherit them.
- Decide the TMS adapter with the operator (Xray / Zephyr / TestRail / Azure / markdown fallback — see [`tms-adapters.md`](./tms-adapters.md)).
- **Keep the scaffold minimal — no unsolicited integrations.** The plan covers runner + config + abstraction layer + fixtures + one smoke test + run/CI command, and nothing else. It does NOT wire a TMS/result reporter, analytics, or other network integrations unless the task explicitly asks **or** `.agents/test-automation.yaml` declares the TMS sync (and then gated per [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Phase 5 — Debug). A bootstrap that silently wires an opinionated integration is the `jira-reporter`-on-every-local-run failure — don't let the plan include one.
- **Dispatch the implementer** with the plan: "Scaffold the test framework per `.agents/testing.md` (just written). Create the framework config, the abstraction-layer base (e.g. a `pages/` base class for a UI suite, an API-client module for a service suite), an auth/setup helper, and a smoke test proving the scaffold works. Do NOT add any TMS/result reporter, analytics, or network integration unless the plan explicitly names it. Return a Run Report when the smoke is green."

### 2. Framework-scale work

New fixture infrastructure, a new abstraction-layer base (page-object base class for UI; API-client / screen-object / scenario-module base on other surfaces), an operator-mandated suite migration to a new framework or pattern, CI pipeline changes, framework version upgrades, new TMS adapter beyond the supported set. Flow:

1. **Plan the change** — interface contract, migration shape, blast radius, rollout order. Use `plan-feature` for non-trivial planning. Update `.agents/testing.md` with the new convention so downstream agents see it.
2. **Dispatch the implementer to execute** — with a concrete prompt naming the files to touch, the new pattern to apply, and any migration steps. Implementer writes the code.
3. **Pair with the reviewer slot on the PR** — this is one of the few cases where you also review the PR yourself, because the change is architectural, not a single-test deliverable. You're checking the implementer followed your plan; the reviewer slot is checking test honesty + stable handles (selectors for UI) as usual.

### 3. Mid-flow architectural escalation

Analyst or implementer returns `needs-escalation` — an AFS or partial implementation surfaced a gap the existing conventions don't cover. Examples: a new shared auth-state pattern, a cross-cutting page-object refactor that can't stay local, a new test type that needs a new fixture primitive.

Pause the case. **Plan the resolution; update `.agents/testing.md` with the new convention; dispatch the implementer to execute.** Do not write the fixture / page-object / config change yourself — that's still the implementer's hands on the keyboard. Once the implementer ships and the change is merged, resume the paused case from where it stopped so the next case doesn't re-escalate for the same reason.

### Reporter / logging review (additive changes from implementer)

The implementer's three-tier reporter authority — in-test logging (implementer's call) · additive reporter (implementer adds, you review) · reporter replacement/removal (yours alone, via `needs-escalation`) — is defined in [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Phase 5 — Debug → "When the artifacts aren't informative." This section is the orchestrator's side of the middle tier: what you review when a **secondary, additive** reporter lands in a PR.

When the implementer adds an additive reporter (Playwright `['list']` alongside `['junit']`, pytest `-v` plugin, Cypress `mocha-multi-reporters`, etc.), **review specifically for impact** before merging:

1. **The existing reporter output is unchanged.** TMS back-write, CI dashboards, and anything that parses the prior format must still see byte-for-byte equivalent output. If the diff touches the existing reporter's options or output file, that's a replacement, not an addition — block the PR.
2. **No significant runtime / disk cost.** Verbose stdout reporter is fine; a reporter that writes a 500MB trace per run is not. Eyeball the reporter's known behavior; ask the implementer for a one-run-cost estimate if uncertain.
3. **PR description flags the addition explicitly.** "Adds `['list']` reporter alongside existing `['junit']`" — if the description doesn't call it out, send the PR back for a clearer write-up rather than approving an invisible config change.

**If the reporter pushes results to the TMS / tracker** (a Playwright `jira-reporter`, an Xray results-import reporter, an adapter back-write — not a diagnostic-only reporter), additionally verify it is **gated + graceful + endpoint-validated** per the `test-automation-implementation` skill's [`references/reporters.md`](../../test-automation-implementation/references/reporters.md) § TMS / result-reporting reporters — gate them: gated on CI / an opt-in env flag (never fires on a local `npx playwright test` run), degrades gracefully offline (logs once, never per-test errors, never fails the run), and validates the TMS base URL (no redirect loop). An ungated TMS reporter spamming local runs is a defect to send back, not an addition to wave through; that file owns the full rule.

**Reporter replacement or removal is yours alone** (the `test-automation-implementation` skill, `references/reporters.md` — third tier), not the implementer's. Swapping `['junit']` for `['allure']`, changing an output schema, dropping a reporter — these are framework-scale decisions. Implementer returns `needs-escalation`; you plan the change, coordinate downstream consumers (TMS adapter, CI config, dashboards), then dispatch the implementer to execute. Add it to `.agents/testing.md` § Reporters so the next implementer inherits the rationale.

### When to involve tech-lead anyway

You **may** dispatch tech-lead when the framework change has cross-cutting application-code implications — e.g., adding a `data-testid` strategy that affects the application's frontend, or wiring an auth-state setup that needs an application-side API. Tech-lead handles the application-side decisions; you handle the test-framework decisions.
