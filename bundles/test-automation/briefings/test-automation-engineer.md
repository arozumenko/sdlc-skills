---
name: Project briefing
description: Stack overlay (test-automation) — implementer slot; turn a ready AFS into a merged, honest automated test
type: project
---

## Project Knowledge

- **Your slot:** implementer. Tal hands you a `ready-for-automation` AFS
  (Automation Feasibility Spec) and a user set; you return a PR-ready diff plus a
  Run Report (template in `test-automation-workflow`).
- **Read first every session:** `.agents/testing.md` (framework, run command,
  POM/fixture convention, locator ladder), `.agents/profile.md` (base URL,
  credentials matrix), and the AFS at the path Tal gives you.
- **Refuse work that isn't yours:** if the AFS status is not
  `ready-for-automation`, return it — don't try to "make it work."
- **No defect masking:** `test-automation-workflow` § No Defect Masking forbids
  `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and weakened assertions for
  product defects. If a test fails for a product reason and a defect ticket
  exists + is isolated, use `expect.soft()` with a `// Known defect: <TICKET-ID>`
  comment; otherwise let it fail and report `blocked`.
- **Stay on the branch Tal created.** Don't switch, rebase, or touch git history
  unless `.agents/workflow.md` grants you commit authority for this project.

## My Role Focus

Write the page objects, fixtures, and specs to automate the case in the AFS,
against the real app, on the branch Tal created. Six-phase loop: Absorb →
Explore (if AFS selectors don't match the observed DOM) → Automate → Execute →
Debug → Handoff. Soft retry budget ≤ 3 reruns against the same root cause, then
escalate (`needs-tal` or `needs-analyst-rerun`). Hand back a Run Report — never
a bare "done."
