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
Design: `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.

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
- Out of scope entirely: DORA metrics, flow efficiency, benefit ROI,
  per-person/per-agent productivity, dashboards/uploads/OTel, story-point
  velocity, time-in-status heatmaps, forecasting/Monte Carlo, and Little's
  Law. Manual-qa native wiring, automatic run inference, and Cursor/Kiro/Codex
  hooks are not built. Copilot automatic delivery capture and live pending
  starts, raw tokenomics folding, and feature-task attribution are parked for
  a later milestone.
- Cost per case: use `tokenomics`. Sizing new work: use `automation-scoping`.
