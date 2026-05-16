<!--
example-CLAUDE.md — starter CLAUDE.md for a new qavajs project.

Copy this file's BODY (everything below the closing comment) to the
project root as `CLAUDE.md` and fill in the bracketed placeholders.

Customisation cues — add a section ONLY if relevant; keep CLAUDE.md
under ~50 lines (it's loaded into context every turn):

| Add when…                                                | Section to include                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Project uses tag-based profiles (@smoke, @regression)    | "Tags" section listing them and what each gates                             |
| Multiple environments via memory profiles                | "Environments" section showing --memory-values invocations                  |
| Auth flow needs setup (storage state, login fixture)     | "Pre-test setup" section pointing at the fixture or login Before            |
| Non-trivial custom step definitions                      | "Custom steps" section listing them with one-line purposes                  |
| CI shards or parallelises                                | "CI parallelism" section noting parallel: and --shard arguments             |

Don't add a "How to run a single test" section — that's covered in
the Commands block.

Distilled from https://github.com/qavajs/demo/blob/main/agentic/CLAUDE.md (MIT).
-->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test           # Run the full Cucumber/Playwright suite
npm run debug      # [if defined] Run with Playwright UI mode for interactive debugging
```

To run a specific feature, scenario, or tag, prefer tag selection:

```bash
npx qavajs run --config config.ts -t '@<tag>'
npx qavajs run --config config.ts -t '"<scenario name>"'
```

## Architecture

This is a **Cucumber BDD test suite** for [<app-name> at <app-url>], built on `@qavajs/<runner>` (where `<runner>` ∈ `playwright` / `wdio` / `api`).

**Data flow:**
1. Gherkin scenarios in `features/*.feature` describe steps in plain English.
2. `@qavajs/steps-<runner>` resolves built-in step phrases — no custom step definitions for standard interactions.
3. `page_object/index.ts` exports an `App` class with all locators (PascalCase property names, `locator.template(...)` for dynamic selectors).
4. `memory/index.ts` exports a `<Memory|Constants>` class holding test constants (URLs, credentials, env-specific values).
5. `config.ts` (or `cucumber.config.ts` / `qavajs.config.ts` for standalone Playwright mode) wires it together: registers `memory`, `pageObject`, sets `paths`, `require`, formatters.

**Project layout:**
- `features/` — Gherkin
- `page_object/` — `locator()` classes
- `memory/` — `<Memory>` class
- `step_definitions/` — project-specific custom steps (if any)

**Reporting:** [<formatters in use, e.g. console + HTML to `report/`, JUnit XML to `report/junit.xml`>]. Traces / videos under [<output dir, e.g. `test-results/`>].

**TypeScript:** strict mode, `module: <node16|nodenext|esnext>`. Tests run from source via `ts-node` / Playwright's transformer.

## Conventions

- New scenarios go into the **existing** feature file unless I ask for a new one.
- Reference page-object elements by **PascalCase property names** with spaces: `Username Input`, not `usernameInput`.
- Use `$key` memory references in Gherkin; never inline credentials.
- Look up step phrases in `@qavajs/steps-<runner>` source before inventing custom steps — duplicate-regex errors are the most common cause of "ambiguous step".

## Don'ts

- Don't add new page-object locators unless explicitly asked.
- Don't strip stack traces when reporting failures.
- Don't run the whole suite to verify a one-line change — narrow with `-t '<tag>'`.
