#!/usr/bin/env node
// Reshapes an existing reports/metrics/RUN-*.json (+ its reports/RUN-*.md
// sibling) into one row of the factories-tokenomics-dataset "testing stop /
// QA fabric" schema — see the dataset guide (README) fetched and mapped by
// hand on 2026-07-21 (gitbud.epam.com requires EPAM SSO that this
// environment can't pass, so the guide's content isn't a local file we can
// point back to).
//
// This is a deliberately MANUAL, on-demand script — not another hook — and
// writes an INTERNAL report only (reports/tokenomics/), not the dataset
// repo's PR-ready datasets/<factory-id>/ submission layout. Several
// required schema fields (work_item_ref, maturity, effort_days, env_setup)
// are honest human judgment calls that no telemetry can produce; this
// script reads them from optional frontmatter keys on the RUN-*.md report
// and otherwise defaults-and-flags rather than silently guessing.
//
// NOTE: kept in sync by hand with the project-local versions at
// elitea-testing/scripts/ and qa-challenges/scripts/ — same logic; only
// PROJECT_DIR derivation differs, since this copy is installed to
// <project>/.claude/hooks/manual-qa/ by the bundle installer instead of
// staying at <project>/scripts/. Verified end-to-end on a real run
// (elitea-testing RUN-2026-07-22-005) before syncing here — see
// hooks/README.md and hooks/templates/ for the one-time per-project setup
// this script depends on (factory-profile.json, README.md).
//
// Usage (run manually from the project root, once a project has this
// bundle's hooks installed):
//   node .claude/hooks/manual-qa/build-tokenomics-report.mjs reports/metrics/RUN-2026-06-12-004.json
//   node .claude/hooks/manual-qa/build-tokenomics-report.mjs --all
//
// Writes: reports/tokenomics/RUN-<id>.tokenomics.json
// Prints: a self-validation checklist (mirrors the guide's own §7) so gaps
//         are obvious before anyone reuses this for a real submission.
//
// Full runbook (frontmatter keys to fill in first, how to read the
// checklist, where output lands): hooks/templates/tokenomics-readme.template.md
// (copy it to reports/tokenomics/README.md once, per hooks/README.md step 0)

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

// Project root: this script is invoked manually, from the project root, so
// CLAUDE_PROJECT_DIR (set by Claude Code for hooks) is usually absent here —
// process.cwd() is the real fallback in practice, not just a safety net.
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const METRICS_DIR = join(PROJECT_DIR, 'reports', 'metrics');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const TOKENOMICS_DIR = join(REPORTS_DIR, 'tokenomics');

// --- Args ---

const args = process.argv.slice(2);
let targets;
if (args.includes('--all')) {
  targets = existsSync(METRICS_DIR)
    ? readdirSync(METRICS_DIR).filter(f => f.endsWith('.json')).map(f => join(METRICS_DIR, f))
    : [];
  if (!targets.length) {
    console.error('[build-tokenomics-report] no reports/metrics/*.json files found');
    process.exit(0);
  }
} else if (args.length) {
  targets = args;
} else {
  console.error('Usage: node .claude/hooks/manual-qa/build-tokenomics-report.mjs <reports/metrics/RUN-*.json> [...] | --all');
  process.exit(1);
}

// --- Helpers ---

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Minimal frontmatter reader — matches the flat `key: value` block this
// project's RUN-*.md reports already use (see
// knowledge/test-run-report-format.md). No nested YAML.
function readFrontmatter(mdPath) {
  if (!existsSync(mdPath)) return {};
  const text = readFileSync(mdPath, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

// Extract the "### Size Distribution" table (TC-level S/M/L counts, written
// by test-reporter) so we can derive a work-item-level scenario_complexity
// heuristic from it. Returns { S, M, L } counts (0 if a band never appears).
function readSizeDistribution(mdPath) {
  const counts = { S: 0, M: 0, L: 0 };
  if (!existsSync(mdPath)) return counts;
  const text = readFileSync(mdPath, 'utf8');
  const sectionM = text.match(/### Size Distribution\s*\n([\s\S]*?)(?:\n##|\n$)/);
  if (!sectionM) return counts;
  const section = sectionM[1];
  const rowRe = /\|[^|]*\b(S|M|L)\b[^|]*\|\s*(\d+)\s*\|/g;
  let row;
  while ((row = rowRe.exec(section)) !== null) {
    counts[row[1]] = parseInt(row[2], 10) || 0;
  }
  return counts;
}

// Work-item-level scenario_complexity (XS-XL) heuristic from the dominant
// (highest-reached) TC-level size band. Deliberately conservative: this
// system's "L" TCs are multi-step Playwright browser flows, not the guide's
// XL "cross-system E2E + data-gen", so we never auto-assign XL.
// A human can always override via the `scenario_complexity:` frontmatter key.
function deriveScenarioComplexity(counts) {
  if (counts.L > 0) return 'M';
  if (counts.M > 0) return 'S';
  if (counts.S > 0) return 'XS';
  return null; // no size data at all (test-sizer wasn't run)
}

// Effort-days -> size_tshirt spine band (guide §3.1). Never guessed when
// effort_days itself is absent — see the checklist below.
function effortDaysToTshirt(days) {
  if (days == null || Number.isNaN(days)) return null;
  if (days < 0.5) return 'XS';
  if (days <= 1) return 'S';
  if (days <= 3) return 'M';
  if (days <= 5) return 'L';
  return 'XL';
}

function round(n, dp = 1) {
  if (n == null) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// tokens_by_agent's duration_ms -> duration_h, matching wall_clock_h's own
// ms->hours convention for this human-readable export layer. The raw
// reports/metrics/RUN-<id>.json output of build-run-metrics.mjs keeps
// everything in ms (consistent with duration_ms/orchestrator_duration_ms/etc.
// there) — only this tokenomics-export layer converts for readability.
function withDurationHours(byAgent) {
  if (!byAgent) return null;
  const out = {};
  for (const [agent, t] of Object.entries(byAgent)) {
    const { duration_ms, ...rest } = t;
    out[agent] = { ...rest, duration_h: duration_ms != null ? round(duration_ms / 3.6e6, 2) : null };
  }
  return out;
}

// --- Per-run processing ---

mkdirSync(TOKENOMICS_DIR, { recursive: true });

let anyMissing = false;

for (const metricsPath of targets) {
  const metrics = readJsonSafe(metricsPath);
  if (!metrics) {
    console.error(`[build-tokenomics-report] skipping unreadable file: ${metricsPath}`);
    continue;
  }

  const runId = metrics.run_id ?? basename(metricsPath).replace(/\.json$/, '');
  const mdPath = join(REPORTS_DIR, `${runId}.md`);
  const fm = readFrontmatter(mdPath);
  const sizeCounts = readSizeDistribution(mdPath);
  const session = metrics.session ?? {};
  const summary = metrics.summary ?? {};

  const flags = []; // { field, kind: 'missing' | 'defaulted', note }

  // --- Human-judgment fields (frontmatter, default-and-flag, never guessed for effort_days) ---

  const workItemRef = fm.work_item_ref || null;
  if (!workItemRef) flags.push({ field: 'work_item_ref', kind: 'missing', note: 'no ticket/link known for this run — add `work_item_ref:` to the report frontmatter before treating this as a real submission' });

  const workItemBrief = fm.work_item_brief || metrics.suite || null;
  if (!fm.work_item_brief) flags.push({ field: 'work_item_brief', kind: 'defaulted', note: `defaulted to suite name ("${workItemBrief}")` });

  const maturity = fm.maturity || 'experimental';
  if (!fm.maturity) flags.push({ field: 'maturity', kind: 'defaulted', note: 'defaulted to "experimental" — should be a conscious choice' });

  const envSetup = fm.env_setup || 'single-fixture';
  if (!fm.env_setup) flags.push({ field: 'env_setup', kind: 'defaulted', note: 'defaulted to "single-fixture"' });

  const effortDays = fm.effort_days != null ? parseFloat(fm.effort_days) : null;
  if (effortDays == null) flags.push({ field: 'effort_days', kind: 'missing', note: 'genuinely a human estimate (person-days, no AI) — add `effort_days:` to the report frontmatter; size_tshirt cannot be assigned without it' });
  const sizeTshirt = effortDaysToTshirt(effortDays);

  const scenarioComplexity = fm.scenario_complexity || deriveScenarioComplexity(sizeCounts);
  if (!fm.scenario_complexity) {
    flags.push({
      field: 'scenario_complexity',
      kind: 'defaulted',
      note: scenarioComplexity
        ? `derived from TC size distribution (S:${sizeCounts.S} M:${sizeCounts.M} L:${sizeCounts.L}, dominant band mapped to "${scenarioComplexity}") — review, don't trust blindly`
        : 'no TC size data available (test-sizer never ran) — could not derive',
    });
  }

  const scenariosAuthored = fm.scenarios_authored != null ? parseInt(fm.scenarios_authored, 10) : (summary.total ?? null);
  if (fm.scenarios_authored == null) flags.push({ field: 'scenarios_authored', kind: 'defaulted', note: `defaulted to scenarios_executed (${summary.total ?? 'n/a'}) — override via \`scenarios_authored:\` if this suite reruns a subset` });

  const scenariosAutomated = fm.scenarios_automated != null ? parseInt(fm.scenarios_automated, 10) : 0;
  // Not flagged as missing — 0 is a fixed, documented convention for this
  // fabric (agent-driven manual-style execution, not scripted automation).

  // --- Measured fields (already computed by build-run-metrics.mjs) ---

  const tokensByModel = session.tokens_by_model ?? null;
  let primaryModel = metrics.model ?? null;
  if (tokensByModel) {
    const totals = Object.entries(tokensByModel).map(([m, t]) => [m, (t.input ?? 0) + (t.output ?? 0) + (t.cache_read ?? 0) + (t.cache_create ?? 0)]);
    totals.sort((a, b) => b[1] - a[1]);
    if (totals.length) primaryModel = totals[0][0];
  }
  const modelsUsed = session.models_used ?? (primaryModel ? [primaryModel] : null);

  if (session.tokens_coverage === 'subagents_only' || session.tokens_coverage == null) {
    flags.push({ field: 'tokens / cost_api_equivalent_usd', kind: 'missing', note: `session.tokens_coverage = "${session.tokens_coverage}" — ccusage pre/post snapshots weren't available for this run; token/cost totals can't be trusted` });
  } else if (session.tokens_coverage === 'full_session_unscoped') {
    flags.push({ field: 'tokens / cost_api_equivalent_usd', kind: 'defaulted', note: 'session.tokens_coverage = "full_session_unscoped" — scoped to no single session id; may include other concurrent Claude Code sessions on this machine' });
  }

  // Sum of all four token types below — shared by `tokens_total` and by
  // `cache_read_share_pct_tokens`'s denominator (see both fields' own
  // comments on the row object).
  const tokensTotal = session.input_tokens != null
    ? (session.input_tokens ?? 0) + (session.output_tokens ?? 0)
      + (session.cache_read_input_tokens ?? 0) + (session.cache_creation_input_tokens ?? 0)
    : null;

  const row = {
    work_item_ref: workItemRef,
    work_item_level: 'suite',
    work_item_brief: workItemBrief,
    maturity,
    size_tshirt: sizeTshirt,
    effort_days: effortDays,
    sessions: 1, // one benchmark run = one continuous Claude Code session by
                 // construction (benchmark-session-start no-ops on resume/
                 // compact) — not worth plumbing further right now.
    turns: session.turns ?? null,
    subagent_dispatches: session.subagent_dispatches ?? null,
    orchestrator_cost_pct: session.orchestrator_cost_pct ?? null,
    tokens: {
      input: session.input_tokens ?? null,
      output: session.output_tokens ?? null,
      cache_read: session.cache_read_input_tokens ?? null,
      cache_create: session.cache_creation_input_tokens ?? null,
    },
    // Single-number total across all four token types above — same
    // null-when-uncertain rule as `tokens`: null unless we actually have
    // ccusage coverage for this run (session.input_tokens is the same
    // presence check the MISSING/DEFAULTED flags above already use).
    tokens_total: tokensTotal,
    primary_model: primaryModel,
    models_used: modelsUsed,
    cost_api_equivalent_usd: session.cost_usd ?? null,
    // Cache-read COST share (computed in build-run-metrics.mjs — see there
    // for the exact per-model pricing loop). Formula: for every model used
    // this session, price its cache_read tokens at that model's own
    // $/M-token cache-read rate, sum those across models, then divide by
    // the total estimated cost across ALL FOUR token types (input+output+
    // cache_create+cache_read) for those same models. Always LOWER than
    // cache_read_share_pct_tokens below — cache reads are priced far
    // cheaper per-token than fresh input (e.g. sonnet: $0.30/M cache-read
    // vs $3.00/M input, 10x) — confirmed intentional, not a bug.
    cache_read_share_pct: session.cache_read_share_pct ?? null,
    // Cache-read TOKEN share — companion metric, no pricing involved:
    // cache_read / tokens_total * 100 (same four-type total as tokens_total
    // above). Always HIGHER than cache_read_share_pct above, for the same
    // pricing-asymmetry reason.
    cache_read_share_pct_tokens: (tokensTotal != null && tokensTotal > 0 && session.cache_read_input_tokens != null)
      ? round((session.cache_read_input_tokens / tokensTotal) * 100, 1)
      : null,
    scenarios_authored: scenariosAuthored,
    scenarios_automated: scenariosAutomated,
    scenarios_executed: summary.total ?? null,
    scenario_complexity: scenarioComplexity,
    env_setup: envSetup,
    // Optional extras
    //
    // wall_clock_h is FULL session calendar time (session start -> Stop hook),
    // by design — includes any idle/pre-flight gap before the first dispatch,
    // not just active test-execution time. A large value (e.g. tens of hours
    // for a short suite) usually means the session sat open a long time before
    // work started, not that testing itself took that long; cross-check
    // against session.duration_ms (tracked: first dispatch -> end) or the
    // report's own "Timing Breakdown" table before treating this as effort.
    wall_clock_h: session.total_session_duration_ms != null ? round(session.total_session_duration_ms / 3.6e6, 2) : null,
    tokens_by_model: tokensByModel,
    // Not part of the tokenomics-dataset schema — extra diagnostic breakdown
    // by real agent persona (test-runner/test-sizer/test-author/app-profiler/
    // test-reporter/test-run-lead), see build-run-metrics.mjs's
    // aggregateByAgentType(). test-run-lead's own entry (if present) is a
    // computed remainder, not a direct measurement — same caveat as
    // orchestrator_cost_pct above. duration_h (not duration_ms) for the same
    // readability reason as wall_clock_h — see withDurationHours() above.
    tokens_by_agent: withDurationHours(session.tokens_by_agent),
    notes: `Generated from ${basename(metricsPath)} by build-tokenomics-report.mjs. Internal report — not yet a dataset submission.`,
  };

  // Name the output after the *source file*, not the embedded run_id — a
  // renamed/backup copy of a metrics file could otherwise duplicate another
  // run's embedded run_id and silently overwrite its tokenomics export.
  const sourceBasename = basename(metricsPath).replace(/\.json$/, '');
  const outPath = join(TOKENOMICS_DIR, `${sourceBasename}.tokenomics.json`);
  writeFileSync(outPath, JSON.stringify(row, null, 2) + '\n');
  console.log(`\n[build-tokenomics-report] wrote ${outPath}`);

  // --- Self-validation checklist (mirrors the guide's own §7) ---

  const missing = flags.filter(f => f.kind === 'missing');
  const defaulted = flags.filter(f => f.kind === 'defaulted');

  console.log(`  run_id: ${runId}  |  work_item_brief: ${workItemBrief}`);
  if (missing.length) {
    anyMissing = true;
    console.log(`  ❌ MISSING (${missing.length}) — required, no safe default:`);
    for (const f of missing) console.log(`     - ${f.field}: ${f.note}`);
  }
  if (defaulted.length) {
    console.log(`  ⚠️  DEFAULTED (${defaulted.length}) — review before trusting this row:`);
    for (const f of defaulted) console.log(`     - ${f.field}: ${f.note}`);
  }
  if (!missing.length && !defaulted.length) {
    console.log('  ✅ all fields present from frontmatter/telemetry, nothing defaulted');
  }
}

if (anyMissing) {
  console.log('\n[build-tokenomics-report] one or more rows have required fields missing — add the noted frontmatter keys to the RUN-*.md report(s) and re-run to fill them in.');
}
