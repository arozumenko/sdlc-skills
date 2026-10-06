---
name: delivery-monitor
description: Delivery monitor for harness work items — the cycle-time and cadence sibling of tokenomics. Registers a plan (campaign → mission → task) with ranged, human-accepted estimates, records dispatch/merge/cancel transitions into a git-committed event ledger (.agents/telemetry/delivery/), backfills history from git, and reports cycle time, weekly throughput/velocity and estimate-vs-actual delta per level. Use when the user asks "how fast are we delivering", "register the plan / estimates", "record that TASK-023 merged", "delivery report / status", "enable delivery tracking", or "how good were our estimates". For cost per case use tokenomics; for sizing new work use automation-scoping.
license: Apache-2.0
compatibility: "Requires Node 18+ and git. Automatic dispatch capture on Claude Code only (SubagentStop hook, opt-in via scripts/install-hooks.mjs); every other host records transitions with the CLI and the git backfill."
metadata:
  authors:
    - Daniel Sallai <daniel_sallai@epam.com>
  version: "0.2.0"
---

# delivery-monitor — cycle time, cadence, estimate vs actual

`tokenomics` answers *what did it cost*; this skill answers *how long did it
take and how did that compare with what we said*. It never estimates, never
defaults a missing number, and labels every proxy as a proxy.

## Quick start

```bash
# 1. Register the plan (the tech-lead's plan file carries a ```json delivery-plan block)
node .claude/skills/delivery-monitor/scripts/delivery.mjs plan register --from docs/superpowers/plans/<plan>.md --id reg-1
# 2. Record transitions as they happen. The hook binds a session to a run by itself when the working branch maps to exactly one
#    item of exactly one open run (alias, title token or plan `branch_map`); `session set` is the manual override for ambiguity.
node .claude/skills/delivery-monitor/scripts/delivery.mjs session set --host claude --session <id> --plan sec/run-1   # optional
node .claude/skills/delivery-monitor/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-monitor/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
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
```

Plans may carry `branch_prefix` and `branch_map` (`[{pattern, ref}]`, regex with named groups → ref template, e.g.
`{"pattern": "-m(?<m>\\d+)-t(?<t>\\d+)$", "ref": "T{m}.{t}"}`) so branches like `feat/x-m1-t4` map to items without per-task aliases
(`references/plan-block.md`). Use **one** backfill mode per run: `--git` and `--pr` stamp the same merge with different clocks.

Contracts: `references/event-model.md`, `references/plan-block.md`, `references/metrics.md`, `references/spike-1.md`.
Design (in the sdlc-skills repo): `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.
