import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Same testing posture as the batch workflows: the script runs only inside
// Claude Code's Workflow runtime (agent/parallel/phase/log as globals), so CI
// guards what it can — the body parses under the runtime wrapping, and the
// design invariants hold as text.

const FILE = fileURLToPath(new URL('./sizing.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');

test('workflow script parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  new Function(
    'agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow',
    `"use strict"; return (async () => {\n${body}\n})`
  );
});

test('meta: canonical name and the two phases', () => {
  assert.match(text, /name: 'ta-scope-sizing'/);
  for (const ph of ['Read', 'Score']) assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  // Workflow runtime forbids these (they break resume).
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
});

// Files come from args and chunks are sorted — the resume cache keys on exact
// prompts, so nothing about a prompt may depend on run timing.
test('deterministic inputs: files from args, sorted, bounded chunks', () => {
  assert.match(text, /Array\.isArray\(A\.files\)/);
  assert.match(text, /\.sort\(\)/);
  assert.match(text, /Math\.max\(1, Math\.min\(A\.chunk \?\? 15, 20\)\)/);
});

// Read-only fan-out is the sanctioned parallelism; only the writer touches disk.
test('parallel readers are read-only; one writer owns the disk', () => {
  assert.match(text, /await parallel\(chunks\.map/);
  assert.match(text, /READ-ONLY: no git, no writes, no browser/);
  assert.match(text, /the only disk write of this run/);
  assert.match(text, /EXACTLY this JSON, byte for byte/);
});

// The reader's contract is self-sufficient: project taxonomy first, bundled
// second, verdict semantics third — a cheap reader must never improvise tiers.
test('readers are told where the taxonomy lives, in precedence order', () => {
  assert.match(text, /complexity-taxonomy\.json — IF it exists/);
  assert.match(text, /references\/complexity-taxonomy\.md/);
  assert.match(text, /§ "The verdict pass"/);
  assert.match(text, /never keyword-matching/);
  assert.match(text, /OMIT rather than guess/);
});

// The script never prices: score-cases.mjs owns the arithmetic, and a failed
// scorer degrades to a hand-run command, never to a hand-made scored file.
test('arithmetic belongs to score-cases.mjs, with an honest degrade path', () => {
  assert.match(text, /NEVER price or size anything yourself/);
  assert.match(text, /score-cases\.mjs --verdicts/);
  assert.match(text, /never a hand-made scored file/);
  assert.match(text, /run score-cases\.mjs --verdicts .* by hand/);
});

// Stall contract (field 2026-08-17): a thrown chunk costs that chunk only.
test('guarded dispatches: a stalled chunk never kills the run', () => {
  assert.match(text, /const guarded = async \(what, fn\)/);
  assert.match(text, /infra-stalled \(environment — fix the provider before retrying\)/);
  assert.match(text, /chunk\(s\) died — their cases are simply missing/);
});

// Verdicts are schema-forced and hallucination-guarded.
test('verdict schema: required core fields, unreadable[] instead of invented rows', () => {
  assert.match(text, /required: \['id', 'tier', 'steps', 'size', 'confidence'\]/);
  assert.match(text, /enum: \['XS', 'S', 'M', 'L', 'XL'\]/);
  assert.match(text, /never an invented verdict/);
});
