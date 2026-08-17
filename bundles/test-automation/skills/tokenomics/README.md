# Tokenomics — the 2-minute guide

**What it does:** records what every AI session cost (tokens, $, time), which
test cases it worked on, and what got delivered. Then turns that into reports.

**Three tools, one job each:**

| tool | question it answers | when |
|---|---|---|
| **tokenomics** (this skill) | "what did the team spend, on which cases, forever" | always-on, survives transcript expiry |
| **efficiency-audit** | "where exactly did the money go in THESE sessions" | deep dive, transcripts still alive (~30 days) |
| pipeline's `report.json` | "which cases were delivered" | written by every batch run — tokenomics joins against it |

---

## Setup — once per repo

```bash
node .claude/skills/tokenomics/scripts/install-hooks.mjs            # wires Claude + Copilot
node .claude/skills/tokenomics/scripts/install-hooks.mjs --doctor   # check it worked
```

Installing the skill alone does **nothing**. This command is the on-switch.
`--remove` is the off-switch. That's it — capture is now automatic.

The installer also sets up **where telemetry lives**: `.agents/telemetry`
becomes a git **submodule of the same repo**, checked out on its own `telemetry`
branch. Step by step, what that means:

1. Hooks write usage files into this bundle's subfolder there —
   `.agents/telemetry/automation/`.
2. Capture moments commit + push them — **to the `telemetry` branch, never main**.
   Your working tree stays clean; gates and branch switches never see them.
3. One commit to main, once, right after install (the installer prints it):
   `git add .gitmodules .agents/telemetry && git commit -m "chore: telemetry submodule"`.
4. Teammates: `git clone --recurse-submodules`. Forgot the flag? The folder is
   empty — `git submodule update --init` fixes it (doctor says exactly this).
5. Didn't init it at all? Nothing breaks — main is unaffected, telemetry is
   just off on that machine.

The submodule is **shared, one subfolder per bundle**: `automation/` belongs to
the test-automation bundle; when manual-qa or another bundle wants durable
telemetry later, it adds its own subfolder and rides the same branch and the
same sync — no second submodule, no second machinery.

---

## Daily flow — what the lead does

```bash
# session starts → a line appears in context with your session id. When batch work begins:
node .claude/skills/tokenomics/scripts/work-scope.mjs open --session <id> \
  --intent automation --batch my-batch --cases EL-1,EL-2,EL-3

# when a case's outcome becomes true:
node .claude/skills/tokenomics/scripts/work-scope.mjs outcome --session <id> EL-1=automated

# at batch close:
node .claude/skills/tokenomics/scripts/work-scope.mjs close --session <id>
```

`close` **generates the batch report** (`.agents/automation/my-batch/batch-report.md`
+ `.html`) and yells if the receipt disagrees with the records (**DRIFT**) —
fix `report.json`, run `close` again.

Forgot to declare? A hook blocks your turn end once and tells you the command.

**Not batch work?** Same command, honest label, no batch/cases:
`--intent investigation` / `framework` / `manual-testing` / `onboarding` / `docs` / `other`
(or your own — it's a free string). Asked once, never again.

**Only `automation` counts toward $/case.** Everything else just reports its own
spend — so a day of bug-hunting stops inflating "cost per automated case".

---

## Reports — "I want X" → run Y

| I want… | run |
|---|---|
| **what has this session spent SO FAR** (mid-run) | `work-scope.mjs status --session <id>` |
| this batch's cost report | happens at `close`; or `team-report.mjs --batch my-batch` |
| …as a shareable page | `--html --out batch.html` (close already wrote `batch-report.html`) |
| **where the tokens went** (composition, cache hit rate, per role/stage/case) | `--batch my-batch --tokenomics` (close already wrote `batch-tokenomics.md`/`.html`) — the other unfolding of the same cost.json |
| **live batch page, mid-run** | already on disk: `.agents/telemetry/automation/reports/<batch>.html` — refreshed on every finished dispatch |
| team/period rollup | `install-hooks.mjs --pull` first (grabs teammates' pushes), then `team-report.mjs` (add `--since 2026-08-01`, `--html`, `--json`) |
| cost per case, across all batches | in the team report — "Per case" table, delivered first |
| compare two batches | `build-tokenomics-export.mjs --compare a/cost.json b/cost.json` |
| who spent what, by person/role/week | team report — it's all there |
| only automation spend, not my docs sessions | team report splits by declared intent automatically |
| deep forensic audit (cache hits, per-dispatch $) | efficiency-audit: `usage-rollup.mjs --since … --resolved-from` |
| audit as a page | efficiency-audit: `build-report-html.mjs --in rollup.json --out report.html` |

---

## What the numbers mean (30 seconds)

- **direct** = measured. That case's own dispatches. Trust it.
- **loaded** = direct + even share of batch overhead. An **allocation** — good
  for comparing cases, clearly labelled, never pretends to be measured.
- **overhead** = lead thread + triage + gate + report writer. Shown once, split
  by stage. Never smeared into cases silently.
- **rework** = what fix rounds cost. Already inside direct; shown separately
  because it's the lever you can actually pull.
- **DRIFT** = the receipt (`report.json`) disagrees with script-recorded facts
  (gate verdicts, declared outcomes). The receipt needs a write-back. Fix it.
- **n/a** = not measured. We never estimate dollars. A `$0.00` you see is real.

---

## What goes where (team reporting)

Two homes, one rule each:

**The telemetry submodule** (`.agents/telemetry/`, this bundle's data in
`automation/`) — ledger, scopes, config, live logs, mid-run gate verdicts,
workflow returns, the live report.
**You never commit any of it by hand.** Hooks commit + push it to the
`telemetry` branch automatically. Its own inner `.gitignore` keeps the
transient bits (live log, hook markers) out of even that branch.

**The main tree** (`.agents/automation/<batch>/`) — the batch's RECORD, committed
with the batch like any other file:

| file | why |
|---|---|
| `report.json` + `.md` | the delivery receipt everything divides by |
| `gate-runs.jsonl` | gate verdicts — written telemetry-side mid-run, folded here at close |
| `cost.json` + `batch-report.md`/`.html` | the cost record + the human report — written once, at close |

A few in-run artifacts of other skills stay gitignored in the main tree
(the installer's managed block covers the plain-dir fallback too):

```gitignore
.agents/automation/**/cases/            # TMS body copies — the TMS is the source
.agents/automation/**/run.json          # in-run scratch
.playwright-mcp/                        # browser scratch/screenshots
```

One rule to keep: **never gitignore `.agents/telemetry`** — it's a submodule,
git has to see it. (And `.agents/automation/<batch>/` records must be
committable, so don't blanket-ignore that directory either — ignore the
specific patterns above instead.)

## Files on disk

```
.agents/telemetry/automation/usage-<user>.jsonl     ← the ledger: one line per session
.agents/telemetry/automation/live/<session>.jsonl   ← live: one line per finished dispatch
                                            (written by the SubagentStop hook,
                                             deleted when the session's line lands)
.agents/telemetry/automation/scopes/<session>.json  ← what each session declared + outcomes
.agents/telemetry/automation/reports/<batch>.html   ← LIVE batch page, refreshed per dispatch
.agents/telemetry/automation/gate-runs/<batch>.jsonl ← gate verdicts mid-run (folded at close)
.agents/telemetry/automation/returns/<run>/          ← workflow returns (crash recovery)
.agents/automation/<batch>/report.json   ← the pipeline's receipt (who delivered what)
.agents/automation/<batch>/gate-runs.jsonl ← every gate verdict, script-written
.agents/automation/<batch>/cost.json     ← machine cost report (written at close)
.agents/automation/<batch>/batch-report.md|.html ← the human report (written at close)
```

---

## FAQ, fast

- **Didn't enable tokenomics?** Nothing runs, nothing breaks. Only
  `gate-runs.jsonl` still gets written (it's the pipeline's own record).
- **Copilot?** Same contract, same hooks (current CLI). Older CLI: hooks are
  ignored, use `open --session auto` — capture claims it by time window.
- **VS Code Copilot sidebar?** Captured automatically — every sweep walks its
  store too. Only if the sidebar is the *only* thing anyone uses in the repo:
  `--host vscode` (adds a task to shared `.vscode/tasks.json`; each teammate
  gets one "allow automatic tasks?" prompt — that's why it isn't a default).
- **Several batches in one session?** Handled — each batch gets its share,
  nothing double-counted, the report says when a session was shared.
- **Where do dollars come from?** Claude: ccusage metering (live model prices
  applied to each request *record* — exact model + cache split). Copilot: its
  billed credits × the published $0.01. Both are real. What we refuse:
  guessing dollars from token *totals* when no record/billed figure exists —
  that number looks plausible and quietly corrupts every comparison.
- **Publishing to Jira/GitHub?** Seed `.agents/profile.md` § Reporting policy;
  the lead dispatches a cheap publisher agent at close. No policy = files only.
