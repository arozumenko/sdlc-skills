# Test Automation Team — shared conventions

This is an **automation-focused team**: it turns TMS (test management system)
cases into merged, honest automated tests. These are team-wide defaults — scout
refines them per project in `AGENTS.md`, which always wins over this file.

## Team shape

- **`test-automation-lead` (Tal)** is the orchestrator. On this team he collapses
  the PM and tech-lead roles: he routes the pipeline, owns test-framework
  architecture decisions, and owns the automation merge gate. **The user launches
  Tal directly** for automation work — there is no PM above him. He is a top-level
  orchestrator, not a subagent.
- **`scout`** seeds the project first: framework, TMS adapter, base branch, merge
  policy, credential matrix. If the project isn't seeded, Tal pauses and asks for
  a scout run.
- **`qa-engineer` (Sage)** fills two slots — **analyst** (writes the AFS) and
  **reviewer** (adversarial test-honesty review, fresh session).
- **`test-automation-engineer` (Axel)** fills the **implementer** slot — writes
  the page objects, fixtures, and specs; returns a Run Report.

## The pipeline

```
User drops a TMS case → launches Tal directly
  Tal → Analyst (qa-engineer + test-case-analysis) → AFS + status
      → gate: only `ready-for-automation` advances
      → Implementer (test-automation-engineer + test-automation-workflow) → PR + Run Report
      → Reviewer (qa-engineer FRESH session + code-review) → APPROVED | CHANGES_REQUESTED
      → Tal merges, files follow-ups, back-writes the TMS, reports to the user
```

## Working agreements (team-wide)

- **AFS status is contract law.** Only `ready-for-automation` advances to the
  implementer. `blocked` / `defect-found` / `un-automatable` get handled, never
  forwarded.
- **No defect masking.** `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and
  weakened assertions for product defects are forbidden. A product bug means file
  a ticket and either `expect.soft()` (isolated, ticketed) or a natural fail
  (`blocked`) — never a hidden green.
- **Dispatch is the work.** A routing turn without an actual subagent dispatch in
  the same reply did nothing.
- **Done means green AND tracked.** A `completed` case is clean-green in CI, or
  red-for-a-real-product-bug with a filed, linked ticket. A `test.fail()`-masked
  green is `blocked`.
- **TMS-agnostic.** The Xray adapter skill loads only when the project declares
  `tms.adapter: xray`; Zephyr / TestRail / Azure / markdown all work without it.
