---
id: HYP-NNN
type: hypothesis
title: "<the bet, one sentence — what we believe and why>"
status: incubating
created: <YYYY-MM-DD>
last_touched: <YYYY-MM-DD>
parent_problem: docs/discovery/problems/<PRB-NNN-slug>.md
outcome: "docs/discovery/outcomes.md#tbd"
discovered_from: docs/discovery/journeys/<journey-file>.md
evidence:
  - docs/discovery/journeys/<journey-file>.md
confidence:                # 0–10 per Cagan risk — earned via `grill-decision`, never hand-typed
  value:                   # unset at birth; `prioritize-bets` treats an all-unset block as unscoreable
  usability:
  feasibility:
  viability:
appetite:                  # effort / job-size input — `2-weeks` | `4-weeks` | `8-weeks`, set by `grill-decision`
priority: {}               # born empty — `prioritize-bets` replaces this with a scored block
node_type: solution
parent: docs/discovery/problems/<PRB-NNN-slug>.md
---

# <the bet, one sentence>

## The bet

<We believe that [doing X] for [persona] will [produce this observable behavior change]. State
the mechanism, not just the desired result.>

## We'll know we're right when…

<The observable signal that confirms the bet — tied, eventually, to the outcome anchor this
hypothesis's `outcome:` field points at once one is ratified.>

## We'll know we're wrong when…

<The observable signal that falsifies the bet. A hypothesis with no way to be wrong is not
testable — this field is not optional.>

## Assumptions

<The load-bearing beliefs this bet rests on. `grill-decision` forces the riskiest through the
kill-assumption contract and writes them here; `stakeholder-interview` sweeps this section for
`risk: critical` items that are still untested and turns them into interview questions. An
assumption nobody has flagged a risk level on has not been grilled yet.>

- **<The assumption, stated as a falsifiable proposition>** — `risk: critical`
  - Fails if: <the concrete condition under which it is false>
  - Evidence to get this week: <the cheapest signal that moves belief>
  - Kill criterion: <what result would make you abandon the bet>
  - Cheapest test: <the smallest experiment that produces that signal>

## Acceptance criteria

- <Criterion 1 — what must be true for this bet to be considered validated.>
- <Criterion 2>

## Evidence

- Origin: `docs/discovery/journeys/<journey-file>.md` (the journey that motivated this bet).
- <Additional evidence links as they accumulate.>
