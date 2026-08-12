import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadTaxonomy, classifyTier, baseMinutes, classifyNovelty, scoreCase,
  loadCases, loadVerdicts, rollupByTier,
  loadFoundationCatalog, deriveSize, resolveFoundation, rollupBySize,
} from './score-cases.mjs';

const { taxonomy } = loadTaxonomy();
const { catalog } = loadFoundationCatalog();

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

test('baseMinutes: step count buckets are monotonic (v0.6.0 pure-build scale)', () => {
  const b = taxonomy.base_minutes_by_step_bucket;
  assert.equal(baseMinutes(3, b), 13);
  assert.equal(baseMinutes(5, b), 13);
  assert.equal(baseMinutes(6, b), 25);
  assert.equal(baseMinutes(10, b), 25);
  assert.equal(baseMinutes(11, b), 41);
  assert.equal(baseMinutes(50, b), 41);
});

test('baseMinutes: the middle bucket matches the measured pure-case-build figure', () => {
  // 22.5 min/case examined, 25.0 delivered, measured on n=60 (see
  // base_minutes_note). A typical case in that set was 8-9 steps.
  assert.equal(baseMinutes(9, taxonomy.base_minutes_by_step_bucket), 25);
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

test('modifiers ride through without moving the number or the band', () => {
  const plain = scoreCase({ id: 'M1', text: 'submit the form' }, taxonomy);
  const modified = scoreCase({
    id: 'M2', text: 'submit the form',
    verdict: { id: 'M2', modifiers: ['rich-test-data', 'heavy-teardown'] },
  }, taxonomy);
  // Measured: heavy-teardown cases came in at 0.45x, complex-preconditions at
  // 0.70x — the "looks harder" modifiers do NOT predict overrun, so they stay
  // fully observational.
  assert.equal(plain.estMin, modified.estMin, 'modifiers are observational — never priced');
  assert.equal(plain.lowMin, modified.lowMin);
  assert.equal(plain.highMin, modified.highMin);
  assert.deepEqual(modified.modifiers, ['rich-test-data', 'heavy-teardown']);
});

test('split_recommended is carried on the row', () => {
  const plain = scoreCase({ id: 'M3', text: 'submit the form' }, taxonomy);
  const split = scoreCase({
    id: 'M4', text: 'submit the form', verdict: { id: 'M4', split_recommended: true },
  }, taxonomy);
  assert.equal(split.splitRecommended, true);
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

// ------------------------------------------------------------------ sizing

test('deriveSize: minimal case (few steps, one surface, no new abstractions) is S', () => {
  const s = deriveSize(taxonomy, {
    steps: 4, tier: { multiplier: 1.0 },
    verdict: { surfaces: 1, new_abstractions: 0 },
  });
  assert.equal(s.size, 'S');
  assert.equal(s.sp, 2);
  assert.equal(s.basis, 'derived');
  assert.equal(s.points, 0);
});

test('deriveSize: surfaces is the heaviest driver (v0.6.0 — r=+0.522 on holdout)', () => {
  const base = { steps: 8, tier: { multiplier: 1.0 } };
  const manySurfaces = deriveSize(taxonomy, { ...base, verdict: { surfaces: 6, new_abstractions: 0 } });
  const manyAbstractions = deriveSize(taxonomy, { ...base, verdict: { surfaces: 1, new_abstractions: 6 } });
  assert.ok(manySurfaces.points > manyAbstractions.points,
    `surfaces (${manySurfaces.points}) must outweigh abstractions (${manyAbstractions.points})`);
  assert.equal(manySurfaces.breakdown.surfaces, 3, 'surfaces maxes at 3 points');
  assert.equal(manyAbstractions.breakdown.new_abstractions, 2, 'abstractions max at 2 points');
});

test('deriveSize: steps is a floor, never the dominant driver', () => {
  const manySteps = deriveSize(taxonomy, {
    steps: 40, tier: { multiplier: 1.0 }, verdict: { surfaces: 1, new_abstractions: 0 },
  });
  const manySurfaces = deriveSize(taxonomy, {
    steps: 3, tier: { multiplier: 1.0 }, verdict: { surfaces: 6, new_abstractions: 0 },
  });
  assert.equal(manySteps.breakdown.steps, 2, 'steps maxes at 2 points');
  assert.ok(manySurfaces.points > manySteps.points,
    'a wide-but-short case outsizes a long single-surface one');
});

test('deriveSize: an expensive tier adds a point, a mid tier does not (no double-count with surfaces)', () => {
  const v = { surfaces: 1, new_abstractions: 0 };
  const rich = deriveSize(taxonomy, { steps: 8, tier: { multiplier: 1.42 }, verdict: v });
  const multiStep = deriveSize(taxonomy, { steps: 8, tier: { multiplier: 1.15 }, verdict: v });
  assert.equal(rich.breakdown.expensive_tier, 1);
  assert.equal(multiStep.breakdown.expensive_tier, 0);
});

test('deriveSize: an explicit verdict size wins over the driver score, including XS', () => {
  const s = deriveSize(taxonomy, {
    steps: 30, tier: { multiplier: 1.42 },
    verdict: { size: 'XS', surfaces: 9, new_abstractions: 9 },
  });
  assert.equal(s.size, 'XS');
  assert.equal(s.sp, 1);
  assert.equal(s.basis, 'verdict');
});

test('deriveSize: split_recommended no longer inflates the size (v0.6.1)', () => {
  // "Too big to estimate" is not "big" — measured, split-flagged cases came in
  // at 0.46x their estimate, so forcing XL made an already-high number worse.
  const drivers = { steps: 3, tier: { multiplier: 1.0 } };
  const plain = deriveSize(taxonomy, { ...drivers, verdict: { surfaces: 1, new_abstractions: 0 } });
  const split = deriveSize(taxonomy, {
    ...drivers, verdict: { surfaces: 1, new_abstractions: 0, split_recommended: true },
  });
  assert.equal(split.size, plain.size, 'size derives from the drivers either way');
  assert.equal(split.size, 'S');
  assert.notEqual(split.basis, 'split-forced');
});

test('deriveSize: missing surfaces/new_abstractions is flagged derived-partial (it under-sizes)', () => {
  const partial = deriveSize(taxonomy, { steps: 8, tier: { multiplier: 1.0 }, verdict: {} });
  const full = deriveSize(taxonomy, {
    steps: 8, tier: { multiplier: 1.0 },
    verdict: { surfaces: 4, new_abstractions: 3 },
  });
  assert.equal(partial.basis, 'derived-partial');
  assert.equal(full.basis, 'derived');
  assert.ok(full.points > partial.points, 'partial scores the unknown drivers as 0');
});

test('scoreCase: carries size/sp, and the SP cost only when a blended rate is supplied', () => {
  const row = {
    id: 'S1', text: 'submit the form',
    verdict: { id: 'S1', steps: 8, surfaces: 2, new_abstractions: 1 },
  };
  const noRate = scoreCase(row, taxonomy);
  const withRate = scoreCase(row, taxonomy, { blendedRate: 45 });
  assert.equal(noRate.size, 'M');
  assert.equal(noRate.sp, 4);
  assert.equal(noRate.spCost, null, 'no rate is defaulted — SP only');
  assert.equal(withRate.spCost, 180);
  assert.equal(noRate.estCost, withRate.estCost, 'the size axis never moves the agent-cost number');
});

// -------------------------------------------------------------- risk flags

test('risk flags widen the band without moving the point estimate', () => {
  const calibrated = JSON.parse(JSON.stringify(taxonomy));
  calibrated.bucket_stats['crud-form'] = { n: 12, mean_min: 60, stdev_min: 5 };
  const clean = scoreCase({ id: 'R1', text: 'submit the form' }, calibrated);
  const risky = scoreCase({
    id: 'R2', text: 'submit the form',
    verdict: { id: 'R2', risk_flags: ['nondeterministic-oracle', 'external-dependency'] },
  }, calibrated);
  assert.equal(clean.estMin, risky.estMin, 'risk flags are never priced');
  assert.ok(risky.lowMin < clean.lowMin && risky.highMin > clean.highMin);
  assert.match(risky.confidence, /risk-flagged/);
  assert.deepEqual(risky.riskFlags, ['nondeterministic-oracle', 'external-dependency']);
});

test("a reader's low confidence is promoted to a risk flag (was decoration in v0.5.0)", () => {
  const s = scoreCase({
    id: 'R3', text: 'submit the form', verdict: { id: 'R3', confidence: 'low' },
  }, taxonomy);
  assert.ok(s.riskFlags.includes('low-confidence-verdict'));
  assert.match(s.confidence, /risk-flagged/);
});

test('split_recommended stays in the total and skews the band DOWN (v0.6.2)', () => {
  const clean = scoreCase({ id: 'R4a', text: 'submit the form' }, taxonomy);
  const s = scoreCase({
    id: 'R4', text: 'submit the form',
    verdict: { id: 'R4', steps: 3, surfaces: 1, new_abstractions: 0, split_recommended: true },
  }, taxonomy);
  assert.equal(s.size, 'S', 'size comes from the drivers, not from the flag');
  assert.equal(s.estMin, clean.estMin, 'point estimate untouched — the case is NOT withheld');
  assert.ok(s.estCost > 0, 'a split candidate still carries its cost into the total');
  assert.equal(s.refineBySplitting, true);
  assert.ok(s.riskFlags.includes('split-recommended'));
  // measured 0.46x: splitting reveals SMALLER work, so the band reaches down
  const b = taxonomy.confidence_bands.skewed_low;
  assert.ok(b.high_mult < 2.0 && b.low_mult < 0.5, 'skewed_low is defined downward');
  assert.ok((s.estMin - s.lowMin) > (s.highMin - s.estMin), 'reaches further down than up');
});

test('a clean case carries no split marker', () => {
  const s = scoreCase({ id: 'R6', text: 'submit the form' }, taxonomy);
  assert.equal(s.refineBySplitting, false);
});

test('oracle/dependency risk flags skew HIGH like low confidence', () => {
  const s = scoreCase({
    id: 'R9', text: 'submit the form',
    verdict: { id: 'R9', risk_flags: ['nondeterministic-oracle'] },
  }, taxonomy);
  const b = taxonomy.confidence_bands.skewed_high;
  assert.equal(s.highMin, Math.round(s.estMin * b.high_mult * 10) / 10);
  assert.ok((s.highMin - s.estMin) > (s.estMin - s.lowMin));
});

test('low confidence extends the band UPWARD only (v0.6.1)', () => {
  const clean = scoreCase({ id: 'R7a', text: 'submit the form' }, taxonomy);
  const s = scoreCase({
    id: 'R7', text: 'submit the form', verdict: { id: 'R7', confidence: 'low' },
  }, taxonomy);
  const b = taxonomy.confidence_bands.skewed_high;
  assert.ok(b.high_mult > 2.0 && b.low_mult > 0.5, 'the band definition itself is asymmetric');
  assert.equal(s.estMin, clean.estMin, 'point estimate untouched');
  assert.ok(s.highMin > clean.highMin, 'upside reach grows');
  assert.ok(s.lowMin > clean.lowMin,
    'downside pulls IN — a case flagged as likely to overrun is unlikely to come in at half');
  assert.equal(s.highMin, Math.round(s.estMin * b.high_mult * 10) / 10);
  // the whole point: reaching further up than down
  assert.ok((s.highMin - s.estMin) > (s.estMin - s.lowMin));
});

test('low confidence + another flag unions both bands (widest of each side)', () => {
  const s = scoreCase({
    id: 'R8', text: 'submit the form',
    verdict: { id: 'R8', confidence: 'low', quality_flags: ['vague-steps'] },
  }, taxonomy);
  const cold = taxonomy.confidence_bands.cold_no_history;
  const skew = taxonomy.confidence_bands.skewed_high;
  assert.equal(s.lowMin, Math.round(s.estMin * cold.low_mult * 10) / 10, 'takes the lower low');
  assert.equal(s.highMin, Math.round(s.estMin * skew.high_mult * 10) / 10, 'takes the higher high');
});

test('high confidence adds no risk flag', () => {
  const s = scoreCase({
    id: 'R5', text: 'submit the form', verdict: { id: 'R5', confidence: 'high' },
  }, taxonomy);
  assert.deepEqual(s.riskFlags, []);
});

test('taxonomy ships the risk-flag vocabulary and the layer/clustering data', () => {
  for (const k of ['nondeterministic-oracle', 'external-dependency', 'low-confidence-verdict']) {
    assert.ok(taxonomy.risk_flags[k]?.definition, `${k} needs a definition`);
  }
  assert.ok(taxonomy.risk_flags.not_a_multiplier_because);
  assert.ok(taxonomy.fully_loaded_multiplier.value > 1);
  assert.equal(
    taxonomy.fully_loaded_multiplier.layers.case_branch_pct
    + taxonomy.fully_loaded_multiplier.layers.batch_trunk_pct
    + taxonomy.fully_loaded_multiplier.layers.orchestrator_pct, 100);
  assert.ok(taxonomy.clustering.report_requirement);
  assert.ok(taxonomy.batch_shape.measured.length >= 4, 'four audits of batch shape');
});

// ------------------------------------------------------------- case filter

test('loadCases: --match keeps only real case files out of a mixed directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-test-'));
  writeFileSync(join(dir, 'TC-001.md'), '| 1 | do a | b |\n');
  writeFileSync(join(dir, 'ELITEA-2001.md'), '| 1 | do a | b |\n');
  writeFileSync(join(dir, 'README.md'), 'This directory holds the artifacts suite.\n');
  writeFileSync(join(dir, 'TEST_DATA_STATUS.md'), 'Status of the fixtures.\n');
  assert.equal(loadCases(dir).length, 4, 'unfiltered scan takes every .md — the old trap');
  const filtered = loadCases(dir, /^(TC|ELITEA)-/);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((c) => c.id).sort(), ['ELITEA-2001', 'TC-001']);
  rmSync(dir, { recursive: true, force: true });
});

// -------------------------------------------------------------- foundation

test('loadTaxonomy: backfills the size axis into a pre-v0.5.0 project-local taxonomy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-test-'));
  const file = join(dir, 'old-taxonomy.json');
  const old = JSON.parse(JSON.stringify(taxonomy));
  delete old.size_scale;
  delete old.size_rubric;
  writeFileSync(file, JSON.stringify(old));
  const { taxonomy: loaded } = loadTaxonomy(file);
  assert.ok(loaded.size_scale, 'size_scale backfilled');
  assert.ok(loaded.size_rubric, 'size_rubric backfilled');
  assert.equal(loaded.size_axis_backfilled, true);
  // and it is usable end to end, not just present
  const s = scoreCase({ id: 'B1', text: 'submit the form', verdict: { id: 'B1', steps: 8, surfaces: 2, new_abstractions: 1 } }, loaded);
  assert.equal(s.size, 'M');
  rmSync(dir, { recursive: true, force: true });
});

test('loadFoundationCatalog: bundled catalog has the expected shape', () => {
  assert.ok(catalog.items.length >= 10);
  for (const item of catalog.items) {
    assert.ok(item.id && item.label && item.category, `incomplete item: ${item.id}`);
    assert.ok(taxonomy.size_scale.points[item.default_size] !== undefined,
      `${item.id} has default_size ${item.default_size}, not on the scale`);
    assert.ok(item.applies_when, `${item.id} has no applies_when gate`);
  }
});

test('resolveFoundation: totals only included items and keeps excluded ones on the record', () => {
  const r = resolveFoundation({
    items: [
      { id: 'app-profiling', reason: 'no profile', confidence: 'measured' },
      { id: 'ci-pipeline', reason: 'needs CI', confidence: 'estimated' },
      { id: 'kt-handover', include: false, reason: 'we keep the suite' },
    ],
  }, catalog, taxonomy);
  assert.equal(r.totalSp, 12); // M(4) + L(8)
  assert.equal(r.includedCount, 2);
  assert.equal(r.excludedCount, 1);
  assert.equal(r.rows.find((x) => x.id === 'kt-handover').included, false);
  assert.deepEqual(r.byConfidence, { measured: 4, estimated: 8 });
});

test('resolveFoundation: a superseding item drops what it absorbs instead of double-counting', () => {
  const r = resolveFoundation({
    items: [
      { id: 'framework-full-greenfield', reason: 'greenfield, one push' },
      { id: 'framework-core', reason: 'no framework' },
      { id: 'base-abstractions', reason: 'no convention' },
      { id: 'ci-pipeline', reason: 'needs CI' },
    ],
  }, catalog, taxonomy);
  assert.equal(r.totalSp, 16, 'only the XL greenfield item counts');
  assert.equal(r.includedCount, 1);
  assert.equal(r.rows.find((x) => x.id === 'ci-pipeline').superseded, 'framework-full-greenfield');
});

test('resolveFoundation: an explicit size overrides the catalog default and is marked', () => {
  const r = resolveFoundation({
    items: [{ id: 'reporting-integration', size: 'M', reason: 'portal + video + history' }],
  }, catalog, taxonomy);
  const row = r.rows[0];
  assert.equal(row.size, 'M');
  assert.equal(row.sp, 4);
  assert.equal(row.sizeOverridden, true);
  assert.equal(r.totalSp, 4);
});

test('resolveFoundation: unknown ids are reported, not silently dropped', () => {
  const r = resolveFoundation({ items: [{ id: 'no-such-item' }, { id: 'env-config' }] }, catalog, taxonomy);
  assert.deepEqual(r.unknownIds, ['no-such-item']);
  assert.equal(r.totalSp, 2);
});

test('resolveFoundation: an item defaults to assumption confidence when none is stated', () => {
  const r = resolveFoundation({ items: [{ id: 'env-config' }] }, catalog, taxonomy);
  assert.equal(r.rows[0].confidence, 'assumption');
});

test('rollupBySize: groups in scale order and totals SP', () => {
  const scored = [
    scoreCase({ id: 'A', text: 'x', verdict: { id: 'A', steps: 3, surfaces: 1, new_abstractions: 0 } }, taxonomy),
    scoreCase({ id: 'B', text: 'x', verdict: { id: 'B', steps: 3, surfaces: 1, new_abstractions: 0 } }, taxonomy),
    scoreCase({ id: 'C', text: 'x', verdict: { id: 'C', steps: 25, surfaces: 5, new_abstractions: 5 } }, taxonomy),
  ];
  const rollup = rollupBySize(scored);
  assert.deepEqual(rollup.map((r) => r.size), ['S', 'XL']);
  assert.equal(rollup[0].n, 2);
  assert.equal(rollup[0].sp, 4);
  assert.equal(rollup[1].sp, 16);
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
