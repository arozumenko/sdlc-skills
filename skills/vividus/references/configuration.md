# Vividus Configuration Reference

Vividus configuration has three orthogonal axes — **suite**, **profile**, **environment** — plus an `overriding.properties` for local overrides and a master `configuration.properties`. CLI args (`-Pvividus.<key>=<v>`) sit on top.

Doc: https://docs.vividus.dev/vividus/latest/configuration/tests-configuration.html

---

## Files at a glance

| File | Purpose | Typical contents |
|---|---|---|
| `src/main/resources/properties/configuration.properties` | Master — declares which suites/profiles/environments are active | `configuration.suites=...`, `configuration.profiles=...`, `configuration.environments=...` |
| `src/main/resources/properties/suite/<name>/suite.properties` | "What stories to run" for this suite | `batch-1.resource-location`, `batch-1.threads`, `engine.composite-paths`, suite-specific engine settings |
| `src/main/resources/properties/profile/<path>/profile.properties` | "What platform" — browser/device/grid | `web.driver=CHROME`, mobile capabilities, grid url |
| `src/main/resources/properties/environment/<name>/environment.properties` | "Against what host" | `web-application.main-page-url`, `rest-api.http.endpoint`, env-specific endpoints |
| `src/main/resources/overriding.properties` | Local-debug overrides; **highest precedence among files** — typically gitignored | Any override |

The starter ships only `configuration.properties` (empty values) and an `overriding.properties` placeholder; the user creates the rest as they author tests.

---

## Precedence (highest → lowest)

1. Gradle CLI properties: `-Pvividus.<key>=value` (translated to system property)
2. JVM system properties: `-D<key>=value`
3. OS environment variables
4. `overriding.properties`
5. `configuration.properties`
6. Suite properties — when multiple suites listed, **first declared wins** (loaded last-to-first)
7. Profile properties — same rule
8. Environment properties — same rule
9. Plugin defaults

> "The suites are loaded one by one starting from the last one in the sequence — values defined in the first suite take precedence over the values of the same properties defined in all subsequent suites." — Vividus docs. Same applies to profiles and environments.

---

## Master `configuration.properties`

```properties
# Comma-separated lists. Order matters (first wins inside a tier).
configuration.suites=web_app,rest_api
configuration.profiles=web/desktop/chrome
configuration.environments=staging
```

Profiles are **path-cascading**: `web/desktop/chrome` loads `properties/profile/web/`, then `properties/profile/web/desktop/`, then `properties/profile/web/desktop/chrome/`. Each level's `profile.properties` is merged.

---

## Suites — "what to run"

Each suite has one or more **batches**. Batches run sequentially; stories inside a batch run in parallel.

`properties/suite/web_app/suite.properties`:
```properties
batch-1.resource-location=story/web_app
batch-1.resource-include-patterns=*.story
batch-1.resource-exclude-patterns=
batch-1.threads=3
batch-1.fail-fast=false
batch-1.meta-filters=groovy: !skip
batch-1.variables.user-id=42

# Suite-level engine + plugin tweaks
engine.composite-paths=steps/web_app/*.steps
web.driver.chrome.command-line-arguments=--ignore-certificate-errors
```

`properties/suite/rest_api/suite.properties`:
```properties
batch-1.resource-location=story/rest_api
batch-1.resource-include-patterns=*.story
batch-1.threads=1

http.ssl.check-certificate=false
engine.composite-paths=steps/rest_api/*.steps
```

### Common batch keys

| Key | Default | Meaning |
|---|---|---|
| `batch-N.resource-location` | (required) | Story root, relative to `src/main/resources/`, e.g. `story/web_app` |
| `batch-N.resource-include-patterns` | `**/*.story` | Ant-style include glob |
| `batch-N.resource-exclude-patterns` | empty | Ant-style exclude glob |
| `batch-N.threads` | `1` | Stories run concurrently within batch |
| `batch-N.fail-fast` | `false` | Skip subsequent batches after a failure |
| `batch-N.meta-filters` | empty | Groovy meta filter, scoped to this batch |
| `batch-N.variables.<name>` | — | Inject batch-scoped variables |
| `batch-N.story-execution-timeout` | `PT2H` | ISO-8601 duration |
| `batch-N.name` | derived | Display name |

### Engine-level keys (suite or higher)

| Key | Meaning |
|---|---|
| `engine.composite-paths` | Glob for composite-step files (`steps/**/*.steps`) |
| `bdd.all-meta-filters` | Project-wide meta filter |
| `story.fail-fast` | Stop story after first failed scenario |
| `scenario.fail-fast` | Stop scenario after first failed assertion |

---

## Profiles — "on what platform"

Cascading directory tree under `properties/profile/`:

```
properties/profile/
├── web/
│   ├── profile.properties               # any common web setting
│   ├── desktop/
│   │   ├── profile.properties           # desktop common
│   │   ├── chrome/profile.properties    # browser-specific
│   │   ├── firefox/profile.properties
│   │   └── edge/profile.properties
│   └── mobile/profile.properties
└── mobile_app/
    ├── android/profile.properties
    └── ios/profile.properties
```

Activate with `configuration.profiles=web/desktop/chrome`. Each level's properties are loaded; deeper levels can override.

`properties/profile/web/desktop/chrome/profile.properties` (typical):
```properties
web.driver=CHROME
selenium.grid.url=
web.driver.chrome.command-line-arguments=--start-maximized,--disable-gpu
```

Mobile (`properties/profile/mobile_app/android/profile.properties`):
```properties
selenium.grid.url=http://localhost:4723/wd/hub
mobile-app.bundle-id=com.example.app
selenium.capabilities.platformName=Android
selenium.capabilities.deviceName=Pixel_6
selenium.capabilities.app=/path/to/app.apk
```

Grid (BrowserStack/SauceLabs/LambdaTest) typically lives in its own profile, e.g. `properties/profile/web/browserstack/profile.properties`.

---

## Environments — "against what host"

`properties/environment/staging/environment.properties`:
```properties
web-application.main-page-url=https://staging.example.com
rest-api.http.endpoint=https://api.staging.example.com
db.connection.app-db.url=jdbc:postgresql://staging-db.example.com:5432/app
```

`properties/environment/prod/environment.properties`:
```properties
web-application.main-page-url=https://example.com
rest-api.http.endpoint=https://api.example.com
db.connection.app-db.url=jdbc:postgresql://prod-db.example.com:5432/app
```

Activate with `configuration.environments=staging`. Multiple environments can be listed (e.g. shared base + override) — first wins.

---

## Configuration sets — preset bundles

Group a triple of suite/profile/environment under one key, then activate the bundle:

```properties
configuration-set.api-staging.suites=rest_api
configuration-set.api-staging.profiles=
configuration-set.api-staging.environments=staging

configuration-set.web-prod.suites=web_app
configuration-set.web-prod.profiles=web/desktop/chrome
configuration-set.web-prod.environments=prod

configuration-set.active=api-staging
```

A configuration set overrides individual `configuration.suites/profiles/environments` settings. Useful for CI to swap whole presets via one CLI arg:
```bash
./gradlew runStories -Pvividus.configuration-set.active=web-prod
```

---

## Common cross-cutting properties

### Web
```properties
web-application.main-page-url=https://example.com
web.driver=CHROME                                     # CHROME, FIREFOX, EDGE, SAFARI, IE_EXPLORER
selenium.grid.url=                                     # blank = local; remote = grid hub URL
selenium.grid.platform=
selenium.grid.version=
web.driver.chrome.command-line-arguments=--ignore-certificate-errors,--headless=new
web.driver.firefox.binary-path=
web.element.highlighting.enabled=true                  # highlight elements during run
proxy.enabled=false
proxy.host=
proxy.port=
```

### REST
```properties
rest-api.http.endpoint=https://api.example.com
http.ssl.check-certificate=true
http.headers.User-Agent=vividus-tests/1.0
http.cookie-spec=standard
```

### Database (per connection key)
```properties
db.connection.app-db.driver-class-name=org.postgresql.Driver
db.connection.app-db.url=jdbc:postgresql://host:5432/app
db.connection.app-db.username=...
db.connection.app-db.password=...
db.connection.app-db.dataSource.<vendor-prop>=...
```

### Reporting (Allure)
```properties
report.title=My Project Report
report.brand.title=Acme QA
report.brand.logo-path=images/logo.svg
report.show-parameters-section=true
report.tabs.behaviors.enabled=true
report.tabs.timeline.enabled=true

# Categorize failures
report.tabs.categories.product-bugs.name=Product bugs
report.tabs.categories.product-bugs.statuses=failed,broken

# Static metadata
metadata.static.env.name=Environment
metadata.static.env.value=staging
metadata.static.env.category=ENVIRONMENT
metadata.static.env.show-in-report=true

# Issue / TMS link patterns (for @issueId, @testCaseId meta tags)
system.allure.link.issue.jira.pattern=https://jira.example.com/browse/{}
system.allure.link.tms.zephyr.pattern=https://zephyr.example.com/test/{}

# Email summary
notifications.mail.host=smtp.example.com
notifications.mail.port=587
notifications.mail.from=ci@example.com
notifications.mail.recipient=qa@example.com
notifications.mail.security-protocol=STARTTLS
```

Doc: https://docs.vividus.dev/vividus/latest/configuration/reporting.html

### Secrets

Vividus supports secrets via env vars / system properties / Vault / cloud secret managers (AWS Secrets Manager, Azure Key Vault) — configured per plugin. Doc: https://docs.vividus.dev/vividus/latest/configuration/secrets-management.html

Pattern for env-var override (no plugin needed):
```bash
DB_PASSWORD=hunter2 ./gradlew runStories
```
Then in properties: `db.connection.app-db.password=${DB_PASSWORD}` — Vividus resolves `${DB_PASSWORD}` from env vars when not present in local-scope variables.

---

## CLI overrides at runtime

Use **`-Pvividus.<key>=<value>`** form (Gradle property, mapped to system property by the build):

```bash
# Switch the triple
./gradlew runStories \
  -Pvividus.configuration.suites=web_app \
  -Pvividus.configuration.profiles=web/desktop/chrome \
  -Pvividus.configuration.environments=staging

# Override individual properties
./gradlew runStories -Pvividus.web-application.main-page-url=https://staging.example.com
./gradlew runStories -Pvividus.batch-1.threads=8
./gradlew runStories -Pvividus.story.execution-timeout=PT30M

# Inject ad-hoc variables (visible as ${name} in stories)
./gradlew runStories -Pvividus.variables.user=alice
./gradlew runStories -Pvividus.variables.token=eyJhbGc...

# Filter by Meta tags (Groovy)
./gradlew runStories -Pvividus.bdd.all-meta-filters="groovy: smoke && !skip"

# Save exit code (CI helper)
./gradlew runStories -PfileToSaveExitCode='/abs/path/exit.txt'
./gradlew runStories -PfileToSaveExitCode='exit.txt' -PresolvePathAgainstProjectBuildDir=true

# Treat known issues as passed (CI-friendly)
./gradlew runStories --treat-known-issues-only-as-passed
```

CLI doc: https://docs.vividus.dev/vividus/latest/commons/cli.html
