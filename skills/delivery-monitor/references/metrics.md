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

`lead_time` is labelled **"plan-tracked, not idea-to-done"** everywhere it is surfaced — both
beside every `lead_time` row in the Markdown report and as `envelope.policy.labels.lead_time` in
the JSON export (`report.mjs`). `created_at` is the plan's own registration/backfill clock, not
when the idea for the work first existed — the label keeps a reader from over-reading it as a
true idea-to-done duration.

All four are grouped per level (`campaign\|mission\|task\|case`) into strata — `all` plus one
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
| coverage (`data.coverage[level]`) | `done`, `with_dispatched`, `with_first_commit`, `with_created`; `start_source`/`done_basis` breakdowns (`observed`/`derived-child`/`none`/`proxy`); `sources` (by `*_source` field: `created_source`, `start_source`, `first_commit_source`, `done_source`) | `sources` answers "where did this evidence come from" (cli/hook/git/automation-sync); `*_basis` answers "how trustworthy is it" (observed/derived-child/proxy) — never conflate the two |

`review_rounds`/`first_pass_rate` are rendered as `"unknown (M2)"` — see the M2+ list below.

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
5. `unit_mismatch` — the chosen estimate's unit isn't `h` (e.g. `active_min` — M1 actuals are elapsed time only)
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

Not computed in M1 — `active_min`/`cost_usd` (spec §6.10 Cost row, §6.12 tokenomics join) are
parked; `envelope.sources.tokenomics` always reads `"absent"`.

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
- `time_blocked` (derives `blocked`/`unblocked` into clipped intervals — M1 records the events
  but does not derive state from them, see `references/event-model.md`)
- `work_item_age` / `reopened_age` / `history_age` / `reopen_cycle_time`
- `scope_to_done` (mission declaration → observed landing, scope-proxy only)
- `review_rounds` / `first_pass_rate` (needs `review_history` completeness, not derived in M1)
- `calibration` (`--calibrate`, saved reference snapshots by factory/level/class/episode kind)
- `active_min` / `cost_usd` (tokenomics join, §6.12)
- the `test-automation` sync adapter (`scope_declared`/`gate_observed`/`outcome_observed` are
  schema-accepted but nothing produces them yet)
