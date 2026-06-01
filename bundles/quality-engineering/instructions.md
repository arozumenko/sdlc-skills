# Quality Engineering Team — shared conventions

This is a **manual quality-engineering discipline team** — requirement
quality, coverage, and traceability, with manual execution. There is **no
test automation in this bundle**: no Playwright framework, no automation
hand-off. These are team-wide defaults; scout refines them per project in
`AGENTS.md`, which always wins over this file.

## The pipeline

The **project-manager (Max)** is the single orchestrator. Work flows in one
direction, and every role reports back to Max — there is **no agent-to-agent
hand-off**; Max routes:

1. **Story triage** — `quality-architect` (Quinn) reviews requirements/stories
   for testability (ambiguity, missing/contradictory acceptance criteria,
   untestable claims, hidden assumptions) and emits a **Requirement gaps &
   questions** report. Max routes it to `ba` (Alex), who owns requirements and
   acceptance criteria and resolves the gaps.
2. **Case authoring** — `qa-engineer` (Sage) writes manual cases. **Every case
   cites a requirement id** — requirements are the traceability anchor.
3. **Manual execution** — Sage runs cases by hand against the current build,
   logs defects, and records results with evidence.
4. **Reporting** — Sage writes the run report.
5. **Triangulation** — Quinn builds the requirement ↔ case ↔ result coverage
   matrix (via the `requirement-traceability` skill) and files findings.

## Requirements are the traceability anchor

Everything traces back to a requirement id. A case with no requirement is an
**orphan** (waste / scope creep); a requirement with no case is **uncovered**.
Don't author cases against **un-triaged** requirements — triage (Phase 0) gates
authoring, so cases are never written against ambiguous or contradictory
criteria.

## Manual execution only

Cases are executed by hand against the **current build**, with evidence
captured before a result is recorded. A green result that wasn't run against
the build under review is **stale** and untrustworthy. No automation framework
runs in this bundle — if a project needs an automated regression suite, that's
a separate discipline to flag, not something this team produces.

## Definition of done (team-wide)

A change is done when:

- **Requirements are triaged** — no open blocking gaps or questions from
  story triage; acceptance criteria are testable and resolved.
- **Cases trace to requirements** — every case cites a requirement id, and no
  orphan cases remain.
- **Results are fresh** — every relevant case was executed against the current
  build, with evidence; no stale greens.
- **No open p0/p1 traceability findings** — no uncovered requirement and no
  weak-evidence / contradiction findings at p0/p1 in the triangulation matrix.

"I wrote the cases" is not done. The QE gate is the matrix with no open
p0/p1 findings.
