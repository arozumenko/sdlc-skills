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

// D2: stacked missions — M3 merges to main; M4 -> M3 branch, M5 -> M4 branch, M6 -> M5 branch (real replay-a shape).
const RA = 'ra/run-1', rid = (l, r) => `${RA}/${l}-${r}`;
const sit = (ref, level, parent) => ({ item_id: rid(level, ref), ref, level, parent_item_id: parent });
const stack = { run: RA, version: 1, source_epoch: { from: '2026-10-01T00:00:00Z', until: null, integration_ref: 'main' }, branch_prefix: 'replay-a', branch_map: [{ pattern: '-m(?<m>\\d+)(?:-[a-z][\\w-]*)?$', ref: 'M{m}' }],
  items: [sit('ra', 'campaign', null), ...[3, 4, 5, 6].map((n) => sit(`M${n}`, 'mission', rid('campaign', 'ra')))] };
const B3 = 'feat/replay-a-m3-transport-strip', B4 = 'feat/replay-a-m4-honest-data-reconnect', B5 = 'feat/replay-a-m5-recording-ended', B6 = 'feat/replay-a-m6-e2e-verification';
const dstack = (prs, o = {}) => derivePrObservations({ run: stack, prs, now: NOW, cutoff: '2026-12-31T00:00:00Z', ...o });

// Stacks land top-down: the top PR merges into its base branch first, so every head merges BEFORE its base moves onward.
test('D2: 3-deep stack lands at the main-bound PR\'s merge: time, sha and landing_pr come from #349, own pr number kept', () => {
  const { records, notes } = dstack([pr(372, B6, B5, '2026-10-03T00:00:00Z'), pr(364, B5, B4, '2026-10-04T00:00:00Z'), pr(356, B4, B3, '2026-10-05T00:00:00Z'), pr(349, B3, 'main', '2026-10-06T00:00:00Z')]);
  assert.deepEqual(notes, []); assert.deepEqual(records.map((r) => r.ref).sort(), ['M3', 'M4', 'M5', 'M6']);
  const m6 = records.find((r) => r.ref === 'M6'); assert.equal(m6.at, '2026-10-06T00:00:00.000Z'); assert.equal(m6.source_record_id, 'pr:372'); assert.equal(m6.transition_id, `${rid('mission', 'M6')}/done/episode-1`);
  assert.deepEqual(m6.meta, { pr: 372, git_sha: 'sha349', version: 1, head_ref: B6, base_ref: B5, stacked_into: 'M5', landing_pr: 349, landing: true });
  const m3 = records.find((r) => r.ref === 'M3'); assert.equal(m3.meta.landing, true); assert.equal(m3.meta.stacked_into, undefined);
});
test('D2: a stacked PR merged out of order (bottom first) did not ride along; a mission PR merged into its base AFTER the base already landed did not land via that chain', () => {
  const { records, notes } = dstack([pr(349, B3, 'main', '2026-10-03T00:00:00Z'), pr(356, B4, B3, '2026-10-04T00:00:00Z')]);
  assert.deepEqual(records.map((r) => r.ref), ['M3']); assert.ok(notes.some((n) => /PR #356.*after/.test(n)), notes.join('|'));
});
test('D2: a chain that never reaches the integration ref emits nothing and a note', () => {
  const { records, notes } = dstack([pr(364, B5, B4, '2026-10-03T00:00:00Z'), pr(356, B4, B3, '2026-10-04T00:00:00Z')]);
  assert.equal(records.length, 0); assert.equal(notes.length, 2); assert.ok(notes.every((n) => /never reaches main|no merged PR/.test(n)), notes.join('|'));
});
test('D2: a cycle (M4 into M3 then M3 into M4) terminates with no landing', () => {
  const { records, notes } = dstack([pr(1, B4, B3, '2026-10-03T00:00:00Z'), pr(2, B3, B4, '2026-10-04T00:00:00Z')]);
  assert.equal(records.length, 0); assert.equal(notes.length, 2);
});
test('D2: a task PR into a stacked mission branch still gives task done at its own merge; ties between candidate onward PRs pick the earliest one after the merge', () => {
  const run2 = { ...stack, branch_map: [{ pattern: '-m(?<m>\\d+)-t(?<t>\\d+)$', ref: 'T{m}.{t}' }, ...stack.branch_map], items: [...stack.items, { item_id: rid('task', 'T4.1'), ref: 'T4.1', level: 'task', parent_item_id: rid('mission', 'M4') }] };
  const { records } = derivePrObservations({ run: run2, now: NOW, cutoff: '2026-12-31T00:00:00Z', prs: [pr(10, 'feat/replay-a-m4-t1', B4, '2026-10-02T00:00:00Z'), pr(11, B4, B3, '2026-10-03T00:00:00Z'), pr(12, `${B4}-r2`, B3, '2026-10-04T00:00:00Z'), pr(13, B3, 'main', '2026-10-05T00:00:00Z')] });
  const t = records.find((r) => r.ref === 'T4.1'); assert.equal(t.at, '2026-10-02T00:00:00.000Z'); assert.equal(t.meta.landing, false);
  const m4 = records.filter((r) => r.ref === 'M4'); assert.equal(m4.length, 1); assert.equal(m4[0].source_record_id, 'pr:11');
});
