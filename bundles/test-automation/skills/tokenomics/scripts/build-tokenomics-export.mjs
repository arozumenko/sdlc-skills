#!/usr/bin/env node
// build-tokenomics-export.mjs — the hyperfactory tokenomics dataset emitter.
//
// Spec: the ai-hyperfactory-tokenomics guide, schema 1.0. A submission is ONE
// role-fabric: { schema_version, segment{…}, runs[…] } — the segment header
// once, then ONE ROW PER WORK-ITEM. Our work-item is the batch (a suite of
// cases, level 'feature'), and rows are the telemetry cohort — reconstructed
// from the pipeline's own cost.json, the precedent the dataset's first real
// submission set (its `T-WI-###` cohort: sessions → work-items, programmatic).
//
//   node build-tokenomics-export.mjs [repo] --batch <slug> [--stdout]   append one row
//   node build-tokenomics-export.mjs [repo] --submission [--anon]       build datasets/<factory-id>/
//   node build-tokenomics-export.mjs --compare <a.cost.json> <b.cost.json>
//
// The close sweep calls the append automatically (work-scope.mjs § close), so
// a project with a factory profile accumulates a submission-ready runs.json
// batch by batch — compliance is a side effect of closing, not a chore.
//
// IDENTITY IS PROJECT-LOCAL, NEVER BUNDLED. The segment header comes from a
// hand-authored .agents/telemetry/automation/factory-profile.json (template:
// ../templates/factory-profile.template.json — scout's seeding Step 6.7 copies
// it). The bundle ships plumbing only; no organisation identifiers.
//
// DOLLAR HONESTY. Every figure is carried from cost.json (measured values
// only). Fields the pipeline cannot measure are null and named in the §7
// checklist — defaults-and-flags, never silent guessing. The one computed
// convenience is cache_read_share_pct (a COST share, per the spec): derived
// from the token quad at PUBLIC LIST RATIOS (in 1× / out 5× / write 1.25× /
// read 0.1×) and labelled so in notes — canonical re-pricing is central.
//
// STDLIB ONLY. Read-only except the export-dir writes.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateBatchCosts } from './batch-cost.mjs';

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
const round = (v, p = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Public list-price ratios relative to input — Sonnet-class; used ONLY for
// the cache-read COST-share convenience field.
const PRICE_RATIO = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
export function costWeightedCacheShare(q) {
  if (!q) return null;
  const total = num(q.input) * PRICE_RATIO.input + num(q.output) * PRICE_RATIO.output
    + num(q.cacheWrite) * PRICE_RATIO.cacheWrite + num(q.cacheRead) * PRICE_RATIO.cacheRead;
  return total ? round((num(q.cacheRead) * PRICE_RATIO.cacheRead / total) * 100, 1) : null;
}

// §3.1 spine, Effort row: XS < ½ day · S ~1 day · M 2–3 days · L 4–5 days ·
// XL > 1 sprint. Band edges split the gaps.
export function effortDaysToSize(d) {
  if (d == null || !Number.isFinite(d)) return null;
  return d < 0.5 ? 'XS' : d <= 1.5 ? 'S' : d <= 3.5 ? 'M' : d <= 7.5 ? 'L' : 'XL';
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL'];

export function buildSegment(profile, cost) {
  return {
    factory_id: profile.factory_id ?? null,
    factory_name: profile.factory_name ?? null,
    stop: profile.stop ?? 'testing',
    owner_group: profile.owner_group ?? 'QA',
    work_item_level: profile.work_item_level ?? 'feature',
    factory_type: profile.factory_type ?? 'qa',
    ...(profile.factory_domain ? { factory_domain: profile.factory_domain } : {}),
    agent_tool: profile.agent_tool ?? (cost ? cost.sources.hosts.join('+') : null),
    default_method: profile.default_method ?? 'metered',
    scope: profile.scope ?? { includes_subagents: true, includes_retries: true, includes_abandoned_runs: false },
    currency: profile.currency ?? 'USD',
    efficiency_techniques: profile.efficiency_techniques ?? [],
    pipeline: profile.pipeline ?? [],
    ...(profile.submitted_by ? { submitted_by: profile.submitted_by } : {}),
    ...(profile.submitted_date ? { submitted_date: profile.submitted_date } : {}),
  };
}

export function buildRunRow(cost, profile = {}) {
  const t = cost.totals;
  const q = t.tokensSplit ?? null;
  const sz = cost.sizing ?? null;
  // effort: scoping SP claims 1 SP = 1 hour of CONVENTIONAL engineer effort,
  // so SP/8 ≈ person-days-no-AI — derived, and flagged as such in notes.
  const caseSp = sz ? Object.values(sz.bySize).reduce((a, b) => a + num(b.sp), 0) : null;
  const effortDays = caseSp ? round(caseSp / 8, 1) : null;
  const dominantSize = sz
    ? Object.entries(sz.bySize).sort((a, b) => b[1].cases - a[1].cases || SIZE_ORDER.indexOf(b[0]) - SIZE_ORDER.indexOf(a[0]))[0]?.[0] ?? null
    : null;
  const maxSize = sz
    ? [...SIZE_ORDER].reverse().find((k) => sz.bySize[k]) ?? null
    : null;
  const notStarted = num(cost.outcomes?.['not-started']) + num(cost.outcomes?.['infra-stalled']);
  const authored = cost.cases.length - notStarted;
  const byModel = t.tokensByModel ?? null;
  const primary = byModel
    ? Object.entries(byModel).sort((a, b) => num(b[1].output) - num(a[1].output))[0]?.[0] ?? cost.sources.models[0] ?? null
    : cost.sources.models[0] ?? null;
  const oc = Object.entries(cost.outcomes ?? {}).map(([k, n]) => `${k} ${n}`).join(', ');
  return {
    // Telemetry-cohort prefix per the dataset's first submission's precedent;
    // a real tracker ref (batch args → report.json work_item_ref) replaces it.
    work_item_ref: cost.workItemRef ?? `T-${cost.batch}`,
    work_item_level: profile.work_item_level ?? 'feature',
    work_item_brief: `Test-automation batch: ${cost.cases.length} TMS case(s) through analyse → implement → review → merge → gate; ${cost.delivered} delivered.`,
    maturity: profile.maturity ?? 'pilot',
    ...(effortDays != null ? { size_tshirt: effortDaysToSize(effortDays), effort_days: effortDays } : {}),
    sessions: cost.sources.sessions,
    turns: t.turns ?? null,
    subagent_dispatches: t.dispatches,
    orchestrator_cost_pct: typeof cost.overhead?.lead?.costUsd === 'number' && t.costUsd
      ? round((cost.overhead.lead.costUsd / t.costUsd) * 100, 1)
      : (t.dispatches ? null : 100),
    tokens: q ? { input: q.input, output: q.output, cache_read: q.cacheRead, cache_create: q.cacheWrite } : null,
    primary_model: primary,
    models_used: cost.sources.models,
    ...(byModel ? {
      tokens_by_model: Object.fromEntries(Object.entries(byModel).map(([m, v]) => [m,
        { input: num(v.input), output: num(v.output), cache_read: num(v.cacheRead), cache_create: num(v.cacheWrite) }])),
    } : {}),
    cost_api_equivalent_usd: t.costUsd,
    cache_read_share_pct: costWeightedCacheShare(q),
    scenarios_authored: authored,
    scenarios_automated: cost.delivered,
    scenarios_executed: authored,
    ...(maxSize ? { scenario_complexity: maxSize } : {}),
    ...(profile.env_setup ? { env_setup: profile.env_setup } : {}),
    ...(dominantSize ? { self_size: dominantSize } : {}),
    ...(caseSp ? { story_points: caseSp } : {}),
    ...(cost.totals.tokensAttribution ? { _tokens_attribution: cost.totals.tokensAttribution } : {}),
    notes: [
      `gate ${cost.gate?.verdict ?? 'not-run'}${cost.gate?.runs ? ` (${cost.gate.runs}x)` : ''}; outcomes: ${oc || '—'}.`,
      ...(cost.totals.tokensAttribution ? [`TOKEN ATTRIBUTION ${cost.totals.tokensAttribution.toUpperCase()}: ${cost.totals.unattributedUnits} unit(s) reported no usage — totals are a floor.`] : []),
      `Telemetry cohort: reconstructed from .agents/automation/${cost.batch}/cost.json (v${cost.v}); batch slug '${cost.batch}'.`,
      effortDays != null ? `effort_days derived from scoping SP (${caseSp} SP × 1h ÷ 8) — conventional-effort estimate, not a human report.` : 'effort_days unavailable — no scoping verdicts for this batch (run the intake sizing pass).',
      'cache_read_share_pct computed from the token quad at public list ratios (in 1x / out 5x / write 1.25x / read 0.1x).',
      'scenarios_executed = cases the pipeline analysed live and gated (analyst execution + N-consecutive gate runs; re-runs not multiplied).',
    ].join(' '),
  };
}

// §7 self-validation — defaults-and-flags, never silent.
export function checklist(segment, row) {
  const missing = []; const defaulted = [];
  for (const f of ['factory_id', 'factory_name', 'agent_tool']) if (!segment[f]) missing.push(`segment.${f}`);
  if (!segment.stop || !segment.owner_group || !segment.work_item_level) missing.push('segment.stop/owner_group/work_item_level');
  for (const f of ['work_item_ref', 'work_item_brief']) if (!row[f]) missing.push(f);
  if (row.effort_days == null) missing.push('effort_days (run the intake sizing pass)');
  if (!row.size_tshirt) missing.push('size_tshirt (derives from effort_days)');
  if (row.maturity === 'pilot' && !('maturity' in (segment._profileKeys ?? {}))) defaulted.push('maturity=pilot (set it in factory-profile.json)');
  if (!row.tokens || ['input', 'output', 'cache_read', 'cache_create'].some((k) => row.tokens[k] == null)) missing.push('tokens (4 totals)');
  if (!row.primary_model || !row.models_used?.length) missing.push('primary_model/models_used');
  if (!(row.cost_api_equivalent_usd > 0)) missing.push('cost_api_equivalent_usd > 0');
  if (!(row.cache_read_share_pct >= 0 && row.cache_read_share_pct <= 100)) missing.push('cache_read_share_pct in [0,100]');
  for (const f of ['scenarios_authored', 'scenarios_automated', 'scenarios_executed']) if (row[f] == null) missing.push(f);
  if (!row.scenario_complexity) missing.push('scenario_complexity (from sizing verdicts)');
  if (!row.env_setup) missing.push('env_setup (set it in factory-profile.json: trivial|single-fixture|multi-fixture|external-deps|full-env)');
  if ((row.models_used?.length ?? 0) > 1 && !row.tokens_by_model) missing.push('tokens_by_model (required: models_used > 1; re-run close with current capture hooks)');
  if (row._tokens_attribution) missing.push(`tokens attribution '${row._tokens_attribution}' — some dispatches reported no usage (gateway pass-through gap); token totals and cost are a FLOOR, not a bill`);
  return { missing, defaulted };
}

// --- the accumulating dataset -------------------------------------------------
export function exportPath(repo) { return join(repo, '.agents', 'telemetry', 'automation', 'export', 'runs.json'); }

export function appendRun(repo, cost, profile) {
  const segment = buildSegment(profile, cost);
  const row = buildRunRow(cost, profile);
  const path = exportPath(repo);
  const doc = (existsSync(path) && safeParse(readFileSync(path, 'utf8'))) || { schema_version: profile.schema_version ?? '1.0', segment, runs: [] };
  doc.schema_version = profile.schema_version ?? doc.schema_version ?? '1.0';
  doc.segment = segment;                         // header always tracks the profile
  // Upsert by work_item_ref: a re-closed batch REPLACES its row (latest wins),
  // it never duplicates — cost.json is a pure recompute and so is this.
  const i = doc.runs.findIndex((r) => r.work_item_ref === row.work_item_ref);
  const replaced = i !== -1;
  if (replaced) doc.runs[i] = row; else doc.runs.push(row);
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation', 'export'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return { path, row, segment, replaced, checks: checklist(segment, row) };
}

// --- submission folder --------------------------------------------------------
export function anonymizeDoc(doc) {
  const out = JSON.parse(JSON.stringify(doc));
  out.runs = out.runs.map((r, i) => ({
    ...r,
    work_item_ref: `T-WI-${String(i + 1).padStart(3, '0')}`,
    work_item_brief: `Test-automation batch (${r.scenarios_executed ?? '?'} cases${r.size_tshirt ? `, ${r.size_tshirt}` : ''})`,
    notes: (r.notes ?? '').replace(/batch slug '[^']*'/g, "batch slug 'anonymised'"),
  }));
  return out;
}

export function writeSubmission(repo, { anon = false } = {}) {
  const path = exportPath(repo);
  const doc = existsSync(path) && safeParse(readFileSync(path, 'utf8'));
  if (!doc?.runs?.length) return { error: `no accumulated runs at ${path} — close a batch first (or run --batch <slug>)` };
  const finalDoc = anon ? anonymizeDoc(doc) : doc;
  const id = finalDoc.segment.factory_id ?? 'UNSET-factory-id';
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'export', 'datasets', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'runs.json'), `${JSON.stringify(finalDoc, null, 2)}\n`);
  const rows = finalDoc.runs;
  const sum = (f) => rows.reduce((a, r) => a + num(r[f]), 0);
  const tok = rows.reduce((a, r) => { for (const k of ['input', 'output', 'cache_read', 'cache_create']) a[k] += num(r.tokens?.[k]); return a; }, { input: 0, output: 0, cache_read: 0, cache_create: 0 });
  const allChecks = rows.map((r) => checklist(finalDoc.segment, r));
  const md = [
    `# Submission — ${id} (\`${finalDoc.segment.stop}\` stop)`, '',
    '*Paired with the machine-readable [`runs.json`](./runs.json) (identical numbers). Telemetry cohort: every row is reconstructed from the pipeline\'s own per-batch cost receipts.*', '',
    '## Factory', '',
    '| | |', '|---|---|',
    `| **Factory** | \`${id}\` |`,
    `| **Stop · owner** | \`${finalDoc.segment.stop}\` · \`${finalDoc.segment.owner_group}\` |`,
    `| **Work-item level** | \`${finalDoc.segment.work_item_level}\` |`,
    `| **Agent / tool** | \`${finalDoc.segment.agent_tool}\` |`,
    `| **Method · scope** | \`${finalDoc.segment.default_method}\` · subagents ${finalDoc.segment.scope.includes_subagents ? '✓' : '✗'}, retries ${finalDoc.segment.scope.includes_retries ? '✓' : '✗'}, abandoned ${finalDoc.segment.scope.includes_abandoned_runs ? '✓' : '✗'} |`,
    `| **Techniques** | ${finalDoc.segment.efficiency_techniques.join(' · ') || '—'} |`,
    `| **Pipeline** | ${Array.isArray(finalDoc.segment.pipeline) ? finalDoc.segment.pipeline.join(' → ') : finalDoc.segment.pipeline} |`, '',
    `## Aggregate summary — ${rows.length} work-item(s)`, '',
    '| Metric | Value |', '|---|---|',
    `| Total cost (API-equivalent) | $${round(sum('cost_api_equivalent_usd'))} |`,
    `| Scenarios authored / automated / executed | ${sum('scenarios_authored')} / ${sum('scenarios_automated')} / ${sum('scenarios_executed')} |`,
    `| Tokens (in / out / cache-read / cache-create) | ${tok.input.toLocaleString()} / ${tok.output.toLocaleString()} / ${tok.cache_read.toLocaleString()} / ${tok.cache_create.toLocaleString()} |`,
    `| Sessions / dispatches / turns | ${sum('sessions')} / ${round(sum('subagent_dispatches'))} / ${sum('turns')} |`, '',
    '## §7 checklist status', '',
    ...(allChecks.every((c) => !c.missing.length)
      ? ['All rows pass the self-validation checklist.']
      : allChecks.flatMap((c, i) => c.missing.map((m) => `- ❌ row ${i + 1} (\`${rows[i].work_item_ref}\`): ${m}`))),
    '',
    '_Free-form technique/savings notes: fill in what you measured (the guide\'s `measured_savings`) before opening the PR._', '',
  ].join('\n');
  writeFileSync(join(dir, 'submission.md'), md);
  return { dir, rows: rows.length, anon, incomplete: allChecks.filter((c) => c.missing.length).length };
}

// --- compare: two cost.json files side by side --------------------------------
const fmt = (v, f = (x) => x) => (v == null ? 'n/a' : f(v));
const usd = (v) => fmt(v, (x) => `$${x.toFixed(2)}`);
export function renderCompare(a, b) {
  const row = (label, fa, fb) => `| ${label} | ${fa} | ${fb} |`;
  const s4 = (st, f) => (st ? `${f(st.avg)} / ${f(st.median)} / ${f(st.min)}–${f(st.max)}` : 'n/a');
  return [
    `| metric | ${a.batch} | ${b.batch} |`, '|---|---|---|',
    row('cases / delivered', `${a.cases.length} / ${a.delivered}`, `${b.cases.length} / ${b.delivered}`),
    row('total cost', usd(a.totals.costUsd), usd(b.totals.costUsd)),
    row('per delivered (incl. overhead)', usd(a.averages.totalPerDelivered?.costUsd), usd(b.averages.totalPerDelivered?.costUsd)),
    row('avg direct per case', usd(a.averages.directPerCase?.costUsd), usd(b.averages.directPerCase?.costUsd)),
    row('direct cost avg/median/min–max', s4(a.stats.directCostUsd, (x) => `$${x.toFixed(2)}`), s4(b.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)),
    row('overhead share', fmt(a.overhead.sharePct, (x) => `${x}%`), fmt(b.overhead.sharePct, (x) => `${x}%`)),
    row('active hours', fmt(a.totals.activeMin, (x) => (x / 60).toFixed(1)), fmt(b.totals.activeMin, (x) => (x / 60).toFixed(1))),
    row('gate', a.gate?.verdict ?? 'n/a', b.gate?.verdict ?? 'n/a'),
    row('sessions / dispatches', `${a.sources.sessions} / ${a.totals.dispatches}`, `${b.sources.sessions} / ${b.totals.dispatches}`),
  ].join('\n');
}

export function loadProfile(repo, override) {
  const path = override ?? join(repo, '.agents', 'telemetry', 'automation', 'factory-profile.json');
  const profile = existsSync(path) ? (safeParse(readFileSync(path, 'utf8')) ?? {}) : {};
  return { path, profile };
}

function printChecks(checks) {
  for (const m of checks.missing) console.error(`  ❌ MISSING: ${m}`);
  for (const d of checks.defaulted) console.error(`  ⚠️  DEFAULTED: ${d}`);
  if (!checks.missing.length && !checks.defaulted.length) console.error('  ✓ §7 checklist clean');
}

function main(argv = process.argv.slice(2)) {
  const ci = argv.indexOf('--compare');
  if (ci !== -1) {
    const a = safeParse(readFileSync(argv[ci + 1], 'utf8')); const b = safeParse(readFileSync(argv[ci + 2], 'utf8'));
    if (!a || !b) { console.error('compare: could not parse the two cost.json files'); return 1; }
    process.stdout.write(`${renderCompare(a, b)}\n`);
    return 0;
  }
  const val = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : undefined; };
  const repo = resolve(argv.find((a, i) => !a.startsWith('--') && !['--batch', '--profile'].includes(argv[i - 1])) ?? process.cwd());
  const { path: profilePath, profile } = loadProfile(repo, val('--profile'));
  if (!profile.factory_id) console.error(`export: no factory profile at ${profilePath} — identity fields will be null (copy the skill's templates/factory-profile.template.json there; seeding Step 6.7 does this)`);
  if (argv.includes('--submission')) {
    const res = writeSubmission(repo, { anon: argv.includes('--anon') });
    if (res.error) { console.error(`export: ${res.error}`); return 1; }
    console.error(`export: submission folder at ${res.dir} (${res.rows} row(s)${res.anon ? ', anonymised' : ''}${res.incomplete ? `, ${res.incomplete} row(s) still fail §7 — see submission.md` : ''})`);
    return 0;
  }
  const batch = val('--batch');
  if (!batch) { console.error('usage: build-tokenomics-export.mjs [repo] --batch <slug> [--profile <path>] [--stdout] | --submission [--anon] | --compare <a> <b>'); return 1; }
  const [cost] = updateBatchCosts(repo, { batch, write: true });
  if (!cost) { console.error(`export: no receipt for batch '${batch}' under ${join(repo, '.agents', 'automation')}`); return 1; }
  const res = appendRun(repo, cost, profile);
  console.error(`export: ${res.replaced ? 'replaced' : 'appended'} row '${res.row.work_item_ref}' in ${res.path}`);
  printChecks(res.checks);
  if (argv.includes('--stdout')) process.stdout.write(`${JSON.stringify(res.row, null, 2)}\n`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
