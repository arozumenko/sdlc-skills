#!/usr/bin/env node
// team-report.mjs — assemble the team usage report from tokenomics ledgers.
//
//   node team-report.mjs [roots...] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//                        [--receipts <path>] [--json] [--out <file>]
//
// Each root may be a repo root (reads .agents/telemetry/*.jsonl and joins
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
  for (const dir of [join(root, '.agents', 'telemetry'), root]) {
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
  const direct = join(target, 'report.json');
  if (existsSync(direct)) return [direct];
  const out = [];
  let names;
  try { names = readdirSync(target).sort(); } catch { return out; }
  for (const name of names) {
    const p = join(target, name, 'report.json');
    if (existsSync(p)) out.push(p);
  }
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
  const ser = (m) => Object.fromEntries([...m.entries()]);
  return {
    sessions: lines.length,
    people: byPerson.size,
    totals,
    byCase: Object.fromEntries([...byCase.entries()].sort((a, z) => z[1] - a[1])),
    costSources: ser(sources),
    tokensOnly: totals.sessions - totals.priced,
    byPerson: ser(byPerson), byRole: ser(byRole), byWeek: ser(byWeek), byHost: ser(byHost),
    cases,
    // Receipts aren't attributable to one role, so a role-filtered spend over
    // the full delivered count would be a wrong ratio — suppressed instead.
    perDelivered: cases && cases.delivered > 0 && !cases.roleFiltered ? {
      costUsd: totals.priced ? totals.costUsd / cases.delivered : null,
      activeMin: Math.round(totals.activeMin / cases.delivered),
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
  out.push(`- Time: ${hours(t.activeMin)} active  ·  ${hours(t.wallMin)} wall  ·  ${t.turns} turns  ·  ${t.toolCalls} tool calls (${t.toolErrors} err)`);
  const caseIds = Object.keys(rep.byCase ?? {});
  if (caseIds.length) {
    out.push(`- Case ids named in sessions: ${caseIds.length} distinct (sessions-per-case in the --json \`byCase\`; top: ${caseIds.slice(0, 5).join(', ')})`);
  }
  out.push('');
  if (rep.cases && rep.cases.reports) {
    out.push('## Cases (from the pipeline\'s own receipts)', '');
    const parts = Object.entries(rep.cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
    out.push(`- Examined: ${rep.cases.examined} unique case(s) across ${rep.cases.reports} report(s)  ·  **delivered (automated): ${rep.cases.delivered}**`);
    if (parts) out.push(`- Outcomes: ${parts}`);
    if (rep.perDelivered) {
      out.push(`- Per delivered case: ${usd(rep.perDelivered.costUsd)}  ·  ${rep.perDelivered.activeMin} active min`);
      out.push('  (spend in the window ÷ delivered cases in the receipts — align the window to the batch for a per-batch figure)');
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
export function renderBatchMarkdown(c) {
  const out = [`# Batch cost — ${c.batch}`, '', `Generated: ${c.generatedAt}  ·  sessions: ${c.sources.sessions} (${c.sources.hosts.join(', ') || 'none'})`, ''];
  const oc = Object.entries(c.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
  out.push('## What happened', '');
  out.push(`- Cases: ${c.cases.length}  ·  **delivered: ${c.delivered}**${oc ? `  ·  ${oc}` : ''}`);
  if (c.gate) out.push(`- Gate: ${c.gate.verdict}${c.gate.runs ? ` (${c.gate.runs} runs)` : ''}`);
  out.push(`- Findings reported: ${c.cases.reduce((n, x) => n + x.findings, 0)}  ·  fix rounds: ${c.cases.reduce((n, x) => n + x.direct.fixRounds, 0)}`, '');
  out.push('## What it cost', '');
  out.push(`- Total: ${usd(c.totals.costUsd)}  ·  ${c.totals.tokens.toLocaleString()} tokens  ·  ${hours(c.totals.activeMin)} active  ·  ${c.totals.dispatches} dispatches`);
  out.push(`- Overhead (lead + triage + gate + report, shown once): ${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` (${c.overhead.sharePct}%)` : ''}`);
  if (c.averages.totalPerDelivered) out.push(`- **Per delivered case (incl. overhead): ${usd(c.averages.totalPerDelivered.costUsd)}**`);
  if (c.averages.directPerCase) out.push(`- Avg direct per case (excl. overhead): ${usd(c.averages.directPerCase.costUsd)}`);
  const s = c.stats;
  const line4 = (st, f = (x) => x) => st ? `avg ${f(st.avg)} · median ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)}` : null;
  if (s.directCostUsd) out.push(`- Direct cost spread: ${line4(s.directCostUsd, (x) => usd(x))}`);
  if (s.directActiveMin) out.push(`- Active-time spread: ${line4(s.directActiveMin, (x) => `${x}m`)}`);
  if (!s.directCostUsd && s.directTokens) out.push(`- Direct token spread (no per-dispatch dollars on this host): ${line4(s.directTokens, (x) => x.toLocaleString())}`);
  out.push('', '## Per case (direct, measured — batch overhead is NOT in these rows)', '');
  out.push('| case | outcome | direct cost | tokens | active | dispatches | fix rounds | findings |', '|---|---|---|---|---|---|---|---|');
  for (const x of c.cases) {
    out.push(`| ${x.id} | ${x.outcome ?? '—'} | ${usd(x.direct.costUsd)} | ${x.direct.tokens.toLocaleString()} | ${x.direct.activeMin}m | ${x.direct.dispatches} | ${x.direct.fixRounds} | ${x.findings} |`);
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
    <div class="num">${fmtV(val(x))}<span class="sub"> · ${x.direct.activeMin}m · ${x.direct.fixRounds ? `${x.direct.fixRounds} fix` : 'no fix'}${x.findings ? ` · ${x.findings} finding${x.findings > 1 ? 's' : ''}` : ''}</span></div></div>`).join('');
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
  .note{color:var(--dim);font-size:.85rem}</style>
  <h1>Batch cost — ${esc(c.batch)}</h1>
  <p class="note">Generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) on ${esc(c.sources.hosts.join(', '))} · sources: ${esc(c.sources.costSources.join(', ') || 'tokens only')}</p>
  <div><span class="k"><b>${usd(c.totals.costUsd)}</b><span>total (measured)</span></span>
  <span class="k"><b>${c.delivered}/${c.cases.length}</b><span>delivered / cases</span></span>
  <span class="k"><b>${c.averages.totalPerDelivered ? usd(c.averages.totalPerDelivered.costUsd) : 'n/a'}</b><span>per delivered (incl. overhead)</span></span>
  <span class="k"><b>${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` (${c.overhead.sharePct}%)` : ''}</b><span>overhead: lead + triage + gate + report</span></span>
  <span class="k"><b>${c.gate ? esc(c.gate.verdict) : 'n/a'}</b><span>gate${c.gate?.runs ? ` (${c.gate.runs} runs)` : ''}</span></span></div>
  <p>${oc}</p>
  <h2>Per case — direct, measured${priced ? '' : ' (tokens: no per-dispatch dollars on this host)'}</h2>
  <p class="note">Batch overhead is NOT in these bars — it is the labelled figure above, shown once instead of smeared.</p>
  ${bars}
  <h2>Spread (direct, measured only)</h2>
  <p>${priced ? `Cost: ${st(c.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}Tokens: ${st(c.stats.directTokens, (x) => x.toLocaleString())}<br>Active time: ${st(c.stats.directActiveMin, (x) => `${x}m`)}</p>
  ${Object.keys(c.byRole ?? {}).length ? `<h2>By role</h2>${(() => {
    const roles = Object.entries(c.byRole);
    const rmax = Math.max(1, ...roles.map(([, b]) => b.tokens));
    return roles.map(([r, b]) => `
    <div class="row"><div class="lbl">${esc(r)}</div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (b.tokens / rmax) * 100)}%"></div></div>
    <div class="num">${b.costUsd != null ? `$${b.costUsd.toFixed(2)}` : `${(b.tokens / 1e6).toFixed(1)}M tok`}<span class="sub"> · ${b.dispatches || '—'} disp · ${b.activeMin}m</span></div></div>`).join('');
  })()}` : ''}
  ${c.coverage.casesUnattributed.length ? `<p class="note">Unattributed (no captured dispatch named them): ${esc(c.coverage.casesUnattributed.join(', '))}</p>` : ''}`;
}

export function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.set('json', true);
    else if (a === '--html') flags.set('html', true);
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
    const output = flags.get('json')
      ? JSON.stringify(results.length === 1 ? results[0] : results, null, 2)
      : flags.get('html')
        ? results.map(renderBatchHtml).join('\n')
        : results.map(renderBatchMarkdown).join('\n\n---\n\n');
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
  const windowLabel = [
    [flags.get('since'), flags.get('until')].filter(Boolean).join(' → ') || null,
    flags.get('role') ? `role: ${flags.get('role')}` : null,
  ].filter(Boolean).join('  ·  ') || null;
  const output = flags.get('json')
    ? JSON.stringify({ generated: new Date().toISOString(), window: windowLabel, ...rep }, null, 2)
    : renderMarkdown(rep, { window: windowLabel, label: flags.get('label') });
  if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
  else process.stdout.write(`${output}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
