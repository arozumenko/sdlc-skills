---
name: delivery-metrics
description: Delivery performance tracker for harness work items — the cycle-time and cadence sibling of tokenomics. Registers a plan (campaign → mission → task) with ranged, human-accepted estimates, records dispatch/merge/cancel transitions into a git-committed event ledger (.agents/telemetry/delivery/), backfills history from git, and reports cycle time, weekly throughput/velocity and estimate-vs-actual delta per level. Use when the user asks "how fast are we delivering", "register the plan / estimates", "record that TASK-023 merged", "delivery report / status", "enable delivery tracking", or "how good were our estimates". For cost per case use tokenomics; for sizing new work use automation-scoping.
license: Apache-2.0
compatibility: "Requires Node 18+ and git. Automatic dispatch capture on Claude Code only (SubagentStop hook, opt-in via scripts/install-hooks.mjs); every other host records transitions with the CLI and the git backfill."
metadata:
  authors:
    - Daniel Sallai <daniel_sallai@epam.com>
  version: "0.1.0"
---

# delivery-metrics — cycle time, cadence, estimate vs actual

`tokenomics` answers *what did it cost*; this skill answers *how long did it
take and how did that compare with what we said*. It never estimates, never
defaults a missing number, and labels every proxy as a proxy.

## Quick start

```bash
# 1. Register the plan (the tech-lead's plan file carries a ```json delivery-plan block)
node .claude/skills/delivery-metrics/scripts/delivery.mjs plan register --from docs/superpowers/plans/<plan>.md --id reg-1
# 2. Bind this session (lets the hook attribute dispatches) and record transitions as they happen
node .claude/skills/delivery-metrics/scripts/delivery.mjs session set --host claude --session <id> --plan sec/run-1
node .claude/skills/delivery-metrics/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-metrics/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-metrics/scripts/delivery.mjs backfill --git --plan sec/run-1 --head <sha>
# 4. Optional: automatic dispatch start/end on Claude Code (+ shared telemetry submodule)
node .claude/skills/delivery-metrics/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-metrics/scripts/delivery.mjs status
node .claude/skills/delivery-metrics/scripts/delivery.mjs report [--json] [--since 2026-09-01] [--level task] [--class M]
```

Contracts: `references/event-model.md`, `references/plan-block.md`, `references/metrics.md`, `references/spike-1.md`.
Design (in the sdlc-skills repo): `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.
