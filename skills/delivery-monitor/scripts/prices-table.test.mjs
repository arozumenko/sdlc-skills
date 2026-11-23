// The shipped price table against the multipliers Anthropic publishes
// (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-23):
// a 5-minute cache write is 1.25x the input price; a cache read is 0.1x the
// input price, except 0.025x on Fable 5.2 and 5.1 and 0.05x on Opus 5.5 and
// Sonnet 5.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { models } = JSON.parse(readFileSync(new URL('../references/prices.json', import.meta.url), 'utf8'));
const CACHE_READ = { 'claude-fable-5-2': 0.025, 'claude-fable-5-1': 0.025, 'claude-opus-5-5': 0.05, 'claude-sonnet-5-5': 0.05 };
const near = (a, b) => Math.abs(a - b) < 1e-9;

for (const [id, p] of Object.entries(models)) {
  test(`${id}: cache write is 1.25x input`, () => assert.ok(near(p.cache_write, p.input * 1.25), `${p.cache_write} != ${p.input * 1.25}`));
  test(`${id}: cache read is ${CACHE_READ[id] ?? 0.1}x input`, () => {
    const want = p.input * (CACHE_READ[id] ?? 0.1);
    assert.ok(near(p.cache_read, want), `cache_read ${p.cache_read}, published ${want}`);
  });
}

test('every model with a published reduced cache-read rate is in the table', () => {
  for (const id of Object.keys(CACHE_READ)) assert.ok(models[id], `${id} missing`);
});
