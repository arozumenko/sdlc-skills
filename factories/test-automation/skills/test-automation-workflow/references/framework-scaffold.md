# Framework Scaffold (Greenfield Only)

## Contents

- [The two paths](#the-two-paths)
- [Decision flow (the orchestrator, test-automation-lead by default)](#decision-flow-the-orchestrator-test-automation-lead-by-default)
- [Worked example — Playwright (TypeScript) — minimal](#worked-example--playwright-typescript-minimal)
- [Worked example — pytest + playwright-python — minimal](#worked-example--pytest-playwright-python-minimal)
- [Worked example — JUnit 5 + Playwright-Java — minimal](#worked-example--junit-5-playwright-java-minimal)
- [Worked example — NUnit + Playwright.NET — minimal](#worked-example--nunit-playwrightnet-minimal)
- [Other surfaces — brief stubs](#other-surfaces--brief-stubs)
- [Non-negotiables regardless of path](#non-negotiables-regardless-of-path)
- [When you bootstrap (the orchestrator's procedure)](#when-you-bootstrap-the-orchestrators-procedure)

When a project has no existing test framework *and* the orchestrator
(test-automation-lead by default) has approved a bootstrap. **If any
framework is already in place, extend it — never replace it uninvited.**
An operator-mandated migration to a new framework or pattern is a
different thing: that is framework-scale work — plan it per
[orchestration-playbook.md § Framework architecture → 2. Framework-scale
work](./orchestration-playbook.md#2-framework-scale-work) and migrate
incrementally. This file is the menu the orchestrator
(test-automation-lead by default) picks from; the implementer doesn't
pick.

Scaffold **whatever the project uses** — the surface under test and the
app's stack drive the choice, not a default tool. The Playwright
scaffolds below are the most fully-worked example because UI is the
bundle's most exercised surface; they are *one* worked path among
others, not the privileged answer. For an API, mobile, or performance
suite, scaffold that surface's idiomatic framework the same way (see
[Other surfaces](#other-surfaces--brief-stubs)).

## The two paths

There are two valid greenfield scaffolds. They differ in how much
structure ships on day 1. The orchestrator (test-automation-lead by
default) picks one and writes the decision into `.agents/testing.md`
§ Structure before the implementer writes a line of test code.

### Default path — flat, primitive-heavy, AI-friendly

**Pick this unless you have a concrete reason for the upgraded path.**

The driving rule: optimize for an AI agent *reading and extending tests
100 times*, not for a human authoring them once. Every layer of
indirection (page object base classes, custom DSLs, deep fixture
hierarchies, separate steps folders) is a layer the agent has to load
and reason through before producing one useful line of test code.
Flat code is cheap to read and easy to extend correctly.

What "flat" means concretely:

1. **Use the framework's primitives directly.** `test.beforeEach`,
   `expect`, `getByRole` for Playwright; `pytest.fixture` and
   `@pytest.mark.parametrize` for pytest. No Page Object Model, no
   custom fixture base classes, no separate `steps/` folder.
2. **One flat folder of specs.** `tests/<area>.spec.ts` (or
   `tests/test_<area>.py`), grouped by feature, not by ticket ID.
3. **Add layers only when duplication forces it.** Same locator in 3+
   tests → page object for that surface. Same setup in 3+ tests →
   extract a fixture. Same string in 3+ tests → helper.
4. **Capture conventions as they emerge.** After ~10 working tests,
   write `.agents/testing.md` describing what shape actually crystallised
   so the next session matches it.

### Upgraded path — structured scaffold from day 1

Pick this when the orchestrator (test-automation-lead by default) can
justify it concretely:

- The project is already large enough that flat would mean hundreds of
  spec files without structure
- A sibling project / org-wide convention enforces a particular shape
  (compliance, audit, contract)
- Humans will author tests alongside the agents and want a familiar
  layout

In that case, the orchestrator (test-automation-lead by default)
specifies:

- `tests/specs/` — feature-grouped test files
- `tests/pages/` with `base.page.ts` — Page Object Model
- `tests/fixtures/` — explicit fixtures
- `tests/helpers/` — utility functions grouped by topic
- `tests/data/` — test data, environment-scoped if needed
- Page object methods are intent-level (`login()`, `applyPromoCode()`),
  not raw selector wrappers
- Steps are inline `test.step()` blocks OR extracted to `tests/steps/` —
  pick one and stick with it

The minimal scaffolds in the language sections below assume **default
path**. The upgraded path layers the directories above onto the same
foundations.

## Decision flow (the orchestrator, test-automation-lead by default)

```
Is there a test runner in the project already?
├── Yes → extend it. Replace only on an operator-mandated migration —
│         framework-scale work: plan per orchestration-playbook.md
│         § Framework architecture → 2, migrate incrementally.
└── No → is there a concrete reason for the upgraded path?
    │   (scale / sibling convention / human authoring)
    │
    ├── Yes → upgraded path, document in `.agents/testing.md`
    └── No  → default path

What surface does this suite drive?
├── UI (browser)        → see the language rows below
├── API / service       → the language's idiomatic HTTP-test stack
│                          (pytest + httpx / RestAssured / supertest / xUnit + HttpClient)
├── Mobile              → the platform's driver (Appium, Espresso, XCUITest, …)
├── Performance / load  → a load tool (k6, Gatling, JMeter, Locust)
└── Other / unsure      → the surface's idiomatic stack from its official
                           docs (same discipline as the rows above);
                           ask only when genuinely ambiguous

For a UI suite, what language is the app?
├── TypeScript / JavaScript  → Playwright (Node)  ·  Cypress / WebdriverIO if dictated
├── Python                   → pytest + playwright-python
├── Java                     → JUnit 5 + Playwright-Java (or Selenium if dictated)
├── C# / .NET                → NUnit + Playwright.NET
├── Go                       → Playwright-go + stdlib testing
└── Other                    → the language's idiomatic stack from its
                               official docs (same discipline as the rows
                               above); ask only when genuinely ambiguous
```

The language rule holds *within a surface*: match the app's language and
the suite's surface unless the project already decided otherwise. A
Python backend with a React frontend drives its UI suite with
Playwright-Node, or Playwright-python if it needs to share fixtures with
existing backend tests; its API suite stays in the backend's own
test stack. The rows above name the common default per language — they
are starting points, not mandates. If the project already leans toward
another framework on that surface (Cypress, Selenium, RestAssured), that
is the right answer; conform to it.

## Worked example — Playwright (TypeScript) — minimal

```
tests/
  pages/
    base.page.ts
  fixtures/
    env.ts
  smoke.spec.ts
playwright.config.ts
.env.example
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { outputFolder: 'test-results/reports' }], ['json', { outputFile: 'test-results/json/run.json' }]],
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

`package.json` scripts:

```json
{
  "scripts": {
    "test": "playwright test",
    "test:ci": "playwright test --reporter=json,html",
    "test:headed": "playwright test --headed"
  }
}
```

## Worked example — pytest + playwright-python — minimal

```
tests/
  conftest.py
  pages/
    base_page.py
  test_smoke.py
pyproject.toml
.env.example
```

`conftest.py`:

```python
import os
import pytest
from playwright.sync_api import Page

@pytest.fixture(scope="session")
def base_url() -> str:
    url = os.environ.get("BASE_URL")
    if not url:
        pytest.fail("BASE_URL not set in environment")
    return url

@pytest.fixture
def authed_page(page: Page, base_url: str):
    page.goto(f"{base_url}/login")
    # ... login flow via env creds
    yield page
```

`pyproject.toml` (excerpt):

```toml
[project]
dependencies = [
  "pytest>=8.0",
  "pytest-playwright>=0.4",
  "python-dotenv>=1.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers"
```

## Worked example — JUnit 5 + Playwright-Java — minimal

```
src/test/java/
  com/company/app/
    pages/BasePage.java
    SmokeTest.java
pom.xml
.env.example
```

`pom.xml` (excerpt):

```xml
<dependencies>
  <dependency>
    <groupId>com.microsoft.playwright</groupId>
    <artifactId>playwright</artifactId>
    <version>1.47.0</version>
    <scope>test</scope>
  </dependency>
  <dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>5.10.0</version>
    <scope>test</scope>
  </dependency>
</dependencies>
```

## Worked example — NUnit + Playwright.NET — minimal

```
tests/
  Pages/BasePage.cs
  SmokeTests.cs
tests.csproj
.env.example
```

`tests.csproj` (excerpt):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Playwright.NUnit" Version="1.47.0" />
    <PackageReference Include="NUnit" Version="4.0.1" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.5.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.10.0" />
  </ItemGroup>
</Project>
```

## Other surfaces — brief stubs

The UI scaffolds above are fully worked because UI is the most exercised
surface. For a non-UI suite, scaffold that surface's idiomatic stack
with the *same* discipline — flat by default, env-driven config, one
green smoke first. These are starting points, not contracts; read the
framework's own docs and any neighbouring tests, then conform.

- **API / service suite.** A flat folder of request-level tests against a
  named base URL — e.g. `tests/<resource>.spec.ts` (supertest /
  Playwright `request`), `tests/test_<resource>.py` (pytest + httpx),
  `src/test/java/.../<Resource>IT.java` (RestAssured + JUnit). Config
  carries `API_BASE_URL` + auth env vars in place of `BASE_URL`. The
  smoke test is one real request asserting status + one named response
  field. The abstraction analogue to a page object is a thin **API
  client / service object** that centralizes the endpoint address and
  auth (see § Non-negotiables → stable handle).
- **Mobile suite.** The platform's driver (Appium / Espresso / XCUITest)
  with a flat folder of flows; config names the device/emulator target
  and the app build. The stable-handle ladder is accessibility-id → id →
  text; the abstraction analogue is a **screen object**.
- **Performance / load suite.** A load tool (k6 / Gatling / JMeter /
  Locust) with a scenario file per flow; config names the target URL,
  the virtual-user profile, and the **named metric + threshold** that
  is the assertion. The abstraction analogue is a **scenario module**.

## Non-negotiables regardless of path

- `.env.example` in the repo; real `.env` in `.gitignore`
- The suite's base address is the minimum env var (`BASE_URL` for a UI
  suite, `API_BASE_URL` for an API suite, the target host for load);
  credentials follow the same convention (`TEST_EMAIL`,
  `TEST_PASSWORD`, etc.)
- One assertion concept per test
- No hardcoded sleeps — use framework-native waits
- CI artifact paths: `test-results/{screenshots,reports,json}`
- The framework's config committed to the repo, no "works on my
  machine" global installs
- **Resolve the most stable, semantic handle for whatever you're
  observing.** UI worked example — the locator ladder: `getByRole`
  (accessible name) → `getByTestId` → `getByLabel`/`getByPlaceholder` →
  `getByText` → CSS/XPath last resort (with comment); stop+flag rather
  than fall back to brittle CSS when test IDs are missing and
  roles/labels are insufficient. The same discipline on other surfaces:
  API = a named response field-path / JSON-schema (not a brittle array
  index); mobile = accessibility-id → id → text; perf = a named metric
  + threshold.
- **Scaffold minimal — no unsolicited integrations.** A fresh scaffold contains
  only what's needed to *run tests*: the runner + its config, the abstraction
  layer, fixtures, ONE smoke test, the run/CI command. Do NOT wire integrations
  the task didn't ask for and the project doesn't declare — **especially anything
  that makes network calls**: TMS/result reporters (a Playwright `jira-reporter`,
  an Xray results-import reporter), analytics, dashboards, notification hooks. A
  TMS-reporting integration is opt-in — add it only when the task explicitly
  requests it **or** `.agents/test-automation.yaml` declares the TMS sync, and
  then gated + graceful per the `test-automation-implementation` skill's [`references/reporters.md`](../../test-automation-implementation/references/reporters.md). If an
  integration seems genuinely needed, propose it to the orchestrator and wait —
  never silently wire it. (A silent reporter that fires on every local
  `npx playwright test`, makes per-test network calls, and spams/fails offline is
  exactly the failure this prevents.)

**Path-dependent:** the project's abstraction layer (Page Object Model
for UI; API client / service object / screen object / scenario module on
other surfaces) is required on the **upgraded path** only. On the
**default path** it emerges when 3+ tests duplicate the same handle
block — not before. Extend the existing layer, don't duplicate it; keep
the address of the thing under test centralized.

## When you bootstrap (the orchestrator's procedure)

1. Announce the path and why (default vs upgraded; concrete reason if
   upgraded).
2. Create the minimum scaffold for the chosen path and surface — no
   extras, no opinionated additions beyond the defaults.
3. Write **one** green smoke test so the wiring is proven.
4. Commit as a dedicated PR (`chore(test): bootstrap <framework>`) —
   separate from any test-automation work.
5. Write the conventions you just chose into `.agents/testing.md`
   (§ Framework, § Structure, § Conventions to follow).
6. Hand off to the implementer for the first real case.
