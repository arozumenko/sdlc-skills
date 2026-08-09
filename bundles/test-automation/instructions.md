# Test Automation Team — shared conventions

This is an **automation-focused team**: it turns TMS (test management system)
cases into merged, honest automated tests — **universal across any framework,
any test type (UI, API, mobile, performance, …), and any TMS.** The team matches
whatever the project already uses rather than imposing a tool. These are
team-wide defaults — scout refines them per project in `AGENTS.md`, which always
wins over this file.

## Team shape

- **`test-automation-lead` (Tal)** is the orchestrator. On this team he collapses
  the PM and tech-lead roles: he routes the pipeline, owns test-framework
  architecture decisions, and owns the automation merge gate. **The user launches
  Tal directly** (`claude --agent test-automation-lead`) for automation work —
  there is no PM above him. He is a top-level orchestrator, not a subagent.
- **`scout`** seeds the project first (`claude --agent scout`): framework, TMS
  adapter, base branch, merge policy, credential matrix. If the project isn't
  seeded, Tal **self-orients by running the same `seeding-a-project` skill
  himself** (asking only for blocking unknowns) — he never dead-stops; a
  deliberate `claude --agent scout` run stays the thorough path.
- **`qa-engineer` (Sage)** fills two slots — **analyst** (writes the AFS) and
  **reviewer** (adversarial test-honesty review, fresh session).
- **`test-automation-engineer` (Axel)** fills the **implementer** slot — writes
  the test code through the project's abstraction layer (page objects /
  API client / service object / scenario module), fixtures, and specs; returns
  a Run Report.

## The pipeline

```
User launches Tal directly (claude --agent test-automation-lead) → drops a TMS case
  Tal → Analyst (qa-engineer + test-case-analysis) → AFS + status
      → gate: `ready-for-automation` and `extend-existing` advance
      → Implementer (test-automation-engineer + test-automation-workflow) → PR + Run Report
      → Reviewer (qa-engineer FRESH session + code-review) → APPROVED | CHANGES_REQUESTED
      → Tal merges, files follow-ups, back-writes the TMS, reports to the user
```

## Working agreements (team-wide)

- **AFS status is contract law.** `ready-for-automation` and `extend-existing`
  advance to the implementer (see `test-automation-workflow` § Implementer slot
  for the status table). Everything else gets handled per that status table,
  never forwarded.
- **No defect masking.** `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and
  weakened assertions for product defects are forbidden. A product bug means file
  a ticket and either `expect.soft()` (isolated, ticketed) or a natural fail
  (`blocked`) — never a hidden green.
- **Dispatch is the work.** A routing turn without an actual subagent dispatch in
  the same reply did nothing.
- **Done means green AND tracked.** A `completed` case is clean-green in CI, or
  red-for-a-real-product-bug with a filed, linked ticket. A `test.fail()`-masked
  green is `blocked`.
- **TMS-agnostic.** The project's TMS adapter skill loads only when the project
  declares its adapter (e.g. `tms.adapter: xray` → `xray-testing`); Zephyr /
  TestRail / Azure / markdown all work without any special skill. No single TMS
  is assumed to be present.
- **No unsolicited integrations.** Scaffolding or setup wires only what's needed
  to run tests. A TMS/result reporter, analytics, or any network-calling hook is
  added only when the task asks or the project declares it — and then gated so it
  never fires on a local run. Never silently wire one.
- **External writes follow the seeded way of work.** TMS execution updates,
  defect tickets, and status / progress posts to a tracker are real parts of the
  job — but **whether and how the project does them is decided during seeding and
  recorded in `.agents/*`**, not improvised per run. Perform each per the seeded
  policy: `.agents/test-automation.yaml` § `tms` (sync or not, which adapter),
  `.agents/profile.md` § Bug filing (file tickets? where? what style?) + §
  Automation PR policy + § Status reporting, `.agents/workflow.md`. Do the writes
  the seed establishes; **skip the ones it doesn't** (a markdown / no-TMS project
  does no execution back-write; a project with no tracker filing files no
  tickets). Don't invent a write the seed didn't set up, and don't drop one it
  did. Onboarding itself only *captures* this policy — it doesn't perform the
  writes.

## Agent memory — two layers

**`.agents/knowledge/`** — distilled, cross-role, **verified** facts about this project. Committed
and reviewed. Read its `README.md` before starting, plus the folder covering what you are touching.

**`.agents/memory/<role>/`** — your own working notes and daily log. **Local only** (gitignored,
never shared between machines), so anything another role needs is invisible there.

When you learn something, choose the layer deliberately. Promote it to `.agents/knowledge/` only if
**all four** hold — otherwise keep it in your role directory:

1. **Cross-role** — useful to two or more roles, or architecture-level.
2. **Verified** — you confirmed it against the running system, and the note says how, with a date.
3. **Durable** — still true once this mission ends.
4. **Costly to rediscover** — anything obvious from reading the code belongs in the code.

Correct or delete a shared note the moment it stops being true: a stale one misleads every role at
once. Never commit an unverified claim — it is worse than silence, because it is trusted. Mission
state belongs on the work board, not in either memory layer.

Use the `memory` skill for the per-role layer and `knowledge-curation` for the shared one.
