#!/usr/bin/env node
// build-report-html.mjs — a self-contained HTML report from a usage-rollup
// snapshot, shaped for the test-automation pipeline.
//
// usage:
//   node usage-rollup.mjs --json > rollup.json          # Claude Code
//   node usage-rollup.mjs --host copilot --json > r.json # GitHub Copilot
//   node build-report-html.mjs --in rollup.json --out report.html [--title "…"]
//
// WHAT IT IS FOR. The markdown rollup answers "what did this cost". This answers
// the pipeline question a lead actually asks: **where does the money go per
// slot**, and is any slot out of line. So the roles are grouped into the
// pipeline's slots (analyst / implementer / reviewer / gate / orchestrator) and
// the per-slot cost, tokens, tool-error rate and wall time are put side by side.
//
// HOST-NEUTRAL BY CONSTRUCTION. It consumes the rollup JSON, not transcripts, so
// a Claude run and a Copilot run render identically — the only visible
// difference is the pricer named in the header and, on Copilot, the AI-credit
// line. Where a host cannot price a unit the cell reads `n/a`, never `$0.00`.
//
// NO DEPENDENCIES, NO NETWORK. One HTML file with inline CSS: it has to survive
// being emailed, attached to a ticket, or opened from a USB stick two years from
// now. Charts are CSS bars for the same reason — a charting library would be a
// CDN request that fails exactly when someone is trying to read the report.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Role → pipeline slot. The rollup reports whatever agent name the host
 * recorded; the lead thinks in slots. Unknown roles keep their own name rather
 * than being forced into a bucket — a role nobody recognises is a finding.
 */
export const SLOT_OF = {
  'qa-engineer': 'analyst / reviewer',
  'test-analyst': 'analyst',
  'test-automation-engineer': 'implementer',
  'test-automation-lead': 'orchestrator',
  'code-review': 'reviewer',
  'test-executor': 'executor',
  'test-run-lead': 'orchestrator',
  'general-purpose': 'ad-hoc',
  task: 'ad-hoc (unnamed dispatch)',
  Explore: 'ad-hoc',
  scout: 'onboarding',
  'tech-lead': 'architecture',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : 'n/a');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : '0');
const tok = (u) => (u ? u.input + u.output + u.cacheRead + u.cacheCreation : 0);

/**
 * A cell for a CSV that spreadsheets open without an import wizard. Excel reads
 * a leading `=`, `+`, `-` or `@` as a formula, so a value starting with one is
 * prefixed with a tab — the classic CSV-injection guard, and here also the
 * difference between a slot named "-- ad-hoc" showing up as text or as #NAME?.
 */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  const risky = /^[=+\-@]/.test(s);
  return /[",\n\r]/.test(s) || risky ? `"${(risky ? '\t' : '') + s.replace(/"/g, '""')}"` : s;
}

/**
 * The by-slot table as CSV, embedded in the page so Export works offline. This
 * is the table a lead re-sorts, pastes into a spreadsheet, or diffs against
 * last month — the one thing the HTML alone cannot do.
 */
export function buildCsv(slots) {
  const rows = [['slot', 'roles', 'cost_usd', 'tokens', 'units', 'turns', 'agent_minutes', 'tool_calls', 'tool_errors', 'models']];
  for (const s of slots) {
    rows.push([
      s.slot, s.roles.join(' '),
      // Empty, not 0.00 — an unpriced slot is unknown, and a spreadsheet will
      // happily average a fabricated zero into the answer.
      s.priced && typeof s.costUsd === 'number' ? s.costUsd.toFixed(4) : '',
      s.tokens, s.units, s.turns, s.agentMinutes, s.toolCalls, s.toolErrors,
      [...s.models].join(' '),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** A CSS bar sized as a share of the row's maximum. */
function bar(value, max, cls = '') {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>`;
}

/** Roles folded into slots, biggest spend first. */
export function bySlot(byRole = {}) {
  const slots = new Map();
  for (const [role, b] of Object.entries(byRole)) {
    const slot = SLOT_OF[role] || role;
    const cur = slots.get(slot) || {
      slot, roles: [], costUsd: null, tokens: 0, turns: 0, units: 0,
      toolCalls: 0, toolErrors: 0, agentMinutes: 0, models: new Set(), priced: false,
    };
    cur.roles.push(role);
    if (typeof b.costUsd === 'number') { cur.costUsd = (cur.costUsd ?? 0) + b.costUsd; cur.priced = true; }
    cur.tokens += tok(b.tokens);
    cur.turns += b.turns || 0;
    cur.units += b.count || 0;
    cur.toolCalls += b.toolCalls || 0;
    cur.toolErrors += b.toolErrors || 0;
    cur.agentMinutes += b.agentMinutes || 0;
    for (const m of (b.models || [])) cur.models.add(m);
    slots.set(slot, cur);
  }
  return [...slots.values()].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens - a.tokens);
}

/**
 * The headline the lead wants: cost per unit of delivered work.
 * `resolved` (cases/batches completed) is either measured from the pipeline's
 * own run reports (`--resolved-from`) or declared by the operator. The rollup
 * cannot invent it, so absent both the report asks for it.
 */
export function perUnitCost(totals, resolved) {
  if (!resolved || typeof totals.costUsd !== 'number') return null;
  return totals.costUsd / resolved;
}

/**
 * Delivery, when the snapshot carries it. Two denominators side by side and
 * never one: `automated` cases are the specs that shipped, but every case that
 * entered consumed analysis whether it shipped or not. A lone "cost per case"
 * is always one of these wearing the other's name — and which one it is decides
 * whether the pipeline looks cheap or expensive.
 */
function deliverySection(d, costUsd) {
  if (!d) return '';
  const rows = Object.entries(d.outcomes || {}).sort((a, b) => b[1] - a[1]);
  const maxN = Math.max(...rows.map(([, n]) => n), 1);
  const cov = d.coverage;
  return `
<h2>What the money bought</h2>
<div class="kpis">
  <div class="kpi"><span class="k">Per spec delivered</span><span class="v">${usd(d.perDelivered)}</span>
    <span class="sub">${num(d.delivered)} automated</span></div>
  <div class="kpi"><span class="k">Per case examined</span><span class="v">${usd(d.perExamined)}</span>
    <span class="sub">${num(d.casesEntered)} entered${d.reentered ? `, ${num(d.reentered)} re-entry(ies) folded` : ''}</span></div>
  <div class="kpi"><span class="k">Batches</span><span class="v">${num((d.batches || []).length)}</span>
    <span class="sub">${esc((d.batches || []).map((b) => `${b.slug}${b.gate ? ` (gate ${b.gate})` : ''}`).join(', ')) || '—'}</span></div>
</div>
<div class="scroll"><table>
  <tr><th>Outcome</th><th class="n">Cases</th><th class="n">Share</th></tr>
  ${rows.map(([k, n]) => `<tr>
      <td>${esc(k)}${k === 'automated' ? ' <span class="sub">— produced a spec</span>' : ''}</td>
      <td class="n">${num(n)}${bar(n, maxN, k === 'automated' ? '' : 'alt')}</td>
      <td class="n">${d.casesEntered ? Math.round((n / d.casesEntered) * 100) : 0}%</td>
    </tr>`).join('\n')}
</table></div>
<p class="note">Both figures divide the same ${usd(costUsd)}. <strong>Per spec delivered</strong> answers
  what a shipped test cost; <strong>per case examined</strong> answers what putting a case through this
  pipeline costs. A case that ended <code>out-of-scope</code> still consumed analysis, which is why it is
  in the second and not the first.</p>
${cov && cov.share != null ? `<p class="note">Spend on branches these batches name: ${usd(cov.matchedUsd)} of
  ${usd(cov.totalUsd)} (${Math.round(cov.share * 100)}%, ${num(cov.matchedUnits)} unit(s)). This is a
  <em>floor</em> — analysts never touch git, so their cost cannot be matched by branch. Read it as a dilution
  check: a low share means this window mostly paid for other work, and the per-case figures above are
  diluted by it.</p>` : cov ? `<p class="note">Dilution check not run —
  ${cov.branchesKnown === 0 ? 'these reports name no branches' : 'no unit in this window records the branch it ran on'},
  so there was nothing to match the spend against. The figures above assume this window <em>is</em> the run;
  nothing here confirms that, so scope the rollup to the run yourself.</p>` : ''}
${(d.warnings || []).map((w) => `<p class="note bad">⚠️ ${esc(w)}</p>`).join('\n')}
`;
}

function slotTable(slots) {
  const maxCost = Math.max(...slots.map((s) => s.costUsd ?? 0), 0);
  const maxTok = Math.max(...slots.map((s) => s.tokens), 1);
  return slots.map((s) => {
    const errRate = s.toolCalls ? s.toolErrors / s.toolCalls : null;
    return `<tr>
      <td><strong>${esc(s.slot)}</strong><div class="sub">${esc(s.roles.join(', '))}</div></td>
      <td class="n">${s.priced ? usd(s.costUsd) : '<span class="na">n/a</span>'}${s.priced ? bar(s.costUsd ?? 0, maxCost) : ''}</td>
      <td class="n">${num(s.tokens)}${bar(s.tokens, maxTok, 'alt')}</td>
      <td class="n">${num(s.units)}</td>
      <td class="n">${num(s.turns)}</td>
      <td class="n">${num(s.agentMinutes)}</td>
      <td class="n">${num(s.toolCalls)}${errRate ? ` <span class="${errRate > 0.05 ? 'bad' : 'dim'}">(${pct(errRate)} err)</span>` : ''}</td>
      <td class="sub">${esc([...s.models].join(', ')) || '—'}</td>
    </tr>`;
  }).join('\n');
}

function dayTable(byDay = {}) {
  const rows = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const maxTok = Math.max(...rows.map(([, b]) => tok(b.tokens)), 1);
  return rows.map(([day, b]) => `<tr>
      <td>${esc(day)}</td>
      <td class="n">${typeof b.costUsd === 'number' ? usd(b.costUsd) : '<span class="na">n/a</span>'}</td>
      <td class="n">${num(tok(b.tokens))}${bar(tok(b.tokens), maxTok, 'alt')}</td>
      <td class="n">${num(b.count)}</td>
      <td class="n">${num(b.turns)}</td>
    </tr>`).join('\n');
}

/** The costliest units — where a lead looks first when a number surprises them. */
function ledgerTable(ledger = [], limit = 25) {
  const rows = [...ledger]
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || tok(b.usage) - tok(a.usage))
    .slice(0, limit);
  return rows.map((u) => `<tr>
      <td class="mono">${esc(String(u.id).slice(0, 8))}</td>
      <td>${esc(u.role || (u.kind === 'session' ? '(session)' : 'unknown'))}<div class="sub">${esc(u.kind)}</div></td>
      <td class="n">${typeof u.costUsd === 'number' ? usd(u.costUsd) : '<span class="na">n/a</span>'}</td>
      <td class="n">${num(tok(u.usage))}</td>
      <td class="n">${num(u.turns)}</td>
      <td class="n">${num(u.durationMin)}m</td>
      <td class="n">${num(u.toolCalls)}${u.toolErrors ? ` <span class="bad">(${u.toolErrors} err)</span>` : ''}</td>
      <td class="sub">${esc(u.gitBranch || '—')}</td>
    </tr>`).join('\n');
}

export function renderHtml(snapshot, { title = 'Test-automation efficiency', resolved, delivery } = {}) {
  const r = snapshot.rollup || {};
  const t = r.totals || {};
  const del = delivery ?? snapshot.delivery;
  // Measured delivery supersedes a declared count — and if the operator passed
  // one too, the reports are what the page shows.
  if (del && typeof del.delivered === 'number') resolved = del.delivered;
  const host = snapshot.host === 'copilot' ? 'GitHub Copilot' : 'Claude Code';
  const pricer = snapshot.host === 'copilot' ? 'GitHub Copilot (AI credits)' : 'ccusage';
  const slots = bySlot(r.byRole);
  const nSessions = (r.ledger || []).filter((u) => u.kind === 'session').length;
  const nSub = (r.ledger || []).filter((u) => u.kind === 'subagent').length;
  const per = perUnitCost(t, resolved);
  const errRate = t.toolCalls ? t.toolErrors / t.toolCalls : null;

  const creditLine = snapshot.host === 'copilot' && typeof snapshot.aiCredits === 'number'
    ? `<div class="kpi"><span class="k">AI credits</span><span class="v">${snapshot.aiCredits.toFixed(2)}</span>
         <span class="sub">1 credit = $${snapshot.usdPerCredit ?? 0.01} · ${snapshot.sessionsPriced}/${snapshot.sessionsTotal} sessions priced</span></div>`
    : '';
  const unpricedNote = snapshot.host === 'copilot' && snapshot.sessionsPriced < snapshot.sessionsTotal
    ? `<p class="note">${snapshot.sessionsTotal - snapshot.sessionsPriced} session(s) predate GitHub's usage-based billing
       (2026-06-01) and carry no credit figure — their tokens are counted, their cost reads <code>n/a</code>.
       Retroactive pricing is not possible${snapshot.legacyPremiumRequests ? `; they were billed as ${snapshot.legacyPremiumRequests} legacy premium request(s)` : ''}.</p>`
    : '';

  return `<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --dim:#666; --line:#e2e2e2; --bg:#fff; --accent:#2b6cb0; --alt:#8a6d3b; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e8; --dim:#9a9a9a; --line:#333; --bg:#151515; --accent:#63a4e0; --alt:#d4a95f; --bad:#ff6b5e; }
  }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         color: var(--fg); background: var(--bg); margin: 0; padding: 2rem 1.5rem 4rem; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2.25rem 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
  .meta, .sub, .note { color: var(--dim); font-size: .85rem; }
  .note { margin: .5rem 0 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 1.25rem 0 0; }
  .kpi { display: flex; flex-direction: column; }
  .kpi .k { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
  .kpi .v { font-size: 1.6rem; font-weight: 600; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; font-size: .88rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); font-weight: 600; }
  td.n { text-align: right; white-space: nowrap; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
  .na { color: var(--dim); font-style: italic; }
  .bad { color: var(--bad); }
  .dim { color: var(--dim); }
  .bar { height: 3px; background: color-mix(in srgb, var(--line) 70%, transparent); margin-top: 3px; border-radius: 2px; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .bar.alt span { background: var(--alt); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
  .actions { margin: 1.25rem 0 0; }
  button { font: inherit; font-size: .82rem; padding: .35rem .8rem; cursor: pointer;
           color: var(--fg); background: transparent;
           border: 1px solid var(--line); border-radius: 4px; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  /* This report gets attached to tickets and printed to PDF for a monthly
     review. Force the light palette (a dark background wastes a cartridge and
     prints grey text on grey), drop the controls, and keep tables off page
     breaks — a slot table split across two pages loses its header row. */
  @media print {
    :root { color-scheme: light; --fg:#111; --dim:#555; --line:#ccc; --bg:#fff; --accent:#26527d; --alt:#7a6031; --bad:#8f1d17; }
    body { padding: 0; font-size: 11pt; }
    .actions { display: none; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .scroll { overflow: visible; }
  }
</style>
<div class="wrap">
<h1>${esc(title)}</h1>
<div class="meta">${esc(host)} · priced by ${esc(pricer)} · generated ${esc(snapshot.generatedAt || '')}</div>

<div class="kpis">
  <div class="kpi"><span class="k">Total cost</span><span class="v">${usd(t.costUsd)}</span>
    <span class="sub">method: ${esc(r.costMethod || 'n/a')}</span></div>
  ${creditLine}
  <div class="kpi"><span class="k">Units</span><span class="v">${num(t.count)}</span>
    <span class="sub">${nSessions} session(s) + ${nSub} sub-agent(s)</span></div>
  <div class="kpi"><span class="k">Tokens</span><span class="v">${num(tok(t.tokens))}</span>
    <span class="sub">cache hit ${pct(t.cacheHitRate)} · output share ${pct(t.outputShare)}</span></div>
  <div class="kpi"><span class="k">Tool calls</span><span class="v">${num(t.toolCalls)}</span>
    <span class="sub ${errRate > 0.05 ? 'bad' : ''}">${num(t.toolErrors)} errored (${pct(errRate)})</span></div>
  <div class="kpi"><span class="k">Agent time</span><span class="v">${num(t.agentMinutes)}m</span>
    <span class="sub">${num(t.wallClockMin)}m wall clock</span></div>
  ${per != null ? `<div class="kpi"><span class="k">Per case</span><span class="v">${usd(per)}</span>
    <span class="sub">over ${num(resolved)} ${del ? 'delivered (measured)' : 'resolved (declared)'}</span></div>` : ''}
</div>
${resolved ? '' : '<p class="note">No case count given — point the rollup at the pipeline\'s own run reports with <code>--resolved-from</code> to get cost per case measured, or pass <code>--resolved N</code> to declare one. It is the number worth tracking release over release.</p>'}
${unpricedNote}
${deliverySection(del, t.costUsd)}

<div class="actions"><button type="button" id="csv">Export slots as CSV</button></div>

<h2>Cost by pipeline slot</h2>
<p class="sub">Agent roles folded into the slots the pipeline actually has. An unrecognised role keeps its own name — that is a finding, not a bucket.</p>
<div class="scroll"><table>
  <tr><th>Slot</th><th class="n">Cost</th><th class="n">Tokens</th><th class="n">Units</th><th class="n">Turns</th><th class="n">Agent-min</th><th class="n">Tool calls</th><th>Models</th></tr>
  ${slotTable(slots)}
</table></div>

<h2>By day</h2>
<div class="scroll"><table>
  <tr><th>Day</th><th class="n">Cost</th><th class="n">Tokens</th><th class="n">Units</th><th class="n">Turns</th></tr>
  ${dayTable(r.byDay)}
</table></div>

<h2>Costliest units</h2>
<p class="sub">Where to look first when a total surprises you.</p>
<div class="scroll"><table>
  <tr><th>Id</th><th>Role</th><th class="n">Cost</th><th class="n">Tokens</th><th class="n">Turns</th><th class="n">Duration</th><th class="n">Tool calls</th><th>Branch</th></tr>
  ${ledgerTable(r.ledger)}
</table></div>

<h2>Reading this</h2>
<ul class="sub">
  <li><strong>n/a is not zero.</strong> A cell reads <code>n/a</code> when the host cannot price that unit — never a made-up $0.00.</li>
  <li><strong>Sub-agent dollars are derived.</strong> Both hosts price per session; a sub-agent's share is split by tokens${snapshot.host === 'copilot' ? ', and on Copilot a sub-agent reports a token TOTAL with no input/output split' : ''}.</li>
  <li><strong>Agent-minutes exceed wall clock</strong> when sub-agents run in parallel — that is the pipeline working, not an error.</li>
</ul>
</div>
<script>
// The CSV rides in the page rather than being fetched, so Export still works
// from an email attachment, a USB stick, or a ticket two years from now — the
// same reason the charts are CSS bars. JSON.parse of a string literal, not an
// inline object: the data never becomes code, whatever a role happens to be
// named. </script> inside it is escaped at build time.
var CSV = JSON.parse(${JSON.stringify(JSON.stringify(buildCsv(slots))).replace(/</g, '\\u003c')});
document.getElementById('csv').addEventListener('click', function () {
  var url = URL.createObjectURL(new Blob(['\\ufeff' + CSV], { type: 'text/csv;charset=utf-8' }));
  var a = document.createElement('a');
  a.href = url;
  a.download = ${JSON.stringify(`${(snapshot.generatedAt || '').slice(0, 10) || 'report'}-slots.csv`)};
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 0);
});
</script>
`;
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

function main() {
  const argv = process.argv.slice(2);
  const inPath = arg(argv, '--in');
  if (!inPath || argv.includes('--help') || argv.includes('-h')) {
    console.error('usage: build-report-html.mjs --in <rollup.json> [--out report.html] [--title "…"] [--resolved N]');
    console.error('  produce the input with: usage-rollup.mjs --json  (add --host copilot for GitHub Copilot)');
    process.exit(inPath ? 0 : 2);
  }
  const snapshot = JSON.parse(readFileSync(inPath, 'utf8'));
  const resolvedArg = arg(argv, '--resolved');
  const html = renderHtml(snapshot, {
    title: arg(argv, '--title') || 'Test-automation efficiency',
    resolved: resolvedArg ? Number(resolvedArg) : snapshot.resolved,
  });
  const out = arg(argv, '--out');
  if (out) {
    writeFileSync(out, html);
    // Also drop the slot table beside it. The in-page Export button covers the
    // normal case (someone opens the report in a browser), but ticket trackers
    // and mail clients strip <script>, and that is exactly where this report
    // gets attached. A plain file needs nothing to run.
    const csvPath = out.replace(/\.html?$/i, '') + '.csv';
    writeFileSync(csvPath, buildCsv(bySlot((snapshot.rollup || {}).byRole)));
    console.error(`Report written to ${out}\nSlot table written to ${csvPath}`);
  } else process.stdout.write(html);
}

// pathToFileURL, not a hand-built `file://` template — the literal comparison
// never matches on Windows or on paths containing spaces, making the CLI a
// silent no-op there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
