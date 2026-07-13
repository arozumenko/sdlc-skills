---
name: efficiency-audit
description: Measure the token/cost/time efficiency of AI coding-agent work — per session, per role, per day, and per individual sub-agent — with every dollar metered by ccusage. Use when the user asks "what did this cost", cost per session/role/test case, which role/sub-agent burned the most, tool-call/skill/time breakdowns, "before vs after" cost comparisons, or wants to audit AI spend over time.
license: Apache-2.0
compatibility: Requires Node 18+ and the `ccusage` CLI (auto-run via `npx ccusage@latest`, or a local install). Reads local agent-CLI transcripts under `$CLAUDE_CONFIG_DIR/projects` when set, else ~/.claude/projects (falling back to ~/.config/claude/projects). Cost is Claude-host-native; other hosts (Copilot/Codex/Gemini) work only where ccusage supports them.
metadata:
  authors:
    - Alexander Bychinskiy
  version: "0.1.0"
---

# Efficiency Audit

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

Not for: reading raw ccusage dashboards (just run `ccusage`), or non-cost
session mining (that's `session-retrospective`).

## Step 0 — clarify the scope first

The hard part of an audit is *which sessions to count*, and that's a
conversation, not an assumption. Before running, pin down with the user:

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

## Options (CLI flags)

| Flag | Effect |
|---|---|
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
| `--help`, `-h` | Print usage (all flags) and exit. |

## Per-case / per-task analysis (cost per automated test case)

"What did it cost to automate *this test case*" is the headline economic number
for a delivery team — and it's an **analysis you perform over the `--json`
ledger**, not a fixed flag. Tying spend to a task means reading the **git
delivery** and the **conversation log**, which needs judgment, so keep it an
agentic analysis rather than a brittle regex. Every per-case dollar still
reconciles to ccusage (you're only *grouping* the metered ledger).

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
  session total stays ccusage-exact.
- **Forks/resumes are deduped.** A resumed session replays earlier records (and
  inherits a copy of its parent's sub-agent files). Cost is safe regardless
  (ccusage dedups by message-id — a fork meters to ~$0), and transcript metrics
  are deduped too (units parsed earliest-first through a shared id context, and a
  sub-agent shared across parents counted once). So a resumed session shows as a
  near-empty unit, not a duplicate of the original — see `methodology.md` §
  Forks, resumes & background dispatches.
- **Host coverage.** Role/sub-agent breakdown is Claude-Code-only. ccusage can
  report Copilot/Codex/Gemini *totals* where their logs exist (e.g. Copilot needs
  OpenTelemetry export enabled *before* the sessions), but without the sub-agent
  layer.

## References

- `references/methodology.md` — how metering works, the flatten trick, the
  ccusage grain reality, the token-dedup rule, model-awareness, and the evidence.
- `scripts/usage-rollup.mjs` — the engine (stdlib-only + ccusage; unit-tested via
  `node --test scripts/usage-rollup.test.mjs`).
