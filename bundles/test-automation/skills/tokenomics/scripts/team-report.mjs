#!/usr/bin/env node
// team-report.mjs — assemble the team usage report from tokenomics ledgers.
//
//   node team-report.mjs [roots...] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//                        [--receipts <path>] [--json] [--out <file>]
//
// Each root may be a repo root (reads .agents/telemetry/automation/*.jsonl and joins
// .agents/automation/*/report.json receipts), a telemetry dir, or a single
// ledger file. Several roots = several repos rolled into one report — that is
// the whole point: every engineer's committed ledger lines merge through git,
// and this script turns them into "what did the team spend, and what did it
// deliver".
//
// DOLLAR HONESTY (same doctrine as efficiency-audit): only real figures are
// summed — ccusage-metered lines and Copilot's own billed credits. Sessions
// without a real figure are counted and labelled tokens-only, never estimated.
// Case counts come from the pipeline's own report.json receipts (`cases[]`
// with an `id` and an `outcome`), never from guessing at chat history.
//
// STDLIB ONLY. Read-only except --out.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateBatchCosts } from './batch-cost.mjs';

const DELIVERED = 'automated'; // the one receipts outcome that produced a spec

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- Loading -----------------------------------------------------------------
function ledgerFilesOf(root) {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return root.endsWith('.jsonl') ? [root] : [];
  for (const dir of [join(root, '.agents', 'telemetry', 'automation'), root]) {
    if (!existsSync(dir)) continue;
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    const files = names.filter((f) => /^usage.*\.jsonl$/.test(f)).map((f) => join(dir, f));
    if (files.length) return files;
  }
  return [];
}

export function loadLines(roots) {
  const lines = [];
  for (const root of roots) {
    for (const f of ledgerFilesOf(root)) {
      for (const raw of readFileSync(f, 'utf8').split('\n')) {
        if (!raw.trim()) continue;
        const rec = safeParse(raw);
        if (rec && rec.host && rec.id && typeof rec.v === 'number') lines.push(rec);
      }
    }
  }
  return lines;
}

/** One line per host:id — a resumed session gets re-captured; the latest wins. */
export function dedupLines(lines) {
  const byKey = new Map();
  const rank = (l) => [l.endedAt ? Date.parse(l.endedAt) : 0, l.capturedAt ? Date.parse(l.capturedAt) : 0];
  for (const l of lines) {
    const key = `${l.host}:${l.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, l); continue; }
    const [pe, pc] = rank(prev); const [ce, cc] = rank(l);
    if (ce > pe || (ce === pe && cc > pc)) byKey.set(key, l);
  }
  return [...byKey.values()];
}

const localDate = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Keep sessions involving a role — as the session's own agent OR among its
 * dispatched sub-agents. A report-time filter on purpose: capture always keeps
 * everything (a session filtered at capture would be lost once its transcript
 * expires); slicing is free here.
 */
export function filterRole(lines, role) {
  if (!role) return lines;
  return lines.filter((l) => l.role === role || (l.subagents ?? []).some((s) => s.role === role));
}

export function filterWindow(lines, since, until) {
  if (!since && !until) return lines;
  return lines.filter((l) => {
    const d = l.startedAt ? localDate(l.startedAt) : null;
    if (!d) return false;
    if (since && d < since) return false;
    if (until && d > until) return false;
    return true;
  });
}

/** ISO week label (e.g. 2026-W31) of a line's start. */
export function isoWeek(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const d = new Date(t);
  const thu = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// --- Receipts (cases) --------------------------------------------------------
function findReports(target) {
  if (!target || !existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  // Walk the WHOLE tree under the target: campaigns nest wave receipts in
  // sub-folders (.agents/automation/<batch>/<wave>/report.json — the campaign
  // workflow's own reportDir), so a one-level scan silently under-counts any
  // campaign that uses them. Same fix efficiency-audit's run-reports.mjs
  // carries (field-flagged twice, 2026-08-04 and 2026-08-06, before landing
  // there). Dirent.isDirectory() does not follow symlinks, so no link cycles.
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // underscore working dirs are not batches; 'telemetry' = legacy-layout defense
      if (entry.name === 'telemetry' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'report.json') out.push(p);
    }
  };
  walk(target);
  return out;
}

/** Latest outcome per case id across every receipt (re-entry folds to one row). */
export function loadCases(receiptDirs) {
  const reports = receiptDirs.flatMap(findReports)
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const latest = new Map();
  for (const { p } of reports) {
    const rep = safeParse(readFileSync(p, 'utf8'));
    for (const row of rep?.cases ?? []) {
      if (row?.id) latest.set(row.id, typeof row.outcome === 'string' && row.outcome ? row.outcome : 'not-started');
    }
  }
  const outcomes = {};
  for (const o of latest.values()) outcomes[o] = (outcomes[o] ?? 0) + 1;
  return { examined: latest.size, delivered: outcomes[DELIVERED] ?? 0, outcomes, reports: reports.length };
}

// --- Aggregation -------------------------------------------------------------
const addTok = (a, b) => {
  a.input += num(b?.input); a.output += num(b?.output);
  a.cacheRead += num(b?.cacheRead); a.cacheWrite += num(b?.cacheWrite);
};
const emptyTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** A line's full token footprint — parent + its sub-agents. */
export function lineTokens(l) {
  const t = emptyTok();
  addTok(t, l.tokens);
  for (const s of l.subagents ?? []) addTok(t, s.tokens);
  return t;
}

function bucket() {
  return { sessions: 0, costUsd: 0, priced: 0, tokens: emptyTok(), activeMin: 0, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0 };
}
function addLine(b, l) {
  b.sessions++;
  if (typeof l.costUsd === 'number') { b.costUsd += l.costUsd; b.priced++; }
  addTok(b.tokens, lineTokens(l));
  b.activeMin += num(l.activeMin); b.wallMin += num(l.wallMin);
  b.turns += num(l.turns); b.toolCalls += num(l.toolCalls); b.toolErrors += num(l.toolErrors);
}

export function buildReport(lines, cases) {
  const totals = bucket();
  const byPerson = new Map(); const byWeek = new Map(); const byHost = new Map();
  const byRole = new Map(); // tokens/time grain — dollars are session-grain and stay in totals
  const sources = new Map();
  const roleBucket = (role) => {
    if (!byRole.has(role)) byRole.set(role, { units: 0, tokens: emptyTok(), activeMin: 0, toolCalls: 0, toolErrors: 0 });
    return byRole.get(role);
  };
  for (const l of lines) {
    addLine(totals, l);
    for (const [map, key] of [[byPerson, l.user || 'unknown'], [byWeek, l.startedAt ? isoWeek(l.startedAt) : 'unknown'], [byHost, l.host]]) {
      if (!map.has(key)) map.set(key, bucket());
      addLine(map.get(key), l);
    }
    if (l.costSource && l.costSource !== 'none') sources.set(l.costSource, (sources.get(l.costSource) ?? 0) + 1);
    const parentRole = l.role || '(interactive session)';
    const pb = roleBucket(parentRole);
    pb.units++; addTok(pb.tokens, l.tokens);
    pb.activeMin += Math.max(0, num(l.activeMin) - (l.subagents ?? []).reduce((n, s) => n + num(s.activeMin), 0));
    pb.toolCalls += num(l.toolCalls); pb.toolErrors += num(l.toolErrors);
    for (const s of l.subagents ?? []) {
      const sb = roleBucket(s.role || 'unknown');
      sb.units += num(s.n) || 1; addTok(sb.tokens, s.tokens);
      sb.activeMin += num(s.activeMin); sb.toolCalls += num(s.toolCalls); sb.toolErrors += num(s.toolErrors);
    }
  }
  // Case ids mined from session names/branches/dispatch labels — which cases
  // each session TOUCHED (sessions per case, never dollars split per case: a
  // session covering five cases has one cost figure, not five).
  const byCase = new Map();
  for (const l of lines) {
    for (const c of l.cases ?? []) byCase.set(c, (byCase.get(c) ?? 0) + 1);
  }
  // Declared work scopes (work-scope.mjs) split spend by INTENT — the answer
  // to "how much of this window was automation work at all". Sessions without
  // a scope stay 'undeclared'; nothing is guessed.
  const byIntent = new Map();
  for (const l of lines) {
    const key = l.scope?.intent ?? 'undeclared';
    if (!byIntent.has(key)) byIntent.set(key, bucket());
    addLine(byIntent.get(key), l);
  }
  const ser = (m) => Object.fromEntries([...m.entries()]);
  return {
    sessions: lines.length,
    people: byPerson.size,
    totals,
    byCase: Object.fromEntries([...byCase.entries()].sort((a, z) => z[1] - a[1])),
    byIntent: ser(byIntent),
    costSources: ser(sources),
    tokensOnly: totals.sessions - totals.priced,
    byPerson: ser(byPerson), byRole: ser(byRole), byWeek: ser(byWeek), byHost: ser(byHost),
    cases,
    // Receipts aren't attributable to one role, so a role-filtered spend over
    // the full delivered count would be a wrong ratio — suppressed instead.
    perDelivered: cases && cases.delivered > 0 && !cases.roleFiltered ? {
      costUsd: totals.priced ? totals.costUsd / cases.delivered : null,
      activeMin: Math.round(totals.activeMin / cases.delivered),
      // Scope records make the honest denominator possible: only sessions that
      // DECLARED automation intent, so docs/other work stops inflating $/case.
      ...(byIntent.get('automation')?.priced ? { automationOnlyCostUsd: byIntent.get('automation').costUsd / cases.delivered } : {}),
    } : null,
    // The other denominator (efficiency-audit's pair): every case that entered
    // the pipeline consumed analysis, delivered or not — only this figure
    // admits what the non-delivered ones cost.
    perExamined: cases && cases.examined > 0 && !cases.roleFiltered ? {
      costUsd: totals.priced ? totals.costUsd / cases.examined : null,
    } : null,
    index: lines
      .map((l) => ({ host: l.host, id: l.id, user: l.user, role: l.role, startedAt: l.startedAt, costUsd: l.costUsd ?? null, cases: l.cases ?? [], ...(l.title ? { title: l.title } : {}) }))
      .sort((a, z) => String(a.startedAt).localeCompare(String(z.startedAt))),
  };
}

// --- Rendering ---------------------------------------------------------------
const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
const hours = (min) => `${(min / 60).toFixed(1)}h`;
const tokStr = (t) => `in ${t.input.toLocaleString()}, out ${t.output.toLocaleString()}, cache-read ${t.cacheRead.toLocaleString()}, cache-write ${t.cacheWrite.toLocaleString()}`;

export function renderMarkdown(rep, { window, label } = {}) {
  const t = rep.totals;
  const out = [`# Tokenomics — team usage report${label ? ` — ${label}` : ''}`, '',
    `Generated: ${new Date().toISOString()}${window ? `  ·  window: ${window}` : ''}`, ''];
  out.push('## Totals', '');
  out.push(`- Sessions: ${rep.sessions} (${Object.entries(rep.byHost).map(([h, b]) => `${h} ${b.sessions}`).join(', ')})  ·  people: ${rep.people}`);
  const src = Object.entries(rep.costSources).map(([s, n]) => `${s} ×${n}`).join(', ');
  out.push(`- Cost (real figures only): ${usd(t.priced ? t.costUsd : null)} from ${t.priced} priced session(s)${src ? ` (${src})` : ''}${rep.tokensOnly ? `  ·  ⚠️ ${rep.tokensOnly} session(s) tokens-only (no real dollar — never estimated)` : ''}`);
  out.push(`- Tokens (incl. sub-agents): total ${quadTotal(t.tokens).toLocaleString()}  ·  ${tokStr(t.tokens)}`);
  out.push(`- Real work: ${((t.tokens.input + t.tokens.output)).toLocaleString()} tokens (in+out)  ·  cache hit rate: ${(() => { const d = t.tokens.cacheRead + t.tokens.cacheWrite + t.tokens.input; return d ? `${((t.tokens.cacheRead / d) * 100).toFixed(1)}%` : 'n/a'; })()}`);
  out.push(`- Time: ${hours(t.activeMin)} active  ·  ${hours(t.wallMin)} wall  ·  ${t.turns} turns  ·  ${t.toolCalls} tool calls (${t.toolErrors} err)`);
  const caseIds = Object.keys(rep.byCase ?? {});
  if (caseIds.length) {
    out.push(`- Case ids named in sessions: ${caseIds.length} distinct (sessions-per-case in the --json \`byCase\`; top: ${caseIds.slice(0, 5).join(', ')})`);
  }
  const intents = Object.entries(rep.byIntent ?? {});
  if (intents.some(([k]) => k !== 'undeclared')) {
    out.push(`- By declared intent: ${intents.map(([k, b]) => `${k} ${usd(b.priced ? b.costUsd : null)} (${b.sessions})`).join('  ·  ')}`);
  }
  out.push('');
  if (rep.cases && rep.cases.reports) {
    out.push('## Cases (from the pipeline\'s own receipts)', '');
    const parts = Object.entries(rep.cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
    out.push(`- Examined: ${rep.cases.examined} unique case(s) across ${rep.cases.reports} report(s)  ·  **delivered (automated): ${rep.cases.delivered}**`);
    if (parts) out.push(`- Outcomes: ${parts}`);
    if (rep.perDelivered) {
      out.push(`- Per delivered case: ${usd(rep.perDelivered.costUsd)}  ·  ${rep.perDelivered.activeMin} active min${rep.perDelivered.automationOnlyCostUsd != null ? `  ·  **automation-intent spend only: ${usd(rep.perDelivered.automationOnlyCostUsd)}**` : ''}${rep.perExamined ? `  ·  per case examined: ${usd(rep.perExamined.costUsd)}` : ''}`);
      out.push('  (spend in the window ÷ delivered cases in the receipts — align the window to the batch for a per-batch figure)');
    }
    out.push('');
  }
  if (rep.byBatch?.length) {
    out.push('## By batch', '');
    out.push('| batch | cases | delivered | total | per delivered | active | gate | drift |', '|---|---|---|---|---|---|---|---|');
    for (const b of rep.byBatch) {
      out.push(`| ${b.batch} | ${b.cases} | ${b.delivered} | ${usd(b.costUsd)} | ${usd(b.perDelivered)} | ${hours(b.activeMin)} | ${b.gate ?? '—'} | ${b.drift ? '⚠️' : '—'} |`);
    }
    out.push('');
  }
  if (rep.perCase?.length) {
    const s4 = (st, f) => (st ? `avg ${f(st.avg)} · median ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)} (n=${st.n})` : 'n/a');
    out.push('## Per case — every batch\'s cost.json rows (delivered first)', '');
    if (rep.perCaseStats?.loadedCostUsd || rep.perCaseStats?.loadedActiveMin) {
      out.push(`- Delivered-case loaded cost: ${s4(rep.perCaseStats.loadedCostUsd, (x) => usd(x))}`);
      out.push(`- Delivered-case loaded time: ${s4(rep.perCaseStats.loadedActiveMin, (x) => `${Math.round(x)}m`)}`);
      out.push('  (loaded = direct measured work + an even share of the batch overhead — an allocation, labelled as such)', '');
    }
    out.push('| case | batch | outcome | direct | loaded | active (loaded) |', '|---|---|---|---|---|---|');
    for (const r of rep.perCase) {
      out.push(`| ${r.id} | ${r.batch} | ${r.outcome ?? '—'} | ${usd(r.direct.costUsd)} | ${usd(r.loaded?.costUsd)} | ${r.loaded?.activeMin ?? '—'}m |`);
    }
    out.push('');
  }
  const table = (title, entries, unitHeader = 'sessions') => {
    out.push(`## ${title}`, '', `| ${title.toLowerCase().replace('by ', '')} | cost | ${unitHeader} | tokens (in/out) | active | tools (err) |`, '|---|---|---|---|---|---|');
    for (const [k, b] of entries) {
      const units = b.sessions ?? b.units;
      out.push(`| ${k} | ${b.priced ? usd(b.costUsd) : (b.sessions === undefined ? '(session-grain)' : 'n/a')} | ${units} | ${b.tokens.input.toLocaleString()}/${b.tokens.output.toLocaleString()} | ${hours(b.activeMin)} | ${b.toolCalls} (${b.toolErrors}) |`);
    }
    out.push('');
  };
  table('By person', Object.entries(rep.byPerson).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0)));
  table('By role', Object.entries(rep.byRole).sort((a, z) => z[1].tokens.output - a[1].tokens.output), 'units');
  table('By week', Object.entries(rep.byWeek).sort(([a], [z]) => a.localeCompare(z)));
  out.push('_Dollars are session-grain (one figure per session, real sources only), so the role table reports tokens/time — sub-agent roles included. Fork/resume caveat: a forked session replays its parent\'s records; its ledger line can double-count the replayed tokens._');
  return out.join('\n');
}

// --- CLI ---------------------------------------------------------------------
// --- Batch mode (--batch <slug> | --batches) ---------------------------------
// Renders the per-batch cost view: what the batch delivered, what it cost, per
// case (direct, measured) and at batch level (overhead, once). The numbers come
// from batch-cost.mjs — the same recompute the capture hook runs, built fresh
// here so the report never trails the ledger.
// --- Token-economics helpers -------------------------------------------------
// The scalar token sum buries the story: ~95% of it is cache-read at ~1/10
// input price (field: a $16 batch showing "47.5M tokens"). Real work =
// input+output. Cache hit rate = cacheRead / (input + cacheWrite + cacheRead):
// the share of ALL prompt tokens replayed from cache versus processed fresh —
// cache WRITE is fresh processing (at 1.25× input price), so it belongs in
// the denominator. The naive cacheRead/(cacheRead+input) degenerates to ~100%
// on Claude Code (uncached input per request is a few tokens; measured: 775
// input across 18 turns) and discriminates nothing.
export const realWork = (t) => (t ? num(t.input) + num(t.output) : null);
export const cacheHitRate = (t) => {
  const denom = num(t?.cacheRead) + num(t?.cacheWrite) + num(t?.input);
  return denom ? num(t.cacheRead) / denom : null;
};
// What the cache BOUGHT: prompt cost without it (every token at 1× input
// price) vs as billed (input 1× + write 1.25× + read 0.1×). Complements the
// hit rate — "how often" vs "how much money it saved".
export const cacheSavings = (t) => {
  const would = num(t?.input) + num(t?.cacheWrite) + num(t?.cacheRead);
  if (!would) return null;
  const paid = num(t?.input) + num(t?.cacheWrite) * 1.25 + num(t?.cacheRead) * 0.1;
  return 1 - paid / would;
};
// Cost-weighted cache-read share at public list ratios — the spec's
// cache_read_share_pct semantics (a COST share, not the token share).
export const costShareOfCacheRead = (t) => {
  if (!t) return null;
  const total = num(t.input) + num(t.output) * 5 + num(t.cacheWrite) * 1.25 + num(t.cacheRead) * 0.1;
  return total ? Math.round(((num(t.cacheRead) * 0.1) / total) * 1000) / 10 : null;
};
const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const kTok = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n)));
const rwCell = (tokQuad, scalarFallback) =>
  tokQuad && (tokQuad.input || tokQuad.output || tokQuad.cacheRead)
    ? `${realWork(tokQuad).toLocaleString()} (in ${kTok(tokQuad.input)} / out ${kTok(tokQuad.output)})`
    : `${(scalarFallback ?? 0).toLocaleString()} (incl. cache)`;

export function renderBatchMarkdown(c) {
  const out = [`# Batch cost — ${c.batch}`, '',
    `Generated: ${c.generatedAt}  ·  sessions: ${c.sources.sessions} (${c.sources.hosts.join(', ') || 'none'})  ·  sources: ${c.sources.costSources.join(', ') || 'tokens only'}  ·  models: ${c.sources.models.join(', ') || '—'}`, ''];
  if (c.sources.liveSessions) out.push(`> ⏳ **LIVE / PROVISIONAL** — ${c.sources.liveSessions} session(s) still running. Finished dispatches are counted; their lead thread is not measured yet, so these totals are a **floor**. Re-run after the session ends.`, '');
  if (c.sources.sharedSessions) out.push(`_${c.sources.sharedSessions} session(s) also served other batches — their session-level figures are split evenly${c.sources.foreignDispatchesExcluded ? `; ${c.sources.foreignDispatchesExcluded} other-batch dispatch(es) excluded` : ''}._`, '');
  const oc = Object.entries(c.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
  out.push('## What happened', '');
  out.push(`- Cases: ${c.cases.length}  ·  **delivered: ${c.delivered}**${oc ? `  ·  ${oc}` : ''}`);
  if (c.gate) out.push(`- Gate: ${c.gate.verdict}${c.gate.runs ? ` (${c.gate.runs} runs)` : ''}`);
  if (c.records?.gateRuns) out.push(`- Gate record (script-authored): ${c.records.gateRuns.latest.verdict} at ${c.records.gateRuns.latest.at ?? '?'} (${c.records.gateRuns.count} run record(s))`);
  if (c.records?.gateDrift) out.push(`- ⚠️ **GATE DRIFT**: receipt says \`${c.records.gateDrift.receipt ?? 'not-run'}\` but the recorded verdict is \`${c.records.gateDrift.recorded}\` — write the verdict back into report.json`);
  if (c.records?.outcomeDrift?.length) out.push(`- ⚠️ **OUTCOME DRIFT** (${c.records.outcomeDrift.length}): ${c.records.outcomeDrift.map((d) => `${d.id} receipt=${d.receipt ?? '—'} declared=${d.declared}`).join('; ')} — reconcile report.json`);
  out.push(`- Findings reported: ${c.cases.reduce((n, x) => n + x.findings, 0)}  ·  fix rounds: ${c.cases.reduce((n, x) => n + x.direct.fixRounds, 0)}`, '');
  out.push('## What it cost', '');
  const ts = c.totals.tokensSplit;
  out.push(`- Total: ${usd(c.totals.costUsd)}  ·  ${hours(c.totals.activeMin)} active  ·  ${c.totals.dispatches} dispatches`);
  if (ts) {
    if (c.totals.tokensAttribution) out.push(`- ⚠️ **TOKEN TOTALS ARE A FLOOR** — attribution ${c.totals.tokensAttribution}: ${c.totals.unattributedUnits} unit(s) reported no usage (gateway pass-through gap); the real bill is higher.`);
    out.push(`- Tokens: total ${c.totals.tokens.toLocaleString()}  ·  **real work ${realWork(ts).toLocaleString()}** (in ${ts.input.toLocaleString()} / out ${ts.output.toLocaleString()})  ·  cache ${kTok(ts.cacheRead)} read / ${kTok(ts.cacheWrite)} write  ·  **cache hit rate ${pct(cacheHitRate(ts))}**  ·  see batch-tokenomics for the full breakdown`);
  } else {
    out.push(`- Tokens: ${c.totals.tokens.toLocaleString()} (incl. cache — re-run close for the split)`);
  }
  if (c.totals.toolCalls != null) out.push(`- Activity: ${c.totals.turns ?? '—'} turns  ·  ${c.totals.toolCalls} tool calls (${c.totals.toolErrors} err${c.totals.toolCalls ? `, ${Math.round((1 - c.totals.toolErrors / c.totals.toolCalls) * 100)}% ok` : ''})${c.totals.skills?.length ? `  ·  skills: ${c.totals.skills.join(', ')}` : ''}`);
  out.push(`- Overhead (lead + triage + gate + report, shown once): ${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` (${c.overhead.sharePct}%)` : ''}`);
  const bs = c.overhead.byStage;
  if (bs && Object.keys(bs).length) out.push(`  - by stage: lead ${usd(c.overhead.lead.costUsd)}${Object.entries(bs).map(([k, b]) => ` · ${k} ${usd(b.costUsd)} (${b.activeMin}m)`).join('')}`);
  if (c.rework) out.push(`- Rework (fix rounds — already inside per-case direct): ${usd(c.rework.costUsd)}  ·  ${c.rework.dispatches} dispatch(es)  ·  ${c.rework.activeMin}m`);
  if (c.averages.totalPerDelivered) out.push(`- **Per delivered case (incl. overhead): ${usd(c.averages.totalPerDelivered.costUsd)}**`);
  if (c.averages.directPerCase) out.push(`- Avg direct per case (excl. overhead): ${usd(c.averages.directPerCase.costUsd)}`);
  const s = c.stats;
  const line4 = (st, f = (x) => x) => st ? `avg ${f(st.avg)} · median ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)}` : null;
  if (s.directCostUsd) out.push(`- Direct cost spread: ${line4(s.directCostUsd, (x) => usd(x))}`);
  if (s.loadedCostUsd) out.push(`- Loaded cost spread (direct + even overhead share): ${line4(s.loadedCostUsd, (x) => usd(x))}`);
  if (s.directActiveMin) out.push(`- Active-time spread: ${line4(s.directActiveMin, (x) => `${x}m`)}${s.loadedActiveMin ? `  ·  loaded: ${line4(s.loadedActiveMin, (x) => `${x}m`)}` : ''}`);
  if (!s.directCostUsd && s.directTokens) out.push(`- Direct token spread (no per-dispatch dollars on this host): ${line4(s.directTokens, (x) => x.toLocaleString())}`);
  out.push('', '## Per case (direct = measured; loaded = direct + even overhead share, an allocation)', '');
  const sized = !!c.sizing;   // no scoping ran -> no size column at all
  const sz = (x) => (x.sizing ? `${x.sizing.size}${x.sizing.flag ? ' ⚠' : ''}` : '—');
  out.push(sized
    ? '| case | size | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |'
    : '| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |',
  sized ? '|---|---|---|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of c.cases) {
    out.push(`| ${x.id} | ${sized ? `${sz(x)} | ` : ''}${x.outcome ?? '—'} | ${usd(x.direct.costUsd)} | ${usd(x.loaded?.costUsd)} | ${rwCell(x.direct.tok, x.direct.tokens)} | ${x.direct.activeMin}m | ${x.loaded?.activeMin ?? '—'}m | ${x.direct.dispatches} | ${x.direct.toolCalls ?? '—'} (${x.direct.toolErrors ?? 0}) | ${x.direct.fixRounds} | ${x.findings} |`);
  }
  out.push('', '_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._');
  if (c.sizing) {
    out.push('', '## By size — predicted (automation-scoping) vs actual', '');
    out.push('| size | cases | ΣSP | est min | actual min | actual rw tok |', '|---|---|---|---|---|---|');
    for (const [k, b] of Object.entries(c.sizing.bySize)) out.push(`| ${k} | ${b.cases} | ${b.sp || '—'} | ${b.estMin || '—'} | ${b.actualMin} | ${b.actualTok.toLocaleString()} |`);
    if (c.sizing.estVsActualMin) out.push('', `**Estimate vs actual (batch grain): ${c.sizing.estVsActualMin.est}m predicted / ${c.sizing.estVsActualMin.actual}m actual — ×${c.sizing.estVsActualMin.ratio}.** Batch grain only: per-case dollars rank-correlate ~zero with predictions (scoping doctrine) — deviations below are tokens/time analysis pointers.`);
    for (const f of c.sizing.flagged) out.push(`- ⚠ **${f.id}** (${f.size}, ${f.flag}): ${f.detail}`);
  }
  const roles = Object.entries(c.byRole ?? {});
  if (roles.length) {
    out.push('', '## By role', '');
    out.push('| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |', '|---|---|---|---|---|---|---|');
    for (const [r, b] of roles.sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0))) {
      out.push(`| ${r} | ${usd(b.costUsd)} | ${b.dispatches} | ${rwCell(b.tok, b.tokens)} | ${b.tok ? pct(cacheHitRate(b.tok)) : '—'} | ${b.activeMin}m | ${b.toolCalls ?? '—'} (${b.toolErrors ?? 0}) |`);
    }
  }
  if (c.coverage.casesUnattributed.length) {
    out.push('', `Unattributed (no dispatch named them in any captured session): ${c.coverage.casesUnattributed.join(', ')}`);
  }
  return out.join('\n');
}

// ---- shared page chrome — ported from manual-qa's tokenomics page ----------
// Same design system (kpi cards / panels / stacked bars / legends, the same
// light-dark palette) so the two bundles' reports read as one family.
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const PAGE_CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--border:rgba(11,11,11,0.10);--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--warn:#c53030;--ok:#2f855a}
html[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#898781;--gridline:#2c2c2a;--border:rgba(255,255,255,0.10);--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--warn:#e06c6c;--ok:#48a06f}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,"Segoe UI",sans-serif;color:var(--text-primary);background:var(--page);max-width:1120px;margin:0 auto;padding:1.8rem 1.2rem 3rem}
h1{font-size:1.35rem;margin:0 0 .2rem}
.meta{color:var(--text-muted);font-size:.85rem;margin:0 0 1.1rem}
section{margin-top:1.1rem}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.8rem}
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;min-width:0}
.kpi-card h3{margin:0 0 .55rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .7rem}
.stat{display:flex;flex-direction:column;min-width:0}
.stat-label{font-size:.74rem;color:var(--text-secondary)}
.stat-sub{color:var(--text-muted);font-weight:400}
.stat-value{font-size:1.02rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.3;overflow-wrap:anywhere}
.stat-value-sm{font-size:.84rem;font-weight:500}
.kpi-callout{margin-top:.65rem;padding:.45rem .6rem;background:var(--page);border:1px solid var(--gridline);border-radius:7px;font-size:.81rem;color:var(--text-secondary)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;overflow-x:auto;min-width:0}
.panel h2{margin:0;font-size:1rem}
.panel-sub{margin:.15rem 0 .75rem;color:var(--text-muted);font-size:.84rem}
.stacked-bar{display:flex;height:18px;border-radius:5px;overflow:hidden;background:var(--gridline)}
.bar-seg{height:100%}
.s-in{background:var(--series-1)}.s-out{background:var(--series-2)}.s-cr{background:var(--series-3)}.s-cw{background:var(--series-4)}
.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.35rem 1rem;margin-top:.6rem}
.legend-item{display:flex;align-items:center;gap:.4rem;font-size:.82rem;min-width:0;flex-wrap:wrap}
.legend-swatch{width:10px;height:10px;border-radius:3px;flex:none}
.legend-label{color:var(--text-secondary)}
.legend-value{margin-left:auto;font-variant-numeric:tabular-nums}
.legend-pct{color:var(--text-muted)}
.row{display:grid;grid-template-columns:minmax(130px,210px) minmax(140px,1fr) minmax(200px,240px);gap:.7rem;align-items:center;margin:.32rem 0}
.row .lbl{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .track{background:var(--gridline);border-radius:4px;height:15px}
.row .bar{background:var(--series-1);height:15px;border-radius:4px}
.row .stacked{display:flex;overflow:hidden;height:15px;border-radius:4px}
.row .num{font-size:.84rem;font-variant-numeric:tabular-nums}
.sub{color:var(--text-muted)}
.oc{font-size:.72rem;border:1px solid var(--gridline);border-radius:8px;padding:0 .4rem;margin-left:.35rem;color:var(--text-muted);display:inline-block}
.oc-automated{color:var(--ok);border-color:var(--ok)}.oc-blocked{color:var(--warn);border-color:var(--warn)}
.callout-warn{margin-top:.8rem;color:var(--warn);border:1px solid var(--warn);border-radius:7px;padding:.5rem .7rem;font-size:.86rem;background:var(--surface)}
.note{color:var(--text-muted);font-size:.84rem}
table{border-collapse:collapse;width:100%;font-size:.87rem;margin:.4rem 0}
th{text-align:left;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td{border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-variant-numeric:tabular-nums}
.chip{font-size:.8rem;border:1px solid var(--gridline);border-radius:8px;padding:.1rem .5rem;margin-right:.4rem;color:var(--text-secondary);display:inline-block}
.share-cell{display:flex;align-items:center;gap:.45rem;min-width:140px}
.share-bar-track{flex:1;height:8px;border-radius:4px;background:var(--gridline);overflow:hidden}
.share-bar-fill{height:8px;border-radius:4px;background:var(--series-1)}
.share-bar-label{font-size:.8rem;color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:640px){.row{grid-template-columns:110px 1fr}.row .num{grid-column:1/-1}}
`;
const statCell = (label, value, small) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value${small ? ' stat-value-sm' : ''}">${value}</span></div>`;
const kpiCard = (title, cells, callout) => `<div class="kpi-card"><h3>${title}</h3><div class="kpi-grid">${cells.join('')}</div>${callout ? `<div class="kpi-callout">${callout}</div>` : ''}</div>`;
// One quad, four segments + a count-and-share legend (the manual-qa pattern:
// a share bar you can read without hovering).
const QUAD_SERIES = [
  ['input', 's-in', 'input · 1×'],
  ['output', 's-out', 'output'],
  ['cacheWrite', 's-cw', 'cache write · 1.25×'],
  ['cacheRead', 's-cr', 'cache read · 0.1×'],
];
const quadTotal = (tok) => num(tok?.input) + num(tok?.output) + num(tok?.cacheRead) + num(tok?.cacheWrite);
const quadBar = (tok) => {
  const total = quadTotal(tok);
  if (!total) return '<div class="stacked-bar"></div>';
  return `<div class="stacked-bar">${QUAD_SERIES.map(([k, cls, label]) =>
    num(tok[k]) > 0 ? `<div class="bar-seg ${cls}" style="flex:${Math.max((num(tok[k]) / total) * 100, 0.4)} 0 0" title="${label}: ${fmtInt(tok[k])} (${pct(num(tok[k]) / total)})"></div>` : '').join('')}</div>`;
};
const quadLegend = (tok) => {
  const total = quadTotal(tok) || 1;
  return `<div class="legend">${QUAD_SERIES.map(([k, cls, label]) => `<div class="legend-item"><span class="legend-swatch ${cls}"></span><span class="legend-label">${label}</span><span class="legend-value">${fmtInt(tok?.[k])} <span class="legend-pct">(${pct(num(tok?.[k]) / total)})</span></span></div>`).join('')}</div>`;
};

// Self-contained batch DELIVERY page — no external assets, light/dark aware.
// KPI cards up top (delivery / cost / tokens / activity — every headline number
// incl. the raw token total), then per-case bars with overhead drawn once.
export function renderBatchHtml(c) {
  const esc = escHtml;
  const priced = !!c.stats.directCostUsd;
  const val = (x) => (priced ? (x.direct.costUsd ?? 0) : x.direct.tokens);
  const fmtV = (v) => (priced ? `$${v.toFixed(2)}` : `${(v / 1000).toFixed(0)}k tok`);
  const max = Math.max(1, ...c.cases.map(val));
  const bars = c.cases.map((x) => `
    <div class="row"><div class="lbl" title="${esc(x.outcome)}">${esc(x.id)}<span class="oc oc-${esc(x.outcome)}">${esc(x.outcome ?? '')}</span></div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (val(x) / max) * 100)}%"></div></div>
    <div class="num">${fmtV(val(x))}<span class="sub"> · ${x.sizing ? `size ${esc(x.sizing.size)}${x.sizing.flag ? ' ⚠' : ''} · ` : ''}${x.loaded?.costUsd != null ? `loaded $${x.loaded.costUsd.toFixed(2)} · ` : ''}${x.direct.activeMin}m · ${x.direct.fixRounds ? `${x.direct.fixRounds} fix` : 'no fix'}${x.findings ? ` · ${x.findings} finding${x.findings > 1 ? 's' : ''}` : ''}</span></div></div>`).join('');
  const st = (s, f) => (s ? `avg ${f(s.avg)} · median ${f(s.median)} · min ${f(s.min)} · max ${f(s.max)}` : 'n/a');
  const oc = Object.entries(c.outcomes).map(([k, n]) => `<span class="oc oc-${esc(k)}">${esc(k)} ${n}</span>`).join(' ');
  const ts = c.totals.tokensSplit;
  const okPct = c.totals.toolCalls ? `${Math.round((1 - c.totals.toolErrors / c.totals.toolCalls) * 100)}% ok` : '';
  const cards = [
    kpiCard('Delivery', [
      statCell('Delivered / cases', `${c.delivered}/${c.cases.length}`),
      statCell(`Gate${c.gate?.runs ? ` <span class="stat-sub">(${c.gate.runs} runs)</span>` : ''}`, c.gate ? esc(c.gate.verdict) : 'n/a'),
      statCell('Fix rounds', fmtInt(c.cases.reduce((n, x) => n + x.direct.fixRounds, 0))),
      statCell('Findings', fmtInt(c.cases.reduce((n, x) => n + x.findings, 0))),
    ], oc),
    kpiCard('Cost', [
      statCell('Total <span class="stat-sub">measured</span>', usd(c.totals.costUsd)),
      statCell('Per delivered <span class="stat-sub">incl. overhead</span>', c.averages.totalPerDelivered ? usd(c.averages.totalPerDelivered.costUsd) : 'n/a'),
      statCell('Overhead <span class="stat-sub">lead+stages, once</span>', `${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` <span class="stat-sub">(${c.overhead.sharePct}%)</span>` : ''}`),
      c.rework ? statCell('Rework', usd(c.rework.costUsd)) : statCell('Avg direct / case', c.averages.directPerCase ? usd(c.averages.directPerCase.costUsd) : 'n/a'),
    ], c.overhead.byStage && Object.keys(c.overhead.byStage).length ? `by stage: lead ${usd(c.overhead.lead.costUsd)}${Object.entries(c.overhead.byStage).map(([k, b]) => ` · ${esc(k)} ${usd(b.costUsd)}`).join('')}` : null),
    kpiCard('Tokens', ts ? [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', fmtInt(c.totals.tokens)),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(ts))),
      statCell('Cache read', fmtInt(ts.cacheRead)),
      statCell('Cache hit rate', pct(cacheHitRate(ts))),
    ] : [statCell('Total <span class="stat-sub">incl. cache</span>', fmtInt(c.totals.tokens))],
    ts ? `cache write ${fmtInt(ts.cacheWrite)} · ~${pct(cacheSavings(ts))} of prompt cost saved by cache — composition in <strong>batch-tokenomics.html</strong>` : 're-run close for the token split'),
    kpiCard('Activity', [
      statCell('Turns', fmtInt(c.totals.turns)),
      statCell('Tool calls', c.totals.toolCalls != null ? `${fmtInt(c.totals.toolCalls)} <span class="stat-sub">(${c.totals.toolErrors} err${okPct ? `, ${okPct}` : ''})</span>` : '—'),
      statCell('Dispatches', fmtInt(c.totals.dispatches)),
      statCell('Active time', `${hours(c.totals.activeMin)}`),
    ], c.totals.skills?.length ? `skills: ${esc(c.totals.skills.join(', '))}` : null),
  ].join('');
  return `<!doctype html><meta charset="utf-8"><title>Batch cost — ${esc(c.batch)}</title><style>${PAGE_CSS}</style>
  <h1>Batch cost — ${esc(c.batch)}</h1>
  <p class="meta">Delivery view · generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) on ${esc(c.sources.hosts.join(', '))} · sources: ${esc(c.sources.costSources.join(', ') || 'tokens only')} · models: ${esc(c.sources.models.join(', ') || '—')}</p>
  <section class="kpi-row">${cards}</section>
  ${c.sources.liveSessions ? `<p class="callout-warn">⏳ LIVE / PROVISIONAL — ${c.sources.liveSessions} session(s) still running. Finished dispatches are counted; their lead thread is not measured yet, so these totals are a floor.</p>` : ''}
  ${c.sources.sharedSessions ? `<p class="note">${c.sources.sharedSessions} session(s) also served other batches — session-level figures split evenly${c.sources.foreignDispatchesExcluded ? `; ${c.sources.foreignDispatchesExcluded} other-batch dispatch(es) excluded` : ''}.</p>` : ''}
  ${c.records?.gateDrift ? `<p class="callout-warn">⚠ GATE DRIFT — receipt says '${esc(c.records.gateDrift.receipt ?? 'not-run')}' but the recorded verdict is '${esc(c.records.gateDrift.recorded)}' (${esc(c.records.gateDrift.at ?? '?')}): write the verdict back into report.json</p>` : ''}
  ${c.records?.outcomeDrift?.length ? `<p class="callout-warn">⚠ OUTCOME DRIFT — ${c.records.outcomeDrift.map((d) => `${esc(d.id)}: receipt=${esc(d.receipt ?? '—')} declared=${esc(d.declared)}`).join('; ')} — reconcile report.json</p>` : ''}
  <section class="panel"><h2>Per case — direct, measured${priced ? '' : ' (tokens: no per-dispatch dollars on this host)'}</h2>
  <p class="panel-sub">Batch overhead is NOT in these bars — it is the labelled figure above, shown once instead of smeared. Clustered cases are an even split of their shared dispatches.</p>
  ${bars}</section>
  <section class="panel"><h2>Spread</h2>
  <p>${priced ? `Direct cost: ${st(c.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}${c.stats.loadedCostUsd ? `Loaded cost (direct + even overhead share — allocation, not measurement): ${st(c.stats.loadedCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}Tokens: ${st(c.stats.directTokens, (x) => x.toLocaleString())}<br>Active time: ${st(c.stats.directActiveMin, (x) => `${x}m`)}${c.stats.loadedActiveMin ? ` · loaded: ${st(c.stats.loadedActiveMin, (x) => `${x}m`)}` : ''}</p></section>
  ${Object.keys(c.byRole ?? {}).length ? `<section class="panel"><h2>By role</h2>${(() => {
    const roles = Object.entries(c.byRole);
    const rmax = Math.max(1, ...roles.map(([, b]) => b.tokens));
    return roles.map(([r, b]) => `
    <div class="row"><div class="lbl">${esc(r)}</div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (b.tokens / rmax) * 100)}%"></div></div>
    <div class="num">${b.costUsd != null ? `$${b.costUsd.toFixed(2)}` : `${(b.tokens / 1e6).toFixed(1)}M tok`}<span class="sub"> · ${b.dispatches || '—'} disp · ${b.activeMin}m${b.toolCalls != null ? ` · ${b.toolCalls} tools (${b.toolErrors})` : ''}</span></div></div>`).join('');
  })()}</section>` : ''}
  ${c.sizing ? `<section class="panel"><h2>By size — predicted vs actual</h2>
  <p class="panel-sub">Pre-run size (automation-scoping) against actuals${c.sizing.estVsActualMin ? ` · batch grain: ${c.sizing.estVsActualMin.est}m predicted / ${c.sizing.estVsActualMin.actual}m actual (×${c.sizing.estVsActualMin.ratio})` : ''}. Deviations are tokens/time analysis pointers — never per-case dollar verdicts.</p>
  <table><tr><th>size</th><th>cases</th><th>ΣSP</th><th>est min</th><th>actual min</th><th>actual rw tok</th></tr>
  ${Object.entries(c.sizing.bySize).map(([k, b]) => `<tr><td>${esc(k)}</td><td>${b.cases}</td><td>${b.sp || '—'}</td><td>${b.estMin || '—'}</td><td>${b.actualMin}</td><td>${b.actualTok.toLocaleString()}</td></tr>`).join('')}</table>
  ${c.sizing.flagged.map((f) => `<p class="callout-warn">⚠ ${esc(f.id)} (${esc(f.size)}, ${esc(f.flag)}): ${esc(f.detail)}</p>`).join('')}</section>` : ''}
  ${c.coverage.casesUnattributed.length ? `<p class="note">Unattributed (no captured dispatch named them): ${esc(c.coverage.casesUnattributed.join(', '))}</p>` : ''}`;
}

// --- The TOKENOMICS view — the other unfolding of the same cost.json --------
// The batch report answers "what did delivery cost"; this answers "where did
// the tokens go and how well did the cache work" (same rhythm as manual-qa's
// Orchestrator-composition section): composition per bucket — real work
// (input+output) vs cache write vs cache read — plus the hit rate, so a huge
// raw token number reads correctly instead of alarmingly.
export function renderBatchTokenomicsMarkdown(c) {
  const ts = c.totals.tokensSplit;
  const out = [`# Batch tokenomics — ${c.batch}`, '',
    `Generated: ${c.generatedAt}  ·  sessions: ${c.sources.sessions}  ·  models: ${c.sources.models.join(', ') || '—'}  ·  companion of batch-report (delivery view)`, ''];
  if (!ts) { out.push('_No token split in this cost.json — regenerate it (work-scope close / batch-cost.mjs) with the current skill version._'); return out.join('\n'); }
  const total = ts.input + ts.output + ts.cacheRead + ts.cacheWrite;
  out.push('## Composition — where the tokens went', '');
  out.push('| kind | tokens | share | what it is |', '|---|---|---|---|');
  out.push(`| real work: input | ${ts.input.toLocaleString()} | ${pct(ts.input / total)} | fresh prompt tokens, full price |`);
  out.push(`| real work: output | ${ts.output.toLocaleString()} | ${pct(ts.output / total)} | generated tokens — the most expensive kind |`);
  out.push(`| cache write | ${ts.cacheWrite.toLocaleString()} | ${pct(ts.cacheWrite / total)} | context stored for reuse (~1.25× input price) |`);
  out.push(`| cache read | ${ts.cacheRead.toLocaleString()} | ${pct(ts.cacheRead / total)} | context replayed from cache (~0.1× input price) |`);
  out.push(`| **total** | **${total.toLocaleString()}** | 100% | raw sum — dominated by the cheapest kind |`);
  out.push('', `**Cache hit rate: ${pct(cacheHitRate(ts))}** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).`);
  out.push(`**Cache savings: ~${pct(cacheSavings(ts))} of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).`);
  {
    const share = costShareOfCacheRead(ts);
    if (share != null) out.push(`**Cache-read cost share: ~${share}% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.`);
  }
  const bm = c.totals.tokensByModel;
  if (bm && Object.keys(bm).length) {
    out.push('', '## By model', '', '| model | input | output | cache write | cache read | total |', '|---|---|---|---|---|---|');
    for (const [m, q0] of Object.entries(bm).sort((a, z) => num(z[1].output) - num(a[1].output))) {
      out.push(`| ${m} | ${num(q0.input).toLocaleString()} | ${num(q0.output).toLocaleString()} | ${kTok(q0.cacheWrite)} | ${kTok(q0.cacheRead)} | ${(num(q0.input) + num(q0.output) + num(q0.cacheRead) + num(q0.cacheWrite)).toLocaleString()} |`);
    }
  }
  out.push(`**Total: ${c.totals.tokens.toLocaleString()} tokens · ${usd(c.totals.costUsd)} · ${hours(c.totals.activeMin)} active · ${c.totals.dispatches} dispatches** — judge by composition and hit rate, not by the big number.`, '');
  const rowFor = (name, b) => `| ${name} | ${usd(b.costUsd)} | ${realWork(b.tok)?.toLocaleString() ?? '—'} | ${kTok(b.tok?.cacheWrite)} | ${kTok(b.tok?.cacheRead)} | ${b.tok ? pct(cacheHitRate(b.tok)) : '—'} |`;
  const roles = Object.entries(c.byRole ?? {}).filter(([, b]) => b.tok);
  if (roles.length) {
    out.push('## By role', '', '| role | cost | real work | cache write | cache read | hit rate |', '|---|---|---|---|---|---|');
    for (const [r, b] of roles.sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0))) out.push(rowFor(r, b));
    out.push('');
  }
  // The lead's share, decomposed — the e5aa3ba lesson: a big orchestrator
  // number is usually cache traffic, not runaway thinking; show which.
  const lead = c.overhead?.lead;
  if (lead?.tok) {
    out.push('## Orchestrator (lead thread) composition', '');
    out.push(`Lead: ${usd(lead.costUsd)}${c.overhead.sharePct != null ? ` — overhead incl. stages is ${c.overhead.sharePct}% of the batch` : ''} · real work ${realWork(lead.tok).toLocaleString()} · cache ${kTok(lead.tok.cacheRead)} read / ${kTok(lead.tok.cacheWrite)} write · hit rate ${pct(cacheHitRate(lead.tok))}`);
    out.push('A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.', '');
  }
  const stages = Object.entries(c.overhead?.byStage ?? {}).filter(([, b]) => b.tok);
  if (stages.length) {
    out.push('## By stage (overhead)', '', '| stage | cost | real work | cache write | cache read | hit rate |', '|---|---|---|---|---|---|');
    for (const [k, b] of stages) out.push(rowFor(k, b));
    out.push('');
  }
  if (c.sizing?.flagged?.length) {
    out.push('## Size-class deviations (analysis pointers)', '');
    for (const f of c.sizing.flagged) out.push(`- ⚠ **${f.id}** (${f.size}, ${f.flag}): ${f.detail}`);
    out.push('');
  }
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  if (cased.length) {
    out.push('## Per case (direct; clustered cases are an even split)', '', '| case | cost | input | output | cache write | cache read | total | hit rate | share |', '|---|---|---|---|---|---|---|---|---|');
    for (const x of cased) {
      const tk = x.direct.tok; const tot = tk.input + tk.output + tk.cacheRead + tk.cacheWrite;
      out.push(`| ${x.id} | ${usd(x.direct.costUsd)} | ${tk.input.toLocaleString()} | ${tk.output.toLocaleString()} | ${kTok(tk.cacheWrite)} | ${kTok(tk.cacheRead)} | ${tot.toLocaleString()} | ${pct(cacheHitRate(tk))} | ${pct(c.totals.tokens ? tot / c.totals.tokens : 0)} |`);
    }
  }
  return out.join('\n');
}

export function renderBatchTokenomicsHtml(c) {
  const esc = escHtml;
  const ts = c.totals.tokensSplit;
  const row = (name, b) => `
    <div class="row"><div class="lbl">${esc(name)}</div>${b.tok && quadTotal(b.tok) ? `<div class="stacked">${QUAD_SERIES.map(([k, cls, label]) =>
      num(b.tok[k]) > 0 ? `<div class="bar-seg ${cls}" style="flex:${Math.max((num(b.tok[k]) / quadTotal(b.tok)) * 100, 0.4)} 0 0" title="${label}: ${fmtInt(b.tok[k])}"></div>` : '').join('')}</div>` : '<div class="track"></div>'}
    <div class="num">${b.costUsd != null ? usd(b.costUsd) : '—'}<span class="sub"> · rw ${kTok(realWork(b.tok))} · hit ${b.tok ? pct(cacheHitRate(b.tok)) : '—'}</span></div></div>`;
  const roles = Object.entries(c.byRole ?? {}).filter(([, b]) => b.tok).sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0));
  const stages = Object.entries(c.overhead?.byStage ?? {}).filter(([, b]) => b.tok);
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  const lead = c.overhead?.lead;
  const okPct = c.totals.toolCalls ? `${Math.round((1 - c.totals.toolErrors / c.totals.toolCalls) * 100)}% ok` : '';
  const cachedShare = ts ? num(ts.cacheRead) / (quadTotal(ts) || 1) : null;
  const cards = ts ? [
    kpiCard('Cache', [
      statCell('Cache hit rate', pct(cacheHitRate(ts))),
      statCell('Prompt cost saved', `~${pct(cacheSavings(ts))}`),
      statCell('Total cost <span class="stat-sub">measured</span>', usd(c.totals.costUsd)),
      statCell('Active time', hours(c.totals.activeMin)),
    ], `a cache write is a STORED MISS (processed fresh at ~1.25×, kept for reuse); a read replays at ~0.1× input price${costShareOfCacheRead(ts) != null ? ` — cache-read ≈ ${costShareOfCacheRead(ts)}% of SPEND at public ratios` : ''}`),
    kpiCard('Tokens', [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', fmtInt(c.totals.tokens)),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(ts))),
      statCell('Input', fmtInt(ts.input)),
      statCell('Output', fmtInt(ts.output)),
      statCell('Cache read', fmtInt(ts.cacheRead)),
      statCell('Cache write', fmtInt(ts.cacheWrite)),
    ], `<strong>${pct(cachedShare)}</strong> of all tokens served from cache`),
    kpiCard('Activity', [
      statCell('Turns', fmtInt(c.totals.turns)),
      statCell('Tool calls', c.totals.toolCalls != null ? `${fmtInt(c.totals.toolCalls)} <span class="stat-sub">(${c.totals.toolErrors} err${okPct ? `, ${okPct}` : ''})</span>` : '—'),
      statCell('Dispatches', fmtInt(c.totals.dispatches)),
      statCell('Sessions', fmtInt(c.sources.sessions)),
    ], null),
  ].join('') : '';
  return `<!doctype html><meta charset="utf-8"><title>Batch tokenomics — ${esc(c.batch)}</title><style>${PAGE_CSS}</style>
  <h1>Batch tokenomics — ${esc(c.batch)}</h1>
  <p class="meta">The other unfolding of the same records as batch-report (delivery view) · generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) · models: ${esc(c.sources.models.join(', ') || '—')}</p>
  ${!ts ? '<p class="note">No token split in this cost.json — regenerate with the current skill version.</p>' : `
  <section class="kpi-row">${cards}</section>
  ${c.totals.tokensAttribution ? `<p class="callout-warn">⚠ Token totals are a FLOOR — attribution ${esc(c.totals.tokensAttribution)}: ${c.totals.unattributedUnits} unit(s) reported no usage (gateway pass-through gap). The real bill is higher.</p>` : ''}
  <section class="panel"><h2>Token composition</h2>
  <p class="panel-sub">Share of ${fmtInt(c.totals.tokens)} total tokens by type — the raw sum is dominated by the cheapest kind, so judge by composition and cache hit rate, not the big number.</p>
  ${quadBar(ts)}${quadLegend(ts)}</section>
  ${lead?.tok ? `<section class="panel"><h2>Orchestrator (lead thread) composition</h2>
  <p class="panel-sub">${usd(lead.costUsd)} · real work ${kTok(realWork(lead.tok))} · cache hit ${pct(cacheHitRate(lead.tok))}${c.overhead.sharePct != null ? ` · overhead incl. stages: ${c.overhead.sharePct}% of the batch` : ''}</p>
  ${quadBar(lead.tok)}${quadLegend(lead.tok)}
  <div class="kpi-callout">A high lead share with a high cache hit rate is orchestration working as designed — context replayed per turn from cache, not runaway spend.</div></section>` : ''}
  ${roles.length ? `<section class="panel"><h2>By role</h2><p class="panel-sub">Per-role composition; rw = real work (in+out), hit = cache hit rate.</p>${roles.map(([r, b]) => row(r, b)).join('')}</section>` : ''}
  ${stages.length ? `<section class="panel"><h2>By stage (overhead)</h2>${stages.map(([k, b]) => row(k, b)).join('')}</section>` : ''}
  ${c.totals.tokensByModel && Object.keys(c.totals.tokensByModel).length ? `<section class="panel"><h2>By model</h2>
  <p class="panel-sub">Per-model token split — what lets a mixed-tier run be re-priced (the dataset's tokens_by_model).</p>
  <table><tr><th>model</th><th>input</th><th>output</th><th>cache write</th><th>cache read</th><th>total</th></tr>
  ${Object.entries(c.totals.tokensByModel).sort((a, z) => num(z[1].output) - num(a[1].output)).map(([m, q0]) => `<tr><td>${esc(m)}</td><td>${fmtInt(q0.input)}</td><td>${fmtInt(q0.output)}</td><td>${fmtInt(q0.cacheWrite)}</td><td>${fmtInt(q0.cacheRead)}</td><td>${fmtInt(num(q0.input) + num(q0.output) + num(q0.cacheRead) + num(q0.cacheWrite))}</td></tr>`).join('')}</table></section>` : ''}
  ${cased.length ? `<section class="panel"><h2>Per case</h2><p class="panel-sub">Direct spend only; clustered cases are an even split of their shared dispatches. Share = of the batch's ${fmtInt(c.totals.tokens)} total tokens.</p>
  <table><tr><th>case</th><th>cost</th><th>input</th><th>output</th><th>cache write</th><th>cache read</th><th>total</th><th>hit rate</th><th>share</th></tr>
  ${cased.map((x) => {
    const tk = x.direct.tok; const tot = quadTotal(tk); const share = c.totals.tokens ? tot / c.totals.tokens : 0;
    return `<tr><td>${esc(x.id)}</td><td>${usd(x.direct.costUsd)}</td><td>${fmtInt(tk.input)}</td><td>${fmtInt(tk.output)}</td><td>${fmtInt(tk.cacheWrite)}</td><td>${fmtInt(tk.cacheRead)}</td><td>${fmtInt(tot)}</td><td>${pct(cacheHitRate(tk))}</td><td><div class="share-cell"><div class="share-bar-track"><div class="share-bar-fill" style="width:${Math.max(share * 100, 0.5)}%"></div></div><span class="share-bar-label">${pct(share)}</span></div></td></tr>`;
  }).join('')}</table></section>` : ''}`}`;
}

// Self-contained TEAM page — the whole ledger's rollup, same visual language
// as the batch page (no external assets, light/dark aware). Real dollars only,
// tokens-only sessions flagged, never estimated — same discipline as markdown.
export function renderTeamHtml(rep, { window, label } = {}) {
  const esc = escHtml;
  const t = rep.totals;
  const teamTotal = quadTotal(t.tokens);
  const tbl = (entries, cols, row) => entries.length
    ? `<table><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${entries.map(row).join('')}</table>` : '';
  const bucketRow = ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.priced ? usd(b.costUsd) : 'n/a'}</td><td>${b.sessions}</td><td>${b.tokens.output.toLocaleString()}</td><td>${hours(b.activeMin)}</td><td>${b.toolCalls} (${b.toolErrors})</td></tr>`;
  const intents = Object.entries(rep.byIntent ?? {});
  const cases = rep.cases;
  const okPct = t.toolCalls ? `${Math.round((1 - t.toolErrors / t.toolCalls) * 100)}% ok` : '';
  const cards = [
    kpiCard('Cost', [
      statCell('Real dollars <span class="stat-sub">never estimated</span>', usd(t.priced ? t.costUsd : null)),
      statCell('Priced sessions', `${t.priced}/${rep.sessions}`),
      rep.perDelivered ? statCell('Per delivered case', usd(rep.perDelivered.automationOnlyCostUsd ?? rep.perDelivered.costUsd)) : statCell('Per delivered case', 'n/a'),
      rep.perExamined ? statCell('Per case examined', usd(rep.perExamined.costUsd)) : statCell('People', fmtInt(rep.people)),
    ], rep.perDelivered?.automationOnlyCostUsd != null ? `automation-intent spend only; all-spend ${usd(rep.perDelivered.costUsd)}` : (Object.keys(rep.costSources ?? {}).length ? `sources: ${esc(Object.entries(rep.costSources).map(([s, n]) => `${s} ×${n}`).join(', '))}` : null)),
    kpiCard('Tokens <span class="stat-sub">incl. sub-agents</span>', [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', fmtInt(teamTotal)),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(t.tokens))),
      statCell('Cache read', fmtInt(t.tokens.cacheRead)),
      statCell('Cache hit rate', pct(cacheHitRate(t.tokens))),
    ], `in ${fmtInt(t.tokens.input)} · out ${fmtInt(t.tokens.output)} · cache write ${fmtInt(t.tokens.cacheWrite)}`),
    ...(cases?.reports ? [kpiCard('Delivery <span class="stat-sub">receipts</span>', [
      statCell('delivered / examined', `${cases.delivered}/${cases.examined}`),
      statCell('Reports', fmtInt(cases.reports)),
      statCell('Batches', fmtInt(rep.byBatch?.length ?? 0)),
      statCell('Sessions · people', `${rep.sessions} · ${rep.people}`),
    ], Object.entries(cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(k)} ${n}</span>`).join(''))] : []),
    kpiCard('Activity', [
      statCell('Active', `${hours(t.activeMin)} <span class="stat-sub">(${hours(t.wallMin)} wall)</span>`),
      statCell('Turns', fmtInt(t.turns)),
      statCell('Tool calls', `${fmtInt(t.toolCalls)} <span class="stat-sub">(${t.toolErrors} err${okPct ? `, ${okPct}` : ''})</span>`),
      statCell('Hosts', esc(Object.entries(rep.byHost).map(([h, b]) => `${h} ${b.sessions}`).join(', ')) || '—'),
    ], null),
  ].join('');
  return `<!doctype html><meta charset="utf-8"><title>Tokenomics — team report${label ? ` — ${esc(label)}` : ''}</title><style>${PAGE_CSS}</style>
  <h1>Tokenomics — team usage report${label ? ` — ${esc(label)}` : ''}</h1>
  <p class="meta">Generated ${esc(new Date().toISOString())}${window ? ` · window: ${esc(window)}` : ''} · ${rep.sessions} session(s) · ${rep.people} person(s) · ${Object.entries(rep.byHost).map(([h, b]) => `${esc(h)} ${b.sessions}`).join(', ')}</p>
  <section class="kpi-row">${cards}</section>
  ${rep.tokensOnly ? `<p class="callout-warn">⚠ ${rep.tokensOnly} session(s) tokens-only — no real dollar, never estimated.</p>` : ''}
  ${intents.some(([k]) => k !== 'undeclared') ? `<section class="panel"><h2>By declared intent</h2><p>${intents.map(([k, b]) => `<span class="chip">${esc(k)}: ${b.priced ? usd(b.costUsd) : 'n/a'} (${b.sessions})</span>`).join('')}</p></section>` : ''}
  ${rep.byBatch?.length ? `<section class="panel"><h2>By batch</h2>
  <table><tr><th>batch</th><th>cases</th><th>delivered</th><th>total</th><th>per delivered</th><th>active</th><th>gate</th><th>drift</th></tr>
  ${rep.byBatch.map((b) => `<tr><td>${esc(b.batch)}</td><td>${b.cases}</td><td>${b.delivered}</td><td>${usd(b.costUsd)}</td><td>${usd(b.perDelivered)}</td><td>${hours(b.activeMin)}</td><td>${esc(b.gate ?? '—')}</td><td>${b.drift ? '⚠️' : '—'}</td></tr>`).join('')}</table></section>` : ''}
  ${rep.perCase?.length ? `<section class="panel"><h2>Per case — cost.json rows across batches (delivered first)</h2>
  ${rep.perCaseStats?.loadedCostUsd ? `<p class="panel-sub">Delivered-case loaded cost: avg ${usd(rep.perCaseStats.loadedCostUsd.avg)} · median ${usd(rep.perCaseStats.loadedCostUsd.median)} · min ${usd(rep.perCaseStats.loadedCostUsd.min)} · max ${usd(rep.perCaseStats.loadedCostUsd.max)} (n=${rep.perCaseStats.loadedCostUsd.n}). Loaded = direct + even overhead share — allocation, not measurement.</p>` : ''}
  <table><tr><th>case</th><th>batch</th><th>outcome</th><th>direct</th><th>loaded</th><th>active (loaded)</th></tr>
  ${rep.perCase.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.batch)}</td><td>${esc(r.outcome ?? '—')}</td><td>${usd(r.direct.costUsd)}</td><td>${usd(r.loaded?.costUsd)}</td><td>${r.loaded?.activeMin ?? '—'}m</td></tr>`).join('')}</table></section>` : ''}
  <section class="panel"><h2>By person</h2>${tbl(Object.entries(rep.byPerson).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0)), ['person', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}</section>
  <section class="panel"><h2>By role</h2><p class="panel-sub">Dollars are session-grain, so roles report tokens/time — sub-agent roles included.</p>
  ${tbl(Object.entries(rep.byRole).sort((a, z) => z[1].tokens.output - a[1].tokens.output), ['role', 'units', 'out tokens', 'active', 'tools (err)'],
    ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.units}</td><td>${b.tokens.output.toLocaleString()}</td><td>${hours(b.activeMin)}</td><td>${b.toolCalls} (${b.toolErrors})</td></tr>`)}</section>
  <section class="panel"><h2>By week</h2>${tbl(Object.entries(rep.byWeek).sort(([a], [z]) => a.localeCompare(z)), ['week', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}</section>`;
}

export function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.set('json', true);
    else if (a === '--html') flags.set('html', true);
    else if (a === '--tokenomics') flags.set('tokenomics', true);
    else if (a === '--batches') flags.set('batch', '*');
    else if (a === '--since' || a === '--until' || a === '--out' || a === '--receipts' || a === '--label' || a === '--role' || a === '--batch') flags.set(a.slice(2), argv[++i]);
    else roots.push(resolve(a));
  }
  if (!roots.length) roots.push(process.cwd());
  if (flags.get('batch')) {
    // Batch mode is per-repo (receipts live in the repo) — first root wins.
    const batch = flags.get('batch') === '*' ? undefined : flags.get('batch');
    const results = updateBatchCosts(roots[0], { batch, write: true });
    if (!results.length) { process.stderr.write(`team-report: no receipts${batch ? ` for batch '${batch}'` : ''} under ${join(roots[0], '.agents', 'automation')}\n`); return 1; }
    const mdR = flags.get('tokenomics') ? renderBatchTokenomicsMarkdown : renderBatchMarkdown;
    const htmlR = flags.get('tokenomics') ? renderBatchTokenomicsHtml : renderBatchHtml;
    const output = flags.get('json')
      ? JSON.stringify(results.length === 1 ? results[0] : results, null, 2)
      : flags.get('html')
        ? results.map(htmlR).join('\n')
        : results.map(mdR).join('\n\n---\n\n');
    if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
    else process.stdout.write(`${output}\n`);
    return 0;
  }
  const lines = filterRole(
    filterWindow(dedupLines(loadLines(roots)), flags.get('since'), flags.get('until')),
    flags.get('role'),
  );
  const receiptDirs = flags.get('receipts')
    ? [resolve(flags.get('receipts'))]
    : roots.map((r) => join(r, '.agents', 'automation'));
  const cases = { ...loadCases(receiptDirs), ...(flags.get('role') ? { roleFiltered: true } : {}) };
  const rep = buildReport(lines, cases);
  // Cross-batch per-case rollup: every batch's cost.json rows (direct measured
  // + loaded allocation), delivered first — the "which cases, at what cost"
  // list. Pure recompute, never fails the report over a bad receipt.
  try {
    // Ledger-only: this is a period rollup and its totals above come straight
    // from the ledger, so the batch/case tables must not mix in provisional
    // numbers from sessions that are still running. `--batch` (the live view)
    // keeps them.
    const batchCosts = roots.flatMap((r) => updateBatchCosts(r, { write: false, live: false }));
    if (batchCosts.length) {
      rep.byBatch = batchCosts.map((c) => ({
        batch: c.batch, cases: c.cases.length, delivered: c.delivered,
        costUsd: c.totals.costUsd, activeMin: c.totals.activeMin,
        perDelivered: c.averages.totalPerDelivered?.costUsd ?? null,
        gate: c.gate?.verdict ?? null,
        drift: !!(c.records?.gateDrift || c.records?.outcomeDrift?.length),
      }));
    }
    const perCase = batchCosts
      .flatMap((c) => c.cases.map((x) => ({ batch: c.batch, id: x.id, outcome: x.outcome, direct: x.direct, loaded: x.loaded })));
    const isDelivered = (o) => o === 'automated' || o === 'merged-sanctioned-red';
    perCase.sort((a, z) => (isDelivered(z.outcome) - isDelivered(a.outcome)) || ((z.loaded?.costUsd ?? 0) - (a.loaded?.costUsd ?? 0)));
    if (perCase.length) {
      rep.perCase = perCase;
      const vals = (rows, f) => rows.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
      const st = (v) => (v.length ? { avg: v.reduce((a, x) => a + x, 0) / v.length, median: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2, min: v[0], max: v[v.length - 1], n: v.length } : null);
      const delivered = perCase.filter((r) => isDelivered(r.outcome));
      rep.perCaseStats = {
        note: 'over DELIVERED cases; loaded = direct + even batch-overhead share (allocation)',
        loadedCostUsd: st(vals(delivered, (r) => r.loaded?.costUsd)),
        loadedActiveMin: st(vals(delivered, (r) => r.loaded?.activeMin)),
      };
    }
  } catch { /* receipts absent or malformed — the report stands without the case list */ }
  const windowLabel = [
    [flags.get('since'), flags.get('until')].filter(Boolean).join(' → ') || null,
    flags.get('role') ? `role: ${flags.get('role')}` : null,
  ].filter(Boolean).join('  ·  ') || null;
  const output = flags.get('json')
    ? JSON.stringify({ generated: new Date().toISOString(), window: windowLabel, ...rep }, null, 2)
    : flags.get('html')
      ? renderTeamHtml(rep, { window: windowLabel, label: flags.get('label') })
      : renderMarkdown(rep, { window: windowLabel, label: flags.get('label') });
  if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
  else process.stdout.write(`${output}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
