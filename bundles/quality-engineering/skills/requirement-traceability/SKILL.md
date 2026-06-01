---
name: requirement-traceability
description: Use when triaging requirements/stories for testability or auditing requirement-to-case-to-result coverage — emitting a gaps-and-questions report and a traceability matrix with uncovered-requirement / orphan-case / stale-result / weak-evidence findings.
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

## Requirement Traceability — the QE coverage discipline

This skill is the methodology the `quality-architect` agent preloads in the **quality-engineering** bundle. It is **agent-orchestrated, not user-invokable**: a human (or the `project-manager` running the QE pipeline) asks the quality-architect to triage a story or audit coverage; the architect runs the phases below and returns a report. The architect is the **standard-owner** here — not the pipeline orchestrator. Orchestration (dispatch order, who authors, who executes, the QE gate) is the `project-manager`'s job; this skill owns the two analytical ends of the discipline: requirement testability up front, requirement↔case↔result coverage at the back.

This is the **manual** governance/coverage discipline — there is no automation framework, no Playwright handoff, no AFS-for-automation. Cases are authored and executed by hand (`qa-engineer`); this skill governs whether those requirements were testable in the first place and whether the cases-and-results actually cover them.

**Core philosophy:** coverage is a *relation*, not a count. "We have 200 test cases" says nothing — the question is which requirements those cases trace to, whether any case traces to nothing, and whether the green results were produced against the build under audit. A high case count with broken traceability is worse than fewer honest cases, because it manufactures false confidence. Every finding here points at a concrete artifact — a requirement ID, a case file, a run record — never a vibe.

**The pipeline this skill bookends.** The QE bundle runs `story triage → (gaps & questions) → case authoring → manual execution → reporting → triangulation`. This skill owns **Phase 0** (the front gate — story triage) and **Phase 1** (the back gate — triangulation). The middle (authoring, execution, reporting) is `qa-engineer`'s craft. Both phases report back to the `project-manager`, who routes — there is no agent-to-agent handoff.

## Two phases, two gates

| Phase | When | Input | Output | Gate it enforces |
|---|---|---|---|---|
| **Phase 0 — Story Triage** | Before any case is authored | Requirements / stories / acceptance criteria | **Requirement gaps & questions** report → BA/PO | No case authoring against un-triaged requirements |
| **Phase 1 — Triangulation** | After cases exist and a run has executed | Requirements + cases + results | **Traceability matrix** + p0–p3 findings | No "trustworthy green" without fresh results against the current build |

Run Phase 0 when the request is "review this story", "is this testable", "what's missing before we test". Run Phase 1 when the request is "audit our coverage", "is this requirement covered", "do our results prove the requirement". If a request spans both (a fresh epic with stories *and* a half-built case suite), run Phase 0 on the un-triaged stories first, then Phase 1 on what's already authored.

---

## Phase 0 — Story Triage (the front gate)

Review each requirement/story for **testability** before a case is written against it. An untestable requirement produces an untestable case, which produces a meaningless result — the rot starts here, so the gate is here.

### What to look for

Read each story / acceptance criterion and classify it against five testability defects:

| Defect | What it looks like | Why it blocks testing |
|---|---|---|
| **Ambiguity** | "should be fast", "user-friendly", "handles errors gracefully" — no measurable predicate | No pass/fail line — two testers would write contradictory cases |
| **Missing acceptance criteria** | Story states an intent but never says what "done" observably looks like | Nothing concrete to assert against |
| **Contradictory criteria** | Two ACs (or an AC vs. the story body, or AC vs. a sibling story) that can't both hold | Any case you write fails one half by construction |
| **Untestable claim** | "system is secure", "scales infinitely", "always available" — unbounded / unobservable | No finite procedure can confirm it; needs reframing into a bounded, observable claim |
| **Hidden assumption** | Relies on an unstated precondition — a role, a feature flag, a data state, an upstream system being up | The case author guesses the precondition; the result is conditional on a guess |

Use [`verifying-outcomes`](skills/verifying-outcomes/SKILL.md) as the lens: for each AC, ask its five questions backward — *can I state this as a concrete testable outcome? what must be TRUE / EXIST / CONNECTED? where would it break?* An AC that can't survive that reframing is a triage finding, not a testable requirement.

### Inputs

- BA stories / acceptance criteria from the tracker (read `.agents/profile.md` § Issue tracker for which one).
- Requirement / spec docs in the repo or linked.
- A requirement matrix delivered as Excel — import it via [`xlsx-reader`](skills/xlsx-reader/SKILL.md) (`node scripts/read_xlsx.js <reqs.xlsx>`), then read the produced Markdown so each requirement is an addressable row.

### Output — the Requirement gaps & questions report

Emit a report addressed to the **BA/PO** (returned to the `project-manager`, who routes it to `ba`). Each entry is a finding on the **p0–p3 schema** (§ Finding schema below) plus a concrete **question** the BA can answer to close it:

```markdown
## Requirement gaps & questions — {epic / story set} ({date})
{N} requirements triaged · {blocking} blocking · {clarifying} clarifying

### {REQ-ID / story title}
- **[p1] Ambiguity** — "{quoted criterion}"
  - Why untestable: {no measurable predicate / no pass line}
  - Question for BA: {the specific question that yields a testable criterion}
  - Suggested testable form: {a concrete rewrite, offered — not imposed}
```

**The gate.** Requirements with a **p0/p1** triage finding are **not ready for case authoring** — return them to the `project-manager` as blocked-for-authoring. p2/p3 findings are clarifying: authoring may proceed, but the question rides along with the case. Do **not** let case authoring start against a requirement carrying an open p0/p1 testability finding — that is the rot the front gate exists to stop.

---

## Phase 1 — Triangulation (the back gate)

Build the **requirement ↔ case ↔ result** coverage matrix and surface the four gap classes. This is the audit that turns "we ran the suite, it's green" into "here is exactly which requirements that green actually proves, and which it doesn't."

### The three inputs

Triangulation needs three artifacts, each addressable by ID. Gather all three before building the matrix — a matrix missing any leg can only find a subset of the gap classes.

| Leg | Source | How to ingest |
|---|---|---|
| **Requirements** | BA stories / tracker / spec docs / a requirement matrix in Excel | Tracker read, repo docs, or [`xlsx-reader`](skills/xlsx-reader/SKILL.md) for `.xlsx` matrices → Markdown rows |
| **Cases** | Manual test-case files (`test-specs/…`, markdown), or a case workbook in Excel, or the TMS | Read the case files; `xlsx-reader` for `.xlsx` case lists; tracker/TMS for managed cases |
| **Results** | Manual run reports (`qa-engineer`'s reporting output), or TMS executions | Read the run report / execution records; note **which build** each result was produced against |

Each requirement, case, and result must carry a stable ID and an explicit link (case → requirement it traces to; result → case it executed). Where the link is missing in the source, that absence is itself a finding (it's how orphans and uncovered requirements surface).

### Build the matrix

Lay out one row per requirement, columns for the cases that trace to it, and the freshest result for each case. The full layout, column semantics, and a worked example live in [`references/traceability-matrix.md`](references/traceability-matrix.md). The matrix is the artifact; the four gap classes below are read **off** it.

### The four gap classes

Every triangulation finding falls into exactly one class. Each maps to a default priority band on the p0–p3 schema — adjust per the requirement's own priority and the evidence strength.

1. **Uncovered requirement** — a requirement with **no case** tracing to it. The coverage hole. Default **p0** for a p0/p1 (must-work / critical-path) requirement, **p1** otherwise. This is the highest-stakes class: a critical requirement nobody is testing.

2. **Orphan case** — a case tracing to **no requirement**. Waste or scope-creep: effort spent testing something no requirement asked for (or a requirement that was deleted/renamed and the link rotted). Default **p2**. Not a coverage *hole*, but a signal the suite has drifted from the requirement set — either link it to its real requirement or retire it.

3. **Stale result** — a case that exists and traces correctly, but was **not executed against the current build** (last run is against an older build, or never run). The result is **untrustworthy green**: the suite "passes" on a build nobody verified. Default **p1** if it covers a p0/p1 requirement, **p2** otherwise. Green-on-stale is the most dangerous illusion in the matrix because it *reads* as covered.

4. **Contradiction / weak evidence** — a case that "passes", but the **evidence doesn't actually prove the requirement**. The case asserts something adjacent, the result lacks the proof the assertion implies, or the case and requirement quietly contradict. Default **p1** — a green that doesn't prove its requirement is functionally an uncovered requirement wearing a pass badge. Apply the [`verifying-outcomes`](skills/verifying-outcomes/SKILL.md) lens to the result: does the captured evidence make the requirement's claim *TRUE*, or just make the case step "done"?

### Output — matrix + findings

Return two things to the `project-manager`:

1. The **traceability matrix** (per [`references/traceability-matrix.md`](references/traceability-matrix.md)) — the coverage relation, every cell traceable.
2. A **findings list** on the p0–p3 schema, each tagged with its gap class and routed: uncovered → `project-manager` routes to `qa-engineer` to author; orphan → route to retire/relink; stale → route to re-execute against the current build; weak-evidence → route to strengthen the case or re-run with the missing proof.

**The gate.** No requirement is reported as **covered** ("trustworthy green") unless a case traces to it **and** that case has a **fresh result against the current build** **and** the result's evidence proves the requirement's claim. Coverage = case ∧ fresh-result ∧ sufficient-evidence. Any leg missing flips it from green to a finding. State the build/version the matrix was triangulated against in the report header — a matrix without a build stamp is itself stale.

---

## Finding schema

Both phases emit findings in this shape — the same p0–p3 vocabulary the [`quality-audit-workflow`](skills/quality-audit-workflow/SKILL.md) skill uses, so QE findings dedup and rank alongside dimensional-audit findings when the `project-manager` rolls them up:

```json
{
  "title": "Short descriptive title",
  "phase": "triage | triangulation",
  "gap_class": "uncovered-requirement | orphan-case | stale-result | weak-evidence | testability",
  "priority": "p1",
  "confidence": 8,
  "requirement_ref": "REQ-123 / story link",
  "artifact_ref": "TC-045 / run-2026-05-12 / story body",
  "reasoning": "Why this breaks coverage or testability, and the impact",
  "suggested_fix": "Plain-English action (author case / relink / re-execute / ask BA …)",
  "question_for_ba": "(triage only) the specific question that closes the gap"
}
```

**Priority.** `p0` = critical (a must-work requirement uncovered, or a triage defect that blocks all authoring on a critical path); `p1` = high (uncovered non-critical requirement, stale result on a critical case, weak evidence on a key claim, blocking ambiguity); `p2` = medium (orphan case, stale result on a low-priority case, clarifying gap with a workaround); `p3` = low (cosmetic traceability hygiene, minor wording question).

**Confidence (1–10).** 8–10 = definite (the link is provably absent / the result is provably against an older build / the evidence provably omits the claim); 5–7 = likely (strong indirect indicators — e.g. a result with no build stamp); 1–4 = possible (the source data is incomplete and you're inferring). Never fabricate a link or a result to fill a matrix cell — an unknown cell is a finding ("traceability data missing"), not a guess.

## Anti-patterns

- **Authoring against an un-triaged requirement.** The front gate exists precisely to stop this. If a case is being written against a story carrying an open p0/p1 testability finding, the rot is already in.
- **Counting cases as coverage.** "200 cases" is not a coverage statement. Coverage is the requirement↔case↔result relation, read off the matrix.
- **Trusting green without a build stamp.** A pass produced against an unknown or older build is a stale-result finding, not coverage. Always pin the build.
- **Confusing orphan cases with uncovered requirements.** Orphans are cases pointing nowhere (waste); uncovered requirements are requirements nobody tests (holes). Opposite ends of the relation — don't conflate them in the report.
- **Accepting "the case passed" as proof the requirement holds.** A pass proves the *case* ran; weak-evidence triangulation asks whether the case actually proves the *requirement*. Apply the goal-backward lens.
- **Fabricating a matrix cell.** An unfilled link is a finding, not a number to invent. Lower confidence and flag the missing data.
- **Acting as the orchestrator.** The quality-architect owns the *standard* and the *analysis*; the `project-manager` owns dispatch and the QE gate. Report findings and route recommendations back to the PM — don't dispatch `qa-engineer` directly.

## References

- [`references/traceability-matrix.md`](references/traceability-matrix.md) — the matrix layout, column semantics, build-stamp rule, and a worked example showing all four gap classes.
- [`skills/verifying-outcomes/SKILL.md`](skills/verifying-outcomes/SKILL.md) — goal-backward verification; the lens for triage testability and weak-evidence triangulation.
- [`skills/xlsx-reader/SKILL.md`](skills/xlsx-reader/SKILL.md) — importing requirement / case matrices delivered as Excel into addressable Markdown rows.
- [`skills/quality-audit-workflow/SKILL.md`](skills/quality-audit-workflow/SKILL.md) — the p0–p3 finding schema vocabulary this skill reuses, so QE findings rank alongside dimensional-audit findings.
