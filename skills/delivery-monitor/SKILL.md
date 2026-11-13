---
name: delivery-monitor
description: Delivery monitor for harness work items — the cycle-time and cadence sibling of tokenomics. Registers a plan (campaign → mission → task) with ranged, human-accepted estimates, records dispatch/merge/cancel transitions into a git-committed event ledger (.agents/telemetry/delivery/), backfills history from git, and reports cycle time, weekly throughput/velocity and estimate-vs-actual delta per level. Use when the user asks "how fast are we delivering", "register the plan / estimates", "record that TASK-023 merged", "delivery report / status", "enable delivery tracking", or "how good were our estimates". For cost per case use tokenomics; for sizing new work use automation-scoping.
license: Apache-2.0
compatibility: "Requires Node 18+ and git. Automatic dispatch capture on Claude Code only (SubagentStop hook, opt-in via scripts/install-hooks.mjs); every other host records transitions with the CLI and the git backfill."
metadata:
  authors:
    - Daniel Sallai <daniel_sallai@epam.com>
  version: "0.4.0"
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
# 2. The orchestrating session must be bound before it dispatches: the hook records dispatches only for a bound session (or one
#    whose branch maps to exactly one item of exactly one open run). A session that did not register the plan binds itself:
node .claude/skills/delivery-monitor/scripts/delivery.mjs session set sec/run-1     # host/session default to CLAUDE_CODE_SESSION_ID
#    Record transitions as they happen. A hook dispatch credited to the wrong item is withdrawn, then re-recorded:
node .claude/skills/delivery-monitor/scripts/delivery.mjs retract --agent <agent id> --plan sec/run-1 [--dry-run]   # or --observation <id>
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-monitor/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
node .claude/skills/delivery-monitor/scripts/delivery.mjs event INFRA-2 done --id done-infra-2    # landed no commit (infra, QA run, gate): no --sha, stamped now
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --git --plan sec/run-1 --head <sha>
#    GitHub-merged work (squash/merge-commit PRs, task PRs into a mission branch): read merged PRs via gh, or offline from JSON
node .claude/skills/delivery-monitor/scripts/delivery.mjs backfill --pr --plan sec/run-1 [--from-json prs.json] [--since <iso>] [--dry-run]
# 4. Optional: automatic dispatch start/end on Claude Code (+ shared telemetry submodule)
node .claude/skills/delivery-monitor/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-monitor/scripts/delivery.mjs status
node .claude/skills/delivery-monitor/scripts/delivery.mjs report [--json] [--html] [--from-json <f>] [--since 2026-09-01] [--level task] [--class M]
node .claude/skills/delivery-monitor/scripts/delivery.mjs report --html --out delivery.html
# 6. At plan close: rebuild the effort calibration the next plan is estimated from
node .claude/skills/delivery-monitor/scripts/delivery.mjs calibrate [--dry-run] [--json] [--half-life 42]
```

**Effort calibration (estimate → actual → calibrate).** On Claude Code the dispatch hook prices every finished subagent's tokens
per model (`references/prices.json`; a project `.agents/telemetry/delivery/prices.json` overrides it) and records the dollar cost
on `dispatch_ended`. A task's effort is its share of all its dispatches, fix rounds included. A task is left out of calibration and
of cost accuracy when the ledger shows a gap in its cost: one of its dispatches has no cost or an unpriced model; one of its
hooked dispatches never ended; a resumed agent's follow-up message named another task (the task of the first brief and every
task named are left out); or its earliest hooked dispatch is classified `review` or `fix` (the build is assumed to have run
where the hook did not record it). These checks catch only gaps the ledger shows: work that ran outside the hook after a hooked
build is not seen. `calibrate` prints how many landed tasks it left out and why (`LEFT-OUT …`); the full list of reasons is
in `references/plan-block.md`, "Calibrated estimates". `calibrate` turns the remaining landed tasks into
`.agents/telemetry/delivery/calibration.json`: per cell (`role|type|novel`, then coarser, then `all`) the p50/p80 cost, the
return rate (rework, review returned, reopened) and per-model figures, recency-weighted (half-life 42 days), with effort
classes E1–E4 learned from the cost quartiles. `plan register` fills every task the plan leaves unestimated with the cell's
p50–p80 as a `usd` range (`tier: calibrated`, auto-accepted by `calibrate (auto)`) and its effort class; `--no-calibrate` stops
new fills (a re-cut keeps earlier ones). `plan register` stops with `CALIBRATION-INVALID` (exit 2) when
`calibration.json` exists but cannot be read or parsed, or has a malformed cell or a wrong `v`, `unit` or `min_n`.
`calibrate` stops with `PRICES-INVALID` (exit 2) when the built-in price table or the project override cannot be read or has
an invalid model entry. No other command reports a broken price table: until `calibrate` runs, the hook marks each dispatch
unpriced (`<prices-unreadable>`) and `report` shows those tasks only as `missing_actual`. An override entry replaces a
built-in model whole, so it needs all four rates (`input`, `output`, `cache_write`, `cache_read`); it may price a
`<model>#fast` id itself, otherwise fast mode is the base model at double every rate. `calibrate` says `NO-EVENTS` until a
landed task has a complete measured cost, and says how many it left out. `report` scores those ranges against measured cost in `usd:` strata. Cells need 5 samples, classes 12.

**Who does what.** The ledger is the record of mission state; neither memory layer (per-role memory, shared knowledge) nor a
work board replaces it. The project manager records every merge, landing and cancellation at the moment it happens, or the
orchestrating session when no project manager runs. Work that landed no commit is recorded without `--sha`, never with
another commit's sha. Read `delivery.mjs report` at mission close, before the next mission is planned.

**Lifecycle rules.** Dispatch starts cannot be recovered after the fact: a plan registered (or a session bound) after the work
ran has no cycle time for it — backfill gives created/first-commit/done only. At campaign close, after the last landing, run
`delivery.mjs plan close <run>`; an open plan keeps admitting hook dispatches and makes every unpinned command ambiguous.
`status`/`report` say so when every item of an open plan is done or cancelled. `install-hooks.mjs --doctor` prints
`this session: … unbound` when the session you are in will record nothing.

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
Design (in the sdlc-skills repo): `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.
