#!/usr/bin/env node
// score-cases.mjs — Mode 1/2 scorer for the automation-scoping skill.
//
// estimated_active_minutes = base_minutes(step_count) x interaction_tier_multiplier x novelty_multiplier
// (or, once a tier has calibrated bucket_stats: mean_min +/- stdev directly)
//
// Reads a project-local .agents/estimation/complexity-taxonomy.json when it
// exists (a prior Mode 4 calibration); falls back to the bundled
// references/complexity-taxonomy.json default. STDLIB ONLY. See ../SKILL.md
// and ../references/{complexity-taxonomy,sampling-methodology}.md.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_TAXONOMY_PATH = join(__dirname, '..', 'references', 'complexity-taxonomy.json');
const PROJECT_TAXONOMY_PATH = join(process.cwd(), '.agents', 'estimation', 'complexity-taxonomy.json');
const BUNDLED_FOUNDATION_PATH = join(__dirname, '..', 'references', 'foundation-catalog.json');
const PROJECT_FOUNDATION_PATH = join(process.cwd(), '.agents', 'estimation', 'foundation-catalog.json');

// ---------------------------------------------------------------- taxonomy

export function loadTaxonomy(overridePath) {
  const path = overridePath
    || (existsSync(PROJECT_TAXONOMY_PATH) ? PROJECT_TAXONOMY_PATH : BUNDLED_TAXONOMY_PATH);
  const taxonomy = JSON.parse(readFileSync(path, 'utf8'));

  // A project-local taxonomy calibrated before v0.5.0 has no size axis. Those
  // keys are a fixed SCALE definition, not calibrated values, so backfilling
  // them from the bundled default is correct — unlike multipliers, there is
  // no project-specific posterior to preserve. Anything already present wins.
  if (path !== BUNDLED_TAXONOMY_PATH && (!taxonomy.size_scale || !taxonomy.size_rubric)) {
    const bundled = JSON.parse(readFileSync(BUNDLED_TAXONOMY_PATH, 'utf8'));
    taxonomy.size_scale ||= bundled.size_scale;
    taxonomy.size_rubric ||= bundled.size_rubric;
    taxonomy.size_axis_backfilled = true;
  }
  return { taxonomy, path };
}

export function loadFoundationCatalog(overridePath) {
  const path = overridePath
    || (existsSync(PROJECT_FOUNDATION_PATH) ? PROJECT_FOUNDATION_PATH : BUNDLED_FOUNDATION_PATH);
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  return { catalog, path };
}

// ---------------------------------------------------------- case ingestion

// Very small frontmatter reader — stdlib only, no YAML dependency. Handles
// the flat `key: value` shape every TMS-case/AFS template in this bundle
// uses; nested/list YAML in frontmatter is ignored (not needed for scoring).
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (!m) return fields;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

export function countSteps(text) {
  // Primary: markdown table rows "| 1 | Action | Expected |"
  const tableRows = (text.match(/^\|\s*\d+\s*\|/gm) || []).length;
  if (tableRows > 0) return { steps: tableRows, estimated: false };
  // Fallback: numbered list "1. Do X"
  const numbered = (text.match(/^\s*\d+\.\s+\S/gm) || []).length;
  if (numbered > 0) return { steps: numbered, estimated: false };
  // Last resort: rough word-count heuristic, flagged as estimated so callers
  // (and the report) can show reduced confidence.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { steps: Math.max(1, Math.round(words / 15)), estimated: true };
}

// A directory scan takes every .md it finds, which silently swept README.md
// and status docs into a real scope as "cases". `match` (a regex over the
// basename) is the filter; callers should pass one whenever the case dir
// holds anything but cases.
function findCaseFiles(inputPath, match) {
  const st = statSync(inputPath);
  if (st.isFile()) return [inputPath];
  const out = [];
  const skipped = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extname(entry.name) === '.md') {
        if (match && !match.test(entry.name)) skipped.push(entry.name);
        else out.push(full);
      }
    }
  };
  walk(inputPath);
  if (skipped.length) {
    console.error(`Filtered out ${skipped.length} .md file(s) not matching --match: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''}`);
  }
  return out.sort();
}

// Normalizes any supported input shape into { id, text, stepsHint } rows:
//  - a directory / .md file(s) of TMS case files (frontmatter + body)
//  - a .json file: array of strings, or array of {id, text|description}
export function loadCases(inputPath, match) {
  if (extname(inputPath) === '.json') {
    const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.cases || [];
    return arr.map((item, i) => {
      if (typeof item === 'string') return { id: `case-${i + 1}`, text: item, frontmatter: {} };
      const text = item.text || item.description || item.body || '';
      return { id: item.id || `case-${i + 1}`, text, frontmatter: item };
    });
  }
  return findCaseFiles(inputPath, match).map((file) => {
    const text = readFileSync(file, 'utf8');
    const frontmatter = parseFrontmatter(text);
    return { id: frontmatter.id || basename(file, '.md'), text, frontmatter, file };
  });
}

// ---------------------------------------------------------------- verdicts

// A verdict is what a sub-agent that actually READ the case returns (see
// SKILL.md § The verdict pass): { id, tier, steps, quality_flags, novelty?,
// signals? }. Verdict fields override the keyword/step-count heuristics —
// judged classification beats substring matching wherever both exist.
export function loadVerdicts(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.verdicts || raw.cases || [];
  const map = new Map();
  for (const v of rows) if (v && v.id) map.set(String(v.id), v);
  return map;
}

// ---------------------------------------------------------------- scoring

export function classifyTier(text, tiers) {
  const lower = text.toLowerCase();
  const sorted = [...tiers].sort((a, b) => a.priority - b.priority);
  for (const tier of sorted) {
    if (tier.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return tier;
  }
  return tiers.find((t) => t.id === 'crud-form') || sorted[sorted.length - 1];
}

export function baseMinutes(steps, buckets) {
  const sorted = [...buckets].sort((a, b) => a.max_steps - b.max_steps);
  for (const bucket of sorted) {
    if (steps <= bucket.max_steps) return bucket.base_min;
  }
  return sorted[sorted.length - 1].base_min;
}

export function classifyNovelty(text, knownSurfaceKeywords, taxonomy) {
  if (!knownSurfaceKeywords) {
    return { key: 'unknown_no_app_access', mult: taxonomy.novelty_multiplier.unknown_no_app_access };
  }
  const lower = text.toLowerCase();
  const covered = knownSurfaceKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  return covered
    ? { key: 'established_surface', mult: taxonomy.novelty_multiplier.established_surface }
    : { key: 'novel_surface_no_existing_coverage', mult: taxonomy.novelty_multiplier.novel_surface_no_existing_coverage };
}

// ------------------------------------------------------------------ sizing
// The SECOND currency: XS/S/M/L/XL -> Service Points (1 SP = 1 hour of
// conventional engineer effort). This is work-size, NOT agent time — see
// references/sizing-rubric.md. A reader's verdict.size always wins; the
// driver-score below is the fallback.

function pointsFor(value, table) {
  const sorted = [...table].sort((a, b) => a.max - b.max);
  for (const row of sorted) if (value <= row.max) return row.points;
  return sorted[sorted.length - 1].points;
}

export function deriveSize(taxonomy, { steps, tier, verdict } = {}) {
  const rubric = taxonomy.size_rubric;
  const scale = taxonomy.size_scale;
  if (!rubric || !scale) return null;

  const sizeOf = (size, basis, extra = {}) => ({
    size, sp: scale.points[size] ?? null, basis, ...extra,
  });

  // 1. An explicit reader verdict wins outright — including XS, which the
  //    driver score never produces for a case.
  if (verdict?.size && scale.points[verdict.size] !== undefined) {
    return sizeOf(verdict.size, 'verdict', { points: null, breakdown: {} });
  }

  // NOTE (v0.6.1): split_recommended no longer forces XL. "Too big to
  // estimate" is not "big" — measured, split-flagged cases came in at 0.46x
  // their estimate vs 0.79x unflagged, so forcing the top of the scale made an
  // already-high number twice as wrong. It marks the row unquotable instead;
  // the size derives from the drivers like any other case.
  const drivers = rubric.drivers;
  const surfaces = Number.isFinite(verdict?.surfaces) ? verdict.surfaces : null;
  const newAbstractions = Number.isFinite(verdict?.new_abstractions) ? verdict.new_abstractions : null;

  const breakdown = {
    steps: pointsFor(steps, drivers.steps),
    surfaces: surfaces === null ? 0 : pointsFor(surfaces, drivers.surfaces),
    new_abstractions: newAbstractions === null ? 0 : pointsFor(newAbstractions, drivers.new_abstractions),
    expensive_tier: (tier?.multiplier ?? 0) >= rubric.expensive_tier_bonus.min_multiplier
      ? rubric.expensive_tier_bonus.points : 0,
  };
  const points = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const row = [...rubric.size_by_total_points].sort((a, b) => a.max_points - b.max_points)
    .find((r) => points <= r.max_points);
  // Missing surfaces/new_abstractions score 0, which systematically UNDER-sizes
  // — callers must surface 'derived-partial' rather than quoting it silently.
  const complete = surfaces !== null && newAbstractions !== null;
  return sizeOf(row.size, complete ? 'derived' : 'derived-partial', { points, breakdown });
}

// -------------------------------------------------------------- foundation
// One-time, non-per-case work, gated on what the target project already has
// (SKILL.md § Mode 3 is what answers that). Selection format:
//   { blended_rate_usd_per_hour?: 45,
//     items: [{ id, size?, include?, reason?, confidence? }] }

export function resolveFoundation(selection, catalog, taxonomy) {
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const scale = taxonomy.size_scale;
  const rows = [];
  const unknown = [];

  for (const sel of selection.items || []) {
    const item = byId.get(sel.id);
    if (!item) { unknown.push(sel.id); continue; }
    const size = sel.size || item.default_size;
    // Agent cost by ACTIVITY TYPE, not one blended rate — exploring a live app
    // costs ~9x what generating scaffolding does per SP (foundation-catalog.json
    // § agent_cost_per_sp).
    const acps = catalog.agent_cost_per_sp;
    const catRate = acps?.by_category?.[item.cost_category]?.usd_per_sp;
    const rate = catRate ?? acps?.blended_usd_per_sp ?? null;
    const sp = scale.points[size] ?? null;
    rows.push({
      id: item.id,
      label: item.label,
      category: item.category,
      costCategory: item.cost_category || null,
      agentRate: rate,
      agentRateIsBlended: catRate === undefined && rate !== null,
      agentCost: rate !== null && sp !== null ? round2(sp * rate) : null,
      size,
      sp,
      included: sel.include !== false,
      sizeOverridden: Boolean(sel.size) && sel.size !== item.default_size,
      reason: sel.reason || '',
      confidence: sel.confidence || 'assumption',
      supersedes: item.supersedes || [],
    });
  }

  // An included item's `supersedes` list drops the items it absorbs, so a
  // selection can't double-count a framework build. Recorded, never silent.
  const supersededBy = new Map();
  for (const r of rows.filter((x) => x.included)) {
    for (const id of r.supersedes) if (!supersededBy.has(id)) supersededBy.set(id, r.id);
  }
  for (const r of rows) {
    if (r.included && supersededBy.has(r.id)) {
      r.included = false;
      r.superseded = supersededBy.get(r.id);
    }
  }

  const included = rows.filter((r) => r.included);
  const band = catalog.agent_cost_per_sp?.band;
  const totalAgentCost = included.reduce((a, r) => a + (r.agentCost || 0), 0);
  return {
    rows,
    unknownIds: unknown,
    totalSp: included.reduce((a, r) => a + (r.sp || 0), 0),
    totalAgentCost: round2(totalAgentCost),
    agentCostLow: band ? round2(totalAgentCost * band.low_mult) : null,
    agentCostHigh: band ? round2(totalAgentCost * band.high_mult) : null,
    agentCostByCategory: included.reduce((acc, r) => {
      if (!r.costCategory) return acc;
      acc[r.costCategory] = round2((acc[r.costCategory] || 0) + (r.agentCost || 0));
      return acc;
    }, {}),
    includedCount: included.length,
    excludedCount: rows.length - included.length,
    byConfidence: included.reduce((acc, r) => {
      acc[r.confidence] = (acc[r.confidence] || 0) + (r.sp || 0);
      return acc;
    }, {}),
  };
}

export function rollupBySize(scored) {
  const order = ['XS', 'S', 'M', 'L', 'XL'];
  const bySize = {};
  for (const s of scored) if (s.size) (bySize[s.size] ||= []).push(s);
  return order.filter((k) => bySize[k]).map((size) => ({
    size,
    n: bySize[size].length,
    sp: bySize[size].reduce((a, r) => a + (r.sp || 0), 0),
    avgCost: round2(bySize[size].reduce((a, r) => a + r.estCost, 0) / bySize[size].length),
  }));
}

function confidenceBand(taxonomy, { hasBucketStats, sampleSize, n }) {
  if (hasBucketStats) {
    return n >= 5 ? taxonomy.confidence_bands.bucket_n_ge_5 : taxonomy.confidence_bands.bucket_n_lt_5;
  }
  if (sampleSize !== undefined && sampleSize < 10) {
    // Sampling error stacks on top of scoring error — never narrower than cold.
    return { ...taxonomy.confidence_bands.cold_no_history, label: 'ROM — thin sample, extrapolated' };
  }
  return taxonomy.confidence_bands.cold_no_history;
}

export function scoreCase(caseRow, taxonomy, opts = {}) {
  const verdict = caseRow.verdict;

  // Steps: a reader's judged count (real actions, split compound rows) beats
  // the table-row/word-count heuristic.
  let { steps, estimated } = countSteps(caseRow.text);
  if (Number.isFinite(verdict?.steps) && verdict.steps >= 1) {
    steps = verdict.steps;
    estimated = false;
  }

  // Tier: a verdict naming a valid taxonomy tier wins over the keyword scan.
  let tier;
  let classification = 'keyword';
  if (verdict?.tier) {
    tier = taxonomy.interaction_tiers.find((t) => t.id === verdict.tier);
    if (tier) classification = 'verdict';
  }
  if (!tier) tier = classifyTier(caseRow.text, taxonomy.interaction_tiers);

  // Novelty: an explicit verdict key (a Mode 3 finding folded per case) wins
  // over the known-surfaces keyword check.
  let novelty;
  if (verdict?.novelty && taxonomy.novelty_multiplier[verdict.novelty] !== undefined) {
    novelty = { key: verdict.novelty, mult: taxonomy.novelty_multiplier[verdict.novelty] };
  } else {
    novelty = classifyNovelty(caseRow.text, opts.knownSurfaceKeywords, taxonomy);
  }

  const qualityFlags = Array.isArray(verdict?.quality_flags) ? verdict.quality_flags : [];
  // Risk flags: band-wideners, never multipliers (complexity-taxonomy.json
  // § risk_flags). A reader's own low confidence and its split advice are
  // promoted to risk flags — in v0.5.0 both rode along as decoration, and on
  // the blind holdout both priciest cases carried them.
  const riskFlags = Array.isArray(verdict?.risk_flags) ? [...verdict.risk_flags] : [];
  if (verdict?.confidence === 'low' && !riskFlags.includes('low-confidence-verdict')) {
    riskFlags.push('low-confidence-verdict');
  }
  if (verdict?.split_recommended === true && !riskFlags.includes('split-recommended')) {
    riskFlags.push('split-recommended');
  }
  const rate = opts.rate ?? taxonomy.default_dollar_per_minute.value;

  const bucketStats = taxonomy.bucket_stats?.[tier.id];
  let estMin, low, high, confidence;
  if (bucketStats && bucketStats.n >= 2) {
    estMin = bucketStats.mean_min;
    const band = confidenceBand(taxonomy, { hasBucketStats: true, n: bucketStats.n });
    low = Math.max(0, bucketStats.mean_min - (bucketStats.stdev_min ?? bucketStats.mean_min * 0.3));
    high = bucketStats.mean_min + (bucketStats.stdev_min ?? bucketStats.mean_min * 0.3);
    confidence = band.label;
  } else {
    const base = baseMinutes(steps, taxonomy.base_minutes_by_step_bucket);
    estMin = base * tier.multiplier * novelty.mult;
    const band = confidenceBand(taxonomy, { hasBucketStats: false, sampleSize: opts.sampleOf ? opts.n : undefined });
    low = estMin * band.low_mult;
    high = estMin * band.high_mult;
    confidence = band.label;
  }

  // Quality flags measure uncertainty about the CASE itself; risk flags measure
  // uncertainty about whether the case is checkable at all. Neither moves the
  // point estimate (no measured premium yet — complexity-taxonomy.json
  // § risk_flags "not_a_multiplier_because") but both force the widest band,
  // calibrated or not.
  // The band is the UNION of every applicable band. Most flags say "uncertain
  // in both directions" (the symmetric cold band). Two groups say something
  // measurable about DIRECTION and contribute asymmetric bands instead:
  //   skewed_high — low-confidence / unspecified-oracle / external-dependency
  //                 cases overrun (median 1.59x actual/est vs 0.73x otherwise)
  //   skewed_low  — split candidates come in UNDER (median 0.46x): splitting a
  //                 bundled case yields several small ones, so the pre-split
  //                 number over-states it
  // None of this moves the point estimate. Every case stays in the total —
  // excluding a flagged case would under-quote real work, which is the more
  // dangerous error (complexity-taxonomy.json § confidence_bands.skewed_low).
  const CB = taxonomy.confidence_bands;
  const inGroup = (band) => Array.isArray(band?.applies_to)
    && riskFlags.some((f) => band.applies_to.includes(f));
  const bands = [];
  let skewLabel = null;
  if (inGroup(CB.skewed_high)) { bands.push(CB.skewed_high); skewLabel = CB.skewed_high.label; }
  if (inGroup(CB.skewed_low)) { bands.push(CB.skewed_low); skewLabel ??= CB.skewed_low.label; }
  // Anything flagged but without a measured direction keeps the symmetric band.
  const undirected = qualityFlags.length > 0
    || riskFlags.some((f) => !inGroup(CB.skewed_high) && !inGroup(CB.skewed_low));
  if (undirected || bands.length === 0) {
    if (qualityFlags.length > 0 || riskFlags.length > 0) bands.push(CB.cold_no_history);
  }
  if (bands.length > 0) {
    // REPLACE rather than widen. A directional band has to be able to pull the
    // far end IN — union-with-max can only ever widen, which would erase a
    // downward skew entirely (the split-candidate case).
    low = estMin * Math.min(...bands.map((b) => b.low_mult));
    high = estMin * Math.max(...bands.map((b) => b.high_mult));
    const why = [qualityFlags.length ? 'quality-flagged' : null,
      riskFlags.length ? 'risk-flagged' : null].filter(Boolean).join(' + ');
    confidence = `${skewLabel ?? CB.cold_no_history.label} — ${why}`;
  }

  // Flagged for splitting: the number stays in the total and is refined by
  // splitting, not withheld.
  const refineBySplitting = verdict?.split_recommended === true;

  // Work-size axis — independent of the agent-cost arithmetic above and
  // never reconciled into it (references/sizing-rubric.md § Size does not
  // finely predict agent cost).
  const sized = deriveSize(taxonomy, { steps, tier, verdict });
  const blendedRate = opts.blendedRate;

  return {
    id: caseRow.id,
    tier: tier.id,
    tierLabel: tier.label,
    classification,
    steps,
    stepsEstimated: estimated,
    novelty: novelty.key,
    qualityFlags,
    riskFlags,
    size: sized?.size ?? null,
    sp: sized?.sp ?? null,
    sizeBasis: sized?.basis ?? null,
    sizePoints: sized?.points ?? null,
    sizeBreakdown: sized?.breakdown ?? null,
    spCost: sized && Number.isFinite(blendedRate) ? round2(sized.sp * blendedRate) : null,
    // Second complexity axis (setup/data/teardown/assertions — see
    // complexity-taxonomy.md § Modifiers) + split advice: observational,
    // never priced — carried through to the report and training rows.
    modifiers: Array.isArray(verdict?.modifiers) ? verdict.modifiers : [],
    splitRecommended: verdict?.split_recommended === true,
    refineBySplitting,
    signals: Array.isArray(verdict?.signals) ? verdict.signals : [],
    estMin: round1(estMin),
    lowMin: round1(low),
    highMin: round1(high),
    estCost: round2(estMin * rate),
    lowCost: round2(low * rate),
    highCost: round2(high * rate),
    confidence,
    rate,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// -------------------------------------------------------------- rollup/CLI

export function rollupByTier(scored) {
  const byTier = {};
  for (const s of scored) {
    (byTier[s.tier] ||= []).push(s);
  }
  return Object.entries(byTier).map(([tier, rows]) => ({
    tier,
    n: rows.length,
    avgMin: round1(rows.reduce((a, r) => a + r.estMin, 0) / rows.length),
    avgCost: round2(rows.reduce((a, r) => a + r.estCost, 0) / rows.length),
  }));
}

function renderSizesOnly(scored) {
  const sizeRollup = rollupBySize(scored);
  const totalSp = scored.reduce((a, r) => a + (r.sp || 0), 0);
  const partial = scored.filter((r) => r.sizeBasis === 'derived-partial').length;
  return `# Case sizing (${new Date().toISOString().slice(0, 10)})

**${scored.length} cases → ${totalSp} SP** (${sizeRollup.map((s) => `${s.size}:${s.n}`).join('  ')})

| Case | Size | SP | Points | Steps | Surfaces | New abstractions | Tier | Basis |
|---|---|---|---|---|---|---|---|---|
${scored.map((r) => {
    const b = r.sizeBreakdown || {};
    return `| ${r.id} | **${r.size}** | ${r.sp} | ${r.sizePoints ?? '—'} | ${b.steps ?? '—'} | ${b.surfaces ?? '—'} | ${b.new_abstractions ?? '—'} | ${b.expensive_tier ?? '—'} | ${r.sizeBasis} |`;
  }).join('\n')}

Point columns are the rubric's driver scores, not raw counts — see
references/sizing-rubric.md § Per-case sizing.
${partial ? `\n**${partial} of ${scored.length} sizes are \`derived-partial\`** — the verdicts omitted \`surfaces\` and/or \`new_abstractions\`, which score 0 and systematically UNDER-size. Don't quote those lines without saying so.\n` : ''}`;
}

function renderMarkdown(scored, { sampleOf, taxonomyPath, foundation, foundationPath, blendedRate, taxonomy = {} } = {}) {
  const totalLow = scored.reduce((a, r) => a + r.lowCost, 0);
  const totalHigh = scored.reduce((a, r) => a + r.highCost, 0);
  const totalMin = scored.reduce((a, r) => a + r.estMin, 0);
  const tierRollup = rollupByTier(scored);
  const sizeRollup = rollupBySize(scored);
  const caseSp = scored.reduce((a, r) => a + (r.sp || 0), 0);
  const partialSizes = scored.filter((r) => r.sizeBasis === 'derived-partial').length;
  const money = (sp) => (Number.isFinite(blendedRate) ? ` | $${round2(sp * blendedRate)}` : '');
  const moneyHead = Number.isFinite(blendedRate) ? ' | Conventional $' : '';

  const sizeSection = sizeRollup.length ? `
## Work size (Service Points — 1 SP = 1 hour of conventional engineer effort)

| Size | Cases | SP${moneyHead} | Avg agent $/case |
|---|---|---|${moneyHead ? '---|' : ''}---|
${sizeRollup.map((s) => `| ${s.size} | ${s.n} | ${s.sp}${money(s.sp)} | $${s.avgCost} |`).join('\n')}
| **Cases total** | **${scored.length}** | **${caseSp}**${money(caseSp)} | |

SP is work-size, NOT agent time — the two currencies diverge by design and
are never reconciled (references/sizing-rubric.md § Why a second currency).
${partialSizes ? `\n**${partialSizes} size(s) are \`derived-partial\`** (verdicts omitted \`surfaces\`/\`new_abstractions\`, which score 0 and under-size). Say so before quoting.\n` : ''}` : '';

  let foundationSection = '';
  let suiteSection = '';
  if (foundation) {
    const inc = foundation.rows.filter((r) => r.included);
    const exc = foundation.rows.filter((r) => !r.included);
    const totalSp = caseSp + foundation.totalSp;
    const sharePct = totalSp > 0 ? Math.round((foundation.totalSp / totalSp) * 100) : 0;
    const band = { low: 20, high: 26 };
    const inBand = sharePct >= band.low && sharePct <= band.high;

    foundationSection = `
## Foundation (one-time work, gated on what the project already has)

Catalog: ${foundationPath}

| Item | Category | Size | SP${moneyHead} | Agent $ | Confidence | Why |
|---|---|---|---|${moneyHead ? '---|' : ''}---|---|---|
${inc.map((r) => `| ${r.label}${r.sizeOverridden ? ' *(size overridden)*' : ''} | ${r.category} | ${r.size} | ${r.sp}${money(r.sp)} | ${r.agentCost !== null ? `$${r.agentCost}${r.agentRateIsBlended ? '†' : ''}` : '—'} | ${r.confidence} | ${r.reason || '—'} |`).join('\n')}
| **Foundation total** | | | **${foundation.totalSp}**${money(foundation.totalSp)} | **$${foundation.totalAgentCost}** | | |

Agent cost is priced **by activity type**, not one blended rate — exploring a
live app runs ~$4.03/SP while generating scaffolding runs ~$0.43/SP, a ~9×
spread (foundation-catalog.json § agent_cost_per_sp). This scope splits:
${Object.entries(foundation.agentCostByCategory).map(([k, v]) => `${k} $${v}`).join(' · ') || '—'}.
**Range $${foundation.agentCostLow}–$${foundation.agentCostHigh}** — deliberately wide and **skewed high**. The source
tracker's labelled foundation rows are a *floor*, not a measurement: 16.8% of
its total token spend sat in an unattributable orchestration bucket, its
framework-bootstrap row is logged at $2.65 against its own "~1h AI" note
(≈$16 at that project's rate), and framework fixing done inside a
test-development session is charged to the case, never to foundation. These
rates already carry a conservative 1.73× attribution uplift and are still
likely low. Order-of-magnitude, not a quote.

**And token cost is the smaller half.** On the source engagement, foundation
took 24.5% of *total* cost against 25.8% of SP — proportional, not cheap — because
it is human-heavy: 0.222 supervision-hours/SP against test development's 0.167.
Human time on foundation cost ~16× its tokens. A foundation line that looks
trivially cheap in agent-$ is not cheap; it is half-counted.
${inc.some((r) => r.agentRateIsBlended) ? '\n† priced at the blended $0.64/SP because the item has no cost category.\n' : ''}

${exc.length ? `**Considered and excluded** — what was checked and ruled out:

${exc.map((r) => `- \`${r.id}\` (${r.size}, ${r.sp} SP) — ${r.superseded ? `superseded by \`${r.superseded}\`, dropped to avoid double-counting` : r.reason || 'excluded, no reason given'}`).join('\n')}
` : '_No items were explicitly excluded — a selection that never says what it ruled out reads as optimistic. Consider recording the items you checked and skipped._\n'}
**Confidence of the foundation set**: ${Object.entries(foundation.byConfidence).map(([k, v]) => `${v} SP ${k}`).join(', ') || 'none'}. A set built mostly of \`assumption\` is a different artifact from one built on a repo inspection — Mode 3 is what turns assumptions into \`measured\`.

**Foundation share**: ${foundation.totalSp} of ${totalSp} SP = **${sharePct}%** of the engagement. ${
      inBand
        ? `Inside the 20–26% sanity band observed on two comparable engagements.`
        : sharePct > band.high
          ? `**Above the 20–26% band** observed on two comparable engagements. Usual causes: items included that the project already has, or a scope too small to carry a full framework build. Do NOT force it into the band — on a small scope a high share is the real finding, and it is the argument for widening scope or reusing an existing framework (foundation-catalog.json § foundation_share_sanity_band).`
          : `**Below the 20–26% band** observed on two comparable engagements. That is usually correct and good news: it means the project already has framework, CI or abstractions in place, so those items were gated out. Confirm the excluded list reflects real verified coverage rather than items nobody checked — a low share built on assumptions is the one way this reads well and estimates badly.`
    }
${foundation.unknownIds.length ? `\n**Unknown item id(s) in the selection, ignored**: ${foundation.unknownIds.map((i) => `\`${i}\``).join(', ')} — check them against the catalog.\n` : ''}`;

    const allIn = Number.isFinite(blendedRate) ? (totalSp * blendedRate) / scored.length : null;
    const casesOnly = Number.isFinite(blendedRate) ? (caseSp * blendedRate) / scored.length : null;
    suiteSection = `
## Suite total — both currencies

| | SP${moneyHead} | Agent $ (point est.) |
|---|---|${moneyHead ? '---|' : ''}---|
| Cases (${scored.length}) | ${caseSp}${money(caseSp)} | $${round2(scored.reduce((a, r) => a + r.estCost, 0))} |
| Foundation | ${foundation.totalSp}${money(foundation.totalSp)} | _not priced per-case; see note_ |
| **Total** | **${totalSp}**${money(totalSp)} | |

Foundation's agent cost is deliberately not derived here: measured on the
source engagement it ran ~$0.64/SP against ~$3.07/SP for case work (~4.8×
cheaper, n=7, one project). Pricing it with the per-case rate would overstate
it several-fold. Meter it from the project's own efficiency-audit once it
runs, or state it as unpriced.
${allIn !== null ? `
**Amortization**: all-in ${'$'}${round2(allIn)}/case at this scope of ${scored.length} cases, versus ${'$'}${round2(casesOnly)}/case for case work alone — foundation adds ${'$'}${round2(allIn - casesOnly)}/case here and shrinks as the scope grows. Quote the scope count next to this number; a pilot's all-in per-case figure is not comparable to a programme's (references/sizing-rubric.md § Amortization).
` : '\n**Amortization**: pass `--blended-rate <usd-per-hour>` to get all-in $/case at this scope.\n'}`;
  }

  let extrapolation = '';
  if (sampleOf) {
    const avgCost = scored.reduce((a, r) => a + r.estCost, 0) / scored.length;
    const avgMin = scored.reduce((a, r) => a + r.estMin, 0) / scored.length;
    const mult = round1(sampleOf / scored.length);
    extrapolation = `\n**Extrapolated from a sample of ${scored.length} of ~${sampleOf} cases (${mult}x multiplier).**\n` +
      (mult > 10 ? `**>10x EXTRAPOLATION — treat as indicative only, not quotable ` +
        `(sampling-methodology.md § never extrapolate past 10x without flagging it).**\n` : '') +
      `Sample-average → full-scope estimate: ${round1(avgMin * sampleOf)} active-min, ` +
      `$${round2(avgCost * sampleOf)}. Sample tier distribution: ` +
      tierRollup.map((t) => `${t.tier} ${Math.round((t.n / scored.length) * 100)}%`).join(', ') + '.\n' +
      `TODO (agent): state how this sample was selected and whether the tier ` +
      `distribution above looks plausible for the full stated scope — see ` +
      `references/sampling-methodology.md.\n`;
  }

  const riskN = scored.filter((r) => r.riskFlags.length > 0).length;
  const fl = taxonomy.fully_loaded_multiplier;
  const pointBuild = scored.reduce((a, r) => a + r.estCost, 0);
  const CBr = taxonomy.confidence_bands || {};
  const inG = (band, r) => Array.isArray(band?.applies_to)
    && r.riskFlags.some((f) => band.applies_to.includes(f));
  const upRows = scored.filter((r) => inG(CBr.skewed_high, r));
  const downRows = scored.filter((r) => inG(CBr.skewed_low, r) && !inG(CBr.skewed_high, r));
  const sum = (rows) => rows.reduce((a, r) => a + r.estCost, 0);
  const riskBlock = (upRows.length || downRows.length) ? `
### Where the total is most likely to move

**Every case is in the total.** Nothing is withheld — a flagged case is real
work, and dropping it would under-quote the engagement, which is the more
dangerous error. What the flags do is say *which way* each line is likely to move.

| Direction | Cases | $ of build total | Why |
|---|---|---|---|
${upRows.length ? `| **Likely to overrun** ↑ | ${upRows.length} | $${round2(sum(upRows))} (${Math.round(sum(upRows) / pointBuild * 100)}%) | unspecified oracle, external dependency, or the reader's own low confidence — measured median 1.59× estimate |\n` : ''}${downRows.length ? `| **Likely to come down** ↓ | ${downRows.length} | $${round2(sum(downRows))} (${Math.round(sum(downRows) / pointBuild * 100)}%) | flagged for splitting — a bundled case splits into several small ones, measured median 0.46× estimate |\n` : ''}
${upRows.length ? `↑ ${upRows.map((r) => `\`${r.id}\``).join(', ')}\n` : ''}${downRows.length ? `↓ ${downRows.map((r) => `\`${r.id}\``).join(', ')} — split these and re-score to tighten the number *downward*.\n` : ''}
` : '';
  const layerBlock = fl ? `
## Cost layer — read this before quoting any dollar figure

| Layer | Estimate |
|---|---|
| **Per-case build** (implement + review on the case's own branch) — what \`base × tier × novelty\` models | **$${round2(pointBuild)}** ($${round2(totalLow)}–$${round2(totalHigh)}) |
| **Fully loaded** (+ batch trunk: gate/merge/closure; + orchestrator share) — ×${fl.value} | **$${round2(pointBuild * fl.value)}** ($${round2(totalLow * fl.value)}–$${round2(totalHigh * fl.value)}) |

Layer split measured at ${fl.layers.case_branch_pct}% case-branch / ${fl.layers.batch_trunk_pct}% batch-trunk / ${fl.layers.orchestrator_pct}% orchestrator (${fl.source}). The
fully-loaded row assumes **batched** delivery; single-case operation pushes the
orchestrator layer far higher (complexity-taxonomy.json § batch_shape).

**Quote the batch total, not per-case dollars.** On a 26-case blind holdout the
per-case figures had ~zero rank correlation with actual per-case cost
(Spearman 0.015) while batch totals landed within 0.89–1.83× of actuals. Per-case
output below is for **sizing and sequencing**; the money is only meaningful in
aggregate.
${riskBlock}` : '';

  // The rate scales every dollar in the report and varies 2.7x across measured
  // projects — a wrong rate is the largest single error source in the model.
  const usingDefaultRate = scored.length > 0
    && scored[0].rate === taxonomy.default_dollar_per_minute?.value;
  const rateWarning = usingDefaultRate ? `
> ⚠️ **Priced at the bundled cross-project fallback rate of $${taxonomy.default_dollar_per_minute.value}/active-min — not this
> project's own.** Measured $/active-min varies **2.7×** across projects
> ($0.097–$0.266), because cost tracks context size × turn count and every repo
> injects a different amount of seed context per dispatch. On a 15-case holdout,
> swapping the default for the project's own measured rate moved the result from
> 2.01× actual to 0.79×. **Run \`efficiency-audit\` on the target project and pass
> \`--rate\`**, or quote active-minutes rather than dollars
> (complexity-taxonomy.json § project_rate).
` : '';

  const verdictN = scored.filter((r) => r.classification === 'verdict').length;
  const flaggedN = scored.filter((r) => r.qualityFlags.length > 0).length;
  const modifiedN = scored.filter((r) => r.modifiers.length > 0).length;
  const splitN = scored.filter((r) => r.splitRecommended).length;
  const provenance = `Classification: ${verdictN} verdict-read / ${scored.length - verdictN} keyword-fallback` +
    (flaggedN ? `; ${flaggedN} case(s) quality-flagged (widest band applied)` : '') +
    (riskN ? `; **${riskN} case(s) risk-flagged** (nondeterministic oracle / external dependency / low-confidence verdict — widest band)` : '') +
    (modifiedN ? `; ${modifiedN} case(s) carry unpriced setup/data/teardown modifiers` : '') +
    (splitN ? `; ${splitN} split candidate(s) — estimate unreliable until split` : '') + '.' +
    (verdictN === 0 ? ' **Keyword-only — a triage, not a proposal number; run the verdict pass (SKILL.md) before quoting.**' : '');

  const clusteringBlock = taxonomy.clustering ? `
## Scope assumption — delivery clustering

${taxonomy.clustering.report_requirement}

Measured: ${taxonomy.clustering.measured_effect} Clustering is a delivery-time
decision made *after* this estimate exists, so these per-case numbers cannot
account for it — state the assumed shape rather than letting the reader infer one.
` : '';

  return `# Automation scoping — scored output (${new Date().toISOString().slice(0, 10)})

## Headline

**${scored.length} cases → ${round1(totalMin)} active-min, $${round2(totalLow)}–$${round2(totalHigh)} agent cost**
(point estimate $${round2(scored.reduce((a, r) => a + r.estCost, 0))}, taxonomy: ${taxonomyPath})
**Work size: ${caseSp} SP for the cases${foundation ? ` + ${foundation.totalSp} SP foundation = ${caseSp + foundation.totalSp} SP total` : ''}**${Number.isFinite(blendedRate) ? ` (≈$${round2((caseSp + (foundation?.totalSp || 0)) * blendedRate)} conventional at $${blendedRate}/hr)` : ' (pass --blended-rate for the conventional-cost comparison)'}

${rateWarning}
${provenance}
${extrapolation}
TODO (agent): write the Methodology paragraph and Assumptions & Risks section
per references/scoping-report-format.md — this script only computes the
numbers, not the narrative (novelty resolution, sample representativeness,
foundation gating, rework tail-risk framing all need judgment this script
doesn't have).

## Breakdown by tier

| Interaction tier | Cases | Avg est. min/case | Avg est. $/case |
|---|---|---|---|
${tierRollup.map((t) => `| ${t.tier} | ${t.n} | ${t.avgMin} | $${t.avgCost} |`).join('\n')}
${layerBlock}${sizeSection}${foundationSection}${suiteSection}${clusteringBlock}
## Per-case table

| Case | Size | SP | Tier | Steps | Surf | Novelty | Risk / quality flags | Est. min | Est. $ | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
${scored.map((r) => `| ${r.id}${r.splitRecommended ? ' ⚠split' : ''} | ${r.size || '—'}${r.sizeBasis === 'derived-partial' ? '‡' : ''} | ${r.sp ?? '—'} | ${r.tier}${r.classification === 'keyword' ? '†' : ''} | ${r.steps}${r.stepsEstimated ? '*' : ''} | ${r.sizeBreakdown?.surfaces ?? '—'} | ${r.novelty} | ${[...r.riskFlags.map((f) => `**${f}**`), ...r.qualityFlags, ...r.modifiers].join(', ') || '—'} | ${r.estMin} | $${r.estCost} | ${r.confidence} |`).join('\n')}
${scored.some((r) => r.classification === 'keyword') ? '\n† tier from keyword fallback, not a reader\'s verdict.\n' : ''}${partialSizes ? '\n‡ size derived without `surfaces`/`new_abstractions` — under-sized, see above.\n' : ''}

${scored.some((r) => r.stepsEstimated) ? '\n\\* step count estimated from prose length, not a real steps table.\n' : ''}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node score-cases.mjs <cases.json|case-file.md|cases-dir> [options]
  --taxonomy <path>          override taxonomy JSON (default: project-local, else bundled)
  --rate <usd-per-min>       override default_dollar_per_minute
  --sample-of <N>            treat input as a sample representing N total cases
  --known-surfaces <path>    JSON array or newline-separated file of covered-surface keywords (Mode 3)
  --verdicts <path>          per-case reader verdicts JSON (SKILL.md § The verdict pass) —
                             judged tier/steps/novelty/quality_flags override the keyword heuristics
  --foundation <path>        foundation selection JSON: { blended_rate_usd_per_hour?, items: [
                             { id, size?, include?, reason?, confidence? } ] } — adds the
                             one-time framework/CI/data-layer work to the estimate
  --foundation-catalog <p>   override the foundation catalog (default: project-local, else bundled)
  --blended-rate <usd/hr>    engagement rate for SP -> conventional cost (no default by design)
  --match <regex>            when the input is a directory, only .md files whose BASENAME matches
                             count as cases (e.g. '^(TC|ELITEA)-' ) — without it a bare scan will
                             happily score README.md as a test case
  --sizes-only               emit just the S/M/L/XL sizing table (quick triage, no costing)
  --json                     emit raw JSON instead of the markdown report
  --out <path>               write output to a file instead of stdout`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const inputPath = resolve(args[0]);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const taxonomyOverride = flag('--taxonomy');
  const rate = flag('--rate') ? Number(flag('--rate')) : undefined;
  const sampleOf = flag('--sample-of') ? Number(flag('--sample-of')) : undefined;
  const knownSurfacesPath = flag('--known-surfaces');
  const outPath = flag('--out');
  const asJson = args.includes('--json');
  const sizesOnly = args.includes('--sizes-only');
  const foundationPath = flag('--foundation');
  const foundationCatalogOverride = flag('--foundation-catalog');
  let blendedRate = flag('--blended-rate') ? Number(flag('--blended-rate')) : undefined;

  const { taxonomy, path: taxonomyPath } = loadTaxonomy(taxonomyOverride);
  let knownSurfaceKeywords;
  if (knownSurfacesPath) {
    const raw = readFileSync(knownSurfacesPath, 'utf8');
    knownSurfaceKeywords = knownSurfacesPath.endsWith('.json')
      ? JSON.parse(raw)
      : raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  const matchArg = flag('--match');
  const cases = loadCases(inputPath, matchArg ? new RegExp(matchArg) : undefined);
  if (cases.length === 0) {
    console.error(`No cases found at ${inputPath}`);
    process.exit(1);
  }

  const verdictsPath = flag('--verdicts');
  if (verdictsPath) {
    const verdicts = loadVerdicts(verdictsPath);
    let matched = 0;
    for (const c of cases) {
      const v = verdicts.get(String(c.id));
      if (v) { c.verdict = v; matched += 1; }
    }
    const orphans = verdicts.size - matched;
    console.error(`Verdicts: ${matched}/${cases.length} cases matched` +
      (orphans > 0 ? `; ${orphans} verdict id(s) matched no loaded case — check the id join` : ''));
  }

  // Foundation selection can carry the blended rate so one file holds the
  // whole engagement's commercial assumptions; an explicit flag still wins.
  let foundation;
  let foundationCatalogPath;
  if (foundationPath) {
    const selection = JSON.parse(readFileSync(foundationPath, 'utf8'));
    const { catalog, path } = loadFoundationCatalog(foundationCatalogOverride);
    foundationCatalogPath = path;
    foundation = resolveFoundation(selection, catalog, taxonomy);
    if (blendedRate === undefined && Number.isFinite(selection.blended_rate_usd_per_hour)) {
      blendedRate = selection.blended_rate_usd_per_hour;
    }
    console.error(`Foundation: ${foundation.includedCount} item(s) included (${foundation.totalSp} SP), ` +
      `${foundation.excludedCount} excluded` +
      (foundation.unknownIds.length ? `; unknown id(s) ignored: ${foundation.unknownIds.join(', ')}` : ''));
  }

  const scored = cases.map((c) => scoreCase(c, taxonomy, {
    rate, knownSurfaceKeywords, sampleOf, n: cases.length, blendedRate,
  }));

  const output = asJson
    ? JSON.stringify({
      taxonomyPath, sampleOf, blendedRate, cases: scored,
      byTier: rollupByTier(scored), bySize: rollupBySize(scored),
      caseSp: scored.reduce((a, r) => a + (r.sp || 0), 0),
      foundation: foundation ? { catalogPath: foundationCatalogPath, ...foundation } : null,
    }, null, 2)
    : sizesOnly
      ? renderSizesOnly(scored)
      : renderMarkdown(scored, {
        sampleOf, taxonomyPath, foundation, foundationPath: foundationCatalogPath, blendedRate, taxonomy,
      });

  if (outPath) {
    writeFileSync(outPath, output);
    console.log(`Wrote ${outPath} (${scored.length} cases scored, taxonomy: ${taxonomyPath})`);
  } else {
    console.log(output);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
