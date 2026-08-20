#!/usr/bin/env node
// build-training-set.mjs — Mode 4 step 1: reconstruct per-case ground truth
// (tier, steps, cost, active-min, verified outcome) from what the pipeline
// already produces, for calibrate.mjs to consume. See
// ../references/calibration-methodology.md § Step 1.
//
// Inputs (nothing new to capture, both already produced elsewhere):
//   - .agents/automation/**/report.json  (recursive — campaigns nest batches)
//   - a `usage-rollup.mjs --json` rollup from the efficiency-audit skill,
//     passed via --ledger (cost/time join by gitBranch)
// STDLIB ONLY.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyTier, countSteps, loadTaxonomy } from './score-cases.mjs';

function findReportFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'report.json') out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function loadLedger(ledgerPath) {
  if (!ledgerPath) return [];
  const raw = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  // Accept either the full `usage-rollup.mjs --json` envelope or a bare
  // rollup/ledger array — be liberal in what's accepted, this file is
  // produced by a different skill and its exact wrapping may drift.
  return raw.rollup?.ledger || raw.ledger || (Array.isArray(raw) ? raw : []);
}

// Sum cost/time for every ledger unit whose gitBranch matches `branch`.
function sumByBranch(ledger, branch) {
  if (!branch) return { cost: 0, min: 0, n: 0 };
  const units = ledger.filter((u) => u.gitBranch === branch);
  return {
    cost: units.reduce((a, u) => a + (u.costUsd || 0), 0),
    min: units.reduce((a, u) => a + (u.durationMin || 0), 0),
    n: units.length,
  };
}

// A campaign can nest its batches in subfolders while keeping ONE shared
// `cases/` snapshot directory at the campaign level (confirmed in the wild:
// a 50-case campaign's two `wave-*/report.json` files each sit in their own
// subfolder, but all 50 case snapshots live in `cases/` one level up, at
// the campaign root — the same nesting `--resolved-from`'s shallow glob
// already warned about for `report.json` itself). Walk from the report's
// own directory UP toward (and including) `automationDir`, trying
// `<dir>/cases/<id>.md` at each level — nearest (most specific) match wins,
// so a batch-local `cases/` still shadows a campaign-level one of the same
// name if both happen to exist.
function findCaseSnapshot(batchDir, automationDir, id) {
  let dir = resolve(batchDir);
  const root = resolve(automationDir);
  const tried = [];
  // Bound the walk to the automationDir root — never wander above it.
  while (true) {
    const casesDir = join(dir, 'cases');
    tried.push(casesDir);
    if (existsSync(casesDir)) {
      const direct = join(casesDir, `${id}.md`);
      if (existsSync(direct)) return direct;
      // Tolerate a differently-cased or slug-suffixed filename.
      const hit = readdirSync(casesDir).find((f) => f.toLowerCase().startsWith(id.toLowerCase()));
      if (hit) return join(casesDir, hit);
    }
    if (dir === root || dir === dirname(dir)) break; // reached the root, or the filesystem root
    dir = dirname(dir);
  }
  return null;
}

function verifyOutcome(id, base, cwd) {
  try {
    const out = execFileSync('git', ['log', base, '--grep', id, '--oneline'], { cwd, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return null; // not a git repo reachable from cwd, or base ref unknown — don't guess
  }
}

export function buildTrainingSet({ automationDir, ledgerPath, repoRoot, taxonomy }) {
  const ledger = loadLedger(ledgerPath);
  const reportFiles = findReportFiles(automationDir);
  const rows = [];
  let nCases = 0, nPriced = 0, nVerified = 0, nUnverified = 0, nMissingBranchField = 0;

  for (const reportPath of reportFiles) {
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { continue; }
    const batchDir = dirname(reportPath);
    const cases = report.cases || [];
    const base = report.base || 'main';
    const integrationBranch = report.integration_branch;
    const batchCaseCount = cases.length || 1;

    // Shared batch-trunk overhead pool, split evenly across this batch's cases.
    const trunkPool = integrationBranch ? sumByBranch(ledger, integrationBranch) : { cost: 0, min: 0, n: 0 };
    const trunkShareCost = trunkPool.cost / batchCaseCount;
    const trunkShareMin = trunkPool.min / batchCaseCount;

    // How many of THIS report's cases share each branch — a cluster dispatch
    // (test-case-analysis § Cluster dispatches: several cases, one analyst
    // session, one implementer branch/PR, separate specs OR one family AFS)
    // puts N case ids on one branch. sumByBranch() below returns that
    // branch's FULL cost for every case that shares it — divide by the
    // cluster size or every clustered case's cost gets counted N times over
    // (confirmed in the wild: a real 3-case cluster otherwise reported the
    // same $13.83 for all three, which is the branch's total, not each
    // case's share — see calibration-methodology.md § Cluster cost sharing).
    const branchCaseCounts = {};
    for (const c of cases) { if (c.branch) branchCaseCounts[c.branch] = (branchCaseCounts[c.branch] || 0) + 1; }

    for (const c of cases) {
      nCases += 1;
      const snapshotPath = findCaseSnapshot(batchDir, automationDir, c.id);
      const text = snapshotPath ? readFileSync(snapshotPath, 'utf8') : (c.note || c.id);
      const tier = classifyTier(text, taxonomy.interaction_tiers);
      const { steps, estimated: stepsEstimated } = countSteps(text);

      const clusterSize = c.branch ? (branchCaseCounts[c.branch] || 1) : 1;
      const branchPool = c.branch ? sumByBranch(ledger, c.branch) : { cost: 0, min: 0, n: 0 };
      const branchCost = { cost: branchPool.cost / clusterSize, min: branchPool.min / clusterSize, n: branchPool.n };
      // COST REQUIRES REAL BRANCH-SPECIFIC LEDGER EVIDENCE (branchCost.n > 0),
      // full stop — never just a nonzero trunk pool. A `report.json` case
      // entry with no `branch` field at all (confirmed in the wild: 20 of 83
      // real-outcome cases in one project, 24%) previously fell through to
      // "hasCost = trunkPool.n > 0", silently reporting the batch's per-case
      // trunk-share alone as if it were the case's full cost — one such case
      // (a "solo" async-realtime case) reported $3.09 against a hand-verified
      // true cost of $34.48, an 11x undercount that would have biased that
      // tier's calibrated mean down. See calibration-methodology.md § Known
      // limitation: cases with no recorded branch.
      const hasReliableCost = branchCost.n > 0;
      const costUsd = hasReliableCost ? round2(branchCost.cost + trunkShareCost) : null;
      const activeMin = hasReliableCost ? round1(branchCost.min + trunkShareMin) : null;
      // Floor-only estimate for the no-branch-evidence case, kept SEPARATE
      // from costUsd (never fed into bucket_stats/calibration) — it's a
      // known-incomplete lower bound (trunk overhead only, dedicated
      // implement+review cost entirely missing), useful for a human to see
      // but not to average.
      const trunkOnlyCostUsd = (!hasReliableCost && trunkPool.n > 0) ? round2(trunkShareCost) : null;
      const trunkOnlyActiveMin = (!hasReliableCost && trunkPool.n > 0) ? round1(trunkShareMin) : null;
      if (costUsd !== null) nPriced += 1;
      if (!c.branch && (c.outcome === 'automated' || c.outcome === 'blocked')) nMissingBranchField += 1;

      let outcomeVerified = null;
      if (repoRoot && c.branch) {
        outcomeVerified = verifyOutcome(c.id, base, repoRoot);
        if (outcomeVerified === true) nVerified += 1;
        else if (outcomeVerified === false) nUnverified += 1;
      }

      rows.push({
        id: c.id,
        batch: report.batch || basename(batchDir),
        tier: tier.id,
        steps,
        stepsEstimated,
        costUsd,
        activeMin,
        clusterSize,
        noBranchField: !c.branch,
        trunkOnlyCostUsd,
        trunkOnlyActiveMin,
        reportedOutcome: c.outcome,
        outcomeVerified,
        reworkSignal: /re-review|fix round|fix-only|stabilize|round 2|round 3/i.test(c.note || ''),
      });
    }
  }

  return {
    rows,
    summary: {
      reportFilesFound: reportFiles.length,
      nCasesSeen: nCases,
      nPriced,
      nUnpriced: nCases - nPriced,
      nMissingBranchField,
      nOutcomeVerified: nVerified,
      nOutcomeUnverifiedOrLagging: nUnverified,
      note: 'nUnpriced is real, not lost — see calibration-methodology.md § Step 1 (branch join can legitimately come up empty). nMissingBranchField cases had NO `branch` field on the report.json case entry at all — costUsd is null for these (not a misleading trunk-only floor); see each row\'s trunkOnlyCostUsd for the known-incomplete lower bound, and calibration-methodology.md § Known limitation: cases with no recorded branch. nOutcomeUnverifiedOrLagging cases had a branch but no merge commit found on base matching the id — could mean genuinely not merged, or a report.json snapshot that lagged the real outcome (see SKILL.md anti-patterns) — inspect before trusting reportedOutcome for those rows.',
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node build-training-set.mjs [options]
  --automation-dir <dir>   default: .agents/automation
  --ledger <rollup.json>   from: node usage-rollup.mjs --json > rollup.json  (efficiency-audit skill)
  --repo-root <dir>        where to run 'git log' for outcome verification (default: cwd; omit to skip verification)
  --taxonomy <path>        override taxonomy JSON for tier classification (default: project-local, else bundled)
  --out <path>             default: training-set.json`);
    process.exit(0);
  }
  const flag = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
  const automationDir = resolve(flag('--automation-dir', '.agents/automation'));
  const ledgerPath = flag('--ledger');
  const repoRoot = flag('--repo-root', process.cwd());
  const outPath = flag('--out', 'training-set.json');
  const { taxonomy } = loadTaxonomy(flag('--taxonomy'));

  if (!existsSync(automationDir)) {
    console.error(`No such directory: ${automationDir}`);
    process.exit(1);
  }

  const result = buildTrainingSet({ automationDir, ledgerPath, repoRoot, taxonomy });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(result.summary, null, 2));
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
