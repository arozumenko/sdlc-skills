import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBatchCost, classify, matchIds, lineMatchesBatch, updateBatchCosts } from './batch-cost.mjs';

const sub = (label, tokens, { costUsd, activeMin = 1, role = 'test-automation-engineer' } = {}) => ({
  role, label, n: 1,
  tokens: { input: 0, output: 0, cacheRead: tokens, cacheWrite: 0 },
  activeMin, toolCalls: 1, toolErrors: 0,
  ...(costUsd != null ? { costUsd } : {}),
});
const line = (id, subs, { costUsd = null, cases = [], branch = 'main', host = 'claude' } = {}) => ({
  v: 1, host, id, user: 'u1', repo: 'r', branch, role: 'test-automation-lead',
  endedAt: '2026-08-10T10:00:00Z', capturedAt: '2026-08-10T10:01:00Z',
  activeMin: 10 + subs.reduce((n, s) => n + s.activeMin, 0),
  tokens: { input: 5, output: 100, cacheRead: 1000, cacheWrite: 50 },
  costUsd, costSource: costUsd != null ? 'ccusage-metered' : 'none',
  cases, subagents: subs, skills: [], dispatches: subs.length, turns: 5, toolCalls: 9, toolErrors: 0,
});
const RECEIPT = {
  batch: 'b1', integration_branch: 'tests/batch-b1',
  gate: { verdict: 'green', runs: 3 },
  cases: [
    { id: 'TC-101', outcome: 'automated', findings: [{}, {}], branch: 'tests/101-x' },
    { id: 'TC-102', outcome: 'automated', findings: [], branch: 'tests/102-y' },
    { id: 'CASE_9', outcome: 'blocked', findings: [{}], branch: null },
  ],
};

// Receipt-driven matching must work for ANY id shape the source system uses —
// never a hardcoded Jira regex.
test('matchIds: id-shape-agnostic, case-insensitive substring against the label', () => {
  assert.deepEqual(matchIds('analyst:tc-101+CASE_9 live pass', ['TC-101', 'TC-102', 'CASE_9']), ['TC-101', 'CASE_9']);
  assert.deepEqual(matchIds('', ['TC-101']), []);
});

// Triage enumerates EVERY case id and the gate names the batch — id matching
// alone would smear batch work across all cases as "direct". Stage wins first.
test('classify: stage classification precedes id matching', () => {
  assert.equal(classify('Triage the batch: TC-101, TC-102, CASE_9', ['TC-101', 'TC-102', 'CASE_9']).kind, 'overhead');
  assert.equal(classify('Hardening gate for batch b1 — TC-101 TC-102', ['TC-101']).kind, 'overhead');
  assert.equal(classify('report:b1 write the report', ['TC-101']).kind, 'overhead');
  // merge is PER-UNIT work in this pipeline — direct when it names its ids
  assert.deepEqual(classify('merge:TC-101 back into the trunk', ['TC-101']), { kind: 'direct', ids: ['TC-101'] });
  assert.deepEqual(classify('implement:TC-102', ['TC-101', 'TC-102']), { kind: 'direct', ids: ['TC-102'] });
  assert.equal(classify('sync base branches', ['TC-101']).kind, 'overhead'); // unmatched, not a stage
});

test('buildBatchCost: direct per case, cluster split, overhead separated, stats over measured values', () => {
  const lines = [
    line('s1', [
      sub('Triage the batch: TC-101 TC-102 CASE_9', 10_000, { costUsd: 0.10 }),
      sub('analyst:TC-101+TC-102 cluster', 100_000, { costUsd: 1.00, activeMin: 10, role: 'qa-engineer' }),   // splits 50/50
      sub('implement:TC-101', 200_000, { costUsd: 2.00, activeMin: 20 }),
      sub('review:TC-101', 50_000, { costUsd: 0.50, activeMin: 5, role: 'qa-engineer' }),
      sub('fix:TC-101:1 round', 30_000, { costUsd: 0.30, activeMin: 3 }),
      sub('implement:TC-102', 150_000, { costUsd: 1.50, activeMin: 15 }),
      sub('Hardening gate for batch b1', 80_000, { costUsd: 0.80, activeMin: 8 }),
    ], { costUsd: 8.20 }), // parent share = 8.20 − 6.20 = 2.00
  ];
  const c = buildBatchCost('b1', RECEIPT, lines);

  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc101.direct.costUsd, 3.30);            // 0.50 analyst-half + 2.00 + 0.50 + 0.30
  assert.equal(tc101.direct.fixRounds, 1);
  assert.equal(tc101.findings, 2);
  const tc102 = c.cases.find((x) => x.id === 'TC-102');
  assert.equal(tc102.direct.costUsd, 2.00);            // 0.50 analyst-half + 1.50
  assert.deepEqual(c.coverage.casesUnattributed, ['CASE_9']);

  // Overhead: lead remainder 2.00 + triage 0.10 + gate 0.80 — visible once.
  assert.equal(c.overhead.lead.costUsd, 2.00);
  assert.equal(c.overhead.stages.costUsd, 0.90);
  assert.equal(c.overhead.costUsd, 2.90);
  assert.equal(c.totals.costUsd, 8.20);

  // delivered = automated only here (no sanctioned-red): 2
  assert.equal(c.delivered, 2);
  assert.equal(c.averages.totalPerDelivered.costUsd, 4.10);
  assert.equal(c.averages.directPerCase.costUsd, 2.65);        // (3.30 + 2.00) / 2
  assert.deepEqual(
    { min: c.stats.directCostUsd.min, max: c.stats.directCostUsd.max, median: c.stats.directCostUsd.median },
    { min: 2.00, max: 3.30, median: 2.65 },
  );
  assert.equal(c.gate.verdict, 'green');
});

// Copilot: no per-dispatch dollars exist — per-case rows carry tokens/time,
// dollars appear ONLY at batch level from the billed figure.
test('buildBatchCost: Copilot lines — per-case dollars null, batch dollars from billed credits', () => {
  const lines = [
    line('cp1', [
      sub('analyst:TC-101', 40_000, { activeMin: 4 }),
      sub('implement:TC-101', 90_000, { activeMin: 9 }),
    ], { costUsd: 3.00, host: 'copilot' }),
  ];
  const c = buildBatchCost('b1', RECEIPT, lines);
  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc101.direct.costUsd, null);
  assert.equal(tc101.direct.tokens, 130_000);
  assert.equal(c.totals.costUsd, 3.00);
  assert.equal(c.stats.directCostUsd, null, 'no per-dispatch dollars → no dollar stats');
  assert.ok(c.stats.directTokens, 'token stats still computed');
  assert.equal(c.averages.totalPerDelivered.costUsd, 1.50);
  assert.equal(c.averages.directPerCase, null);
});

// A batch spans sessions and a session can touch several batches — membership
// is by slug/id/branch appearing in the line's naming surfaces.
test('lineMatchesBatch: matches by slug, receipt id, or branch — and rejects unrelated lines', () => {
  const scope = { slug: 'b1', ids: ['TC-101'], branches: ['tests/batch-b1'] };
  assert.ok(lineMatchesBatch(line('a', [sub('implement:TC-101', 1)]), scope));
  assert.ok(lineMatchesBatch(line('b', [], { branch: 'tests/batch-b1' }), scope));
  assert.ok(lineMatchesBatch(line('c', [], { cases: ['TC-101'] }), scope));
  assert.ok(!lineMatchesBatch(line('d', [sub('implement:OTHER-9', 1)], { branch: 'main' }), scope));
});

// The whole file is a pure derivation: same inputs → same output (modulo
// generatedAt), so the hook can recompute on every session end, latest-wins.
test('updateBatchCosts: writes cost.json next to the receipt, idempotent recompute', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry');
  mkdirSync(tele, { recursive: true });
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [sub('implement:TC-101', 9000, { costUsd: 1.25 })], { costUsd: 2.0 }))}\n`);

  const [first] = updateBatchCosts(repo);
  const onDisk = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
  assert.equal(onDisk.cases.find((c) => c.id === 'TC-101').direct.costUsd, 1.25);
  const [second] = updateBatchCosts(repo);
  assert.deepEqual({ ...second, generatedAt: null }, { ...first, generatedAt: null });
});

// The team-report --batch path renders from the same recompute the hook runs —
// one source of truth, markdown for humans, cost.json for machines.
test('team-report --batch renders the cost view end-to-end', async () => {
  const { main: trMain } = await import('./team-report.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'bc2-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry');
  mkdirSync(tele, { recursive: true });
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [
    sub('analyst:TC-101', 50_000, { costUsd: 0.60, activeMin: 6, role: 'qa-engineer' }),
    sub('implement:TC-101', 120_000, { costUsd: 1.40, activeMin: 12 }),
    sub('Hardening gate for batch b1', 60_000, { costUsd: 0.55, activeMin: 6 }),
  ], { costUsd: 4.00 }))}\n`);
  const outFile = join(repo, 'batch.md');
  assert.equal(trMain(['--batch', 'b1', '--out', outFile, repo]), 0);
  const md = readFileSync(outFile, 'utf8');
  assert.match(md, /# Batch cost — b1/);
  assert.match(md, /delivered: 2/);
  assert.match(md, /Gate: green \(3 runs\)/);
  assert.match(md, /\| TC-101 \| automated \| \$2\.00 \|/);          // 0.60 + 1.40 direct
  assert.match(md, /Overhead .*: \$2\.00 \(50%\)/);                   // lead 1.45 + gate 0.55
  assert.match(md, /Per delivered case \(incl\. overhead\): \$2\.00/); // 4.00 / 2
  assert.match(md, /Unattributed .*: TC-102, CASE_9/);
  // and the machine artifact landed next to the receipt
  assert.ok(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')).v >= 1);
});

// The export row carries only measured figures + project-local identity; the
// bundle itself ships no organisation identifiers.
test('buildExportRow: cost.json → dataset row, nulls where unmeasured, identity from profile', async () => {
  const { buildExportRow, renderCompare } = await import('./build-tokenomics-export.mjs');
  const c = buildBatchCost('b1', RECEIPT, [
    line('s1', [sub('implement:TC-101', 90_000, { costUsd: 1.40, activeMin: 12 })], { costUsd: 2.40 }),
  ]);
  const row = buildExportRow(c, { factory_id: 'proj-x-test-automation', owner_group: 'QA' });
  assert.equal(row.factory_id, 'proj-x-test-automation');
  assert.equal(row.work_item_level, 'batch');
  assert.equal(row.work_item_ref, 'b1');
  assert.equal(row.scenarios_executed, 3);
  assert.equal(row.scenarios_automated, 2);
  assert.equal(row.cost_api_equivalent_usd, 2.4);
  assert.equal(row.cost_per_scenario_automated_usd, 1.2);
  assert.equal(row.tokens.cache_read, 91_000); // 90k sub + 1k parent
  assert.ok(row.tokens_by_agent['test-automation-engineer']);
  const noProfile = buildExportRow(c, {});
  assert.equal(noProfile.factory_id, null, 'no invented identity');
  // compare renders both rows without throwing
  assert.match(renderCompare(c, c), /per delivered \(incl\. overhead\)/);
});
