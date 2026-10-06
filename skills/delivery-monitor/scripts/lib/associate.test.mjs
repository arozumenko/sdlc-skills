import { test } from 'node:test';
import assert from 'node:assert/strict';
import { associate, wordHit, expandRef } from './associate.mjs';
import { validatePlan } from './plan.mjs';

const R = 'bp/run-1';
const it = (ref, level, extra = {}) => ({ item_id: `${R}/${level}-${ref}`, ref, level, parent_item_id: null, ...extra });
const run = { run: R, branch_prefix: 'bookmark-polish', branch_map: [{ pattern: '-m(?<m>\\d+)-t(?<t>\\d+)$', ref: 'T{m}.{t}' }, { pattern: '-m(?<m>\\d+)(?:-r\\d+)?$', ref: 'M{m}' }], items: [
  it('bp', 'campaign'), it('M1', 'mission'), it('M2', 'mission'), it('T1.4', 'task', { branch: 'feat/bookmark-polish-odd' }), it('T1.5', 'task'), it('T2.1', 'task', { cancelled: true })] };

test('wordHit: whole token, case-insensitive', () => { assert.ok(wordHit('fix task-1', 'TASK-1')); assert.ok(!wordHit('TASK-10', 'TASK-1')); });
test('expandRef: fills named groups, null when a group is missing', () => { assert.equal(expandRef('T{m}.{t}', { m: '1', t: '4' }), 'T1.4'); assert.equal(expandRef('T{m}.{x}', { m: '1' }), null); });

test('associate: (a) exact alias beats title and map', () => {
  const r = associate(run, { head: 'feat/bookmark-polish-odd', title: 'T1.5 something' }); assert.deepEqual(r.items.map((i) => i.ref), ['T1.4']); assert.equal(r.how, 'alias');
});
test('associate: (b) title whole token; ambiguity yields nothing plus a note', () => {
  assert.deepEqual(associate(run, { head: 'feat/bookmark-polish-x', title: 'Land T1.5 now' }).items.map((i) => i.ref), ['T1.5']);
  const amb = associate(run, { head: 'feat/bookmark-polish-x', title: 'T1.4 and T1.5' }); assert.equal(amb.items.length, 0); assert.equal(amb.how, 'ambiguous'); assert.match(amb.note, /ambiguous/);
});
test('associate: (c) branch_map task, mission, and -r2 suffix', () => {
  const t = associate(run, { head: 'feat/bookmark-polish-m1-t4' }); assert.deepEqual(t.items.map((i) => i.ref), ['T1.4']); assert.equal(t.how, 'branch_map');
  assert.deepEqual(associate(run, { head: 'feat/bookmark-polish-m1' }).items.map((i) => i.ref), ['M1']);
  assert.deepEqual(associate(run, { head: 'feat/bookmark-polish-m2-r2' }).items.map((i) => i.ref), ['M2']);
});
test('associate: branch_prefix gates the whole run; cancelled items and unknown refs never match', () => {
  assert.equal(associate(run, { head: 'feat/other-m1-t4' }).items.length, 0);
  assert.equal(associate(run, { head: 'feat/bookmark-polish-m2-t1' }).items.length, 0, 'T2.1 is cancelled');
  assert.equal(associate(run, { head: 'feat/bookmark-polish-m9' }).items.length, 0, 'M9 not in plan');
});
test('associate: levels option restricts candidates', () => { assert.equal(associate(run, { head: 'feat/bookmark-polish-m1', levels: ['task'] }).items.length, 0); });
test('associate: a bad regex in branch_map is skipped, not thrown', () => { assert.equal(associate({ ...run, branch_map: [{ pattern: '(', ref: 'M1' }] }, { head: 'x-m1' }).items.length, 0); });

test('validatePlan: branch_map / branch_prefix shape', () => {
  const base = { campaign_id: 'c', run_id: 'r', version: 1, factory: 'feature-development', observation_start: '2026-01-01T00:00:00Z', source_epoch: { from: '2026-01-01T00:00:00Z', until: null, integration_ref: 'main' }, mission_kind: 'group', campaign: { ref: 'c' }, missions: [] };
  assert.deepEqual(validatePlan({ ...base, branch_prefix: 'x', branch_map: [{ pattern: '-m(?<m>\\d+)$', ref: 'M{m}' }] }), []);
  assert.ok(validatePlan({ ...base, branch_map: 'nope' }).some((e) => /branch_map must be an array/.test(e)));
  assert.ok(validatePlan({ ...base, branch_map: [{ pattern: '(', ref: 'M1' }] }).some((e) => /branch_map\[0\]\.pattern/.test(e)));
  assert.ok(validatePlan({ ...base, branch_map: [{ pattern: 'a' }] }).some((e) => /branch_map\[0\]\.ref/.test(e)));
  assert.ok(validatePlan({ ...base, branch_prefix: 3 }).some((e) => /branch_prefix/.test(e)));
});
