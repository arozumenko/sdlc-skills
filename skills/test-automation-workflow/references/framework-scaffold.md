# Framework Scaffold (Fallback Only)

When a project has no existing test framework *and* the user explicitly
asks to bootstrap one, pick the minimal scaffold that matches the
project's language. **If any framework is already in place, extend it —
do not replace it.**

## Decision tree

```
Is there a test runner in the project already?
├── Yes → extend it. Stop reading this file.
└── No → what language is the app?
    ├── TypeScript / JavaScript  → Playwright (Node)
    ├── Python                   → pytest + playwright-python
    ├── Java                     → JUnit 5 + Playwright-Java (or Selenium if dictated)
    ├── C# / .NET                → NUnit + Playwright.NET
    ├── Go                       → Playwright-go + stdlib testing
    └── Other                    → stop and ask the user
```

The driving rule: UI automation should match the *app's* language unless
the project already decided otherwise. A Python backend with a React
frontend defaults to Playwright-Node if the test suite will primarily
cover UI, or Playwright-python if it needs to share fixtures with
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

## Non-negotiables regardless of framework

- `.env.example` in the repo; real `.env` in `.gitignore`
- `BASE_URL` is the minimum env var; credentials follow the same
  convention (`TEST_EMAIL`, `TEST_PASSWORD`, etc.)
- Page Object Model for UI — even one page, start the pattern now
- One assertion concept per test
- No hardcoded sleeps — use framework-native waits
- CI artifact paths: `test-results/{screenshots,reports,json}`
- The framework's config committed to the repo, no "works on my
  machine" global installs

## When you bootstrap

1. Announce what you're doing and why no framework existed.
2. Create the minimum above — no extras, no opinionated choices beyond
   the defaults.
3. Write **one** green smoke test so the wiring is proven.
4. Commit as a dedicated PR (`chore(test): bootstrap Playwright`) —
   separate from any test-automation work.
5. Only then run the actual automation workflow.
