import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runtime-wrapped script — same testing constraints as batch-build (see its
// test file): parse under the runtime's async wrapping + design invariants.

const FILE = fileURLToPath(new URL('./batch-integrate.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');

test('integrate workflow parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  new Function(
    'agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow',
    `"use strict"; return (async () => {\n${body}\n})`
  );
});

test('meta: canonical name and one phase — merging only', () => {
  assert.match(text, /name: 'ta-batch-integrate'/);
  assert.ok(text.includes("title: 'Integrate'"));
  // The board close-out phase is gone with the board itself: this workflow
  // writes no state, it returns what happened and the caller reports it.
  assert.doesNotMatch(text, /Board close-out/);
});

test('hard rules: never-delete, mechanical-only, gate stays out, writes no state', () => {
  assert.match(text, /never delete, rm, or checkout --ours\/--theirs/); // the rm -rf class, banned
  assert.match(text, /MECHANICAL/);
  assert.match(text, /SEMANTIC/);
  assert.match(text, /git merge --abort/); // park path exists
  assert.match(text, /never run the test suite/); // gate is the lead's
  assert.doesNotMatch(text, /gate-green/); // integration never advances gate statuses
  assert.doesNotMatch(text, /isolation: 'worktree'/); // no worktrees anywhere — branches isolate, order protects
  assert.match(text, /you must not create one/);
  assert.doesNotMatch(text, /set-status/);              // writes no state anywhere
  assert.match(text, /your return IS the record/);      // the caller reports it
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/); // stringified-args tolerance
});
