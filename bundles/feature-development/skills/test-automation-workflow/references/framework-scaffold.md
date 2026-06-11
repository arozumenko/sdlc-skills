# Framework Scaffold (Greenfield Only)

## Contents

- [The two paths](#the-two-paths)
- [Decision flow (tech-lead)](#decision-flow-tech-lead)
- [Playwright (TypeScript) — minimal](#playwright-typescript-minimal)
- [pytest + playwright-python — minimal](#pytest-playwright-python-minimal)
- [JUnit 5 + Playwright-Java — minimal](#junit-5-playwright-java-minimal)
- [NUnit + Playwright.NET — minimal](#nunit-playwrightnet-minimal)
- [Non-negotiables regardless of path](#non-negotiables-regardless-of-path)
- [When you bootstrap (tech-lead's procedure)](#when-you-bootstrap-tech-leads-procedure)

When a project has no existing test framework *and* tech-lead has
approved a bootstrap. **If any framework is already in place, extend
it — do not replace it.** This file is the menu tech-lead picks from;
Axel doesn't pick.

## The two paths

There are two valid greenfield scaffolds. They differ in how much
structure ships on day 1. Tech-lead picks one and writes the decision
into `.agents/testing.md` § Structure before Axel writes a line of test
code.

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

Pick this when tech-lead can justify it concretely:

- The project is already large enough that flat would mean hundreds of
  spec files without structure
- A sibling project / org-wide convention enforces a particular shape
  (compliance, audit, contract)
- Humans will author tests alongside the agents and want a familiar
  layout

In that case, tech-lead specifies:

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

## Decision flow (tech-lead)

```
Is there a test runner in the project already?
├── Yes → extend it. Stop reading this file.
└── No → is there a concrete reason for the upgraded path?
    │   (scale / sibling convention / human authoring)
    │
    ├── Yes → upgraded path, document in `.agents/testing.md`
    └── No  → default path

What language is the app?
├── TypeScript / JavaScript  → Playwright (Node)
├── Python                   → pytest + playwright-python
├── Java                     → JUnit 5 + Playwright-Java (or Selenium if dictated)
├── C# / .NET                → NUnit + Playwright.NET
├── Go                       → Playwright-go + stdlib testing
└── Other                    → stop and ask the user
```

The language rule still holds: UI automation should match the app's
language unless the project already decided otherwise. A Python backend
with a React frontend defaults to Playwright-Node if the suite is
primarily UI, or Playwright-python if it needs to share fixtures with
existing backend tests.

## Playwright (TypeScript) — minimal

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

## pytest + playwright-python — minimal

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

## JUnit 5 + Playwright-Java — minimal

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

## NUnit + Playwright.NET — minimal

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

## Non-negotiables regardless of path

- `.env.example` in the repo; real `.env` in `.gitignore`
- `BASE_URL` is the minimum env var; credentials follow the same
  convention (`TEST_EMAIL`, `TEST_PASSWORD`, etc.)
- One assertion concept per test
- No hardcoded sleeps — use framework-native waits
- CI artifact paths: `test-results/{screenshots,reports,json}`
- The framework's config committed to the repo, no "works on my
  machine" global installs
- Locator ladder: `getByRole` (accessible name) → `getByTestId` →
  `getByLabel`/`getByPlaceholder` → `getByText` → CSS/XPath last resort
  (with comment). Stop+flag rather than fall back to brittle CSS when
  test IDs are missing and roles/labels are insufficient.

**Path-dependent:** Page Object Model is required on the **upgraded
path** only. On the **default path** it emerges when 3+ tests duplicate
the same locator block — not before.

## When you bootstrap (tech-lead's procedure)

1. Announce the path and why (default vs upgraded; concrete reason if
   upgraded).
2. Create the minimum scaffold for the chosen path — no extras, no
   opinionated additions beyond the defaults.
3. Write **one** green smoke test so the wiring is proven.
4. Commit as a dedicated PR (`chore(test): bootstrap <framework>`) —
   separate from any test-automation work.
5. Write the conventions you just chose into `.agents/testing.md`
   (§ Framework, § Structure, § Conventions to follow).
6. Hand off to Axel for the first real case.
