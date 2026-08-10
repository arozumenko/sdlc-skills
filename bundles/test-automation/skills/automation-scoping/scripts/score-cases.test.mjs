import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadTaxonomy, classifyTier, baseMinutes, classifyNovelty, scoreCase,
  loadCases, loadVerdicts, rollupByTier,
} from './score-cases.mjs';

const { taxonomy } = loadTaxonomy();

test('loadTaxonomy loads the bundled default with expected shape', () => {
  assert.match(taxonomy.version, /^\d+\.\d+\.\d+$/);
  assert.ok(taxonomy.interaction_tiers.length >= 5);
  assert.ok(taxonomy.base_minutes_by_step_bucket.length >= 1);
});

test('classifyTier: canvas/drag-drop language wins over form language when both present', () => {
  const text = 'Fill in the form fields, then drag a node onto the canvas and wire an edge.';
  const tier = classifyTier(text, taxonomy.interaction_tiers);
  assert.equal(tier.id, 'rich-widget');
});

test('classifyTier: plain CRUD text classifies as crud-form', () => {
  const text = 'Create a new record, edit the name field, submit, verify the table row appears with pagination.';
  const tier = classifyTier(text, taxonomy.interaction_tiers);
  assert.equal(tier.id, 'crud-form');
});

test('classifyTier: no keyword match falls back to crud-form default', () => {
  const tier = classifyTier('the quick brown fox jumps over the lazy dog', taxonomy.interaction_tiers);
  assert.equal(tier.id, 'crud-form');
});

test('classifyTier: async/chat language wins even over rich-widget (priority order)', () => {
  const text = 'Send a chat message and wait for the AI response to stream in, then upload a file.';
  const tier = classifyTier(text, taxonomy.interaction_tiers);
  assert.equal(tier.id, 'async-realtime');
});

test('baseMinutes: step count buckets are monotonic', () => {
  const b = taxonomy.base_minutes_by_step_bucket;
  assert.equal(baseMinutes(3, b), 22);
  assert.equal(baseMinutes(5, b), 22);
  assert.equal(baseMinutes(6, b), 42);
  assert.equal(baseMinutes(10, b), 42);
  assert.equal(baseMinutes(11, b), 68);
  assert.equal(baseMinutes(50, b), 68);
});

test('classifyNovelty: unknown without app access', () => {
  const n = classifyNovelty('anything', undefined, taxonomy);
  assert.equal(n.key, 'unknown_no_app_access');
  assert.equal(n.mult, 1.0);
});

test('classifyNovelty: matches a known-covered surface keyword', () => {
  const n = classifyNovelty('Edit the personal token name', ['personal token'], taxonomy);
  assert.equal(n.key, 'established_surface');
});

test('classifyNovelty: known-surfaces list given but no match -> novel', () => {
  const n = classifyNovelty('Configure the Router node routes', ['personal token', 'notifications'], taxonomy);
  assert.equal(n.key, 'novel_surface_no_existing_coverage');
  assert.equal(n.mult, 1.45);
});

test('scoreCase: canvas case costs more than an equal-step-count form case (the core seed finding)', () => {
  const canvasCase = { id: 'C1', text: '| 1 | do a | b |\n| 2 | do b | c |\n| 3 | do c | d |\n| 4 | do d | e |\n| 5 | do e | f |\n| 6 | do f | g |\n| 7 | do g | h |\n| 8 | do h | i |\n| 9 | drag a node onto the canvas and wire an edge | ok |' };
  const formCase = { id: 'F1', text: '| 1 | do a | b |\n| 2 | do b | c |\n| 3 | do c | d |\n| 4 | do d | e |\n| 5 | do e | f |\n| 6 | do f | g |\n| 7 | do g | h |\n| 8 | do h | i |\n| 9 | submit the form and verify the table row | ok |' };
  const canvasScored = scoreCase(canvasCase, taxonomy);
  const formScored = scoreCase(formCase, taxonomy);
  assert.equal(canvasScored.steps, 9);
  assert.equal(formScored.steps, 9);
  assert.ok(canvasScored.estMin > formScored.estMin, `expected canvas (${canvasScored.estMin}) > form (${formScored.estMin})`);
});

test('scoreCase: cold estimate always has a wide confidence band label', () => {
  const s = scoreCase({ id: 'X', text: 'Create a record and submit the form.' }, taxonomy);
  assert.equal(s.confidence, taxonomy.confidence_bands.cold_no_history.label);
  assert.ok(s.lowCost <= s.estCost && s.estCost <= s.highCost);
});

test('scoreCase: custom rate overrides the taxonomy default', () => {
  const s1 = scoreCase({ id: 'X', text: 'Create a record and submit the form.' }, taxonomy);
  const s2 = scoreCase({ id: 'X', text: 'Create a record and submit the form.' }, taxonomy, { rate: 1.0 });
  assert.equal(s2.rate, 1.0);
  assert.ok(s2.estCost > s1.estCost);
});

test('scoreCase: bucket_stats, when present, override the formula', () => {
  const calibrated = JSON.parse(JSON.stringify(taxonomy));
  calibrated.bucket_stats['crud-form'] = { n: 12, mean_min: 57.8, stdev_min: 10 };
  const s = scoreCase({ id: 'X', text: 'Create a record and submit the form.' }, calibrated);
  assert.equal(s.estMin, 57.8);
  assert.equal(s.confidence, calibrated.confidence_bands.bucket_n_ge_5.label);
});

test('loadCases: reads a JSON array of plain description strings (Mode 1, no case files yet)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-test-'));
  const file = join(dir, 'descriptions.json');
  writeFileSync(file, JSON.stringify(['Create a widget and save it.', { id: 'X-2', text: 'Drag a node onto the canvas.' }]));
  const cases = loadCases(file);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].id, 'case-1');
  assert.equal(cases[1].id, 'X-2');
  rmSync(dir, { recursive: true, force: true });
});

test('loadCases: reads a TMS-style case file with frontmatter + steps table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-test-'));
  const file = join(dir, 'CASE-1.md');
  writeFileSync(file, `---
id: CASE-1
title: "Example"
module: widgets
---

## Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Create widget | appears |
| 2 | Save | persists |
`);
  const cases = loadCases(file);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'CASE-1');
  assert.equal(cases[0].frontmatter.module, 'widgets');
  const scored = scoreCase(cases[0], taxonomy);
  assert.equal(scored.steps, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('verdict tier overrides the keyword scan (the "create a report" trap)', () => {
  // Text reads like CRUD ("create"), but the reader saw a drag-drop builder.
  const row = {
    id: 'V1',
    text: 'Verify user can create a report.',
    verdict: { id: 'V1', tier: 'rich-widget', steps: 9 },
  };
  const s = scoreCase(row, taxonomy);
  assert.equal(s.tier, 'rich-widget');
  assert.equal(s.classification, 'verdict');
  assert.equal(s.steps, 9);
  assert.equal(s.stepsEstimated, false);
});

test('verdict with an unknown tier id falls back to the keyword scan', () => {
  const row = {
    id: 'V2',
    text: 'Create a record and submit the form.',
    verdict: { id: 'V2', tier: 'no-such-tier' },
  };
  const s = scoreCase(row, taxonomy);
  assert.equal(s.tier, 'crud-form');
  assert.equal(s.classification, 'keyword');
});

test('verdict novelty key overrides the known-surfaces keyword check', () => {
  const row = {
    id: 'V3',
    text: 'Edit the personal token name.',
    verdict: { id: 'V3', novelty: 'novel_surface_no_existing_coverage' },
  };
  const s = scoreCase(row, taxonomy, { knownSurfaceKeywords: ['personal token'] });
  assert.equal(s.novelty, 'novel_surface_no_existing_coverage');
});

test('quality flags force the widest band even over calibrated bucket_stats', () => {
  const calibrated = JSON.parse(JSON.stringify(taxonomy));
  calibrated.bucket_stats['crud-form'] = { n: 12, mean_min: 60, stdev_min: 5 };
  const clean = scoreCase({ id: 'Q1', text: 'submit the form' }, calibrated);
  const flagged = scoreCase({
    id: 'Q2', text: 'submit the form',
    verdict: { id: 'Q2', quality_flags: ['vague-steps', 'missing-expected'] },
  }, calibrated);
  assert.equal(clean.estMin, flagged.estMin); // flags never move the point estimate
  assert.ok(flagged.lowMin < clean.lowMin && flagged.highMin > clean.highMin,
    `expected flagged band (${flagged.lowMin}-${flagged.highMin}) wider than clean (${clean.lowMin}-${clean.highMin})`);
  assert.match(flagged.confidence, /quality-flagged/);
  assert.deepEqual(flagged.qualityFlags, ['vague-steps', 'missing-expected']);
});

test('modifiers and split_recommended ride through without moving the number', () => {
  const plain = scoreCase({ id: 'M1', text: 'submit the form' }, taxonomy);
  const modified = scoreCase({
    id: 'M2', text: 'submit the form',
    verdict: { id: 'M2', modifiers: ['rich-test-data', 'heavy-teardown'], split_recommended: true },
  }, taxonomy);
  assert.equal(plain.estMin, modified.estMin, 'modifiers are observational — never priced');
  assert.equal(plain.lowMin, modified.lowMin);
  assert.equal(plain.highMin, modified.highMin);
  assert.deepEqual(modified.modifiers, ['rich-test-data', 'heavy-teardown']);
  assert.equal(modified.splitRecommended, true);
  assert.equal(plain.splitRecommended, false);
});

test('loadVerdicts: reads an array or a {verdicts: []} wrapper, keyed by id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-test-'));
  const file = join(dir, 'verdicts.json');
  writeFileSync(file, JSON.stringify({ verdicts: [
    { id: 'CASE-1', tier: 'async-realtime', steps: 4, quality_flags: [] },
    { tier: 'crud-form' }, // no id -> ignored
  ] }));
  const map = loadVerdicts(file);
  assert.equal(map.size, 1);
  assert.equal(map.get('CASE-1').tier, 'async-realtime');
  rmSync(dir, { recursive: true, force: true });
});

test('rollupByTier: groups and averages correctly', () => {
  const scored = [
    scoreCase({ id: 'A', text: 'submit the form' }, taxonomy),
    scoreCase({ id: 'B', text: 'submit the form' }, taxonomy),
    scoreCase({ id: 'C', text: 'drag a node onto the canvas' }, taxonomy),
  ];
  const rollup = rollupByTier(scored);
  const crud = rollup.find((r) => r.tier === 'crud-form');
  const canvas = rollup.find((r) => r.tier === 'rich-widget');
  assert.equal(crud.n, 2);
  assert.equal(canvas.n, 1);
});
