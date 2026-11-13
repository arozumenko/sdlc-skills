# Learning loops: how the harness improves itself — design (v3)

Status: v4 · 2026-11-13. Adversarial review (Codex gpt-6-astra, high): round 1 REJECT (15 findings),
round 2 REJECT (9 new), round 3 REJECT (no blocker, 7 major, 2 minor). v4 answers round 3.

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

A registry entry is a **learning-loop candidate** only when all three parts are named, and the history
can support the decision (it measures what the decision needs, not only correlated outcomes).
Otherwise it is instrumentation, an adaptive rule, or a one-off.

## The loop contract

Steps:

1. **Record at the time**, by hook or CLI event, never a hand-kept file.
2. **Count** with one command that turns records into a small state table.
3. **Apply**: the agent that owns the decision reads the state at a stated trigger.

Requirements:

- **Stated activation.** Supported hosts, setup steps, the trigger, and the agent that runs count and
  apply, including when the project has no project-manager role. "No routine operator work after setup"
  is the goal; setup itself is not zero work.
- **Cold start and fallback.** The behaviour with no or too little history is written down: a shipped
  default value, a coarser learned cell, or *no decision* (e.g. the task stays unestimated). Unreadable
  state stops with an error; it never falls back silently.
- **Effective sample.** Where samples are weighted (e.g. by recency), the minimum is on the **effective**
  sample size (Kish: (Σw)²/Σw²), not the raw count, plus a freshness limit. Failing either gives the
  fallback.
- **Data boundary.**
  - **Destination.** Records go only to storage the consumer controls and has declared **private**
    (local disk, or a private remote). They never go to the harness authors or a third party.
  - **One publish policy.** A single persistent project setting (`local-only` or `private-remote`)
    that **every** component that can commit or push honours: installer, hooks, CLI. `local-only`
    means no push from any of them.
  - **Field policy.** One shared policy, applied by hooks, CLI events and backfills alike, decides
    whether free text is stored (dispatch descriptions, commit subjects, PR titles, notes, raw event
    text). The structured fields (ids, refs, stages, timestamps, models, token counts, costs, a user id
    where attribution needs it) are always allowed. Every text source is listed in the skill.
  - **Compatibility.** Shipping these settings must not change what an existing install does. A
    setting is added with today's behaviour as its default; making a stricter value the default is
    itself a treatment under change control.
- **Off switch.** One persistent setting per loop. Off means: no new state is computed, no new decision
  uses the state, and the pre-loop behaviour returns for new decisions. Decisions already made stay as
  recorded history; rolling back does not rewrite them.
- **Reproducible state.** Each state version is kept as an immutable, timestamped local artifact (not
  only a digest), in every publish mode. Each decision records the version that produced it and, for
  predictions, is written **before** the outcome is known.
- **Improvement metric.** One primary metric, its baseline, and guard metrics, defined before the loop
  goes live (see Change control).

## Where the shipped loop stands (#105, effort calibration)

Reference implementation: `skills/delivery-monitor`.

| Contract item | #105 today | Gap |
|---|---|---|
| History | priced cost of hooked Claude dispatches attributed to landed tasks; tasks with no positive cost or a known incomplete cost are excluded | covers hooked, attributed dispatches only, not all task spend; Claude Code only |
| Learned state | `calibration.json`: cells tried in order role+type+novel, role+type, role, type, all; recency-weighted (default half-life 42 days) p50/p80 USD per cell; effort-class boundaries are the weighted quartiles of all samples (needs 12 samples in total), and a cell's class comes from where its p50 falls | — |
| Decision | `plan register` leaves planner estimates and earlier calibrated estimates alone; otherwise fills the task from the first cell with `n ≥ 5` as a `usd` range, auto-accepted | — |
| Activation | skill install, then **separately** `install-hooks.mjs` (installing the skill never wires the hook); plan registered; session bound; landings recorded. The PM runs `calibrate` after the last mission of a campaign closes | **gap:** no owner for `calibrate` when there is no PM role |
| Cold start | no cell with `n ≥ 5` → task stays unestimated; a planner hours estimate needs human acceptance. A `calibration.json` that cannot be read, parsed, or has no `cells` object stops registration (`CALIBRATION-INVALID`); a cell with missing fields is not checked and is treated as no cell | **gap:** no schema check of cells |
| Effective sample | raw `n ≥ 5`; recency weights shape the distribution but not eligibility; no freshness limit | **gap** |
| Data boundary | `install-hooks.mjs` bootstraps a telemetry submodule and pushes its branch to `origin` (twice) **without** checking `DELIVERY_NO_SYNC`; only `--no-submodule` avoids it. Hook and CLI sync commit the whole telemetry tree and push unless `DELIVERY_NO_SYNC=1`. Free text stored today: `capturePrompts` (opt-in, up to 120 chars of dispatch description); git backfill stores commit subjects in `raw` and PR backfill stores PR titles, both by default; CLI `--note` and `--raw` are stored with no project setting | **gap:** no single publish policy; installer ignores the env var; destination privacy not checked; no shared field policy. Interim workaround: `install-hooks.mjs --no-submodule` **and** `DELIVERY_NO_SYNC=1`, keeping `capturePrompts` off; this does not stop a person from pushing the telemetry tree with git |
| Off switch | `--no-calibrate` stops new fills for one registration; earlier fills stay; recording and `calibrate` continue | **gap:** no persistent off setting |
| Reproducible state | each automatically calibrated estimate stores the sha256 of `calibration.json` and its cell population; `calibrate` overwrites the one file; history exists only where the telemetry tree is committed | **gap:** no immutable state versions in local-only mode |
| Improvement metric | `report` scores USD estimates by range midpoint (MdMRE, MAE, hit rate), excluding estimates accepted at or after the task started (`late_accepted`) | **gap:** no frozen baseline, no paired comparison |

Follow-up to delivery-monitor, run under the change control below, every setting defaulting to today's
behaviour:

1. one publish policy honoured by the installer, hooks and CLI;
2. one field policy honoured by hooks, CLI events and backfills;
3. a persistent calibration off setting;
4. an effective-sample and freshness check;
5. a schema check of calibration cells;
6. immutable calibration state versions;
7. paired baseline predictions recorded at registration, and a paired evaluator in `report`;
8. a named `calibrate` owner without a PM: the session that closes the campaign's plan (the
   orchestrator) runs it.

## Improvement proof

"Self-improving" needs a prospective, paired comparison:

- **Same target.** For #105: calibrated USD predictions against a frozen USD baseline. The baseline is a
  **learned global baseline**: the `all` cell frozen at the switch date, not an uncalibrated guess.
  Never against hour estimates; hours and dollars are different outcomes.
- **Paired, before work starts.** For each eligible task both predictions, and the state version they
  used, are written before the task's first eligible work starts. A prediction made at or after the
  start is excluded from efficacy scoring (the shipped `late_accepted` rule) but still counted in
  coverage reporting.
- **One primary statistic**, chosen before the window (for #105: median absolute log ratio of predicted
  p50 to measured cost), with sample count, exclusions and an uncertainty range.
- Fit quality on training data (e.g. `OUTLIER` lines) is not proof of improvement.

The paired evaluator and baseline capture are follow-up deliverables (above).

## Shared core

- **Reference implementation:** #105. Reusable today: the event log, the dispatch hook's cost record,
  plan/task ids, the state-digest pattern.
- **Second implementation first.** The next loop is built as its own concrete implementation, reusing the
  pieces above. Only behaviour common to both is then extracted into a shared engine.
- **Provenance IDs.** Every mining job in the 2026-11 round lacked a stable chain dispatch → task →
  review round → finding → fix → bug. Today the dispatch hook records dispatch → task only when the
  session is bound and the dispatch can be attributed. Loops that need the rest build it once, as
  shared work.

## Change control

Applies to every new loop, every loop change, and every one-off that changes agent behaviour.

### Stages

| Stage | What runs | Exit |
|---|---|---|
| **instrumented** | recording only; no decision changes | coverage reconciliation passes (below) |
| **shadow** | state computed, decisions logged but not applied | baseline window complete |
| **pilot** | applied in one project | decision rule says *better* or *non-inferior* |
| **expanded** (optional) | applied in further projects, each judged on its own | same rule, per project |
| **default** | on by default in sdlc-skills | owner go-ahead, after *expanded*, or after *pilot* with a written reason why one project is representative |

A loop's status records four facts separately: **installed**, **capture active**, **learning active**,
**efficacy verified**.

**Coverage reconciliation.** Recorded events are checked against an **independent** inventory of the same
work (e.g. the host's session transcripts and its own usage accounting), broken down by host, role and
event type, and missing **cost** is bounded. The pass criterion is set in the experiment record. A cost
decision must hold at the worst end of the missing-cost bound. If missing cost cannot be bounded, the
cost guard is **unmeasurable**, and an unmeasurable mandatory guard blocks promotion; non-cost results
may still be reported descriptively.

### Rules

1. **One treatment at a time per project.** A treatment may be a **bundle** of changes only if approved as
   a bundle; any effect is then claimed for the bundle, never for a part.
2. **Experiment record before activation** (project-local, private), containing:
   - treatment and its version, and whether learned state updates during the window;
   - eligibility (which tasks or sessions count);
   - baseline window and values;
   - primary metric and guard metrics, each with numerator, denominator, severity scale, observation lag
     and the event that starts the lag (for escapes: the task's landing);
   - the **non-inferiority margin** for each metric (largest harmful change still counted as "no worse");
   - the analysis: confidence level (default 90%), interval method (default paired bootstrap over
     matched tasks), matching procedure, and how unfinished tasks are handled (default: censored, i.e.
     excluded from the comparison and reported as a count);
   - minimum exposure;
   - **enrolment deadline** (calendar date); **outcome-maturation date**: the latest landing of an
     enrolled task plus the longest observation lag, capped by an **absolute evaluation end date**;
     **maximum extension** (one, with its own deadline); **restart budget** (one);
   - state snapshot references and rollback target.
3. **Guard metrics** always include whole-system effects, so a primary metric cannot improve by moving
   cost or work elsewhere:
   - total harness cost per completed unit of scope;
   - completed scope and abandoned or descoped work;
   - elapsed delivery time;
   - quality: escapes by severity (after the observation lag), blocking findings, missed rulings or scope.

   Task-counting and acceptance definitions are fixed before the baseline is collected.
4. **Decision at the maturation date**, mandatory. For each metric, Δ = treatment − baseline, oriented
   so that positive is harmful; [L, U] is its interval; m is its non-inferiority margin.
   - a metric is **non-inferior** when U ≤ m (only the harmful bound matters; a large improvement
     never fails);
   - the primary is **superior** when U < 0 (the interval lies wholly on the improving side);
   - a metric is **worse** when L > m (harm beyond the margin is established);
   - a mandatory guard that is unmeasurable counts as not non-inferior.

   Outcomes:
   - *better* — primary superior, every guard non-inferior → promote;
   - *non-inferior* — primary and every guard non-inferior, primary not superior → owner decides to
     keep or drop;
   - *worse* — primary or any guard worse → roll back;
   - *inconclusive* — anything else, including minimum exposure not reached → extend once; at the
     extension deadline, inconclusive means **drop**.

   Outcomes that have not matured never count as "no escapes"; promotion waits for maturation.
5. **Immediate stop**, separate from the statistics: one critical escape, data loss, a privacy breach, or a
   ruling broken because of the treatment → roll back at once, then investigate. Rollback is
   pre-authorised.
6. **Matched comparison.** Compare within the same project against its own baseline, on matched work
   (same task types, similar size). Results from different projects are replicated separately, never
   pooled into one effect.
7. **Freeze.** No model, reviewer or rule change in that project during the window. A material change that
   cannot wait **restarts** the window once (the restart budget); a second one ends it as inconclusive.
   The absolute evaluation end date never moves. Every failed or restarted window stays in the record.
8. **Owner approval** is needed to activate a treatment and to move a stage forward. Merges follow the
   repository's normal rules.

## How we find candidates

Repeatable method, used for the 2026-11 round:

1. One mining job per question over the window's transcripts and ledgers. All jobs report the same cost
   units (dispatches, turns, tokens, hours, USD) and the share of the window total.
2. Each job hand-checks a random sample of its labels and reports the error rate before correction.
   A sample of 20–50 shows gross errors only.
3. A person checks each job's headline number against the raw source.
4. Rank by the cost **associated** with the problem, data readiness and build cost. Associated spend is
   exposure, not avoidable waste; savings are hypotheses until a treatment is measured.
5. Raw data and experiment records stay private. This repository holds the method, the contract and the
   sanitised evidence cards below.

## Evidence cards (2026-11 round)

One window of two weeks (2026-10-29 → 2026-11-12) in two consumer projects. Cost is priced Claude usage
from session transcripts; another model provider's usage is unpriced and excluded. Coverage ends earlier
in one project (11-05) than the other (11-11). "Associated" = spend on the work the label touches; it is
exposure, not proven waste. Label audit = random sample checked by hand, error rate **before** correction.

| Card | Population | Finding | Meaning | Label audit |
|---|---|---|---|---|
| E-ORCH-1 | 14 orchestrator sessions, 13,351 calls | orchestrator 39–41% of priced spend; 87.5% of orchestrator spend on calls with context > 150K | exposure | purposes 50 calls, 22%; spend from billing fields |
| E-REV-1 | review trial, one project, two periods | share of blocking findings that carried red-run proof: 24% before, 92% after a review-rule change | observed before/after change in an evidence practice (not blocker validity or delivery quality); treatment effect unidentified (a reviewer change fell in the window) | validity labels by hand |
| E-REV-2 | 60 tasks with numbered review rounds | 14 tasks over two rounds; about 10% of window spend on those tasks | exposure, not the marginal cost of extra rounds; finding-free rounds unrecorded | 40 segments, 2.5% |
| E-REV-3 | 669 review findings linked to window tasks; review ≈ 22% of spend | follow-up cost on dropped or nit findings 0.06–0.35% of window spend | exposure; only 44% of review cost joined to findings | as E-REV-2 |
| E-BRF-1 | 749 dispatched agents | 3 returned blocked because of the brief; 0.7% of spend associated | exposure | 24 repeats, 42% |
| E-ESC-1 | 413 recently modified bug records | 36 post-build failure episodes, 13 major/critical; most records were review leftovers | count; repair cost known for under half | 20 finders, 15% |
| E-SPEC-1 | 65 spec-related records | 34 found after planning; 4 seeded docs contradicted later rulings | count | sample of spec records by hand |
| E-MEM-1 | 73 corrective messages; separately, review-finding ledgers | 4 corrections matched an existing lesson; 59 review findings repeated a known class | observed label counts; not a measure of memory effectiveness | 40 labels, 45% |

## Registry

### Learning-loop candidates

| Loop | History → learned state → decision | Stage | Notes |
|---|---|---|---|
| **Effort calibration** (#105) | landed task costs → per-cell USD distribution → estimate on new tasks | reference implementation; installed in 1 project, capture not yet active; efficacy not verified | gaps above |
| **Orchestrator session length** | per-session context size, cost per completed scope, missed rulings → the checkpoint point with the lowest total cost and no rise in missed rulings → when the orchestrator starts a fresh session | candidate; **blocked on instrumentation**: the dispatch hook reads child transcripts only, not the orchestrator's context, cost, or scope linkage | E-ORCH-1 |

### Instrumentation, adaptive rules and one-offs

| Item | Kind | Stage | Notes |
|---|---|---|---|
| Review rounds and yield | instrumentation: rounds, per-round cost, actionable findings per round, post-merge escapes, by task type | candidate | becomes a loop candidate only with a prospective controlled comparison on eligible tasks (mandatory gates kept); round counts and escapes alone cannot show what one fewer round would do (E-REV-2) |
| Escapes per gate | instrumentation (needs `origin` and `escaped_gate` at bug filing) | candidate | E-ESC-1 |
| Orchestrator pilot bundle: compaction cap ~200K; rulings/deferrals file re-loaded after compaction; event-driven waiting; capped tool output with full logs in files | adaptive + one-off, approved as one bundle or run in sequence | candidate | judged as a bundle if bundled; E-ORCH-1 |
| Rulings and deferrals registry; seeded-doc freshness | one-off (foundation) | candidate | E-SPEC-1 |
| Review rules from the 2026-10 trial | one-off | candidate | E-REV-1 |
| Memory write-time gate and task cards | one-off | candidate | E-MEM-1 |
| Hook context cap (#81) | one-off | default | eval result (small n), not a production effect |
| Brief-ranked MEMORY.md lines (#103) | one-off | default | eval result (small n), not a production effect |

### Not pursued (observed workload; reconsider on the trigger)

| Idea | Why not now | Reconsider if |
|---|---|---|
| Reviewer down-ranking by hit rate | E-REV-3: low **identified** exposure; only 44% of review cost could be joined to findings, so total noise cost is not bounded | review findings get a recorded outcome (loop 1 instrumentation), or noise share rises, or a cheaper reviewer tier appears |
| Brief-quality loop | E-BRF-1: low **identified** exposure; the label audit (42% pre-correction error) cannot bound missed cases | dispatch returns get a recorded blocked/question/deviation outcome, or such returns rise |

### Change log

| Date | Change | Project | Stage | Baseline | Result |
|---|---|---|---|---|---|
| 2026-11-12 | #105 merged | sdlc-skills | reference implementation | — | — |
| 2026-11-13 | #105 installed | project B | installed; capture pending restart | not yet captured | — |

## Out of scope

- Model or effort changes for any role: the owner's call, never a loop's.
- Loops that act across projects or move data out of consumer-controlled private storage.
- Extracting a shared engine before a second loop works.

## Open questions

1. How margins are set per metric (proposal: from the baseline window's own variation).
2. Freshness limit for weighted samples (proposal: at least one sample in the last two half-lives).
3. Where the sanitised registry and cards live once consumer projects run loops: this spec or a
   generated file.
