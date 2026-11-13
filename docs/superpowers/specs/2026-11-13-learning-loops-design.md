# Learning loops: how the harness improves itself — design (v2)

Status: v2 after adversarial review round 1 (Codex gpt-6-astra, high: REJECT, 15 findings, all addressed) · 2026-11-13

## Why

The harness already improves, but only one improvement so far adjusts itself from its own data
(effort calibration, #105). Everything else came from a manual process: mine transcripts and ledgers,
rank problems, a person decides, a rule or setting changes. None of it is written down as a strategy, so:

- we cannot tell which changes learn on their own and which are fixed rules;
- rejected ideas come back, because the evidence against them lives in private notes;
- several changes went live in the same window, and a later re-measure could not separate them.

This spec names the capabilities, states the contract a loop must meet, describes where the shipped
loop meets it and where it does not, and sets the change control that keeps an improvement from
making delivery worse.

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Adaptive** | Changes behaviour with current conditions, by a fixed rule | compact when context passes a fixed size |
| **Learning loop** | **history → learned state → changed decision**, with no person editing a rule | effort calibration: landed task costs → per-cell cost distribution → the estimate a new task gets |
| **Self-improving** | A learning loop whose **prospective** improvement metric beats a frozen baseline (see Improvement proof) | not yet claimed for any loop |
| **One-off improvement** | Measured, decided by a person, changed once; stays fixed | brief-ranked memory selection (#103), a review rule |
| **Instrumentation** | Records and reports; changes no decision | an escapes-per-gate report |

A registry entry is a **learning-loop candidate** only when all three parts are named: the history it
reads, the state it learns, and the decision that state changes. Otherwise it is instrumentation, an
adaptive rule, or a one-off.

## The loop contract

Steps:

1. **Record at the time**, by hook or CLI event, never a hand-kept file.
2. **Count** with one command that turns records into a small state table.
3. **Apply**: the planner (or the agent that owns the decision) reads the state at a stated trigger.

Requirements:

- **Stated activation.** Supported hosts, setup steps, and the agent that runs the count and apply steps,
  including who does it when there is no project-manager role. "No routine operator work after setup" is
  the goal; setup itself is not zero work.
- **Cold start and fallback.** The behaviour with no or too little history is written down: a shipped
  default value, a coarser learned cell, or *no decision* (e.g. the task stays unestimated). "Unestimated"
  is a valid fallback and is not called a default.
- **Effective sample.** Where samples are weighted (e.g. by recency), the minimum is on the **effective**
  sample size (Kish: (Σw)²/Σw²), not the raw count, plus a freshness limit. Failing either gives the
  fallback.
- **Data boundary.** Records stay inside **consumer-controlled storage**: the project's own repository and
  any remote the project configures. They never go to the harness authors or a third party. Records are
  minimal (no prompt or transcript text); a user id is recorded only where attribution needs it.
  A **local-only mode** (no push from any component) must exist and be documented.
- **Off switch.** One persistent setting per loop. Off means: no new state is computed, no new decision
  uses the state, and the pre-loop behaviour returns for new decisions. Decisions already made stay as
  recorded history (for audit); rolling back does not rewrite them.
- **Improvement metric.** One primary metric, its baseline, and its guard metrics, defined before the
  loop goes live (see Change control).
- **Decision provenance.** Every decision the loop makes records the state version that produced it
  (#105 already stores the calibration file's sha256 with each estimate).

## Where the shipped loop stands (#105, effort calibration)

Reference implementation: `skills/delivery-monitor` (`scripts/lib/calibrate.mjs`, `hooks/dispatch-hook.mjs`).

| Contract item | #105 today | Gap |
|---|---|---|
| History | priced cost of hooked Claude dispatches on landed tasks | Claude Code only; other hosts record no cost |
| Learned state | `calibration.json`: per cell `role|type|novel` → `role|type` → `role` → `type` → `all`, recency-weighted (half-life 42 days) p50/p80 USD; effort-class boundaries from all samples | — |
| Decision | `plan register` fills an unestimated task with the first cell of `n ≥ 5` as a `usd` range, auto-accepted | — |
| Activation | skill install + **separately run** `install-hooks.mjs` (installing the skill never wires the hook) + plan registered + session bound + landings recorded; PM runs `calibrate` after the **last mission of a campaign** closes | setup is not zero; trigger is per campaign, not per mission |
| Cold start | no cell with `n ≥ 5` → task stays **unestimated**; planner may give an hours range, which needs human acceptance | no shipped numeric default (by design) |
| Effective sample | raw `n ≥ 5` per cell, 12 samples in total for class boundaries; recency weights not counted | **gap:** 4 old + 1 new sample passes `n ≥ 5` and behaves like n≈1 |
| Data boundary | hook commits and **pushes** the telemetry repo (`sync.mjs`) unless `DELIVERY_NO_SYNC=1`; events carry a user id | **gap:** push is default-on; local-only needs the env var and is not documented as a mode |
| Off switch | `--no-calibrate` stops new fills for one registration; earlier fills stay; recording and `calibrate` continue | **gap:** no persistent off setting |
| Improvement metric | `report` scores estimates against measured cost in `usd` strata | **gap:** no frozen baseline or primary statistic yet |
| Decision provenance | estimate stores calibration sha256 and cell population | — |

The gaps become a follow-up change to delivery-monitor (persistent off setting, documented local-only
mode, effective-sample check, baseline capture), run under the change control below.

## Improvement proof

"Self-improving" needs a prospective comparison:

- **Same target.** Compare like with like. For #105: calibrated USD estimates against a frozen USD
  baseline (the uncalibrated `all` cell at the time calibration was switched on), never against hour
  estimates. Hours and dollars are different outcomes.
- **Same tasks.** Both predictors scored on the same eligible landed tasks after the switch date.
- **One primary statistic**, chosen before the window (for #105: median absolute log ratio of predicted
  p50 to measured cost), with sample count, exclusions and an uncertainty range reported.
- Fit quality on the training data (e.g. `OUTLIER` lines) is not proof of improvement.

## Shared core

- **Reference implementation:** #105's event storage, priced dispatch records and `calibrate` command.
  Reusable today: the event log, the dispatch hook's cost record, plan/task ids, the calibration-file
  sha256 pattern.
- **Second implementation first.** The next loop is built as its own concrete implementation, reusing the
  pieces above. Only behaviour common to both is then extracted into a shared engine.
- **Provenance IDs.** Every mining job in the 2026-11 round lacked a stable chain dispatch → task →
  review round → finding → fix → bug. Today the dispatch hook records dispatch → task only when the
  session is bound and the dispatch can be attributed; other records are unattributed. Loops that need
  the rest of the chain build it once, as shared work.

## Change control

Applies to every new loop, every loop change, and every one-off that changes agent behaviour.

### Stages

Project-count independent. Each stage has entry and exit criteria in the experiment record.

| Stage | What runs | Exit |
|---|---|---|
| **instrumented** | recording only; no decision changes | coverage check passes (≥ 90% of eligible events recorded) |
| **shadow** | state computed, decisions logged but not applied | baseline window complete |
| **pilot** | applied in one project | decision rule (below) says *better* or *no worse* |
| **expanded** | applied in further projects, each judged on its own | same rule, per project |
| **default** | on by default in sdlc-skills | owner go-ahead |

A loop's status also records four facts separately: **installed**, **capture active**, **learning active**,
**efficacy verified**.

### Rules

1. **One treatment at a time per project.** A treatment may be a **bundle** of changes only if approved as
   a bundle; any effect is then claimed for the bundle, never for a part.
2. **Experiment record before activation** (project-local, private), containing:
   - treatment and its version;
   - eligibility (which tasks or sessions count);
   - baseline window and values;
   - primary metric, guard metrics and their exact definitions (numerator, denominator, severity scale,
     observation lag);
   - minimum exposure (e.g. ≥ 20 eligible tasks or ≥ 2 missions, whichever is later);
   - decision rule and stop margins;
   - state snapshot references;
   - rollback target.
3. **Guard metrics** always include whole-system effects, so a primary metric cannot improve by moving cost
   or work elsewhere:
   - total harness cost per completed unit of scope (not one component's cost);
   - completed scope and abandoned or descoped work;
   - elapsed delivery time;
   - quality: escapes by severity (counted after the observation lag), blocking findings, missed rulings
     or scope.

   Task-counting and acceptance definitions are fixed before the baseline is collected.
4. **Decision rule**, one of four outcomes at the end of minimum exposure:
   - *better* — primary metric improves beyond its margin, no guard worse beyond its margin → promote;
   - *no worse* — no clear change → owner decides (keep, extend, or drop);
   - *inconclusive* — exposure or data quality too low → extend the window once, then drop;
   - *worse* — any guard worse beyond its margin → roll back.
5. **Immediate stop**, separate from the statistics: one critical escape, data loss, a privacy breach, or a
   ruling broken because of the treatment → roll back at once, then investigate. Rollback is
   pre-authorised.
6. **Matched comparison.** Compare within the same project against its own baseline, on matched work
   (same task types, similar size). Results from different projects are replicated separately, never
   pooled into one effect.
7. **Freeze.** No model, reviewer or rule change in that project during the window. A material change that
   cannot wait **restarts** the window (or invalidates it if it cannot restart).
8. **Live learning in a window.** If the treatment is a learning loop, whether its state keeps updating
   during the window is stated in the record; that choice is part of the treatment.
9. **Owner approval** is needed to activate a treatment and to move a stage forward. Merges follow the
   repository's normal rules.

## How we find candidates

Repeatable method, used for the 2026-11 round:

1. One mining job per question over the window's transcripts and ledgers. All jobs report the same cost
   units (dispatches, turns, tokens, hours, USD) and the share of the window total, so results compare.
2. Each job hand-checks a random sample of its labels and reports the error rate before correction.
   A sample of 20 shows gross errors only; it cannot support a claim of < 5% error.
3. A person checks each job's headline number against the raw source.
4. Rank by the cost **associated** with the problem, data readiness and build cost. Associated spend is
   exposure, not avoidable waste; savings are hypotheses until a treatment is measured.
5. Raw data and experiment records stay private. This repository is public: it holds the method, the
   contract and sanitised evidence cards only.

## Registry

Each row links a sanitised evidence card: period, numerator/denominator, exclusions, label quality,
what the figure means (exposure vs effect), and an evidence id that points to the private record.

### Learning-loop candidates

| Loop | History → learned state → decision | Stage | Notes |
|---|---|---|---|
| **Effort calibration** (#105) | landed task costs → per-cell USD distribution → estimate on new tasks | reference implementation; installed in 1 project, capture not yet active there; efficacy not verified | gaps listed above |
| **Orchestrator session length** | per-session context size and cost per completed scope → the checkpoint point (calls or context size) with the lowest total cost without missed rulings → when the orchestrator starts a fresh session | candidate; **blocked on instrumentation**: the dispatch hook reads child transcripts only, not the orchestrator's own context, cost, or completed-scope linkage | evidence card E-ORCH-1 (exposure: orchestrator share of spend; most of it at large context) |
| **Review round limit** | rounds per task and post-merge escapes by task type → the round count after which more rounds stop paying off, per type → restructure-or-continue decision | candidate | E-REV-2 (exposure: spend on tasks over two rounds; not the marginal cost of extra rounds) |

### Instrumentation, adaptive rules and one-offs

| Item | Kind | Stage | Notes |
|---|---|---|---|
| Escapes per gate | instrumentation (needs `origin` and `escaped_gate` at bug filing) | candidate | E-ESC-1; a future loop could learn which check to add per task type |
| Orchestrator pilot bundle: compaction cap ~200K; rulings/deferrals file re-loaded after compaction; event-driven waiting; capped tool output with full logs in files | adaptive + one-off, **approved as one bundle or run in sequence** | candidate | judged as a bundle if bundled |
| Rulings and deferrals registry; seeded-doc freshness | one-off (foundation) | candidate | E-SPEC-1 |
| Review rules from the 2026-10 trial | one-off | candidate | E-REV-1 |
| Memory write-time gate and task cards | one-off | candidate | E-MEM-1 |
| Hook context cap (#81) | one-off | default | eval result (small n), not a production effect |
| Brief-ranked MEMORY.md lines (#103) | one-off | default | eval result (small n), not a production effect |

### Not pursued (observed workload; reconsider on the trigger)

| Idea | Why not now | Reconsider if |
|---|---|---|
| Reviewer down-ranking by hit rate | review findings judged noise were a small share of review spend in the observed window (E-REV-3) | noise share rises, or a cheaper reviewer tier appears |
| Brief-quality loop | brief-caused failures were rare in the observed window (E-BRF-1) | misread or blocked returns rise |

### Change log

| Date | Change | Project | Stage | Baseline | Result |
|---|---|---|---|---|---|
| 2026-11-12 | #105 merged | sdlc-skills | reference implementation | — | — |
| 2026-11-13 | #105 installed | project B | installed; capture pending restart | not yet captured | — |

## Out of scope

- Model or effort changes for any role: the owner's call, never a loop's.
- Loops that act across projects or move data out of consumer-controlled storage.
- Extracting a shared engine before a second loop works.

## Open questions

1. Margins per guard metric (proposal: set from the baseline window's own variation).
2. Freshness limit for weighted samples (proposal: at least one sample in the last two half-lives).
3. Where the sanitised registry lives once consumer projects run loops: this spec or a generated file.
