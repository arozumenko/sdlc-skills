// scripts/journey.test.mjs
//
// journeyOrder(screens) sorts a flow's screens into journey order by their
// `node` id, matching user-flow-maps ordering: whole numbers ascending form
// the main sequence; a decimal id is a branch that sorts immediately after
// its parent whole step, before the next whole step. Screens with no `node`
// sort last, preserving their original relative order (stable).
import { test } from 'node:test';
import assert from 'node:assert';
import { journeyOrder } from './journey.mjs';

test('sorts whole-number node ids ascending', () => {
  const screens = [
    { id: 'S-3', node: '3' },
    { id: 'S-1', node: '1' },
    { id: 'S-2', node: '2' },
    { id: 'S-0', node: '0' },
  ];
  assert.deepStrictEqual(journeyOrder(screens).map(s => s.id), ['S-0', 'S-1', 'S-2', 'S-3']);
});

test('decimal node id sorts immediately after its parent whole step', () => {
  const screens = [
    { id: 'S-3', node: '3' },
    { id: 'S-2.1', node: '2.1' },
    { id: 'S-2', node: '2' },
    { id: 'S-1', node: '1' },
  ];
  assert.deepStrictEqual(journeyOrder(screens).map(s => s.id), ['S-1', 'S-2', 'S-2.1', 'S-3']);
});

test('multiple decimals under the same parent sort ascending', () => {
  const screens = [
    { id: 'S-2.2', node: '2.2' },
    { id: 'S-3', node: '3' },
    { id: 'S-2.1', node: '2.1' },
    { id: 'S-2', node: '2' },
  ];
  assert.deepStrictEqual(journeyOrder(screens).map(s => s.id), ['S-2', 'S-2.1', 'S-2.2', 'S-3']);
});

test('screens with no node sort last, preserving original relative order', () => {
  const screens = [
    { id: 'S-none-a' },
    { id: 'S-2', node: '2' },
    { id: 'S-none-b' },
    { id: 'S-1', node: '1' },
  ];
  assert.deepStrictEqual(journeyOrder(screens).map(s => s.id),
    ['S-1', 'S-2', 'S-none-a', 'S-none-b']);
});

test('node as an array uses the first id for ordering', () => {
  const screens = [
    { id: 'S-3', node: ['3', '3.1'] },
    { id: 'S-1', node: ['1'] },
    { id: 'S-2', node: ['2', '4'] },
  ];
  assert.deepStrictEqual(journeyOrder(screens).map(s => s.id), ['S-1', 'S-2', 'S-3']);
});

test('does not mutate the input array', () => {
  const screens = [{ id: 'S-2', node: '2' }, { id: 'S-1', node: '1' }];
  const copy = screens.slice();
  journeyOrder(screens);
  assert.deepStrictEqual(screens, copy);
});

test('returns a new array (not the same reference)', () => {
  const screens = [{ id: 'S-1', node: '1' }];
  assert.notStrictEqual(journeyOrder(screens), screens);
});
