import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findReports, readRunReports, branchCoverage, summarizeDelivery,
  renderDeliveryMarkdown, DELIVERED,
} from './run-reports.mjs';

/** Write one batch report and stamp its mtime (the only clock these have). */
function batch(root, slug, cases, { mtime = 1_000_000, ...extra } = {}) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'report.json');
  writeFileSync(p, JSON.stringify({
    batch: slug,
    base: 'origin/main',
    integration_branch: `tests/batch-${slug}`,
    gate: { verdict: 'green', runs: 3, seconds: [10, 9, 11], failures: [] },
    cases,
    totals: {},
    quality_flags: [],
    quota_halted: false,
    expected_red: [],
    ...extra,
  }));
  utimesSync(p, mtime, mtime);
  return p;
}

const tmp = () => mkdtempSync(join(tmpdir(), 'runreports-'));

test('findReports: a file, a batch dir, or the automation root', () => {
  const root = tmp();
  try {
    const p = batch(root, 'w1', [{ id: 'TC-1', outcome: 'automated' }]);
    batch(root, 'w2', [{ id: 'TC-2', outcome: 'blocked' }]);
    assert.deepEqual(findReports(p), [p]);
    assert.deepEqual(findReports(join(root, 'w1')), [p]);
    assert.equal(findReports(root).length, 2);
    assert.deepEqual(findReports(join(root, 'nope')), []);
    assert.deepEqual(findReports(undefined), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('findReports: campaign reports nested in sub-folders are found (field bug — one-level scan missed wave-*/report.json)', () => {
  const root = tmp();
  try {
    batch(root, 'flat-batch', [{ id: 'TC-1', outcome: 'automated' }]);
    batch(join(root, 'approved-next50'), 'wave-02-05-merged', [{ id: 'TC-2', outcome: 'automated' }]);
    batch(join(root, 'approved-next50'), 'wave-06-10', [{ id: 'TC-3', outcome: 'blocked' }]);
    const found = findReports(root);
    assert.equal(found.length, 3, `expected flat + 2 nested wave reports, got: ${found.join(', ')}`);
    assert.ok(found.some((f) => f.includes('wave-02-05-merged')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('outcomes are counted from the rows, delivered = automated only', () => {
  const root = tmp();
  try {
    batch(root, 'w1', [
      { id: 'TC-1', outcome: 'automated', branch: 'tests/TC-1' },
      { id: 'TC-2', outcome: 'automated', branch: 'tests/TC-2' },
      { id: 'TC-3', outcome: 'already-covered' },
      { id: 'TC-4', outcome: 'out-of-scope' },
      { id: 'TC-5', outcome: 'blocked' },
    ]);
    const d = readRunReports(findReports(root));
    assert.equal(d.delivered, 2);
    assert.equal(d.casesEntered, 5);
    assert.equal(d.outcomes[DELIVERED], 2);
    assert.equal(d.outcomes['already-covered'], 1);
    // Branches come from both the rows and the integration branch, so the
    // coverage check can see the gate's work as well as each build's.
    assert.ok(d.branches.includes('tests/TC-1'));
    assert.ok(d.branches.includes('tests/batch-w1'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The one that silently inflates everything: a case blocked in wave 1 and
// automated in wave 2 is ONE case that took two attempts, not two cases. Summing
// rows would make the pipeline look cheaper per case the more it had to retry.
test('a case re-entered in a later batch counts once, at its latest outcome', () => {
  const root = tmp();
  try {
    batch(root, 'w1', [
      { id: 'TC-1', outcome: 'blocked' },
      { id: 'TC-2', outcome: 'automated', branch: 'tests/TC-2' },
    ], { mtime: 1_000_000 });
    batch(root, 'w2', [
      { id: 'TC-1', outcome: 'automated', branch: 'tests/TC-1' },
    ], { mtime: 2_000_000 });
    const d = readRunReports(findReports(root));
    assert.equal(d.casesEntered, 2, 'TC-1 is one case, not two');
    assert.equal(d.delivered, 2);
    assert.equal(d.reentered, 1);
    assert.equal(d.outcomes.blocked, undefined, 'the stale outcome is replaced');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mtime order decides which outcome is latest, not directory order', () => {
  const root = tmp();
  try {
    // 'a' sorts first by name but ran LAST.
    batch(root, 'a', [{ id: 'TC-1', outcome: 'automated' }], { mtime: 2_000_000 });
    batch(root, 'b', [{ id: 'TC-1', outcome: 'blocked' }], { mtime: 1_000_000 });
    const d = readRunReports(findReports(root));
    assert.equal(d.delivered, 1);
    assert.equal(d.outcomes.automated, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a malformed or foreign JSON file is skipped with a warning, not fatal', () => {
  const root = tmp();
  try {
    batch(root, 'good', [{ id: 'TC-1', outcome: 'automated' }]);
    mkdirSync(join(root, 'bad'), { recursive: true });
    writeFileSync(join(root, 'bad', 'report.json'), '{ not json');
    mkdirSync(join(root, 'other'), { recursive: true });
    writeFileSync(join(root, 'other', 'report.json'), '{"hello":"world"}');
    const d = readRunReports(findReports(root));
    assert.equal(d.delivered, 1);
    assert.equal(d.warnings.length, 2);
    assert.ok(d.warnings.some((w) => /unreadable/.test(w)));
    assert.ok(d.warnings.some((w) => /no cases/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a quota-halted batch flags its delivered count as a floor', () => {
  const root = tmp();
  try {
    batch(root, 'w1', [{ id: 'TC-1', outcome: 'not-started' }], { quota_halted: true });
    const d = readRunReports(findReports(root));
    assert.ok(d.warnings.some((w) => /account ceiling/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('branchCoverage measures what it can tie to these batches, priced only', () => {
  const ledger = [
    { costUsd: 10, gitBranch: 'tests/TC-1' },
    { costUsd: 30, gitBranch: 'tests/batch-w1' },
    { costUsd: 60, gitBranch: 'main' },              // the orchestrator + analysts
    { costUsd: null, gitBranch: 'tests/TC-1' },      // unpriced: counted as a unit, $0
  ];
  const c = branchCoverage(ledger, ['tests/TC-1', 'tests/batch-w1']);
  assert.equal(c.matchedUsd, 40);
  assert.equal(c.totalUsd, 100);
  assert.equal(c.share, 0.4);
  assert.equal(c.matchedUnits, 3);
  assert.equal(c.pricedUnits, 3);
  assert.equal(branchCoverage([], ['x']).share, null, 'no spend → no share, not 0%');
});

// Host-neutrality: the join must work off a report written by hand at close on a
// runner with no workflow. Such a report often names no branches, and a host may
// not record which branch a unit ran on. Neither is evidence of anything, and
// calling either one 0% would accuse a good report of proving the spend
// unrelated to the work — the single most damaging thing this could get wrong.
test('branchCoverage does not run when either side has no branches', () => {
  const ledger = [{ costUsd: 100, gitBranch: 'tests/TC-1' }];

  const noReportBranches = branchCoverage(ledger, []);
  assert.equal(noReportBranches.share, null);
  assert.equal(noReportBranches.comparable, false);
  assert.equal(noReportBranches.branchesKnown, 0);

  // `'?'` is what a host writes when it could not read a branch. It is not a
  // branch name and must not be treated as one that simply failed to match.
  const noLedgerBranches = branchCoverage([{ costUsd: 100, gitBranch: '?' }], ['tests/TC-1']);
  assert.equal(noLedgerBranches.share, null);
  assert.equal(noLedgerBranches.comparable, false);
  assert.equal(noLedgerBranches.ledgerBranched, 0);

  // Both sides present and genuinely disjoint IS a finding.
  const disjoint = branchCoverage(ledger, ['tests/OTHER']);
  assert.equal(disjoint.share, 0);
  assert.equal(disjoint.comparable, true);
});

test('the zero-match warning fires only when the comparison actually ran', () => {
  const d = { delivered: 2, casesEntered: 5, warnings: [], window: null };
  const quiet = (coverage) => summarizeDelivery(d, 100, { coverage }).warnings;
  assert.equal(quiet({ share: null, comparable: false, branchesKnown: 0, ledgerBranched: 3, totalUsd: 100 }).length, 0);
  assert.equal(quiet({ share: null, comparable: false, branchesKnown: 2, ledgerBranched: 0, totalUsd: 100 }).length, 0);
  assert.ok(quiet({ share: 0, comparable: true, branchesKnown: 2, ledgerBranched: 3, totalUsd: 100 })
    .some((w) => /nothing ties this spend/.test(w)));
});

test('renderDeliveryMarkdown says the dilution check did not run, and why', () => {
  const base = {
    batches: [{ slug: 'w1' }], outcomes: { automated: 1 }, casesEntered: 1, delivered: 1,
    reentered: 0, warnings: [], perDelivered: 10, perExamined: 10,
  };
  const noBranches = renderDeliveryMarkdown({
    ...base, coverage: { share: null, comparable: false, branchesKnown: 0, ledgerBranched: 3 },
  });
  assert.match(noBranches, /Dilution check not run: these reports name no branches/);
  const noLedger = renderDeliveryMarkdown({
    ...base, coverage: { share: null, comparable: false, branchesKnown: 2, ledgerBranched: 0 },
  });
  assert.match(noLedger, /no unit in this window records the branch it ran on/);
});

// A batch run as sequential subagent dispatches produces no journal and no
// workflow report; the lead writes one at close, rebuilding an interrupted
// it from git. Only `cases[].id` and `cases[].outcome` are load-bearing.
test('a minimal hand-written report is enough, and rebuilt partials are counted honestly', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, 'seq'), { recursive: true });
    writeFileSync(join(root, 'seq', 'report.json'), JSON.stringify({
      cases: [
        { id: 'TC-1', outcome: 'automated' },
        { id: 'TC-2', outcome: 'blocked' },
        // Recovery emits these two when evidence stops partway. They
        // are not terminal outcomes — they must count as examined, never as
        // delivered, and must not be mistaken for failures.
        { id: 'TC-3', outcome: 'analysed' },
        { id: 'TC-4', outcome: 'built' },
      ],
    }));
    const d = readRunReports(findReports(root));
    assert.equal(d.delivered, 1);
    assert.equal(d.casesEntered, 4);
    assert.equal(d.outcomes.analysed, 1);
    assert.equal(d.outcomes.built, 1);
    assert.equal(d.branches.length, 0, 'no branches recorded — the dilution check must stand down');
    assert.equal(d.batches[0].slug, 'seq', 'the directory names the batch when the file does not');
    assert.equal(d.warnings.length, 0, 'a minimal report is valid, not suspicious');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a row with no outcome counts as not-started rather than vanishing', () => {
  const root = tmp();
  try {
    batch(root, 'w1', [{ id: 'TC-1' }, { id: 'TC-2', outcome: '' }, { outcome: 'automated' }]);
    const d = readRunReports(findReports(root));
    assert.equal(d.casesEntered, 2, 'a row with no id cannot be a case');
    assert.equal(d.outcomes['not-started'], 2);
    assert.equal(d.delivered, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summarizeDelivery: two denominators, and neither is invented', () => {
  const d = { delivered: 2, casesEntered: 5, warnings: [], window: null };
  const s = summarizeDelivery(d, 100);
  assert.equal(s.perDelivered, 50);
  assert.equal(s.perExamined, 20);
  // No metered total → no ratio at all, rather than a confident $0.00.
  assert.equal(summarizeDelivery(d, null).perDelivered, null);
  assert.equal(summarizeDelivery(d, undefined).perExamined, null);
});

test('summarizeDelivery: nothing delivered says so instead of dividing by zero', () => {
  const s = summarizeDelivery({ delivered: 0, casesEntered: 4, warnings: [], window: null }, 100);
  assert.equal(s.perDelivered, null);
  assert.equal(s.perExamined, 25);
  assert.ok(s.warnings.some((w) => /nothing was delivered/.test(w)));
});

// The silent failure this whole join exists to avoid: three months of spend
// divided by one batch's cases. Both halves look fine on their own.
test('summarizeDelivery warns when the runs closed outside the metered window', () => {
  const runMs = Date.parse('2026-07-20T12:00:00Z');
  const d = { delivered: 2, casesEntered: 5, warnings: [], window: { fromMs: runMs, toMs: runMs } };
  const inside = summarizeDelivery(d, 100, { rollupDays: ['2026-07-19', '2026-07-21'] });
  assert.equal(inside.warnings.length, 0);
  const outside = summarizeDelivery(d, 100, { rollupDays: ['2026-09-01', '2026-09-30'] });
  assert.ok(outside.warnings.some((w) => /outside the metered window/.test(w)));
});

// Zero coverage needs no threshold to read: nothing whatsoever ties the spend
// to the cases, so the two ratios are unrelated numbers divided by each other.
test('summarizeDelivery warns when NO priced unit touches a branch these reports name', () => {
  const d = { delivered: 2, casesEntered: 5, warnings: [], window: null };
  const dead = summarizeDelivery(d, 100, { coverage: { share: 0, comparable: true, totalUsd: 100, matchedUsd: 0 } });
  assert.ok(dead.warnings.some((w) => /nothing ties this spend/.test(w)));
  // A partial match proves nothing either way — analysts are unmatchable by
  // construction — so a small share must NOT be reported as a fault.
  const partial = summarizeDelivery(d, 100, { coverage: { share: 0.05, comparable: true, totalUsd: 100, matchedUsd: 5 } });
  assert.equal(partial.warnings.length, 0);
  // Nothing priced at all is a pricing problem, already reported elsewhere.
  const unpriced = summarizeDelivery(d, 100, { coverage: { share: null, comparable: false, totalUsd: 0, matchedUsd: 0 } });
  assert.equal(unpriced.warnings.length, 0);
});

test('renderDeliveryMarkdown states both denominators and the coverage floor', () => {
  const d = {
    batches: [{ slug: 'w1', gate: 'green' }],
    outcomes: { automated: 2, blocked: 1 },
    casesEntered: 3, delivered: 2, reentered: 1, warnings: ['careful'],
    perDelivered: 50, perExamined: 33.33,
    coverage: { matchedUsd: 40, totalUsd: 100, share: 0.4, matchedUnits: 3 },
  };
  const md = renderDeliveryMarkdown(d);
  assert.match(md, /Cost per spec delivered: \$50\.00/);
  assert.match(md, /Cost per case examined: \$33\.33/);
  assert.match(md, /re-entry/);
  assert.match(md, /40%/);
  assert.match(md, /floor/i);
  assert.match(md, /⚠️ careful/);
});
