# Research 05 — How the dm-kb vault defines, measures and judges DELIVERY PERFORMANCE (AI Maturity, Dimension 4)

Scope: what the vault at `/Users/Daniel_Sallai/dev/dm-kb` (plus the one aquanautica minutes file it cites) says about delivery-performance measurement, so a harness-side cycle-time / cadence / estimate-vs-actual tracker in sdlc-skills emits numbers the EPAM AI-Maturity assessment can consume. Facts are cited by path and line; inferences are marked *(inference)*. No design is proposed except in §6.

Files read in full or in the relevant sections: `docs/reference/ai-run-2026/020-ai-native-sdlc-fundamentals.md`, `1000-management.md`, `000-glossary.md`, `001-reference-cases.md`, `1111-assembly-line.md`, `200-product-management-ba.md` (§estimation), `tools/wpse-maturity/README.md`, `build_board_metrics.py`, `build_cost_model.py`, `wpse_maturity.py`, `build_delivery_report.py`, `SGHQ/programs/ai-transformation/ai-maturity-framework.md`, `ai-maturity-validation-process.md`, `asdlc-quality-lens-research.md` (§6.6), `patterns-and-antipatterns.md`, `delivery-insights-log.md`, `docs/superpowers/specs/2026-09-06-euaq-wpse-level-3-assessment-design.md`, `2026-05-29-delivery-insights-skill-design.md`, `.claude/skills/delivery-insights/SKILL.md`, `2026-07-13-activity-raid-records-design.md`, `EUAQ/projects/WPSE/assessment/level-3.md`, `EUAQ/projects/WPSE/assessment/reviews/2026-09-07.md`, `EUAQ/projects/WPSE/sources/wpse-level-3-evidence-2026-09-06.md`, `wpse-level-2-self-assessment-2026-06-09.md`, `SGHQ/projects/{S1WI,L1US}/assessment/level-2.md`, `~/dev/aquanautica/vault/Delivery/Meetings/2026/2026-08-05-internal-mvp-demo-progress-contract-status-and-testing-plan.md`.

---

## 1. The Performance Tracking rubric (L1 / L2 / L3) — verbatim, and what an assessor wants

### 1.1 Rubric text, three renderings in the vault

**Module 020 (curriculum capture)** — `docs/reference/ai-run-2026/020-ai-native-sdlc-fundamentals.md:125`:

> **Dimension 4 — Performance Tracking** (*can you answer "what are your AI gains?" with numbers*): **L1 Partial** anecdotal, "it feels faster," no metrics · **L2 Tracked** productivity metrics defined & measured **from system sources** (throughput, flow/cycle/lead time, quality; or DORA) + AI-adoption metrics (DAU) · **L3 Governed** richer telemetry, AI **cost tracking**, regular reviews, ROI at delivery level. *Metrics must come from Jira/Git/CI-CD — never surveys or anecdotes.*

**Module 1000 (management, Block 5 table)** — `1000-management.md:98`:

> | **Performance Tracking** | partial (anecdotal, no standard metrics) | tracked (productivity metrics defined + measured) | governed (AI cost tracked; reviews optimise output per total cost) |

**Vault canonical rubric page (from LEAP, re-verified 2026-09-12)** — `SGHQ/programs/ai-transformation/ai-maturity-framework.md:37`:

> | **Performance Tracking** | **Partial** — anecdotal evidence / no standardized metrics | **Tracked** — **productivity metrics defined and consistently measured** | **Governed** — AI cost tracking; regular reviews drive optimizations to improve output per total cost |

L2 pass gate wording, `ai-maturity-framework.md:51`: `4. **Performance Tracking — Tracked:** productivity metrics defined and consistently measured.`

L3 bar, `ai-maturity-framework.md:79`:

> | 4 | **Performance Tracking — Governed** | L2's metrics **plus** AI cost tracking, regular reviews, and **ROI reported at delivery level** | Richer telemetry from more advanced tooling; reviews that **drive optimisations to improve output per total cost** — a review that changes nothing is not evidence |

Two L3 rules stated at `ai-maturity-framework.md:59-70`: "**Level 3 is the single point 3.0** … every core dimension must therefore be at 3" and "**Metrics must be system-sourced.** The rubric is explicit — *'Metrics must be grounded in system data — Jira, Git, CI/CD telemetry. Never anecdotes, never self-reported surveys.'* Both S1WI and L1US cleared their L2 Performance Tracking gate on **survey**-backed numbers. That route does not exist at Level 3."

### 1.2 What the validator actually looks at (submission mechanics)

`SGHQ/programs/ai-transformation/ai-maturity-validation-process.md:84`:

> | 3 | **Performance Tracking** | Screenshots from automated systems or surveys confirming the set of performance metrics tracked **by category: Flow Time, Throughput, Quality** | Latest report screenshot from the tracking tool (Jira, Azure DevOps, …) or survey; DC Metrics section is acceptable. Ownership of the system (EPAM or customer) does not matter. | **Metric names clearly visible.** *"Less interested in values, more in the fact that relevant metrics are tracked."* |

And the consequences at `:104-112`: one artifact per dimension "in the survey's own vocabulary (… metrics named by **Flow Time / Throughput / Quality**)"; "artifacts are read by an AI assistant first, so names, numbers and the mapping to the survey answer must be self-explanatory without a narrator" (`:66-68`); "Every number on a screenshot must reconcile with the number in the survey answer"; "L3-mode validation expires at quarter end". AI Costs (L3) row `:87`: "Screenshots from AI tools or systems with cost analytics **plus an explanation of what exactly is being done**."

### 1.3 Evidence an assessor wants — the vault's own operationalisation

- **Metric families (Module 1000 Deep, "Telemetry & status reporting")** — `1000-management.md:141`: "**adoption metrics** each name a **denominator** and source (sessions, AI-assisted PRs, stories with AI-drafted ACs); **outcome metrics** each name a **baseline** (cycle time, defect-escape rate, cost per feature). Both feed the weekly report plus the customer benefit expected — defeating the vanity trap where 'adoption is up' never shows in flow, quality, cost, risk, or readiness."
- **Two-way contract** `:104`: the manager owes "adoption metrics with defined denominators, AI cost in the dashboard".
- **Maturity baseline** `:124`: each score needs "an **evidence statement** (artefact / telemetry line / repo path / observed behaviour) *and* the **project outcome it threatens or improves** (cycle time, defect escape, stakeholder confidence, go-live readiness, cost per feature)".
- **Economics lever** `:74`: "**AI costs as a delivery metric** in the dashboard beside throughput and quality (per team / feature / model)".
- **AP-4 Anecdote as Metric** `020-…fundamentals.md:154`: "Fix: start with two system-grounded metrics (PR cycle time, test coverage %, story points/sprint), reviewed every retro." AP-5/6/7 also block Performance Tracking L2→L3 (`:155-157`).
- **Team-level worked example** `:140`: "velocity +20% (measured in Jira)"; "Target **end-to-end flows** (Jira ticket → merged PR), not isolated subtasks".
- **Three-lens 90-day plan** `1000-management.md:147`: "reads like delivery management — *'reduce handoff decision reopens from 4 to 1 per release,'* not *'raise handoff maturity to L2.'*"
- **The "AI Factory reading" test** `ai-maturity-framework.md:91-97`: L3 "reads in three places: 1. a **version-controlled artefact per retro**, 2. a **named champion per role**, and 3. **AI costs as a per-team / per-feature / per-model metric**."
- **Review cadence** — the WPSE design `2026-09-06-euaq-wpse-level-3-assessment-design.md:277-282`: "`vault/maturity/reviews/YYYY-MM-DD.md`, weekly … Each entry must name **an optimisation decision taken from the numbers** … a review that changes nothing is not evidence"; `:284-286` "the review cadence needs **at least three dated entries** before it reads as a cadence rather than an artefact made for the assessment." The live first entry `EUAQ/projects/WPSE/assessment/reviews/2026-09-07.md:16-18`: "A metrics dump is a report, not a review, and does not satisfy the Performance Tracking bar." Its addendum (`:143-146`): "Optimisations 1–5 above corrected measurement and attribution; none changed delivery. The entries due 2026-09-14 and 2026-09-21 must record a delivery change and its expected output-per-cost effect."
- **What actually passed L2 before** (precedent): S1WI `SGHQ/projects/S1WI/assessment/level-2.md:31` — "`perf-metrics/SGHQ-S1WI_ai_perf_metrics.png` (squad velocity/lead/cycle) + … quality_metrics.png"; L1US `…/L1US/assessment/level-2.md:34` — "Squad velocity / lead time / cycle time + R2.0.0 burndown … **now with AI attribution**: 69.0 hrs saved, 39.7% avg, per-role split". WPSE June self-assessment `wpse-level-2-self-assessment-2026-06-09.md:42`: "DORA metrics run on GitHub, which clears L2. Not L3: no AI-specific measurement and no regular AI review — *'DORA ≠ AI-cost tracking'*"; its Gap 2 success metric (`:51`): "3 AI metrics on the dashboard for ≥2 completed epics, **and ≥1 AI review held with notes committed**".
- **Current WPSE Performance Tracking state (2.5)** `EUAQ/projects/WPSE/assessment/level-3.md:42`: flow ✅ (task lead time median 2.1 h n=176, velocity 27.5 tasks/week median over 4 whole weeks), quality ✅, CI ✅, cost ✅, "**ROI ⚠ unit cost only** … these are AI unit costs, not a benefit-based ROI; no day rate or baseline has been supplied", "**Review cadence ⚠ — started 2026-09-07** … one entry is not a cadence; three dated entries make it a practice". `:84`: "the only item in the whole assessment needing elapsed time rather than a decision".

*(inference)* The assessor's checklist, distilled from the above: (a) metric **names** visible under the three categories Flow Time / Throughput / Quality; (b) each metric with a **system source**, a **denominator** and a **baseline**; (c) at L3, **AI cost per team/feature/model** beside the flow numbers, **ROI at delivery level**, and **≥3 dated review entries** each recording a decision that moved output-per-cost; (d) every figure reconcilable to the survey answer and self-explanatory to an AI pre-reader.

---

## 2. Exact metric definitions the wpse-maturity tooling already uses

### 2.1 Board flow — `tools/wpse-maturity/build_board_metrics.py`

Source: `git log --reverse -M -p --format=@@@%H|%aI -- .octobots/campaigns` (`:53-55`), parsing `+status:` diff lines (`STATUS_ADD`, `:42`). Item kind from YAML filename only: `KIND_BY_FILE = {"campaign.yaml": "campaign", "mission.yaml": "mission", "task.yaml": "task", "bug.yaml": "bug"}` (`:47-48`).

| Metric | Definition (formula) | Units | Field name(s) in JSON | Where |
|---|---|---|---|---|
| **Lead time** | `first appearance → first done` — "including time queued as `draft`" | hours (`hours()` = seconds/3600) | `lead_time_first_seen_to_done` → `{n, median_h, mean_h, p90_h, max_h}` | `:19-20`, `:99-102`, `:149-156`, `:319` |
| **Cycle time** | `first executing → first done` ("active work"); only if `exec_at <= done_at` | hours | `cycle_time_executing_to_done` (same stats shape) + `cycle_time_caveat` | `:19`, `:278-279`, `:320-321` |
| **Same-commit exclusion** | `lead_h <= SAME_COMMIT_H` (0.02 h = 72 s) → excluded from lead/cycle medians, kept in throughput | count, % | `same_commit_completions`, `same_commit_pct`, `duration_observable`, `same_commit_note` | `:125-135`, `:274-277`, `:314-318` |
| **Throughput** | completions per ISO week, zero-filled from observation start to last whole week before cutoff; ISO keys `%G-W%V` | items/week series | `throughput_per_iso_week` | `:204-233`, `:302`, `:322` |
| **Velocity** | median (and mean) of completions over **whole** weeks only; whole iff `Monday >= repo first commit` and `Sunday < cutoff`; `MIN_WHOLE_WEEKS = 3` else `None` | items/week | `velocity_median_per_week`, `velocity_mean_per_week`, `velocity_whole_weeks`, `velocity_whole_week_keys`, `velocity_observation_start`, `velocity_cutoff`, `velocity_caveat` | `:183`, `:186-201`, `:236-252`, `:323-329` |
| **p90** | `sorted(v)[int(0.9*(n-1))]` (nearest-rank, no interpolation) | hours | `p90_h` | `:155` |
| **Board state totals** | counted from files on disk, never from history | counts by status | `board_state[kind] = {total, by_status}` | `:105-122` |
| **Reconciliation** | history completions vs done-on-disk per kind; residual explained (renamed/moved, status changed, done-on-disk-not-in-history) or left `unreconciled` | counts | `completions_history`, `done_on_disk`, `residual`, `history_path_absent_on_disk`, `history_status_now`, `done_on_disk_not_in_history`, `unreconciled`, `method` | `:334-384` |
| **Acceptance-criteria satisfaction** | `done: true` lines / `- text:` lines across `task.yaml` | %, counts | `acceptance_criteria_total`, `acceptance_criteria_met`, `criteria_satisfaction_pct`, `tasks_fully_satisfied`, `tasks_partially_satisfied`, `role_distribution` | `:412-435` |
| **Per-item record** | one row per completed item | — | `items[] = {kind, path, first_seen, executing, done, lead_h, cycle_h}` | `:280-283` |

CLI flags: `--repo`, `--out` (required), `--second-repo-coverage`, `--pinned-coverage`, `--cutoff` ("Observation cutoff for the velocity window (ISO timestamp); default now. Weeks whose Sunday is on or after it are partial."), `--from-json` (re-render, "No git reads; the JSON is not rewritten") — `:785-799`.

Rendered labelling (`:647-664`): lead time is "**the reliable flow metric here**"; cycle time "**n=… only** — see the caveat below; not comparable with lead time"; velocity "median **X** tasks completed per week (mean Y) over N whole weeks (W33, …)" or "not measurable — N whole weeks in the window, fewer than the 3 required".

The two caveats printed under every flow table (`:673-681`): "(1) Only a minority of items ever carry an explicit `executing` status … so cycle time rests on a small self-selected subset and its median must not be read against the lead-time median. (2) Board entries are written by the agent *as work starts*, so lead time measures **board-tracked duration**, not idea-to-done: it excludes whatever time a need waited before anyone opened a task for it. Both bound how far these figures generalise; neither invalidates them."

### 2.2 PR flow — `tools/wpse-maturity/wpse_maturity.py:427-458`

Source: `gh pr list --repo <slug> --state all --limit 1000 --json number,title,createdAt,mergedAt,closedAt,state,headRefName,additions,deletions`.

| Metric | Definition | Field |
|---|---|---|
| PR open→merge latency | `mergedAt - createdAt` in hours over merged PRs; median / p90 / mean | `pr_open_to_merge_hours = {n, median, p90, mean, LABEL}` with `LABEL: "PR open to merge. NOT story lead time. NOT cycle time."` (`:446-452`) |
| Merge rate | `merged / prs_total * 100` | `merge_rate_pct`; also `prs_total`, `prs_merged`, `prs_closed_unmerged` |
| Merged per week | Counter by ISO week of `mergedAt` | `merged_per_week` |
| Merged per active week | median over weeks with ≥1 merge, partial weeks included | `merged_per_active_week_median` + `merged_per_active_week_LABEL: "… NOT the headline figure - see merged_per_whole_week"` (`build_delivery_report.py:84-87`) |
| Merged per whole week | same whole-week zero-filled policy as board velocity ("the one policy for board completions and PR merges alike", `build_board_metrics.py:237-238`) | `merged_per_whole_week` (`build_delivery_report.py:45-59, 89`) |

Module docstring `wpse_maturity.py:20-21`: "PR latency is reported as PR-open-to-merge and is labelled as such everywhere. It is not story lead time and must never be presented as story lead time." README `:67-68` says the same.

### 2.3 CI pass rate — `wpse_maturity.py:200-255`

`pass_rate_pct = success / (success + failure)` over runs that actually executed; most recent 200 runs (GitHub page size); failed runs with duration `<= NEVER_STARTED_S` classed "never started" by duration heuristic, "counted and named separately, never blended into the rate". Fields: `runs_examined`, `window`, `sample`, `pass_rate_pct`, `passed`, `failed`, `decided`, `cancelled`, `never_started`, `never_started_window`, `never_started_note`, `method`, `caveat`. Every printed rate carries `method` and `sample` (README `:105-110`).

### 2.4 Cost, effort and delivery-level ROI — `wpse_maturity.py:461-587` (`tokenomics()`)

Source: `.octobots/tokenomics/runs.json` (or `--tokenomics <archived runs.json>` to pin; provenance block records `read_from`, `is_working_tree`, `git_ref`, `git_sha`, `warning` — `:474-489`). Per-run fields summed: `cost_api_equivalent_usd`, `build_cost_usd`, `iterate_cost_usd`, `sessions`, `turns`, `subagent_dispatches`, `net_loc`, `effort_days`, `cost_by_model`.

ROI block (`:535-549`):

- `usd_per_story = cost / stories`, basis `"{stories} of {stories} stories"`.
- `usd_per_effort_day = cost_sized / eff` where **both numerator and denominator are restricted to stories that carry `effort_days`**; basis text: "`{len(sized)} of {stories} stories - the {n} without authored sizing are EXCLUDED from both sides, not averaged in. effort_days is an authored estimate (t-shirt sizes), not a measurement, so this is cost per estimated day`".
- `usd_per_1k_net_loc = 1000 * cost_loc / loc`, basis "net_loc is MEASURED from the PR diff, so this is the soundest per-unit figure of the three".
- `note`: "AI spend only. A blended engineering day rate is needed to express this as cost avoided; state it in AI-spend terms until the operator supplies one."

The code comment `:511-516`: "Per-unit ROI must divide cost by effort FROM THE SAME STORIES … the unsized stories are named rather than imputed, because an averaged-in estimate would make a fabricated denominator look measured."

Attribution block (`:550-585`): `turns_attributed`, `turns_campaign_overhead`, `turns_unattributed`, `turns_total_metered`, `story_attributed_pct_of_turns`, `story_plus_campaign_pct_of_turns`, `turns_pct_LABEL` ("shares of TURNS over all metered turns, not of spend … the denominators differ and must never be quoted interchangeably"), `cost_attributed_usd`, `cost_campaign_overhead_usd`, `cost_unattributed_usd`, `cost_total_metered_usd`, `attributed_pct_of_spend`, `unattributed_branches`, `unattributed_by_prefix`, `unattributed_story_shaped`, `unattributed_carrying_mission_token`, `DIAGNOSIS` (derived from the residual: "INCOMPLETE, not merely coarse" vs "coarse here, not incomplete", `:589-609`). `STORY_PREFIXES = {"feat","fix","spike","qa"}`, `MISSION_TOKEN = r"-c\d+-m\d+|-dc-m\d+|-m\d+\b"` (`:107-108`).

Rendered (`:772-788`): "**ROI at delivery level.** The three figures do NOT rest on equal ground, so each is printed with its basis" — a three-row table `per story / per 1k net LOC / per estimated effort-day` each with a Basis column.

`build_cost_model.py` is an **infrastructure** forward-cost model (GCP/edge/sensors/LLM tokens), not a delivery-performance instrument; what transfers is its provenance-tag discipline (`:10-22`): every input tagged `CONF / CONTRACT / ADR/VAULT / ARCH-DOC / LIST-PRICE / UNKNOWN`, with `UNKNOWN` = "no source exists; stated as a gap, never filled with a plausible number", and the unit-mixing bug note (`:24-27`).

### 2.5 Cross-repo delivery report — `build_delivery_report.py`

Headline tiles (`:124-128`): "Work items completed", "Tasks completed … of N", "Task lead time … median range, boards with observable duration". Sections: "Velocity — items completed per ISO week" (`:212`), "Lead time — board entry to done" (`:269`), tables with `n with duration / Median h / Mean h / p90 h / Cycle time (median h) n=… / Excluded: single-commit / Completions timed (history) / done on disk` (`:302-304`). Footnote `:307-309`: "Lead time is board-tracked duration, not idea-to-done. Cycle time counts only items with an explicit `executing` status (n shown) and is not comparable with the lead-time median beside it." Charts use `None` not `0` for "not measurable" so the bar renders as an em-dash (README `:209-210`); "every mark carries a visible direct label and every chart is backed by its own table" (README `:207-208`).

---

## 3. Anti-fabrication rules and traps — quoted, as constraints

### 3.1 The founding decision (2026-08-05 minutes, aquanautica vault)

`~/dev/aquanautica/vault/Delivery/Meetings/2026/2026-08-05-internal-mvp-demo-progress-contract-status-and-testing-plan.md:40`: "The team identified that they cannot currently produce cycle-time, lead-time, cadence, or velocity metrics, since the GitHub roadmap board and the issue/epic list are not synchronized and can only be counted by ticket status rather than tracked end-to-end; everything else required (throughput, token consumption, quality, unit-test coverage, active-usage metrics) is already covered". Decision row `:51`: "The team will not attempt to fabricate cycle-time/cadence/velocity metrics for the AI-maturity submission that it cannot currently produce from its unsynchronized backlog; reporting stays pragmatic and proportionate to a six-person, small-budget team."

How it was later scoped — README `:70-77`: "That decision … concerned the **vault roadmap board versus the GitHub issue list** — those two are unsynchronised, so anything derived from them would be invented. The **Octobots board is a different artefact**: YAML committed to git, where every status change is a real commit with a real timestamp. Recovering it is measurement." The design spec's FLAG 2 (`2026-09-06-…design.md:193-199`) framed the refusal itself as "**evidence of governance maturity**, not as a hole: a team that declines to invent a metric is demonstrating exactly the discipline the dimension is trying to measure."

### 3.2 The traps (README `tools/wpse-maturity/README.md:79-119`, quoted)

1. `:81-83` "**Never take totals from the reconstructed history.** Git rename detection is imperfect and mis-counts entities in both directions (259 vs 233 tasks, 104 vs 115 bugs). Totals come from the board files on disk; history supplies **timestamps only**."
2. `:84-86` "**Cycle time is a minority sample.** The board records only 68 `executing` transitions against 212 completed tasks, so its median must never be printed beside the lead-time median as though they were comparable. Lead time (n=212) is the reliable metric."
3. `:87-88` "**Lead time is board-tracked duration, not idea-to-done.** Entries are written by the agent as work starts, so the clock excludes queue time before a task existed."
4. `:89-94` "**Single-commit completions have no duration and must be excluded from the medians.** An item created and completed in one commit records an outcome, not work. They are 17% of `coach-android`, 64% of `solo` and **100% of `coach`** — counting them as zeros gave `solo` and `coach` a median task lead time of 0.0 h, which reads as instantaneous delivery. `SAME_COMMIT_H` is the threshold; excluded items stay in throughput, because a completion date is real whether or not a duration is."
5. `:96-104` "**Velocity needs whole, zero-filled weeks, bounded by the observation interval.** A week is whole iff its Monday is on or after the repo's first commit and its Sunday is before the collection cutoff (`--cutoff`, default now) — so a trailing quiet week counts, and the week containing the last completion is not dropped as 'partial' just because it holds the last event (that rule under-counted quiet weeks and reported 51/week where the fully observed W33–W36 give 27.5). Fewer than three whole weeks → no velocity (`MIN_WHOLE_WEEKS`). A board dormant since its first weeks (`coach`) legitimately reads 0/week over the whole weeks observed; the derived caveat says so. A `weekly_velocity` assertion fails the build if the re-bucketed series does not conserve every completion."
6. `:105-110` "**CI pass rate is a sampled, duration-classified figure.** … The `method` and `sample` fields say so wherever the rate is printed."
7. `:111-115` "**Item kind comes from the YAML filename, never from a path fragment.** Checking `/missions/` before `/bugs/` counted 11 bugs nested under mission folders as missions — the whole 74-vs-63 'different populations' gap."
8. `:116-119` "**Caveats must be derived, not pasted.** The cycle-time caveat once hardcoded coach-android's '68 events against 212 completed tasks' and was emitted for every board, so it guarded `solo` (really 37) and `coach` (really 3) with numbers that were not theirs. Same for prose under a chart: 'Both bars sit well clear' printed under a single bar once the second was withheld."
9. `:121-122` "Build reports … are read where a local `make ci` has left them. The script never runs a build, and an absent report means 'not run here', never 'zero'." `:124-140` "**A present report is not a completed one.** … **It never estimates** — the file holds real measured values or it is absent."
10. `:162-170` "**Two data files look interchangeable and are not.** `.octobots/tokenomics/runs.json` holds 28 delivered stories with cost, effort-days, t-shirt size … `reports/metrics/RUN-*.json` is a QA-orchestration benchmark series … a per-role split from them systematically under-reports the coordinating role."
11. Identity & DAU (`:144-160`): "Identity mapping is load-bearing … never trust a DAU number without checking the per-person `days_with_any_commit` column"; "A blind seat's AI use is **unknown, not zero**. Quote neither number without naming the blind seats."

Code-level rules that belong with these:

- `build_board_metrics.py:285-300` the two opposing velocity biases: "A `Counter` over completion weeks holds only the weeks that had a completion, so a quiet week silently leaves the denominator and the mean reads high" vs "A week observed for only part of its seven days is not a week's worth of delivery, so counting it whole drags the mean down." Also "Weeks are keyed as ISO strings, never stepped as datetimes: carrying the first completion's time-of-day onto every Monday once dropped 4 of coach-android's 212 completions."
- `build_board_metrics.py:204-210`: `dense_week_series` "A re-bucketing, never a filter: it raises if it does not conserve every event, because then the window arithmetic is wrong and any velocity built on it is fiction."
- `wpse_maturity.py:464-473`: a figure read from a working tree "depends on which branch that tree happens to be checked out on … the same command produced a 28-story figure or a 48-story one depending on nothing but the operator's last `git checkout`, and the pack ended up asserting both." → record provenance, allow `--tokenomics` pin.
- `build_board_metrics.py:568-598` `resolve_coverage`: "Both reports MUST call this rather than each applying their own rule: while they did, one published 60.5% and the other 96.9% from the same file on the same day, which is precisely the self-contradiction the pack forbids."
- `wpse_maturity.py:579-584` `DIAGNOSIS`: "This field once hardcoded the PRE-FIX root cause … a caveat drifted from the number it guards, which is the defect class this whole pack keeps hitting. It now reads the residual it is describing."

### 3.3 Standing scoring rules from the quality-lens research (`SGHQ/programs/ai-transformation/asdlc-quality-lens-research.md:690-700`)

1. "**No volume or speed observation is ever scored alone.** Each must be scored jointly with its paired quality criterion — change size with review depth, throughput with rework, provenance with escaped defects."
5. "**Force at least one honest low.** The vault's own rule: 'a baseline with no low score was not measured'".
6. "**Score the profile, not the average.**"
7. "**Do not score a documented stall as slop.** … 'the honest run is the deliverable; a stall is a finding, not a failure.'"

Also `:464`: "**Assessor error:** presenting proxies as DORA metrics — True change-failure-rate and deployment frequency need data you do not have. Name the proxies as proxies in the record." `:562`: "**Conservative default (Shintani):** 'When evidence is absent, ambiguous, or **privately claimed but not inspectable**, the lower score should be assigned.'" `:688`: "**No per-person scores, ever, in a tracked page.** … if the assessors find any of these measures already used in performance conversations, that is itself an L1 finding on measurement maturity."

### 3.4 Review-cadence honesty rules (`EUAQ/projects/WPSE/assessment/level-3.md:98-110`, `reviews/2026-09-07.md`)

"needs **at least three dated entries** before it reads as a cadence"; "an assessor who finds a review cadence back-dated into existence, or a DAU denominator quietly trimmed to the people who could pass, discounts" the pack. The review entry has a "**What we decided NOT to do**" section (`reviews/2026-09-07.md:90-107`) and a dated "Addendum … corrections to the figures quoted above" (`:123-146`) that leaves the original text as written.

---

## 4. The Octobots board as a timestamp source — lessons only

(sdlc-skills `CLAUDE.md` forbids reintroducing octobots/dual-mode framing; only the measurement lessons are carried.)

**What worked**

- Status transitions committed to git gave **real timestamps** for free: "YAML committed to git, where every status change is a real commit with a real timestamp. Recovering `draft → executing → done` from git history is therefore MEASUREMENT, not fabrication" (`build_board_metrics.py:14-17`).
- A four-level hierarchy with kind encoded in the **filename** (`campaign.yaml` / `mission.yaml` / `task.yaml` / `bug.yaml`) allowed per-kind flow stats (`:47-48`, `:641`).
- Disk state as the authoritative population and history as the timestamp source separated cleanly (`:105-111`).
- Acceptance criteria lived in the item file as `- text:` / `done: true` lines, so a gate-satisfaction % was recoverable without another system (`:412-435`); the render says "Partial values are left visible on purpose. A gate that always reported full marks would not be a gate." (`:689-690`).
- Tokenomics attached `effort_days`, `size_tshirt`, `net_loc`, `cost_*`, `turns` to the same work-item id, which made per-story unit cost derivable (`wpse_maturity.py:502-549`).
- The board carried `role:` per task → `role_distribution` (`build_board_metrics.py:418-420`).

**What worked badly**

- **`executing` was optional and rarely set** → cycle time is a "minority sample" (68 of 212) and not comparable to lead time (README `:84-86`).
- **Creation was recorded when work started**, not when the need arose → lead time is board-tracked duration, not idea-to-done (README `:87-88`). *(inference)* An honest idea-to-done needs an upstream "requested/accepted" timestamp the harness does not have.
- **Retrospective authoring**: whole boards (100% of `coach`) were created and completed in one commit → no observable duration; medians of 0.0 h unless excluded (README `:89-94`).
- **Renames** broke identity across history (259 vs 233 tasks) → totals must not come from history (README `:81-83`); `reconcile()` exists to explain the residual (`build_board_metrics.py:334-384`).
- **Nested items** (bugs under missions) were mis-kinded by path (README `:111-115`).
- **Branch-name ↔ work-item matching by campaign slug failed** for `c<N>-m<N>` shorthand; 69% of spend sat unattributed until the matcher resolved "which campaign directory each branch's merge actually touched" and campaigns **declared** the shorthand in `campaign.yaml` ("declared beats learned", `reviews/2026-09-07.md:32-46`). Two campaigns with no merged branch could never be attributed by inference.
- **Working-tree dependence**: `runs.json` read from a checkout varied with the branch (`wpse_maturity.py:464-473`); coverage XML was clobbered by partial runs (README `:124-140`).
- **Nothing in the board recorded a dated review** — the cadence had to be created as separate `reviews/YYYY-MM-DD.md` files and is "the only item … needing elapsed time" (`level-3.md:84`).

---

## 5. Estimate-vs-actual practice already in the vault

- **Curriculum rule (BA module)** `docs/reference/ai-run-2026/200-product-management-ba.md:152`: "**Estimation:** the team estimates; **AI does not estimate** — it suggests ranges grounded in the team's own closed-story history; a spread > 3 sizes = refine, don't estimate." Work decomposition "Epic (spans sprints; 5–30 stories) → User story (INVEST; fits a sprint) → Task (hours)". Prompt library `:170` includes "estimation candidate ranges (team-velocity grounded)". `:25`: "estimation & sprint planning (team-velocity-grounded)". Management module `1000-management.md:118` lists "estimation drafts, historical-comparable lookups" as AI-assists and "resource and capacity decisions" as human-owned.
- **Effort unit in the tokenomics rollup**: `effort_days` is "an authored estimate (t-shirt sizes), not a measurement, so this is cost per estimated day" (`wpse_maturity.py:541-542`); the run schema also carries "t-shirt size, complexity score, cache-read share, orchestrator cost share and cost by model" (`wpse-level-3-evidence-2026-09-06.md:163`). The level-3 checklist quotes "$13.26/estimated effort-day (38 of 48 — the 10 stories without authored sizing are excluded from both sides)" (`level-3.md:42`). No actual-effort figure exists in the vault against which `effort_days` is compared — the only "actual" is AI spend and `net_loc`.
- **Headline-figure precedent** (delivery-insights corpus): `SGHQ/programs/ai-transformation/delivery-insights-log.md:36` C2A2-029 "a small (S) story runs end-to-end story→PR in under an hour, and even a large 5-pointer completes within a day" — promoted into the pattern "Measure the Before and After" (`patterns-and-antipatterns.md:12-20`): "Capture a 'before' baseline across three families (throughput, cycle/lead time, quality …), vet the metric set with the team, and concentrate tracking on the teams with enough presence to measure. Translate into headline figures". Related antipattern C2A2-018 (`delivery-insights-log.md:25`): flow/velocity cannot be captured for scattered 1-person engagements without project access.
- **Glossary units**: `000-glossary.md:105` "**FTE-months** = FTEs × months … the unit a staffing plan/bottom-up estimate is sized in"; `:58` contingency reserve "Size from the risk register, not a flat number"; `:154` margin kept separate from contingency; `:208` RICE "AI drafts scores, human owns inputs + order"; `:84` **Edit Distance** "metric for how much rework AI output needed before production-ready … min instrumentation = a tally file per feature".
- **Provenance-tagged estimates**: `build_cost_model.py:10-22` (`CONF / CONTRACT / ADR/VAULT / ARCH-DOC / LIST-PRICE / UNKNOWN`) and log.md:1719 "**range**, never a point estimate" — the vault's habit is ranges (LOW/BASE/HIGH) with named swing factors.
- **Cross-reference, outside dm-kb** *(for the spec author; not vault content)*: the existing sdlc-skills `tokenomics` skill already emits an "**Estimate vs actual (batch grain)**: Xm predicted / Ym actual — ×ratio" line from `.agents/estimation/` (`estimated_active_minutes`, `size`, `sp`) — `bundles/test-automation/skills/tokenomics/scripts/team-report.mjs:426`, `batch-cost.mjs:319-344`; `effort_days` there is "derived from scoping SP (SP × 1h ÷ 8) — conventional-effort estimate, not a human report" (`build-tokenomics-export.mjs:136`); missing sizing is "flagged, never invented" (`batch-cost.test.mjs:487`).

Nothing in the vault defines a **predictability** metric (e.g. estimate accuracy ratio, say/do ratio, commitment reliability). Grep for `predictab` hit only unrelated governance-ranking prose (`tools/governance/README.md:61`, `plans/2026-09-10-governance-tracking.md:195`). "Cadence" in the vault is used for **review/ritual cadence** (weekly review, 30/60/90 checkpoints, `1000-management.md:127-129`, `:147`), not as a delivery-throughput metric — the 2026-08-05 minutes list "cadence" alongside cycle-time/velocity as something the team could not produce (`:40`), but never define it.

---

## 6. Implications for the spec — metrics, definitions, caveats the tracker should output

(What follows is the set of constraints the vault imposes; naming/format is the spec's call.)

### 6.1 To satisfy L2 ("Tracked" — defined + consistently measured, system-sourced, named by category)

| Category (validator vocabulary) | Metric the vault already defines | Definition to reuse verbatim | Mandatory labelling |
|---|---|---|---|
| **Flow Time** | Lead time per work-item kind | first appearance of the item → first `done`; hours; `{n, median_h, mean_h, p90_h, max_h}`; p90 nearest-rank | "board-tracked duration, not idea-to-done" (or, if the harness records a request/accept timestamp, say which clock it is); `n` beside every median |
| **Flow Time** | Cycle time per kind | first `executing` (or equivalent active state) → first `done`; only where the active transition exists | derived per-board caveat with its own `n` of `completed`; "not comparable with the lead-time median beside it" when `n_cycle < completed` |
| **Flow Time** | Same-commit / zero-duration exclusion | `lead_h <= SAME_COMMIT_H` (72 s) → excluded from duration stats, kept in throughput | count and % printed; if 100% excluded → "not observable — authored retrospectively" |
| **Throughput** | Completions per ISO week (zero-filled) | dense series from observation start to last whole week before cutoff; conservation assertion | full series including partial weeks, marked partial |
| **Throughput** | Velocity (median/mean per whole week) | whole iff Monday ≥ observation start and Sunday < cutoff; `MIN_WHOLE_WEEKS = 3` else `None` | `velocity_observation_start`, `velocity_cutoff`, `whole_week_keys`, derived `velocity_caveat` |
| **Throughput** | PR open→merge latency, merge rate, merged/whole-week | `mergedAt - createdAt`; whole-week policy shared with board velocity | `LABEL: "PR open to merge. NOT story lead time. NOT cycle time."`; "merged per active week" only as a secondary, labelled figure |
| **Quality** | Acceptance-criteria satisfaction; defect (bug-kind) counts and their flow | `done`/`total` criteria; bugs as a separate kind in the same flow stats | partial values left visible; never blended with task lead time |
| **Population** | Board state on disk vs completions in history | totals from disk, timestamps from history; reconciliation with residual explained or `unreconciled` | printed per kind |

Each metric must carry a **source** (system + path/command), a **denominator**, and (for outcome metrics) a **baseline** slot (`1000-management.md:141`) — the tracker cannot supply the baseline but must leave a named, empty field rather than a default.

### 6.2 To contribute to L3 ("Governed")

- **AI cost beside the flow numbers**, per team / feature (work item) / model, joined on the work-item id — the tracker must be joinable with the tokenomics rollup (`cost_api_equivalent_usd`, `cost_by_model`, `effort_days`, `net_loc`, `turns`) and must not recompute or re-estimate dollars.
- **Delivery-level unit ROI** in the established three-row shape with a Basis column: per story (N of N), per 1k net LOC (measured), per estimated effort-day (sized subset only, both sides restricted; "cost per estimated day"). State "AI spend only" until a blended day rate is supplied (`wpse_maturity.py:546-548`; open item `design.md:353`). Benefit-based ROI stays **open** unless a baseline is supplied (`level-3.md:42`).
- **Estimate-vs-actual**: the only vault-sanctioned frame is *authored estimate (t-shirt / effort_days / SP) vs measured actual (lead time hours, net LOC, AI spend)*, computed on the sized subset with the unsized count named ("named rather than imputed"). *(inference)* An accuracy ratio per size class fits the BA-module rule "AI suggests ranges grounded in the team's own closed-story history" — the tracker's closed-item history is exactly that grounding, provided it is reported as ranges (median/p90 per size class) and the human "owns the number".
- **A dated review record** with ≥3 entries, each naming an optimisation taken from the numbers and its expected output-per-cost effect; a "decided NOT to do" section; corrections as dated addenda that leave the original text intact. The tracker should make a per-period snapshot (with `generated_at`, `cutoff`, source SHA/ref) that a review entry can cite, never author the review itself.
- **Re-render from archived JSON** (`--from-json`, "JSON not rewritten") and an explicit `--cutoff`, so a pack stays reproducible and pinned to its instrument run.

### 6.3 Non-negotiable caveat / anti-fabrication behaviours

1. Never estimate a duration, cost or count; absent = "not measured", printed as `None`/em-dash, never 0.
2. Totals from state, timestamps from history; reconcile and name the residual.
3. Kind from the item file/schema, never from a path fragment.
4. Every caveat **derived from the numbers it guards** (n, %, week keys), never pasted text.
5. Spend-share and turn-share (or any two denominators) are never quoted interchangeably; the label names the denominator.
6. No volume/speed figure printed without its paired quality figure (criteria %, bug flow, rework proxy).
7. No per-person scoring in a tracked/shared output; team is the unit (`020:140`, quality-lens `:688`).
8. Proxies are named as proxies (PR latency ≠ story lead time; board duration ≠ idea-to-done; CI rate = sampled/heuristic).
9. Provenance of every input (path, git ref/SHA, `is_working_tree`, `generated_at`) recorded in the output.
10. Metric names must be visible and self-explanatory to an AI pre-reader, grouped Flow Time / Throughput / Quality, with every number reconcilable to whatever a survey answer says.
