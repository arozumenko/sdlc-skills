import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runtime-wrapped script — same testing constraints as batch-build (see its
// test file): parse under the runtime's async wrapping + design invariants.

const FILE = fileURLToPath(new URL('./batch-stabilize.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');

test('stabilize workflow parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  new Function(
    'agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow',
    `"use strict"; return (async () => {\n${body}\n})`
  );
});

test('meta: canonical name and the three phases', () => {
  assert.match(text, /name: 'ta-batch-stabilize'/);
  for (const ph of ['Diagnose', 'Fix', 'Re-gate']) {
    assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  }
});

test('args robustness: stringified args are parsed', () => {
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/);
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
});

// The whole point: the batch gate runs specs together precisely to surface
// failures a single-spec run cannot produce, so its unique failures are
// batch-level by construction. One agent must see them all at once.
test('diagnosis reads ALL failures together and answers how many CAUSES', () => {
  assert.match(text, /Read them TOGETHER before reading any code/);
  assert.match(text, /how many distinct causes there are, not how many specs failed/);
  assert.match(text, /'shared-state', 'ordering', 'fixture', 'timing', 'test-data', 'per-spec', 'unknown'/);
  // Evidence, not a guess — and an honest "I don't know" beats an invented cause.
  assert.match(text, /cite the file and the mechanism in `evidence`, never a guess/);
  assert.match(text, /unexplained/);
});

test('fixes are scoped by cause, not copied per spec, and carry a regression test', () => {
  assert.match(text, /Fix ONE diagnosed cause; do not range beyond it/);
  assert.match(text, /fixed ONCE in the shared object/);
  assert.match(text, /copying the same patch into each spec leaves the cause in place/);
  assert.match(text, /Add the regression test that would have caught this/);
});

// Stabilizing a red gate is exactly where masking is tempting: the fastest way
// to green is to stop asserting. That is the opposite of the run's purpose.
test('masking is banned explicitly in the fix prompt', () => {
  assert.match(text, /Do NOT weaken or delete an assertion, do NOT add a sleep/);
  assert.match(text, /skipped\/xfail/);
  assert.match(text, /defect masking/);
});

test('fixes run sequentially — one writer in the one working tree', () => {
  assert.match(text, /for \(const cause of causes\)/);        // not parallel/pipeline
  assert.doesNotMatch(text, /parallel\(|pipeline\(/);
  assert.match(text, /No worktree is created for you and you must not create one/);
  assert.match(text, /never `-A`/);
});

test('the gate re-runs it: same contract, and it never fixes or classifies', () => {
  assert.match(text, /CONSECUTIVE deterministic green runs/);
  assert.match(text, /A red anywhere ENDS the attempt/);
  assert.match(text, /Do NOT merge\. Do NOT fix\. Do NOT classify\./);
  assert.match(text, /gate-case\.mjs/);
});

// A survivor of a fix is evidence, not noise: either the fix was wrong or the
// failure always had another cause. Re-running the same hypothesis is how a
// loop burns a budget without converging.
test('a still-red round re-diagnoses instead of retrying the same hypothesis', () => {
  assert.match(text, /A failure that survived a fix is EVIDENCE/);
  assert.match(text, /do not simply restate the previous diagnosis/);
});

test('bounded, and it refuses to call a remaining red acceptable', () => {
  assert.match(text, /MAX_ROUNDS = A\.rounds \?\? 2/);
  assert.match(text, /if \(round === MAX_ROUNDS\) break/);
  assert.match(text, /still-red/);
  assert.match(text, /Do NOT merge this branch/);
  // Merging stays the lead's, per the project's PR policy — never this script's.
  assert.doesNotMatch(text, /gh pr merge/);
});

test('classification is the lead\'s: this runs only after it', () => {
  assert.match(text, /already classified this as a TEST-CODE bug or a flake, so do not re-argue that/);
  assert.match(text, /A product defect goes to the tracker/);
});
