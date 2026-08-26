#!/usr/bin/env node
// Compare two or more benchmark metrics JSON files.
//
// Usage:
//   node scripts/compare-runs.mjs reports/metrics/RUN-A.json reports/metrics/RUN-B.json
//
// Output: Markdown comparison table to stdout.

import { readFileSync } from 'fs';

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('Usage: node scripts/compare-runs.mjs <run-a.json> <run-b.json> [run-c.json ...]');
  process.exit(1);
}

function loadRun(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Failed to read ${path}: ${e.message}`);
    process.exit(1);
  }
}

const runs = files.map(loadRun);

function fmt(val, unit = '') {
  if (val == null) return 'n/a';
  if (unit === 'ms') {
    const s = Math.floor(val / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}m ${rem}s` : `${s}s`;
  }
  if (unit === '%') return `${val}%`;
  if (unit === 'tokens') return val.toLocaleString('en-US');
  return String(val);
}

function orchestrationOverhead(run) {
  const sessionTotal = run.session?.total_tokens;
  const tcSum = (run.tcs ?? []).reduce((s, t) => s + (t.tokens ?? 0), 0);
  if (!sessionTotal || !tcSum) return null;
  return Math.round(((sessionTotal - tcSum) / sessionTotal) * 1000) / 10;
}

function totalSteps(run) {
  // Steps not stored in metrics JSON — approximate from TC count * avg steps
  return (run.tcs ?? []).length;
}

function tokensPerStep(run) {
  const total = run.session?.total_tokens;
  const steps = totalSteps(run);
  if (!total || !steps) return null;
  return Math.round(total / steps);
}

function toolUsesPerStep(run) {
  const total = run.session?.total_tool_uses;
  const steps = totalSteps(run);
  if (!total || !steps) return null;
  return Math.round((total / steps) * 10) / 10;
}

const rows = [
  ['Pass rate',              r => fmt(r.summary?.pass_rate, '%')],
  ['Total tokens (session)', r => fmt(r.session?.total_tokens, 'tokens')],
  ['Input tokens',           r => fmt(r.session?.input_tokens, 'tokens')],
  ['Output tokens',          r => fmt(r.session?.output_tokens, 'tokens')],
  ['Cache creation tokens',  r => fmt(r.session?.cache_creation_input_tokens, 'tokens')],
  ['Cache read tokens',      r => fmt(r.session?.cache_read_input_tokens, 'tokens')],
  ['Tokens / TC (sub-agent)',r => fmt(r.summary?.avg_tokens_per_tc, 'tokens')],
  ['Tokens / step (est.)',   r => fmt(tokensPerStep(r), 'tokens')],
  ['Total tool uses',        r => fmt(r.session?.total_tool_uses)],
  ['Tool uses / TC',         r => fmt(r.summary?.avg_tool_uses_per_tc)],
  ['Tool uses / step (est.)',r => fmt(toolUsesPerStep(r))],
  ['Duration (total)',       r => fmt(r.session?.duration_ms, 'ms')],
  ['Avg duration / TC',      r => {
    const ms = r.summary?.avg_duration_per_tc_s;
    return ms != null ? `${ms}s` : 'n/a';
  }],
  ['Orchestration overhead', r => fmt(orchestrationOverhead(r), '%')],
  ['tokens_coverage',        r => {
    const c = r.session?.tokens_coverage;
    return c === 'subagents_only' ? `${c} ⚠️` : (c ?? 'n/a');
  }],
];

// Header
const headers = ['Metric', ...runs.map(r => `${r.agent_system ?? 'unknown'}\n(${r.run_id ?? '?'})`)];
const colW = headers.map((h, i) => {
  const maxVal = Math.max(...rows.map(([, fn]) => fn(runs[i - 1] ?? runs[0]).length));
  return Math.max(h.split('\n')[0].length, maxVal, 10);
});

function padEnd(s, n) { return s + ' '.repeat(Math.max(0, n - s.length)); }

// Print table
const headerLine = '| ' + headers.map((h, i) => padEnd(h.split('\n')[0], colW[i])).join(' | ') + ' |';
const sepLine    = '|-' + colW.map(w => '-'.repeat(w)).join('-|-') + '-|';

console.log(headerLine);
console.log(sepLine);
for (const [label, fn] of rows) {
  const cells = [padEnd(label, colW[0]), ...runs.map((r, i) => padEnd(fn(r), colW[i + 1]))];
  console.log('| ' + cells.join(' | ') + ' |');
}
