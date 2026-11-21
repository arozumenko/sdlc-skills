---
name: delivery-monitor
description: Delivery monitor for harness work items — the cycle-time and cadence sibling of tokenomics. Registers a plan (campaign → mission → task) with ranged, human-accepted estimates, records dispatch/merge/cancel transitions into a git-committed event ledger (.agents/telemetry/delivery/), captures dispatch usage, backfills history from git or Claude transcripts, and reports cycle time, cadence, estimate accuracy and global spend. Use when the user asks "how fast are we delivering", "register the plan / estimates", "record that TASK-023 merged", "delivery report / status", "delivery spend / unattributed spend", "recover dispatches from transcripts", "enable delivery tracking", or "how good were our estimates". For cost per case use tokenomics; for sizing new work use automation-scoping.
license: Apache-2.0
compatibility: "Requires Node 18+ and git. Automatic dispatch capture on Claude Code only (SubagentStop hook, opt-in via scripts/install-hooks.mjs); every other host records transitions with the CLI and the git backfill."
metadata:
  authors:
    - Daniel Sallai <daniel_sallai@epam.com>
  version: "0.5.0"
---

# delivery-monitor — cycle time, cadence, estimate vs actual

`tokenomics` answers *what did it cost*; this skill answers *how long did it
take and how did that compare with what we said*. It never guesses a number: an
estimate comes from the planner or from the project's own measured history
(calibration), a missing number is never defaulted, and every proxy is labelled
as a proxy.

## Quick start

```bash
# 1. Register the plan BEFORE the first dispatch (the tech-lead's plan file carries a ```json delivery-plan block). Inside Claude
#    Code this also binds the calling session (subagents included) to the run — prints `SESSION claude:<id> -> <run>`.
node .claude/skills/delivery-monitor/scripts/delivery.mjs plan register --from docs/superpowers/plans/<plan>.md --id reg-1
# 2. Bind before dispatching so tasks receive their cost and cycle time (or use a branch that maps to exactly one item of
#    exactly one open run). Every available child transcript is captured even when unbound. A session that did not register binds itself:
node .claude/skills/delivery-monitor/scripts/delivery.mjs session set sec/run-1     # host/session default to CLAUDE_CODE_SESSION_ID
#    Record transitions as they happen. A hook dispatch credited to the wrong item is withdrawn with `retract`. Its cost cannot be
#    moved (`event` cannot write `dispatch_ended`): the right item's cost then lacks it and is not flagged incomplete. Give that item
#    `event <ref> dispatched --at <iso>` only if it has no dispatched record yet:
node .claude/skills/delivery-monitor/scripts/delivery.mjs retract --agent <agent id> --plan sec/run-1 [--dry-run]   # or --observation <id>
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-monitor/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
node .claude/skills/delivery-monitor/scripts/delivery.mjs event INFRA-2 done --id done-infra-2    # landed no commit (infra, QA run, gate): no --sha, stamped now
#    A task cannot proceed until something else happens (another project, a human ruling, a dependency, a technical blocker
#    routed to someone else): blocked, with what it waits on in --note; when it resumes: unblocked
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 blocked --id blk-023-1 --note "waits on API team"
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 unblocked --id unblk-023-1
#    A bug is filed in your tracker and traced to the plan item that caused it: record it on that item (any id your tracker uses),
#    with the stage where it was found. When the fix lands, record the fix. These feed change failure rate and time to restore.
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 defect_found --defect BUG-7 --found-stage qa [--severity major] [--found-by <who>] [--at <iso>]
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 defect_fixed --defect BUG-7 [--sha <fix merge sha>]
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --git --plan sec/run-1 --head <sha>
#    GitHub-merged work (squash/merge-commit PRs, task PRs into a mission branch): read merged PRs via gh, or offline from JSON
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --pr --plan sec/run-1 [--from-json prs.json] [--since <iso>] [--dry-run]
#    Recover dispatch usage independently of any plan; this does not add task observations
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --transcripts [--since <iso>] [--dry-run]
# 4. Optional: automatic dispatch start/end on Claude Code (+ shared telemetry submodule)
node .claude/skills/delivery-monitor/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-monitor/scripts/delivery.mjs status
node .claude/skills/delivery-monitor/scripts/delivery.mjs spend [--since <iso>] [--until <iso>] [--by plan] [--json]
node .claude/skills/delivery-monitor/scripts/delivery.mjs doctor
node .claude/skills/delivery-monitor/scripts/delivery.mjs report [--json] [--html] [--from-json <f>] [--since 2026-09-01] [--level task] [--class M]
node .claude/skills/delivery-monitor/scripts/delivery.mjs report --html --out delivery.html
# 6. Optional: manually rebuild or inspect calibration (plan register rebuilds it automatically)
node .claude/skills/delivery-monitor/scripts/delivery.mjs calibrate [--dry-run] [--json] [--half-life 42]
# 7. Optional, once after upgrading: log the session and run files as they are now (not idempotent; --dry-run lists them)
node .claude/skills/delivery-monitor/scripts/delivery.mjs history snapshot [--dry-run]
```

**Dispatch capture and spend.** The hook captures every dispatch whose child transcript is available, before checking session
binding, an open plan or the role roster. The separate append-only store,
`.agents/telemetry/delivery/dispatches-<user>.jsonl` (`dispatch.v2`; readers also accept v1), holds usage and evidence keyed by
`claude:<session>:<agent>`. The compact store interns model names and stores five token counters in arrays, keyed by 12 hex characters of the message identity hash. Hook writes append one snapshot without scanning history; reducers deduplicate. Stable message identities are unioned across snapshots and token counters use their maximum,
so repeats and partial transcripts keep captured usage without counting a message twice. Anonymous usage is estimated
separately and marked `identity-uncertain`. Store capture leaves existing task observations, reports and calibration unchanged.

**Write history.** Every session binding write and run file write also appends one line to
`.agents/telemetry/delivery/history-<user>.jsonl` (`history.v1`). A line holds the file's kind and key, what wrote it, the time,
a short summary of the file as it was just before, and a short summary of the file as written. It is evidence, not a complete
record: a crash, two writers at the same time, or an older installed copy can leave a write unlogged. A history failure never
changes what a command or hook does. A command prints one `WARN history not recorded: <reason>` line on stderr. Nothing reads
the file yet. After upgrading, run `history snapshot` once to log the files as they are now.

`spend` works without a plan. It counts each dispatch once, using the greater of captured usage cost and active legacy
`dispatch_ended` usage cost, repriced with the current price table. Its classes are `item` (allocated to a task or other item),
`plan` (allocated without an item), and `not-in-ledger` (captured with no active allocation). Withdrawing an observation
removes that allocation; captured spend remains visible as unattributed. Output includes unpriced dispatches (including partly
priced ones), store/legacy discrepancies, inconsistent legacy allocations, observation conflicts and legacy starts without an end.
Anonymous estimates are shown apart from exact spend. Inputs include file hashes. The unattributed share is `(plan + not-in-ledger)
/ total` by spend, null for a zero total; above 10% it prints `FLAG`.

`spend` appends an `ATTRIBUTION` block for dispatches outside the ledger. Exact task or mission refs in the description
win. The first brief is used only when the description has no matching refs. A standalone campaign code can restrict
matches to that campaign. Branch evidence can confirm text (`text+branch`) or resolve repeated refs (`branch-resolves-text`).
Several matching items in one run can yield `text-plan`. A branch match without text is `branch-only`, a heuristic.
`branch-plan` is also a heuristic. Refs found only in the first brief give `brief-only` or `brief-plan`, also heuristics,
unless the branch confirms them. Ambiguous or conflicting evidence stays unresolved. Retracted allocations stay
`legacy-withdrawn`, and conflicting allocations stay `legacy-conflict`. Active legacy keys keep their class without an invented owner.

Attribution uses the current catalogue, including today's names and task cuts. Cancelled items are excluded.
Work before `observation_start` is excluded. A closed run uses `updated_at` as an approximate end. Closing it again moves that end.
Incomplete captured refs cannot yield text attribution. A conflicting captured branch cannot yield branch attribution.
The `crossed` flag means a follow-up names another item in the same run. It does not split the spend.

`attributed_share` excludes the branch and brief heuristics. `attributed_share_incl_heuristic` includes them. Both are null for a zero total.
Use `--by plan` for recovered item and plan totals per run, plus project totals for legacy and unresolved spend.
JSON adds `attribution` and per-key decisions. If a run file cannot be read or fails validation, attribution is unavailable.
The base spend report still succeeds. Recovered spend is shown in `spend`, and `report` and calibration count it in task costs (see below).

The spend window selects **dispatches started in `[since, until)`** and includes their lifetime usage. Start time is the
earliest resolved legacy `dispatched` time, else the store's start. `unknown-start` keys are included only without a window.
`status` adds the same calculation for dispatches started in the last seven days, even when it reports `NO-PLAN` or `NO-EVENTS`.

`backfill --transcripts` scans the main checkout's Claude project transcripts (`$CLAUDE_CONFIG_DIR/projects`, else
`~/.claude/projects`), children first, then parents for enrichment and coverage. Each child failure is isolated, reported on stderr, and counted as `failed=N`. It captures orphan children when their identity is corroborated by parent results, metadata, or their own records. Uncorroborated files count as unidentified. `--since`
selects children whose last record is at or after that time; `--dry-run` counts without writing. Repeating it is safe.
`doctor` reads coverage without writing: identifiable dispatches, in/missing from store, resolved/unresolved capture gaps,
interrupted calls, unreadable children and oldest transcript date. Missing transcripts remain unresolved gaps until captured.

To exclude a dispatch from all spend totals permanently, run
`delivery.mjs retract --dispatch claude:<session>:<agent> --reason "<why>" [--dry-run]`. This appends a tombstone; future
captures of the key are ignored. Use the existing `--agent` or `--observation` mode to withdraw task allocations instead.
Profile `captureRefs: false` disables identifier refs and follow-up refs; `captureBranch: false` disables branch evidence.
Both default to true. Refs use a capped identifier grammar, which can still capture sensitive identifiers.
Description text is stored only with the existing `capturePrompts: true` switch (default false).

**Task USD budgets (Claude Code).** Leave task estimates empty in the plan block so `plan register` fills calibrated
USD ranges. Keep human effort in the board's `tokenomics.effort_days`. A missing calibration cell is a planning gap;
check `CALIBRATED ... no-cell=0` before dispatching. In-flight hours estimates remain valid and unbudgeted.

Run `install-hooks.mjs` to install both synchronous hooks (only in a consumer project you are authorized to configure).
`--repo <root>` wins over the current folder and `CLAUDE_PROJECT_DIR`, and must name a repository root (a folder inside a
repository is refused). The hooks are always wired to the target's own copy of the skill; a target without one is refused.
PreToolUse checks Agent/Task dispatches before they start and subagents before each tool call. SubagentStop captures and
records crossings; it never refuses work. Task cost comes from `taskCosts`, including prior dispatches, fix rounds and
recovered attribution. In-run checks cache prior task cost once per agent and add incremental child-transcript usage.
At strictly more than the range's high end, `budget_exceeded` flags the task. At strictly more than three times high,
`budget_stopped` refuses the dispatch or every later tool call of that running subagent. The denial names the task,
its cost and cap. The orchestrator treats the task as blocked and decides the next action.

Profile settings `budgetSoftMultiplier` (default 1) and `budgetHardMultiplier` (default 3) are finite positive numbers;
hard must be at least soft. Crossings are recorded once per task/threshold, including across `supersedes.item_map`
renames. The first writer's `cost_at_crossing` stays unchanged. Details: `references/event-model.md`, "Budget events".
Unreadable evidence lets work proceed and writes one `budget-check-unavailable` diagnostic per session.
While the latest such diagnostic is at most 7 days old, `status` prints `BUDGET check: OFF since <time> — <reason>` and
`doctor` prints `budget check: OFF …` as a warning; otherwise both print `ok`. The line clears 7 days after the last failure,
not when the cause is repaired.

`status` adds BUDGET lines and `report --json` adds `budget`: resolved exceeded/stopped counts per open plan, and
current lifetime coverage as dispatch counts and USD (`budgeted`, `all`, `unbudgeted`, `codex`). A dispatch without a
named USD task, outside an open plan, or from Codex is unbudgeted and is never stopped. Codex coverage includes only
keys available to the cost projection; this skill does not capture Codex spend. The project total includes ownerless
work; a plan's coverage includes work allocated or attributed to that plan. Coverage ignores report window/item filters.
Transient per-agent cursors are `.pending-budget-*.json` (ignored by the existing transient patterns).

**Effort calibration (estimate → actual → calibrate).** On Claude Code the dispatch hook prices every finished subagent's tokens
per model (`references/prices.json`; a project `.agents/telemetry/delivery/prices.json` overrides it) and records the dollar cost
on `dispatch_ended`. A task's effort is its share of all its dispatches, fix rounds included. A task is left out of calibration and
of cost accuracy when the ledger shows a gap in its cost: one of its dispatches has no cost or an unpriced model; one of its
hooked dispatches never ended; a resumed agent's follow-up message named another task (the task of the first brief and every
task named are left out); or its earliest hooked dispatch is classified `review` or `fix` (the build is assumed to have run
where the hook did not record it). These checks catch only gaps the ledger shows: work that ran outside the hook after a hooked
build is not seen. `calibrate` prints how many landed tasks it left out and why (`LEFT-OUT …`); the full list of reasons is
in `references/plan-block.md`, "Calibrated estimates". `plan register` rebuilds the calibration from the ledger
for every new registration, before filling estimates. It turns the remaining landed tasks into
`.agents/telemetry/delivery/calibration.json`: per cell (`role|type|novel`, then coarser, then `all`) the p50/p80 cost, the
return rate (rework, review returned, reopened) and per-model figures, recency-weighted (half-life 42 days), with effort
classes E1–E4 learned from the cost quartiles. `plan register` fills every task the plan leaves unestimated with the cell's
p50–p80 as a `usd` range (`tier: calibrated`, auto-accepted by `calibrate (auto)`) and its effort class; `--no-calibrate` stops
the rebuild and new fills (a re-cut keeps earlier ones). Identical retries and `--dry-run` never rebuild.
With no samples, registration prints `CALIBRATION none:` and keeps any existing table.
`plan register` stops with `CALIBRATION-INVALID` (exit 2) if rebuilding cannot replace a broken existing table.
A table is broken if it cannot be read or parsed, has a malformed cell, or has a wrong `v`, `unit` or `min_n`.
`calibrate` stops with `PRICES-INVALID` (exit 2) when the built-in price table or the project override cannot be read or has
an invalid model entry. `plan register` warns with `WARN PRICES-INVALID` and uses the existing table if available.
While prices are broken, the hook marks each dispatch unpriced (`<prices-unreadable>`), and `report` falls back to the
hook-time task costs (see "Task cost in the report"). An override entry replaces a
built-in model whole, so it needs all four rates (`input`, `output`, `cache_write`, `cache_read`); it may price a
`<model>#fast` id itself, otherwise fast mode is the base model at double every rate. A model id missing from the table is
unpriced, and its tasks are left out of calibration. When the table's `as_of` date (the override's when it has one, else the
built-in one) is more than 45 days old, `status` prints `PRICES stale: …` and `doctor` a `prices: stale` warning, with the date
and the file to update. `calibrate` says `NO-EVENTS` until a
landed task has a complete measured cost, and says how many it left out. Use `calibrate` for an optional manual rebuild
or `calibrate --dry-run` to inspect the table and `OUTLIER` lines. `status` shows sample count and age; `doctor` warns
about missing or stale calibration. `report` scores those ranges against measured cost in `usd:` strata.
Cells need 5 samples, classes 12.

Calibration also counts attributed dispatches the hook missed. It takes every dispatch that `spend` attributes to a task,
each dispatch once, at current prices. A dispatch shared by several tasks is split equally. The completeness rules are the same
as above, applied to all of a task's dispatches. Two reasons are new: `text-incomplete` and `attribution-unstable` (the
description or brief names a cancelled task or mission, or a campaign prefix that is not a qualifier). `calibrate` stops with
`ATTRIBUTION-UNAVAILABLE` (exit 2) when attribution cannot be computed; `plan register` then warns and keeps the saved table.
`calibration.json` gains `samples_by_source` (`ledger`, `recovered`, `both`). Because of this, these numbers can change: sample
costs and models, sample counts, and the cells and classes built from them.

**Task cost in the report.** `report` uses the same task cost: every dispatch attributed to the task, counted once, at
current prices. It counts a dispatch only when its start is known and before the report's effective end
(`min(--until, --cutoff or now)`), and then at its current lifetime cost, so a past report can change when such a dispatch
grows or is re-attributed (`policy.task_cost` says so). Shares are computed over all runs before `--plan`. Each item carries
`cost_usd`, `cost_source` (`ledger`, `recovered`, `both` or null), `cost_gaps` and `cost_band`; the envelope carries
`cost_basis` (`c1`), `prices_as_of` and `estimate_bands`. When attribution is unavailable or prices are invalid, the report
keeps the hook-time costs: `cost_basis: "hook"`, `cost_fallback: {code, reason}`, one caveat, exit 0. Any other error is
`INTERNAL` (exit 1), in `calibrate` and `status` too. Dollar estimates are judged as effort bands against the current
calibration's `class_bounds_usd`: an estimate's band is its calibrated p50 (`low`), another range's midpoint or a point's
value; the actual's band is the task cost (bounds inclusive). The headline is same / one off / two or more off, with an
estimated × actual table; the dollar ratio, MdMRE and "within dollar range" stay as detail under `## Cost`. Bands are
suppressed, with one reason, on `fallback`, `no-calibration`, `unreadable`, `too-few-samples` or `invalid-bounds`; a
calibration priced on another date adds a caveat. The Cost section also shows planner size × actual band (from 5 done tasks
with a size and a usable cost) and per plan: cost of tasks done in the window, done tasks without a usable cost, and the
cost of all the plan's tasks. `spend` and every other output keep their numbers.

**Who does what.** The ledger is the record of mission state; neither memory layer (per-role memory, shared knowledge) nor a
work board replaces it. The project manager records every merge, landing, cancellation, block/unblock and defect/fix at the
moment it happens, or the orchestrating session when no project manager runs; pass `--at` when recording later (a defect's
found time defaults to now and decides whether it escaped and how long it took to fix). Work that landed no commit is recorded without `--sha`, never with
another commit's sha. Read `delivery.mjs report` at mission close, before the next mission is planned.
A defect goes on the item that caused it (a mission, campaign or case ref when the cause is not traced to a task), with
`--found-stage build|review|qa|gate|demo|user`; the report's DORA block reads these pairs (`references/metrics.md`, "DORA").

**Lifecycle rules.** Bind before dispatching to record task cycle time. Transcript recovery preserves usage and start evidence
in the dispatch store; it does not create task observations. Git/PR backfill gives created/first-commit/done only.
At campaign close, after the last landing, run
`delivery.mjs plan close <run>`; an open plan keeps admitting hook dispatches and makes every unpinned command ambiguous.
`status`/`report` say so when every item of an open plan is done or cancelled. `install-hooks.mjs --doctor` prints
`this session: … unbound` when the session will not attribute dispatches to the plan; available transcripts are still captured.

**One task per subagent.** The hook attributes a subagent to the task named in its first brief. An agent that is messaged its
next task keeps billing that task's time to the first one; the hook flags it as a `task-crossing` diagnostic and does not
re-attribute it. The agent's `dispatch_ended` record lists the other tasks (`meta.agent.crossed`, their item ids), and the
task of the first brief and every listed task are left out of calibration and cost accuracy. Not caught: a follow-up that does
not name the task's ref, a task owned by another role when the agent's role owns tasks, and an agent whose transcript never
completed. The report's `agents:` line (`coverage.dispatch_agents`) shows how many agents were resumed or compacted and the
share of their turns above 500k context.

Plans may carry `branch_prefix` and `branch_map` (`[{pattern, ref}]`, regex with named groups → ref template, e.g.
`{"pattern": "-m(?<m>\\d+)-t(?<t>\\d+)$", "ref": "T{m}.{t}"}`) so branches like `feat/x-m1-t4` map to items without per-task aliases
(`references/plan-block.md`). Use **one** backfill mode per run: `--git` and `--pr` stamp the same merge with different clocks.

Contracts: `references/event-model.md`, `references/plan-block.md`, `references/metrics.md`, `references/spike-1.md`.
