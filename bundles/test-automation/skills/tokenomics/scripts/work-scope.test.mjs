// Tests for work-scope.mjs — the session's declared-scope record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openScope, recordOutcomes, closeScope, listScopes, scopePath, safeSession, main } from './work-scope.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'work-scope-'));
const NOW = '2026-08-12T10:00:00.000Z';

test('openScope: writes the record; re-open merges cases and preserves declaredAt', () => {
  const repo = tmp();
  const first = openScope(repo, { session: 's1', batch: 'b1', cases: ['TC-2', 'TC-1'], source: 'tms', now: NOW });
  assert.deepEqual(first.cases, ['TC-1', 'TC-2']);
  assert.equal(first.intent, 'automation');
  assert.equal(first.declaredAt, NOW);
  const again = openScope(repo, { session: 's1', cases: ['TC-3'], now: '2026-08-12T11:00:00.000Z' });
  assert.deepEqual(again.cases, ['TC-1', 'TC-2', 'TC-3'], 're-open merges, never drops');
  assert.equal(again.batch, 'b1', 'batch survives a re-open that omits it');
  assert.equal(again.declaredAt, NOW, 'declaredAt is the FIRST declaration');
  assert.ok(JSON.parse(readFileSync(scopePath(repo, 's1'), 'utf8')));
});

// intent is an OPEN vocabulary — manual-qa declares the same record shape.
test('openScope: generic intent and outcome vocabulary (manual-qa fits unchanged)', () => {
  const repo = tmp();
  openScope(repo, { session: 'm1', intent: 'manual-testing', cases: ['TC-101'], source: 'manual-qa', now: NOW });
  const s = recordOutcomes(repo, { session: 'm1', outcomes: { 'TC-101': 'PASS' }, now: NOW });
  assert.equal(s.intent, 'manual-testing');
  assert.equal(s.outcomes['TC-101'].outcome, 'PASS');
});

test('recordOutcomes: latest wins per id; an outcome on an undeclared case joins cases[]', () => {
  const repo = tmp();
  openScope(repo, { session: 's1', batch: 'b1', cases: ['TC-1'], now: NOW });
  recordOutcomes(repo, { session: 's1', outcomes: { 'TC-1': 'blocked' }, now: NOW });
  const s = recordOutcomes(repo, { session: 's1', outcomes: { 'TC-1': 'automated', 'TC-9': 'blocked' }, now: '2026-08-12T12:00:00.000Z' });
  assert.equal(s.outcomes['TC-1'].outcome, 'automated', 'latest wins');
  assert.ok(s.cases.includes('TC-9'), 'outcome implies membership');
});

test('recordOutcomes: self-healing — no prior open still lands a record', () => {
  const repo = tmp();
  const s = recordOutcomes(repo, { session: 'orphan', outcomes: { 'TC-5': 'automated' }, now: NOW });
  assert.deepEqual(s.cases, ['TC-5']);
});

test('closeScope + listScopes: closed scopes drop out of --open', () => {
  const repo = tmp();
  openScope(repo, { session: 'a', batch: 'b1', now: NOW });
  openScope(repo, { session: 'b', intent: 'other', now: NOW });
  closeScope(repo, { session: 'a', now: NOW });
  assert.equal(listScopes(repo).length, 2);
  assert.deepEqual(listScopes(repo, { openOnly: true }).map((s) => s.session), ['b']);
  assert.throws(() => closeScope(repo, { session: 'ghost' }), /nothing to close/);
});

test('safeSession: the id becomes a filename — traversal characters stripped', () => {
  assert.equal(safeSession('../../etc/passwd'), '....etcpasswd');
  assert.equal(safeSession('abc-123_D.e'), 'abc-123_D.e');
});

test('main: open/outcome/close round-trip through the CLI surface', async () => {
  const repo = tmp();
  assert.equal(await main(['open', '--session', 's9', '--batch', 'b2', '--cases', 'TC-1,TC-2', '--repo', repo], {}), 0);
  assert.equal(await main(['outcome', 'TC-1=automated', '--session', 's9', '--repo', repo], {}), 0);
  assert.equal(await main(['close', '--session', 's9', '--repo', repo], {}), 0);
  const s = JSON.parse(readFileSync(scopePath(repo, 's9'), 'utf8'));
  assert.equal(s.outcomes['TC-1'].outcome, 'automated');
  assert.ok(s.closedAt);
  assert.equal(await main(['open', '--repo', repo], {}), 1, 'no session id anywhere → refuse, never guess');
});

// Hosts whose agent cannot know the session id (Copilot) — a pending record
// the capture sweep later claims by time window.
test('main: --session auto creates a pending record', async () => {
  const repo = tmp();
  assert.equal(await main(['open', '--session', 'auto', '--batch', 'b3', '--repo', repo], {}), 0);
  const [s] = listScopes(repo);
  assert.match(s.session, /^pending-/);
  assert.equal(s.batch, 'b3');
});

// THE close-from-inside problem: the lead closes while its own session is
// still running, so that session has no ledger line yet — without capturing it
// first the report omits the very work it describes.
test('close: captures the still-running session so its own spend is in the report', async () => {
  const repo = tmp(); const proj = tmp();
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  // a live transcript for this session, discoverable via TOKENOMICS_CLAUDE_ROOT
  writeFileSync(join(proj, 'live-sess.jsonl'), jsonl([
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'automate TC-9' }, timestamp: '2026-08-13T10:00:00Z' },
    { type: 'assistant', gitBranch: 'tests/batch-b9', timestamp: '2026-08-13T10:05:00Z',
      message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 }, content: [] } },
  ]));
  const dir = join(repo, '.agents', 'automation', 'b9');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b9', cases: [{ id: 'TC-9', outcome: 'automated' }] }));
  openScope(repo, { session: 'live-sess', batch: 'b9', cases: ['TC-9'], now: NOW });

  const prevRoot = process.env.TOKENOMICS_CLAUDE_ROOT; const prevCc = process.env.TOKENOMICS_NO_CCUSAGE;
  process.env.TOKENOMICS_CLAUDE_ROOT = proj; process.env.TOKENOMICS_NO_CCUSAGE = '1';
  try {
    assert.ok(!existsSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-' + (process.env.USER ?? '') + '.jsonl')));
    assert.equal(await main(['close', '--session', 'live-sess', '--repo', repo], {}), 0);
    // the running session was captured into the ledger…
    const { listScopes } = await import('./work-scope.mjs');
    assert.ok(listScopes(repo)[0].closedAt);
    const cost = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
    assert.equal(cost.sources.sessions, 1, 'the still-running session IS in its own report');
    assert.ok(cost.totals.tokens > 0, 'and its spend counted');
  } finally {
    if (prevRoot === undefined) delete process.env.TOKENOMICS_CLAUDE_ROOT; else process.env.TOKENOMICS_CLAUDE_ROOT = prevRoot;
    if (prevCc === undefined) delete process.env.TOKENOMICS_NO_CCUSAGE; else process.env.TOKENOMICS_NO_CCUSAGE = prevCc;
  }
});

// Close is the batch's human milestone — it generates the batch report and
// surfaces receipt-vs-records drift while the lead can still act on it.
test('close: generates batch-report.md from the receipt, drift visible in it', async () => {
  const { generateBatchReports } = await import('./work-scope.mjs');
  const repo = tmp();
  const dir = join(repo, '.agents', 'automation', 'b5');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    batch: 'b5', gate: { verdict: 'not-run' },
    cases: [{ id: 'TC-7', outcome: 'merged-ungated' }],
  }));
  writeFileSync(join(dir, 'gate-runs.jsonl'),
    `${JSON.stringify({ at: '2026-08-13T09:00:00Z', branch: 'tests/batch-b5', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3 })}\n`);
  openScope(repo, { session: 'lead-1', batch: 'b5', cases: ['TC-7'], now: NOW });
  recordOutcomes(repo, { session: 'lead-1', outcomes: { 'TC-7': 'automated' }, now: NOW });
  assert.equal(await main(['close', '--session', 'lead-1', '--repo', repo], {}), 0);
  const md = readFileSync(join(dir, 'batch-report.md'), 'utf8');
  assert.match(md, /# Batch cost — b5/);
  assert.match(md, /GATE DRIFT/);
  assert.match(md, /OUTCOME DRIFT/);
  // the shareable page rides along, drift banners included
  const html = readFileSync(join(dir, 'batch-report.html'), 'utf8');
  assert.match(html, /<title>Batch cost — b5<\/title>/);
  assert.match(html, /GATE DRIFT/);
  // a wave declared by its short name still resolves to the nested receipt
  const wdir = join(repo, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, 'report.json'), JSON.stringify({ batch: 'camp', cases: [{ id: 'TC-8', outcome: 'automated' }] }));
  const reports = await generateBatchReports(repo, { batch: 'wave-01' });
  assert.equal(reports.length, 1);
  assert.match(reports[0].path, /camp\/wave-01\/batch-report\.md$/);
  // no receipt anywhere → close still succeeds, nothing rendered
  assert.deepEqual(await generateBatchReports(repo, { batch: 'ghost' }), []);
});
