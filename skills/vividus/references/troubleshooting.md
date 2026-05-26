# Vividus Troubleshooting Guide

## Contents

- [Build / setup failures](#build-setup-failures)
- [Story authoring failures](#story-authoring-failures)
- [Configuration failures](#configuration-failures)
- [Runtime failures](#runtime-failures)
- [Reporting failures](#reporting-failures)
- [Visual testing failures](#visual-testing-failures)
- [AI / LLM-generated step pitfalls](#ai-llm-generated-step-pitfalls)
- [When stuck](#when-stuck)

The most-common pitfalls and the fastest path through each.

---

## Build / setup failures

### `apply from: ".../vividus-test-project.gradle" -- file not found` or empty `vividus-build-system/` directory

**Cause:** The starter pulls `vividus-build-system` as a git submodule. A regular `git clone` skips it, leaving the build broken.

**Fix:**
```bash
git submodule update --init --recursive
```

For future clones, always:
```bash
git clone --recursive <repo-url>
```

### `error: invalid target release: 21` / cryptic compile errors

**Cause:** Older JDK on `JAVA_HOME`. Vividus needs **JDK 21** (Temurin recommended).

**Fix:**
```bash
java -version           # verify 21+
echo $JAVA_HOME
```
Install JDK 21 (e.g., via SDKMAN: `sdk install java 21-tem`) and update `JAVA_HOME`.

### `Could not resolve org.vividus:...` after adding a plugin

**Cause:** Wrong BOM version (artifact didn't exist yet at that BOM), or typo in plugin name, or missing `implementation platform('org.vividus:vividus-bom:...')`.

**Fix:** Check the latest BOM version at https://github.com/vividus-framework/vividus/releases. Plugin names follow the strict pattern `vividus-plugin-<name>` (see `references/plugins.md`). The `platform(...)` line must be present.

### Gradle daemon hangs on first build

The first build downloads the BOM + every plugin's transitive deps; can take several minutes. Add `--info` to see progress.

---

## Story authoring failures

### `No starting word found for step ''` — blank lines in composite step files

**Cause:** Blank lines inside a `.steps` file are parsed as empty steps. JBehave can't find a starting keyword (`Given`/`When`/`Then`/`And`/`!--`) for an empty string and throws this error immediately on startup, before any story runs.

**Fix:** Remove all blank lines between `Composite:` blocks. Separate composites with a comment line if you need visual spacing:

```gherkin
Composite: When I login as `$user` with password `$pwd`
When I enter `<user>` in field located by `id(username)`
When I enter `<pwd>` in field located by `id(password)`
When I click on element located by `id(signIn)`
!-- ----
Composite: When I open product `$id`
Given I am on main application page
When I go to relative URL `/products/<id>`
```

### "Pending step" at runtime — step shows up unimplemented

**Cause #1:** Wording typo — Vividus matches by exact phrasing. Even an extra space or a swapped word breaks the match.

**Fix:** Run `./gradlew printSteps --args="-f /tmp/steps.txt"` and grep for keywords from your step. Copy the exact phrasing.

**Cause #2:** Used quotes instead of backticks for parameters.

**Fix:** Wrap parameters in backticks: `` Then `${actual}` is equal to `5` ``. Quotes never match.

**Cause #3:** Plugin not on classpath. The step exists in the docs but the plugin isn't in `build.gradle`.

**Fix:** Add the plugin (`implementation('org.vividus:vividus-plugin-<name>')`), `./gradlew build`, retry.

**Cause #4:** Step name was deprecated and renamed.

**Fix:** Run `./gradlew replaceDeprecatedSteps` to auto-rewrite to current names. Or check the plugin doc for the new phrasing.

### Locator fails to find an element that's clearly there

**Cause #1:** Element isn't visible (default visibility filter is `:v`).

**Fix:** Use `:a` (all) or `:i` (invisible): `xpath(//div[@id='hidden']):a`.

**Cause #2:** XPath whitespace normalization. `xpath(...)` collapses internal whitespace; `unnormalizedXPath(...)` keeps it.

**Fix:** Switch to `unnormalizedXPath(...)` if your XPath relies on exact whitespace.

**Cause #3:** Inside an iframe / shadow DOM.

**Fix:** Switch context first (`When I switch to frame located by ...`) or use `shadowCssSelector(...)`.

### Variable shows up literal as `${var}` in output

**Cause #1:** Wrong scope — the variable was set in a narrower scope and is no longer alive.

**Fix:** Promote to wider scope (e.g., `story` instead of `scenario`).

**Cause #2:** Typo in variable name (case-sensitive, hyphens vs underscores matter).

**Fix:** Compare letter-for-letter against the `I initialize ... variable` statement.

**Cause #3:** Set by a step that ran in a parallel story; current story doesn't see it.

**Fix:** Stories in a batch run in parallel — don't share via `story` scope across stories. Use `batch.variables.<name>=` or pass via `GivenStories:`.

### `<col>` placeholder not replaced

**Cause:** Used `${col}` instead of `<col>` for ExamplesTable column reference.

**Fix:** Inside a scenario that has `Examples:`, use angle brackets `<columnName>` for column placeholders. `${var}` is for runtime variables.

---

## Configuration failures

### "No suite found" / "0 stories executed"

**Cause #1:** `configuration.suites=` is empty in `configuration.properties` and no CLI override given.

**Fix:** Set `configuration.suites=<name>` or pass `-Pvividus.configuration.suites=<name>`.

**Cause #2:** `batch-1.resource-location` doesn't match any files.

**Fix:** Verify the path is **relative to `src/main/resources/`** (not project root). Verify `batch-1.resource-include-patterns` (default `**/*.story`) matches your files.

### Property override doesn't take effect

**Cause:** Precedence ordering. Check the table below — earlier rows beat later rows:

| # | Source |
|---|---|
| 1 | `-Pvividus.<key>=v` (Gradle CLI) — wins everything |
| 2 | `-D<key>=v` (system property) |
| 3 | OS env var |
| 4 | `overriding.properties` |
| 5 | `configuration.properties` |
| 6 | suite (first declared wins among multiple) |
| 7 | profile (first declared wins) |
| 8 | environment (first declared wins) |
| 9 | plugin defaults |

The "first wins" rule **inside a tier** is counter-intuitive. If `configuration.suites=A,B` and both define `web.driver`, A's value wins.

### `web.driver=CHROME` but Firefox starts (or vice versa)

**Cause:** A profile lower in the cascade overrode it. Profiles cascade by path (`web/desktop/chrome` loads `web`, then `web/desktop`, then `web/desktop/chrome` — each can override earlier).

**Fix:** Check each `profile.properties` along the path. Use `-Pvividus.web.driver=CHROME` to confirm CLI override works (rules out source ordering issue).

---

## Runtime failures

### Tests pass locally, fail in CI with timeouts

**Likely causes:**
- CI lacks the browser. Use a Selenium grid (`selenium.grid.url=...`) or use `--headless=new` Chrome arg in CI profile.
- `batch-N.threads` set too high for CI's CPU. Drop to `1`–`2` for shared CI.
- Timeouts too tight for cold-start CI. Bump `story.execution-timeout=PT30M` and per-step waits.

### Flaky tests with cross-story state contamination

**Cause:** Stories in a batch run **in parallel** by default. Mutating shared external state (DB rows, files, env-wide vars) creates flakes.

**Fix:**
- Set `batch-N.threads=1` to serialize.
- Or scope all mutable test data to the scenario (e.g., create unique users with `#{generate(Internet.emailAddress)}`).
- Avoid `story` scope for shared mutable values; prefer `scenario`.

### `./gradlew runStories` finishes but exit code is 0 even though tests failed

**Cause:** A failing assertion matched a pattern in `known-issues.json` and was reported separately rather than failing the build.

**Fix:** Inspect `known-issues.json` and remove stale entries. Or run with `--treat-known-issues-only-as-passed` flipped off (it's a CI-friendly default in some setups).

---

## Reporting failures

### Allure index.html shows blank page or "Cannot load data"

**Cause:** Modern browsers block `file://` access to JSON via XHR/fetch, which Allure needs.

**Fix:** Serve the report directory:
```bash
( cd output/reports/allure && python3 -m http.server 8000 )
# then open http://localhost:8000
```
Or use VS Code Live Server, or VIVIDUS Studio's "Open Allure Report" command.

### Reports missing screenshots / attachments

**Cause:** `When I take screenshot` not called on failure paths, or screenshot config disabled.

**Fix:** Add a `Lifecycle: After: Outcome: FAILURE` block that takes a screenshot. Verify `web.screenshot....` properties.

---

## Visual testing failures

### `Resource with name /baselines ... is not found`

**Cause:** `FileSystemBaselineStorage` needs the baselines directory to exist as a classpath resource when `ESTABLISH` tries to write. If the directory was never created (or Gradle didn't package it because it was empty), the storage throws.

**Fix:** Create the folder and a placeholder:
```bash
mkdir -p src/main/resources/baselines
touch src/main/resources/baselines/.gitkeep
```
Then rebuild (`./gradlew build`) so Gradle packages the directory into the output resources.

### Visual diff fails even though the page looks identical

**Cause:** The property `visual.acceptable-diff-percentage` has no effect. The correct key is `ui.visual.acceptable-diff-percentage`.

**Fix:** In your profile or environment properties:
```properties
ui.visual.acceptable-diff-percentage=2   # allow up to 2% pixel difference
```
Confirm it loaded by grepping the properties dump at startup for `ui.visual.acceptable-diff-percentage`.

### `IllegalArgumentException: Only one row of locators to ignore supported, actual: N`

**Cause:** The `ignoring:` table in a visual step only supports **one data row**. Each row is treated as a single locator group; passing two rows throws this error.

**Fix:** Combine multiple elements into a single CSS multi-selector on one row:
```gherkin
!-- WRONG — two rows:
|ELEMENT                          |
|cssSelector(.cookie-banner)      |
|cssSelector(.hero-carousel)      |

!-- CORRECT — one row, multi-selector:
|ELEMENT                                          |
|cssSelector(.cookie-banner, .hero-carousel)      |
```

---

## AI / LLM-generated step pitfalls

LLMs (including this assistant in unguarded mode) often **hallucinate** step phrasings that look plausible but don't exist. Symptoms: every step in a story is "pending" at runtime.

**Defenses (build them into your workflow):**
1. Ground every new step against `references/steps-cheatsheet.md` or `./gradlew printSteps` output. Don't trust memory.
2. Run a focused `./gradlew runStories -Pvividus.batch-1.resource-include-patterns=NewStory.story` immediately after writing.
3. If you see invalid steps, **stop, clear the conversation context if needed, and re-ground** against the docs (https://docs.vividus.dev/vividus/latest/) before continuing.
4. The official AI guide says the same: https://docs.vividus.dev/vividus/latest/user-guides/ai.html.
5. Consider running the bundled MCP server (`./gradlew startMcpServer`) and pointing your AI tool at it — it can answer "is this a real step?" queries against the project's actual classpath.

---

## When stuck

- `./gradlew printSteps --args="-f /tmp/steps.txt"` — every step the project knows
- `./gradlew countSteps -t 10` — top-10 most-used (sanity check the project's existing patterns)
- `./gradlew validateKnownIssues` — sanity-check `known-issues.json`
- `./gradlew testVividusInitialization` — verifies wiring without running stories
- `./gradlew --debug runStories ...` — verbose Gradle log
- Search the docs: https://docs.vividus.dev/vividus/latest/
- Inspect a similar working story in https://github.com/vividus-framework/vividus-sample-tests
