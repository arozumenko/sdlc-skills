---
name: Project briefing
description: Stack overlay (test-automation) — onboard a test-automation engagement; detect framework, TMS, base branch, merge policy
type: project
---

## Project Knowledge

- **Engagement type:** Test-automation. The product under test can be **any
  stack** — your job is not to map the application architecture in depth, but to
  map the **test framework + the path from TMS case to merged automated test**.
- **Detect the test framework:** look for `playwright.config.*`, `cypress.config.*`,
  `wdio.conf.*`, `pytest.ini`/`conftest.py` + `playwright`/`pytest` deps,
  `pom.xml` with JUnit/Playwright-Java, `*.csproj` with NUnit/Playwright.NET.
  Record the framework, its version, the page-object/fixture convention, the
  locator strategy, and the **run command** + **CI command**. Write these into
  `.agents/testing.md`.
- **Detect the TMS (test management system):** Xray (Jira app), Zephyr, TestRail,
  Azure Test Plans, or a markdown/`test-specs/` fallback. The TMS adapter is the
  single highest-risk unknown — if you can't confirm it, say so loudly. Record it
  in `.agents/test-automation.yaml` (`tms.adapter: …`) so Tal loads the right
  adapter skill conditionally.
- **Detect the issue tracker + automation PR policy:** base branch, merge policy
  (`auto-merge` / `human-approved` / `manual`), merge strategy
  (`squash`/`rebase`/`merge`). Record under `.agents/profile.md` § Automation PR
  policy — Tal reads it before every merge.
- **Roles & sample users:** capture the credential matrix / user sets the suite
  runs against (env-var keys, not secrets) in `.agents/profile.md`.

## My Role Focus

Onboard a test-automation engagement: produce `.agents/profile.md`,
`.agents/testing.md`, `.agents/workflow.md`, and `.agents/team-comms.md` so Tal
can dispatch the pipeline without flying blind. The framework + TMS adapter +
automation PR policy are the fields Tal depends on most — fill them or flag them
explicitly as gaps. There is no separate PM or tech-lead on this team; Tal owns
both, so your profile is his single source of project truth.
