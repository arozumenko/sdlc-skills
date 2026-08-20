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
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLines, dedupLines } from './team-report.mjs';

const COST_VERSION = 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (v) => Math.round(v * 100) / 100;
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- receipts ----------------------------------------------------------------
export function loadReceipts(repo, { batch } = {}) {
  const root = join(repo, '.agents', 'automation');
  if (!existsSync(root)) return [];
  const out = [];
  let slugs;
  try { slugs = readdirSync(root); } catch { return []; }
  for (const slug of slugs) {
    if (batch && slug !== batch) continue;
    const path = join(root, slug, 'report.json');
    if (!existsSync(path)) continue;
    const receipt = safeParse(readFileSync(path, 'utf8'));
    if (!receipt || !Array.isArray(receipt.cases)) continue;
    out.push({ slug, dir: join(root, slug), receipt });
  }
  return out;
}

// --- classification ----------------------------------------------------------
// Batch-level stages: work that serves the WHOLE batch. Everything else that
// names a case id is that case's own work (analyst/combined/implement/review/
// fix/carve/merge are all per-unit stages in the pipeline).
const OVERHEAD_STAGE = /\btriage\b|hardening gate|mini-gate|gate for batch|^gate[:\s]|report writer|write the report|^report[:\s]|diagnostician|stabiliz\w+ (?:diagnos|round)/i;
const FIX_STAGE = /^fix[:\s]|fix round/i;

/** Which of `ids` a dispatch label names. Case-insensitive, id-shape-agnostic. */
export function matchIds(label, ids) {
  const l = String(label || '').toLowerCase();
  if (!l) return [];
  return ids.filter((id) => id && l.includes(String(id).toLowerCase()));
}

export function classify(label, ids) {
  if (OVERHEAD_STAGE.test(String(label || ''))) return { kind: 'overhead', ids: [] };
  const matched = matchIds(label, ids);
  if (matched.length) return { kind: 'direct', ids: matched };
  return { kind: 'overhead', ids: [] };
}

// --- the join ----------------------------------------------------------------
/** Does this ledger line belong to this batch at all? */
export function lineMatchesBatch(line, { slug, ids, branches }) {
  const texts = [line.branch || '', ...(line.cases || []), ...(line.subagents || []).map((s) => s.label || '')]
    .join('\n').toLowerCase();
  if (slug && texts.includes(String(slug).toLowerCase())) return true;
  for (const id of ids) if (id && texts.includes(String(id).toLowerCase())) return true;
  for (const b of branches) if (b && texts.includes(String(b).toLowerCase())) return true;
  return false;
}

const emptyBucket = () => ({ costUsd: null, tokens: 0, activeMin: 0, dispatches: 0 });
function addTo(b, { costUsd, tokens, activeMin }, share = 1) {
  if (typeof costUsd === 'number') b.costUsd = num(b.costUsd) + costUsd * share;
  b.tokens += tokens * share;
  b.activeMin += activeMin * share;
  b.dispatches += share;
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

/** Build one batch's cost.json object from the receipt + ALL ledger lines. */
export function buildBatchCost(slug, receipt, allLines) {
  const ids = receipt.cases.map((c) => c.id).filter(Boolean);
  const branches = [receipt.integration_branch, ...receipt.cases.map((c) => c.branch)].filter(Boolean);
  const lines = dedupLines(allLines).filter((l) => lineMatchesBatch(l, { slug, ids, branches }));

  const perCase = new Map(ids.map((id) => [id, { ...emptyBucket(), fixRounds: 0 }]));
  const overhead = { lead: emptyBucket(), stage: emptyBucket() };
  const totals = { ...emptyBucket(), sessions: lines.length };
  const tokensSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byRole = new Map(); // role → {tokens, costUsd, activeMin, dispatches} — feeds the cross-factory export's tokens_by_agent
  const hosts = new Set(); const users = new Set(); const costSources = new Set(); const models = new Set();
  let pricedDirect = false;

  const addSplit = (t) => { for (const k of Object.keys(tokensSplit)) tokensSplit[k] += num(t?.[k]); };
  const roleAdd = (role, { costUsd, tokens, activeMin }, dispatches = 1) => {
    if (!byRole.has(role)) byRole.set(role, { tokens: 0, costUsd: null, activeMin: 0, dispatches: 0 });
    const b = byRole.get(role);
    b.tokens += tokens; b.activeMin += activeMin; b.dispatches += dispatches;
    if (typeof costUsd === 'number') b.costUsd = num(b.costUsd) + costUsd;
  };

  for (const line of lines) {
    hosts.add(line.host); users.add(line.user);
    for (const m of line.models || []) models.add(m);
    if (line.costSource && line.costSource !== 'none') costSources.add(line.costSource);
    // Session totals: the line's own costUsd covers parent + subs where priced.
    if (typeof line.costUsd === 'number') totals.costUsd = num(totals.costUsd) + line.costUsd;
    totals.activeMin += num(line.activeMin);
    totals.tokens += subTokens({ tokens: line.tokens }) + (line.subagents || []).reduce((n, s) => n + subTokens(s), 0);
    addSplit(line.tokens);
    for (const s of line.subagents || []) addSplit(s.tokens);

    let subCost = 0;
    for (const s of line.subagents || []) {
      totals.dispatches++;
      roleAdd(s.role || 'unknown', { costUsd: typeof s.costUsd === 'number' ? s.costUsd : null, tokens: subTokens(s), activeMin: num(s.activeMin) });
      if (typeof s.costUsd === 'number') subCost += s.costUsd;
      const { kind, ids: matched } = classify(s.label, ids);
      const measure = { costUsd: typeof s.costUsd === 'number' ? s.costUsd : null, tokens: subTokens(s), activeMin: num(s.activeMin) };
      if (kind === 'direct') {
        if (typeof s.costUsd === 'number') pricedDirect = true;
        const share = 1 / matched.length; // even split across the cluster, any size
        for (const id of matched) {
          const row = perCase.get(id);
          addTo(row, measure, share);
          if (FIX_STAGE.test(String(s.label || ''))) row.fixRounds += share;
        }
      } else {
        addTo(overhead.stage, measure);
      }
    }
    // The lead's own thread = the session minus its dispatches. Tokens are
    // already parent-only on the line; dollars are total minus sub dollars.
    const leadShare = {
      costUsd: typeof line.costUsd === 'number' ? Math.max(0, line.costUsd - subCost) : null,
      tokens: subTokens({ tokens: line.tokens }),
      activeMin: Math.max(0, num(line.activeMin) - (line.subagents || []).reduce((n, s) => n + num(s.activeMin), 0)),
    };
    addTo(overhead.lead, leadShare);
    overhead.lead.dispatches--; // addTo counted a phantom dispatch for the parent
    roleAdd(line.role || 'session', leadShare, 0);
  }

  const cases = receipt.cases.map((c) => {
    const d = perCase.get(c.id) ?? { ...emptyBucket(), fixRounds: 0 };
    return {
      id: c.id, outcome: c.outcome ?? null,
      findings: Array.isArray(c.findings) ? c.findings.length : 0,
      direct: {
        costUsd: typeof d.costUsd === 'number' ? round2(d.costUsd) : null,
        tokens: Math.round(d.tokens), activeMin: Math.round(d.activeMin),
        dispatches: Math.round(d.dispatches * 100) / 100, fixRounds: Math.round(d.fixRounds * 100) / 100,
      },
    };
  });

  const attributed = cases.filter((c) => c.direct.dispatches > 0);
  const outcomes = {};
  for (const c of cases) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
  const delivered = num(outcomes.automated) + num(outcomes['merged-sanctioned-red']);
  const ohCost = num(overhead.lead.costUsd) + num(overhead.stage.costUsd);
  const ohPriced = typeof overhead.lead.costUsd === 'number' || typeof overhead.stage.costUsd === 'number';

  return {
    v: COST_VERSION, batch: slug, generatedAt: new Date().toISOString(),
    sources: { sessions: lines.length, hosts: [...hosts].sort(), users: [...users].sort(), costSources: [...costSources].sort(), models: [...models].sort() },
    totals: {
      costUsd: typeof totals.costUsd === 'number' ? round2(totals.costUsd) : null,
      tokens: Math.round(totals.tokens), tokensSplit, activeMin: Math.round(totals.activeMin),
      dispatches: totals.dispatches, sessions: totals.sessions,
    },
    byRole: Object.fromEntries([...byRole.entries()].sort().map(([r, b]) => [r, {
      tokens: Math.round(b.tokens), costUsd: typeof b.costUsd === 'number' ? round2(b.costUsd) : null,
      activeMin: Math.round(b.activeMin), dispatches: b.dispatches,
    }])),
    overhead: {
      note: 'batch-level work (lead thread, triage, gate, report) — shown once, never smeared into per-case rows',
      costUsd: ohPriced ? round2(ohCost) : null,
      sharePct: ohPriced && totals.costUsd ? Math.round((ohCost / totals.costUsd) * 100) : null,
      lead: { costUsd: typeof overhead.lead.costUsd === 'number' ? round2(overhead.lead.costUsd) : null, tokens: Math.round(overhead.lead.tokens), activeMin: Math.round(overhead.lead.activeMin) },
      stages: { costUsd: typeof overhead.stage.costUsd === 'number' ? round2(overhead.stage.costUsd) : null, tokens: Math.round(overhead.stage.tokens), activeMin: Math.round(overhead.stage.activeMin), dispatches: overhead.stage.dispatches },
    },
    outcomes, delivered,
    gate: receipt.gate ?? null,
    cases,
    stats: {
      note: 'over per-case DIRECT values, measured only — dollars present only where per-dispatch metering exists (Claude)',
      directCostUsd: pricedDirect ? money(stats(attributed.map((c) => c.direct.costUsd))) : null,
      directTokens: rounded(stats(attributed.map((c) => c.direct.tokens))),
      directActiveMin: rounded(stats(attributed.map((c) => c.direct.activeMin))),
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

/** Recompute cost.json for every batch (or one) this repo's ledger can see. */
export function updateBatchCosts(repo, { batch, write = true } = {}) {
  const receipts = loadReceipts(repo, { batch });
  if (!receipts.length) return [];
  const allLines = loadLines([repo]);
  const out = [];
  for (const { slug, dir, receipt } of receipts) {
    const cost = buildBatchCost(slug, receipt, allLines);
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
