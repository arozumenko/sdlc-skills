#!/usr/bin/env node
// batch-cost.mjs — one cost.json per batch, joining the tokenomics ledger to
// the pipeline's own receipt (.agents/automation/<slug>/report.json).
//
//   node batch-cost.mjs [repo] [--batch <slug>] [--stdout] [--json]
//
// Runs standalone AND from the capture hook after every ledger append. Always
// a FULL recompute from (all ledger lines) x (the receipt) — never an append:
// a batch spans sessions (interruptions, re-gates) and a session can touch
// several batches, so cost.json is a pure derivation, idempotent, latest-wins.
//
// ATTRIBUTION MODEL (deliberately the same discipline as manual-qa, which
// never splits dollars per TC either):
//   * per-case rows carry DIRECT work only — the case's own analyst /
//     implement / review / fix / merge dispatches, matched by the RECEIPT's
//     own case ids against each dispatch's label (receipt-driven: works for
//     any id shape any source system uses — Jira keys, TC-101, file slugs).
//   * a dispatch naming several ids (a cluster, any size) splits its numbers
//     EVENLY across the matched ids — deterministic, and close to truth since
//     clusters are similar-by-construction.
//   * batch-level work — the lead's own thread, triage, the hardening gate,
//     the report writer — is OVERHEAD, shown once at batch level, never
//     smeared into per-case rows. Stage classification comes FIRST, because
//     triage enumerates every case id and the gate names the batch's specs:
//     matching ids alone would misattribute them as direct.
//   * dollars are only ever written where they were measured: per-dispatch
//     costUsd exists on Claude (per-file ccusage metering at capture);
//     Copilot bills one figure per session, so its per-case rows carry
//     tokens/time and dollars appear at batch level from billed credits.
//   * stats (avg/median/min/max) run over measured values only.
//
// STDLIB ONLY. Read-only except the cost.json writes.
import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLines, dedupLines } from './team-report.mjs';
import { listScopes } from './work-scope.mjs';

const COST_VERSION = 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (v) => Math.round(v * 100) / 100;
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- receipts ----------------------------------------------------------------
export function loadReceipts(repo, { batch } = {}) {
  const root = join(repo, '.agents', 'automation');
  if (!existsSync(root)) return [];
  // Walk the WHOLE tree: campaigns nest wave receipts at
  // <batch>/<wave>/report.json (the campaign workflow's own reportDir), so a
  // one-level scan silently skips them — same fix efficiency-audit's
  // run-reports.mjs carries. slug = the receipt dir's automation-root-relative
  // path ('approved-next50/wave-01-…'), so `--batch` selects a whole campaign
  // by its top slug or one wave by full path.
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // Non-batch residents of automation/: underscore-prefixed working dirs
      // (_returns, _gates) hold no receipts; 'telemetry' is defense for repos
      // whose telemetry folder predates the move to .agents/telemetry.
      if (entry.name === 'telemetry' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'report.json') {
        const receipt = safeParse(readFileSync(p, 'utf8'));
        if (!receipt || !Array.isArray(receipt.cases)) continue;
        out.push({ slug: relative(root, dir).split(sep).join('/'), dir, receipt });
      }
    }
  };
  walk(root);
  return batch ? out.filter(({ slug }) => slug === batch || slug.startsWith(`${batch}/`)) : out;
}

// --- live (running sessions) -------------------------------------------------
/**
 * Rebuild a PROVISIONAL session line for each still-running session from its
 * live dispatch log (`.agents/telemetry/automation/live/<session>.jsonl` — one small line
 * per finished dispatch, written by the SubagentStop hook).
 *
 * This is what makes the batch report current DURING a run without the ledger
 * growing: the deltas are stored, the snapshot is rebuilt on demand. A live
 * line is used ONLY while its session has no ledger line at all (see the
 * caller) — the real line always wins.
 *
 * `costUsd` here is the sum of the dispatches measured so far, so it is a
 * FLOOR, not the session total — the lead's own thread is not in it until the
 * session is captured. The line is marked `live: true` so consumers can say so.
 */
export function loadLiveLines(repo) {
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
  if (!existsSync(dir)) return [];
  const out = [];
  let names;
  try { names = readdirSync(dir).sort(); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const byId = new Map();
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const r = line.trim() && safeParse(line);
      if (r?.agentId) byId.set(r.agentId, r);      // latest record per dispatch
    }
    const recs = [...byId.values()];
    if (!recs.length) continue;
    const priced = recs.filter((r) => typeof r.costUsd === 'number');
    out.push({
      v: COST_VERSION, host: 'claude', live: true, id: name.replace(/\.jsonl$/, ''),
      user: 'live', repo: '', branch: '', role: null,
      startedAt: null, endedAt: recs.map((r) => r.endedAt).filter(Boolean).sort().pop() ?? null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },   // parent not measured yet
      activeMin: 0, turns: 0, toolCalls: 0, toolErrors: 0,
      ...(priced.length ? { costUsd: priced.reduce((n, r) => n + r.costUsd, 0), costSource: 'ccusage-metered' } : {}),
      cases: [...new Set(recs.flatMap((r) => r.cases ?? []))].sort(),
      subagents: recs.map((r) => ({
        id: r.agentId, role: r.role, label: r.label, n: 1,
        tokens: r.tokens, tokensByModel: r.tokensByModel ?? {},
        ...(r.tokensAttributed === false ? { tokensAttributed: false } : {}),
        activeMin: num(r.activeMin),
        toolCalls: num(r.toolCalls), toolErrors: num(r.toolErrors),
        ...(r.cases?.length ? { cases: r.cases } : {}),
        ...(typeof r.costUsd === 'number' ? { costUsd: r.costUsd } : {}),
      })),
      skills: [], dispatches: recs.length,
    });
  }
  return out;
}

// --- records (script gate verdicts + declared session outcomes) --------------
/**
 * gate-case.mjs appends one line per verdict — chronological by construction.
 * Two locations: the batch dir (legacy + post-fold home) and the telemetry
 * write-side (`telemetry/gate-runs/<slug>.jsonl`, where mid-run appends land
 * so they never dirty the main tree). Read both, dedup exact lines (a fold
 * copies, it doesn't move atomically), keep chronological order by `at`.
 */
export function loadGateRuns(dir, { repo = null, slug = null } = {}) {
  const files = [dir && join(dir, 'gate-runs.jsonl')];
  if (repo && slug) files.push(join(repo, '.agents', 'telemetry', 'automation', 'gate-runs', `${slug}.jsonl`));
  const seen = new Set();
  const out = [];
  for (const p of files) {
    if (!p || !existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      if (seen.has(line)) continue;
      seen.add(line);
      const rec = safeParse(line);
      if (rec) out.push(rec);
    }
  }
  return out.sort((a, z) => String(a.at ?? '').localeCompare(String(z.at ?? '')));
}

/**
 * At close, the telemetry-side verdicts move home: appended into the batch
 * dir's gate-runs.jsonl (skipping lines already there), telemetry file
 * removed. After this the record ships WITH the batch — one committed file,
 * no second source. Safe to call when there is nothing to fold.
 */
export function foldGateRuns(repo, slug, dir) {
  const src = join(repo, '.agents', 'telemetry', 'automation', 'gate-runs', `${slug}.jsonl`);
  if (!existsSync(src)) return 0;
  const dst = join(dir, 'gate-runs.jsonl');
  const have = new Set(existsSync(dst) ? readFileSync(dst, 'utf8').split('\n').filter(Boolean) : []);
  const fresh = readFileSync(src, 'utf8').split('\n').filter(Boolean).filter((l) => !have.has(l));
  if (fresh.length) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(dst, `${fresh.join('\n')}\n`);
  }
  rmSync(src, { force: true });
  return fresh.length;
}

/** Latest declared outcome per receipt case id, across the batch's scopes. */
export function declaredOutcomesFor(receipt, slug, scopes) {
  const ids = new Set((receipt.cases ?? []).map((c) => c.id).filter(Boolean));
  const names = new Set([receipt.batch, slug, String(slug).split('/').pop()].filter(Boolean).map((s) => s.toLowerCase()));
  const matching = scopes
    .filter((s) => (s.batch && names.has(String(s.batch).toLowerCase())) || (s.cases ?? []).some((id) => ids.has(id)))
    .sort((a, z) => String(a.updatedAt ?? '').localeCompare(String(z.updatedAt ?? '')));
  const out = {};
  for (const s of matching) {
    for (const [id, o] of Object.entries(s.outcomes ?? {})) {
      if (ids.has(id)) out[id] = o?.outcome ?? o; // latest updatedAt wins
    }
  }
  return out;
}

/**
 * The receipt vs the records. Drift is THE signal the write-back failure class
 * produces: a gate re-run green whose verdict never reached report.json
 * (measured: 38/69 delivered cases scored unproven), or a session that
 * declared a case automated while the receipt still says blocked/not-run.
 * The records never overwrite the receipt — they make the gap visible.
 */
export function crossCheck(receipt, gateRuns, declared) {
  const latest = gateRuns.length ? gateRuns[gateRuns.length - 1] : null;
  const receiptVerdict = receipt.gate?.verdict ?? null;
  const gateDrift = latest && latest.verdict !== receiptVerdict
    ? { receipt: receiptVerdict, recorded: latest.verdict, at: latest.at ?? null }
    : null;
  const outcomeDrift = [];
  for (const c of receipt.cases ?? []) {
    const d = declared[c.id];
    if (d && d !== (c.outcome ?? null)) outcomeDrift.push({ id: c.id, receipt: c.outcome ?? null, declared: d });
  }
  return { gateDrift, outcomeDrift };
}

// --- classification ----------------------------------------------------------
// Batch-level stages: work that serves the WHOLE batch. Everything else that
// names a case id is that case's own work (analyst/combined/implement/review/
// fix/carve/merge are all per-unit stages in the pipeline).
const OVERHEAD_STAGE = /\btriage\b|hardening gate|mini-gate|gate for batch|^gate[:\s]|report writer|write the report|^report[:\s]|diagnostician|stabiliz\w+ (?:diagnos|round)/i;
const FIX_STAGE = /^fix[:\s]|fix round/i;
/**
 * Stage words are matched against the label's HEAD, never the whole thing.
 * `deriveLabel` slices from the dispatch's own stage marker, so its stage is
 * always at the front — while the rest of the text routinely MENTIONS other
 * stages. Field case: every reviewer prompt says "(do not execute the spec;
 * the hardening gate does that)", so matching anywhere booked all six
 * reviewers as gate overhead — $4.31 taken off the cases and added to the
 * gate, in a real batch report.
 */
const STAGE_HEAD = 48;
const stageHead = (label) => String(label || '').slice(0, STAGE_HEAD);

/** Which of `ids` a dispatch label names. Case-insensitive, id-shape-agnostic. */
export function matchIds(label, ids) {
  const l = String(label || '').toLowerCase();
  if (!l) return [];
  return ids.filter((id) => id && l.includes(String(id).toLowerCase()));
}

export function classify(label, ids, declared = []) {
  if (OVERHEAD_STAGE.test(stageHead(label))) return { kind: 'overhead', ids: [] };
  const matched = matchIds(label, ids);
  if (matched.length) return { kind: 'direct', ids: matched };
  // Fallback: ids the capture mined from the dispatch's own transcript (the
  // ledger entry's `cases`). Rescues dispatches whose case id sits past the
  // label's 160-char window — measured at 11.6% of 2,493 real workflow
  // dispatches (the "stabilize workflow…" prompt shape). Still receipt-driven:
  // only ids the receipt names count, and named overhead stages never get here.
  const fromDeclared = declared.filter((d) => d && ids.some((id) => String(id).toLowerCase() === String(d).toLowerCase()));
  if (fromDeclared.length) return { kind: 'direct', ids: fromDeclared };
  return { kind: 'overhead', ids: [] };
}

// --- the join ----------------------------------------------------------------
/** Does this ledger line belong to this batch at all? `slug` may be a string
 * or a list (a nested wave passes its path slug + the receipt's batch name).
 * A DECLARED scope (work-scope.mjs, stamped by capture) is the strongest
 * surface — its batch and cases join the same match, no guessing needed. */
export function lineMatchesBatch(line, { slug, ids, branches }) {
  const texts = [line.branch || '', ...(line.cases || []),
    line.scope?.batch || '', ...(line.scope?.cases || []),
    ...(line.subagents || []).map((s) => s.label || ''),
    ...(line.subagents || []).flatMap((s) => s.cases || [])]
    .join('\n').toLowerCase();
  for (const s of [].concat(slug || [])) if (s && texts.includes(String(s).toLowerCase())) return true;
  for (const id of ids) if (id && texts.includes(String(id).toLowerCase())) return true;
  for (const b of branches) if (b && texts.includes(String(b).toLowerCase())) return true;
  return false;
}

// `tok` rides every bucket as the FULL quad — the scalar `tokens` sum hides
// that ~95% of it is cache-read at ~1/10 input price, which made report token
// columns alarming and incomparable (field: a $16 batch showing "47.5M
// tokens"). The quad is what the tokenomics view (composition, cache hit
// rate) renders per role/stage/case.
const emptyQuad = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const scaleQuad = (t, f = 1) => ({ input: num(t?.input) * f, output: num(t?.output) * f, cacheRead: num(t?.cacheRead) * f, cacheWrite: num(t?.cacheWrite) * f });
const addQuad = (a, t, f = 1) => { for (const k of Object.keys(a)) a[k] += num(t?.[k]) * f; };
const roundQuad = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
const emptyBucket = () => ({ costUsd: null, tokens: 0, tok: emptyQuad(), activeMin: 0, dispatches: 0, toolCalls: 0, toolErrors: 0 });
function addTo(b, { costUsd, tokens, tok, activeMin, toolCalls = 0, toolErrors = 0 }, share = 1) {
  if (typeof costUsd === 'number') b.costUsd = num(b.costUsd) + costUsd * share;
  b.tokens += tokens * share;
  if (tok && b.tok) addQuad(b.tok, tok, share);
  b.activeMin += activeMin * share;
  b.dispatches += share;
  b.toolCalls += toolCalls * share;
  b.toolErrors += toolErrors * share;
}
const subTokens = (s) => num(s.tokens?.input) + num(s.tokens?.output) + num(s.tokens?.cacheRead) + num(s.tokens?.cacheWrite);

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return {
    avg: v.reduce((a, x) => a + x, 0) / v.length,
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    min: v[0], max: v[v.length - 1], n: v.length,
  };
}
const money = (s) => s && { avg: round2(s.avg), median: round2(s.median), min: round2(s.min), max: round2(s.max), n: s.n };
const rounded = (s) => s && { avg: Math.round(s.avg), median: Math.round(s.median), min: Math.round(s.min), max: Math.round(s.max), n: s.n };

// Overhead stage kinds — the split a lead actually asks about ("what did the
// gate cost"). `other` catches unnamed stage work.
const STAGE_KIND = [
  ['triage', /\btriage\b/i],
  ['gate', /hardening gate|mini-gate|gate for batch|^gate[:\s]/i],
  ['report', /report writer|write the report|^report[:\s]/i],
];
const stageKindOf = (label) => (STAGE_KIND.find(([, re]) => re.test(stageHead(label)))?.[0] ?? 'other');

/** Build one batch's cost.json object from the receipt + ALL ledger lines.
 * `records`: the batch dir (for gate-runs.jsonl) + the repo's scope records.
 * `others`: the OTHER receipts' identities ({keys, ids, branches}) — a session
 * serving several batches must not be double-counted: its dispatches that name
 * another batch's ids/slug are EXCLUDED here, and its session-level figures
 * (lead thread, unnamed work) are split EVENLY across the batches it matched.
 * All optional, so pure-ledger callers and old tests stay valid. */
// ---- sizing join (automation-scoping) --------------------------------------
// PRE-RUN predicted size (score-cases.mjs --json under .agents/estimation/)
// joined to POST-RUN actuals, so a case can be judged against the cross-batch
// history OF ITS OWN SIZE CLASS. Deviations are computed on TOKENS and TIME,
// never on per-case dollars — the scoping skill's own validation (89 blind
// cases) measured ~zero rank correlation for per-case $ (Spearman 0.015); a
// flag here is an ANALYSIS POINTER (estimate drift? execution smell? mis-sized
// case?), not a verdict, and it doubles as calibration health: size classes
// whose histories don't separate are Mode 4 material.
export function loadSizings(repo) {
  const out = new Map();
  const dir = join(repo, '.agents', 'estimation');
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const j = safeParse(readFileSync(join(dir, e.name), 'utf8'));
    const rows = Array.isArray(j?.cases) ? j.cases : Array.isArray(j) ? j : null;
    if (!rows) continue;
    for (const r of rows) {
      const id = r?.id ?? r?.case_id;
      const size = typeof r?.size === 'string' ? r.size : r?.size?.size;
      if (!id || !size) continue;
      // Later files win (a re-scored scope supersedes) — Map.set overwrites.
      out.set(String(id), {
        size: String(size),
        sp: num(r.sp ?? r.size?.sp) || null,
        estMin: num(r.estimated_active_minutes ?? r.est_min) || null,
        src: e.name,
      });
    }
  }
  return out;
}

const percentileOf = (sorted, v) => (sorted.length ? Math.round((100 * sorted.filter((x) => x <= v).length) / sorted.length) : null);
const pctVal = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

/** Cross-batch actuals per size class: sorted real-work-token and active-min arrays. */
export function sizeBaselines(repo, { excludeSlug = null } = {}) {
  const buckets = {};
  const walk = (d) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && e.name !== 'telemetry') walk(full);
      else if (e.name === 'cost.json') {
        const c = safeParse(readFileSync(full, 'utf8'));
        if (!c?.cases || (excludeSlug && c.batch === excludeSlug)) continue;
        for (const x of c.cases) {
          const size = x?.sizing?.size;
          if (!size || !x.direct) continue;
          const rw = x.direct.tok ? num(x.direct.tok.input) + num(x.direct.tok.output) : null;
          const b = (buckets[size] ??= { tok: [], min: [] });
          if (rw != null && rw > 0) b.tok.push(rw);
          if (num(x.direct.activeMin) > 0) b.min.push(num(x.direct.activeMin));
        }
      }
    }
  };
  walk(join(repo, '.agents', 'automation'));
  for (const b of Object.values(buckets)) { b.tok.sort((a, z) => a - z); b.min.sort((a, z) => a - z); }
  return buckets;
}

const MIN_CLASS_N = 5;   // below this, history can't support a percentile verdict

/** Pure enrichment: stamps cases[].sizing and returns the batch-level rollup (or null). */
export function applySizing(casesOut, sizings, baselines) {
  if (!sizings?.size) return null;
  const bySize = {};
  const flagged = [];
  let sized = 0;
  for (const c of casesOut) {
    const s = sizings.get(c.id);
    if (!s) continue;
    sized++;
    const rw = c.direct.tok ? num(c.direct.tok.input) + num(c.direct.tok.output) : null;
    const min = num(c.direct.activeMin);
    const dev = { size: s.size, sp: s.sp, estMin: s.estMin, src: s.src };
    const hist = baselines?.[s.size];
    const n = Math.min(hist?.tok.length ?? 0, hist?.min.length ?? 0) || Math.max(hist?.tok.length ?? 0, hist?.min.length ?? 0);
    if (hist && n >= MIN_CLASS_N) {
      const medTok = pctVal(hist.tok, 50); const p90Tok = pctVal(hist.tok, 90);
      const medMin = pctVal(hist.min, 50); const p90Min = pctVal(hist.min, 90);
      dev.baseline = { n, medianTok: medTok, p90Tok, medianMin: medMin, p90Min };
      if (rw != null) dev.tokPercentile = percentileOf(hist.tok, rw);
      if (min > 0) dev.minPercentile = percentileOf(hist.min, min);
      const hiTok = rw != null && medTok && rw >= p90Tok && rw >= 1.5 * medTok;
      const hiMin = min > 0 && medMin && min >= p90Min && min >= 1.5 * medMin;
      const loTok = rw != null && medTok && rw <= pctVal(hist.tok, 10) && rw <= 0.5 * medTok;
      if (hiTok || hiMin) dev.flag = 'above-p90';
      else if (loTok) dev.flag = 'below-p10';
      if (dev.flag) {
        flagged.push({
          id: c.id, size: s.size, flag: dev.flag,
          detail: dev.flag === 'above-p90'
            ? `real-work ${rw?.toLocaleString?.() ?? rw} tok (p${dev.tokPercentile ?? '—'}) / ${min}m (p${dev.minPercentile ?? '—'}) vs ${s.size}-class median ${medTok?.toLocaleString?.() ?? medTok} tok / ${medMin}m — review: estimate drift, execution smell, or a mis-sized case`
            : `real-work ${rw?.toLocaleString?.() ?? rw} tok ≤ p10 of ${s.size}-class — suspiciously cheap: verify coverage was not shortcut`,
        });
      }
    } else {
      dev.note = `insufficient ${s.size}-class history (n=${n ?? 0} < ${MIN_CLASS_N}) — no deviation verdict`;
    }
    c.sizing = dev;
    const agg = (bySize[s.size] ??= { cases: 0, sp: 0, estMin: 0, actualMin: 0, actualTok: 0 });
    agg.cases++; agg.sp += num(s.sp); agg.estMin += num(s.estMin); agg.actualMin += min; agg.actualTok += num(rw);
  }
  if (!sized) return null;
  const estTotal = Object.values(bySize).reduce((a, b) => a + b.estMin, 0);
  const actTotal = Object.values(bySize).reduce((a, b) => a + b.actualMin, 0);
  return {
    note: 'pre-run predicted size (automation-scoping) joined to actuals. Deviations are tokens/time vs the size-class CROSS-BATCH history — analysis pointers, never per-case dollar verdicts (scoping doctrine: per-case $ rank-correlates ~zero with actuals; only batch totals are quotable). Flags feed Mode 4 calibration.',
    sized, bySize,
    ...(estTotal && actTotal ? { estVsActualMin: { est: Math.round(estTotal), actual: Math.round(actTotal), ratio: Math.round((actTotal / estTotal) * 100) / 100 } } : {}),
    flagged,
  };
}

export function buildBatchCost(slug, receipt, allLines, { dir = null, scopes = [], others = [], repo = null } = {}) {
  const ids = receipt.cases.map((c) => c.id).filter(Boolean);
  const branches = [receipt.integration_branch, ...receipt.cases.map((c) => c.branch)].filter(Boolean);
  // BATCH TIME WINDOW — the guard against resurrected history. Case ids
  // repeat across batch GENERATIONS (a re-run demo, a reset repo, a case
  // re-entering a later batch), and transcripts outlive trees: the catch-up
  // capture legitimately heals a pre-era session into the ledger, where a
  // bare id-match would then attribute it here (field case 2026-08-18: a
  // pre-reset session matched TC-001..004 and inflated a $27 batch to $45).
  // A session that ENDED before this batch was FIRST DECLARED cannot be its
  // work — unless its own scope names the batch outright. Batches with no
  // scope record keep the old id-match behavior unchanged.
  const declaredTs = scopes
    .filter((s) => s.batch === slug || s.batch === receipt.batch)
    .map((s) => Date.parse(s.declaredAt))
    .filter(Number.isFinite);
  const windowStart = declaredTs.length ? Math.min(...declaredTs) : null;
  const inWindow = (l) => {
    if (!windowStart) return true;
    if (l.scope?.batch === slug || l.scope?.batch === receipt.batch) return true;
    const ended = Date.parse(l.endedAt ?? '');
    return !Number.isFinite(ended) || ended >= windowStart;
  };
  const lines = dedupLines(allLines).filter((l) => inWindow(l) && lineMatchesBatch(l, { slug: [slug, receipt.batch].filter(Boolean), ids, branches }));

  const myKeys = [slug, receipt.batch].filter(Boolean).map((s) => String(s).toLowerCase());
  const foreignIds = new Set(others.flatMap((o) => o?.ids ?? []).filter((id) => !ids.includes(id)));
  const foreignKeys = new Set(others.flatMap((o) => o?.keys ?? []).map((s) => String(s).toLowerCase()).filter((k) => !myKeys.includes(k)));
  const mentionsKey = (label, keys) => {
    const l = String(label || '').toLowerCase();
    for (const k of keys) if (k && l.includes(k)) return true;
    return false;
  };

  const perCase = new Map(ids.map((id) => [id, { ...emptyBucket(), fixRounds: 0 }]));
  const overhead = { lead: emptyBucket(), stage: emptyBucket() };
  const byStage = { triage: emptyBucket(), gate: emptyBucket(), report: emptyBucket(), other: emptyBucket() };
  const rework = emptyBucket();
  const totals = { ...emptyBucket(), sessions: lines.length, turns: 0 };
  const tokensSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byRole = new Map(); // role → bucket — feeds the cross-factory export's tokens_by_agent
  const hosts = new Set(); const users = new Set(); const costSources = new Set(); const models = new Set(); const skills = new Set();
  let pricedDirect = false; let sharedSessions = 0; let foreignExcluded = 0;

  const addSplit = (t, f = 1) => { for (const k of Object.keys(tokensSplit)) tokensSplit[k] += num(t?.[k]) * f; };
  // Session-grain per-model quads, scaled by the SAME share factor as the
  // scalar totals — the dataset's tokens_by_model (required whenever a run
  // mixes tiers, which ours always do: haiku triage + sonnet workers).
  // Attribution audit (PR #63 mirror): a unit whose transcript reported no
  // usage sums as ZERO here — which silently under-bills. Count them so the
  // totals can say FLOOR instead of posing as complete.
  let unattributedUnits = 0;
  let attributedUnits = 0;
  const tokensByModel = {};
  const addByModel = (bm, f = 1) => {
    for (const [m, q] of Object.entries(bm ?? {})) {
      const t = (tokensByModel[m] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      for (const k of Object.keys(t)) t[k] += num(q?.[k]) * f;
    }
  };
  const roleAdd = (role, m, dispatches = 1) => {
    if (!byRole.has(role)) byRole.set(role, { tokens: 0, tok: emptyQuad(), costUsd: null, activeMin: 0, dispatches: 0, toolCalls: 0, toolErrors: 0 });
    const b = byRole.get(role);
    b.tokens += m.tokens; b.activeMin += m.activeMin; b.dispatches += dispatches;
    if (m.tok) addQuad(b.tok, m.tok);
    b.toolCalls += num(m.toolCalls); b.toolErrors += num(m.toolErrors);
    if (typeof m.costUsd === 'number') b.costUsd = num(b.costUsd) + m.costUsd;
  };

  for (const line of lines) {
    hosts.add(line.host); users.add(line.user);
    for (const m of line.models || []) models.add(m);
    for (const s of line.skills || []) skills.add(s);
    if (line.costSource && line.costSource !== 'none') costSources.add(line.costSource);

    // How many batches did this session serve? Its session-level figures split
    // evenly across them; a single-batch session divides by 1 (unchanged).
    const div = 1 + others.filter((o) => o && lineMatchesBatch(line, { slug: o.keys ?? [], ids: o.ids ?? [], branches: o.branches ?? [] })).length;
    if (div > 1) sharedSessions++;

    // Partition dispatches: mine (named this batch's ids/slug) at full weight,
    // FOREIGN (named another batch's, not mine) excluded entirely, neutral
    // (named neither) split evenly across the matched batches.
    let subCostAll = 0; let subMinAll = 0;
    const included = [];
    for (const s of line.subagents || []) {
      if (typeof s.costUsd === 'number') subCostAll += s.costUsd;
      subMinAll += num(s.activeMin);
      const mine = matchIds(s.label, ids).length > 0 || (s.cases ?? []).some((c) => ids.includes(c)) || mentionsKey(s.label, myKeys);
      const foreign = !mine && (matchIds(s.label, [...foreignIds]).length > 0 || (s.cases ?? []).some((c) => foreignIds.has(c)) || mentionsKey(s.label, [...foreignKeys]));
      if (foreign) { foreignExcluded++; continue; }
      included.push({ s, w: mine ? 1 : 1 / div });
    }

    // The lead's own thread = the session minus ALL its dispatches (foreign
    // ones included — they are not the parent's), then this batch's even share.
    const parent = {
      costUsd: typeof line.costUsd === 'number' ? Math.max(0, line.costUsd - subCostAll) / div : null,
      tokens: subTokens({ tokens: line.tokens }) / div,
      tok: scaleQuad(line.tokens, 1 / div),
      activeMin: Math.max(0, num(line.activeMin) - subMinAll) / div,
      toolCalls: num(line.toolCalls) / div,
      toolErrors: num(line.toolErrors) / div,
    };
    totals.turns += num(line.turns) / div;
    addTo(totals, parent); totals.dispatches--; // phantom dispatch for the parent
    addSplit(line.tokens, 1 / div);
    addByModel(line.tokensByModel, 1 / div);
    if (line.tokens === null || line.tokensAttributed === false) unattributedUnits++; else attributedUnits++;
    addTo(overhead.lead, parent);
    overhead.lead.dispatches--; // ditto
    roleAdd(line.role || 'session', parent, 0);

    for (const { s, w } of included) {
      const m = {
        costUsd: typeof s.costUsd === 'number' ? s.costUsd : null,
        tokens: subTokens(s), tok: scaleQuad(s.tokens), activeMin: num(s.activeMin),
        toolCalls: num(s.toolCalls), toolErrors: num(s.toolErrors),
      };
      addTo(totals, m, w);
      addSplit(s.tokens, w);
      addByModel(s.tokensByModel, w);
      if (s.tokens === null || s.tokensAttributed === false) unattributedUnits++; else attributedUnits++;
      roleAdd(s.role || 'unknown', { ...m, costUsd: typeof m.costUsd === 'number' ? m.costUsd * w : null, tokens: m.tokens * w, tok: scaleQuad(m.tok, w), activeMin: m.activeMin * w, toolCalls: m.toolCalls * w, toolErrors: m.toolErrors * w }, w);
      const { kind, ids: matched } = classify(s.label, ids, s.cases || []);
      if (kind === 'direct') {
        if (typeof s.costUsd === 'number') pricedDirect = true;
        const isFix = FIX_STAGE.test(stageHead(s.label));
        if (isFix) addTo(rework, m, w);
        const share = w / matched.length; // even split across the cluster, any size
        for (const id of matched) {
          const row = perCase.get(id);
          addTo(row, m, share);
          if (isFix) row.fixRounds += share;
        }
      } else {
        addTo(overhead.stage, m, w);
        addTo(byStage[stageKindOf(s.label)], m, w);
      }
    }
  }

  const cases = receipt.cases.map((c) => {
    const d = perCase.get(c.id) ?? { ...emptyBucket(), fixRounds: 0 };
    return {
      id: c.id, outcome: c.outcome ?? null,
      findings: Array.isArray(c.findings) ? c.findings.length : 0,
      direct: {
        costUsd: typeof d.costUsd === 'number' ? round2(d.costUsd) : null,
        tokens: Math.round(d.tokens), tok: roundQuad(d.tok ?? emptyQuad()),
        activeMin: Math.round(d.activeMin),
        dispatches: Math.round(d.dispatches * 100) / 100, fixRounds: Math.round(d.fixRounds * 100) / 100,
        toolCalls: Math.round(d.toolCalls), toolErrors: Math.round(d.toolErrors),
      },
    };
  });

  const attributed = cases.filter((c) => c.direct.dispatches > 0);
  const outcomes = {};
  for (const c of cases) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
  const delivered = num(outcomes.automated) + num(outcomes['merged-sanctioned-red']);
  const ohCost = num(overhead.lead.costUsd) + num(overhead.stage.costUsd);
  const ohPriced = typeof overhead.lead.costUsd === 'number' || typeof overhead.stage.costUsd === 'number';

  // Records vs receipt: script-authored gate verdicts + declared outcomes.
  const gateRuns = loadGateRuns(dir, { repo, slug });
  const declared = declaredOutcomesFor(receipt, slug, scopes);
  const { gateDrift, outcomeDrift } = crossCheck(receipt, gateRuns, declared);
  const latestGate = gateRuns.length ? gateRuns[gateRuns.length - 1] : null;

  // FULLY LOADED per case: direct + an EVEN share of batch overhead. This is
  // an ALLOCATION, clearly labelled — the doctrine still shows overhead once
  // at batch level and never claims to have measured a per-case split — but
  // "what did this case really cost the batch" is the figure cross-batch
  // comparisons want. Even split across EVERY receipt case: overhead (triage,
  // gate, lead, report) served examined cases too, not only delivered ones.
  const ohMin = overhead.lead.activeMin + overhead.stage.activeMin;
  const ohTok = overhead.lead.tokens + overhead.stage.tokens;
  const nCases = cases.length || 1;
  const casesOut = cases.map((c) => ({
    ...c,
    loaded: {
      costUsd: ohPriced || typeof c.direct.costUsd === 'number'
        ? round2(num(c.direct.costUsd) + (ohPriced ? ohCost / nCases : 0))
        : null,
      tokens: Math.round(c.direct.tokens + ohTok / nCases),
      activeMin: Math.round(c.direct.activeMin + ohMin / nCases),
    },
  }));

  // Sizing join: predicted size (if the scoping skill scored this scope) +
  // deviation vs the size class's cross-batch history. Baselines exclude this
  // batch so a first close never compares a case against itself.
  // No scoping ran → loadSizings is empty → skip entirely (incl. the history
  // walk): cost.json carries no `sizing` key and every renderer degrades to
  // the exact pre-sizing output.
  const sizings0 = repo ? loadSizings(repo) : null;
  const sizingRollup = sizings0?.size ? applySizing(casesOut, sizings0, sizeBaselines(repo, { excludeSlug: slug })) : null;

  const bucketOut = (b) => ({
    costUsd: typeof b.costUsd === 'number' ? round2(b.costUsd) : null,
    tokens: Math.round(b.tokens), tok: roundQuad(b.tok ?? emptyQuad()),
    activeMin: Math.round(b.activeMin),
    dispatches: Math.round(b.dispatches * 100) / 100,
    toolCalls: Math.round(b.toolCalls), toolErrors: Math.round(b.toolErrors),
  });
  return {
    v: COST_VERSION, batch: slug, generatedAt: new Date().toISOString(),
    sources: {
      sessions: lines.length, hosts: [...hosts].sort(), users: [...users].sort(), costSources: [...costSources].sort(), models: [...models].sort(),
      ...(lines.some((l) => l.live) ? {
        liveSessions: lines.filter((l) => l.live).length,
        liveNote: 'PROVISIONAL — a session is still running: its finished dispatches are counted, its own lead thread is not yet measured, so these totals are a floor. Re-run once it ends.',
      } : {}),
      ...(sharedSessions ? { sharedSessions, note: 'session-level figures of shared sessions are split evenly across the batches they served' } : {}),
      ...(foreignExcluded ? { foreignDispatchesExcluded: foreignExcluded } : {}),
    },
    totals: {
      costUsd: typeof totals.costUsd === 'number' ? round2(totals.costUsd) : null,
      tokens: Math.round(totals.tokens), tokensSplit: Object.fromEntries(Object.entries(tokensSplit).map(([k, v]) => [k, Math.round(v)])),
      ...(Object.keys(tokensByModel).length ? { tokensByModel: Object.fromEntries(Object.entries(tokensByModel).map(([m, q]) => [m, roundQuad(q)])) } : {}),
      ...(unattributedUnits ? { tokensAttribution: attributedUnits ? 'partial' : 'none', unattributedUnits } : {}),
      activeMin: Math.round(totals.activeMin),
      dispatches: Math.round(totals.dispatches * 100) / 100, sessions: totals.sessions,
      turns: Math.round(totals.turns), toolCalls: Math.round(totals.toolCalls), toolErrors: Math.round(totals.toolErrors),
      skills: [...skills].sort(),
    },
    byRole: Object.fromEntries([...byRole.entries()].sort().map(([r, b]) => [r, bucketOut(b)])),
    overhead: {
      note: 'batch-level work (lead thread, triage, gate, report) — shown once, never smeared into per-case rows',
      costUsd: ohPriced ? round2(ohCost) : null,
      sharePct: ohPriced && totals.costUsd ? Math.round((ohCost / totals.costUsd) * 100) : null,
      lead: bucketOut(overhead.lead),
      stages: bucketOut(overhead.stage),
      byStage: Object.fromEntries(Object.entries(byStage).filter(([, b]) => b.dispatches > 0).map(([k, b]) => [k, bucketOut(b)])),
    },
    ...(rework.dispatches > 0 ? {
      rework: { ...bucketOut(rework), note: 'fix-round dispatches — the batch\'s rework bill (already inside per-case direct; shown here as its own lever)' },
    } : {}),
    outcomes, delivered,
    gate: receipt.gate ?? null,
    ...(gateRuns.length || Object.keys(declared).length ? {
      records: {
        note: 'script-authored gate verdicts (gate-runs.jsonl) + declared session outcomes (work-scope) vs the receipt — drift means report.json needs a write-back, records never overwrite it',
        ...(latestGate ? { gateRuns: { count: gateRuns.length, latest: { verdict: latestGate.verdict, at: latestGate.at ?? null, consecutiveGreen: latestGate.consecutiveGreen ?? 0 } } } : {}),
        ...(Object.keys(declared).length ? { declaredOutcomes: declared } : {}),
        ...(gateDrift ? { gateDrift } : {}),
        ...(outcomeDrift.length ? { outcomeDrift } : {}),
      },
    } : {}),
    cases: casesOut,
    ...(receipt.work_item_ref ? { workItemRef: receipt.work_item_ref } : {}),
    ...(sizingRollup ? { sizing: sizingRollup } : {}),
    stats: {
      note: 'direct = per-case measured values only; loaded = direct + even overhead share (allocation, not measurement)',
      directCostUsd: pricedDirect ? money(stats(attributed.map((c) => c.direct.costUsd))) : null,
      directTokens: rounded(stats(attributed.map((c) => c.direct.tokens))),
      directActiveMin: rounded(stats(attributed.map((c) => c.direct.activeMin))),
      loadedCostUsd: (ohPriced || pricedDirect) ? money(stats(casesOut.map((c) => c.loaded.costUsd))) : null,
      loadedActiveMin: rounded(stats(casesOut.map((c) => c.loaded.activeMin))),
    },
    averages: {
      totalPerDelivered: delivered > 0 && typeof totals.costUsd === 'number'
        ? { costUsd: round2(totals.costUsd / delivered), note: 'whole batch incl. overhead ÷ delivered (automated + merged-sanctioned-red)' } : null,
      directPerCase: pricedDirect && attributed.length
        ? { costUsd: round2(attributed.reduce((a, c) => a + num(c.direct.costUsd), 0) / attributed.length), note: 'avg direct spend of an attributed case — excludes batch overhead' } : null,
    },
    coverage: {
      casesAttributed: attributed.length, casesUnattributed: cases.filter((c) => !c.direct.dispatches).map((c) => c.id),
      note: 'unattributed = no dispatch label named this id in any matched session (interrupted capture, or work not yet swept)',
    },
  };
}

/** A receipt's identity for the cross-batch exclusion (see buildBatchCost). */
const receiptIdentity = ({ slug, receipt }) => ({
  keys: [slug, receipt.batch].filter(Boolean),
  ids: receipt.cases.map((c) => c.id).filter(Boolean),
  branches: [receipt.integration_branch, ...receipt.cases.map((c) => c.branch)].filter(Boolean),
});

/** Recompute cost.json for every batch (or one) this repo's ledger can see.
 * `live` (default on) also counts sessions that are STILL RUNNING, rebuilt
 * from their dispatch deltas — what makes a batch view current mid-run. Turn
 * it off for a period rollup, whose own totals are ledger-only: mixing the two
 * would show provisional batch rows beside final totals in one document. */
export function updateBatchCosts(repo, { batch, write = true, live = true } = {}) {
  const receipts = loadReceipts(repo, { batch });
  if (!receipts.length) return [];
  // `others` must come from EVERY receipt in the repo, not the filtered set —
  // a --batch build still has to exclude the other batches' dispatches.
  const all = batch ? loadReceipts(repo) : receipts;
  // Ledger lines + provisional lines for sessions that have NO ledger line yet.
  // The real line always wins outright — not by timestamp: after a mid-run
  // close the ledger line is complete (it includes the lead's own thread)
  // while a fresh live file may hold only the dispatches that finished after
  // it, so ranking them by recency would swap a full line for a thinner one.
  const ledger = loadLines([repo]);
  const known = new Set(ledger.map((l) => `${l.host}:${l.id}`));
  const allLines = live
    ? [...ledger, ...loadLiveLines(repo).filter((l) => !known.has(`${l.host}:${l.id}`))]
    : ledger;
  const scopes = listScopes(repo);
  const out = [];
  for (const { slug, dir, receipt } of receipts) {
    const others = all.filter((r) => r.slug !== slug).map(receiptIdentity);
    const cost = buildBatchCost(slug, receipt, allLines, { dir, scopes, others, repo });
    if (write) writeFileSync(join(dir, 'cost.json'), `${JSON.stringify(cost, null, 1)}\n`);
    out.push(cost);
  }
  return out;
}

// --- CLI ---------------------------------------------------------------------
function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const batchIdx = argv.indexOf('--batch');
  const batch = batchIdx !== -1 ? argv[batchIdx + 1] : undefined;
  const repo = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--batch') ?? process.cwd());
  const results = updateBatchCosts(repo, { batch, write: !flags.has('--stdout') });
  if (!results.length) { console.error(`batch-cost: no receipts under ${join(repo, '.agents', 'automation')}`); process.exit(1); }
  if (flags.has('--stdout') || flags.has('--json')) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
  else for (const r of results) console.error(`batch-cost: ${r.batch} — ${r.sources.sessions} session(s), ${r.cases.length} case(s), total ${r.totals.costUsd != null ? `$${r.totals.costUsd}` : `${r.totals.tokens} tokens (unpriced)`} → cost.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
