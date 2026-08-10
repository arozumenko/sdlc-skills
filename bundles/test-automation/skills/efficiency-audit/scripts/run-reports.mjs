#!/usr/bin/env node
// run-reports.mjs — join the batch pipeline's own run reports to the spend
// rollup, so "cost per case" is MEASURED rather than typed in by hand.
//
// The two halves of that number already existed and never met. The pipeline
// writes `.agents/automation/<slug>/report.json` — one row per input case, with
// the outcome it actually reached and the branch it was built on. The audit
// meters every dollar. Between them sat `--resolved N`, an operator typing a
// count from memory, which is the one input in the whole chain nothing checks.
//
// What this module refuses to do is as important as what it does:
//
//   - It reports TWO denominators, never one. `automated` cases are the specs
//     that shipped; every case that entered the batch consumed analysis whether
//     it shipped or not. $/delivered answers "what did a spec cost me";
//     $/examined answers "what does putting a case through this cost". A single
//     "cost per case" figure is always one of these two wearing the other's
//     name.
//   - It measures how much of the spend it can actually TIE to these batches,
//     via the branches in the report, and says so. A rollup window holding three
//     months of unrelated work divided by one batch's cases is a number that
//     survives exactly one question.
//
// HOST-NEUTRAL, AND NOT A WORKFLOW FEATURE. It reads a FILE, so it does not
// care what produced it. The batch workflow writes report.json on Claude Code;
// on a runner with no workflow the lead writes the same file by hand at close;
// the lead rebuilds it from receipts + journal + git evidence. All three
// arrive here identically.
//
// The contract is deliberately tiny — `cases[]`, each row with an `id` and an
// `outcome`. Everything else (batch name, integration branch, gate verdict,
// per-case branch, quota flag) sharpens the report and none of it is required,
// because a contract a human cannot satisfy by hand is a contract that only
// works on one host. What the extras buy is said where they are used; what
// their absence costs is said in the output, never assumed away.
//
// STDLIB ONLY. Read-only: it opens report.json files and nothing else.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, basename, dirname } from 'node:path';

// The one outcome that produced a spec. The other five (`already-covered`,
// `out-of-scope`, `un-automatable`, `blocked`, `not-started`) are legitimate
// endings that consumed real analysis and delivered no test — which is exactly
// why they belong in the examined denominator and not the delivered one.
export const DELIVERED = 'automated';

/** Every report.json under a project's automation dir, plus direct paths. */
export function findReports(target) {
  if (!target) return [];
  if (!existsSync(target)) return [];
  const st = statSync(target);
  if (st.isFile()) return [target];
  // Walk the WHOLE tree under the target: campaigns nest batch reports in
  // sub-folders (.agents/automation/<campaign>/<wave>/report.json), so a
  // one-level scan silently under-counts any campaign that uses them —
  // field-flagged twice (2026-08-04 and 2026-08-06 audits) before this fix.
  // Dirent.isDirectory() does not follow symlinks, so a link cycle can't loop.
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'report.json') out.push(p);
    }
  };
  walk(target);
  return out;
}

function outcomeOf(row) {
  return typeof row?.outcome === 'string' && row.outcome ? row.outcome : 'not-started';
}

/**
 * Read run reports and fold them into one delivery picture.
 *
 * Batches are folded in mtime order and a case id seen twice keeps its LATEST
 * outcome. Re-entry is normal — a case reported `blocked` on a product ticket
 * comes back in a later wave and gets automated — and summing the raw rows
 * would count it as two cases, inflating the examined denominator and making
 * the pipeline look cheaper per case the more often it had to retry. The count
 * of re-entries is kept and reported, because it is a real efficiency signal in
 * its own right.
 */
export function readRunReports(paths) {
  const batches = [];
  const warnings = [];
  for (const path of paths) {
    let raw;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
      warnings.push(`${path}: unreadable (${e.message}) — skipped`);
      continue;
    }
    if (!raw || !Array.isArray(raw.cases)) {
      warnings.push(`${path}: no cases[] — not a batch report, skipped`);
      continue;
    }
    let mtimeMs = 0;
    try { mtimeMs = statSync(path).mtimeMs; } catch { /* keep 0 */ }
    batches.push({
      slug: raw.batch || basename(dirname(path)),
      path,
      mtimeMs,
      gate: raw.gate?.verdict ?? null,
      integrationBranch: raw.integration_branch || null,
      quotaHalted: raw.quota_halted === true,
      cases: raw.cases,
    });
  }
  batches.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const latest = new Map();      // case id -> {outcome, branch, slug}
  let reentered = 0;
  for (const b of batches) {
    for (const row of b.cases) {
      if (!row?.id) continue;
      if (latest.has(row.id)) reentered += 1;
      latest.set(row.id, { outcome: outcomeOf(row), branch: row.branch || null, slug: b.slug });
    }
  }

  const outcomes = {};
  const branches = new Set();
  for (const b of batches) if (b.integrationBranch) branches.add(b.integrationBranch);
  for (const v of latest.values()) {
    outcomes[v.outcome] = (outcomes[v.outcome] ?? 0) + 1;
    if (v.branch) branches.add(v.branch);
  }

  const stamps = batches.map((b) => b.mtimeMs).filter(Boolean);
  // File mtime, not a field: the report carries no timestamp of its own (the
  // workflow that builds it cannot call a clock). It is the moment the run
  // closed, which is right — and it is destroyed by a fresh clone or a checkout
  // that rewrites the file. Callers that compare it to a spend window must say
  // where it came from.
  const window = stamps.length
    ? { fromMs: Math.min(...stamps), toMs: Math.max(...stamps), source: 'report file mtime' }
    : null;

  if (batches.some((b) => b.quotaHalted)) {
    warnings.push('at least one batch halted on an account ceiling — its cases stopped short of their real outcome, so the delivered count is a floor, not a total');
  }

  return {
    batches: batches.map(({ cases, ...meta }) => ({ ...meta, caseCount: cases.length })),
    outcomes,
    casesEntered: latest.size,
    delivered: outcomes[DELIVERED] ?? 0,
    reentered,
    branches: [...branches].sort(),
    window,
    warnings,
  };
}

/**
 * How much of a rollup's spend can be tied to these batches by branch.
 *
 * This is a floor, deliberately, and the reason is structural: analysts are
 * forbidden from touching git (they write their AFS and leave it), so their
 * units sit on whatever branch the tree was on — usually the base. The
 * orchestrator likewise never leaves its own branch. So branch matching sees
 * implementers, reviewers and the gate, and is blind to the entire analysis
 * phase, which is a large share of a batch's cost.
 *
 * That makes it useless as an attribution mechanism and valuable as a DILUTION
 * check: if the units that demonstrably touched this batch's branches account
 * for a sliver of the window's dollars, the window is mostly other work, and
 * dividing all of it by these cases is not a cost per case. Low coverage is a
 * reason to narrow `--since/--until`, not a number to report.
 */
export function branchCoverage(ledger = [], branches = []) {
  const want = new Set(branches.filter(Boolean));
  let matchedUsd = 0, totalUsd = 0, matchedUnits = 0, pricedUnits = 0, ledgerBranched = 0;
  for (const u of ledger) {
    const usd = typeof u.costUsd === 'number' ? u.costUsd : 0;
    totalUsd += usd;
    if (typeof u.costUsd === 'number') pricedUnits += 1;
    // `'?'` is what a host writes when it could not read a branch at all — it
    // is not a branch name and must never be matched against one.
    const branch = u.gitBranch && u.gitBranch !== '?' ? u.gitBranch : null;
    if (branch) ledgerBranched += 1;
    if (branch && want.has(branch)) { matchedUsd += usd; matchedUnits += 1; }
  }
  // NOT RUN vs RAN AND MATCHED NOTHING — and the check needs BOTH sides to
  // have branches before it can conclude anything.
  //
  //   - The reports may name none: a report written by hand at close, which is
  //     the normal shape on a host with no workflow.
  //   - The ledger may carry none: a host that does not record the branch a
  //     unit ran on.
  //
  // In either case there was no comparison, and reporting that as 0% would
  // accuse a perfectly good report of proving the spend unrelated to the work.
  const comparable = want.size > 0 && ledgerBranched > 0 && totalUsd > 0;
  return {
    matchedUsd, totalUsd, matchedUnits, pricedUnits,
    branchesKnown: want.size, ledgerBranched, comparable,
    share: comparable ? matchedUsd / totalUsd : null,
  };
}

/**
 * The delivery block that rides into the rollup's markdown, JSON snapshot and
 * HTML report. `costUsd` is the window's metered total — this only divides it.
 */
export function summarizeDelivery(delivery, costUsd, { rollupDays = [], coverage = null } = {}) {
  const warnings = [...delivery.warnings];
  const perDelivered = delivery.delivered > 0 && typeof costUsd === 'number'
    ? costUsd / delivery.delivered : null;
  const perExamined = delivery.casesEntered > 0 && typeof costUsd === 'number'
    ? costUsd / delivery.casesEntered : null;

  // A run that closed outside the metered window is being divided by spend that
  // did not pay for it. This is the failure mode that makes the whole number
  // worthless, and it is silent — both halves look fine on their own.
  if (delivery.window && rollupDays.length) {
    const days = [...rollupDays].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (days.length) {
      const from = Date.parse(`${days[0]}T00:00:00`);
      const to = Date.parse(`${days[days.length - 1]}T23:59:59`);
      const outside = delivery.window.toMs < from || delivery.window.fromMs > to;
      if (outside) {
        warnings.push(
          `the run reports closed outside the metered window (${days[0]}..${days[days.length - 1]}) — `
          + 'these cases were not paid for by this spend; scope --since/--until to the run, or drop the per-case figures');
      }
    }
  }
  if (delivery.delivered === 0 && delivery.casesEntered > 0) {
    warnings.push('no case reached `automated` — there is a cost per case examined, but nothing was delivered to divide by');
  }
  // Zero is the one coverage figure that needs no threshold to interpret. Some
  // of a batch's cost is unmatchable by construction (analysts and the
  // orchestrator never leave their branch), so a small share proves nothing —
  // but not ONE priced unit sitting on a branch these reports name means the
  // join found no evidence at all that this spend paid for these cases. The
  // ratios above are then two unrelated numbers divided by each other.
  if (coverage && coverage.comparable && coverage.share === 0) {
    warnings.push(
      'no priced unit in this window sits on a branch these reports name — nothing ties this spend to these cases. '
      + 'Scope --since/--until to the run, or point --resolved-from at the batches this window actually covers; '
      + 'the per-case figures are not usable as they stand');
  }
  return { perDelivered, perExamined, warnings };
}

/**
 * One object in, markdown out. `d` is a readRunReports() result merged with a
 * summarizeDelivery() result and, optionally, `coverage` from branchCoverage().
 */
export function renderDeliveryMarkdown(d) {
  const coverage = d.coverage;
  const usd = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : 'n/a');
  const out = ['## What the money bought', ''];
  out.push(`- Cases examined: **${d.casesEntered}** across ${d.batches.length} batch(es)`
    + (d.reentered ? `  ·  ${d.reentered} re-entry(ies) folded (a case counts once, at its latest outcome)` : ''));
  const parts = Object.entries(d.outcomes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
  if (parts.length) out.push(`- Outcomes: ${parts.join('  ·  ')}`);
  out.push(`- **Cost per spec delivered: ${usd(d.perDelivered)}** (${d.delivered} automated)`);
  out.push(`- Cost per case examined: ${usd(d.perExamined)} (${d.casesEntered} entered)`);
  out.push('');
  out.push('Both are the same dollars over different denominators, and they answer different questions:'
    + ' *what did a shipped spec cost* versus *what does putting a case through this pipeline cost*.'
    + ' A case that ended `out-of-scope` still consumed analysis, which is why it is in the second and not the first.');
  if (coverage && coverage.share != null) {
    out.push('');
    out.push(`- Spend on branches these batches name: ${usd(coverage.matchedUsd)} of ${usd(coverage.totalUsd)}`
      + ` (${Math.round(coverage.share * 100)}%), ${coverage.matchedUnits} unit(s).`
      + ' A floor: analysts never touch git, so their cost cannot be matched this way. Read it as a dilution check —'
      + ' a low share means the window mostly paid for other work and the per-case figures above are diluted.');
  } else if (coverage && !coverage.comparable) {
    const why = coverage.branchesKnown === 0
      ? 'these reports name no branches'
      : 'no unit in this window records the branch it ran on';
    out.push('');
    out.push(`- Dilution check not run: ${why}, so there is nothing to match the spend against.`
      + ' Scope `--since`/`--until` to the run yourself — the per-case figures above assume this window'
      + ' is the run, and nothing here confirms that.');
  }
  for (const w of (d.warnings || [])) out.push(`- ⚠️ ${w}`);
  out.push('');
  return out.join('\n');
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.error(`run-reports.mjs — delivery counts from the batch pipeline's own run reports

usage: node run-reports.mjs [--from <path>] [--json]
  --from <path>   a report.json, a batch dir, or the automation root
                  (default: .agents/automation)
  --json          print the delivery object instead of a summary

Feed it into the audit with:  usage-rollup.mjs --resolved-from <path>`);
    process.exit(0);
  }
  const from = arg(argv, '--from') || join('.agents', 'automation');
  const paths = findReports(from);
  if (!paths.length) {
    console.error(`no report.json found under ${from}`);
    process.exit(3);
  }
  const delivery = readRunReports(paths);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(delivery, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderDeliveryMarkdown({ ...delivery, ...summarizeDelivery(delivery, null) }) + '\n');
}

// pathToFileURL, not a hand-built `file://` template — the literal comparison
// never matches on Windows or on paths containing spaces, making the CLI a
// silent no-op there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
