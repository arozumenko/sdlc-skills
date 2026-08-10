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

// ---------------------------------------------------------------- taxonomy

export function loadTaxonomy(overridePath) {
  const path = overridePath
    || (existsSync(PROJECT_TAXONOMY_PATH) ? PROJECT_TAXONOMY_PATH : BUNDLED_TAXONOMY_PATH);
  const taxonomy = JSON.parse(readFileSync(path, 'utf8'));
  return { taxonomy, path };
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

function findCaseFiles(inputPath) {
  const st = statSync(inputPath);
  if (st.isFile()) return [inputPath];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extname(entry.name) === '.md') out.push(full);
    }
  };
  walk(inputPath);
  return out.sort();
}

// Normalizes any supported input shape into { id, text, stepsHint } rows:
//  - a directory / .md file(s) of TMS case files (frontmatter + body)
//  - a .json file: array of strings, or array of {id, text|description}
export function loadCases(inputPath) {
  if (extname(inputPath) === '.json') {
    const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.cases || [];
    return arr.map((item, i) => {
      if (typeof item === 'string') return { id: `case-${i + 1}`, text: item, frontmatter: {} };
      const text = item.text || item.description || item.body || '';
      return { id: item.id || `case-${i + 1}`, text, frontmatter: item };
    });
  }
  return findCaseFiles(inputPath).map((file) => {
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

  // Quality flags measure uncertainty about the CASE itself — they never move
  // the point estimate (no measured premium yet; complexity-taxonomy.md
  // § Case quality) but they force the widest band, calibrated or not.
  if (qualityFlags.length > 0) {
    const cold = taxonomy.confidence_bands.cold_no_history;
    low = Math.min(low, estMin * cold.low_mult);
    high = Math.max(high, estMin * cold.high_mult);
    confidence = `${cold.label} — quality-flagged`;
  }

  return {
    id: caseRow.id,
    tier: tier.id,
    tierLabel: tier.label,
    classification,
    steps,
    stepsEstimated: estimated,
    novelty: novelty.key,
    qualityFlags,
    // Second complexity axis (setup/data/teardown/assertions — see
    // complexity-taxonomy.md § Modifiers) + split advice: observational,
    // never priced — carried through to the report and training rows.
    modifiers: Array.isArray(verdict?.modifiers) ? verdict.modifiers : [],
    splitRecommended: verdict?.split_recommended === true,
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

function renderMarkdown(scored, { sampleOf, taxonomyPath } = {}) {
  const totalLow = scored.reduce((a, r) => a + r.lowCost, 0);
  const totalHigh = scored.reduce((a, r) => a + r.highCost, 0);
  const totalMin = scored.reduce((a, r) => a + r.estMin, 0);
  const tierRollup = rollupByTier(scored);

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

  const verdictN = scored.filter((r) => r.classification === 'verdict').length;
  const flaggedN = scored.filter((r) => r.qualityFlags.length > 0).length;
  const modifiedN = scored.filter((r) => r.modifiers.length > 0).length;
  const splitN = scored.filter((r) => r.splitRecommended).length;
  const provenance = `Classification: ${verdictN} verdict-read / ${scored.length - verdictN} keyword-fallback` +
    (flaggedN ? `; ${flaggedN} case(s) quality-flagged (widest band applied)` : '') +
    (modifiedN ? `; ${modifiedN} case(s) carry unpriced setup/data/teardown modifiers` : '') +
    (splitN ? `; ${splitN} split candidate(s) — estimate unreliable until split` : '') + '.' +
    (verdictN === 0 ? ' **Keyword-only — a triage, not a proposal number; run the verdict pass (SKILL.md) before quoting.**' : '');

  return `# Automation scoping — scored output (${new Date().toISOString().slice(0, 10)})

## Headline

**${scored.length} cases → ${round1(totalMin)} active-min, $${round2(totalLow)}–$${round2(totalHigh)}**
(point estimate $${round2(scored.reduce((a, r) => a + r.estCost, 0))}, taxonomy: ${taxonomyPath})

${provenance}
${extrapolation}
TODO (agent): write the Methodology paragraph and Assumptions & Risks section
per references/scoping-report-format.md — this script only computes the
numbers, not the narrative (novelty resolution, sample representativeness,
rework tail-risk framing all need judgment this script doesn't have).

## Breakdown by tier

| Interaction tier | Cases | Avg est. min/case | Avg est. $/case |
|---|---|---|---|
${tierRollup.map((t) => `| ${t.tier} | ${t.n} | ${t.avgMin} | $${t.avgCost} |`).join('\n')}

## Per-case table

| Case | Tier | Steps | Novelty | Flags / modifiers | Est. min | Est. $ | Confidence |
|---|---|---|---|---|---|---|---|
${scored.map((r) => `| ${r.id}${r.splitRecommended ? ' ⚠split' : ''} | ${r.tier}${r.classification === 'keyword' ? '†' : ''} | ${r.steps}${r.stepsEstimated ? '*' : ''} | ${r.novelty} | ${[...r.qualityFlags, ...r.modifiers].join(', ') || '—'} | ${r.estMin} | $${r.estCost} | ${r.confidence} |`).join('\n')}
${scored.some((r) => r.classification === 'keyword') ? '\n† tier from keyword fallback, not a reader\'s verdict.\n' : ''}

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

  const { taxonomy, path: taxonomyPath } = loadTaxonomy(taxonomyOverride);
  let knownSurfaceKeywords;
  if (knownSurfacesPath) {
    const raw = readFileSync(knownSurfacesPath, 'utf8');
    knownSurfaceKeywords = knownSurfacesPath.endsWith('.json')
      ? JSON.parse(raw)
      : raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  const cases = loadCases(inputPath);
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

  const scored = cases.map((c) => scoreCase(c, taxonomy, { rate, knownSurfaceKeywords, sampleOf, n: cases.length }));

  const output = asJson
    ? JSON.stringify({ taxonomyPath, sampleOf, cases: scored, byTier: rollupByTier(scored) }, null, 2)
    : renderMarkdown(scored, { sampleOf, taxonomyPath });

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
