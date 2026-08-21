import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBucketStats } from './calibrate.mjs';

test('computeBucketStats: excludes unpriced rows without zeroing them', () => {
  const rows = [
    { tier: 'crud-form', costUsd: 10, activeMin: 30 },
    { tier: 'crud-form', costUsd: null, activeMin: null },
    { tier: 'crud-form', costUsd: 20, activeMin: 50 },
  ];
  const stats = computeBucketStats(rows);
  assert.equal(stats['crud-form'].n, 2);
  assert.equal(stats['crud-form'].mean_min, 40);
});

test('computeBucketStats: single-row tier still reported (n=1, stdev=0)', () => {
  const rows = [{ tier: 'rich-widget', costUsd: 30, activeMin: 100 }];
  const stats = computeBucketStats(rows);
  assert.equal(stats['rich-widget'].n, 1);
  assert.equal(stats['rich-widget'].stdev_min, 0);
});

test('computeBucketStats: multi-row tier computes real mean/stdev', () => {
  const rows = [
    { tier: 'crud-form', costUsd: 10, activeMin: 40 },
    { tier: 'crud-form', costUsd: 10, activeMin: 60 },
    { tier: 'crud-form', costUsd: 10, activeMin: 80 },
  ];
  const stats = computeBucketStats(rows);
  assert.equal(stats['crud-form'].n, 3);
  assert.equal(stats['crud-form'].mean_min, 60);
  assert.ok(stats['crud-form'].stdev_min > 0);
});
