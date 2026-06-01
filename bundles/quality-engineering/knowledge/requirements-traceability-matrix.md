# Requirements Traceability Matrix

The single source of truth for *what we promised* (requirements), *what we built
to check it* (cases), and *what actually happened* (results). One row per
requirement. The matrix is how Quinn (quality-architect) runs Phase 1
triangulation — every requirement, case, and result must line up, and every
mismatch is a named gap. A green that isn't traced is not a green.

Seed one copy of this file per project, then keep it current as requirements
land, cases are authored, and runs complete. It is the artifact the QE gate
reads before a story is allowed to close.

---

## Matrix

| Requirement ID | Requirement summary | Acceptance criteria | Case ID(s) | Last result | Last run/build | Coverage status |
|----------------|---------------------|---------------------|------------|-------------|----------------|-----------------|
| REQ-001 | <one-line intent> | <AC-1; AC-2 — the testable conditions> | TC-001, TC-014 | PASS | RUN-2026-05-18-001 / build 4.2.0 | covered |
| REQ-002 | <one-line intent> | <AC-1> | — | — | — | uncovered (P1) |
| REQ-003 | <one-line intent> | <AC-1; AC-2> | TC-022 | PASS | RUN-2026-04-02-003 / build 3.9.1 | stale |
| REQ-004 | <one-line intent> | <AC-1> | TC-030 | PASS | RUN-2026-05-18-001 / build 4.2.0 | weak-evidence |
| — | (no requirement) | — | TC-041 | PASS | RUN-2026-05-18-001 / build 4.2.0 | orphan |

> Add one row per requirement. Orphan cases (no requirement) are recorded with a
> blank `Requirement ID` so they stay visible — they are scope to either justify
> or delete, not silent extra coverage.

---

## Column reference

| Column | What goes here |
|--------|----------------|
| Requirement ID | The BA/PO requirement or story ID (e.g. `REQ-001`, `JIRA-1234`). Blank only for orphan rows. |
| Requirement summary | One line — the intent, not the implementation. |
| Acceptance criteria | The testable conditions, AC-by-AC. If empty/ambiguous, the requirement isn't triaged yet — send it back via story triage (Phase 0) before authoring cases. |
| Case ID(s) | Every case that traces to this requirement. `—` if none exist. |
| Last result | Outcome of the most recent run of those cases: `PASS` / `FAIL` / `BLOCKED` / `—` (never run). |
| Last run/build | The run report ID **and** the build/version the result was produced against. Both are required — a result without a build can't be judged stale. |
| Coverage status | One of the legend values below. |

---

## Coverage status legend — the four gap classes

| Status | Meaning | Severity hint |
|--------|---------|---------------|
| **covered** | Requirement has ≥1 case, the case ran against the current build, and the evidence actually proves the AC. The only clean state. | — |
| **uncovered** | Requirement with no case. A promise nothing checks. Tag the priority of the requirement: `uncovered (P0)` for critical/contractual, `uncovered (P1)` for important. | P0 / P1 |
| **orphan** | Case that traces to no requirement. Waste or scope-creep — either tie it to a requirement or retire it. | P2 |
| **stale** | Case exists and last passed, but was **not** executed against the current build — an untrustworthy green. Re-run before trusting. | P2 |
| **weak-evidence** | Case "passes" but the evidence doesn't actually prove the AC (asserts the wrong thing, skips the AC, or proves a proxy). A contradiction between result and requirement. | P1 |

A row is **covered** only when none of the other four apply. Anything else is a
finding on the P0–P3 schema, owned by Quinn and routed by Max (PM).

---

## How to fill it

1. **Requirements in first.** Pull requirements/stories from the BA (Alex) —
   docs, tickets, or a matrix imported via the `xlsx-reader` skill. One row each.
   Fill `Requirement ID`, `summary`, `Acceptance criteria`. If the AC is empty,
   vague, or contradictory, the requirement failed Phase 0 triage — do not
   author cases against it; raise it in the gaps & questions report.
2. **Map cases.** For each authored case, find the requirement it traces to and
   add its ID to `Case ID(s)`. A case that maps to nothing gets its own orphan
   row (blank `Requirement ID`).
3. **Post results.** After a run, write `Last result` and `Last run/build` from
   the run report. Always record the build — that's what makes a result
   judgeable later.
4. **Set coverage status.** Apply the legend to every row.

## How to read it

- Scan the `Coverage status` column top to bottom — every non-`covered` value is
  a gap to act on.
- **uncovered (P0/P1)** → cases must be authored (qa-engineer, Sage). Highest
  priority is uncovered P0.
- **stale** → re-run the cases against the current build before any sign-off.
- **weak-evidence** → the case needs reworking; the current green is not
  trustworthy. Often surfaced by the `verifying-outcomes` goal-backward check.
- **orphan** → confirm with the BA whether it's hidden scope (needs a
  requirement) or dead weight (retire it).
- The QE gate passes only when every requirement row is **covered** — or each
  exception is explicitly accepted by the PM with a recorded rationale.
