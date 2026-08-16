#!/usr/bin/env node
/**
 * visual-diff.mjs — diff freshly-captured screenshots against committed baselines.
 *
 * A thin wrapper over `reg-cli` (MIT, browser-free). Capture is NOT this script's
 * job — the agent screenshots each generated page with whatever browser tool it
 * has (no headless engine is bundled) into <current>/. This script only compares
 * <current> against <baseline>, writes a diff dir + HTML/JSON report, prints a
 * summary, and sets a non-zero exit code when anything changed.
 *
 *   node visual-diff.mjs --current <dir> --baseline <dir> --diff <dir> [--update]
 *
 * reg-cli is resolved local-first, then `npx --yes reg-cli@latest` (the same
 * fallback the repo uses for ccusage) — so nothing is added to package.json.
 * STDLIB ONLY (+ reg-cli shelled out). See ../SKILL.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Build the reg-cli argv. `bin==='npx'` prepends the package spec. */
export function buildRegArgs({ bin = 'npx', current, baseline, diff, report, json, update = false }) {
  const base = bin === 'npx' ? ['--yes', 'reg-cli@latest'] : [];
  const args = [...base, current, baseline, diff];
  if (report) args.push('-R', report);
  if (json) args.push('-J', json);
  args.push('-A'); // --enableAntialias: tolerate font/sub-pixel rasterization noise
  if (update) args.push('-U');
  return args;
}

/** Turn reg-cli's JSON report into a pass/fail summary. Missing arrays count as 0. */
export function summarize(report, { update = false } = {}) {
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  const counts = {
    failed: n(report && report.failedItems),
    new: n(report && report.newItems),
    deleted: n(report && report.deletedItems),
    passed: n(report && report.passedItems),
  };
  const changed = counts.failed + counts.new + counts.deleted;
  const ok = update || changed === 0;
  const message = update
    ? `baselines updated (${counts.passed + counts.failed + counts.new} images)`
    : ok
      ? `visual OK — ${counts.passed} matched, no changes`
      : `visual CHANGES — ${counts.failed} changed, ${counts.new} new, ${counts.deleted} deleted, ${counts.passed} matched`;
  return { ok, counts, message };
}

/** Is a local `reg-cli` on PATH? (avoid the npx round-trip when it is) */
export function hasLocalRegCli() {
  try {
    execFileSync('reg-cli', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Run reg-cli and return the summary. `runner` is injectable for tests. */
export function runVisualDiff(opts, runner = defaultRunner) {
  const bin = opts.bin || (hasLocalRegCli() ? 'reg-cli' : 'npx');
  const json = opts.json || join(opts.diff, 'report.json');
  const report = opts.report || join(opts.diff, 'report.html');
  mkdirSync(opts.diff, { recursive: true });
  const args = buildRegArgs({ ...opts, bin, json, report });
  try {
    runner(bin, args);
  } catch {
    // reg-cli returns a non-zero exit code when images differ; that is not an
    // error for us — the JSON report below is the source of truth. Swallow it
    // here (not in the runner) so an injected runner gets the same guarantee.
  }
  const parsed = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : {};
  return summarize(parsed, { update: !!opts.update });
}

function defaultRunner(bin, args) {
  execFileSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

function parseCli(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    current: get('--current'),
    baseline: get('--baseline'),
    diff: get('--diff') || 'visual-diff',
    update: argv.includes('--update'),
  };
}

// CLI entry (only when run directly, not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseCli(process.argv.slice(2));
  if (!opts.current || !opts.baseline) {
    console.error('usage: visual-diff.mjs --current <dir> --baseline <dir> [--diff <dir>] [--update]');
    process.exit(2);
  }
  const s = runVisualDiff(opts);
  console.log(s.message);
  process.exit(s.ok ? 0 : 1);
}
