# Reviewer slot contract — test-automation-workflow (static review)

The reviewer's full procedure. Loaded on demand by the reviewer dispatch.
This is a STATIC review: the reviewer does not execute the spec — independent
execution belongs to the orchestrator's batch hardening gate (N× consecutive
green). A project may re-enable a reviewer live run via
`.agents/testing.md § Merge gate → reviewer live re-run: on`.

## Reviewer slot

This section IS the reviewer-slot contract for test-automation PRs. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "review test PR #N" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them. (Generic review mechanics — checklist categories, output format — live in the separate `code-review` skill, loaded alongside.)

**Role.** Adversarial review of a test-automation PR. **You did NOT write this code** — that framing is mandatory; without it the review collapses into rubber-stamp. The reviewer is an **engineer-typed dispatch in the reviewer slot**: a fresh `test-automation-engineer` session that loads `code-review` plus this contract. Independence comes from the clean context and this contract, not from a different agent definition — the builder's session and the reviewer's share nothing but the repo. Default is a single reviewer; for a large batch the orchestrator may opt into a **multi-lens panel** — parallel reviewers on the one finished diff with distinct lenses (correctness / honesty-of-coverage / maintainability), unanimous APPROVED to pass.

**Session context — read once at session start.** Typically auto-imported via your agent's `AGENT.md`; if not, read now:

- `.agents/profile.md`, `.agents/workflow.md`, `.agents/testing.md`, `.agents/architecture.md`
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated gotchas
- This contract's § The review anchor and § Standing reviewer checks below

Missing context → flag the gap; don't fabricate defaults.

**Per-case parameters** (caller provides at dispatch time):

- Case ID
- The case itself — the intake snapshot at `.agents/automation/<slug>/cases/<ID>.md`, or the in-repo case file path (`tasks/<suite>/<ID>_*.md`) where intake skipped the copy
- PR ID / branch — the implementation
- The intake screening verdicts — `.agents/estimation/<slug>-verdicts.json` (the exclusion budget)

**Context economy (hard rules — same wording as the workflow PREAMBLE; keep in step).** The bill is resident-context × turns — every turn re-sends your whole context, so turn count and payload size ARE the cost. Batch independent tool calls into ONE message (read the case, the diff, and the verdicts together, never one tool per turn); read each artifact once and work from what you read (ranged reads for big files; no re-reads to double-check what is already in context); you are STATIC — you never run suites or a browser, so no runner output and no screenshots belong in your transcript. Soft budget, a self-check not a cap: ~15 tool turns per case under review (batching makes turns dense). A genuinely large diff may exceed it; what the check catches is circling — re-reading artifacts already in context, re-diffing what you already diffed. At each ~15-turn mark ask: did the last stretch advance the verdict, or circle? Advance → continue. Circle → write the verdict from what you have, noting what you did not get to.

**Memory you write is a deliverable too.** A review that surfaces a durable gotcha (a pattern the suite keeps getting wrong, a coverage-walk trap) records it under `.agents/memory/<your-agent>/` and commits it **by exact path** on the branch under review before finishing — an additive `docs(memory):` commit that touches nothing in the test code, so the code diff you judged is unchanged. Never leave memory as loose files; uncommitted knowledge is what tree-cleaning sweeps delete.

**Return contract:**

- Verdict: `APPROVED` | `CHANGES_REQUESTED`
- `blocking[]` — what must change before this can land. Everything else worth saying goes in findings.
- Findings list with `file:line` refs (Critical / Important / Nit per the `code-review` skill's Output Format)
- Coverage confirmation per case: `full` or `partial` with the excluded steps — this is what the report row and the TMS back-write carry
- Recommendation: ship vs amend. The orchestrator decides final disposition; reviewer recommends.

### On a RE-REVIEW: classify every surviving blocker

This is the single judgement only you can make, and the fix loop turns on it —
whether a script is running the loop or the orchestrator is running it by hand.
For each item you are **still** blocking on, say which of these is true **of the
diff**, not of your patience:

| Status | What it means | Consequence |
|---|---|---|
| `unaddressed` | No serious attempt is visible. Nothing in the diff touches the code the finding names, or the change is cosmetic or partial. **Forgotten and half-done both belong here.** | **Another round.** This is the loop working, not failing. |
| `persists` | A genuine attempt was made against the right code and the problem is still there. Say in notes what was tried. | **Stop.** More effort by the same slot cannot move it. |
| `external` | Not resolvable on this branch at all — the case text is wrong, a framework primitive is missing, it is a product defect, the environment is broken. | **Stop and route** per the playbook's classification table. |

A **new** item you are raising for the first time is not in this list: new ground
is progress and needs no status.

**Scope every classified blocker to the case ids it actually binds**
(`case_ids`). Omit the scope only when the blocker truly holds the whole unit —
a shared fixture, a family spec's common table, a framework gap. This is
load-bearing, not bookkeeping: when every surviving blocker is confined to a
subset of the unit's cases, the loop **splits the unit** — the stuck cases are
carved out (recorded `blocked`, code quarantined behind a declared skip or, if
itself condemned, removed with a preservation sha) and the finished remainder
still lands. An unscoped `persists` chains N finished cases to the fate of one
stuck one; that exact coupling once stranded four merged-ready cases behind a
single policy question.

Two failure modes to name, because both are tempting and both are expensive:

- **Do not use `persists` to end a loop you find tiresome.** The test is whether
  more effort could plausibly fix it — not whether you have said it before. An
  item marked `persists` that was actually never attempted ships work everyone
  knew was unfinished, and it ships it labelled `blocked`, so nobody goes back
  to it.
- **Do not withhold the classification.** An unclassified re-review leaves the
  loop unable to tell "forgotten" from "impossible"; twice in a row and the unit
  stops on that ground alone, which helps nobody.

## The review anchor — walk the case against the code

Two artifacts, and the binding between them is the coverage contract
([`coverage-contract.md`](coverage-contract.md)):

1. **The case** — read the intake snapshot at
   `.agents/automation/<slug>/cases/<ID>.md`, or the in-repo case file where
   intake passed a path. ALL fields, not just the steps table — description,
   preconditions, test data, expected results (some sources carry real
   acceptance criteria in the description or preconditions, so a steps-only
   read silently drops requirements). Fetch from the TMS only if the snapshot
   is missing; never approve on the diff alone — if no case is reachable,
   return flagging "source case unavailable; coverage walk impossible".
2. **The code** — the PR diff, the spec with its coverage declaration, the
   page-object changes.

**The step walk.** For every case step — plus any requirement carried by the
description or preconditions — one of two things is true in the code:

- a **real assertion at that step**, not only an end-state assertion — a step
  performed as a bare action (navigation/click/request) with no `expect()`
  where an observable is specified is `CHANGES_REQUESTED`; a green test proves
  nothing about an intermediate step that was never asserted, and this is the
  one gap no automated gate can see; or
- a **valid exclusion** in the coverage block — category from the closed
  vocabulary, referent present.

A step with neither — a **silent gap** — is blocking, always. Under batch
volume this walk is the last line against invisible under-coverage; treat it
as load-bearing.

**Touch every referent.** An exclusion is verified against its referent, not
its prose:

- `covered-elsewhere` — open the named test and confirm the claimed assertion
  exists, at the claimed step, asserting the claimed observable, in a spec
  **merged on base** (a same-batch target, or a spec that merely exists, is
  `CHANGES_REQUESTED`).
- `blocked-by-defect` — open the defect: it exists, it is open, and it matches
  the excluded step.
- `un-automatable` — the category is in automation-scoping's complexity
  taxonomy AND the intake verdict for this case supports it (below).
- `by-seeded-policy` — read the named policy line in `.agents/testing.md`; it
  says what the exclusion claims.

**Cross-check the exclusion budget.** The intake screening verdicts
(`.agents/estimation/<slug>-verdicts.json`) are the batch's authority on what
is un-automatable. An `un-automatable` exclusion the screening didn't see is
`CHANGES_REQUESTED` — the engineer may *request* new un-automatability with an
escalation to the lead, never declare it mid-build. This is the check that
keeps "hard" from quietly becoming "excluded".

**Family specs (clustered cases) — per-ROW walk.** When one parameterized spec
covers several cases, walk EVERY case: each case id has its own
coverage/excluded pair, maps to a data-table row whose DISTINCT expected
values are actually asserted. A shared flattened assertion across rows, or a
case id with no row, is `CHANGES_REQUESTED`.

**Execution provenance.** A `manual-qa-verified` unit cites the manual-qa run
id it was built from; a `needs-execution` unit cites the runner's PASS result.
Provenance missing where the route requires it is a finding — the gate proves
the code, but the provenance is what says the *case* was ever observed live.

**Drift is filed, never absorbed.** The case is upstream input — TA never
edits it. Where the live product demonstrably diverges from the case text
(reverse-masking guard: asserting stale case text against live-correct product
is masking in the other direction), the divergence is a `clarification`
finding for the case's author, and the code asserts the live truth with the
divergence noted. Where the code diverges from the case with no such grounds,
it is `CHANGES_REQUESTED`.

This anchor governs pipeline PRs born from a case. For a **technical unit** —
tech-debt, a migration, a config or reporting fix dispatched on a
[tech-task brief](tech-task-brief.md) — the walk holds with substitutions:
**source item ↔ brief ↔ diff**. The brief's acceptance criteria are ticked the
way case steps are walked (every criterion demonstrably met in the diff, or
`CHANGES_REQUESTED`), and its **Out of scope** section is the drift check — a
diff touching what the brief excluded is scope creep to flag, not initiative
to reward. For a **case-less audit** — legacy or AI-generated tests with no
provenance and no brief — review against § Standing reviewer checks and record
the missing upstream contract as a finding; don't refuse the review for lack
of a case.

## Standing reviewer checks

- **The step walk** (above) — every case element asserted or validly excluded;
  referents touched; exclusion budget cross-checked. This is the "did we
  deliver what was asked" gate, and it is the reviewer's last call.
- **Grammar** — the coverage block parses per
  [`coverage-contract.md`](coverage-contract.md) § Layer 1, and the project's
  idiom (`.agents/testing.md § Coverage idiom`) is followed. The gate greps
  this too; you are the one who catches a block that parses but lies.
- Assertion strength (no demoted expects, no missing `toBeEnabled` guards)
- Selector stability (locator ladder per `.agents/testing.md`; handles traced
  to the surface cache / manual-qa knowledge / live observation, not guessed)
- Defect masking — bi-directional: no `test.fail`/`xit`/weakened assertions
  away from defects (the sanctioned form is a `blocked-by-defect` exclusion
  with the ticket id); no assertions held to stale case-text against
  live-correct product. **One sanctioned exception: a carve quarantine** — a
  skip marker the split path ordered, whose reason quotes the blocker and
  names the unit, on a case recorded `blocked`. The hunt's target is a silent
  skip beneath a case claiming `delivered`; a declared quarantine claims
  nothing. Verify the declaration statically (marker present, reason quotes
  the blocker — the gate's run is what shows it skipped) — do not order its
  deletion.
- POM discipline (no raw selectors in spec files; additive-only on
  shared-caller files — test-automation-implementation § Hard Rules → 3)
- Naming + dead code
- Read-only-by-default check — if seed/cleanup logic shipped where the
  observable could have been asserted read-only on stable data, flag for
  refactor (test-automation-implementation § Hard Rules → 10)

Verdict: `APPROVED` | `CHANGES_REQUESTED` with file:line findings. Findings go back to the builder; the orchestrator decides ship-vs-amend.
