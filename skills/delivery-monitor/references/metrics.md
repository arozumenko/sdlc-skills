# Metrics (M1)

`scripts/lib/metrics.mjs` computes every figure in seconds; `report`/`status` round to hours
only when rendering (`toHours`). Every stat carries `n`; below a floor the report shows raw
samples/min–max instead of the percentile. This document is the landed M1 contract — one row
per metric, the exclusion-reason order for estimates, and the metrics the design spec describes
that are **not** computed yet (M2+).

## Flow time

| Metric | Start event | Stop event | Unit | Population |
|---|---|---|---|---|
| `cycle_time` | `dispatched` with `basis: observed` (task level only — `it.started_at` is only set for `level === 'task'`) | `done` with a reliable `done_basis` (`observed` or `derived-child`) | seconds internal, hours rendered | task/case items with an observed start |
| `parent_elapsed` | earliest child `started_at` (`start_basis: derived-child`, rolled up in `reduceTimelineSnapshot`) | first qualifying `done`/landing for the parent | seconds internal, hours rendered | mission/campaign items (their own start is always derived, never a direct dispatch) |
| `commit_to_done` | `first_commit` | `done` | seconds internal, hours rendered | measurable items with **no** observed dispatch start (dispatch missing → this is the fallback clock) |
| `lead_time` | `created` | `done` | seconds internal, hours rendered | measurable items with a `created_at`, excluding the retrospective-plan-proxy case below |
| `agent_span` | union of the hook's closed dispatch spans up to the merge | — | seconds internal, hours rendered | measured task cycles the hook witnessed |
| `review_wait` | last dispatch end before the merge | `done` | seconds internal, hours rendered | same as `agent_span` |
| `time_blocked` | union of the task's `blocked`→`unblocked` spans, clipped to its cycle (an open span ends at `done`) | — | seconds internal, hours rendered | measured task cycles (observed start → done) with at least one block record; a task with no block record is `null`, never 0 |
| `flow_efficiency` | `agent_span ÷ cycle_time`, capped at 1 | — | ratio, rendered as a percentage | measured task cycles with an `agent_span` and a cycle > 0 |

`flow_efficiency` is a **lower bound** on the share of the cycle spent working: the orchestrator's own work between dispatches
is not a dispatch, so it counts as waiting. `time_blocked` is only as complete as the block records: most orchestrators record
none, so the report states how many done tasks carry one (`coverage.<level>.with_blocked`; the Markdown says
`no blocked records — time_blocked not measured (not zero)` when none do).

`lead_time` is labelled **"plan-tracked, not idea-to-done"** everywhere it is surfaced — both
beside every `lead_time` row in the Markdown report and as `envelope.policy.labels.lead_time` in
the JSON export (`report.mjs`). `created_at` is the plan's own registration/backfill clock, not
when the idea for the work first existed — the label keeps a reader from over-reading it as a
true idea-to-done duration.

All of them are grouped per level (`campaign\|mission\|task\|case`) into strata — `all` plus one
stratum per `class` value actually present in the completed cohort (`strata.<class>`), via
`stats()`.

**Floors** (`stats()` in `metrics.mjs`): `median` shown only at `n ≥ 5`, `p85` at `n ≥ 7`, `p90`
at `n ≥ 10` (percentile = nearest-rank). Below `n < 5` the report/JSON carry `samples` (the raw
sorted values) plus `min`/`max` instead of a percentile that would be statistically meaningless.

**Exclusion counters** (`data.flow[level].excluded`, per level):

| Counter | Meaning |
|---|---|
| `clock_skew_cycle` | `done_at < started_at` — negative cycle time, excluded from `cycle_time`/`parent_elapsed` only |
| `clock_skew_commit` | `done_at < first_commit_at` — excluded from `commit_to_done` only |
| `clock_skew_lead` | `done_at < created_at` — excluded from `lead_time` only |
| `retrospective_plan_proxy` | `created_basis === 'plan-commit'` **and** `created_sha === done_sha` **and** elapsed ≤ `profile.zeroDurationSec` (default 60s) — the same commit both registered and finished the item, so lead time would just be measuring registration lag, not real work; excluded from `lead_time` |
| `missing_start` | no `started_at` and no `first_commit_at` — the item contributes to none of the three duration buckets |

Every item excluded from *all* duration metrics for a stronger reason is tracked separately, not
folded into the counters above: `cohorts.excluded_items` (window-scoped: `invalid_chain`,
`deferred_episode`, `proxy_completions`, counted over the completed-in-window cohort) and
`inventory.excluded_items` (same three counters over the whole catalogue, window-independent).
`excludedItem(i) = invalidChain(i) || deferredEpisode(i) || proxyCompletion(i)` gates every
duration/estimate metric; `throughputExcluded(i) = invalidChain(i) || proxyCompletion(i)`
(deliberately keeps `deferred-episode` items, which still count once in throughput by first
completion) gates throughput/velocity only.

**Caveat text**: `flow.excluded` counts print as `<level> excluded | clock_skew_cycle=… …` rows
in Markdown; when a level's `done` items have zero observed dispatches, the report adds
`"<level>: no observed dispatch start — cycle_time absent, commit_to_done shown instead"`.

## Throughput, velocity, WIP, cadence

| Metric | Definition | Unit | Floor / caveat |
|---|---|---|---|
| `throughput` | first completions bucketed by UTC ISO week (`weekKeys`), over `throughputDone` (excludes `invalid-chain` and proxy completions; keeps `deferred-episode`) | count per week | every week intersecting `[since, end)` appears; `whole` = Monday ≥ `since` and next Monday ≤ `end`; `covered` = within the plan's declared `observation_start` coverage |
| `velocity` | median of `whole` weeks' counts | items / whole week | requires `whole_weeks ≥ profile.minWholeWeeks` (default 3) — below that, `velocity: null` and a caveat `"velocity(<level>): <n> whole weeks < <minWeeks> — null"` |
| `wip` | items at `state: in_progress` and not `cancelled_in_plan`, as of the window's effective end | count | not windowed — a snapshot, not a rate |
| `mission_turnaround` | gap/overlap between consecutive missions by `sequence` (`done_at(prev) → started_at(next)`, or `overlap_s` when the next started before the previous finished) | seconds internal, hours rendered | `stats()` over the gap set (same floors as flow time) |

## Quality

| Metric | Numerator / denominator | Caveat |
|---|---|---|
| `cancelled_share` | items cancelled in the **creation cohort** (`created_at` in `[since, end)`, same `--level`/`--class` filters as the rest of the report) ÷ that cohort's size | `"— (n=0 created in window)"` when the cohort is empty; this is computed in `report.mjs` (F15), not `metrics.mjs`, so it is provably the same cohort as `cohorts.created` |
| `rework_proxy_items` | task-level items with `rework_count > 0` (from `rework_observed` occurrences) | activity proxy only — not a review-round count |
| coverage (`data.coverage[level]`) | `done`, `with_dispatched`, `with_first_commit`, `with_created`, `with_blocked` (done items with any block record); `start_source`/`done_basis` breakdowns (`observed`/`derived-child`/`none`/`proxy`); `sources` (by `*_source` field: `created_source`, `start_source`, `first_commit_source`, `done_source`) | `sources` answers "where did this evidence come from" (cli/hook/git/automation-sync); `*_basis` answers "how trustworthy is it" (observed/derived-child/proxy) — never conflate the two |

`review_rounds`/`first_pass_rate` are rendered as `"unknown (M2)"` — see the M2+ list below.

An open item with an open block span shows `in_progress (blocked since <at>)` in the Open items table (Markdown and HTML) and
`blocked_since=<at>` in `status`. A task blocked before its first dispatch is listed there too, as `planned (blocked since <at>)`.
Block records on a mission, campaign or case open a span (so open items show them) but are not task time: they are counted as
`coverage.non_task_blocks` with the caveat `N block record(s) on non-task items — not in time_blocked`. A done task with block
records but no observed start has no cycle to clip them to; the coverage line says how many (`blocked_no_start`).

## DORA (task-level proxies)

These figures are task-level proxies, not the four DORA measures. A task "deploys" when it merges to the integration branch.
`change_failure_rate` is computed from defects found after a task was done. `time_to_restore` is defect repair time, from
found to fixed. The JSON keys keep the DORA names; `envelope.policy.labels.change_failure_rate` and
`envelope.policy.labels.time_to_restore` carry the proxy labels, and the Markdown and HTML headings say "DORA (task-level
proxies)" with a caption.

`metrics.dora` (per plan, task level), rendered as `## DORA (task-level proxies)` after Quality in Markdown, a panel with the
same heading in HTML, and in `--json` through the metrics object. It reads the defect pair (`defect_found`/`defect_fixed`, `references/event-model.md`),
recorded on the item that caused each defect. The figures take the already filtered item list: `--level task` hides
`untraced`, any other `--level` leaves the change failure rate empty, and `--class` filters the cohort. `recorded` (below) is
neither filtered nor windowed.

| Measure | Definition | Population | Caveat |
|---|---|---|---|
| deployment frequency | not recomputed: points at task `velocity` and the weekly throughput (Throughput section) | throughput cohort | labelled `envelope.policy.labels.deployment_frequency` = **"merge to the integration branch, not a production deploy"** |
| lead time for changes | not recomputed: points at task `cycle_time` median (and `commit_to_done` when starts were not observed) | flow-time cohort | same label, `envelope.policy.labels.lead_time_for_changes` |
| `change_failure_rate` (proxy) | tasks with ≥1 **escaped** defect ÷ tasks in the cohort; `by_severity` counts each failed task once, by the worst severity among its escaped defects (`critical > major > minor > unrated`) | tasks whose first completion is in `[since, end)`, minus `throughputExcluded` (invalid-chain, proxy completion) — the throughput cohort | defects are found later, so recent tasks are undercounted; `— (n=0 completed in window)` when the cohort is empty |
| `time_to_restore` (proxy: defect repair time) | `stats()` of `fixed_at − found_at` (same floors as flow time); `open` = escaped defects with no fix, `oldest_open_s` = the oldest one's age at the window end | escaped defects found in `[since, end)` on tasks not `throughputExcluded` | a fix is the moment the fix landed (`defect_fixed`), not a production restore |
| `defects_by_stage` | per `found_stage` (`build, review, qa, gate, demo, user`): `escaped` vs `before_landing` | defects found in `[since, end)` on tasks not `throughputExcluded` | "where do we catch defects"; rows with no defect are not printed |
| `untraced` | count (and per stage) of defects recorded on a mission, campaign or case — the cause is not traced to a task | found in `[since, end)` | never in the change failure numerator |
| `excluded_defects` | defects on tasks whose completion is quarantined or a proxy | found in `[since, end)` | escape cannot be judged without a trustworthy landing clock |

**Escaped** = the defect's `found_at` is later than its task's first `done_at` (first completion). A defect found before
that (or on a task not done yet) was caught before landing.

`dora.recorded` is false when the run holds no active `defect_found` at all (any level, any filter, before or inside the
window, up to its end). The report then prints
one line — ``no defects recorded — change failure rate and time to restore need `event <ref> defect_found` `` — instead of a
0% nobody measured; the two pointer lines still print.

## Estimates

`work_ratio = actual_h / midpoint`, `MRE = |actual_h − midpoint| / actual_h`, `MdMRE = median(MRE)`,
`PRED(25) = share(MRE ≤ 0.25)`, `MAE = mean(|actual_s − midpoint_s|)`, `hit_rate = ranged estimates
where low ≤ actual ≤ high, over ranged eligible estimates only`. Grouped per level into strata:
`all`, per-`class`, per-`tier:<tier>`, and joint `<class>|<tier>` when both are known.

**Exclusion-reason order** (mutually exclusive; first match wins — an item stops at the first
reason that applies and is never double-counted):

1. `excluded_item` — same gate as flow time (`invalid-chain` / `deferred-episode` / proxy completion)
2. `unestimated` — no `estimated` observation at all
3. `unaccepted` — has an estimate but no `estimate_original` (never had a valid `accepted_by`+`accepted_at` pair)
4. `no_eligible_latest` — `estimateBase: latest` requested but no accepted estimate qualifies before the item's start/cutoff
5. `unit_mismatch` — the chosen estimate's unit isn't `h` (e.g. `active_min` — M1 actuals are elapsed time only).
   A `usd` estimate is not a mismatch: it is scored against the task's cost (`cost_usd`: every dispatch attributed to the
   task, counted once, at current prices, from dispatches started before the effective end; the hook-time cost when the
   report falls back) in separate strata `usd:all`, `usd:<class>`, `usd:tier:<tier>`, `usd:effort:<E1-4>`; there
   `mae_s` is in dollars and rows carry `actual_usd`. A `usd` range with a `mid` (a calibrated cell p50) is scored on the
   `mid` in place of the midpoint for the ratio, MRE and MAE; `hit` still means `low ≤ actual ≤ high`. The gates apply in this order: `excluded_item`, `unaccepted`,
   `no_eligible_latest` (both as above; such a task stays in the `usd:` strata and is never counted as hours),
   `late_accepted` (accepted at or after the task's measured start; a task with no measured start is judged against the
   earlier of its first commit and its earliest hooked dispatch of any stage; with neither, the estimate is never late),
   `missing_actual` (no cost, zero cost, or an unpriced model, an unended dispatch, a resumed agent's dispatch that lists other
   tasks in `meta.agent.crossed` — the task of the first brief and each listed task — an earliest dispatch that is a
   review or a fix round, unstable or incomplete attribution, or — for every task of the run — dispatch cost recorded under
   an item id the run neither knows nor maps through `supersedes.item_map`), `zero_midpoint`. The eligible rows are also
   banded (`estimated_band`, `actual_band`, `band_distance`; see SKILL.md, "Task cost in the report"). `late_accepted` comes before `missing_actual` here, the reverse of
   the hours order; `zero_actual` and `point` are the same non-exclusive counters as for hours. On a `missing_actual` row
   `actual_usd` is the partial total the ledger holds, shown for inspection (the Markdown report marks it
   `(incomplete)`); it is not the task's cost
6. `clock_skew` — the item's own duration was itself clock-skew-excluded (no reliable actual to compare against)
7. `missing_actual` — no measured duration at all (item never entered the flow-time population)
8. `late_accepted` — `accepted_at ≥ started_at` (the estimate was accepted after work began — not a timely commitment)
9. `zero_midpoint` — `(low + high) / 2 === 0` (would divide by zero in `work_ratio`)

Two further, **non-exclusive** counters apply only to items that passed all nine gates above
(i.e. are already `eligible`): `zero_actual` (measured duration was exactly 0s — excluded from
`MdMRE`/`PRED(25)` but still counted in `MAE`) and `point` (`low === high` — excluded from
`hit_rate` only, since a point estimate can't express a ranged hit).

`estimate_rows` (JSON/Markdown) lists every item with its reason (or `null` for a fully eligible
row), `ratio`, `hit`, `actual_basis`. `schedule_variance` (mission/campaign only) reports
`band: {vs_high_s, vs_low_s} = actual − [high, low]` plus scope added/removed since the
estimate's version.

## Cost

`cost_usd` per task comes from the Claude dispatch hook itself (not a tokenomics join): each `dispatch_ended` carries the
dispatch's priced cost, and a task's cost is the sum of its share of every dispatch (fix rounds included). It feeds `usd`
estimate accuracy (above) and `delivery.mjs calibrate` (`references/plan-block.md` "Calibrated estimates"). Hosts without
the hook record no cost. `active_min` is still not computed; `envelope.sources.tokenomics` always reads `"absent"`.

Every cost and every spend total covers subagent dispatches only. The orchestrating session's own usage is not captured and
not counted. The outputs say so where a total is shown: a `scope:` line in `spend` (`scope` in its JSON), the end of the
`SPEND 7d` line in `status`, a `- scope:` line under `## Cost` in the Markdown report, a sentence in the HTML Cost panel, and
`envelope.policy.labels.spend`.

## Outputs

`report` renders Markdown by default. `--json` emits the full envelope for programmatic/assessor
consumption. `--html` renders the same figures as a self-contained page (own `<style>`, no
external assets or `<script>`) — same `h`/`pct`/`ageH` rounding as Markdown, so the two never
disagree. `--from-json <file>` re-renders an already-archived `report --json` output (Markdown or,
with `--html`, the page) without recomputation or a JSON rewrite — no ledger read, no git call;
it refuses to combine with `--json` or any window/filter flag, since there is no assemble step
left to apply them to.

## M2+ (described in the design spec, not landed)

- `time_to_merge` / `time_in_review` (PR-mode backfill) — `time_to_merge` already carries its
  label, `envelope.policy.labels.time_to_merge` = **"PR open to merge — not lead time, not cycle
  time"**, even though the metric itself is not computed until this lands
- `work_item_age` / `reopened_age` / `history_age` / `reopen_cycle_time`
- `scope_to_done` (mission declaration → observed landing, scope-proxy only)
- `review_rounds` / `first_pass_rate` (needs `review_history` completeness, not derived in M1)
- `calibration` by factory/level/episode kind (the `calibrate` command covers task effort in dollars only)
- `active_min` (tokenomics join, §6.12)
- the `test-automation` sync adapter (`scope_declared`/`gate_observed`/`outcome_observed` are
  schema-accepted but nothing produces them yet)
