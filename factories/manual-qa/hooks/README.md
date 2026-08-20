# Metrics collection add-on (manual-qa)

Optional add-on to the `manual-qa` bundle. Once installed, it collects
token/cost/timing/pass-rate metrics on every `test-run-lead`-driven session —
purely observational, it doesn't touch any agent or skill, and doesn't change
how the team runs. Full field-by-field schema docs:
[`../knowledge/metrics-format.md`](../knowledge/metrics-format.md).

## Prerequisites

- **`ccusage` CLI on PATH.** Degrades gracefully (empty token/cost fields) if
  missing — not a hard blocker, but you won't get cost data without it.
- **Node.js on PATH.** The hook scripts are dependency-free `.mjs` — no
  `npm install` needed.
- **Bash available.** On Windows, the `run-hook.cmd` wrapper auto-detects Git
  Bash at the standard `Program Files` locations or on PATH. On Linux/macOS
  it runs directly through your existing `bash`. See the note below — this
  hasn't been verified on real Mac hardware yet, only reasoned through from
  the code.

## Install / update

Run from the root of a project that already has `manual-qa` installed:

```bash
npx github:arozumenko/sdlc-skills init --bundle manual-qa --update --yes
```

This merges 5 hook events (`SessionStart`, `PreToolUse`, `PostToolUse`,
`SubagentStop`, `SessionEnd`) into `.claude/settings.json` under groups
tagged `"_bundle": "manual-qa"` (merge-not-clobber — your other hooks and
other bundles' hooks are left untouched; `.claude/settings.json.bak` is
written first), and copies 12 files into `.claude/hooks/manual-qa/`.
Nothing in `agents/` or `skills/` is touched — this is additive only.

## What to expect after a run

After any `test-run-lead`-driven session ends:

- `reports/metrics/RUN-YYYY-MM-DD-NNN.json` appears, matching the id of the
  `reports/RUN-YYYY-MM-DD-NNN.md` report from that same run.
- That markdown report gets two new sections appended:
  `## Timing Breakdown` and `## ccusage Session Delta`.

No metrics file is produced for sessions that never dispatched a
`test-runner` (nothing to measure).

## Comparing two runs

```bash
node .claude/hooks/manual-qa/compare-runs.mjs reports/metrics/RUN-A.json reports/metrics/RUN-B.json
```

Prints a Markdown comparison table to stdout.

## Tokenomics export + HTML report (optional, manual, one-time setup)

Two more manual (not hook-triggered) scripts reshape the metrics above into
the EPAM cross-factory `factories-tokenomics-dataset` schema, and — if you
want a shareable visual instead of raw JSON — a self-contained HTML report
from it:

1. **One-time per project:** copy `hooks/templates/factory-profile.template.json`
   to `reports/tokenomics/factory-profile.json`, `hooks/templates/tokenomics-readme.template.md`
   to `reports/tokenomics/README.md`, and `hooks/templates/tokenomics-html-readme.template.md`
   to `reports/tokenomics/html/README.md` — these three aren't copied
   automatically by the bundle installer (only `hooks/scripts/` is). Fill in
   `factory-profile.json`'s placeholders (at minimum `factory_id` and
   `factory_name`).
2. **Export a run:**
   ```bash
   node .claude/hooks/manual-qa/build-tokenomics-report.mjs reports/metrics/RUN-<id>.json
   ```
   Writes `reports/tokenomics/RUN-<id>.tokenomics.json` and prints a
   ❌ MISSING / ⚠️ DEFAULTED checklist — several fields (`work_item_ref`,
   `effort_days`, `maturity`, `env_setup`) are honest human judgment calls,
   filled in via optional frontmatter on the `RUN-<id>.md` report (see
   `../knowledge/test-run-report-format.md` → "Optional Tokenomics-Export
   Frontmatter Keys").
3. **Render it as HTML (optional):**
   ```bash
   node .claude/hooks/manual-qa/build-tokenomics-html.mjs reports/tokenomics/RUN-<id>.tokenomics.json
   # or: --all, for every .tokenomics.json currently in reports/tokenomics/
   ```
   Writes `reports/tokenomics/html/RUN-<id>.tokenomics.html` — KPI cards,
   token composition, per-model/per-agent breakdown, and a per-test-case
   timeline. No dependencies, no server, just open the file in a browser.

Full runbooks (once copied per step 1): `reports/tokenomics/README.md` and
`reports/tokenomics/html/README.md`.

## First-install self-check

Since this hasn't been verified on every platform (see the Mac note below),
please do a quick check the first time you install it:

1. Run one `test-run-lead` session (even a small one).
2. Confirm `reports/metrics/RUN-*.json` was created and looks sane (has a
   `session.total_tokens` and a `summary.pass_rate`).
3. Check `session.tokens_coverage` in that file — `"full_session"` is the
   accurate mode; `"full_session_unscoped"` means the token/cost delta may
   include other Claude Code sessions running concurrently on your machine
   (don't fully trust cost numbers in that mode); `"subagents_only"` means
   `ccusage` wasn't found at all.
4. If **no** `reports/metrics/*.json` file appears at all, the hooks are
   likely failing silently (by design, so a hook problem never blocks Claude
   Code itself) — please let us know rather than assume it's just quiet.

## Known caveats

- **Concurrent `test-run-lead` sessions in the same project are safe.** The
  metrics state files (`.claude/benchmark-state-<sid>.json`,
  `.claude/benchmark-tc-trace-<sid>.jsonl`, etc.) are named per Claude Code
  `session_id`, so two terminal tabs running two different suites at once no
  longer share (or clobber) each other's trace file. Orphaned files from a
  session that never reached a real Stop/SubagentStop event are swept after
  7 days by `benchmark-session-start` on the next fresh session. This is
  purely about the metrics **collection** layer — `test-run-lead` itself
  already dispatches test-runners strictly one at a time within a single
  session (see its `RULES.md`), so a normal single run was never affected
  either way.
- **Cost/token scoping** — see `tokens_coverage` above; only `"full_session"`
  is scoped to exactly your run. `"full_session_unscoped"` means ccusage
  couldn't match this run's session id and fell back to summing token/cost
  deltas across **every** Claude Code session on the machine for that time
  window — don't trust precise cost comparisons in that mode, and note that
  it can also inflate the "orchestrator remainder" numbers in
  `session.tokens_by_agent`/`orchestrator_cost_pct` (see
  `../knowledge/metrics-format.md`).
- **macOS/Linux — not yet verified on real hardware.** The wrapper mechanism
  (`run-hook.cmd`) is the same one already used for every other sdlc-skills
  hook shipped with any bundle, so it's expected to work, but this specific
  add-on hasn't been confirmed on a Mac yet. Your first install (see
  self-check above) is effectively that first confirmation — please flag it
  if `reports/metrics/*.json` never shows up.
