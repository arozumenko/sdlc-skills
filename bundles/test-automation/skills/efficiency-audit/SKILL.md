---
name: efficiency-audit
description: Use when the user asks 'what did this cost', cost per session/role/test case, which role or sub-agent burned the most, tool-call/skill/time breakdowns, 'before vs after' cost comparisons, or wants to audit AI spend over time. Measures the token/cost/time efficiency of AI coding-agent work — per session, per role, per day, and per individual sub-agent — with every dollar metered by ccusage.
license: Apache-2.0
compatibility: "Requires Node 18+. Claude Code: reads local transcripts, prices via `npx ccusage@latest`. GitHub Copilot CLI: pass `--host copilot` — reads ~/.copilot/session-state, cost from Copilot's own billed credits, no ccusage. VS Code Copilot sidebar sessions are covered by the `tokenomics` skill's ledger, not this audit. Host detail: § Hosts & data sources."
metadata:
  authors:
    - Alexander Bychinskiy
  version: "0.1.0"
---

# Efficiency Audit

## Hosts & data sources

- **Claude Code** — reads transcripts under `$CLAUDE_CONFIG_DIR/projects`
  (else `~/.claude/projects`, `~/.config/claude/projects`) and prices every
  dollar with `ccusage` (auto-run via `npx ccusage@latest`).
- **GitHub Copilot CLI** — `--host copilot` reads
  `~/.copilot/session-state/*/events.jsonl` (also `$COPILOT_HOME` and a
  repo-local `./.copilot`; all existing roots are searched), needs no ccusage,
  and takes cost from Copilot's own billed figure
  (`session.shutdown.totalNanoAiu`, AI credits at $0.01 each). Parent-session
  roles come from the `subagent.selected` event (CLI ≥1.0.63; older streams
  report role-less sessions), loaded skills from `skill.invoked`. Sessions
  predating GitHub's 2026-06-01 usage-based billing carry no credit figure and
  report tokens with cost n/a. This store is CLI-only — VS Code Copilot
  **sidebar** sessions live in VS Code's own workspaceStorage and are covered
  by the `tokenomics` skill's ledger, not by this audit.
- `build-report-html.mjs` renders either host's `--json` snapshot as one
  self-contained HTML page. `--resolved-from` works on both hosts and needs no
  workflow: it reads the pipeline's `.agents/automation/<slug>/report.json`,
  whether written by the batch workflow or by the lead at close (including
  after rebuilding an interrupted run).

Answer "what did this **cost**, and **who** spent it" for AI coding-agent work —
down to the individual sub-agent — with **ccusage as the single source of every
dollar**. This skill never prices tokens itself: no pricing table, no estimate.
What it adds on top of ccusage is the **join** ccusage can't do alone — attaching
each metered dollar to the **role / session / day / project** that spent it.
(The markdown report shows totals, by-role, and by-day; the per-project
breakdown, `byProject`, is in the `--json` output only.)

Alongside cost, it reports **activity metrics** read from the same transcripts,
per role and per unit: **tool calls** (total + errored, with a success rate),
**skills loaded** (count + names), **tokens** (with cache-hit rate + output
share), **time** (active-minutes + wall-clock span), and **sub-agents
dispatched** (count + names, via the Agent tool). Counts are in the markdown;
full per-unit names/detail are in the `--json` `ledger` (`skills`, `dispatched`,
`toolCalls`, `toolErrors`, `models`, `agentMinutes`, `wallClockMin`,
`startedAt`, `endedAt`).

## When to use

Reach for this whenever the user wants to *quantify* agent spend or efficiency:

- "What did this session / project / feature cost?"
- "Cost per role, per sub-agent, per day."
- "Which agent burned the most? Where's the waste?"
- "Before vs after" — did a prompt/skill/workflow edit move cost up or down?
- "Is this change worth it?" ($/resolved-unit, cache-hit rate, output share).
- Auditing or tracking usage over time (snapshots + diffs).

Not for: reading raw ccusage dashboards (just run `ccusage`), non-cost
session mining (that's `session-retrospective`), or continuous/team-wide
capture that survives transcript expiry — including VS Code Copilot sidebar
sessions — which is the `tokenomics` skill's ledger.

## Step 0 — clarify the scope first

The hard part of an audit is *which sessions to count*, and that's a
conversation, not an assumption. **Offer options, don't interrogate**: when
the ask is open-ended ("audit this", "what did we spend?"), put ONE question
to the user with the standard audits as suggested options — on a host with a
question tool (AskUserQuestion), use it; otherwise list them inline:

1. **Period rollup** *(recommended default)* — this repo, a named window,
   receipts join (`--since … --resolved-from`) → totals, by-role, $/case.
2. **This batch's cost** — window aligned to one batch, `--resolved-from
   .agents/automation/<slug>`.
3. **Before/after** — a prior snapshot (or earlier window) vs now, both
   deltas (§ Snapshots).
4. **One session, deep** — a single session's sub-agent breakdown from the
   `--json` ledger.

What each needs pinned before running:

- **Which project(s)?** This repo (default, from cwd), a specific transcript
  dir, or all projects (`--all-projects`).
- **Which time window?** A date range (`--since`/`--until`), or everything on
  disk (bounded by ccusage's ~30-day retention).
- **Whole team or specific roles?** The rollup breaks down by role; the user may
  only care about, say, the orchestrator vs its implementers.
- **A comparison?** If it's before/after, what's the baseline (a prior snapshot,
  or an earlier window), and what shipped in each (for $/resolved-unit).

There is **no fixed roster** — the skill reads whatever roles/agents actually
ran (from the transcripts), so it works for any agent set or bundle. Don't map
roles to predefined "teams"; report the roles as they appear.

## The procedure is a default route, not a cage

The steps below are the fast path for the common case. They are not the only
way to answer the question, and **a missing precondition is a fallback
condition, not a blocker** — the same rule the orchestrator follows when a
project turns out to be unseeded. Self-orient, take another route, say which
one you took.

Concretely, where the shipped path runs out:

| The shipped path assumes | When it isn't true |
|---|---|
| Outcomes live in `.agents/automation/*/report.json` | Derive the counts from wherever this project's truth actually is — a TMS query, a CSV the team keeps, merged PR titles, a different directory — and hand them in with `--resolved N`. Or write the counts into a `report.json`-shaped file yourself: the contract is `cases[]` with an `id` and an `outcome`, which you can produce from anything. |
| The host is Claude Code or Copilot | Neither? Say so plainly, then use what the host *does* expose. Token counts with no dollars is a real answer; a made-up dollar is not. |
| `ccusage` is available | Without it there are no dollars — report tokens, roles, tool-error rates and time, and say the cost column is unavailable. Never estimate one to fill the gap. |
| The user wants the rollup's questions answered | They often don't. `--json` gives you the per-unit ledger — role, model, tokens, branch, timestamps, tool calls — and any question you can answer by grouping it is fair game. Write the analysis; don't refuse because there's no flag for it. |

**What must survive whichever route you take** — these are the reason the skill
is trusted, and they do not bend:

1. **Never compute a price yourself.** Every dollar comes from the host's own
   meter — ccusage pricing each request *record* (exact model + cache split),
   or Copilot's billed credits at the published conversion. Those are metered
   and billed figures, and they're fine. What's forbidden is DERIVING dollars
   from aggregate token counts with an assumed model/cache mix when no record
   or billed figure exists — that guess looks plausible and silently corrupts
   every comparison it enters. No record → "unavailable", never a number.
2. **`n/a` is not `0`.** An unpriced unit, an unreadable git repo, an unknown
   count — report the ignorance. A zero claims something.
3. **Two denominators, never one.** Any cost-per-case figure says which cases
   it divided by, and delivered-vs-examined are different numbers.
4. **Say what you could not tie.** If the spend can't be shown to belong to the
   work you divided it by, that belongs in the report, not in your judgement of
   whether it matters.

A route that keeps those four is a good route even if nothing here describes
it. A route that drops one is wrong even if it follows every step.

## What makes it accurate

ccusage attributes cost per **top-level session** and folds every sub-agent into
that one number — it won't split a session across the sub-agents it dispatched,
because every sub-agent transcript carries the *parent's* `sessionId`. This skill
gets under that grain with a verified trick:

> `ccusage claude session` keys a session by its transcript **filename** and only
> globs the top level of a project dir. Sub-agents live in a `<session>/subagents/`
> **subfolder** it never descends into. Stage a temp dir with the parent **and**
> every sub-agent transcript *flattened* into one folder (hard links — ccusage
> does not follow symlinks), point ccusage at it via `CLAUDE_CONFIG_DIR`, and it
> **meters every sub-agent as its own session** with real per-model pricing. The
> per-file costs sum to the session's true total to the cent.

So each dollar is **metered by ccusage** (`source: ccusage-metered`), not
estimated — and correct across **mixed models** (a Sonnet sub-agent billed at
Sonnet, an Opus orchestrator at Opus), because ccusage prices each file by its
own model. If metering is unavailable (no `ccusage claude`, staging blocked), it
falls back to the parent-session total split by cost-weighted token share
(`source: ccusage-allocated`) — still 100% ccusage dollars, only the split
derived, and always labelled. See `references/methodology.md` for the full
derivation and the evidence.

That fallback split weighs a **1-hour** cache write at 2× base input and a
5-minute one at 1.25×, reading the TTL breakdown out of each response rather
than the flattened `cache_creation_input_tokens` field. It matters only when a
session mixes the two — which happens when an account crosses into usage
overage mid-session — and in that case it stops under-crediting the sub-agent
that paid to build the cache everyone after it read cheaply. It never moves a
total: metered dollars come from ccusage, and the fallback still sums to
ccusage's session figure.

## Procedure

1. **Settle the scope** (Step 0), then **run the rollup from the project root**
   (or pass `--project-dir`):

   ```
   node {skill}/scripts/usage-rollup.mjs
   ```

   It resolves this project's transcripts under `~/.claude/projects/<encoded-cwd>/`,
   meters every session + sub-agent via ccusage, joins each to its role, and
   prints a markdown rollup: totals, by-role (with model + cache-hit), by-day.
   Exit code 3 = no transcripts found for this project.

2. **Read the rollup.** Check the `method:` line — `metered` (exact per file),
   `allocated` (fell back to split), or `mixed`. Confirm the grand total matches
   expectation; note any large `unattributed` (role-less, ad-hoc sessions).

   **`allocated` on a session that clearly ran sub-agents is a red flag, not a
   detail.** The allocation base is ccusage's top-level session row, which
   prices the *parent* transcript only — so an allocated multi-agent session is
   reporting a parent-sized number for a fleet-sized run. Cross-check
   `reconciliation.externalOk`: when it is `false` and `ccusageMeteredSum` far
   exceeds `total`, per-file metering is being discarded somewhere. (Metering is
   per unit, so a few unmetered units no longer collapse a whole group — that
   bug reported a $1,488.63 session as $51.43, and a whole project as $3,128
   instead of $4,814. If you see the pattern again, suspect the join, not the
   dollars.)

3. **Narrow / shape as needed** (see Options). Common asks:
   - One session's sub-agent breakdown → `--json` and filter the `ledger` to that
     `sessionId` (parent id) plus its sub-agents (`parentId` = that id).
   - A date window → `--since` / `--until`.
   - $/resolved-unit → `--resolved <N>` (N = cases/bugs/tasks shipped).

4. **For before/after**, snapshot then diff (see Snapshots). Report **both**
   deltas — cost *and* a quality denominator — never "cheaper" without saying
   cheaper-per-what.

5. **Report honestly.** Every headline dollar is ccusage-metered. Flag the
   method, any fallback rows, and the caveats below.

6. **The page is part of the default deliverable, not an extra.** Unless the
   user asked for one quick figure inline, finish the audit by rendering the
   HTML report and handing over BOTH artifacts — the markdown rollup (the
   working answer) and the page (what gets shown to a lead, attached to a
   ticket, kept). An audit that ends as terminal scrollback wasn't delivered:

   ```
   node {skill}/scripts/usage-rollup.mjs --resolved-from .agents/automation --json > rollup.json
   node {skill}/scripts/build-report-html.mjs --in rollup.json --out report.html
   ```

   The snapshot carries the measured delivery, so the page renders a **What the
   money bought** section — outcome breakdown, both per-case figures, and the
   coverage caveat — without being told a count. Use `--resolved N` on either
   command only for work the pipeline never reported on.

   It writes `report.html` (self-contained: no fonts, no CDN, no network — it
   survives being emailed or opened from a USB stick) and `report.csv` beside
   it, the by-slot table for a spreadsheet. The page carries the same export as
   a button; the sibling file exists because ticket trackers and mail clients
   strip `<script>`, and this is a report that gets attached to tickets. It
   prints to a clean PDF — the controls drop out and the palette forces light.

   Nothing is published anywhere. If the user explicitly asks for a shareable
   link and the `Artifact` tool is available, publish it then — after they have
   seen which branch names and role names the page contains, since those travel
   with it.

## Options (CLI flags)

| Flag | Effect |
|---|---|
| `--host claude\|copilot` | Which agent CLI's local logs to read (default `claude`). The `copilot` path reads `~/.copilot` session state and prices in nano-AIU credits from Copilot's own billed figure. `--json`/`--out`/`--snapshot`/`--diff`/`--resolved-from` all work there; the ccusage flags (`--weight`, `--mode`, `--no-meter`, `--no-ccusage`, `--online`, `--offline`, `--agent`, `--ccusage-bin`) do not apply and are reported as ignored on stderr. |
| `--project-dir <dir>` | Transcript dir to audit (repeatable). Default: resolve from cwd. |
| `--all-projects` | Audit every project under the Claude projects root (`$CLAUDE_CONFIG_DIR/projects` when set, else `~/.claude/projects`, then `~/.config/claude/projects`). |
| `--since <YYYY-MM-DD>` `--until <YYYY-MM-DD>` | Restrict to a date window (inclusive; dates are **local** calendar days, matching ccusage's defaults). |
| `--resolved <N>` | Divide total cost by N for a $/resolved-unit figure. |
| `--weight cost\|output\|total` | Fallback-allocation weight (default `cost`). Only affects `ccusage-allocated` rows. |
| `--tag <sessionId=role>` | Manually label a role-less session (repeatable). |
| `--exclude-session <id>` | Skip one session id (e.g. the session running the audit). |
| `--mode auto\|calculate\|display` | ccusage cost mode: `auto` (default, logged cost else LiteLLM), `display` (billing-faithful, logged only), `calculate` (always LiteLLM). |
| `--agent <host>` | ccusage host filter for the fallback source (default `claude`). |
| `--ccusage-bin <bin>` | ccusage binary to run (default `npx` → `ccusage@latest`). |
| `--bundle <label>` | Label to show in the report title. |
| `--json` | Emit the full structured rollup (incl. per-unit `ledger` with `models`, and `byProject`) instead of markdown. |
| `--out <path>` | Write the markdown rollup to a file. |
| `--snapshot <path>` | Also write a JSON snapshot for later diffing. |
| `--diff <snapshot.json>` | Print a before/after diff of this run vs a prior snapshot. |
| `--online` | Force live LiteLLM pricing from the start (network). |
| `--offline` | Force cached pricing, no network, no auto-refresh — fast, but new models may be unpriced (the run warns + names them). |
| `--no-meter` | Skip per-file metering; use session-total + allocation only. |
| `--no-ccusage` | Skip ccusage entirely; token/role structure only, no dollars. |
| `--resolved-from [path]` | Take the delivered count from the pipeline's own run reports instead of a typed-in number. Accepts a `report.json`, a batch dir, or the automation root (default `.agents/automation`). Overrides `--resolved`, and prints the disagreement if both are given. |
| `--help`, `-h` | Print usage (all flags) and exit. |

## Cost per case, measured (`--resolved-from`)

The batch pipeline writes `.agents/automation/<slug>/report.json` — one row per
input case, with the outcome it reached and the branch it was built on. The
audit meters every dollar. Point one at the other and cost-per-case stops being
a number someone remembered:

```
node {skill}/scripts/usage-rollup.mjs --resolved-from .agents/automation
node {skill}/scripts/run-reports.mjs --from .agents/automation --json   # counts alone
```

**Two denominators, always.** `automated` cases are the specs that shipped;
every case that entered consumed analysis whether it shipped or not. So the
report gives **$/spec delivered** ("what did a shipped test cost") *and* **$/case
examined** ("what does putting a case through this pipeline cost"). A single
"cost per case" is always one of these wearing the other's name, and which one
it is decides whether the pipeline looks cheap or expensive.

**A re-entered case counts once.** A case reported `blocked` on a product ticket
that comes back in a later wave and gets automated is one case that took two
attempts. Summing rows across batches would count it twice — and make the
pipeline look *cheaper* per case the more often it had to retry. Batches fold in
mtime order; the latest outcome wins; the re-entry count is reported separately,
because it is its own efficiency signal.

**It is not a workflow feature.** It reads a *file*, so it does not care what
produced one. The batch workflow writes `report.json` on Claude Code; on a
runner with no workflow the lead writes the same file by hand at close; and
the lead writes `.agents/automation/<slug>/report.json` at close (playbook § Interruption)
rebuilds it from git evidence alone. All three arrive identically, on every
host — `--host copilot` included.

The contract is deliberately tiny: **`cases[]`, each row with an `id` and an
`outcome`.** Nothing else is required. A row with no outcome counts as
`not-started` rather than vanishing, and the directory names the batch when the
file doesn't. The optional fields (`branch`, `integration_branch`, `gate`,
`quota_halted`) sharpen the report; their absence is reported, never assumed
away. A rebuilt report may also carry `analysed` and `built` — how far the
evidence went, not terminal outcomes — and those count as examined, never
delivered.

**Check the coverage line before quoting either figure.** The join also reports
how much of the window's spend sits on branches these batches name. That number
is a **floor** — analysts are forbidden from touching git, so their cost can
never be matched this way — which makes it useless as attribution and exactly
right as a dilution check. If *no* priced unit matches, the report says so and
tells you not to use the ratios: a quarter's spend divided by one batch's cases
is a number that survives one question. Narrow `--since/--until` to the run.

The check needs branches on **both** sides, and stands down when either is
missing — a hand-written report that names no branches, or a host that doesn't
record which branch a unit ran on. It says which, and that it did not run.
Calling that 0% would accuse a perfectly good report of proving the spend
unrelated to the work.

Two more things it will tell you rather than paper over: a batch that halted on
an account ceiling (its delivered count is a floor, not a total), and run reports
that closed outside the metered window (this spend did not pay for those cases).

## Per-case / per-task analysis (attributing spend case by case)

`--resolved-from` answers "what did a case cost **on average**". Attributing
spend to *one specific case* is a different job — it means reading the **git
delivery** and the **conversation log**, which needs judgment, so keep it an
agentic analysis over the `--json` ledger rather than a brittle regex. Every
per-case dollar still reconciles to ccusage (you're only *grouping* the metered
ledger).

1. **Explore the scope first — which cases?** Don't assume; discover, then
   confirm the set with the user. Signals, richest first:
   - Run with `--json` and read each `ledger` unit's `description`,
     `dispatched[].description`, and `gitBranch` — in a structured team these
     carry the case key (e.g. `SCRUM-T532`, `SOGMYGV-12561`). List the distinct
     keys and how many units touch each.
   - If descriptions are thin, **read the conversation log** (the session
     transcripts) for what each session set out to do, or ask the user for the
     case list and the key convention (it's project-specific).

2. **Attribute cost + tokens + time per case.** For each case key, gather the
   ledger units that reference it and sum their `costUsd`, `tokens`
   (input/output/cache), `turns`, `toolCalls`, and `agentMinutes`; for **time to
   deliver**, take the wall-clock span = latest `endedAt` − earliest `startedAt`
   across the case's units (active-minutes sums per-unit work; wall-clock is
   elapsed and reflects parallelism). That's the case's **metered cost, token
   consumption, and time**. A test-automation case typically spans an analyst +
   implementer(s) + reviewer sub-agent — sum them.

3. **Confirm delivery / outcome — attempted vs landed.** Cost without an outcome
   is waste, which is exactly what an efficiency audit should surface. Check what
   actually shipped, either:
   - **From the log:** grep the transcripts for `gh pr create` /
     `az repos pr create` (PR title + branch carry the key), `git commit`
     messages (`type(KEY): …`), and `Write`/`Edit` of deliverables (`tests/**`,
     `*.spec.*`, `test-specs/**`).
   - **Against the live repo:** `git log --since <window> --until <window>`,
     `gh pr list --search …`, `az repos pr list` — the ground truth of what
     merged. Mark each case delivered vs attempted-only, and flag **rework**
     (e.g. four implementer attempts on one case is real, expensive spend).

4. **Separate shared overhead.** An orchestrator/scout session spans *many*
   cases — its own cost isn't one case's. Report it as a distinct
   "shared / orchestration" line, or amortize it across the N cases in the
   session, and state which you did.

5. **Write the report.** Save it to `.agents/efficiency/<YYYY-MM-DD>-per-case.md`
   (create the dir) so it's versioned with the repo, and surface the path to the
   user. Structure:

   ```markdown
   # Per-case efficiency — <scope> (<date>)

   Scope: which sessions/cases this covers, and what was excluded — say so
   explicitly (e.g. "unrelated workflow-eval + ad-hoc sessions excluded").
   Cost basis: ccusage-metered, <method>. Total in scope: $X.

   ## Per case
   | case | cost | tokens | units (roles) | delivered | rework |
   |---|---|---|---|---|---|
   | SCRUM-T532 | $18.55 | 42.7M | 5 (analyst, impl×3, reviewer) | PR #24 | 3 impl attempts |

   ## Shared / orchestration (not one case's cost)
   - <role> $X — how you handled it (separate line vs amortized across N cases).

   ## Headline
   - $/delivered-case, tokens/delivered-case; outliers + why (the case that cost
     3× the median and the rework behind it; any session that spent with nothing
     merged).
   ```

   Every per-case dollar reconciles to ccusage — the *grouping* is your analysis,
   and the *delivery* judgment is what makes it an efficiency number, not just a
   spend number.

## Snapshots & before/after

Saved-snapshot diffing is the durable way to track efficiency over time:

```
# baseline (e.g. before a prompt/skill/workflow change), tag with what shipped
node {skill}/scripts/usage-rollup.mjs --since 2026-06-01 --until 2026-06-07 \
  --resolved 12 --snapshot .agents/efficiency/2026-06-07.json

# later, compare the current window against that baseline
node {skill}/scripts/usage-rollup.mjs --since 2026-06-08 --until 2026-06-14 \
  --resolved 18 --diff .agents/efficiency/2026-06-07.json
```

The diff reports the cost delta, cache-hit-rate delta, and — when `--resolved`
was given on **both** runs — the $/resolved-unit delta. Store snapshots under
`.agents/efficiency/` so the series is versioned with the repo.

## Caveats (state these when reporting)

- **Pricing DB can lag new models.** The cached (offline) LiteLLM DB may not yet
  have a brand-new model (e.g. `claude-sonnet-5`), which then prices to **$0** —
  a silent, large undercount (measured ~9× on a sonnet-5 project). The skill
  guards this: an offline run that finds unpriced models **auto-refreshes online**,
  and if you force `--offline` it prints a loud `⚠️ Cost is UNDERCOUNTED` warning
  naming the models. If dollars look implausibly low, check for that warning and
  use `--online`.
- **30-day retention.** Claude Code prunes transcripts after ~30 days
  (`cleanupPeriodDays`). Audit within the window; older spend can't be recomputed.
- **Multi-day sessions land on their start date.** A session resumed across days
  is attributed to its first-activity date (cost isn't pro-rated across days).
  Day attribution and the `--since`/`--until` window use the **local** calendar
  day, matching ccusage's own default date filtering.
- **Time = active-minutes vs wall-clock.** `agentMinutes` sums gaps between
  records but **excludes idle gaps > 30 min**, so a session resumed across days
  isn't counted as continuous work (that's why the orchestrator reads ~160 active-min,
  not 14 days). `wallClockMin` / `startedAt`→`endedAt` are the raw span — honest
  for a bounded sub-agent or a single case, but inflated for a resumed top-level
  session. Use active-minutes for effort, wall-clock spans for per-case elapsed time.
- **Allocated rows are a split, not a meter.** When `method` is `allocated`/`mixed`,
  the sub-agent split of those sessions is derived (cost-weighted), though the
  session total stays ccusage-exact. **For a session that dispatched sub-agents,
  that "exact" total is parent-only and therefore a floor, not the cost** —
  prefer `metered`, and treat a large allocated multi-agent session as suspect.
- **A unit with no metered row and no usage records is $0, and that is real.**
  Dispatches that die before producing output (stalls, kills, quota hits) leave
  transcripts ccusage prices at nothing. They are counted as $0 rather than
  being allowed to invalidate the group's metering — otherwise the more a
  campaign crashed, the cheaper it would appear.
- **Forks/resumes are deduped.** A resumed session replays earlier records (and
  inherits a copy of its parent's sub-agent files). Cost is safe regardless
  (ccusage dedups by message-id — a fork meters to ~$0), and transcript metrics
  are deduped too (units parsed earliest-first through a shared id context, and a
  sub-agent shared across parents counted once). So a resumed session shows as a
  near-empty unit, not a duplicate of the original — see `methodology.md` §
  Forks, resumes & background dispatches.
- **Host coverage.** Claude Code and Copilot **CLI** (`--host copilot`) both get
  the role/sub-agent breakdown from their local logs; the Copilot path prices in
  nano-AIU credits without a per-sub-agent token split, and pre-2026-06 Copilot
  sessions carry no usage block (they report tokens only, cost `n/a` — never a
  confident $0). Other hosts (Codex/Gemini): ccusage can report *totals* where
  their logs exist, but without the sub-agent layer.
- **Copilot in VS Code is NOT covered — and it fails quietly.** `--host copilot`
  reads the CLI's `~/.copilot/session-state/<id>/events.jsonl`. The VS Code
  Copilot Chat extension writes somewhere else entirely — VS Code's
  `workspaceStorage/<hash>/chatSessions/<id>.jsonl`, with a companion
  `GitHub.copilot-chat/transcripts/<id>.jsonl` — so an audit run against a repo
  driven from the VS Code UI reports "no sessions" or, worse, silently covers
  only the CLI sessions that happen to share the directory. Verified 2026-07-31
  (extension 0.57.0, VS Code 1.129.1) on a real sub-agent session; the two
  formats are not interchangeable even though both declare
  `producer: "copilot-agent"`:
  - the extension transcript carries **no `agentId`**, so the sub-agent join
    that fills the role breakdown has nothing to key on;
  - it emits `tool.execution_start` with `toolName: "runSubagent"` instead of
    `subagent.started` / `subagent.completed`;
  - it writes **no `session.shutdown`**, so there is no `modelMetrics` and no
    `totalNanoAiu` — the entire cost basis is missing from that file.
  The credits *are* recorded, per sub-agent, in the `chatSessions` file
  (`toolSpecificData.credits`, alongside `agentName` and `modelName`), plus
  per-turn `promptTokens` / `outputTokens` in `result.metadata` — so support is
  buildable, it is just a second reader that does not exist yet. Until it does,
  audit VS-Code-driven work by re-running the batch from the CLI, or read the
  figures out of `chatSessions` by hand.

## References

- `references/methodology.md` — how metering works, the flatten trick, the
  ccusage grain reality, the token-dedup rule, model-awareness, and the evidence.
- `scripts/usage-rollup.mjs` — the engine (stdlib-only + ccusage; unit-tested via
  `node --test scripts/usage-rollup.test.mjs`).
