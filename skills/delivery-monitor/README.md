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
# 2. The orchestrating session must be bound before it dispatches: the hook records dispatches only for a bound session (or one
#    whose branch maps to exactly one item of exactly one open run). A session that did not register the plan binds itself:
node .claude/skills/delivery-monitor/scripts/delivery.mjs session set sec/run-1     # host/session default to CLAUDE_CODE_SESSION_ID
#    Record transitions as they happen. A hook dispatch credited to the wrong item is withdrawn with `retract`. Its cost cannot be
#    moved (`event` cannot write `dispatch_ended`): the right item's cost then lacks it and is not flagged incomplete. Give that item
#    `event <ref> dispatched --at <iso>` only if it has no dispatched record yet:
node .claude/skills/delivery-monitor/scripts/delivery.mjs retract --agent <agent id> --plan sec/run-1 [--dry-run]   # or --observation <id>
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-monitor/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
node .claude/skills/delivery-monitor/scripts/delivery.mjs event INFRA-2 done --id done-infra-2    # landed no commit (infra, QA run, gate): no --sha, stamped now
#    Cannot proceed until something else happens (another project, a human ruling, a dependency, a technical blocker routed
#    to someone else) — what it waits on goes in --note — and resumes:
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 blocked --id blk-023-1 --note "waits on API team"
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 unblocked --id unblk-023-1
#    A bug filed in your tracker, traced to the item that caused it (free-form id), and its fix landing:
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 defect_found --defect BUG-7 --found-stage qa [--severity major] [--found-by <who>]
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 defect_fixed --defect BUG-7 [--sha <fix merge sha>]
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --git --plan sec/run-1 --head <sha>
# 4. Optional: automatic dispatch start/end on Claude Code (+ shared telemetry submodule)
node .claude/skills/delivery-monitor/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-monitor/scripts/delivery.mjs status
node .claude/skills/delivery-monitor/scripts/delivery.mjs report [--json] [--html] [--from-json <f>] [--since 2026-09-01] [--level task] [--class M]
node .claude/skills/delivery-monitor/scripts/delivery.mjs report --html --out delivery.html
```

Contracts: `references/event-model.md`, `references/plan-block.md`, `references/metrics.md`, `references/spike-1.md`.
Design (in the sdlc-skills repo): `docs/superpowers/specs/2026-09-16-delivery-monitor-design.md`.

## Telemetry mode

`.agents/telemetry/` is a shared submodule (branch `telemetry`) `install-hooks.mjs` bootstraps —
one `delivery/` subfolder alongside `tokenomics`' `automation/`, committed and pushed
best-effort on every mutation (`DELIVERY_NO_SYNC=1` disables sync for local/offline use). Until
that bootstrap has run (neither skill has wired it yet), records ride the main tree as a **plain
directory** instead — fully usable, just not yet split into its own history/push cadence.
`delivery.mjs doctor` and `install-hooks.mjs --doctor` report which mode is active
(`telemetry: submodule` vs `telemetry: plain-dir`); `install-hooks.mjs --no-submodule` keeps
plain-dir mode explicitly; `--remove` unwires the hook and ignore blocks without touching ledger
data.

## Roster

`plan register` snapshots which installed agents are eligible to attribute dispatches to this
run: the default roster is the **installed roles intersected with this skill's shipped
factory→role map** (`references/factory-roles.json`) for the plan's own `factory`. A run whose
work spans more than one factory supplies `--factories feature-development,test-automation` at
registration (or later via `plan roster --plan <run> --agents <installed union>`) to widen that
intersection. `--roster`/`plan roster --agents` must equal the computed union exactly — they
assert it, they don't set it arbitrarily; an unknown factory or a role outside every named
factory's map fails `USAGE`. The Claude hook reads this saved, already-validated roster snapshot
only — it never re-walks installed agent directories or any source-checkout manifest itself.

The map covers `feature-development`, `test-automation` and `manual-qa`. A plan from
`product-management` or `security-testing` registers and prints `WARN ROSTER-UNMAPPED(<factory>)`:
its roster holds none of that factory's roles, so the hook records no dispatch of its agents and
the budget guard does not check them. Record such a plan's transitions with the CLI or a backfill;
`doctor` repeats the note on the run's `roster:` line.

A plan whose mapped factories have no agent installed in the project registers and prints
`WARN ROSTER-EMPTY`: with an empty roster the hook records no dispatch and the budget guard
checks none. Install the agents, then refresh the roster with `plan roster --plan <run> --agents …`.

## What it does not do

This is an honest derivation from readable, local evidence — not a durability,
authenticity or completeness guarantee. Every limitation below is surfaced in
the report/status output where it applies, never silently dropped.

- No atomic registration, multi-event correction or plan/index update, crash
  durability, torn-tail recovery, exact-once writes, or cross-writer/subprocess
  locking — concurrency and sync are best-effort; conflicts and gaps are
  counted and surfaced, never silently repaired.
- No concurrent shared-file preservation or causal merge resolution — shared
  files are last-writer-wins.
- No coherent cost snapshot, verified producer compatibility, or complete
  provenance; no accounting-window containment guarantee (parent/shared
  minutes stay labeled `window: unverified`).
- No general association history or automatic identity recovery — no guessed
  joins between sessions, dispatches and work items.
- No custom estimate actuals or authenticated human acceptance beyond the
  fixed estimate/acceptance definition in `references/plan-block.md`.
- No revision-fork repair or atomic withdrawal/reinstatement of events — only
  ordinary forward correction.
- No claim of host completeness, full review/block history, origin tracking,
  or cross-team comparability.
- No DORA measures. The report's "DORA (task-level proxies)" block holds proxies
  and labels them: change failure rate is computed from defects found after a
  task was done, and time to restore from defect repair time (nothing recorded →
  the report says so, never 0%); deployment frequency and lead time for changes
  reuse task throughput and cycle time — a merge to the integration branch, not
  a production deploy.
- No spending limit. The task budget is a best-effort budget guard, not a
  ceiling. It fails open when it cannot read its evidence. It counts subagent
  dispatches only, not the orchestrating session. Two subagents working on the
  same task at the same time do not see each other's live spend. A refused tool
  call is not verified on a real host to end all spending.
- No cost of the orchestrating session. Spend totals and task costs cover
  subagent dispatches only. Flow
  efficiency (agent time ÷ cycle time) is a lower bound; time blocked counts
  only recorded blocks.
- Out of scope entirely: benefit ROI,
  per-person/per-agent productivity, dashboards/uploads/OTel, story-point
  velocity, time-in-status heatmaps, forecasting/Monte Carlo, and Little's
  Law. Manual-qa native wiring, automatic run inference, and Cursor/Kiro/Codex
  hooks are not built. Copilot automatic delivery capture and live pending
  starts, raw tokenomics folding, and feature-task attribution are parked for
  a later milestone.
- Cost per case: use `tokenomics`. Sizing new work: use `automation-scoping`.

## Previewing the HTML page while changing the renderer

`report --html` is a self-contained page; render it against a fixture ledger (or an archived
`report --json`) and look at it before shipping a layout change — the unit tests pin content, not
geometry. Headless Chrome/Edge takes a screenshot without any dependency:

```bash
node .claude/skills/delivery-monitor/scripts/delivery.mjs report --from-json delivery.json --html > delivery.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1440,1700 --screenshot=delivery.png "file://$PWD/delivery.html"   # repeat at 1100 for narrow screens
```
