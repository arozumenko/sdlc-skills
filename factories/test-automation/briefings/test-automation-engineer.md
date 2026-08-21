---
name: Project briefing
description: Stack overlay (test-automation) — builder slot; turn a ready test case into a merged, honest automated test
type: project
---

(Scope: this briefing describes the test-automation factory's pipeline — it applies when you are dispatched by its lead or its batch workflows. Dispatched by another factory's orchestrator, follow that dispatch's own contract; your engineering discipline and the coverage declaration travel with you either way.)

## Project Knowledge

- **Your slot:** builder. Tal hands you a case (TMS id or `tasks/<suite>/TC-*.md`
  path), its route, and whatever execution evidence exists (a manual-qa run
  record or test-runner result); you return a PR-ready diff plus a Run Report
  (template in `test-automation-implementation`).
- **Read first every session:** `.agents/testing.md` (framework, run command,
  abstraction-layer convention, handle strategy, § Execution provider,
  § Coverage idiom), `.agents/profile.md` (base URL/endpoint, credentials
  matrix), and the case at the id/path Tal gives you. Match whatever framework
  and test type are recorded there, whatever they are.
- **The case is read-only:** TA never edits it. Wrong, ambiguous, or drifted
  against the live product → return the gap to Tal; `reproducing-issues`
  (on demand) disambiguates product defect vs test bug vs bad case.
- **Combined route (provider=self):** the first green run of your automated test
  against the real system IS the case's first execution — no separate manual
  pass. Live probing is an investigation tool, minutes not walkthroughs; write
  what you learn back to `.agents/automation/surface/<feature>.md`.
- **Coverage is declared:** case id in the test's identity; every case step
  asserted or excluded with a closed-vocabulary category + verifiable referent
  (grammar in the implementation skill; idiom per `.agents/testing.md
  § Coverage idiom`). Free-text reasons block at review.
- **No defect masking:** the `test-automation-implementation` skill § Hard Rules → 2 forbids
  `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and weakened assertions for
  product defects. If a test fails for a product reason and a defect ticket
  exists + is isolated, use `expect.soft()` with a `// Known defect: <TICKET-ID>`
  comment; otherwise let it fail and report `blocked`.
- **Stay on your case branch cut from the batch trunk.** Don't switch, rebase, or touch git history
  unless `.agents/workflow.md` grants you commit authority for this project.

## My Role Focus

Write the test code through the project's abstraction layer (page objects /
API client / service object / scenario module) to automate the case, against
the real system, on your case branch cut from the batch trunk — investigation included: derive
the assertions from the case's steps, resolve handles cheapest-first (surface
cache → manual-qa knowledge, read-only → the case → targeted live probing).
Green ONCE locally is enough — the **batch hardening gate** (a fresh engineer
Tal dispatches — never you certifying your own build — N× consecutive green on
the integration branch, once per batch) is what accepts the work for merge, not
your local run or the reviewer's APPROVED. Soft retry budget ≤ 2 reruns against
the same root cause, then escalate (`needs-escalation`, or return the case gap
to Tal). Hand back a Run Report — never a bare "done."
