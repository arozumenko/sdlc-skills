import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrObservations, readMergedPrs, acceptPr } from './pr-backfill.mjs';

const R = 'bp/run-1', id = (l, r) => `${R}/${l}-${r}`;
const it = (ref, level, parent, extra = {}) => ({ item_id: id(level, ref), ref, level, parent_item_id: parent, ...extra });
const run = { run: R, version: 2, source_epoch: { from: '2026-10-01T00:00:00Z', until: null, integration_ref: 'main' }, branch_prefix: 'bookmark-polish',
  branch_map: [{ pattern: '-m(?<m>\\d+)-t(?<t>\\d+)$', ref: 'T{m}.{t}' }, { pattern: '-m(?<m>\\d+)(?:-r\\d+)?$', ref: 'M{m}' }],
  items: [it('bp', 'campaign', null), it('M1', 'mission', id('campaign', 'bp')), it('M2', 'mission', id('campaign', 'bp')), it('T1.3', 'task', id('mission', 'M1')), it('T1.4', 'task', id('mission', 'M1')), it('T2.1', 'task', id('mission', 'M2'))] };
const pr = (number, head, base, mergedAt, extra = {}) => ({ number, title: `PR ${number}`, headRefName: head, baseRefName: base, createdAt: '2026-10-02T00:00:00Z', mergedAt, mergeCommit: { oid: `sha${number}` }, url: `https://x/pull/${number}`, ...extra });
const NOW = Date.parse('2026-10-10T00:00:00Z');
const derive = (prs, o = {}) => derivePrObservations({ run, prs, now: NOW, cutoff: '2026-12-31T00:00:00Z', ...o });

test('both shapes: task PR into the mission branch = task done; mission PR into main = mission done (landing)', () => {
  const { records, notes } = derive([
    pr(660, 'feat/bookmark-polish-m1-t3', 'feat/bookmark-polish-m1', '2026-10-03T10:00:00Z'),
    pr(661, 'feat/bookmark-polish-m1-t4', 'feat/bookmark-polish-m1', '2026-10-04T10:00:00Z'),
    pr(662, 'feat/bookmark-polish-m1', 'main', '2026-10-05T10:00:00Z'),
    pr(663, 'feat/bookmark-polish-m2-r2', 'main', '2026-10-06T10:00:00Z')]);
  assert.deepEqual(records.map((r) => [r.ref, r.event]), [['T1.3', 'done'], ['T1.4', 'done'], ['M1', 'done'], ['M2', 'done']]);
  const t3 = records[0]; assert.equal(t3.transition_id, `${id('task', 'T1.3')}/done/episode-1`); assert.equal(t3.source, 'git'); assert.equal(t3.host, 'git'); assert.equal(t3.basis, 'observed'); assert.equal(t3.source_record_id, 'pr:660');
  assert.deepEqual(t3.meta, { pr: 660, git_sha: 'sha660', version: 2, head_ref: 'feat/bookmark-polish-m1-t3', base_ref: 'feat/bookmark-polish-m1', landing: false });
  assert.equal(records[2].meta.landing, true, 'only base == integration_ref is landing evidence'); assert.equal(records[2].at, '2026-10-05T10:00:00.000Z');
  assert.deepEqual(notes, []);
});
test('task PR into main directly is a task done; task PR into a branch of ANOTHER mission or an unassociated base is rejected with a note', () => {
  const { records, notes } = derive([pr(1, 'feat/bookmark-polish-m1-t3', 'main', '2026-10-03T00:00:00Z'), pr(2, 'feat/bookmark-polish-m1-t4', 'feat/bookmark-polish-m2', '2026-10-03T00:00:00Z'), pr(3, 'feat/bookmark-polish-m2-t1', 'feat/random', '2026-10-03T00:00:00Z')]);
  assert.deepEqual(records.map((r) => r.ref), ['T1.3']); assert.equal(notes.length, 2); assert.match(notes[0], /PR #2/);
});
test('later merge for the same item is a note, not episode-2; ambiguity and unassociated PRs are notes; unmerged PRs ignored', () => {
  const { records, notes } = derive([pr(1, 'feat/bookmark-polish-m1-t3', 'feat/bookmark-polish-m1', '2026-10-03T00:00:00Z'), pr(2, 'feat/bookmark-polish-m1-t3', 'feat/bookmark-polish-m1', '2026-10-04T00:00:00Z'),
    pr(3, 'feat/bookmark-polish-x', 'main', '2026-10-04T00:00:00Z', { title: 'T1.3 and T1.4' }), pr(4, 'feat/bookmark-polish-m1-t4', 'feat/bookmark-polish-m1', null)]);
  assert.equal(records.length, 1); assert.ok(notes.some((n) => /later merge.*PR #2.*T1\.3/.test(n))); assert.ok(notes.some((n) => /PR #3.*ambiguous/.test(n)));
});
test('title association (b) works for a PR whose head carries no mapping', () => {
  assert.deepEqual(derive([pr(9, 'feat/bookmark-polish-misc', 'main', '2026-10-03T00:00:00Z', { title: 'Land T1.4 polish' })]).records.map((r) => r.ref), ['T1.4']);
});
test('F14 semantics: epoch/cutoff decide eligibility and episode-1; --since only gates emission', () => {
  const prs = [pr(1, 'feat/bookmark-polish-m1-t3', 'feat/bookmark-polish-m1', '2026-09-20T00:00:00Z'), pr(2, 'feat/bookmark-polish-m1-t3', 'feat/bookmark-polish-m1', '2026-10-05T00:00:00Z'), pr(3, 'feat/bookmark-polish-m1-t4', 'feat/bookmark-polish-m1', '2026-10-06T00:00:00Z')];
  const e = derive(prs); assert.deepEqual(e.records.map((r) => r.source_record_id), ['pr:2', 'pr:3'], 'PR 1 is before the epoch so PR 2 legitimately becomes episode-1'); assert.equal(e.skippedOutsideEpoch, 1);
  const s = derive(prs, { since: '2026-10-06T00:00:00Z' }); assert.deepEqual(s.records.map((r) => r.source_record_id), ['pr:3']); assert.ok(s.notes.some((n) => /before --since/.test(n)));
  assert.equal(derive(prs, { cutoff: '2026-10-05T00:00:00Z' }).records.length, 0, 'cutoff excludes PR 2 (>=) and PR 1 is pre-epoch');
});
test('acceptPr returns the reason for a rejection', () => { assert.equal(acceptPr(run, pr(1, 'feat/bookmark-polish-m1-t3', 'main', 'x')).item.ref, 'T1.3'); assert.match(acceptPr(run, pr(2, 'feat/other', 'main', 'x')).note, /no association|branch_prefix/); });

test('readMergedPrs: no --base filter, requests baseRefName, parses JSON; failures are USAGE-class errors', () => {
  let seen; const exec = (cmd, args) => { seen = [cmd, args]; return JSON.stringify([pr(1, 'a', 'main', '2026-10-03T00:00:00Z')]); };
  assert.equal(readMergedPrs('/r', { exec }).length, 1);
  assert.equal(seen[0], 'gh'); assert.ok(!seen[1].includes('--base')); assert.deepEqual(seen[1].slice(0, 6), ['pr', 'list', '--state', 'merged', '--limit', '1000']);
  assert.match(seen[1][seen[1].indexOf('--json') + 1], /baseRefName/);
  assert.throws(() => readMergedPrs('/r', { exec: () => { throw new Error('gh: not found'); } }), (e) => e.code === 'USAGE' && /gh pr list failed/.test(e.message));
  assert.throws(() => readMergedPrs('/r', { exec: () => 'not json' }), (e) => e.code === 'USAGE');
});
