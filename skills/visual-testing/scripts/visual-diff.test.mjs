import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRegArgs, summarize, runVisualDiff } from './visual-diff.mjs';

test('buildRegArgs: npx bin prepends --yes reg-cli@latest', () => {
  const args = buildRegArgs({ bin: 'npx', current: 'cur', baseline: 'base', diff: 'diff' });
  assert.deepStrictEqual(args.slice(0, 5), ['--yes', 'reg-cli@latest', 'cur', 'base', 'diff']);
  assert.ok(args.includes('-A'), 'antialias-tolerant flag present');
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

test('runVisualDiff: reads the report and swallows reg-cli\'s non-zero exit', () => {
  const diff = mkdtempSync(join(tmpdir(), 'vt-'));
  // Simulate reg-cli on a changed run: write the JSON report, then throw (as
  // execFileSync does on a non-zero exit). runVisualDiff must NOT propagate.
  const runner = (bin, args) => {
    const jsonPath = args[args.indexOf('-J') + 1];
    writeFileSync(jsonPath, JSON.stringify({
      failedItems: ['a.png'], newItems: [], deletedItems: [], passedItems: ['b.png'],
    }));
    throw new Error('reg-cli exited 1 (images differ)');
  };
  const s = runVisualDiff({ bin: 'reg-cli', current: 'c', baseline: 'b', diff }, runner);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.counts.failed, 1);
  assert.strictEqual(s.counts.passed, 1);
});

test('runVisualDiff: missing report resolves to an ok (no-op) summary', () => {
  const diff = mkdtempSync(join(tmpdir(), 'vt-'));
  const s = runVisualDiff({ bin: 'reg-cli', current: 'c', baseline: 'b', diff }, () => {});
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.counts, { failed: 0, new: 0, deleted: 0, passed: 0 });
});
