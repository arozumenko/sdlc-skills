# Learning loops: how the harness improves itself — design (v1)

Status: v1 draft for review · 2026-11-13

## Why

The harness already improves, but only one improvement so far adjusts itself (effort calibration, #105).
Everything else came from the same manual process: mine transcripts and ledgers, rank the problems,
a person decides, a rule or setting changes. None of it is written down as a strategy. So:

- we cannot tell which changes learn on their own and which are fixed rules;
- rejected ideas get proposed again, because the evidence against them lives in private notes;
- several changes went live in the same window, and a later re-measure could not separate them.

This spec names the capabilities, fixes the contract every loop follows, and sets the change control
that keeps an improvement from making things worse.

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Adaptive** | Changes behaviour with current conditions, by a fixed rule | compact when context passes a size limit |
| **Learning loop** | Changes behaviour from **its own history**, without a person editing anything | effort calibration: estimates come from the cost of landed tasks |
| **Self-improving** | A learning loop **with measured proof** that the outcome got better | calibrated estimates beat the earlier hour estimates |
| **One-off improvement** | Measured, decided by a person, changed once; stays fixed | brief-ranked memory selection (#103), a review rule |

The test that separates a learning loop from a one-off: **does it change its own next decision from
recorded data?** If a person has to edit a rule each time, it is a one-off.

"Self-improving harness" is the goal. "Learning loops" are the parts. A loop is called self-improving
only after its improvement metric (below) shows a gain.

## The loop contract

Every learning loop has the same three steps and the same guarantees.

1. **Record at the time.** A hook writes facts as work happens (dispatch cost, finding outcome, context
   size). Never a hand-kept file: hand-kept ledgers drifted to ~40% blank or "unverified" rows in the
   review trial below.
2. **Count at retro.** One command turns records into a small table (per effort class, per reviewer
   cell, per gate). The project-manager runs it at mission close, next to `delivery.mjs report`.
3. **Apply at the next plan.** The planner reads the table and uses it (an estimate, a lineup, an extra
   check, a session limit).

Guarantees:

- **Safe default.** Below a minimum sample size a cell uses the shipped default and says so.
- **No operator work.** Installing the skill is enough. The operator may read the report or override in
  the project briefing; nothing is required.
- **Local data.** Records and tables stay in the project (`.agents/telemetry/`). Nothing leaves it.
- **Off switch.** Each loop can be disabled by one setting; disabled means the pre-loop behaviour.
- **Improvement metric.** Each loop names the number that proves it helps, and the report shows it.

## Shared core

- **Engine:** record → count → look up, with the minimum-sample fallback. It exists in delivery-monitor
  since #105 (effort calibration). New loops plug into it; they do not copy it.
- **Provenance IDs:** every mining job in the 2026-11 round had the same gap: no stable link from
  dispatch → task → review round → finding → fix → bug. The dispatch hook records the first two today.
  Loops 2+ need the rest. This is shared work, built once.
- **Extraction rule:** the shared engine is extracted from two working loops, not designed ahead of them.

## Change control

Most of the risk is in changing too much at once. Rules for every new loop or one-off:

1. **One change at a time per project.** Two experiments may run together only in different projects.
2. **Baseline first.** Record the success and guard metrics before switching anything on.
3. **Stated up front:** success metric; guard metrics (escapes, blocking findings, missed rulings or
   scope, rework); time window (one mission or ~2 weeks); stop margin.
4. **Staged rollout:**
   1. **shadow:** record only, change nothing;
   2. **pilot:** one project, one mission;
   3. **both projects;**
   4. **default** in sdlc-skills.
5. **Stop rule.** A guard metric worse than baseline beyond the agreed margin: roll back first, then
   investigate.
6. **Freeze.** No model, reviewer or rule changes in that project during the window. An unavoidable
   change is logged and the result is judged with it in mind.
7. **Change log.** One entry per change (what, where, when, baseline, result) in the registry below.
8. **Owner decides.** Moving a stage forward, and any merge, needs the owner's explicit go-ahead.

## How we find candidates

Repeatable method, used for the 2026-11 round:

1. Mine the window's transcripts and ledgers with one job per question (a cheap model is fine for
   mining). Every job reports the same cost units (dispatches, turns, tokens, hours, USD) plus the share
   of the window total, so results compare.
2. Each job hand-checks ≥ 20 random labels and reports its error rate before correction.
3. A person checks the headline number of each job against the raw source.
4. Rank by measured cost of the problem, data readiness, and build cost. Dollar figures are spend
   *associated* with a problem, not proven waste.
5. Project data stays private. This repo is public: only method, contract and anonymised aggregates go
   here.

## Registry

Stages: candidate → shadow → pilot → rolled out, or rejected (with the reason, so it is not rebuilt).

### Learning loops

| Loop | Learns | Stage | Improvement metric | Evidence |
|---|---|---|---|---|
| **Effort calibration** (#105) | cost per effort class → estimates | rolled out to project B 2026-11-13; project A pending; measuring until enough landed tasks | estimate error vs measured cost | — |
| **Orchestrator context** | the session/compaction point that minimises cost per accepted task | candidate → pilot next (one project) | orchestrator cost per accepted task; guard: missed rulings/scope | orchestrator ≈ 39% of window spend; 87.5% of it at context > 150K |
| **Escapes per gate** | which gate leaks which cause | candidate (needs `origin` + `escaped_gate` at bug filing) | escapes per mission, by gate | 36 escapes in 2 weeks, 13 major; most filed "bugs" were review leftovers |
| **Review round cap** | when to restructure instead of another round | candidate | rounds per task; guard: blockers after merge | tasks over 2 rounds ≈ 10% of spend |
| Review hit rate (reviewer down-ranking) | which reviewer cells are noise | **rejected** 2026-11-13 | — | review ≈ 22% of spend, noise < 1%; best case ≈ 0.3% |
| Brief quality | which briefs get misread | **rejected** 2026-11-13 | — | 3 of 749 dispatches failed on the brief |

### One-off improvements and settings

| Change | Kind | Stage | Before → after |
|---|---|---|---|
| Hook context cap (#81) | one-off | rolled out | role rules delivered 0/3 → 3/3 in eval |
| Memory: brief-ranked MEMORY.md lines (#103) | one-off | rolled out | eval EM1N 0/5 → 5/5 |
| Review rules from the 2026-10 trial (re-review by the blocker, overrule needs a ruling, plan blockers need an executed check) | one-off | candidate | trial: proven blockers 24% → 92% (project B) with red-run proof |
| Orchestrator pilot settings (compaction cap at ~200K, rulings/deferrals file re-loaded after compaction, event-driven waiting, capped tool output with full logs in files) | adaptive + one-off | candidate → pilot with the orchestrator loop | see orchestrator loop |
| Rulings and deferrals registry; seeded-doc freshness | one-off (foundation) | candidate | late spec issues, stale seeded docs contradicting rulings |
| Memory write-time gate and task cards | one-off | candidate | ≈ 0.5% likely saving |

### Change log

| Date | Change | Where | Note |
|---|---|---|---|
| 2026-11-12 | Effort calibration merged (#105) | sdlc-skills | estimates in USD, auto-accepted when calibrated |
| 2026-11-13 | Effort calibration installed | project B | dispatch-cost hook starts after a checkout move + restart (pending) |

## Out of scope

- Model or effort changes for any role: the owner's call, never a loop's.
- Loops that act across projects or send data out of a project.
- Building the shared engine before a second loop works.

## Open questions

1. Minimum sample per cell for a loop to leave its default (calibration uses 5 per cell, 12 per class).
2. Stop margin per guard metric.
3. Where the registry lives once loops ship in consumer projects: this spec, or a generated file.
