import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBatchCost, classify, matchIds, lineMatchesBatch, updateBatchCosts, loadReceipts, loadGateRuns, foldGateRuns, declaredOutcomesFor, crossCheck } from './batch-cost.mjs';

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

// FIELD BUG: every reviewer prompt says "(do not execute the spec; the
// hardening gate does that)", so matching stage words anywhere in the label
// booked all six reviewers of a real batch as GATE overhead — $4.31 moved off
// the cases. A dispatch's own stage is always at the FRONT of its label
// (deriveLabel slices from it); the rest merely mentions other stages.
test('classify: a stage MENTIONED later in the label is not the dispatch stage', () => {
  const ids = ['TC-004'];
  const reviewer = "Reviewer slot — STATIC review of TC-004 per the test-automation-workflow skill's references/reviewer-contract.md (do not execute the spec; the hardening gate do";
  assert.deepEqual(classify(reviewer, ids), { kind: 'direct', ids: ['TC-004'] }, 'reviewer work belongs to its case');
  // the real gate still reads as overhead
  assert.equal(classify('Hardening gate for batch smoke-remaining. You did not write this code', ids).kind, 'overhead');
  assert.equal(classify('Triage slot — a READ-ONLY routing decision: no git, no browser', ids).kind, 'overhead');
  assert.equal(classify('report writer — the single disk write of this run.', ids).kind, 'overhead');
  // an implementer that merely mentions the gate stays with its case
  assert.deepEqual(classify('Implementer slot — implement TC-004; the hardening gate proves it later', ids).ids, ['TC-004']);
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

  // Fully loaded = direct + even overhead share (2.90 / 3 cases ≈ 0.97 each) —
  // an allocation, labelled; the unattributed case carries only its share.
  assert.equal(tc101.loaded.costUsd, 4.27);                    // 3.30 + 0.9667
  assert.equal(c.cases.find((x) => x.id === 'CASE_9').loaded.costUsd, 0.97);
  assert.equal(c.stats.loadedCostUsd.n, 3, 'loaded stats run over ALL cases, not just attributed');

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

// A workflow dispatch's prompt opens with boilerplate; when the case id sits
// past the label's 160-char window, the capture's transcript-mined ids (the
// entry's `cases`) are the fallback — measured at 11.6% of real dispatches.
test('classify: transcript-mined ids rescue a dispatch whose label missed the id', () => {
  const ids = ['TC-101', 'TC-102'];
  // label carries no id; the transcript did
  assert.deepEqual(classify('stabilize workflow. If your role memory / project briefing …', ids, ['TC-101']),
    { kind: 'direct', ids: ['TC-101'] });
  // named overhead stage stays overhead even when its transcript names ids
  assert.equal(classify('Hardening gate for batch b1', ids, ['TC-101', 'TC-102']).kind, 'overhead');
  // mined ids outside the receipt never attribute — still receipt-driven
  assert.equal(classify('stabilize workflow round', ids, ['OTHER-9']).kind, 'overhead');
  // label match wins over the fallback (no double counting, label is primary)
  assert.deepEqual(classify('implement:TC-102', ids, ['TC-101']).ids, ['TC-102']);
});

// Campaigns nest wave receipts at <batch>/<wave>/report.json — a one-level
// scan silently skipped them (the same under-count efficiency-audit's
// run-reports.mjs was field-flagged for, twice, before its own fix).
test('loadReceipts: discovers nested wave receipts; --batch selects a campaign by top slug', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc3-'));
  const auto = join(repo, '.agents', 'automation');
  const mk = (rel, receipt) => {
    const d = join(auto, ...rel.split('/'));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'report.json'), JSON.stringify(receipt));
  };
  mk('top10', { batch: 'top10', cases: [{ id: 'TC-1', outcome: 'automated' }] });
  mk('camp/heads', { batch: 'camp', cases: [{ id: 'TC-2', outcome: 'blocked' }] });
  mk('camp/wave-01', { batch: 'camp', cases: [{ id: 'TC-3', outcome: 'automated' }] });
  // non-receipt JSON in the tree is ignored (e.g. _returns receipts)
  mkdirSync(join(auto, '_returns', 'wf_x'), { recursive: true });
  writeFileSync(join(auto, '_returns', 'wf_x', 'a1.json'), '{"result":{}}');

  const all = loadReceipts(repo);
  assert.deepEqual(all.map((r) => r.slug), ['camp/heads', 'camp/wave-01', 'top10']);
  assert.deepEqual(loadReceipts(repo, { batch: 'camp' }).map((r) => r.slug), ['camp/heads', 'camp/wave-01']);
  assert.deepEqual(loadReceipts(repo, { batch: 'camp/wave-01' }).map((r) => r.slug), ['camp/wave-01']);
  assert.deepEqual(loadReceipts(repo, { batch: 'top10' }).map((r) => r.slug), ['top10']);
});

// A nested wave's path slug never appears in a branch name — the receipt's own
// `batch` field must also anchor session membership.
test('lineMatchesBatch: accepts a slug list (nested wave path + receipt batch name)', () => {
  const l = line('s1', [sub('implement:something', 1)], { branch: 'tests/batch-camp-w1' });
  assert.ok(!lineMatchesBatch(l, { slug: ['camp/wave-01'], ids: [], branches: [] }));
  assert.ok(lineMatchesBatch(l, { slug: ['camp/wave-01', 'camp'], ids: [], branches: [] }));
  // and a line whose only naming surface is a sub-agent's mined cases
  const l2 = line('s2', [{ ...sub('stabilize workflow …', 1), cases: ['TC-101'] }]);
  assert.ok(lineMatchesBatch(l2, { slug: 'b1', ids: ['TC-101'], branches: [] }));
});

// End-to-end: the fallback attributes dollars to the case the label missed.
test('buildBatchCost: sub-agent `cases` fallback attributes work the label window lost', () => {
  const stabilize = { ...sub('stabilize workflow. If your role memory …', 40_000, { costUsd: 0.40, activeMin: 4 }), cases: ['TC-101'] };
  const c = buildBatchCost('b1', RECEIPT, [line('s1', [stabilize], { costUsd: 1.00 })]);
  assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.costUsd, 0.40);
  assert.ok(!c.coverage.casesUnattributed.includes('TC-101'));
});

// A lead session serving SEVERAL batches (a campaign running waves in one
// session) must not be double-counted: each batch excludes the other's
// dispatches and takes an even share of the session-level figures. Without
// `others` every batch used to claim the WHOLE session.
test('multi-batch session: foreign dispatches excluded, session-level figures split', () => {
  const receiptA = { batch: 'wA', integration_branch: 'tests/batch-wA', cases: [{ id: 'A-1', outcome: 'automated', branch: 'tests/A-1-x' }] };
  const receiptB = { batch: 'wB', integration_branch: 'tests/batch-wB', cases: [{ id: 'B-1', outcome: 'automated', branch: 'tests/B-1-y' }] };
  const sharedLine = line('s-camp', [
    sub('implement:A-1', 100_000, { costUsd: 2.00, activeMin: 20 }),
    sub('implement:B-1', 100_000, { costUsd: 3.00, activeMin: 30 }),
    sub('Hardening gate for batch wA', 50_000, { costUsd: 0.50, activeMin: 5 }),
    sub('Hardening gate for batch wB', 50_000, { costUsd: 0.70, activeMin: 7 }),
    sub('sync base branches', 10_000, { costUsd: 0.20, activeMin: 2 }), // neutral — split evenly
  ], { costUsd: 8.40, branch: 'tests/batch-wA' }); // parent remainder = 8.40 − 6.40 = 2.00
  const idOf = (r, slug) => ({ keys: [slug, r.batch], ids: r.cases.map((c) => c.id), branches: [r.integration_branch, ...r.cases.map((c) => c.branch)].filter(Boolean) });

  const a = buildBatchCost('wA', receiptA, [sharedLine], { others: [idOf(receiptB, 'wB')] });
  const b = buildBatchCost('wB', receiptB, [sharedLine], { others: [idOf(receiptA, 'wA')] });

  // A: its implement 2.00 + its gate 0.50 + neutral/2 0.10 + parent/2 1.00 = 3.60
  assert.equal(a.totals.costUsd, 3.60);
  // B: 3.00 + 0.70 + 0.10 + 1.00 = 4.80
  assert.equal(b.totals.costUsd, 4.80);
  // together they cover the session exactly once — no double count
  assert.equal(round2(a.totals.costUsd + b.totals.costUsd), 8.40);
  // the other batch's work never lands in my overhead
  assert.equal(a.sources.foreignDispatchesExcluded, 2, 'B implement + B gate excluded from A');
  assert.equal(a.sources.sharedSessions, 1);
  assert.equal(a.cases[0].direct.costUsd, 2.00, 'per-case direct unchanged');
  assert.equal(b.cases[0].direct.costUsd, 3.00);
  // and without `others` the old inflation is visible (documents the fix)
  const naive = buildBatchCost('wA', receiptA, [sharedLine]);
  assert.equal(naive.totals.costUsd, 8.40, 'no others info → whole session counted (single-batch behavior)');
});
const round2 = (v) => Math.round(v * 100) / 100;

// Telemetry rides every layer now: totals, roles, per-case, stage split, rework.
test('telemetry + stage split + rework land in cost.json', () => {
  const lines = [line('s1', [
    sub('Triage the batch: TC-101 TC-102', 10_000, { costUsd: 0.10, activeMin: 2 }),
    sub('implement:TC-101', 200_000, { costUsd: 2.00, activeMin: 20 }),
    sub('fix:TC-101:1 round', 30_000, { costUsd: 0.30, activeMin: 16 }),
    sub('Hardening gate for batch b1', 80_000, { costUsd: 0.80, activeMin: 8 }),
    sub('report:b1 write the report', 5_000, { costUsd: 0.05, activeMin: 1 }),
  ], { costUsd: 4.25 })];
  const c = buildBatchCost('b1', RECEIPT, lines);
  assert.ok(c.totals.toolCalls > 0);
  assert.equal(c.totals.turns, 5, 'parent turns counted');
  assert.deepEqual(Object.keys(c.overhead.byStage).sort(), ['gate', 'report', 'triage']);
  assert.equal(c.overhead.byStage.gate.costUsd, 0.80);
  assert.equal(c.rework.costUsd, 0.30, 'fix-round spend surfaced as its own lever');
  assert.equal(c.rework.dispatches, 1);
  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.ok(tc101.direct.toolCalls > 0, 'per-case tool calls');
  assert.ok(c.byRole['test-automation-engineer'].toolCalls > 0, 'role tool calls');
});

// Live batch view without ledger bloat: the per-dispatch deltas are stored,
// the session snapshot is REBUILT from them on demand — so cost.json is
// current mid-run while the ledger still gets exactly one line per session.
test('loadLiveLines: rebuilds a provisional session line from the dispatch deltas', async () => {
  const { loadLiveLines } = await import('./batch-cost.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'bc-live-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(dir, { recursive: true });
  const rec = (agentId, costUsd, cases, bytes) => JSON.stringify({
    v: 1, session: 'run-1', agentId, role: 'qa-engineer', label: `analyse ${cases[0]}`,
    cases, tokens: { input: 0, output: 0, cacheRead: 1000, cacheWrite: 0 },
    activeMin: 5, toolCalls: 7, toolErrors: 0, costUsd, endedAt: '2026-08-14T10:00:00Z', bytes,
  });
  writeFileSync(join(dir, 'run-1.jsonl'), [
    rec('a1', 1.5, ['TC-101'], 10),
    rec('a2', 2.5, ['TC-102'], 10),
    rec('a1', 1.75, ['TC-101'], 20),        // a1 grew — superseding delta
  ].join('\n') + '\n');

  const [line] = loadLiveLines(repo);
  assert.equal(line.live, true);
  assert.equal(line.id, 'run-1');
  assert.equal(line.subagents.length, 2, 'latest delta per dispatch, not one row per append');
  assert.equal(line.costUsd, 4.25, 'sum of the CURRENT dispatch dollars (1.75 + 2.50)');
  assert.deepEqual(line.cases, ['TC-101', 'TC-102']);
  assert.deepEqual(line.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'the lead thread is NOT claimed — it has not been measured');
});

test('updateBatchCosts: a running session shows up as provisional, and the real line always wins', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-live2-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const live = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, 'run-1.jsonl'),
    `${JSON.stringify({ v: 1, session: 'run-1', agentId: 'a1', role: 'test-automation-engineer', label: 'implement:TC-101', cases: ['TC-101'], tokens: { input: 0, output: 0, cacheRead: 9000, cacheWrite: 0 }, activeMin: 4, toolCalls: 6, toolErrors: 0, costUsd: 1.25, bytes: 9 })}\n`);

  const [mid] = updateBatchCosts(repo, { write: false });
  assert.equal(mid.sources.liveSessions, 1);
  assert.match(mid.sources.liveNote, /PROVISIONAL/);
  assert.equal(mid.cases.find((c) => c.id === 'TC-101').direct.costUsd, 1.25, 'mid-run per-case cost is real');

  // the session ends: its ledger line (with the lead thread) must win outright
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  writeFileSync(join(tele, 'usage-u1.jsonl'),
    `${JSON.stringify(line('run-1', [sub('implement:TC-101', 9000, { costUsd: 1.25 })], { costUsd: 3.0 }))}\n`);
  const [after] = updateBatchCosts(repo, { write: false });
  assert.ok(!after.sources.liveSessions, 'no longer provisional');
  assert.equal(after.totals.costUsd, 3.0, 'the full session total, incl. the lead thread');
});

// A period rollup's totals come straight from the ledger, so its batch/case
// tables must not mix in provisional rows — one document, one basis.
test('updateBatchCosts: live:false excludes running sessions (the period-rollup basis)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-live3-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const live = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, 'run-9.jsonl'),
    `${JSON.stringify({ v: 1, session: 'run-9', agentId: 'a1', role: 'qa-engineer', label: 'implement:TC-101', cases: ['TC-101'], tokens: { input: 0, output: 0, cacheRead: 500, cacheWrite: 0 }, activeMin: 2, toolCalls: 3, toolErrors: 0, costUsd: 0.9, bytes: 5 })}\n`);
  assert.equal(updateBatchCosts(repo, { write: false })[0].sources.liveSessions, 1, 'batch view: live');
  const rollup = updateBatchCosts(repo, { write: false, live: false })[0];
  assert.ok(!rollup.sources.liveSessions, 'period rollup: ledger-only');
  assert.equal(rollup.totals.costUsd, null, 'nothing measured yet from the ledger alone');
});

// The records layer: script-authored gate verdicts + declared outcomes are
// cross-checked against the receipt. Drift is the write-back failure class
// made visible (measured: 38/69 delivered cases scored unproven because a
// recovered gate's verdict never reached report.json).
test('crossCheck: gate drift and outcome drift vs the receipt; records never overwrite', () => {
  const receipt = {
    batch: 'b1', gate: { verdict: 'not-run' },
    cases: [{ id: 'TC-101', outcome: 'merged-ungated' }, { id: 'TC-102', outcome: 'automated' }],
  };
  const gateRuns = [
    { at: '2026-08-12T10:00:00Z', verdict: 'red', consecutiveGreen: 1 },
    { at: '2026-08-12T11:00:00Z', verdict: 'green', consecutiveGreen: 3 },
  ];
  const declared = { 'TC-101': 'automated', 'TC-102': 'automated' };
  const { gateDrift, outcomeDrift } = crossCheck(receipt, gateRuns, declared);
  assert.deepEqual(gateDrift, { receipt: 'not-run', recorded: 'green', at: '2026-08-12T11:00:00Z' }, 'latest record wins');
  assert.deepEqual(outcomeDrift, [{ id: 'TC-101', receipt: 'merged-ungated', declared: 'automated' }], 'agreeing cases are not drift');
  // receipt and records agreeing → silence
  const clean = crossCheck({ batch: 'b1', gate: { verdict: 'green' }, cases: [{ id: 'TC-102', outcome: 'automated' }] },
    [gateRuns[1]], { 'TC-102': 'automated' });
  assert.equal(clean.gateDrift, null);
  assert.deepEqual(clean.outcomeDrift, []);
});

test('declaredOutcomesFor: matches scopes by batch name or case overlap, latest updatedAt wins', () => {
  const receipt = { batch: 'b1', cases: [{ id: 'TC-101' }, { id: 'TC-102' }] };
  const scopes = [
    { session: 's1', batch: 'b1', cases: ['TC-101'], updatedAt: '2026-08-12T10:00:00Z', outcomes: { 'TC-101': { outcome: 'blocked' } } },
    { session: 's2', cases: ['TC-101'], updatedAt: '2026-08-12T12:00:00Z', outcomes: { 'TC-101': { outcome: 'automated' } } }, // matched by case overlap
    { session: 's3', batch: 'other', cases: ['ZZZ-9'], updatedAt: '2026-08-12T13:00:00Z', outcomes: { 'TC-102': { outcome: 'blocked' } } }, // unrelated scope — no match surface
  ];
  const out = declaredOutcomesFor(receipt, 'b1', scopes);
  assert.deepEqual(out, { 'TC-101': 'automated' }, 'later declaration wins; unrelated scope ignored');
  // nested wave slug matches by its last segment
  assert.deepEqual(declaredOutcomesFor({ batch: 'camp', cases: [{ id: 'TC-9' }] }, 'camp/wave-01',
    [{ session: 'w', batch: 'wave-01', cases: [], updatedAt: 'x', outcomes: { 'TC-9': { outcome: 'automated' } } }]),
    { 'TC-9': 'automated' });
});

test('updateBatchCosts: gate-runs + scopes land in cost.json as records with drift flags', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc4-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    ...RECEIPT, gate: { verdict: 'not-run' },
    cases: RECEIPT.cases.map((c) => (c.id === 'TC-101' ? { ...c, outcome: 'merged-ungated' } : c)),
  }));
  writeFileSync(join(dir, 'gate-runs.jsonl'),
    `${JSON.stringify({ at: '2026-08-12T11:00:00Z', branch: 'tests/batch-b1', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3, seconds: [1, 1, 1] })}\n`);
  const scopesDir = join(repo, '.agents', 'telemetry', 'automation', 'scopes');
  mkdirSync(scopesDir, { recursive: true });
  writeFileSync(join(scopesDir, 'sess-1.json'), JSON.stringify({
    v: 1, session: 'sess-1', intent: 'automation', batch: 'b1', cases: ['TC-101'],
    declaredAt: 'x', updatedAt: 'y', outcomes: { 'TC-101': { outcome: 'automated', at: 'y' } },
  }));
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-u1.jsonl'),
    `${JSON.stringify(line('s1', [sub('implement:TC-101', 9000, { costUsd: 1.0 })], { costUsd: 2.0 }))}\n`);

  const [c] = updateBatchCosts(repo);
  assert.equal(c.records.gateRuns.latest.verdict, 'green');
  assert.deepEqual(c.records.gateDrift, { receipt: 'not-run', recorded: 'green', at: '2026-08-12T11:00:00Z' });
  assert.deepEqual(c.records.outcomeDrift, [{ id: 'TC-101', receipt: 'merged-ungated', declared: 'automated' }]);
  assert.deepEqual(c.records.declaredOutcomes, { 'TC-101': 'automated' });
  const onDisk = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
  assert.ok(onDisk.records.gateDrift, 'drift persisted for the next reader');
  // loadGateRuns tolerates absence
  assert.deepEqual(loadGateRuns(join(repo, 'nowhere')), []);
});

// Mid-run verdicts land on the telemetry side (they must not dirty the main
// tree); close folds them into the batch dir. The reader sees ONE merged,
// deduplicated, chronological record wherever each line currently lives.
test('loadGateRuns reads both homes and dedups; foldGateRuns moves telemetry lines into the batch dir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-fold-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  const telRuns = join(repo, '.agents', 'telemetry', 'automation', 'gate-runs');
  mkdirSync(dir, { recursive: true });
  mkdirSync(telRuns, { recursive: true });
  const r1 = JSON.stringify({ at: '2026-08-14T10:00:00Z', branch: 'tests/batch-b1', verdict: 'red' });
  const r2 = JSON.stringify({ at: '2026-08-14T11:00:00Z', branch: 'tests/batch-b1', verdict: 'green' });
  writeFileSync(join(dir, 'gate-runs.jsonl'), `${r1}\n`);
  writeFileSync(join(telRuns, 'b1.jsonl'), `${r1}\n${r2}\n`); // r1 duplicated on both sides
  const runs = loadGateRuns(dir, { repo, slug: 'b1' });
  assert.deepEqual(runs.map((r) => r.verdict), ['red', 'green'], 'deduped, chronological');
  assert.equal(foldGateRuns(repo, 'b1', dir), 1, 'only the missing line folds');
  assert.ok(!existsSync(join(telRuns, 'b1.jsonl')), 'telemetry side cleared after fold');
  const after = readFileSync(join(dir, 'gate-runs.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(after, [r1, r2]);
  // idempotent: nothing left to fold
  assert.equal(foldGateRuns(repo, 'b1', dir), 0);
});

// The whole file is a pure derivation: same inputs → same output (modulo
// generatedAt), so the hook can recompute on every session end, latest-wins.
test('updateBatchCosts: writes cost.json next to the receipt, idempotent recompute', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry', 'automation');
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
  const tele = join(repo, '.agents', 'telemetry', 'automation');
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
  assert.match(md, /\| TC-101 \| automated \| \$2\.00 \|/);          // no sizing in this fixture -> no size column          // 0.60 + 1.40 direct
  assert.match(md, /Overhead .*: \$2\.00 \(50%\)/);                   // lead 1.45 + gate 0.55
  assert.match(md, /Per delivered case \(incl\. overhead\): \$2\.00/); // 4.00 / 2
  assert.match(md, /Unattributed .*: TC-102, CASE_9/);
  // and the machine artifact landed next to the receipt
  assert.ok(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')).v >= 1);
});

// Exporter v2 — schema 1.0 container {schema_version, segment, runs[]}: the
// segment header from the project-local profile, one ROW per work-item (our
// batch), measured figures only, §7 checklist instead of silent guessing.
test('export v2: segment+row per spec, checklist flags gaps, upsert never duplicates', async () => {
  const { buildSegment, buildRunRow, checklist, appendRun, anonymizeDoc, effortDaysToSize, costWeightedCacheShare, renderCompare } = await import('./build-tokenomics-export.mjs');
  const c = buildBatchCost('b1', RECEIPT, [
    line('s1', [sub('implement:TC-101', 90_000, { costUsd: 1.40, activeMin: 12 })], { costUsd: 2.40 }),
  ]);
  const seg = buildSegment({ factory_id: 'proj-x-test-automation' }, c);
  assert.equal(seg.factory_id, 'proj-x-test-automation');
  assert.equal(seg.stop, 'testing');
  assert.equal(seg.work_item_level, 'feature');
  const row = buildRunRow(c, { factory_id: 'proj-x-test-automation' });
  assert.equal(row.work_item_ref, 'T-b1', 'telemetry cohort prefix when no tracker ref was threaded');
  assert.equal(row.scenarios_automated, 2);
  assert.equal(row.tokens.cache_read, 91_000); // 90k sub + 1k parent
  assert.ok(row.cache_read_share_pct > 0 && row.cache_read_share_pct <= 100, 'COST share, not the token share');
  const checks = checklist(seg, row);
  assert.ok(checks.missing.some((m) => m.includes('effort_days')), 'no sizing → flagged, never invented');
  assert.ok(checks.missing.some((m) => m.includes('env_setup')), 'seed-owned field flagged when absent');
  // effort→size bands per §3.1 spine
  assert.equal(effortDaysToSize(0.4), 'XS');
  assert.equal(effortDaysToSize(2.5), 'M');
  assert.equal(effortDaysToSize(30), 'XL');
  assert.equal(costWeightedCacheShare(null), null);
  // append: upsert by work_item_ref — a re-closed batch replaces its row
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const repo = mkdtempSync(join(tmpdir(), 'export-v2-'));
  const first = appendRun(repo, c, { factory_id: 'proj-x-test-automation' });
  assert.equal(first.replaced, false);
  const second = appendRun(repo, c, { factory_id: 'proj-x-test-automation' });
  assert.equal(second.replaced, true, 'latest close wins — never a duplicate row');
  const doc = JSON.parse(readFileSync(first.path, 'utf8'));
  assert.equal(doc.runs.length, 1);
  assert.equal(doc.schema_version, '1.0');
  // anonymisation: opaque refs + generic briefs (submission norm)
  const anon = anonymizeDoc(doc);
  assert.equal(anon.runs[0].work_item_ref, 'T-WI-001');
  assert.doesNotMatch(anon.runs[0].work_item_brief, /b1/);
  // compare renders both rows without throwing
  assert.match(renderCompare(c, c), /per delivered \(incl\. overhead\)/);
});

// The full token quad rides every bucket — the scalar sum hides that ~95% is
// cache-read at ~1/10 input price (a $16 batch read as "47.5M tokens"). The
// tokenomics view renders composition + hit rate from exactly these quads.
test('token quads ride byRole, overhead.lead and per-case direct buckets', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-tok-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tele, { recursive: true });
  const s1 = sub('implement:TC-101', 9000, { costUsd: 1.25 });
  s1.tokens = { input: 100, output: 400, cacheRead: 8000, cacheWrite: 500 };
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [s1], { costUsd: 2.0 }))}\n`);
  const [c] = updateBatchCosts(repo);
  const role = c.byRole['test-automation-engineer'];
  assert.deepEqual(role.tok, { input: 100, output: 400, cacheRead: 8000, cacheWrite: 500 });
  const tc = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc.direct.tok.output, 400, 'per-case direct carries the quad');
  assert.ok(c.overhead.lead.tok, 'lead bucket carries a quad too');
  assert.ok(c.totals.tokensSplit, 'batch-level split still present');
});

// Sizing join: pre-run predicted size (automation-scoping) vs the size class's
// cross-batch actuals. Flags are tokens/time ANALYSIS POINTERS — the scoping
// doctrine forbids per-case dollar verdicts (Spearman ~0.015 on 89 cases).
test('applySizing: percentile flags against size-class history, batch-grain est-vs-actual', async () => {
  const { applySizing } = await import('./batch-cost.mjs');
  const mk = (id, rw, min) => ({ id, direct: { tok: { input: 0, output: rw, cacheRead: 0, cacheWrite: 0 }, activeMin: min, tokens: rw, dispatches: 1, fixRounds: 0 }, findings: 0 });
  const cases = [mk('TC-1', 60000, 20), mk('TC-2', 9000, 8), mk('TC-3', 10000, 9)];
  const sizings = new Map([
    ['TC-1', { size: 'S', sp: 2, estMin: 10, src: 't.json' }],
    ['TC-2', { size: 'S', sp: 2, estMin: 10, src: 't.json' }],
    ['TC-3', { size: 'XL', sp: 13, estMin: 60, src: 't.json' }],
  ]);
  const baselines = {
    S: { tok: [8000, 9000, 10000, 11000, 12000, 13000], min: [7, 8, 9, 10, 11, 12] },
    XL: { tok: [50000, 60000], min: [40, 50] },   // n<5 → no verdict
  };
  const roll = applySizing(cases, sizings, baselines);
  assert.equal(cases[0].sizing.flag, 'above-p90', 'S-case at 5x class median flags high');
  assert.equal(cases[1].sizing.flag, undefined, 'mid-class case carries no flag');
  assert.match(cases[2].sizing.note, /insufficient XL-class history/);
  assert.equal(roll.flagged.length, 1);
  assert.match(roll.flagged[0].detail, /review: estimate drift, execution smell, or a mis-sized case/);
  assert.equal(roll.estVsActualMin.est, 80);
  assert.equal(roll.estVsActualMin.actual, 37);
  assert.match(roll.note, /never per-case dollar verdicts/);
});

test('loadSizings: tolerant of score-cases --json shape and bare arrays', async () => {
  const { loadSizings } = await import('./batch-cost.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const repo = mkdtempSync(join(tmpdir(), 'sizing-'));
  const dir = join(repo, '.agents', 'estimation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scope-scored.json'), JSON.stringify({ cases: [
    { id: 'TC-1', size: 'M', sp: 5, estimated_active_minutes: 25 },
    { id: 'TC-2', size: { size: 'L', sp: 8 }, estimated_active_minutes: 40 },
    { note: 'no id — skipped' },
  ] }));
  const m = loadSizings(repo);
  assert.equal(m.get('TC-1').size, 'M');
  assert.equal(m.get('TC-2').size, 'L');
  assert.equal(m.get('TC-2').sp, 8);
  assert.equal(m.size, 2);
});

// Case ids repeat across batch GENERATIONS, and the catch-up capture heals
// pre-era sessions into the ledger — a bare id-match then resurrects them
// into the current batch (field 2026-08-18: +$17.89/+40% from a pre-reset
// session). A session that ended before the batch was first DECLARED is out,
// unless its own scope names the batch; undeclared batches keep id-match.
test('batch time window: sessions ended before the first declare are excluded', async () => {
  const { buildBatchCost } = await import('./batch-cost.mjs');
  const receipt = { batch: 'b2', cases: [{ id: 'TC-1', outcome: 'automated' }], gate: null };
  const mkLine = (id, endedAt, extra = {}) => ({
    v: 1, host: 'claude', id, user: 'u', repo: 'r', branch: 'tests/batch-b2', role: 'test-automation-lead',
    startedAt: endedAt, endedAt, wallMin: 10, activeMin: 10, turns: 5, toolCalls: 5, toolErrors: 0,
    tokens: { input: 1, output: 100, cacheRead: 0, cacheWrite: 0 }, costUsd: 2, costSource: 'ccusage-metered',
    cases: ['TC-1'], subagents: [], skills: [], dispatches: 1, capturedAt: endedAt, ...extra,
  });
  const old = mkLine('old-era', '2026-08-17T10:00:00Z');                      // ended before declare
  const cur = mkLine('current', '2026-08-18T14:00:00Z');                      // inside the window
  const named = mkLine('named', '2026-08-17T09:00:00Z', { scope: { batch: 'b2' } }); // pre-window but scope-named
  const scopes = [{ session: 'current', batch: 'b2', declaredAt: '2026-08-18T12:00:00Z', cases: ['TC-1'] }];
  const c = buildBatchCost('b2', receipt, [old, cur, named], { scopes });
  assert.equal(c.totals.costUsd, 4, 'old-era session excluded; current + scope-named counted');
  // no scope record for the batch → old behavior, everything id-matched counts
  const c2 = buildBatchCost('b2', receipt, [old, cur], { scopes: [] });
  assert.equal(c2.totals.costUsd, 4);
});

// PR #63 mirror: on a non-Anthropic gateway a dispatch can run to completion
// with ZERO usage records — that is the harness failing to report, not a free
// run. Unmeasured units go null+flag at capture; here the batch verdict says
// FLOOR instead of posing as a complete bill.
test('token attribution: unattributed units flag the totals as a floor', async () => {
  const withFlag = line('s1', [
    sub('implement:TC-101', 90_000, { costUsd: 1.40, activeMin: 12 }),
    { ...sub('review:TC-101', 0, { activeMin: 5 }), tokens: null, tokensAttributed: false },
  ], { costUsd: 2.40 });
  const c = buildBatchCost('b1', RECEIPT, [withFlag]);
  assert.equal(c.totals.tokensAttribution, 'partial');
  assert.equal(c.totals.unattributedUnits, 1);
  // fully attributed batch carries NO flag — absence means complete
  const clean = buildBatchCost('b1', RECEIPT, [line('s1', [sub('implement:TC-101', 90_000, { costUsd: 1.4, activeMin: 12 })], { costUsd: 2.4 })]);
  assert.equal(clean.totals.tokensAttribution, undefined);
  // and the dataset row carries the floor into notes + checklist
  const { buildRunRow, checklist, buildSegment } = await import('./build-tokenomics-export.mjs');
  const row = buildRunRow(c, { factory_id: 'x' });
  assert.match(row.notes, /TOKEN ATTRIBUTION PARTIAL/);
  const checks = checklist(buildSegment({ factory_id: 'x' }, c), row);
  assert.ok(checks.missing.some((m) => m.includes('FLOOR')));
});
