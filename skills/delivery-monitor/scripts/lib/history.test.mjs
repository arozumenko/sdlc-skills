import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendHistory, historyPath, readPrev, runSummary, sessionSummary, snapshot, writeBinding } from './history.mjs';
import { saveRun } from './plan.mjs';
import { plansDir, runPath, sessionPath, sessionsDir, whoAmI } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-hist-'));
const T1 = Date.parse('2026-09-16T10:00:00Z'), T2 = Date.parse('2026-09-16T11:00:00Z'), T3 = Date.parse('2026-09-16T12:00:00Z');
const iso = (t) => new Date(t).toISOString();
const SLUG = 'tester';
const lines = (repo) => { const p = historyPath(repo, SLUG); return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const rec = (over = {}) => ({ run: 'demo/run-1', status: 'open', version: 1, registered_at: iso(T1), updated_at: iso(T1), items: [], ...over });

test('historyPath: per-user file in the delivery dir', () => {
  const repo = tmp();
  assert.match(historyPath(repo, 'ann'), /\.agents[\\/]telemetry[\\/]delivery[\\/]history-ann\.jsonl$/);
});

test('summaries copy fields, null for a missing required field, optional keys only when present', () => {
  assert.deepEqual(sessionSummary({ plan: 'p', at: 'a', host: 'h' }), { plan: 'p', at: 'a' });
  assert.deepEqual(sessionSummary({ plan: 'p', at: 'a', bound_by: 'branch' }), { plan: 'p', at: 'a', bound_by: 'branch' });
  assert.deepEqual(sessionSummary({}), { plan: null, at: null });
  assert.deepEqual(runSummary({ status: 'open', version: 2, registered_at: 'r', updated_at: 'u', items: [1] }), { status: 'open', version: 2, registered_at: 'r', updated_at: 'u' });
  assert.deepEqual(runSummary({ backfill: { at: 'b', head: 'x' } }), { status: null, version: null, registered_at: null, updated_at: null, backfill_at: 'b' });
  assert.deepEqual(Object.keys(runSummary({ backfill: { at: 'b' } })), ['status', 'version', 'registered_at', 'updated_at', 'backfill_at']);
});

test('readPrev: missing, unreadable (corrupt, non-object, other read error), present', () => {
  const d = tmp(); const f = join(d, 'x.json');
  assert.deepEqual(readPrev(f, sessionSummary), { state: 'missing' });
  writeFileSync(f, '{oops'); assert.deepEqual(readPrev(f, sessionSummary), { state: 'unreadable' });
  writeFileSync(f, '[1]'); assert.deepEqual(readPrev(f, sessionSummary), { state: 'unreadable' });
  writeFileSync(f, 'null'); assert.deepEqual(readPrev(f, sessionSummary), { state: 'unreadable' });
  writeFileSync(f, '"s"'); assert.deepEqual(readPrev(f, sessionSummary), { state: 'unreadable' });
  assert.deepEqual(readPrev(d, sessionSummary), { state: 'unreadable' }, 'a directory is a read error, not a missing file');
  writeFileSync(f, JSON.stringify({ plan: 'p', at: 'a' })); assert.deepEqual(readPrev(f, sessionSummary), { state: 'present', value: { plan: 'p', at: 'a' } });
});

test('appendHistory: one line per record; a torn final line is kept as its own line', () => {
  const d = tmp(); const f = join(d, 'sub', 'h.jsonl');
  appendHistory(f, { a: 1 });
  appendHistory(f, { a: 2 });
  assert.equal(readFileSync(f, 'utf8'), '{"a":1}\n{"a":2}\n');
  appendFileSync(f, '{"torn":');
  appendHistory(f, { a: 3 });
  assert.equal(readFileSync(f, 'utf8'), '{"a":1}\n{"a":2}\n{"torn":\n{"a":3}\n');
});

test('writeBinding: exact session bytes, key order host/session/plan/at then bound_by', () => {
  const repo = tmp();
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1);
  assert.equal(readFileSync(sessionPath(repo, 'claude', 's1'), 'utf8'), `{"host":"claude","session":"s1","plan":"demo/run-1","at":"${iso(T1)}"}\n`);
  writeBinding(repo, 'claude', 's2', 'demo/run-1', T1, { bound_by: 'branch' });
  assert.equal(readFileSync(sessionPath(repo, 'claude', 's2'), 'utf8'), `{"host":"claude","session":"s2","plan":"demo/run-1","at":"${iso(T1)}","bound_by":"branch"}\n`);
});

test('writeBinding without by appends nothing; with by appends one record in the documented key order', () => {
  const repo = tmp();
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1);
  assert.equal(existsSync(historyPath(repo, SLUG)), false);
  writeBinding(repo, 'claude', 's1', 'demo/run-2', T2, { by: 'session_set', slug: SLUG });
  const [r, ...more] = lines(repo);
  assert.equal(more.length, 0);
  assert.deepEqual(Object.keys(r), ['v', 'kind', 'key', 'by', 'recorded_at', 'prev', 'next']);
  assert.deepEqual(r, { v: 'history.v1', kind: 'session', key: 'claude:s1', by: 'session_set', recorded_at: iso(T2), prev: { state: 'present', value: { plan: 'demo/run-1', at: iso(T1) } }, next: { plan: 'demo/run-2', at: iso(T2) } });
});

test('writeBinding: slug defaults to whoAmI(repo).slug, resolved inside the history step', () => {
  const repo = tmp();
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { by: 'branch', bound_by: 'branch' });
  const slug = whoAmI(repo).slug;
  const r = JSON.parse(readFileSync(historyPath(repo, slug), 'utf8'));
  assert.equal(r.by, 'branch'); assert.deepEqual(r.next, { plan: 'demo/run-1', at: iso(T1), bound_by: 'branch' });
});

test('saveRun: run file bytes unchanged; no by means no record; with by one record (missing then present)', () => {
  const repo = tmp();
  const a = rec();
  saveRun(repo, a);
  assert.equal(readFileSync(runPath(repo, a.run), 'utf8'), `${JSON.stringify(a, null, 2)}\n`);
  assert.equal(existsSync(historyPath(repo, SLUG)), false);
  rmSync(runPath(repo, a.run));
  saveRun(repo, a, { by: 'register', now: T1, slug: SLUG });
  const b = rec({ version: 2, updated_at: iso(T2), status: 'closed' });
  saveRun(repo, b, { by: 'close', now: T2, slug: SLUG });
  assert.equal(readFileSync(runPath(repo, a.run), 'utf8'), `${JSON.stringify(b, null, 2)}\n`);
  const [r1, r2] = lines(repo);
  assert.deepEqual(r1, { v: 'history.v1', kind: 'run', key: 'demo/run-1', by: 'register', recorded_at: iso(T1), prev: { state: 'missing' }, next: { status: 'open', version: 1, registered_at: iso(T1), updated_at: iso(T1) } });
  assert.deepEqual(r2.prev, { state: 'present', value: { status: 'open', version: 1, registered_at: iso(T1), updated_at: iso(T1) } });
  assert.deepEqual(r2.next, { status: 'closed', version: 2, registered_at: iso(T1), updated_at: iso(T2) });
});

test('first overwrite of a file written before history existed freezes its old timestamps in prev', () => {
  const repo = tmp();
  saveRun(repo, rec({ registered_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' }));
  mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, 'claude', 's1'), `${JSON.stringify({ host: 'claude', session: 's1', plan: 'demo/run-1', at: '2026-01-03T00:00:00.000Z' })}\n`);
  saveRun(repo, rec(), { by: 'close', now: T1, slug: SLUG });
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { by: 'session_set', slug: SLUG });
  const [r, s] = lines(repo);
  assert.deepEqual(r.prev.value, { status: 'open', version: 1, registered_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(s.prev.value, { plan: 'demo/run-1', at: '2026-01-03T00:00:00.000Z' });
});

test('a history failure never propagates: state still written, reason passed to onHistoryError', () => {
  const repo = tmp();
  mkdirSync(historyPath(repo, SLUG), { recursive: true });
  const reasons = [];
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { by: 'session_set', slug: SLUG, onHistoryError: (r) => reasons.push(r) });
  saveRun(repo, rec(), { by: 'register', now: T1, slug: SLUG, onHistoryError: (r) => reasons.push(r) });
  assert.ok(existsSync(sessionPath(repo, 'claude', 's1'))); assert.ok(existsSync(runPath(repo, 'demo/run-1')));
  assert.equal(reasons.length, 2); assert.ok(reasons.every((r) => typeof r === 'string' && r.length > 0 && !r.includes('\n')));
  // without a handler: silent
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T2, { by: 'session_set', slug: SLUG });
});

test('a failing slug lookup is also contained in the history step', () => {
  const repo = tmp();
  const reasons = [];
  writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { by: 'session_set', slug: { toString() { throw new Error('boom'); } }, onHistoryError: (r) => reasons.push(r) });
  assert.ok(existsSync(sessionPath(repo, 'claude', 's1'))); assert.equal(reasons.length, 1);
});

test('a state-write failure propagates and writes no record', () => {
  const repo = tmp();
  mkdirSync(dirname(sessionsDir(repo)), { recursive: true });
  writeFileSync(sessionsDir(repo), 'not a dir');
  assert.throws(() => writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { by: 'session_set', slug: SLUG }));
  const repo2 = tmp();
  mkdirSync(dirname(plansDir(repo2)), { recursive: true });
  writeFileSync(plansDir(repo2), 'not a dir');
  assert.throws(() => saveRun(repo2, rec(), { by: 'register', now: T1, slug: SLUG }));
  const repo3 = tmp();
  mkdirSync(runPath(repo3, 'demo/run-1'), { recursive: true });
  assert.throws(() => saveRun(repo3, rec(), { by: 'close', now: T1, slug: SLUG }));
  for (const r of [repo, repo2, repo3]) assert.equal(existsSync(historyPath(r, SLUG)), false);
});

test('documented limit: an unlogged A to B to A change between two logged writes leaves no trace', () => {
  const repo = tmp();
  const A = rec({ updated_at: iso(T1) }), B = rec({ status: 'closed', updated_at: iso(T2) });
  saveRun(repo, A, { by: 'register', now: T1, slug: SLUG });
  writeFileSync(runPath(repo, A.run), `${JSON.stringify(B, null, 2)}\n`); // direct, unlogged
  writeFileSync(runPath(repo, A.run), `${JSON.stringify(A, null, 2)}\n`); // and back
  saveRun(repo, rec({ updated_at: iso(T3) }), { by: 'roster', now: T3, slug: SLUG });
  const text = readFileSync(historyPath(repo, SLUG), 'utf8');
  assert.equal(lines(repo).length, 2);
  assert.doesNotMatch(text, /closed/);
  assert.deepEqual(lines(repo)[1].prev, { state: 'present', value: runSummary(A) });
});

test('documented limit: two overlapping writers can log out of order', () => {
  const repo = tmp();
  const path = runPath(repo, 'demo/run-1');
  mkdirSync(plansDir(repo), { recursive: true });
  // Writer 1 and writer 2 both observe "missing"; writer 2 finishes first, then writer 1 overwrites.
  const p1 = readPrev(path, runSummary), p2 = readPrev(path, runSummary);
  const w1 = rec({ version: 1, updated_at: iso(T1) }), w2 = rec({ version: 2, updated_at: iso(T2) });
  writeFileSync(path, `${JSON.stringify(w2, null, 2)}\n`); appendHistory(historyPath(repo, SLUG), { kind: 'run', by: 'register', recorded_at: iso(T2), prev: p2, next: runSummary(w2) });
  writeFileSync(path, `${JSON.stringify(w1, null, 2)}\n`); appendHistory(historyPath(repo, SLUG), { kind: 'run', by: 'register', recorded_at: iso(T1), prev: p1, next: runSummary(w1) });
  const l = lines(repo);
  assert.deepEqual(l.map((r) => r.prev.state), ['missing', 'missing']);
  assert.ok(l[1].recorded_at < l[0].recorded_at, 'the log order is not the real order');
});

test('snapshot: one record per readable file, sessions then runs, no prev, unreadable skipped, dry-run writes nothing', () => {
  const repo = tmp();
  saveRun(repo, rec({ run: 'demo/run-2' })); saveRun(repo, rec({ run: 'demo/run-1', backfill: { at: iso(T1) } }));
  writeBinding(repo, 'claude', 's2', 'demo/run-1', T1); writeBinding(repo, 'claude', 's1', 'demo/run-1', T1, { bound_by: 'branch' });
  writeFileSync(join(sessionsDir(repo), 'claude%3Abad.json'), '{oops');
  writeFileSync(join(plansDir(repo), 'x.json'), '[]');
  const seen = [];
  const dry = snapshot(repo, { dryRun: true, now: T2, slug: SLUG, emit: (l) => seen.push(l) });
  assert.deepEqual(dry, { sessions: 2, runs: 2, skipped: 2 });
  assert.deepEqual(seen, ['SKIP session claude:bad unreadable', 'WOULD-SNAPSHOT session claude:s1', 'WOULD-SNAPSHOT session claude:s2', 'WOULD-SNAPSHOT run demo/run-1', 'WOULD-SNAPSHOT run demo/run-2', 'SKIP run x unreadable']);
  assert.equal(existsSync(historyPath(repo, SLUG)), false);
  const real = snapshot(repo, { now: T2, slug: SLUG, emit: () => {} });
  assert.deepEqual(real, { sessions: 2, runs: 2, skipped: 2 });
  const l = lines(repo);
  assert.deepEqual(l.map((r) => `${r.kind} ${r.key}`), ['session claude:s1', 'session claude:s2', 'run demo/run-1', 'run demo/run-2']);
  assert.ok(l.every((r) => r.by === 'snapshot' && !('prev' in r) && r.recorded_at === iso(T2) && r.v === 'history.v1'));
  assert.deepEqual(l[0].next, { plan: 'demo/run-1', at: iso(T1), bound_by: 'branch' });
  assert.equal(l[2].next.backfill_at, iso(T1));
});

test('snapshot: missing directories count as zero; an append failure throws', () => {
  const repo = tmp();
  assert.deepEqual(snapshot(repo, { now: T1, slug: SLUG, emit: () => {} }), { sessions: 0, runs: 0, skipped: 0 });
  saveRun(repo, rec());
  mkdirSync(historyPath(repo, SLUG), { recursive: true });
  assert.throws(() => snapshot(repo, { now: T1, slug: SLUG, emit: () => {} }));
});
