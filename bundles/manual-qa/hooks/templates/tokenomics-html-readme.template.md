# Tokenomics HTML report — how to run it

Turns an existing `reports/tokenomics/RUN-<id>.tokenomics.json` row (produced
by `build-tokenomics-report.mjs` — see `reports/tokenomics/README.md` for
that step, copied from `tokenomics-readme.template.md`) into a single
self-contained HTML report: KPI cards, a token composition chart,
per-model/per-agent breakdowns, and a per-test-case timeline. No
dependencies, no build step, no server — open the output file straight in
a browser.

## 1. Make sure the tokenomics JSON exists

This script only *reads* `reports/tokenomics/RUN-<id>.tokenomics.json` — it
never computes metrics itself. If that file doesn't exist yet for your run,
generate it first (see `reports/tokenomics/README.md`):

```bash
node .claude/hooks/manual-qa/build-tokenomics-report.mjs reports/metrics/RUN-2026-07-22-005.json
```

## 2. Run the HTML export

From the project root:

```bash
# one specific run
node .claude/hooks/manual-qa/build-tokenomics-html.mjs reports/tokenomics/RUN-2026-07-22-005.tokenomics.json

# every run currently in reports/tokenomics/
node .claude/hooks/manual-qa/build-tokenomics-html.mjs --all
```

`--all` is safe to re-run any time — it just regenerates every report from
whatever `.tokenomics.json` files exist right now, so it also picks up
future runs automatically without any code changes.

## 3. Open the output

One file per run: `reports/tokenomics/html/RUN-<id>.tokenomics.html` — just
double-click it (or `start <path>` / `open <path>`), no server needed.

## What's in the report

- **KPI cards** — Cost & Time, Token Usage, Activity (turns, tool calls,
  dispatches, scenarios, pass rate).
- **Token composition** — stacked bar of input / output / cache-create /
  cache-read, with the token-based cache share as a callout.
- **Tokens by model** — table + share bar, one row per model actually used.
- **Tokens by agent** — table (Input/Output/Cache create/Cache read
  columns, plus totals) + a duration bar per agent persona. Rows with no
  dispatch count (typically `test-run-lead`) are a **computed remainder** —
  total session tokens minus every real dispatch — not a direct
  measurement. It's usually the biggest number in the table because the
  orchestrator is one long, continuously-growing conversation thread across
  every turn, while each subagent dispatch is short and separate — see its
  Input/Output/Cache columns for the actual composition instead of just the
  total.
- **Test-case timeline** — one bar per TC, colored by PASS/FAIL/BLOCKED,
  click a bar for its token/duration detail; plus the same data as a table.
  Only rendered if `reports/metrics/RUN-<id>.json` exists alongside the
  tokenomics file (older runs may not have it — the report still renders
  everything else without it).
- Light/dark theme — follows the OS by default, or use the toggle button in
  the header.

## A caveat worth knowing: `tokens_coverage`

If the source metrics file has `session.tokens_coverage:
"full_session_unscoped"`, the session-level token totals (and therefore
`test-run-lead`'s remainder, and `orchestrator_cost_pct` in the tokenomics
JSON) may include token usage from **other concurrent Claude Code sessions**
on the same machine, not just this run — ccusage couldn't match this run's
session id and fell back to summing everything. The HTML report doesn't
flag this today; if a run's numbers look implausible, check that field in
`reports/metrics/RUN-<id>.json` before trusting them.

## Related

- Generator script: `build-tokenomics-html.mjs` (`hooks/scripts/`, installed
  to `.claude/hooks/manual-qa/` by the bundle installer)
- Feeds from: `build-tokenomics-report.mjs` (and optionally
  `reports/metrics/RUN-<id>.json` for the test-case timeline)
- `reports/tokenomics/README.md` — how the source `.tokenomics.json` itself
  gets produced
