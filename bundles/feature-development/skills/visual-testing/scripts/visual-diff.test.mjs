import { test } from 'node:test';
import assert from 'node:assert';
import { buildRegArgs, summarize } from './visual-diff.mjs';

test('buildRegArgs: npx bin prepends --yes reg-cli@latest', () => {
  const args = buildRegArgs({ bin: 'npx', current: 'cur', baseline: 'base', diff: 'diff' });
  assert.deepStrictEqual(args.slice(0, 5), ['--yes', 'reg-cli@latest', 'cur', 'base', 'diff']);
  assert.ok(args.includes('-E'), 'antialias-aware flag present');
});

test('buildRegArgs: local bin omits the npx prefix', () => {
  const args = buildRegArgs({ bin: 'reg-cli', current: 'cur', baseline: 'base', diff: 'diff' });
  assert.deepStrictEqual(args.slice(0, 3), ['cur', 'base', 'diff']);
  assert.ok(!args.includes('--yes'));
});

test('buildRegArgs: report/json/update flags', () => {
  const args = buildRegArgs({ bin: 'reg-cli', current: 'c', baseline: 'b', diff: 'd',
    report: 'r.html', json: 'r.json', update: true });
  assert.ok(args.includes('-R') && args.includes('r.html'));
  assert.ok(args.includes('-J') && args.includes('r.json'));
  assert.ok(args.includes('-U'), 'update flag present when update:true');
});

test('buildRegArgs: no -U when update is false', () => {
  const args = buildRegArgs({ bin: 'reg-cli', current: 'c', baseline: 'b', diff: 'd' });
  assert.ok(!args.includes('-U'));
});

test('summarize: all passed -> ok', () => {
  const s = summarize({ passedItems: ['a', 'b'], failedItems: [], newItems: [], deletedItems: [] });
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.counts, { failed: 0, new: 0, deleted: 0, passed: 2 });
});

test('summarize: a failed item -> not ok', () => {
  const s = summarize({ passedItems: ['a'], failedItems: ['b'], newItems: [], deletedItems: [] });
  assert.strictEqual(s.ok, false);
  assert.match(s.message, /CHANGES/);
});

test('summarize: new or deleted item -> not ok', () => {
  assert.strictEqual(summarize({ newItems: ['x'], passedItems: [], failedItems: [], deletedItems: [] }).ok, false);
  assert.strictEqual(summarize({ deletedItems: ['x'], passedItems: [], failedItems: [], newItems: [] }).ok, false);
});

test('summarize: update mode is always ok even with changes', () => {
  const s = summarize({ failedItems: ['b'], newItems: ['n'], passedItems: [], deletedItems: [] }, { update: true });
  assert.strictEqual(s.ok, true);
  assert.match(s.message, /updated/);
});

test('summarize: tolerates missing arrays', () => {
  const s = summarize({});
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.counts, { failed: 0, new: 0, deleted: 0, passed: 0 });
});
