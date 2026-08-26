import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTrainingSet } from './build-training-set.mjs';
import { loadTaxonomy } from './score-cases.mjs';

const { taxonomy } = loadTaxonomy();

function setupProject({ batchName, cases, ledgerUnits }) {
  const dir = mkdtempSync(join(tmpdir(), 'training-set-test-'));
  const batchDir = join(dir, 'automation', batchName);
  const casesDir = join(batchDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  for (const c of cases) {
    writeFileSync(join(casesDir, `${c.id}.md`), `---\nid: ${c.id}\nmodule: test\n---\n\nSubmit the form and verify the table.`);
  }
  writeFileSync(join(batchDir, 'report.json'), JSON.stringify({
    batch: batchName, base: 'main', integration_branch: null, cases,
  }));
  const ledgerPath = join(dir, 'ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({ ledger: ledgerUnits }));
  return { automationDir: join(dir, 'automation'), ledgerPath, dir };
}

test('buildTrainingSet: a solo case gets its branch cost undivided', () => {
  const { automationDir, ledgerPath, dir } = setupProject({
    batchName: 'b1',
    cases: [{ id: 'CASE-1', outcome: 'automated', branch: 'tests/case-1' }],
    ledgerUnits: [{ gitBranch: 'tests/case-1', costUsd: 10, durationMin: 40 }],
  });
  const { rows } = buildTrainingSet({ automationDir, ledgerPath, repoRoot: null, taxonomy });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].costUsd, 10);
  assert.equal(rows[0].clusterSize, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('buildTrainingSet: a 3-case cluster on one branch divides the branch cost by 3, not triples it', () => {
  const { automationDir, ledgerPath, dir } = setupProject({
    batchName: 'b2',
    cases: [
      { id: 'CASE-A', outcome: 'automated', branch: 'tests/cluster' },
      { id: 'CASE-B', outcome: 'automated', branch: 'tests/cluster' },
      { id: 'CASE-C', outcome: 'automated', branch: 'tests/cluster' },
    ],
    ledgerUnits: [{ gitBranch: 'tests/cluster', costUsd: 30, durationMin: 90 }],
  });
  const { rows } = buildTrainingSet({ automationDir, ledgerPath, repoRoot: null, taxonomy });
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.costUsd, 10); // 30 / 3, not 30 each
    assert.equal(r.clusterSize, 3);
  }
  // Summing the rows now reconstructs the true branch total instead of tripling it.
  const summed = rows.reduce((a, r) => a + r.costUsd, 0);
  assert.equal(summed, 30);
  rmSync(dir, { recursive: true, force: true });
});

test('buildTrainingSet: a case with NO branch field gets costUsd=null, not a misleading trunk-only number', () => {
  // Confirmed in the wild: a real case reported $3.09 (trunk-share alone)
  // against a hand-verified true cost of $34.48 — an 11x undercount —
  // because it had no `branch` field and the old code treated a nonzero
  // trunk pool as sufficient evidence of "priced". It isn't.
  const { automationDir, ledgerPath, dir } = setupProject({
    batchName: 'b4',
    cases: [
      { id: 'CASE-BRANCHED', outcome: 'automated', branch: 'tests/branched' },
      { id: 'CASE-NO-BRANCH', outcome: 'automated' }, // no `branch` field at all
    ],
    ledgerUnits: [{ gitBranch: 'tests/branched', costUsd: 20, durationMin: 80 }],
  });
  // give this report an integration_branch so a trunk pool exists
  const reportPath = `${automationDir}/b4/report.json`;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  report.integration_branch = 'tests/trunk';
  writeFileSync(reportPath, JSON.stringify(report));
  writeFileSync(ledgerPath, JSON.stringify({
    ledger: [
      { gitBranch: 'tests/branched', costUsd: 20, durationMin: 80 },
      { gitBranch: 'tests/trunk', costUsd: 6, durationMin: 24 }, // trunk overhead, split across 2 cases = $3/12min each
    ],
  }));

  const { rows, summary } = buildTrainingSet({ automationDir, ledgerPath, repoRoot: null, taxonomy });
  const branched = rows.find((r) => r.id === 'CASE-BRANCHED');
  const noBranch = rows.find((r) => r.id === 'CASE-NO-BRANCH');

  assert.equal(branched.costUsd, 23); // 20 + 3 trunk share — real branch evidence, trusted
  assert.equal(noBranch.costUsd, null); // NOT 3 — no branch-specific evidence, must not be reported as priced
  assert.equal(noBranch.noBranchField, true);
  assert.equal(noBranch.trunkOnlyCostUsd, 3); // the known-incomplete floor, kept SEPARATE from costUsd
  assert.equal(summary.nMissingBranchField, 1);
  assert.equal(summary.nPriced, 1); // only the branched one counts as reliably priced

  rmSync(dir, { recursive: true, force: true });
});

test('buildTrainingSet: finds case snapshots in a CAMPAIGN-level cases/ dir, not just the report.json\'s own directory', () => {
  // Confirmed in the wild: a 50-case campaign kept ONE shared `cases/` dir
  // at the campaign root while nesting its two `report.json` files a level
  // down in per-wave subfolders. The old single-level lookup silently found
  // nothing for any of those cases, fell back to scoring the report's own
  // (often one-line) `note` field, and produced nonsense step counts (an
  // observed campaign-wide average of 2.5 steps/case, vs. real case files
  // averaging ~9) — which would have corrupted the base_minutes(steps)
  // factor for every affected row. Real steps/tier data must come from the
  // real file if it exists anywhere up the tree.
  const dir = mkdtempSync(join(tmpdir(), 'training-set-test-'));
  const automationDir = join(dir, 'automation');
  const campaignCasesDir = join(automationDir, 'campaign', 'cases');
  const waveDir = join(automationDir, 'campaign', 'wave-01');
  mkdirSync(campaignCasesDir, { recursive: true });
  mkdirSync(waveDir, { recursive: true });
  // The real case file lives at the CAMPAIGN level, two directories above
  // where report.json sits.
  writeFileSync(join(campaignCasesDir, 'CASE-NESTED.md'), `---\nid: CASE-NESTED\nmodule: test\n---\n\n| # | Action | Expected |\n|---|---|---|\n| 1 | a | b |\n| 2 | c | d |\n| 3 | e | f |\n`);
  writeFileSync(join(waveDir, 'report.json'), JSON.stringify({
    batch: 'wave-01', base: 'main', integration_branch: null,
    cases: [{ id: 'CASE-NESTED', outcome: 'automated', branch: 'tests/case-nested' }],
  }));
  const ledgerPath = join(dir, 'ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({ ledger: [{ gitBranch: 'tests/case-nested', costUsd: 5, durationMin: 20 }] }));

  const { rows } = buildTrainingSet({ automationDir, ledgerPath, repoRoot: null, taxonomy });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].steps, 3); // the REAL step count from the found file
  assert.equal(rows[0].stepsEstimated, false); // not the word-count fallback

  rmSync(dir, { recursive: true, force: true });
});

test('buildTrainingSet: cases on different branches within the same report are not cross-divided', () => {
  const { automationDir, ledgerPath, dir } = setupProject({
    batchName: 'b3',
    cases: [
      { id: 'CASE-X', outcome: 'automated', branch: 'tests/x' },
      { id: 'CASE-Y', outcome: 'automated', branch: 'tests/y' },
    ],
    ledgerUnits: [
      { gitBranch: 'tests/x', costUsd: 5, durationMin: 20 },
      { gitBranch: 'tests/y', costUsd: 15, durationMin: 60 },
    ],
  });
  const { rows } = buildTrainingSet({ automationDir, ledgerPath, repoRoot: null, taxonomy });
  const x = rows.find((r) => r.id === 'CASE-X');
  const y = rows.find((r) => r.id === 'CASE-Y');
  assert.equal(x.costUsd, 5);
  assert.equal(x.clusterSize, 1);
  assert.equal(y.costUsd, 15);
  assert.equal(y.clusterSize, 1);
  rmSync(dir, { recursive: true, force: true });
});
