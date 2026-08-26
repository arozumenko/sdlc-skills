# Benchmark Metrics Format

## Overview

This is documentation for the **optional metrics-collection add-on** to the
`manual-qa` bundle — install/usage instructions live in
[`../hooks/README.md`](../hooks/README.md). Once installed, each benchmark
run produces a JSON file at `reports/metrics/RUN-YYYY-MM-DD-NNN.json`.
This file captures both session-level and per-TC metrics, enabling quantitative
comparison between different agent systems on the same TC suite.

## How a benchmark run works

1. **`benchmark-session-start`** (SessionStart hook) — writes
   `.claude/benchmark-session-started-at.txt` once per session (a no-op if the
   file already exists, so `/clear`/`/compact` don't reset the clock), and
   captures a `ccusage session --json` pre-snapshot to
   `.claude/benchmark-session-pre.json` at the session's *true* start — before
   `test-run-lead` does anything, including its own Glob / id-normalization /
   sizing-check / Run ID work.
2. **`benchmark-preflight`** (PreToolUse hook, fires before the first `Agent`
   dispatch of the session) — reuses the session-start snapshot as
   `.claude/benchmark-pre.json` (falling back to capturing its own, scoped
   only from this point onward, if session-start's snapshot isn't there),
   creates `.claude/benchmark-state.json`, and truncates
   `.claude/benchmark-tc-trace.jsonl`. Using the earlier snapshot means tokens
   `test-run-lead` spends *before* its first dispatch land in
   `session.orchestrator_tokens` instead of being invisible to the delta.
3. **`benchmark-tc`** (PostToolUse hook, fires after every `Agent` dispatch) —
   appends one JSONL line per TC/support-agent call to
   `.claude/benchmark-tc-trace-<session_id>.jsonl`, tagged with the real
   dispatched agent name (`agent_type`, read from `tool_input.subagent_type`).
4. **`benchmark-stop`** (`SubagentStop` hook, matcher `test-reporter` — fires
   exactly once per suite, as soon as the reporter finishes, regardless of
   how long the surrounding session keeps running; also registered on
   `SessionEnd` as a fallback for sessions that never reach a real report,
   e.g. sizing-only) — captures a post-run `ccusage` snapshot, diffs it
   against the pre-run one, merges it with the tc-trace, and calls
   `build-run-metrics.mjs` to write the final JSON. It also appends
   `## Timing Breakdown` and `## ccusage Session Delta` sections to the
   matching `reports/RUN-*.md` report, then cleans up that session's
   `.claude/benchmark-*-<session_id>` state files (orphaned files older than
   7 days are swept by `benchmark-session-start` on the next fresh session).
   `build-run-metrics.mjs` only trusts a `RUN-*.md` report if it was written
   *during this session* (file mtime at or after session start) — otherwise
   it falls back to a fresh, collision-checked synthetic `run_id`, so a
   session that dispatched something but never actually ran a suite (e.g.
   sizing/authoring only) can't silently overwrite an unrelated earlier run's
   `metrics.json`.

All ephemeral state files above are named per Claude Code `session_id`, so
multiple `test-run-lead` sessions can run concurrently in the same project
without clobbering each other's metrics (see `../hooks/README.md` → "Known
caveats").

All four hook scripts, plus `build-run-metrics.mjs`, `benchmark-tc-hook.mjs`,
`compare-runs.mjs`, and the optional manual `build-tokenomics-report.mjs` /
`build-tokenomics-html.mjs`, are installed to `.claude/hooks/manual-qa/` by
the bundle installer — see `../hooks/README.md` for the install command and
for the tokenomics scripts' one-time per-project setup.

### `tokens_coverage` — how to read it

The `session.tokens_coverage` field records how the token/cost numbers were
computed:

- `"full_session"` — the pre/post `ccusage` snapshots both contained an entry
  matching this session's own id (`period` in ccusage's output), so the
  token and cost delta are scoped to **this run only**, even if other Claude
  Code sessions are running concurrently on the same machine. Model(s) and
  cost come straight from ccusage's own per-model breakdown for that session.
- `"full_session_unscoped"` — pre/post ccusage data exists, but no session-id
  match was found (e.g. an older `ccusage` without a `period` field, or the
  hook fired before ccusage indexed the session). The delta falls back to
  summing **every** Claude Code session on the machine, and cost is priced
  using a single assumed model (`model:` from the report, or a hardcoded
  default) — **don't trust this mode for precise cost comparisons** if
  another Claude Code session might have been running at the same time.
- `"subagents_only"` — no ccusage pre/post data at all; only sub-agent
  (tc-trace) token counts are available; total tokens excludes the
  orchestrator's own usage.

Always use `session.total_tokens` as the primary cost metric for cross-system
comparisons, and check `tokens_coverage` first — only trust exact cost deltas
in `"full_session"` mode. The per-TC `tcs[].tokens` values are sub-agent-only
and undercount the orchestrator's work in every mode.

## JSON schema

This is a real run (`elitea-testing` RUN-2026-07-22-005, `full_session_unscoped` —
see the caveat above and in `../hooks/README.md` → "Known caveats"), every
number below is internally consistent (e.g. `tokens_by_agent` sums exactly
to `session.total_tokens`):

```json
{
  "run_id": "RUN-2026-07-22-005",
  "agent_system": "manual-qa/v1",
  "model": "claude-sonnet-4-5-20250929",
  "suite": "smoke",
  "environment": "https://next.elitea.ai",
  "date": "2026-07-22T15:28:18.452Z",

  "session": {
    "tokens_coverage": "full_session_unscoped",
    "total_tokens": 4870329,
    "input_tokens": 4792,
    "output_tokens": 24073,
    "cache_creation_input_tokens": 587706,
    "cache_read_input_tokens": 4253758,
    "duration_ms": 664450,
    "pre_flight_duration_ms": 34000,
    "total_session_duration_ms": 698450,
    "total_tool_uses": 93,
    "turns": 25,
    "support_agent_tokens": 18014,
    "support_agent_tool_uses": 3,
    "support_agent_duration_ms": 48853,
    "subagent_dispatches": 6,
    "orchestrator_tokens": 4542583,
    "orchestrator_cost_pct": 93.3,
    "tc_total_duration_ms": 583322,
    "orchestrator_duration_ms": 32275,
    "total_effective_tokens": 9729807,
    "tokens_by_agent": {
      "test-runner": { "dispatches": 5, "tokens": 309732, "input_tokens": 17, "output_tokens": 1534, "cache_creation_input_tokens": 13400, "cache_read_input_tokens": 294781, "tool_uses": 93, "duration_ms": 583322 },
      "test-reporter": { "dispatches": 1, "tokens": 18014, "input_tokens": 6, "output_tokens": 325, "cache_creation_input_tokens": 112, "cache_read_input_tokens": 17571, "tool_uses": 3, "duration_ms": 48853 },
      "test-run-lead": { "dispatches": null, "tokens": 4542583, "input_tokens": 4769, "output_tokens": 22214, "cache_creation_input_tokens": 574194, "cache_read_input_tokens": 3941406, "tool_uses": null, "duration_ms": 32275 }
    },
    "tokens_by_model": {
      "claude-sonnet-4-5-20250929": { "input": 4786, "output": 23748, "cache_create": 587594, "cache_read": 4236187 },
      "claude-haiku-4-5-20251001": { "input": 6, "output": 325, "cache_create": 112, "cache_read": 17571 }
    },
    "cache_read_share_pct": 33.1,
    "models_used": ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
    "cost_usd": 3.86,
    "ccusage": {
      "pre": { "total_tokens": 398501472, "input_tokens": 175714, "output_tokens": 1755365, "cache_create": 9725975, "cache_read": 386844418 },
      "post": { "total_tokens": 403371801, "input_tokens": 180506, "output_tokens": 1779438, "cache_create": 10313681, "cache_read": 391098176 },
      "delta": { "total_tokens": 4870329, "input_tokens": 4792, "output_tokens": 24073, "cache_create": 587706, "cache_read": 4253758 },
      "cost_usd_pre": 179.38,
      "cost_usd_post": 183.24,
      "cost_usd_delta": 3.86
    }
  },

  "tcs": [
    { "tc_id": "TC-001", "result": "PASS", "duration_ms": 119487, "tokens": 64791, "input_tokens": 9, "output_tokens": 640, "tool_uses": 19 },
    { "tc_id": "TC-002", "result": "PASS", "duration_ms": 114588, "tokens": 63880, "input_tokens": 1, "output_tokens": 170, "tool_uses": 17 },
    { "tc_id": "TC-003", "result": "PASS", "duration_ms": 129607, "tokens": 61066, "input_tokens": 2, "output_tokens": 219, "tool_uses": 21 },
    { "tc_id": "TC-004", "result": "PASS", "duration_ms": 128876, "tokens": 61944, "input_tokens": 2, "output_tokens": 232, "tool_uses": 19 },
    { "tc_id": "TC-005", "result": "PASS", "duration_ms": 90764, "tokens": 58051, "input_tokens": 3, "output_tokens": 273, "tool_uses": 17 }
  ],

  "summary": {
    "total": 5,
    "passed": 5,
    "failed": 0,
    "blocked": 0,
    "pass_rate": 100,
    "avg_tokens_per_tc": 61946,
    "avg_tool_uses_per_tc": 18.6,
    "avg_duration_per_tc_s": 117
  }
}
```

## Key metrics explained

| Metric | What it measures |
|--------|-----------------|
| `session.total_tokens` | Token delta for the run — scoped to this session only when `tokens_coverage` is `"full_session"` |
| `session.cache_read_input_tokens` | Tokens served from cache (much cheaper) — high = good context reuse |
| `session.cache_creation_input_tokens` | Tokens written to cache (one-time higher cost) |
| `session.cost_usd` | Cost delta for the run — same scoping caveat as `total_tokens` |
| `session.turns` | Assistant-message count from the session transcript — how many request/response exchanges the orchestrator made |
| `session.subagent_dispatches` | Count of every `Agent`-tool dispatch this session (TC runners + support agents like `test-reporter`) |
| `session.orchestrator_cost_pct` | Orchestrator's share of `total_tokens` (**token-share proxy, not a real cost split** — see `tokens_by_agent` below) |
| `session.tokens_by_model` | Token totals split by real model id — lets a session mixing e.g. Sonnet (main) + Haiku (`test-reporter`) be priced per-model instead of guessing one model for everything |
| `session.tokens_by_agent` | Token/tool/duration totals per real agent persona (`test-runner`, `test-reporter`, ...). `test-run-lead`'s entry (if present) is a **computed remainder** (`total_tokens` minus every real dispatch's share), not a direct measurement — it's usually the largest entry because the orchestrator is one long, continuously-growing conversation thread across every turn, dominated by cache read/write, while each dispatch is short and separate. Its `dispatches`/`tool_uses` stay `null` (nothing to sum them from); its `input_tokens`/`output_tokens`/`cache_*_tokens` are populated the same remainder way, per type. |
| `summary.pass_rate` | Primary correctness score |
| `tcs[].tokens` | Sub-agent cost per TC (excludes orchestrator) — useful for relative comparisons within a run |

## Tokenomics export (optional, separate schema)

`session.turns`/`orchestrator_cost_pct`/`tokens_by_model`/`cache_read_share_pct`
above feed into a *separate*, optional export: `build-tokenomics-report.mjs`
reshapes this file (plus a few human-judgment fields from the `RUN-*.md`
report's frontmatter) into one row of the EPAM cross-factory
`factories-tokenomics-dataset` schema, written to
`reports/tokenomics/RUN-<id>.tokenomics.json` — and optionally
`build-tokenomics-html.mjs` renders that row as a self-contained HTML
report. Neither is a hook — both are run by hand, on demand. See
`../hooks/README.md` → "Tokenomics export + HTML report" for the one-time
per-project setup and usage.

## `agent_system` convention

Set to a free-form label that identifies the agent + version being measured.
Examples: `"manual-qa/v1"`, `"custom-agent/gpt-4o"`, `"my-agent/v2-optimized"`.
This label becomes the column header in the comparison table.

## Running a comparison

```bash
node .claude/hooks/manual-qa/compare-runs.mjs reports/metrics/RUN-A.json reports/metrics/RUN-B.json
```

Outputs a Markdown table comparing all key metrics side-by-side.
Marks `⚠️ subagents_only` in the `tokens_coverage` row when session data is
incomplete — also check for `full_session_unscoped` (not flagged by the
comparison table today) before trusting exact cost numbers.
