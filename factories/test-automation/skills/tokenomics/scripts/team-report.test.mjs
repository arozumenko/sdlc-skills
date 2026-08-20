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
  const dir = join(repo, '.agents', 'telemetry');
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
});
