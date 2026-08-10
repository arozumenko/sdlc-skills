# Reviewer slot contract — test-automation-workflow (static review)

The reviewer's full procedure. Loaded on demand by the reviewer dispatch.
This is a STATIC review: the reviewer does not execute the spec — independent
execution belongs to the orchestrator's batch hardening gate (N× consecutive
green). A project may re-enable a reviewer live run via
`.agents/testing.md § Merge gate → reviewer live re-run: on`.

## Reviewer slot

This section IS the reviewer-slot contract for test-automation PRs. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "review test PR #N" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them. (Generic review mechanics — checklist categories, output format — live in the separate `code-review` skill, loaded alongside.)

**Role.** Adversarial review of a test-automation PR. **You did NOT write this code** — that framing is mandatory; without it the review collapses into rubber-stamp. Two reviewers in parallel:

- **`qa-engineer` — fresh session** with the `code-review` skill loaded for generic review mechanics. This section adds the test-automation-specific expectations (triangulation, standing checks).
- **Optional `tech-lead` (Rio)** for framework-scale changes only — not for routine test PRs.

**Session context — read once at session start.** Typically auto-imported via `@-blocks` in your agent's `AGENT.md`; if not, read now:

- `.agents/profile.md`, `.agents/workflow.md`, `.agents/testing.md`, `.agents/architecture.md` — same set as analyst/implementer
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated gotchas
- This skill's § Triangulate three artifacts and § Standing reviewer checks below

Missing context → flag the gap; don't fabricate defaults.

**Per-case parameters** (caller provides at dispatch time):

- TMS case ID
- AFS path — the analyst's translation (one of the three artifacts you triangulate)
- PR ID / branch — the implementation (the second artifact)
- The TMS case itself — fetched via your project's TMS adapter (the third artifact)

**Context economy (hard rules — same wording as the workflow PREAMBLE; keep in step).** The bill is resident-context × turns — every turn re-sends your whole context, so turn count and payload size ARE the cost. Batch independent tool calls into ONE message (read the AFS, the diff, and the case snapshot together, never one tool per turn); read each artifact once and work from what you read (ranged reads for big files; no re-reads to double-check what is already in context); you are STATIC — you never run suites or a browser, so no runner output and no screenshots belong in your transcript. Soft budget, a self-check not a cap: ~15 tool turns per case under review (batching makes turns dense). A genuinely large diff may exceed it; what the check catches is circling — re-reading artifacts already in context, re-diffing what you already diffed. At each ~15-turn mark ask: did the last stretch advance the verdict, or circle? Advance → continue. Circle → write the verdict from what you have, noting what you did not get to.

**Memory you write is a deliverable too.** A review that surfaces a durable gotcha (a pattern the suite keeps getting wrong, a triangulation trap) records it under `.agents/memory/<your-agent>/` and commits it **by exact path** on the branch under review before finishing — an additive `docs(memory):` commit that touches nothing in `automation/`, so the code diff you judged is unchanged. Never leave memory as loose files; uncommitted knowledge is what tree-cleaning sweeps delete.

**Return contract:**

- Verdict: `APPROVED` | `CHANGES_REQUESTED`
- `blocking[]` — what must change before this can land. Everything else worth saying goes in findings.
- Findings list with `file:line` refs (Critical / Important / Nit per the `code-review` skill's Output Format)
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
| `external` | Not resolvable on this branch at all — the AFS is wrong, a framework primitive is missing, it is a product defect, the environment is broken. | **Stop and route** per the playbook's classification table. |

A **new** item you are raising for the first time is not in this list: new ground
is progress and needs no status.

**Scope every classified blocker to the case ids it actually binds**
(`case_ids`). Omit the scope only when the blocker truly holds the whole unit —
a shared fixture, the family AFS, a framework gap. This is load-bearing, not
bookkeeping: when every surviving blocker is confined to a subset of the unit's
cases, the loop **splits the unit** — the stuck cases are carved out (recorded
`blocked`, code quarantined behind a declared skip or, if itself condemned,
removed with a preservation sha; AFS kept) and the finished remainder still
lands. An
unscoped `persists` chains N finished cases to the fate of one stuck one;
that exact coupling once stranded four merged-ready cases behind a single
policy question.

Two failure modes to name, because both are tempting and both are expensive:

- **Do not use `persists` to end a loop you find tiresome.** The test is whether
  more effort could plausibly fix it — not whether you have said it before. An
  item marked `persists` that was actually never attempted ships work everyone
  knew was unfinished, and it ships it labelled `blocked`, so nobody goes back
  to it.
- **Do not withhold the classification.** An unclassified re-review leaves the
  loop unable to tell "forgotten" from "impossible"; twice in a row and the unit
  stops on that ground alone, which helps nobody.

### Triangulate three artifacts — never two

The reviewer's mandatory triangle:

**Covered-by rows — verify against assertions, not existence.** Every
Coverage-Map row disposed as `already-covered` / covered-by-the-covering-spec
is verified against the covering spec's **actual assertions** — the claimed
assertion exists, at the claimed step, asserting the claimed observable. A
row pointing at a spec that merely *exists*, or at a same-batch AFS (merged-
target rule violation), is `CHANGES_REQUESTED`. Under batch volume this is
the last line against invisible under-coverage — treat it as load-bearing.

**Family specs (clustered cases) — per-ROW triangulation.** When one
parameterized spec covers several TMS cases, triangulate EVERY case: each
case id maps to a data-table row whose DISTINCT expected values are actually
asserted, and each case keeps its own Coverage Map rows. A shared flattened
assertion across rows, or a case id with no row, is `CHANGES_REQUESTED`.

1. **Original TMS case** — read the intake snapshot at `.agents/automation/<slug>/cases/<ID>.md` when present; fetch via the project's TMS adapter (full fields, not summary view) only if it's missing. Reading the snapshot means you triangulate against the exact body the analyst worked from — mid-batch TMS edits become the orchestrator's drift check at the close sweep, not your silent skew. This is the *upstream contract*.
2. **AFS** at `test-specs/<feature>/l*_<id>.md` — the analyst's translation of (1).
3. **Implementation** — the PR diff, the spec, the page-object changes.

This triangle governs pipeline PRs born from a case. For a **technical unit** — tech-debt, a migration, a config or reporting fix dispatched on a [tech-task brief](tech-task-brief.md) — the triangle holds with substitutions: **source item ↔ brief ↔ diff**. The brief sits where the AFS sits, its acceptance criteria are ticked the way Coverage Map rows are (every criterion demonstrably met in the diff, or `CHANGES_REQUESTED`), and its **Out of scope** section is the drift check — a diff touching what the brief excluded is scope creep to flag, not initiative to reward. For a **case-less audit** — legacy or AI-generated tests with no TMS provenance and no brief — review against § Standing reviewer checks and record the missing upstream contract as a finding; don't refuse the review for lack of a case.

A reviewer who looks only at AFS ↔ implementation is doing half the job — they miss the class of bug where the AFS itself drifted from the TMS case. Three failure modes, three responses:

| Pattern | Verdict |
|---|---|
| AFS faithful to TMS case + implementation faithful to AFS | APPROVED |
| AFS faithful, implementation drifts | CHANGES_REQUESTED (implementer fix) |
| AFS drifts from TMS case | Either: (a) amend AFS back to faithful translation AND ship the AFS update in the same PR, or (b) document the drift as a CLARIFICATION under Reverse-masking guard (live product diverges from case-text, case-text is the bug) |

Empirically: AFS-drift bugs slip through file:line review because the file and the line both match the AFS — the AFS is the bug. Only triangulation catches it.

### Standing reviewer checks

- **Coverage completeness (vs the source case)** — **tick the AFS Coverage Map Axis 1 against the full original case** (artifact #1 of your triangle, fetched via the TMS adapter / source — its description, preconditions, test data, steps + expected, not just the steps table): every original-case element — each step, **plus any acceptance criterion in the case's description or preconditions** — has a row (pure-setup preconditions reflected in AFS § Preconditions), and every `asserted` row's expected result maps to a real assertion in the implementation; non-`asserted` rows (`already-covered` / `clarification` under the reverse-masking guard / `blocked` / `out-of-scope`) have a documented disposition. A case step with no row, or an `asserted` row whose assertion isn't in the code, is `CHANGES_REQUESTED`. Then sanity-check Axis 2 — each addition is a grounded observable, not scope creep. This is the "did we deliver what was asked" gate, and it is the reviewer's last call. Tick against the **source case**, not just the AFS.
- **Per-step assertion** — every step that carries a case-side (or Axis-2) expected result has a **real assertion AT that step**, not only an end-state assertion. A step performed as a bare action (navigation/click/request) with no `expect()` where an observable is specified is `CHANGES_REQUESTED`. (A green test proves nothing about an intermediate step that was never asserted — this is the one gap no automated gate can see.)
- Assertion strength (no demoted expects, no missing `toBeEnabled` guards)
- Selector stability (locator ladder per testing.md)
- Defect masking — bi-directional: no `test.fail`/`xit`/weakened assertions away from defects; no assertions held to stale case-text against live-correct product (test-automation-implementation § Reverse-masking guard). **One sanctioned exception: a carve quarantine** — a skip marker the split path ordered, whose reason quotes the blocker and names the unit/AFS, on a case recorded `blocked`. The hunt's target is a silent skip beneath a case claiming `automated`; a declared quarantine claims nothing. Verify the declaration statically (marker present, reason quotes the blocker — the gate’s run is what shows it skipped) — do not order its deletion.
- POM discipline (no raw selectors in spec files; additive-only on shared-caller files — test-automation-implementation § Hard Rules → 3)
- Naming + dead code
- AFS amendments — any selector / observable drift between AFS and implementation must be reflected in an AFS docs commit in the same PR
- Read-only-by-default check — if seed/cleanup logic shipped where the observable could have been asserted read-only on stable data, flag for refactor (test-automation-implementation § Hard Rules → 10)

Verdict: `APPROVED` | `CHANGES_REQUESTED` with file:line findings. Findings go back to implementer; the orchestrator decides ship-vs-amend.
