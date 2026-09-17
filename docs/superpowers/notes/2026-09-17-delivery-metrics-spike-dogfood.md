# delivery-metrics — live dogfood spike (2026-09-17)

**Question.** Does the M1 Slice 1 capability hold up on a fresh consumer project through the *live*
operator path (install → register plan → hook-captured dispatches → CLI events → git backfill →
report), not just the golden replay of git history?

**Probe.** Throwaway repo `todo-app` (stdlib Node todo store + CLI). Installed the
`feature-development` factory from this branch with `bin/init.mjs`, enabled tracking with
`install-hooks.mjs` (telemetry submodule bootstrapped, no remote). Plan: campaign `todo/run-1`, missions
G1/G2, tasks TASK-001..004 with ranged `h` estimates accepted by a named human (TASK-004 left
unaccepted on purpose; TASK-002 given a deliberately wrong [1, 2]h range). Two headless
`claude -p --session-id …` tech-lead sessions, each bound with `session set`, dispatched the installed
`js-dev`/`qa-engineer` subagents per task, merged `--no-ff`, recorded `done` per task and mission via the
CLI; then `backfill --git`, `doctor`, `status`, `report`.

**Result.** Works end to end. Plan registered from the markdown block unchanged; all four `SubagentStop`
hooks attributed to the right task with the right role, zero diagnostics; CLI `done` and git `done`
agreed (0 conflicts); doctor `ok`; ledger synced to the `telemetry` branch after every write. Final
report: task `cycle_time n=4` (observed), mission/campaign actuals `derived-child`, estimate table with
ratio/hit per item, TASK-004 excluded as `unaccepted`, TASK-002 ratio 0.016, schedule variance per
mission/campaign, `unattributed_share 0%`.

**Findings fixed on the branch (same day).**

| # | Finding | Fix |
|---|---|---|
| S1 | `install-hooks.mjs` wrote the hook command with the resolved absolute project path; tokenomics writes `${CLAUDE_PROJECT_DIR}/<rel>`. A cloned or moved checkout would keep a dangling hook. | Same shape as tokenomics; test asserts the prefix. |
| S2 | `classifyStage` scanned the whole first user message in list order, so an implementation prompt containing "do not merge into main" was labelled `merge` — not a start stage — and every task lost its measured `cycle_time` (`missing_start=4`, estimate rows `missing_actual`). Final-review minor #8 had deferred this as cosmetic; it is load-bearing. | Earliest match in the text wins. Re-feeding the four real payloads produced `rev1` observations with `build` (no duplicates) and the report filled in. Documented in `references/event-model.md`. |

**Observed, not changed.** Flow-time figures print in hours to two decimals; sub-minute agent work
shows as `0.02h` — a minutes column would read better for harness-speed tasks (M2 report polish).
`(dirty)` on the report sha was legitimate: the js-dev memory skill leaves `.agents/memory/js-dev/`
untracked. Throughput weeks flagged `†before declared coverage` because the ISO week began before
`observation_start` — correct labelling.

Evidence (session scratchpad, not committed): the throwaway repo, both `claude -p` JSON results,
`final-report.{md,json}`.
