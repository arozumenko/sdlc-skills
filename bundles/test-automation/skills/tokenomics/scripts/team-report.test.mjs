// Tests for team-report.mjs — ledger merge/dedup, receipts join, honest dollars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadLines, dedupLines, filterWindow, filterRole, isoWeek, lineTokens, buildReport,
  loadCases, renderMarkdown, main,
} from './team-report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-report-'));
const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';

const line = (over = {}) => ({
  v: 1, host: 'claude', id: 'a', user: 'alice', repo: 'r', branch: 'main',
  role: 'test-automation-lead', models: ['claude-sonnet-5'],
  startedAt: '2026-07-30T10:00:00Z', endedAt: '2026-07-30T11:00:00Z', capturedAt: '2026-07-30T11:00:01Z',
  wallMin: 60, activeMin: 40, turns: 10, toolCalls: 20, toolErrors: 1,
  tokens: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 },
  costUsd: 2.5, costSource: 'ccusage-metered',
  subagents: [{ role: 'qa-engineer', n: 2, tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 }, activeMin: 15, toolCalls: 30, toolErrors: 2 }],
  skills: [], dispatches: 2,
  ...over,
});

function seedRepo() {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-alice.jsonl'), jsonl([
    line({ endedAt: '2026-07-30T10:30:00Z', capturedAt: '2026-07-30T10:30:01Z', costUsd: 1.0 }), // earlier capture of same session
    line(), // re-capture after resume — this one must win
  ]));
  writeFileSync(join(dir, 'usage-bob.jsonl'), jsonl([
    line({ id: 'b', host: 'copilot', user: 'bob', role: null, costUsd: 0.2, costSource: 'copilot-nano-aiu', startedAt: '2026-08-03T09:00:00Z', endedAt: '2026-08-03T09:30:00Z', subagents: [] }),
    line({ id: 'c', user: 'bob', costUsd: null, costSource: 'none', startedAt: '2026-08-03T10:00:00Z', subagents: [] }),
  ]));
  const auto = join(repo, '.agents', 'automation');
  mkdirSync(join(auto, 'batch1'), { recursive: true });
  mkdirSync(join(auto, 'batch2'), { recursive: true });
  writeFileSync(join(auto, 'batch1', 'report.json'), JSON.stringify({ cases: [{ id: 'C1', outcome: 'automated' }, { id: 'C2', outcome: 'blocked' }] }));
  writeFileSync(join(auto, 'batch2', 'report.json'), JSON.stringify({ cases: [{ id: 'C2', outcome: 'automated' }, { id: 'C3', outcome: 'not-started' }] }));
  const t1 = new Date('2026-07-30T12:00:00Z'); const t2 = new Date('2026-07-31T12:00:00Z');
  utimesSync(join(auto, 'batch1', 'report.json'), t1, t1);
  utimesSync(join(auto, 'batch2', 'report.json'), t2, t2);
  return repo;
}

test('dedupLines: latest endedAt wins per host:id', () => {
  const lines = loadLines([seedRepo()]);
  assert.equal(lines.length, 4);
  const deduped = dedupLines(lines);
  assert.equal(deduped.length, 3);
  const a = deduped.find((l) => l.id === 'a');
  assert.equal(a.costUsd, 2.5, 'the re-capture (later endedAt) replaced the earlier line');
});

test('lineTokens folds sub-agent tokens into the footprint', () => {
  assert.deepEqual(lineTokens(line()), { input: 600, output: 150, cacheRead: 1000, cacheWrite: 10 });
});

test('filterWindow uses the local start date', () => {
  const lines = dedupLines(loadLines([seedRepo()]));
  assert.equal(filterWindow(lines, '2026-08-01', null).length, 2);
  assert.equal(filterWindow(lines, null, '2026-07-31').length, 1);
});

test('filterRole: matches the session agent or any dispatched sub-agent role', () => {
  const lines = dedupLines(loadLines([seedRepo()]));
  const asLead = filterRole(lines, 'test-automation-lead');
  assert.equal(asLead.length, 2); // sessions a + c carry the lead role
  const viaSub = filterRole(lines, 'qa-engineer');
  assert.equal(viaSub.length, 1, 'session a matched through its qa-engineer sub-agents');
  assert.equal(filterRole(lines, 'nobody').length, 0);
  assert.equal(filterRole(lines, null).length, 3, 'no filter → untouched');
});

test('main: --role suppresses the per-delivered ratio (receipts are not role-attributable)', () => {
  const repo = seedRepo();
  const out = join(tmp(), 'role-report.md');
  assert.equal(main([repo, '--role', 'test-automation-lead', '--out', out]), 0);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /role: test-automation-lead/);
  assert.doesNotMatch(md, /Per delivered case/);
});

test('isoWeek: stable labels', () => {
  assert.equal(isoWeek('2026-07-30T10:00:00Z'), '2026-W31');
  assert.equal(isoWeek('garbage'), 'unknown');
});

test('loadCases: latest receipt wins per case, delivered = automated', () => {
  const repo = seedRepo();
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  assert.equal(cases.examined, 3);
  assert.equal(cases.delivered, 2); // C1 + C2 (re-entered blocked → automated)
  assert.deepEqual(cases.outcomes, { automated: 2, 'not-started': 1 });
});

// Campaign waves live at <batch>/<wave>/report.json — the receipt walk must
// find them, or every campaign silently under-counts (same fix run-reports.mjs
// already carries in efficiency-audit).
test('loadCases: discovers nested campaign-wave receipts', () => {
  const repo = tmp();
  const wave = join(repo, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wave, { recursive: true });
  writeFileSync(join(wave, 'report.json'), JSON.stringify({
    batch: 'camp', cases: [{ id: 'W-1', outcome: 'automated' }, { id: 'W-2', outcome: 'blocked' }],
  }));
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  assert.equal(cases.examined, 2);
  assert.equal(cases.delivered, 1);
  assert.equal(cases.reports, 1);
});

test('buildReport: totals, honest dollars, role grain includes sub-agent roles', () => {
  const repo = seedRepo();
  const lines = dedupLines(loadLines([repo]));
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  const rep = buildReport(lines, cases);
  assert.equal(rep.sessions, 3);
  assert.equal(rep.people, 2);
  assert.equal(rep.totals.priced, 2);
  assert.ok(Math.abs(rep.totals.costUsd - 2.7) < 1e-9);
  assert.equal(rep.tokensOnly, 1);
  assert.deepEqual(rep.costSources, { 'ccusage-metered': 1, 'copilot-nano-aiu': 1 });
  assert.ok(rep.byRole['qa-engineer'], 'sub-agent role surfaces');
  assert.equal(rep.byRole['qa-engineer'].units, 2);
  assert.ok(rep.byRole['(interactive session)'], 'null-role Copilot session bucketed');
  assert.ok(Math.abs(rep.perDelivered.costUsd - 2.7 / 2) < 1e-9);
});

test('renderMarkdown: leads with real-figures-only cost and flags tokens-only sessions', () => {
  const repo = seedRepo();
  const rep = buildReport(dedupLines(loadLines([repo])), loadCases([join(repo, '.agents', 'automation')]));
  const md = renderMarkdown(rep, { window: null });
  assert.match(md, /real figures only/);
  assert.match(md, /1 session\(s\) tokens-only/);
  assert.match(md, /delivered \(automated\): 2/);
  assert.match(md, /## By person/);
});

test('main: end-to-end over a repo root with --out', () => {
  const repo = seedRepo();
  const out = join(tmp(), 'report.md');
  assert.equal(main([repo, '--out', out]), 0);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /Tokenomics — team usage report/);
  assert.match(md, /delivered \(automated\): 2/);
  // cross-batch per-case rollup: every batch's cost.json rows, loaded labelled
  assert.match(md, /## Per case — every batch's cost\.json rows/);
  assert.match(md, /loaded = direct measured work \+ an even share of the batch overhead/);
});

// The team page mirrors the markdown's discipline: real dollars only,
// tokens-only flagged, receipts join shown when present. Self-contained HTML —
// same rhythm as the manual-qa bundle's tokenomics HTML report.
test('main: --html renders the self-contained team page', () => {
  const repo = seedRepo();
  const out = join(tmp(), 'report.html');
  assert.equal(main([repo, '--html', '--out', out]), 0);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<title>Tokenomics — team report<\/title>/);
  assert.match(html, /delivered \/ examined/);
  assert.match(html, /By person/);
  assert.ok(!html.includes('http'), 'no external assets — self-contained page');
});

// Delivery report shows the HONEST token figure (real work) plus hit rate;
// the tokenomics render is the full unfolding of the same cost.json.
test('batch renders: real-work tokens + cache hit rate; tokenomics view unfolds composition', async () => {
  const { renderBatchMarkdown, renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } = await import('./team-report.mjs');
  const quad = { input: 1000, output: 4000, cacheRead: 95000, cacheWrite: 2000 };
  const cost = {
    batch: 'b1', generatedAt: 'x',
    sources: { sessions: 1, hosts: ['claude'], costSources: ['ccusage-metered'], models: ['m'] },
    outcomes: { automated: 1 }, delivered: 1, gate: { verdict: 'green', runs: 3 },
    totals: { costUsd: 5, tokens: 102000, tokensSplit: quad, activeMin: 30, dispatches: 3, turns: 5, toolCalls: 40, toolErrors: 1, skills: [] },
    overhead: { costUsd: 1, sharePct: 20, lead: { costUsd: 1, tokens: 50000, tok: quad, activeMin: 5, dispatches: 0, toolCalls: 5, toolErrors: 0 }, stages: { costUsd: null, tokens: 0, activeMin: 0, dispatches: 0 }, byStage: {} },
    averages: { totalPerDelivered: { costUsd: 5 }, directPerCase: { costUsd: 4 } },
    stats: { directCostUsd: { avg: 4, median: 4, min: 4, max: 4, n: 1 }, directTokens: { avg: 1, median: 1, min: 1, max: 1, n: 1 }, directActiveMin: { avg: 1, median: 1, min: 1, max: 1, n: 1 } },
    cases: [{ id: 'TC-1', outcome: 'automated', findings: 0, direct: { costUsd: 4, tokens: 102000, tok: quad, activeMin: 25, dispatches: 1, fixRounds: 0, toolCalls: 35, toolErrors: 1 }, loaded: { costUsd: 5, tokens: 1, activeMin: 30 } }],
    byRole: { 'qa-engineer': { costUsd: 4, tokens: 102000, tok: quad, activeMin: 25, dispatches: 1, toolCalls: 35, toolErrors: 1 } },
    coverage: { casesUnattributed: [] },
  };
  const md = renderBatchMarkdown(cost);
  assert.match(md, /real work 5,000/);
  assert.match(md, /Tokens: total 102,000/);
  assert.match(md, /cache hit rate 96.9%/);
  assert.match(md, /real-work tok/);
  assert.doesNotMatch(md.split('\n').find((l) => l.startsWith('- Total:')), /102,000/, 'the raw cache-inclusive sum no longer leads');
  const tok = renderBatchTokenomicsMarkdown(cost);
  assert.match(tok, /Composition — where the tokens went/);
  assert.match(tok, /cache read \| 95,000/);
  assert.match(tok, /Cache hit rate: 96.9%/);
  assert.match(tok, /\*\*total\*\* \| \*\*102,000\*\*/);
  assert.match(tok, /Orchestrator \(lead thread\) composition/);
  const html = renderBatchTokenomicsHtml(cost);
  assert.match(html, /Batch tokenomics — b1/);
  assert.match(html, /cache hit rate/i);
  // manual-qa design parity: kpi cards + a composition panel with a legend,
  // and the raw TOTAL is a first-class stat (user ask 2026-08-18), never hidden
  assert.match(html, /kpi-card/);
  assert.match(html, /Token composition/);
  assert.match(html, /legend-item/);
  assert.match(html, /stat-value">102,000/);
  assert.match(html, /incl\. cache replay/);
  assert.ok(!html.includes('http'), 'self-contained page — no external assets');
  assert.ok(!html.includes('http'), 'self-contained');
  // a quad-less (old) cost.json degrades to an explicit note, never throws
  const old = { ...cost, totals: { ...cost.totals, tokensSplit: undefined } };
  assert.match(renderBatchTokenomicsMarkdown(old), /No token split/);
});

// hit rate = textbook hits/(hits+misses) at token grain: a cache WRITE is a
// miss that got stored, so it belongs in the denominator; savings is the
// $-complement (1× uncached vs 1×/1.25×/0.1× as billed).
test('cacheHitRate counts writes as misses; cacheSavings prices the counterfactual', async () => {
  const { cacheHitRate, cacheSavings } = await import('./team-report.mjs');
  const t = { input: 1000, output: 4000, cacheRead: 95000, cacheWrite: 2000 };
  assert.ok(Math.abs(cacheHitRate(t) - 95000 / 98000) < 1e-9);
  const paid = 1000 + 2000 * 1.25 + 95000 * 0.1;
  assert.ok(Math.abs(cacheSavings(t) - (1 - paid / 98000)) < 1e-9);
  assert.equal(cacheHitRate({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 }), null, 'no prompt tokens → n/a, never NaN');
});
