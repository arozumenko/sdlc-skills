---
name: tokenomics
description: Optional always-on usage telemetry for agent teams — hooks capture every session's tokens, cost, time, activity and named case ids into a git-committed ledger (.agents/telemetry/), covering Claude Code, Copilot CLI AND the VS Code Copilot sidebar, so the data survives transcript expiry and accumulates across the whole team; a report joins it with the pipeline's own report.json receipts to answer how much automating each batch of cases cost. Use when the user wants continuous/team-wide usage tracking, "enable telemetry", cost-per-case over time, a team usage report, or a local OTel sink/doctor; for a one-off deep audit of live transcripts use efficiency-audit instead.
license: Apache-2.0
compatibility: "Requires Node 18+. Captures on Claude Code (SessionEnd hook + start-time sweep), GitHub Copilot CLI (sessionStart sweep), and the VS Code Copilot sidebar (folderOpen auto-task); other hosts run the capture script's --sweep manually, from CI, or via the optional git post-commit hook. Per-host detail: § How capture works on each host."
metadata:
  authors:
    - Alexander Bychinskiy
  version: "0.1.0"
---

# Tokenomics — durable team usage telemetry

The [`efficiency-audit`](../efficiency-audit/) skill answers "what did this
cost" by reading **live transcripts** — precise, but transcripts expire
(~30 days) and live on each engineer's machine, so the answer is only available
to whoever runs it, soon enough, where the work happened.

This skill closes that gap with a **capture layer**: an optionally-enabled hook
that writes one JSON line per finished session into a **git-committed ledger**
(`.agents/telemetry/usage-<user>.jsonl`). Ledger lines are grounded in the same
sources efficiency-audit trusts (transcript token records, ccusage dollars,
Copilot's billed credits) but are captured **at the moment they exist** — so the
team's usage history survives transcript cleanup and accumulates through
ordinary git push/pull. A report script then answers: *how much time, tokens
and money did the team spend, and how many cases did it automate.*

**Installing this skill does NOT start capturing.** Telemetry activates only
when someone runs the install script below — that's the opt-in.

## Quick start

```bash
# 1. Enable capture in this repo (all three hosts; idempotent; --remove undoes it)
node .claude/skills/tokenomics/scripts/install-hooks.mjs            # Claude-installed copy
node .github/skills/tokenomics/scripts/install-hooks.mjs            # Copilot-installed copy
#    --host claude|copilot|vscode   wire one host only (default all: Claude hooks,
#                                   Copilot hooks file, VS Code folderOpen task —
#                                   VS Code asks once per folder to allow auto-tasks)
#    --local       Claude only: settings.local.json (just you, not the team)
#    --git-hook    optional belt-and-braces: a background post-commit sweep
#    --doctor      health-check wiring, stores, ccusage, OTel flow (--fix starts the sink)
#    --otel [--endpoint URL]   opt into OpenTelemetry (see below); --otel-remove undoes

# 2. Backfill what's still on this machine (optional, one-time)
node .claude/skills/tokenomics/hooks/telemetry-capture.mjs --sweep --all

# 3. Commit the ledger like any artifact; every engineer's lines merge cleanly
#    (one file per user — no merge conflicts by construction)

# 4. The report — one repo or several, a window, markdown or JSON
node .claude/skills/tokenomics/scripts/team-report.mjs
node .claude/skills/tokenomics/scripts/team-report.mjs ~/work/repoA ~/work/repoB --since 2026-08-01 --json
node .claude/skills/tokenomics/scripts/team-report.mjs --role qa-engineer   # sessions involving that agent

# 5. Per-batch cost — what a batch delivered and what it cost, per case
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug>            # markdown
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug> --html --out batch.html
node .claude/skills/tokenomics/scripts/team-report.mjs --batches                 # every batch with a receipt

# 6. Cross-factory export (optional) — one dataset row per batch
#    identity comes from .agents/telemetry/factory-profile.json (copy
#    templates/factory-profile.template.json there and fill it in once)
node .claude/skills/tokenomics/scripts/build-tokenomics-export.mjs --batch <slug>
node .claude/skills/tokenomics/scripts/build-tokenomics-export.mjs --compare a/cost.json b/cost.json
```

**Per-batch cost.json (automatic).** Once capture is enabled, every session end
also refreshes `.agents/automation/<slug>/cost.json` for each batch the ledger
can see — a pure recompute joining ledger lines to the pipeline's own
`report.json` receipt (matching the receipt's case ids/branches against each
dispatch's label, so any id shape works). Per-case rows carry **direct,
measured** work only — the case's own analyst/implement/review/fix/merge
dispatches, with a cluster dispatch split evenly across its ids; batch-level
work (lead thread, triage, gate, report) is **overhead, shown once**, never
smeared. avg/median/min/max run over measured values only. Per-dispatch
dollars exist on Claude (per-file metering); Copilot bills one figure per
session, so its per-case rows carry tokens/time and dollars appear at batch
level from billed credits — the report labels which is which.

After step 1, capture is automatic. Claude Code sessions are captured when they
end AND swept at every session start (async, injects nothing) — so a session
whose terminal was killed is harvested the next time anyone opens the repo.
Copilot only has the start hook (no session-end event exists), so its completed
sessions are always harvested by the next session's start; a running session is
never captured. `--role` filters at REPORT time on purpose — capture keeps
everything, because a session filtered at capture would be gone for good once
its transcript expires. (With `--role`, the $/delivered-case ratio is
suppressed — receipts aren't attributable to one role.)

## How capture works on each host

- **Claude Code** — a SessionEnd hook captures each ending session (dollars
  metered by ccusage at capture time, best-effort via npx) plus a SessionStart
  async sweep for sessions that never reached their end hook.
- **GitHub Copilot CLI** — a sessionStart hook sweeps completed sessions from
  `~/.copilot/session-state` (dollars from Copilot's own billed
  `totalNanoAiu`; role from `subagent.selected` on CLI ≥1.0.63).
- **VS Code Copilot sidebar** — a folderOpen auto-task sweeps VS Code's
  workspaceStorage chatSessions op-logs (dollars from `copilotCredits` on
  extension ≥0.57.0).
- **Other hosts** — run the capture script's `--sweep` manually, from CI, or
  via the optional git post-commit hook.

## What a ledger line holds

One line per session (host `claude`, `copilot`, or `copilot-vscode`), all
facts, no estimates:

| field | meaning |
|---|---|
| `id`, `host`, `user`, `repo`, `branch`, `role` | who/where; `role` from the session's agent setting — on Copilot from the `subagent.selected` event (CLI ≥1.0.63; older streams lack it → `null`) |
| `startedAt/endedAt`, `wallMin`, `activeMin` | wall span + active minutes (gaps >30 min excluded), sub-agents included |
| `tokens` | parent session's input/output/cache-read/cache-write (ccusage's max-per-message-id dedup rule) |
| `subagents[]` | per-role rollup of dispatched sub-agents: count, tokens, minutes, tool calls |
| `costUsd`, `costSource` | a **real** figure or `null` — `ccusage-metered` (Claude, metered at capture), `copilot-nano-aiu` (GitHub's billed credits, 1 credit = $0.01), or `copilot-credits` (the sidebar's billed field, extension ≥0.57.0). Never a price-table estimate. |
| `cases[]`, `title` | case ids (Jira-style keys) mined from branches, dispatch labels, prompts and session titles — **ids only, never the surrounding text**, so this is always on; `title` is VS Code's own session name |
| `turns`, `toolCalls`, `toolErrors`, `skills`, `dispatches` | activity metrics |
| `prompts[]`, `dispatched[]` | **only when `capturePrompts` is on** — user prompts truncated to 200 chars + dispatch descriptions |

## Config — `.agents/telemetry/config.json`

```json
{ "capturePrompts": false, "priceAtCapture": true, "maxSweep": 10,
  "vscodeUserDataDirs": [], "otel": null }
```

- `capturePrompts` — **off by default.** Turning it on commits (truncated) user
  prompt text to the repo; decide as a team, mind client-data rules.
- `priceAtCapture` — Claude only: meter the session with `npx ccusage` when it
  ends (adds seconds to the hook; on failure the line says `costUsd: null`,
  never a guess). `TOKENOMICS_NO_CCUSAGE=1` disables it too.
- `maxSweep` — new sessions harvested per hook run; the rest wait for the next
  run (a first sweep can face a month of history — `--sweep --all` does it in
  one go, run that manually).
- `vscodeUserDataDirs` — extra VS Code user-data or `workspaceStorage` dirs
  for portable-mode / `--user-data-dir` installs the discovery matrix can't see.
- `otel` — written by `install-hooks.mjs --otel`; when `enabled` with a
  localhost endpoint, every capture moment also keeps the bundled stdlib
  OTLP sink (`hooks/otel-sink.mjs`) alive. `scripts/otel-report.mjs`
  summarizes what the sink received (inspection only — OTel lines are never
  merged into the ledger; see `references/otel-roadmap.md` for why and for
  the emitter switches).

## The report

`team-report.mjs` merges every `usage-*.jsonl` it finds (repo roots, telemetry
dirs, or files; several roots = several repos in one rollup), dedupes re-captured
sessions (latest wins), and prints totals, by-person, by-role, by-week —
tokens, real dollars with provenance, active/wall hours, tool calls.

**Cases come from receipts, not guesswork:** it reads the pipeline's own
`.agents/automation/*/report.json` (`cases[]` with `id` + `outcome`, latest
outcome per case wins, delivered = `automated`) and derives **$ and active
minutes per delivered case**. Analysis/review/fix rounds live in those receipts
and in the batch's board — the ledger adds who paid for them and how long they
took. Sessions with no real dollar are counted and labelled tokens-only; they
are never priced by estimate.

## Caveats — read once

- **A hard-killed Claude session** misses its SessionEnd; the next capture's
  sweep picks it up from disk (bounded by transcript retention).
- **A continued session updates its line — on every host.** A session that
  spends more after its first capture (resumed, `--continue`d, or simply
  ended again with more context and tool calls) is re-captured once its
  source file grows past the recorded end: SessionEnd firing again appends a
  superseding line directly, and the sweep re-checks known sessions for
  growth (never appending unless the parsed end actually advanced). The
  report's latest-wins dedup keeps the final line, so totals follow the
  session's whole life, not its first snapshot.
- **Forked sessions** (a NEW session id replaying the parent's records) are
  the remaining caveat: the fork's line can double-count replayed tokens.
  The ledger's grain is honest-per-session, not forensically deduped across
  forks — efficiency-audit on live transcripts is the precision tool while
  they exist.
- **Copilot parent-session roles need CLI ≥1.0.63** (the `subagent.selected`
  event, verified live). Sessions from older CLIs carry `role: null` —
  attribute those by user/branch, or by their named sub-agent roles.
- **Nothing uploads anywhere.** The ledger is files in your repo; accumulation
  is git. If the org later wants Langfuse/OTel dashboards, export the JSONL —
  the format is sink-agnostic by design.
- **VS Code sidebar sessions have no completion marker** — a session captured
  mid-life is re-captured via the same growth rule as above. Files from
  extensions <0.57.0 carry tokens but no `copilotCredits` → honest
  tokens-only lines.
  The sweep searches every VS Code variant/OS location (the discovery matrix
  in [`references/otel-roadmap.md`](references/otel-roadmap.md)); Windows and
  WSL/`vscode-server` paths are designed in but still need one live
  verification on such a machine.

## Division of labour

- **tokenomics** (this skill) — continuous capture + team/period report from
  the durable ledger.
- **[`efficiency-audit`](../efficiency-audit/)** — deep one-off audit of live
  transcripts: per-sub-agent metered dollars, cache-hit rates, before/after
  comparisons. Use it while transcripts are alive; use the ledger after.
- **`session-retrospective`** — mines session *content* for lessons, not cost.
