import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeObservation, observationId, appendObservation, readRaw, resolveObservations, validateRecord, validateEstimate, semanticKey, factKey, EVENTS, SOURCE_RANK } from './events.mjs';
import { deliveryDir, eventsPath } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-events-'));
const T0 = Date.parse('2026-09-16T10:00:00Z');
const base = (over = {}) => makeObservation({
  at: '2026-09-16T09:00:00Z', user: 'u', host: 'cli', plan: 'sec/run-1', item_id: 'sec/run-1/task-023', ref: 'TASK-023',
  level: 'task', event: 'done', transition_id: 'sec/run-1/task-023/done/episode-1', source: 'cli', source_record_id: 'tok-1', meta: { version: 1 }, ...over,
}, { now: T0 });
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'D', accepted_at: '2026-09-16T08:30:00Z' };

test('makeObservation fills v2 defaults and a stable, encoded observation_id', () => {
  const r = base();
  assert.equal(r.v, 2); assert.equal(r.recorded_at, '2026-09-16T10:00:00.000Z'); assert.equal(r.at, '2026-09-16T09:00:00.000Z');
  assert.equal(r.observation_id, observationId({ source: 'cli', sourceRecordId: 'tok-1', itemId: 'sec/run-1/task-023', event: 'done' }));
  assert.equal(r.observation_id, 'cli:tok-1:sec%2Frun-1%2Ftask-023:done');
  assert.equal(r.revision, 0); assert.equal(r.status, 'active'); assert.equal(r.basis, 'observed'); assert.equal(r.session, null);
  assert.ok(EVENTS.includes('rework_observed')); assert.equal(SOURCE_RANK.cli, 0); assert.equal(SOURCE_RANK.git, 3);
  assert.deepEqual(validateRecord(r), []);
});

test('validation: events, dates, sources, transition, nullable item, estimate, calibrated reference', () => {
  assert.throws(() => base({ event: 'merged' }), /SCHEMA-INVALID\(event/);
  assert.throws(() => base({ at: 'yesterday' }), /SCHEMA-INVALID\(at/);
  assert.throws(() => base({ source: 'manual' }), /SCHEMA-INVALID\(source/);
  assert.throws(() => base({ transition_id: '' }), /SCHEMA-INVALID\(transition_id/);
  assert.throws(() => base({ item_id: null }), /SCHEMA-INVALID\(item_id/);
  assert.throws(() => base({ item_id: null, ref: null, level: null, meta: { unattributed: true } }), /SCHEMA-INVALID\(item_id/, 'unattributed only for dispatch events');
  assert.doesNotThrow(() => base({ item_id: null, ref: null, level: null, event: 'dispatched', meta: { unattributed: true } }));
  assert.throws(() => base({ revision: -1 }), /SCHEMA-INVALID\(revision/);
  assert.throws(() => base({ event: 'estimated', estimate: { ...EST, unit: 'd' } }), /SCHEMA-INVALID\(estimate\.unit/);
  assert.deepEqual(validateEstimate(EST), []);
  assert.ok(validateEstimate({ ...EST, low: 5 }).some((e) => /low/.test(e)));
  assert.ok(validateEstimate({ ...EST, probability: 1 }).some((e) => /probability/.test(e)));
  assert.ok(validateEstimate({ ...EST, tier: 'calibrated' }).some((e) => /reference/.test(e)));
  assert.deepEqual(validateEstimate({ ...EST, tier: 'calibrated', reference: { path: 'calibration/x.json', sha256: 'a'.repeat(64), population: 'task/S first-cycle n=12' } }), []);
  const stored = { ...base(), at: '2026-09-16T09:00:00Z' };
  assert.ok(validateRecord(stored).some((e) => /at/.test(e)), 'stored clocks must be canonical ms ISO');
});

test('semanticKey ignores capture envelope; factKey includes plan, stage, sha — so different runs/stages never coalesce', () => {
  const a = base(); const b = base({ user: 'v', host: 'git', session: 's', label: 'x', meta: { version: 1, note: 'n' } });
  assert.equal(semanticKey(a), semanticKey(b));
  assert.notEqual(factKey(base({ plan: 'sec/run-2', item_id: 'sec/run-2/task-023', transition_id: 'sec/run-2/task-023/done/episode-1' })), factKey(a));
  const d1 = base({ event: 'dispatched', transition_id: 't/dispatched/a1', meta: { stage: 'build' } });
  const d2 = base({ event: 'dispatched', transition_id: 't/dispatched/a1', meta: { stage: 'review' } });
  assert.notEqual(factKey(d1), factKey(d2));
  assert.equal(factKey(base({ meta: { git_sha: 'abc' } })), factKey(base({ meta: { git_sha: 'abc', evidence: 'x' } })));
});

// F9: factKey/semanticKey must exclude meta.version (a plan re-cut regenerating the same
// SHA/item/event identity with a bumped version must not turn an unchanged historical fact
// into an ID-CONFLICT/retry mismatch) and must include meta.acceptance (an accepted variant
// and a stale-acceptance variant of the same observation must never coalesce).
test('F9: meta.version alone does not change identity (equal keys); meta.acceptance does (unequal keys)', () => {
  const v1 = base({ meta: { version: 1 } });
  const v2 = base({ meta: { version: 2 } });
  assert.equal(semanticKey(v1), semanticKey(v2), 'a version bump alone must not break semantic identity');
  assert.equal(factKey(v1), factKey(v2));

  const accepted = base({ meta: { acceptance: 'accepted' } });
  const stale = base({ meta: { acceptance: 'stale' } });
  assert.notEqual(semanticKey(accepted), semanticKey(stale), 'accepted vs stale-acceptance variants must not coalesce');
  assert.notEqual(factKey(accepted), factKey(stale));
});

test('appendObservation: EVENT, SKIP on identical retry (different recorded_at), ID-CONFLICT on changed semantics, EVENT for a higher revision', () => {
  const repo = tmp();
  assert.equal(appendObservation(repo, base(), { slug: 'u', now: T0 }).result, 'EVENT');
  assert.equal(appendObservation(repo, base(), { slug: 'u', now: T0 + 5000 }).result, 'SKIP');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(appendObservation(repo, base({ at: '2026-09-16T08:00:00Z' }), { slug: 'u', now: T0 }).result, 'ID-CONFLICT');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(appendObservation(repo, base({ at: '2026-09-16T08:00:00Z', revision: 1 }), { slug: 'u', now: T0 }).result, 'EVENT');
  assert.throws(() => appendObservation(repo, { ...base(), event: 'nope' }, { slug: 'u', now: T0 }), /SCHEMA-INVALID/);
});

// F9 (append path): a backfill re-cutting the plan bumps meta.version but must replay as a
// retry (SKIP) against the unchanged historical fact, never ID-CONFLICT.
test('F9: a plan re-cut backfill (meta.version bump alone) replays as SKIP, not ID-CONFLICT', () => {
  const repo = tmp();
  assert.equal(appendObservation(repo, base({ meta: { version: 1 } }), { slug: 'u', now: T0 }).result, 'EVENT');
  assert.equal(appendObservation(repo, base({ meta: { version: 2 } }), { slug: 'u', now: T0 + 1000 }).result, 'SKIP');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
});

test('readRaw: invalid UTF-8, torn JSON, schema-invalid JSON and unknown version are skipped with path:line; EOF record without newline is read; files hashed once', () => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true });
  const good = JSON.stringify(base());
  writeFileSync(eventsPath(repo, 'a'), Buffer.concat([Buffer.from(`${good}\n`), Buffer.from([0xc3, 0x28, 0x0a]), Buffer.from('{"v":2,"truncated":tru\n'), Buffer.from(`${JSON.stringify({ ...base({ source_record_id: 't2' }), revision: -1 })}\n`)]));
  writeFileSync(eventsPath(repo, 'b'), `${JSON.stringify({ ...base({ source_record_id: 't3' }), v: 9 })}\n${JSON.stringify(base({ source_record_id: 't4' }))}`);
  const raw = readRaw(repo);
  assert.equal(raw.counts.files, 2); assert.equal(raw.counts.parsed, 2); assert.equal(raw.counts.malformed, 3); assert.equal(raw.counts.unknownVersion, 1);
  assert.deepEqual(raw.malformed.map((m) => m.line), [2, 3, 4]);
  assert.match(raw.malformed[0].reason, /utf-8/i); assert.match(raw.malformed[2].reason, /revision/);
  assert.equal(raw.files.length, 2); assert.match(raw.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(raw.lines[1].line, 2, 'EOF record in file b is line 2');
});

test('resolveObservations: highest revision wins even after a conflicting lower one; top-revision conflict blocks and is reported; retracted dropped', () => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true });
  const w = (slug, rec) => appendFileSync(eventsPath(repo, slug), `${JSON.stringify(rec)}\n`);
  w('a', base()); w('a', base());                                                             // rev 0 + retry
  w('b', base({ revision: 1, at: '2026-09-16T08:30:00Z' }));                                   // correction
  w('a', base({ source_record_id: 'x', at: '2026-09-16T01:00:00Z' })); w('b', base({ source_record_id: 'x', at: '2026-09-16T02:00:00Z' })); // rev0 conflict
  w('a', base({ source_record_id: 'x', revision: 1, at: '2026-09-16T03:00:00Z' }));            // unique higher revision → supersedes the conflict
  w('a', base({ source_record_id: 'y', at: '2026-09-16T01:00:00Z' })); w('b', base({ source_record_id: 'y', at: '2026-09-16T02:00:00Z' })); // current conflict
  w('a', base({ source_record_id: 'z' })); w('b', base({ source_record_id: 'z', revision: 1, status: 'retracted' }));
  const r = resolveObservations(repo);
  const ids = r.active.map((o) => o.source_record_id).sort();
  assert.deepEqual(ids, ['tok-1', 'x']);
  assert.equal(r.active.find((o) => o.source_record_id === 'tok-1').at, '2026-09-16T08:30:00.000Z');
  assert.equal(r.active.find((o) => o.source_record_id === 'x').at, '2026-09-16T03:00:00.000Z');
  assert.equal(r.counts.retries, 1); assert.equal(r.counts.retracted, 1); assert.equal(r.counts.conflicts, 1);
  assert.equal(r.conflicts[0].observation_id, 'cli:y:sec%2Frun-1%2Ftask-023:done');
  assert.equal(r.conflicts[0].variants.length, 2, 'F8: every conflicting variant is reported, not just the first');
  assert.ok(r.conflicts[0].variants.every((v) => v.transition_id === 'sec/run-1/task-023/done/episode-1' && v.source === 'cli'));
  assert.ok(r.active[0]._at.path.endsWith('.jsonl') && r.active[0]._at.line > 0, 'evidence locator carried');
  assert.ok(!JSON.stringify(r.active[0]).includes('"_at"'), 'locator is not re-serialised');
});

// F8: when a same observation_id+revision has more than one conflicting variant (here they
// disagree on transition_id and basis), every variant's occurrence key must be exported so a
// downstream consumer (the timeline) can quarantine fallback for each, not just whichever
// variant happened to be read first. Provable regardless of file/arrival order; a unique
// higher revision still clears the conflict.
test('F8: a same-revision conflict with >2 variants exports every variant\'s occurrence key, order-independent; a higher unique correction clears it', () => {
  const variantA = base({ transition_id: 'sec/run-1/task-023/done/episode-1', source_record_id: 'v8', basis: 'observed' });
  const variantB = base({ transition_id: 'sec/run-1/task-023/done/episode-2', source_record_id: 'v8', basis: 'derived-child' });
  const variantC = base({ transition_id: 'sec/run-1/task-023/done/episode-3', source_record_id: 'v8', basis: 'gate-proxy' });
  const expected = [
    'sec/run-1/task-023/done/episode-1:observed',
    'sec/run-1/task-023/done/episode-2:derived-child',
    'sec/run-1/task-023/done/episode-3:gate-proxy',
  ].sort();

  const repoAscending = tmp(); mkdirSync(deliveryDir(repoAscending), { recursive: true });
  appendFileSync(eventsPath(repoAscending, 'a'), `${JSON.stringify(variantA)}\n`);
  appendFileSync(eventsPath(repoAscending, 'b'), `${JSON.stringify(variantB)}\n`);
  appendFileSync(eventsPath(repoAscending, 'c'), `${JSON.stringify(variantC)}\n`);
  const rAsc = resolveObservations(repoAscending);
  assert.equal(rAsc.conflicts.length, 1);
  assert.equal(rAsc.conflicts[0].variants.length, 3);
  assert.deepEqual(rAsc.conflicts[0].variants.map((v) => `${v.transition_id}:${v.basis}`).sort(), expected);
  assert.equal(rAsc.active.filter((o) => o.source_record_id === 'v8').length, 0, 'a conflicting observation contributes nothing to active');

  const repoDescending = tmp(); mkdirSync(deliveryDir(repoDescending), { recursive: true });
  appendFileSync(eventsPath(repoDescending, 'a'), `${JSON.stringify(variantC)}\n`);
  appendFileSync(eventsPath(repoDescending, 'b'), `${JSON.stringify(variantB)}\n`);
  appendFileSync(eventsPath(repoDescending, 'c'), `${JSON.stringify(variantA)}\n`);
  const rDesc = resolveObservations(repoDescending);
  assert.deepEqual(rDesc.conflicts[0].variants.map((v) => `${v.transition_id}:${v.basis}`).sort(), expected, 'reverse arrival order reports the same union, not just the first-read variant');

  appendFileSync(eventsPath(repoAscending, 'a'), `${JSON.stringify(base({ transition_id: 'sec/run-1/task-023/done/episode-4', source_record_id: 'v8', revision: 1 }))}\n`);
  const rCleared = resolveObservations(repoAscending);
  assert.equal(rCleared.conflicts.length, 0, 'a unique higher revision clears the conflict');
  assert.equal(rCleared.active.find((o) => o.source_record_id === 'v8').transition_id, 'sec/run-1/task-023/done/episode-4');
});
