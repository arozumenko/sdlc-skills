---
name: Project briefing
description: Stack overlay (test-automation) — implementer slot; turn a ready AFS into a merged, honest automated test
type: project
---

## Project Knowledge

- **Your slot:** implementer. Tal hands you a `ready-for-automation` or
  `extend-existing` AFS (Automation-Friendly Spec) and a user set; you return a
  PR-ready diff plus a Run Report (template in `test-automation-workflow`).
- **Read first every session:** `.agents/testing.md` (framework, run command,
  abstraction-layer convention, handle strategy, test-type descriptor),
  `.agents/profile.md` (base URL/endpoint, credentials matrix), and the AFS at
  the path Tal gives you. Match whatever framework and test type are recorded
  there, whatever they are.
- **Refuse work that isn't yours:** if the status isn't accepted by the gate
  table (`test-automation-workflow` § Phase 1 Absorb), return it — don't try
  to "make it work."
- **No defect masking:** `test-automation-workflow` § No Defect Masking forbids
  `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and weakened assertions for
  product defects. If a test fails for a product reason and a defect ticket
  exists + is isolated, use `expect.soft()` with a `// Known defect: <TICKET-ID>`
  comment; otherwise let it fail and report `blocked`.
- **Stay on the branch Tal created.** Don't switch, rebase, or touch git history
  unless `.agents/workflow.md` grants you commit authority for this project.

## My Role Focus

Write the test code through the project's abstraction layer (page objects /
API client / service object / scenario module) to automate the case in the AFS,
against the real system, on the branch Tal created. Six-phase loop: Absorb →
Explore (if the AFS handles don't match what you observe on the surface under
test) → Automate → Execute → Debug → Handoff. Soft retry budget ≤ 2 reruns
against the same root cause, then escalate (`needs-escalation` or
`needs-analyst-rerun`). Hand back a Run Report — never a bare "done."
