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
  out.push(`- Tokens (incl. sub-agents): ${tokStr(t.tokens)}`);
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
    out.push(`- Tokens: **real work ${realWork(ts).toLocaleString()}** (in ${ts.input.toLocaleString()} / out ${ts.output.toLocaleString()})  ·  cache ${kTok(ts.cacheRead)} read / ${kTok(ts.cacheWrite)} write  ·  **cache hit rate ${pct(cacheHitRate(ts))}**  ·  see batch-tokenomics for the full breakdown`);
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
  out.push('| case | outcome | direct cost | loaded | real-work tok | active | loaded act. | dispatches | tools (err) | fix rounds | findings |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of c.cases) {
    out.push(`| ${x.id} | ${x.outcome ?? '—'} | ${usd(x.direct.costUsd)} | ${usd(x.loaded?.costUsd)} | ${rwCell(x.direct.tok, x.direct.tokens)} | ${x.direct.activeMin}m | ${x.loaded?.activeMin ?? '—'}m | ${x.direct.dispatches} | ${x.direct.toolCalls ?? '—'} (${x.direct.toolErrors ?? 0}) | ${x.direct.fixRounds} | ${x.findings} |`);
  }
  out.push('', '_Cases analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-case measurement (fractional `dispatches` marks them)._');
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

// Self-contained batch page — no external assets, light/dark aware. The bar
// chart is plain divs: direct cost (or tokens where dollars don't exist on the
// host) per case, with overhead drawn once as its own labelled band.
export function renderBatchHtml(c) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const priced = !!c.stats.directCostUsd;
  const val = (x) => (priced ? (x.direct.costUsd ?? 0) : x.direct.tokens);
  const fmtV = (v) => (priced ? `$${v.toFixed(2)}` : `${(v / 1000).toFixed(0)}k tok`);
  const max = Math.max(1, ...c.cases.map(val));
  const bars = c.cases.map((x) => `
    <div class="row"><div class="lbl" title="${esc(x.outcome)}">${esc(x.id)}<span class="oc oc-${esc(x.outcome)}">${esc(x.outcome ?? '')}</span></div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (val(x) / max) * 100)}%"></div></div>
    <div class="num">${fmtV(val(x))}<span class="sub"> · ${x.loaded?.costUsd != null ? `loaded $${x.loaded.costUsd.toFixed(2)} · ` : ''}${x.direct.activeMin}m · ${x.direct.fixRounds ? `${x.direct.fixRounds} fix` : 'no fix'}${x.findings ? ` · ${x.findings} finding${x.findings > 1 ? 's' : ''}` : ''}</span></div></div>`).join('');
  const st = (s, f) => (s ? `avg ${f(s.avg)} · median ${f(s.median)} · min ${f(s.min)} · max ${f(s.max)}` : 'n/a');
  const oc = Object.entries(c.outcomes).map(([k, n]) => `<span class="oc oc-${esc(k)}">${esc(k)} ${n}</span>`).join(' ');
  return `<!doctype html><meta charset="utf-8"><title>Batch cost — ${esc(c.batch)}</title><style>
  :root{--fg:#1a1a1a;--dim:#666;--line:#ddd;--bg:#fff;--accent:#2b6cb0;--band:#f3f4f6}
  @media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--dim:#9a9a9a;--line:#333;--bg:#151515;--accent:#63a4e0;--band:#1f2937}}
  body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg);max-width:920px;margin:2rem auto;padding:0 1rem}
  h1{font-size:1.3rem} h2{font-size:1.05rem;margin-top:1.6rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
  .k{display:inline-block;margin:.2rem 1.2rem .2rem 0}.k b{font-size:1.25rem}.k span{color:var(--dim);font-size:.85rem;display:block}
  .row{display:grid;grid-template-columns:220px 1fr 220px;gap:.6rem;align-items:center;margin:.25rem 0}
  .lbl{font-family:ui-monospace,monospace;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .track{background:var(--band);border-radius:3px;height:14px}.bar{background:var(--accent);height:14px;border-radius:3px}
  .num{font-size:.85rem}.sub{color:var(--dim)}
  .oc{font-size:.72rem;border:1px solid var(--line);border-radius:8px;padding:0 .4rem;margin-left:.35rem;color:var(--dim)}
  .oc-automated{color:#2f855a;border-color:#2f855a}.oc-blocked{color:#c53030;border-color:#c53030}
  .note{color:var(--dim);font-size:.85rem}
  .drift{color:#c53030;border:1px solid #c53030;border-radius:4px;padding:.4rem .6rem;font-size:.9rem}</style>
  <h1>Batch cost — ${esc(c.batch)}</h1>
  <p class="note">Generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) on ${esc(c.sources.hosts.join(', '))} · sources: ${esc(c.sources.costSources.join(', ') || 'tokens only')}</p>
  <div><span class="k"><b>${usd(c.totals.costUsd)}</b><span>total (measured)</span></span>
  <span class="k"><b>${c.delivered}/${c.cases.length}</b><span>delivered / cases</span></span>
  <span class="k"><b>${c.averages.totalPerDelivered ? usd(c.averages.totalPerDelivered.costUsd) : 'n/a'}</b><span>per delivered (incl. overhead)</span></span>
  <span class="k"><b>${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` (${c.overhead.sharePct}%)` : ''}</b><span>overhead: lead + triage + gate + report</span></span>
  <span class="k"><b>${c.gate ? esc(c.gate.verdict) : 'n/a'}</b><span>gate${c.gate?.runs ? ` (${c.gate.runs} runs)` : ''}</span></span>
  ${c.rework ? `<span class="k"><b>${usd(c.rework.costUsd)}</b><span>rework (${c.rework.dispatches} fix dispatch(es))</span></span>` : ''}</div>
  ${c.totals.toolCalls != null ? `<p class="note">${c.totals.turns ?? '—'} turns · ${c.totals.toolCalls} tool calls (${c.totals.toolErrors} err)${c.totals.skills?.length ? ` · skills: ${esc(c.totals.skills.join(', '))}` : ''}${c.overhead.byStage && Object.keys(c.overhead.byStage).length ? ` · overhead by stage: lead ${usd(c.overhead.lead.costUsd)}${Object.entries(c.overhead.byStage).map(([k, b]) => ` / ${esc(k)} ${usd(b.costUsd)}`).join('')}` : ''}</p>` : ''}
  ${c.sources.liveSessions ? `<p class="drift">⏳ LIVE / PROVISIONAL — ${c.sources.liveSessions} session(s) still running. Finished dispatches are counted; their lead thread is not measured yet, so these totals are a floor.</p>` : ''}
  ${c.sources.sharedSessions ? `<p class="note">${c.sources.sharedSessions} session(s) also served other batches — session-level figures split evenly${c.sources.foreignDispatchesExcluded ? `; ${c.sources.foreignDispatchesExcluded} other-batch dispatch(es) excluded` : ''}.</p>` : ''}
  <p>${oc}</p>
  ${c.records?.gateDrift ? `<p class="drift">⚠ GATE DRIFT — receipt says '${esc(c.records.gateDrift.receipt ?? 'not-run')}' but the recorded verdict is '${esc(c.records.gateDrift.recorded)}' (${esc(c.records.gateDrift.at ?? '?')}): write the verdict back into report.json</p>` : ''}
  ${c.records?.outcomeDrift?.length ? `<p class="drift">⚠ OUTCOME DRIFT — ${c.records.outcomeDrift.map((d) => `${esc(d.id)}: receipt=${esc(d.receipt ?? '—')} declared=${esc(d.declared)}`).join('; ')} — reconcile report.json</p>` : ''}
  <h2>Per case — direct, measured${priced ? '' : ' (tokens: no per-dispatch dollars on this host)'}</h2>
  <p class="note">Batch overhead is NOT in these bars — it is the labelled figure above, shown once instead of smeared.</p>
  ${bars}
  <h2>Spread</h2>
  <p>${priced ? `Direct cost: ${st(c.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}${c.stats.loadedCostUsd ? `Loaded cost (direct + even overhead share — allocation, not measurement): ${st(c.stats.loadedCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}Tokens: ${st(c.stats.directTokens, (x) => x.toLocaleString())}<br>Active time: ${st(c.stats.directActiveMin, (x) => `${x}m`)}${c.stats.loadedActiveMin ? ` · loaded: ${st(c.stats.loadedActiveMin, (x) => `${x}m`)}` : ''}</p>
  ${Object.keys(c.byRole ?? {}).length ? `<h2>By role</h2>${(() => {
    const roles = Object.entries(c.byRole);
    const rmax = Math.max(1, ...roles.map(([, b]) => b.tokens));
    return roles.map(([r, b]) => `
    <div class="row"><div class="lbl">${esc(r)}</div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (b.tokens / rmax) * 100)}%"></div></div>
    <div class="num">${b.costUsd != null ? `$${b.costUsd.toFixed(2)}` : `${(b.tokens / 1e6).toFixed(1)}M tok`}<span class="sub"> · ${b.dispatches || '—'} disp · ${b.activeMin}m${b.toolCalls != null ? ` · ${b.toolCalls} tools (${b.toolErrors})` : ''}</span></div></div>`).join('');
  })()}` : ''}
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
  out.push('', `**Cache hit rate: ${pct(cacheHitRate(ts))}** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).`);
  out.push(`**Cache savings: ~${pct(cacheSavings(ts))} of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).`);
  out.push(`Raw total ${c.totals.tokens.toLocaleString()} tokens · ${usd(c.totals.costUsd)} — the raw sum is dominated by the cheapest kind; judge by composition, not by the big number.`, '');
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
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  if (cased.length) {
    out.push('## Per case (direct; clustered cases are an even split)', '', '| case | cost | real work | cache read | hit rate |', '|---|---|---|---|---|');
    for (const x of cased) out.push(`| ${x.id} | ${usd(x.direct.costUsd)} | ${realWork(x.direct.tok).toLocaleString()} | ${kTok(x.direct.tok.cacheRead)} | ${pct(cacheHitRate(x.direct.tok))} |`);
  }
  return out.join('\n');
}

export function renderBatchTokenomicsHtml(c) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const ts = c.totals.tokensSplit;
  const stack = (tok) => {
    const total = num(tok?.input) + num(tok?.output) + num(tok?.cacheRead) + num(tok?.cacheWrite);
    if (!total) return '<div class="track"></div>';
    const seg = (v, cls, label) => (v > 0 ? `<div class="seg ${cls}" style="width:${Math.max(0.5, (v / total) * 100)}%" title="${label}: ${v.toLocaleString()}"></div>` : '');
    return `<div class="track stacked">${seg(tok.output, 's-out', 'output')}${seg(tok.input, 's-in', 'input')}${seg(tok.cacheWrite, 's-cw', 'cache write')}${seg(tok.cacheRead, 's-cr', 'cache read')}</div>`;
  };
  const row = (name, b) => `
    <div class="row"><div class="lbl">${esc(name)}</div>${stack(b.tok)}
    <div class="num">${b.costUsd != null ? usd(b.costUsd) : '—'}<span class="sub"> · rw ${kTok(realWork(b.tok))} · hit ${b.tok ? pct(cacheHitRate(b.tok)) : '—'}</span></div></div>`;
  const roles = Object.entries(c.byRole ?? {}).filter(([, b]) => b.tok).sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0));
  const stages = Object.entries(c.overhead?.byStage ?? {}).filter(([, b]) => b.tok);
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  return `<!doctype html><meta charset="utf-8"><title>Batch tokenomics — ${esc(c.batch)}</title><style>
  :root{--fg:#1a1a1a;--dim:#666;--line:#ddd;--bg:#fff;--band:#f3f4f6;--out:#c05621;--in:#2b6cb0;--cw:#6b46c1;--cr:#9ae6b4}
  @media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--dim:#9a9a9a;--line:#333;--bg:#151515;--band:#1f2937;--out:#ed8936;--in:#63a4e0;--cw:#9f7aea;--cr:#2f855a}}
  body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg);max-width:920px;margin:2rem auto;padding:0 1rem}
  h1{font-size:1.3rem} h2{font-size:1.05rem;margin-top:1.6rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
  .k{display:inline-block;margin:.2rem 1.2rem .2rem 0}.k b{font-size:1.25rem}.k span{color:var(--dim);font-size:.85rem;display:block}
  .row{display:grid;grid-template-columns:200px 1fr 240px;gap:.6rem;align-items:center;margin:.3rem 0}
  .lbl{font-family:ui-monospace,monospace;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .track{background:var(--band);border-radius:3px;height:16px}.stacked{display:flex;overflow:hidden}
  .seg{height:16px}.s-out{background:var(--out)}.s-in{background:var(--in)}.s-cw{background:var(--cw)}.s-cr{background:var(--cr)}
  .num{font-size:.85rem}.sub{color:var(--dim)}.note{color:var(--dim);font-size:.85rem}
  .legend span{display:inline-block;margin-right:1rem;font-size:.82rem}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.3rem}</style>
  <h1>Batch tokenomics — ${esc(c.batch)}</h1>
  <p class="note">The other unfolding of the same records as batch-report (delivery view). Generated ${esc(c.generatedAt)} · models: ${esc(c.sources.models.join(', ') || '—')}</p>
  ${!ts ? '<p class="note">No token split in this cost.json — regenerate with the current skill version.</p>' : `
  <div><span class="k"><b>${pct(cacheHitRate(ts))}</b><span>cache hit rate</span></span>
  <span class="k"><b>~${pct(cacheSavings(ts))}</b><span>prompt cost saved by cache</span></span>
  <span class="k"><b>${kTok(realWork(ts))}</b><span>real work (in ${kTok(ts.input)} / out ${kTok(ts.output)})</span></span>
  <span class="k"><b>${kTok(ts.cacheRead)}</b><span>cache read (~0.1× input price)</span></span>
  <span class="k"><b>${kTok(ts.cacheWrite)}</b><span>cache write (~1.25× input price)</span></span>
  <span class="k"><b>${usd(c.totals.costUsd)}</b><span>total cost</span></span></div>
  <p class="legend"><span><i style="background:var(--out)"></i>output</span><span><i style="background:var(--in)"></i>input</span><span><i style="background:var(--cw)"></i>cache write</span><span><i style="background:var(--cr)"></i>cache read</span></p>
  <h2>Total composition</h2>${row('whole batch', { tok: ts, costUsd: c.totals.costUsd })}
  <p class="note">The raw sum (${c.totals.tokens.toLocaleString()} tokens) is dominated by the cheapest kind — judge by composition and hit rate, not the big number.</p>
  ${c.overhead?.lead?.tok ? `<h2>Orchestrator (lead thread)</h2>${row('lead', c.overhead.lead)}
  <p class="note">A high lead share with a high hit rate is orchestration working as designed — context replayed per turn from cache, not runaway spend.${c.overhead.sharePct != null ? ` Overhead incl. stages: ${c.overhead.sharePct}% of the batch.` : ''}</p>` : ''}
  ${roles.length ? `<h2>By role</h2>${roles.map(([r, b]) => row(r, b)).join('')}` : ''}
  ${stages.length ? `<h2>By stage (overhead)</h2>${stages.map(([k, b]) => row(k, b)).join('')}` : ''}
  ${cased.length ? `<h2>Per case (direct; clustered cases are an even split)</h2>${cased.map((x) => row(x.id, { tok: x.direct.tok, costUsd: x.direct.costUsd })).join('')}` : ''}`}`;
}

// Self-contained TEAM page — the whole ledger's rollup, same visual language
// as the batch page (no external assets, light/dark aware). Real dollars only,
// tokens-only sessions flagged, never estimated — same discipline as markdown.
export function renderTeamHtml(rep, { window, label } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const t = rep.totals;
  const tbl = (entries, cols, row) => entries.length
    ? `<table><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${entries.map(row).join('')}</table>` : '';
  const bucketRow = ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.priced ? usd(b.costUsd) : 'n/a'}</td><td>${b.sessions}</td><td>${b.tokens.output.toLocaleString()}</td><td>${hours(b.activeMin)}</td><td>${b.toolCalls} (${b.toolErrors})</td></tr>`;
  const intents = Object.entries(rep.byIntent ?? {});
  const cases = rep.cases;
  return `<!doctype html><meta charset="utf-8"><title>Tokenomics — team report${label ? ` — ${esc(label)}` : ''}</title><style>
  :root{--fg:#1a1a1a;--dim:#666;--line:#ddd;--bg:#fff;--accent:#2b6cb0;--band:#f3f4f6}
  @media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--dim:#9a9a9a;--line:#333;--bg:#151515;--accent:#63a4e0;--band:#1f2937}}
  body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg);max-width:920px;margin:2rem auto;padding:0 1rem}
  h1{font-size:1.3rem} h2{font-size:1.05rem;margin-top:1.6rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
  .k{display:inline-block;margin:.2rem 1.2rem .2rem 0}.k b{font-size:1.25rem}.k span{color:var(--dim);font-size:.85rem;display:block}
  table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.5rem 0}
  th{text-align:left;color:var(--dim);font-weight:600;border-bottom:1px solid var(--line);padding:.25rem .5rem}
  td{border-bottom:1px solid var(--band);padding:.25rem .5rem}
  .chip{font-size:.8rem;border:1px solid var(--line);border-radius:8px;padding:.1rem .5rem;margin-right:.4rem;color:var(--dim)}
  .note{color:var(--dim);font-size:.85rem}.warn{color:#c53030}</style>
  <h1>Tokenomics — team usage report${label ? ` — ${esc(label)}` : ''}</h1>
  <p class="note">Generated ${esc(new Date().toISOString())}${window ? ` · window: ${esc(window)}` : ''} · ${rep.sessions} session(s) · ${rep.people} person(s) · ${Object.entries(rep.byHost).map(([h, b]) => `${esc(h)} ${b.sessions}`).join(', ')}</p>
  <div><span class="k"><b>${usd(t.priced ? t.costUsd : null)}</b><span>real dollars (${t.priced} priced session(s))</span></span>
  <span class="k"><b>${hours(t.activeMin)}</b><span>active (${hours(t.wallMin)} wall)</span></span>
  <span class="k"><b>${(t.tokens.output / 1e6).toFixed(1)}M</b><span>output tokens</span></span>
  <span class="k"><b>${t.toolCalls}</b><span>tool calls (${t.toolErrors} err)</span></span>
  ${cases?.reports ? `<span class="k"><b>${cases.delivered}/${cases.examined}</b><span>delivered / examined (receipts)</span></span>` : ''}
  ${rep.perDelivered ? `<span class="k"><b>${usd(rep.perDelivered.automationOnlyCostUsd ?? rep.perDelivered.costUsd)}</b><span>per delivered case${rep.perDelivered.automationOnlyCostUsd != null ? ` (automation-intent spend; all-spend ${usd(rep.perDelivered.costUsd)})` : ''}</span></span>` : ''}
  ${rep.perExamined ? `<span class="k"><b>${usd(rep.perExamined.costUsd)}</b><span>per case examined</span></span>` : ''}</div>
  ${rep.tokensOnly ? `<p class="note warn">⚠ ${rep.tokensOnly} session(s) tokens-only — no real dollar, never estimated.</p>` : ''}
  ${intents.some(([k]) => k !== 'undeclared') ? `<p>${intents.map(([k, b]) => `<span class="chip">${esc(k)}: ${b.priced ? usd(b.costUsd) : 'n/a'} (${b.sessions})</span>`).join('')}</p>` : ''}
  ${cases?.reports ? `<h2>Cases (from the pipeline's receipts)</h2><p>${Object.entries(cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(k)} ${n}</span>`).join('')}</p>` : ''}
  ${rep.byBatch?.length ? `<h2>By batch</h2>
  <table><tr><th>batch</th><th>cases</th><th>delivered</th><th>total</th><th>per delivered</th><th>active</th><th>gate</th><th>drift</th></tr>
  ${rep.byBatch.map((b) => `<tr><td>${esc(b.batch)}</td><td>${b.cases}</td><td>${b.delivered}</td><td>${usd(b.costUsd)}</td><td>${usd(b.perDelivered)}</td><td>${hours(b.activeMin)}</td><td>${esc(b.gate ?? '—')}</td><td>${b.drift ? '⚠️' : '—'}</td></tr>`).join('')}</table>` : ''}
  ${rep.perCase?.length ? `<h2>Per case — cost.json rows across batches (delivered first)</h2>
  ${rep.perCaseStats?.loadedCostUsd ? `<p class="note">Delivered-case loaded cost: avg ${usd(rep.perCaseStats.loadedCostUsd.avg)} · median ${usd(rep.perCaseStats.loadedCostUsd.median)} · min ${usd(rep.perCaseStats.loadedCostUsd.min)} · max ${usd(rep.perCaseStats.loadedCostUsd.max)} (n=${rep.perCaseStats.loadedCostUsd.n}). Loaded = direct + even overhead share — allocation, not measurement.</p>` : ''}
  <table><tr><th>case</th><th>batch</th><th>outcome</th><th>direct</th><th>loaded</th><th>active (loaded)</th></tr>
  ${rep.perCase.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.batch)}</td><td>${esc(r.outcome ?? '—')}</td><td>${usd(r.direct.costUsd)}</td><td>${usd(r.loaded?.costUsd)}</td><td>${r.loaded?.activeMin ?? '—'}m</td></tr>`).join('')}</table>` : ''}
  <h2>By person</h2>${tbl(Object.entries(rep.byPerson).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0)), ['person', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}
  <h2>By role</h2><p class="note">Dollars are session-grain, so roles report tokens/time — sub-agent roles included.</p>
  ${tbl(Object.entries(rep.byRole).sort((a, z) => z[1].tokens.output - a[1].tokens.output), ['role', 'units', 'out tokens', 'active', 'tools (err)'],
    ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.units}</td><td>${b.tokens.output.toLocaleString()}</td><td>${hours(b.activeMin)}</td><td>${b.toolCalls} (${b.toolErrors})</td></tr>`)}
  <h2>By week</h2>${tbl(Object.entries(rep.byWeek).sort(([a], [z]) => a.localeCompare(z)), ['week', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}`;
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
