// STDLIB ONLY. Effort calibration: finished tasks' measured dollar cost → a lookup table the next plan's estimates come from.
//
// One sample per landed task: its share of every hooked dispatch's priced cost (rework included — a fix round is just more
// dispatches on the same task), whether it came back (rework, review_returned, reopened), and the features the planner gave it
// (role, type, novel). Cells are those features at decreasing detail; a task is estimated from the most specific cell with
// enough samples. Effort classes E1–E4 are learned from the cost quartiles, not declared by the planner.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveObservations } from './events.mjs';
import { cliError, deliveryDir, nowIso, sha256 } from './paths.mjs';
import { listRuns } from './plan.mjs';
import { buildTimelines, selectOccurrences } from './timeline.mjs';

export const CALIBRATION_FILE = 'calibration.json';
export const MIN_N = 5;
export const HALF_LIFE_DAYS = 42;
const MIN_FOR_CLASSES = 12;
const DAY = 86_400_000;

// A reopened (deferred-episode) task stays in: its effort is the sum over both episodes and the reopen is a return. A task with
// a hooked dispatch that never ended has an unmeasured share, so it is left out like any other incomplete cost.
const reliable = (i) => i.level === 'task' && i.state === 'done' && i.done_basis === 'observed' && !i.flags.includes('invalid-chain')
  // reopened: in only once it has landed again after the latest reopen.
  && (!i.last_reopen_at || (i.last_done_at != null && i.last_done_at > i.last_reopen_at && i.last_done_basis === 'observed'));

/** Landed tasks with a complete measured cost, across every registered run. */
export function collectSamples(repo, { now = Date.now() } = {}) {
  const res = resolveObservations(repo);
  const { occurrences } = selectOccurrences(res.active, res.conflicts);
  const samples = [];
  for (const run of listRuns(repo)) {
    const known = new Set(run.items.map((i) => i.item_id));
    // A task renamed by supersedes.item_map keeps the cost recorded under its old id. Dispatch cost left under an id this run
    // no longer knows (an older rename the run file no longer carries) cannot be attributed, so its tasks' totals are not
    // trusted: the whole run is left out of calibration rather than training on part of a task.
    // Only work evidence moves with a rename: the re-cut's own `created`/`cancelled` for the old id describe the catalogue
    // change itself, and carried over they would cancel the renamed task.
    const renamed = run.supersedes?.item_map ?? {}, MOVES = new Set(['dispatched', 'dispatch_ended', 'rework_observed', 'review_returned']);
    const mine = occurrences.filter((o) => o.plan === run.run).map((o) => (o.item_id != null && renamed[o.item_id] && MOVES.has(o.event) ? { ...o, item_id: renamed[o.item_id] } : o));
    if (mine.some((o) => o.event === 'dispatch_ended' && o.item_id != null && !known.has(o.item_id))) continue;
    const occ = mine.filter((o) => known.has(o.item_id));
    const returnedIds = new Set(occ.filter((o) => o.event === 'review_returned' || o.event === 'reopened').map((o) => o.item_id));
    const { items } = buildTimelines({ occurrences: occ, plan: run, end: nowIso(now) });
    for (const i of items.values()) {
      if (!reliable(i) || !(i.cost_usd > 0) || i.cost_incomplete) continue;
      const models = Object.entries(i.cost_by_model).sort((a, b) => b[1] - a[1]);
      samples.push({ run: run.run, ref: i.ref, role: i.role ?? null, type: i.type ?? null, area: i.area ?? null, novel: i.novel ?? null, size: i.class ?? null,
        cost_usd: i.cost_usd, done_at: i.last_done_at ?? i.done_at, returned: i.rework_count > 0 || i.reopened || returnedIds.has(i.item_id), model: models[0]?.[0] ?? null });
    }
  }
  return samples;
}

/** Cell keys for a task, most specific first. A feature the planner left out is skipped, not matched as "null". */
export function cellKeys({ role = null, type = null, novel = null } = {}) {
  const keys = [];
  if (role && type && novel != null) keys.push(`role=${role}|type=${type}|novel=${novel}`);
  if (role && type) keys.push(`role=${role}|type=${type}`);
  if (role) keys.push(`role=${role}`);
  if (type) keys.push(`type=${type}`);
  keys.push('all');
  return keys;
}

// Weights are relative (see buildCalibration), so the tolerance is relative to the total; equal relative weights give the
// same quantile whatever their absolute size.
function weightedQuantile(pairs, q) {
  const s = [...pairs].sort((a, b) => a.v - b.v), total = s.reduce((n, p) => n + p.w, 0);
  if (!s.length) return null;
  if (!(total > 0)) return weightedQuantile(s.map((p) => ({ ...p, w: 1 })), q);
  let acc = 0; for (const p of s) { acc += p.w; if (acc >= q * total * (1 - 1e-9)) return p.v; }
  return s[s.length - 1].v;
}
// Costs are stored to 6 significant digits (a $0.003 task must not become $0): CLI output rounds for display only.
const r2 = (x) => (x == null ? null : Number(x.toPrecision(6)));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

export function classOf(cost, bounds) {
  if (!bounds || cost == null) return null;
  return bounds[0] >= cost ? 'E1' : bounds[1] >= cost ? 'E2' : bounds[2] >= cost ? 'E3' : 'E4';
}

/** Kish effective sample size (Σw)²/Σw²: n for equal weights, about 1 when one sample dominates. */
export function effectiveN(weights) {
  const sum = weights.reduce((a, w) => a + w, 0), sq = weights.reduce((a, w) => a + w * w, 0);
  return sq > 0 ? (sum * sum) / sq : 0;
}

// All weights underflowed → equal weights, for quantiles and rates alike.
const withWeights = (list, weightOf) => { const p = list.map((s) => ({ v: s.cost_usd, w: weightOf(s), s })); return p.some((x) => x.w > 0) ? p : p.map((x) => ({ ...x, w: 1 })); };
function summarize(list, weightOf, bounds) {
  const pairs = withWeights(list, weightOf);
  const wsum = pairs.reduce((n, p) => n + p.w, 0) || 1;
  const p50 = weightedQuantile(pairs, 0.5), p80 = weightedQuantile(pairs, 0.8);
  const byModel = {};
  for (const m of new Set(list.map((s) => s.model).filter(Boolean))) {
    const sub = pairs.filter((p) => p.s.model === m), mp = sub.some((p) => p.w > 0) ? sub : sub.map((p) => ({ ...p, w: 1 })), mw = mp.reduce((n, p) => n + p.w, 0);
    byModel[m] = { n: mp.length, p50_usd: r2(weightedQuantile(mp, 0.5)), return_rate: r3(mp.reduce((n, p) => n + (p.s.returned ? p.w : 0), 0) / (mw || 1)) };
  }
  // The class compares unrounded values; rounding is for the file only.
  const newest = list.reduce((m, s) => (m == null || Date.parse(s.done_at) > Date.parse(m) ? s.done_at : m), null);
  return { n: list.length, p50_usd: r2(p50), p80_usd: r2(p80), return_rate: r3(pairs.reduce((n, p) => n + (p.s.returned ? p.w : 0), 0) / wsum), effort_class: classOf(p50, bounds), by_model: byModel,
    n_eff: effectiveN(pairs.map((p) => p.w)), newest_at: newest == null ? null : new Date(Date.parse(newest)).toISOString() };
}

/** Builds the calibration table from samples. Recency-weighted: a sample's weight halves every `halfLifeDays`, so a model or
 * harness change washes through without a manual reset. */
export function buildCalibration(samples, { now = Date.now(), halfLifeDays = HALF_LIFE_DAYS, pricesAsOf = null, sampleRule = 'raw' } = {}) {
  // Weight halves per half-life of age, measured from the newest sample so weights stay ≤ 1 and never all underflow to 0.
  const ageOf = (s) => Math.max(0, now - Date.parse(s.done_at)), newest = samples.length ? Math.min(...samples.map(ageOf)) : 0;
  const weightOf = (s) => 0.5 ** ((ageOf(s) - newest) / (halfLifeDays * DAY));
  const allPairs = samples.map((s) => ({ v: s.cost_usd, w: weightOf(s) }));
  // Raw mode (the shipped rule): 12 samples. Effective mode: the recency weights must add up to an effective 12.
  const enough = sampleRule === 'effective' ? effectiveN(allPairs.map((p) => p.w)) >= MIN_FOR_CLASSES : samples.length >= MIN_FOR_CLASSES;
  const bounds = enough ? [0.25, 0.5, 0.75].map((q) => weightedQuantile(allPairs, q)) : null;
  const groups = new Map();
  for (const s of samples) for (const k of cellKeys(s)) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const cells = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) => [k, summarize(list, weightOf, bounds)]));
  const cal = { v: 1, generated_at: nowIso(now), unit: 'usd', half_life_days: halfLifeDays, min_n: MIN_N, sample_rule: sampleRule, prices_as_of: pricesAsOf, samples: samples.length, class_bounds_usd: bounds && bounds.map(r2), cells, outliers: [] };
  // The tasks the table fits worst — what the retro should look at, and why the planner's features may be missing something.
  cal.outliers = samples.map((s) => { const hit = lookup(cal, s); return hit && hit.cell.p50_usd > 0 ? { run: s.run, ref: s.ref, cell: hit.key, cost_usd: r2(s.cost_usd), p50_usd: hit.cell.p50_usd, ratio: r2(s.cost_usd / hit.cell.p50_usd) } : null; })
    .filter(Boolean).sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 3);
  return cal;
}

/** The most specific eligible cell. Raw rule (the shipped default): at least `min_n` samples. Effective rule: the table was
 * built under it, the cell's Kish n_eff reaches `min_n`, and its newest landing is within two half-lives of `now` (the
 * registration time). A cell without n_eff/newest_at is never eligible under the effective rule. */
export function lookup(cal, task, { rule = 'raw', now = Date.now() } = {}) {
  const minN = cal?.min_n ?? MIN_N;
  const eligible = (cell) => {
    if (rule !== 'effective') return cell.n >= minN;
    if (cal.sample_rule !== 'effective' || !(typeof cell.n_eff === 'number' && cell.n_eff >= minN) || !cell.newest_at) return false;
    return now - Date.parse(cell.newest_at) <= 2 * (cal.half_life_days ?? HALF_LIFE_DAYS) * DAY;
  };
  for (const key of cellKeys(task)) { const cell = cal?.cells?.[key]; if (cell && eligible(cell)) return { key, cell }; }
  return null;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** Why a cell is malformed, or null. Generated v1 tables pass; n_eff/newest_at are optional (tables from before they existed). */
export function cellProblem(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'not an object';
  if (!Number.isInteger(c.n) || c.n < 0) return 'n must be an integer >= 0';
  if (!finite(c.p50_usd) || c.p50_usd <= 0) return 'p50_usd must be a finite number > 0';
  if (!finite(c.p80_usd) || c.p80_usd < c.p50_usd) return 'p80_usd must be a finite number >= p50_usd';
  if (!('effort_class' in c) || !(c.effort_class === null || (typeof c.effort_class === 'string' && /^E[1-4]$/.test(c.effort_class)))) return 'effort_class must be null or E1-E4';
  if ('n_eff' in c && (!finite(c.n_eff) || c.n_eff < 0)) return 'n_eff must be a finite number >= 0';
  if ('newest_at' in c && c.newest_at !== null && !(typeof c.newest_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(c.newest_at) && !Number.isNaN(Date.parse(c.newest_at)))) return 'newest_at must be an ISO UTC timestamp';
  return null;
}

/** null when no table exists yet. A table that exists but cannot be read, does not parse, or has no `cells` object is an
 * error (CALIBRATION-INVALID), never "no table": otherwise a merge conflict in the file would silently stop estimates. */
export function readCalibration(repo) {
  const path = join(deliveryDir(repo), CALIBRATION_FILE);
  const bad = (why) => cliError('CALIBRATION-INVALID', `${path}: ${why}. Re-run \`delivery.mjs calibrate\`, fix the file, or pass --no-calibrate`);
  let text, cal;
  // Only "no such file" means no table; existsSync would also hide a permission error.
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw bad(e.code ?? e.message); }
  try { cal = JSON.parse(text); } catch (e) { throw bad(`not valid JSON (${e.message})`); }
  if (!cal || typeof cal !== 'object' || !cal.cells || typeof cal.cells !== 'object' || Array.isArray(cal.cells)) throw bad('no "cells" object');
  for (const [key, cell] of Object.entries(cal.cells)) { const why = cellProblem(cell); if (why) throw bad(`cell "${key}": ${why}`); }
  return { cal, sha256: sha256(text), path };
}

/** Fills a calibrated dollar estimate (and learned effort class) into every task the planner left unestimated. Auto-accepted:
 * the numbers are the table's, not anyone's judgement, so there is nothing for a human to sign. A task already carrying a
 * calibrated estimate in the previous version keeps it, so a re-cut does not re-estimate finished planning. Mutates `plan`. */
export function fillEstimates(plan, calib, { now = Date.now(), refPath = `.agents/telemetry/delivery/${CALIBRATION_FILE}`, prevItems = [], renameMap = null, rule = 'raw' } = {}) {
  // A task renamed through supersedes.item_map is found under its new id.
  const at = nowIso(now), prevBy = new Map(prevItems.map((i) => [renameMap?.[i.item_id] ?? i.item_id, i]));
  const out = { filled: 0, kept: 0, no_cell: 0, planner: 0 };
  for (const m of plan.missions ?? []) for (const t of m.tasks ?? []) {
    if (t.estimate) { out.planner++; continue; }
    const prev = t.item_id && prevBy.get(t.item_id);
    if (prev?.estimate?.tier === 'calibrated') { t.estimate = prev.estimate; if (prev.effort_class) t.effort_class = prev.effort_class; out.kept++; continue; }
    const hit = calib && lookup(calib.cal, t, { rule, now });
    if (!hit || hit.cell.p50_usd == null) { out.no_cell++; continue; }
    t.estimate = { unit: 'usd', low: hit.cell.p50_usd, high: Math.max(hit.cell.p50_usd, hit.cell.p80_usd), tier: 'calibrated', proposed_by: 'calibrate', proposed_at: at, accepted_by: 'calibrate (auto)', accepted_at: at,
      reference: { path: refPath, sha256: calib.sha256, population: `${hit.key} n=${hit.cell.n}` } };
    if (hit.cell.effort_class) t.effort_class = hit.cell.effort_class;
    out.filled++;
  }
  return out;
}
