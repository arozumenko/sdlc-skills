---
name: tokenomics
description: Optional always-on usage telemetry for agent teams — hooks capture every session's tokens, cost, time, activity and named case ids into a git-committed ledger (.agents/telemetry/automation/), covering Claude Code, Copilot CLI AND the VS Code Copilot sidebar, so the data survives transcript expiry and accumulates across the whole team; a report joins it with the pipeline's own report.json receipts to answer how much automating each batch of cases cost. Use when the user wants continuous/team-wide usage tracking, "enable telemetry", cost-per-case over time, a team usage report, or a local OTel sink/doctor; for a one-off deep audit of live transcripts use efficiency-audit instead.
license: Apache-2.0
compatibility: "Requires Node 18+. Captures on Claude Code (SessionEnd hook + start-time sweep), GitHub Copilot CLI (sessionEnd + sessionStart sweeps; older CLIs start-only), and the VS Code Copilot sidebar (folderOpen auto-task); other hosts run the capture script's --sweep manually, from CI, or via the optional git post-commit hook. Per-host detail: § How capture works on each host."
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
(`.agents/telemetry/automation/usage-<user>.jsonl`). Ledger lines are grounded in the same
sources efficiency-audit trusts (transcript token records, ccusage dollars,
Copilot's billed credits) but are captured **at the moment they exist** — so the
team's usage history survives transcript cleanup and accumulates through
ordinary git push/pull. A report script then answers: *how much time, tokens
and money did the team spend, and how many cases did it automate.*

**Installing this skill does NOT start capturing.** Telemetry activates only
when someone runs the install script below — that's the opt-in.

**Updating an old install: re-run the same script.** It is idempotent and also
migrates the flat-era layout — `usage-*.jsonl`, `scopes/`, `live/`,
`config.json` sitting at the telemetry ROOT move into `automation/`
automatically (readers look only there; un-migrated history would silently
drop out of every report). Same-named newer data in `automation/` wins —
nothing is ever clobbered.

## Quick start

```bash
# 1. Enable capture in this repo (all three hosts; idempotent; --remove undoes it)
node .claude/skills/tokenomics/scripts/install-hooks.mjs            # Claude-installed copy
node .github/skills/tokenomics/scripts/install-hooks.mjs            # Copilot-installed copy
#    --host claude|copilot|vscode   default wires Claude hooks + the Copilot hooks
#                                   file. `vscode` is OPT-IN (a folderOpen task in
#                                   shared .vscode/tasks.json; VS Code asks each
#                                   teammate once to allow auto-tasks) — every sweep
#                                   already walks the sidebar store, so it is only
#                                   needed in a SIDEBAR-ONLY repo. --remove strips
#                                   it either way.
#    --local       Claude only: settings.local.json (just you, not the team)
#    --git-hook    optional belt-and-braces: a background post-commit sweep
#    --doctor      health-check wiring, stores, ccusage, OTel flow (--fix starts the sink)
#    --otel [--endpoint URL]   opt into OpenTelemetry (see below); --otel-remove undoes

# 2. Backfill what's still on this machine (optional, one-time)
node .claude/skills/tokenomics/hooks/telemetry-capture.mjs --sweep --all

# 3. One commit to main (the installer prints it): registers the telemetry
#    submodule. From then on hooks commit+push the records to the `telemetry`
#    branch automatically — nobody hand-commits telemetry again.
#    Teammates: git clone --recurse-submodules

# 4. The report — one repo or several, a window, markdown / JSON / HTML
node .claude/skills/tokenomics/scripts/install-hooks.mjs --pull  # merge the team's pushes first
node .claude/skills/tokenomics/scripts/team-report.mjs
node .claude/skills/tokenomics/scripts/team-report.mjs ~/work/repoA ~/work/repoB --since 2026-08-01 --json
node .claude/skills/tokenomics/scripts/team-report.mjs --html --out team.html # shareable self-contained page
node .claude/skills/tokenomics/scripts/team-report.mjs --role qa-engineer   # sessions involving that agent

# 5. Per-batch cost — what a batch delivered and what it cost, per case
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug>            # markdown
node .claude/skills/tokenomics/scripts/team-report.mjs --batch <slug> --html --out batch.html
node .claude/skills/tokenomics/scripts/team-report.mjs --batches                 # every batch with a receipt

# 6. Cross-factory export (optional) — one dataset row per batch
#    identity comes from .agents/telemetry/automation/factory-profile.json (copy
#    templates/factory-profile.template.json there and fill it in once)
node .claude/skills/tokenomics/scripts/build-tokenomics-export.mjs --batch <slug>
node .claude/skills/tokenomics/scripts/build-tokenomics-export.mjs --compare a/cost.json b/cost.json
```

**Per-batch cost.json (written at close).** `work-scope.mjs close` writes
`.agents/automation/<slug>/cost.json` — a pure recompute joining ledger lines
to the pipeline's own `report.json` receipt (matching the receipt's case
ids/branches against each dispatch's label — and against the ids mined from
the dispatch's own transcript when the label window missed them — so any id
shape works). Mid-run the same numbers are always available without touching
the tree: `work-scope.mjs status`, `team-report.mjs --batch`, and the live
page under `telemetry/reports/` all recompute on the fly.
What each cost.json carries:

- **Per-case rows**: `direct` (measured — the case's own analyst/implement/
  review/fix/merge dispatches, a cluster split evenly across its ids, incl.
  tool calls/errors) and `loaded` (direct + an even share of batch overhead —
  an **allocation, labelled as such**, for cross-batch comparison).
- **Overhead shown once**, never smeared — with a **by-stage split** (lead /
  triage / gate / report) and a separate **rework** figure (fix-round spend).
- **Telemetry**: turns, tool calls/errors, skills invoked — totals, per role,
  per case.
- **Records vs receipt**: latest script-authored gate verdict
  (`gate-runs.jsonl`) + declared session outcomes, with **gateDrift /
  outcomeDrift** flags when the receipt disagrees — drift means report.json
  needs its write-back.
- **Multi-batch sessions are never double-counted**: a session serving
  several batches (a campaign running waves) has its other batches'
  dispatches EXCLUDED and its session-level figures (lead thread, unnamed
  work) split evenly across the batches it served — the report says so when
  it happens.

Stats (avg/median/min/max) run over measured values; per-dispatch dollars
exist on Claude (per-file metering); Copilot bills one figure per session, so
its per-case rows carry tokens/time and dollars appear at batch level from
billed credits — the report labels which is which.

After step 1, capture is automatic. Claude Code sessions are captured when they
end AND swept at every session start (async, injects nothing) — so a session
whose terminal was killed is harvested the next time anyone opens the repo.
Copilot captures at sessionEnd too (current CLIs; the hooks reference added the
event) with the start sweep as the safety net — an older CLI ignores the
sessionEnd entry and keeps the old next-start rhythm; a running session is
never captured. `--role` filters at REPORT time on purpose — capture keeps
everything, because a session filtered at capture would be gone for good once
its transcript expires. (With `--role`, the $/delivered-case ratio is
suppressed — receipts aren't attributable to one role.)

## Session scope — declared, not reconstructed

Mined ids answer *which cases a session mentioned*; the scope record answers
*what the session was actually for*. A tiny structured file per session at
`.agents/telemetry/automation/scopes/<session-id>.json` — written by the lead **when the
work begins**, updated **when outcomes become true**, committed like the ledger:

```bash
node .claude/skills/tokenomics/scripts/work-scope.mjs open \
  --session <id> --intent automation --batch <slug> --cases ELITEA-1,ELITEA-2
node .claude/skills/tokenomics/scripts/work-scope.mjs outcome --session <id> ELITEA-1=automated
node .claude/skills/tokenomics/scripts/work-scope.mjs close --session <id>
# close ALSO renders <batch dir>/batch-report.md (cost.json recompute) and
# prints receipt-vs-records DRIFT while the lead can still fix report.json.
# a session that is NOT automation/testing work: open --intent other (asked once, never again)
```

**`intent` is an open string — label honestly, don't collapse into "other".**
Suggested vocabulary (not enforced; a project or another bundle may add its
own): `automation`, `manual-testing`, `investigation`, `framework`,
`onboarding`, `docs`, `other`. Only **`automation`** feeds the cost-per-case
figures — every other label simply reports its own spend, so a session that
was really a bug hunt stops inflating "$ per automated case". Ids are opaque
(any TMS shape) and the `outcomes` vocabulary is open too — the manual-qa
bundle can adopt the identical record.

**Enforcement (both hosts, wired by `install-hooks.mjs`):** the same three
moments on each. Session start injects one line carrying the session id + the
ask (or the existing scope's digest, so a batch survives `/clear`/compaction);
a per-dispatch hook marks "this session dispatched work"; a **stop gate**
blocks the turn end **once** if work was dispatched with no declared scope.
On Claude that is SessionStart / PreToolUse `Agent|Workflow` / Stop; on
Copilot CLI it is `sessionStart` (`additionalContext`) / `subagentStart` /
`agentStop` — same decision shape, per the CLI hooks reference. A Copilot CLI
too old for those events silently ignores them; there the contract lives in
the agent instructions, and `open --session auto` writes a *pending* record
the capture sweep claims for the real session by time window. The **VS Code
sidebar** has no hooks at all, so that pending path is its normal one: declare
with `open --session auto` from a terminal, and the sweep's capture joins it
to the sidebar session the same way (no announce line and no stop gate there —
platform limit, not a config gap).

**Script-authored floor:** `test-automation-workflow`'s `gate-case.mjs`
appends every verdict to `.agents/automation/<slug>/gate-runs.jsonl` the
moment it exists — so "the gate ran green" is on disk regardless of what any
agent later remembers to write back.

Capture stamps the scope onto the session's ledger line (`scope` field);
`team-report.mjs` splits spend by declared intent, and `batch-cost.mjs`
treats the declared batch/cases as the strongest membership surface.

## How capture works on each host

- **Claude Code** — a SessionEnd hook captures each ending session (dollars
  metered by ccusage at capture time, best-effort via npx) plus a SessionStart
  async sweep for sessions that never reached their end hook, and a
  **SubagentStop hook that measures each dispatch as it finishes**
  (§ Live measurements).
- **GitHub Copilot CLI** — sessionEnd + sessionStart hooks sweep completed
  sessions from `~/.copilot/session-state` (dollars from Copilot's own billed
  `totalNanoAiu`; role from `subagent.selected` on CLI ≥1.0.63; a CLI without
  the sessionEnd event silently keeps the start-only rhythm).
- **VS Code Copilot sidebar** — its sessions (workspaceStorage chatSessions
  op-logs; dollars from `copilotCredits` on extension ≥0.57.0) are swept by
  **any** host's sweep, since every sweep walks all three stores. Scope
  declared via `open --session auto` is claimed at capture by time window
  (§ Session scope). Only a sidebar-ONLY repo needs its own trigger:
  `--host vscode` adds a folderOpen auto-task (opt-in — it writes shared
  `.vscode/tasks.json` and prompts each teammate once).
- **Other hosts** — run the capture script's `--sweep` manually, from CI, or
  via the optional git post-commit hook.

## Live measurements — as each dispatch finishes

The ledger stays **one honest line per session**, written at session end. But
waiting for the session to end means a multi-hour batch shows nothing, so a
**SubagentStop hook** (`--dispatch`, async) measures each dispatch the moment
it finishes: it meters **that one transcript** (~1s) and appends **one line per
dispatch** to `.agents/telemetry/automation/live/<session>.jsonl` — role, label, case ids,
tokens, active minutes, tool calls/errors, real dollars.

Why a separate file rather than the ledger: appending a whole-session line per
stop would put N near-identical rows for one session into the git-committed
ledger, all but the last superseded. This file is per-session and transient —
at session end the ledger line is **re-derived from the transcripts** (so it
already contains every dispatch, freshly metered), anything the live log holds
that the transcripts can no longer produce — a sub-agent file deleted or
expired — is **folded in** (the line then carries `foldedFromLive: N`, never a
silent merge), and the live file is deleted. It is
idempotent (a re-fired stop records nothing), self-healing (a stop that never
fired is swept by the next one), and re-records a dispatch whose transcript
grew (a resumed agent).

```bash
node .claude/skills/tokenomics/scripts/work-scope.mjs status --session <id>
```

reads it — so a live status shows already-priced dispatches and only has to
meter the parent. `priceAtCapture: false` (or `TOKENOMICS_NO_CCUSAGE=1`) keeps
the records tokens-only.

The same hook also refreshes a **live batch page** —
`.agents/telemetry/automation/reports/<batch>.html`, overwritten in place on
every finished dispatch and at session end (same renderer as the close-time
report; mid-run figures read LIVE/PROVISIONAL and converge to the close
figures). Open it in a browser and watch the batch spend as it happens.
`TOKENOMICS_NO_BATCH_COST=1` disables.

**It is also a price cache.** Every later capture — the one `close` runs, and
the one at session end — REUSES a dispatch's recorded dollar when its
transcript is byte-identical, so a capture prices the parent plus whatever
finished unmeasured instead of re-pricing all N+1 transcripts. That is what
makes capturing mid-run cheap. And if a sub-agent transcript is gone by
session end, the fold keeps its measurement (§ above).

**Per host, honestly:**

| | Claude Code | Copilot CLI |
|---|---|---|
| live dispatch records | ✅ from each sub-agent transcript | ✅ from the session's own `events.jsonl` (`subagent.completed`) |
| per-dispatch dollars | ✅ metered per transcript | ❌ **never** — this host prices the session once, at shutdown; records are tokens/time/tools |
| capturing a RUNNING session | ✅ (`close` does it) | ❌ the line needs `session.shutdown`; until then the ledger has no row |
| batch report at close | complete | complete for finished sessions; a report closed mid-session omits **that** session's spend — close after ending it, or accept the gap and re-run `close` later (the render is idempotent) |

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
| `cases[]`, `title` | case ids (Jira-style keys) mined from branches, dispatch labels, prompts and session titles — **ids only, never the surrounding text**, so this is always on; declared scope ids join this list; `title` is VS Code's own session name |
| `scope` | the session's declared work scope, when one exists (§ Session scope): `{intent, batch?, cases, outcomes?}` |
| `turns`, `toolCalls`, `toolErrors`, `skills`, `dispatches` | activity metrics |
| `prompts[]`, `dispatched[]` | **only when `capturePrompts` is on** — user prompts truncated to 200 chars + dispatch descriptions |

## Where records live, and how they travel

Team reporting only works if the **records** travel. Cost-per-case is a join
between the ledger and the receipts — without both in git a teammate can
compute nothing. Two homes:

**The telemetry submodule.** `install-hooks.mjs` sets `.agents/telemetry`
up as a submodule **of the same repository**, checked out on its own `telemetry`
branch (`.gitmodules` url `./`, `ignore = all`). It is **shared, one subfolder
per bundle** — this bundle writes `automation/`; another bundle that wants
durable telemetry later adds its own subfolder and rides the same branch and
sync, no second submodule. In `automation/`: the ledger
(`usage-<user>.jsonl` — one file per user, so parallel work never conflicts),
scope records, `config.json`, `factory-profile.json`, mid-run gate verdicts
(`gate-runs/<batch>.jsonl`), workflow returns (`returns/`) and the live batch
page (`reports/`). **Nobody hand-commits any of it**: every
capture moment commits and pushes to the `telemetry` branch (best-effort;
offline just means the next capture catches up; `TOKENOMICS_NO_SYNC=1`
disables). Because of `ignore = all` and the separate branch, the main working
tree never gets dirty and a branch switch never stashes a record. A teammate
gets everything with `git clone --recurse-submodules` (forgot? — `git
submodule update --init`); the chief lead runs `install-hooks.mjs --pull`
before a team report to merge in everyone's pushes. A repo with **no remote at
all** works too — everything accumulates in the local `telemetry` branch; when
a real remote appears later, run `git submodule sync .agents/telemetry` once
so pushes start reaching it (`--doctor` detects the un-synced state and prints
exactly that command).

**The main tree.** The batch's own record ships with the batch, committed like
any other file at close: `report.json`, `gate-runs.jsonl` (folded from the
telemetry side at close, so the closed batch carries one complete file),
`cost.json` and `batch-report.md`/`.html` (written once, at close — never
auto-refreshed mid-run).

The installer still writes an owned `.gitignore` block (replaced in place on
re-run, stripped by `--remove`) — it covers the plain-dir fallback, where the
telemetry folder is not (yet) a submodule:

```gitignore
# >>> tokenomics (managed) — working state only; the ledger/scopes/receipts stay COMMITTED
.agents/telemetry/automation/live/
.agents/telemetry/automation/scopes/.pending-*
.agents/telemetry/automation/scopes/.nagged-*
.agents/telemetry/automation/scopes/.unclosed-*
# <<< tokenomics
```

**Never gitignore `.agents/telemetry`** — a submodule only works if git sees
its path. (`.agents/automation/<batch>/` must stay committable too — its
receipts and cost records are the point.)

Artifacts other skills write are the project's call, not this skill's — most
projects also ignore the legacy `.agents/automation/_returns/` (per-dispatch
returns now land in `telemetry/returns/` when the telemetry area exists), the
batch's `cases/` snapshots and `run.json`, and any browser scratch
(`.playwright-mcp/`). `--doctor` warns when the block is missing and reports
the submodule's state (uninitialized clone, unpushed commits, detached HEAD).

**Scope note:** the capture/scope contract here belongs to the
**test-automation bundle**; manual-qa meters its benchmark runs with its own
hooks and other bundles do their own thing — the paths never collide, so they
coexist in one repo without conflict. The telemetry *submodule* itself is the
shared piece: per-bundle subfolders, one branch, one sync.

## Config — `.agents/telemetry/automation/config.json`

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
sessions (latest wins), and prints totals, by-person, by-role, by-week, **by
declared intent** (automation vs other vs undeclared), **by batch** (one row
per receipt: delivered, total, per-delivered, gate verdict, drift flag), and a
**cross-batch per-case table** (delivered first, direct + loaded cost) —
tokens, real dollars with provenance, active/wall hours, tool calls. Where
scope records exist, the per-delivered figure is also shown **scoped to
automation-intent spend** — the honest denominator that stops unrelated
sessions inflating $/case. `--html` renders any of it as a self-contained
page; batch close writes `batch-report.md` + `.html` automatically
(§ Session scope). For the **team** picture, pull first:
`install-hooks.mjs --pull` merges every teammate's telemetry pushes into the
local submodule, so the report sees everyone, not just this machine.

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
