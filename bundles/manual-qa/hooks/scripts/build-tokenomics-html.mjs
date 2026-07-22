#!/usr/bin/env node
// Renders a self-contained HTML report from an existing
// reports/tokenomics/RUN-*.tokenomics.json row (produced by
// build-tokenomics-report.mjs), optionally enriched with the paired
// reports/metrics/RUN-<id>.json for per-test-case timing detail.
//
// This is a read-only, on-demand visualization layer — it never
// recomputes metrics, only re-presents what's already in those two JSON
// files. Plain Node, no npm dependencies, no CDN: every chart is
// hand-rolled div/CSS, colors taken from the dataviz skill's validated
// reference palette (categorical slots, status colors, light/dark chart
// chrome — see the Claude Code `dataviz` skill this was designed against).
//
// NOTE: kept in sync by hand with the project-local version at
// elitea-testing/scripts/build-tokenomics-html.mjs — same logic; only
// PROJECT_DIR derivation differs, same reason as build-tokenomics-report.mjs
// in this same directory.
//
// Usage (run manually from the project root):
//   node .claude/hooks/manual-qa/build-tokenomics-html.mjs reports/tokenomics/RUN-2026-07-22-005.tokenomics.json
//   node .claude/hooks/manual-qa/build-tokenomics-html.mjs --all
//
// Writes: reports/tokenomics/html/RUN-<id>.tokenomics.html
// (named after the *source* tokenomics file, same collision-avoidance
// rule as build-tokenomics-report.mjs uses for its own output.)

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

// Project root: this script is invoked manually, from the project root, so
// CLAUDE_PROJECT_DIR (set by Claude Code for hooks) is usually absent here —
// process.cwd() is the real fallback in practice, not just a safety net.
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const TOKENOMICS_DIR = join(REPORTS_DIR, 'tokenomics');
const METRICS_DIR = join(REPORTS_DIR, 'metrics');
const HTML_DIR = join(TOKENOMICS_DIR, 'html');

// --- Args ---

const args = process.argv.slice(2);
let targets;
if (args.includes('--all')) {
  targets = existsSync(TOKENOMICS_DIR)
    ? readdirSync(TOKENOMICS_DIR).filter(f => f.endsWith('.tokenomics.json')).map(f => join(TOKENOMICS_DIR, f))
    : [];
  if (!targets.length) {
    console.error('[build-tokenomics-html] no reports/tokenomics/*.tokenomics.json files found');
    process.exit(0);
  }
} else if (args.length) {
  targets = args;
} else {
  console.error('Usage: node .claude/hooks/manual-qa/build-tokenomics-html.mjs <reports/tokenomics/RUN-*.tokenomics.json> [...] | --all');
  process.exit(1);
}

// --- Small helpers ---

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
function fmtUsd(n) { return n == null ? '—' : `$${n.toFixed(2)}`; }
function fmtPct(n, dp = 1) { return n == null ? '—' : `${n.toFixed(dp)}%`; }

function fmtDurationMs(ms) {
  if (ms == null) return '—';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtDurationH(hours) { return hours == null ? '—' : fmtDurationMs(hours * 3.6e6); }

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
}

// Categorical palette slots (light / dark) — reference instance from the
// dataviz skill, used unmodified. Slot order is the CVD-safety mechanism —
// never reassign a color to a different role between charts.
const SLOT = {
  1: { light: '#2a78d6', dark: '#3987e5' }, // blue
  2: { light: '#eb6834', dark: '#d95926' }, // orange
  3: { light: '#1baf7a', dark: '#199e70' }, // aqua
  4: { light: '#eda100', dark: '#c98500' }, // yellow
};
const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};
function statusFor(result) {
  const r = (result || '').toUpperCase();
  if (r === 'PASS') return { color: STATUS.good, icon: '✓', label: 'PASS' };
  if (r === 'FAIL') return { color: STATUS.critical, icon: '✕', label: 'FAIL' };
  if (r === 'BLOCKED') return { color: STATUS.warning, icon: '⚠', label: 'BLOCKED' };
  return { color: '#898781', icon: '?', label: r || 'UNKNOWN' };
}

// --- Section renderers ---

function renderKpiRow(t, m) {
  const session = m?.session ?? {};
  const durationMs = session.total_session_duration_ms ?? (t.wall_clock_h != null ? t.wall_clock_h * 3.6e6 : null);
  const started = m?.date ? fmtDate(m.date) : '—';

  return `
  <section class="kpi-row">
    <div class="kpi-card">
      <h3>Cost &amp; Time</h3>
      <div class="kpi-grid">
        <div class="stat"><span class="stat-label">Cost <span class="stat-sub">API-equivalent</span></span><span class="stat-value">${fmtUsd(t.cost_api_equivalent_usd)}</span></div>
        <div class="stat"><span class="stat-label">Cache-read cost share</span><span class="stat-value">${fmtPct(t.cache_read_share_pct)}</span></div>
        <div class="stat"><span class="stat-label">Duration</span><span class="stat-value">${fmtDurationMs(durationMs)}</span></div>
        <div class="stat"><span class="stat-label">Started</span><span class="stat-value stat-value-sm">${started}</span></div>
      </div>
    </div>
    <div class="kpi-card">
      <h3>Token Usage</h3>
      <div class="kpi-grid">
        <div class="stat"><span class="stat-label">Input</span><span class="stat-value">${fmtInt(t.tokens?.input)}</span></div>
        <div class="stat"><span class="stat-label">Output</span><span class="stat-value">${fmtInt(t.tokens?.output)}</span></div>
        <div class="stat"><span class="stat-label">Cache read</span><span class="stat-value">${fmtInt(t.tokens?.cache_read)}</span></div>
        <div class="stat"><span class="stat-label">Cache create</span><span class="stat-value">${fmtInt(t.tokens?.cache_create)}</span></div>
      </div>
      <div class="kpi-callout">Total <strong>${fmtInt(t.tokens_total)}</strong> tokens &middot; <strong>${fmtPct(t.cache_read_share_pct_tokens)}</strong> served from cache</div>
    </div>
    <div class="kpi-card">
      <h3>Activity</h3>
      <div class="kpi-grid">
        <div class="stat"><span class="stat-label">Turns</span><span class="stat-value">${fmtInt(t.turns)}</span></div>
        <div class="stat"><span class="stat-label">Tool calls</span><span class="stat-value">${fmtInt(session.total_tool_uses)}</span></div>
        <div class="stat"><span class="stat-label">Subagent dispatches</span><span class="stat-value">${fmtInt(t.subagent_dispatches)}</span></div>
        <div class="stat"><span class="stat-label">Scenarios (auth./exec.)</span><span class="stat-value">${fmtInt(t.scenarios_authored)}/${fmtInt(t.scenarios_executed)}</span></div>
      </div>
      ${m?.summary ? `<div class="kpi-callout">Pass rate <strong>${fmtPct(m.summary.pass_rate, 0)}</strong> (${m.summary.passed}/${m.summary.total})</div>` : ''}
    </div>
  </section>`;
}

function renderTokenBar(t) {
  const tk = t.tokens ?? {};
  const total = t.tokens_total || (tk.input ?? 0) + (tk.output ?? 0) + (tk.cache_create ?? 0) + (tk.cache_read ?? 0);
  const segments = [
    { key: 'input', label: 'Input', value: tk.input ?? 0, slot: 1 },
    { key: 'output', label: 'Output', value: tk.output ?? 0, slot: 2 },
    { key: 'cache_create', label: 'Cache create', value: tk.cache_create ?? 0, slot: 3 },
    { key: 'cache_read', label: 'Cache read', value: tk.cache_read ?? 0, slot: 4 },
  ];

  const bar = segments.map(s => {
    const pct = total ? (s.value / total) * 100 : 0;
    return `<div class="bar-seg" style="flex:${Math.max(pct, 0.4)} 0 0;background:var(--series-${s.slot});" title="${s.label}: ${fmtInt(s.value)} (${fmtPct(pct)})"></div>`;
  }).join('');

  const legend = segments.map(s => {
    const pct = total ? (s.value / total) * 100 : 0;
    return `<div class="legend-item">
      <span class="legend-swatch" style="background:var(--series-${s.slot});"></span>
      <span class="legend-label">${s.label}</span>
      <span class="legend-value">${fmtInt(s.value)} <span class="legend-pct">(${fmtPct(pct)})</span></span>
    </div>`;
  }).join('');

  return `
  <section class="panel">
    <h2>Token composition</h2>
    <p class="panel-sub">Share of ${fmtInt(total)} total tokens by type</p>
    <div class="stacked-bar">${bar}</div>
    <div class="legend legend-grid-4">${legend}</div>
  </section>`;
}

function renderModelTable(t) {
  const models = t.tokens_by_model ?? {};
  const entries = Object.entries(models).map(([name, v]) => {
    const total = (v.input ?? 0) + (v.output ?? 0) + (v.cache_create ?? 0) + (v.cache_read ?? 0);
    return { name, ...v, total };
  }).sort((a, b) => b.total - a.total);
  const grandTotal = entries.reduce((a, e) => a + e.total, 0) || 1;

  const rows = entries.map((e, i) => {
    const pct = (e.total / grandTotal) * 100;
    const slot = (i % 4) + 1;
    return `<tr>
      <td><span class="legend-swatch" style="background:var(--series-${slot});"></span>${esc(e.name)}</td>
      <td>${fmtInt(e.input)}</td>
      <td>${fmtInt(e.output)}</td>
      <td>${fmtInt(e.cache_create)}</td>
      <td>${fmtInt(e.cache_read)}</td>
      <td>${fmtInt(e.total)}</td>
      <td>
        <div class="share-bar-track"><div class="share-bar-fill" style="width:${Math.max(pct, 0.5)}%;background:var(--series-${slot});"></div></div>
        <span class="share-bar-label">${fmtPct(pct)}</span>
      </td>
    </tr>`;
  }).join('');

  return `
  <section class="panel">
    <h2>Tokens by model</h2>
    <p class="panel-sub">Primary: ${esc(t.primary_model)}${t.models_used?.length > 1 ? ` &middot; also used: ${esc(t.models_used.filter(mn => mn !== t.primary_model).join(', '))}` : ''}</p>
    <div class="table-scroll">
    <table>
      <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache create</th><th>Cache read</th><th>Total</th><th>Share</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </section>`;
}

function renderAgentSection(t) {
  const agents = t.tokens_by_agent ?? {};
  const entries = Object.entries(agents).map(([name, v]) => ({ name, ...v }));
  const maxDuration = Math.max(...entries.map(e => e.duration_h ?? 0), 0.0001);

  const bars = entries.map((e, i) => {
    const slot = (i % 4) + 1;
    const widthPct = ((e.duration_h ?? 0) / maxDuration) * 100;
    return `<div class="hbar-row">
      <span class="hbar-label">${esc(e.name)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(widthPct, 1.5)}%;background:var(--series-${slot});"></div></div>
      <span class="hbar-value">${fmtDurationH(e.duration_h)}</span>
    </div>`;
  }).join('');

  const orZero = n => n == null ? '—' : fmtInt(n);
  const rows = entries.map(e => `<tr>
    <td>${esc(e.name)}</td>
    <td>${e.dispatches == null ? '—' : fmtInt(e.dispatches)}</td>
    <td>${orZero(e.input_tokens)}</td>
    <td>${orZero(e.output_tokens)}</td>
    <td>${orZero(e.cache_creation_input_tokens)}</td>
    <td>${orZero(e.cache_read_input_tokens)}</td>
    <td>${fmtInt(e.tokens)}</td>
    <td>${e.tool_uses == null ? '—' : fmtInt(e.tool_uses)}</td>
    <td>${fmtDurationH(e.duration_h)}</td>
  </tr>`).join('');

  // test-run-lead's row (the orchestrator's computed remainder — see
  // build-run-metrics.mjs) is usually the biggest "Tokens" figure here and
  // can look alarming on its own; this note points at the composition
  // columns instead of leaving it as one opaque total.
  const hasComputedRemainder = entries.some(e => e.dispatches == null);

  return `
  <section class="panel">
    <h2>Tokens by agent</h2>
    <p class="panel-sub">Duration per agent persona (${entries.length} in this run)${hasComputedRemainder ? ' &middot; rows with no dispatch count are the orchestrator’s computed remainder (total session tokens minus every real dispatch), not a direct measurement — see its Input/Output/Cache columns for composition' : ''}</p>
    <div class="hbar-chart">${bars}</div>
    <div class="table-scroll">
    <table>
      <thead><tr><th>Agent</th><th>Dispatches</th><th>Input</th><th>Output</th><th>Cache create</th><th>Cache read</th><th>Tokens</th><th>Tool uses</th><th>Duration</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </section>`;
}

function renderTimelineAndTable(m) {
  const tcs = m?.tcs;
  if (!tcs || !tcs.length) {
    return `
  <section class="panel">
    <h2>Test-case timeline</h2>
    <p class="panel-sub panel-empty">No per-test-case data available for this run — its companion reports/metrics/RUN-&lt;id&gt;.json file wasn't found.</p>
  </section>`;
  }

  const maxDuration = Math.max(...tcs.map(tc => tc.duration_ms ?? 0), 1);
  const tcData = {};
  const rows = tcs.map(tc => {
    const st = statusFor(tc.result);
    const widthPct = ((tc.duration_ms ?? 0) / maxDuration) * 100;
    tcData[tc.tc_id] = tc;
    return `<button type="button" class="tc-row" data-tc="${esc(tc.tc_id)}" onclick="showTcDetail('${esc(tc.tc_id)}')">
      <span class="tc-id">${esc(tc.tc_id)}</span>
      <div class="tc-track"><div class="tc-fill" style="width:${Math.max(widthPct, 2)}%;background:${st.color};"></div></div>
      <span class="tc-duration">${fmtDurationMs(tc.duration_ms)}</span>
      <span class="tc-status" style="color:${st.color};">${st.icon} ${st.label}</span>
    </button>`;
  }).join('');

  const tableRows = tcs.map(tc => {
    const st = statusFor(tc.result);
    return `<tr>
      <td>${esc(tc.tc_id)}</td>
      <td><span class="badge" style="background:${st.color};">${st.icon} ${st.label}</span></td>
      <td>${fmtDurationMs(tc.duration_ms)}</td>
      <td>${fmtInt(tc.tokens)}</td>
      <td>${fmtInt(tc.tool_uses)}</td>
    </tr>`;
  }).join('');

  const dataScript = `<script>const TC_DATA = ${JSON.stringify(tcData)};
  function showTcDetail(id) {
    const tc = TC_DATA[id];
    const panel = document.getElementById('tc-detail');
    if (!tc || !panel) return;
    document.querySelectorAll('.tc-row').forEach(r => r.classList.toggle('tc-row-active', r.dataset.tc === id));
    panel.innerHTML = '<h3>' + id + '</h3>' +
      '<div class="stat"><span class="stat-label">Result</span><span class="stat-value">' + tc.result + '</span></div>' +
      '<div class="stat"><span class="stat-label">Duration</span><span class="stat-value">' + (tc.duration_ms/1000).toFixed(1) + 's</span></div>' +
      '<div class="stat"><span class="stat-label">Tokens</span><span class="stat-value">' + tc.tokens.toLocaleString('en-US') + '</span></div>' +
      '<div class="stat"><span class="stat-label">Input / Output</span><span class="stat-value">' + tc.input_tokens + ' / ' + tc.output_tokens.toLocaleString('en-US') + '</span></div>' +
      '<div class="stat"><span class="stat-label">Tool calls</span><span class="stat-value">' + tc.tool_uses + '</span></div>';
    panel.classList.add('tc-detail-visible');
  }
  </script>`;

  const summary = m.summary;
  return `
  <section class="panel">
    <h2>Test-case timeline</h2>
    <p class="panel-sub">Click a case for cost/token/timing detail &middot; bar width &prop; duration${summary ? ` &middot; pass rate ${fmtPct(summary.pass_rate, 0)} (${summary.passed}/${summary.total})` : ''}</p>
    <div class="tc-layout">
      <div class="tc-timeline">${rows}</div>
      <div id="tc-detail" class="tc-detail">
        <p class="panel-empty">Click a test case to see its detail.</p>
      </div>
    </div>
    <div class="table-scroll">
    <table>
      <thead><tr><th>TC</th><th>Result</th><th>Duration</th><th>Tokens</th><th>Tool uses</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
    ${dataScript}
  </section>`;
}

function renderHeader(runId, t, m) {
  const suite = m?.suite ?? t.work_item_brief ?? '—';
  const env = m?.environment ?? '—';
  return `
  <header class="report-header">
    <div class="report-header-main">
      <h1>${esc(runId)}</h1>
      <p class="report-sub">
        <span class="badge-outline">${esc(suite)}</span>
        <span class="badge-outline">${esc(t.maturity)}</span>
        <span class="badge-outline">${esc(t.primary_model)}</span>
        ${env !== '—' ? `<span class="badge-outline">${esc(env)}</span>` : ''}
      </p>
    </div>
    <button type="button" class="theme-toggle" onclick="cycleTheme()" id="theme-toggle-btn">Theme: Auto</button>
  </header>
  <script>
    function cycleTheme() {
      const order = [null, 'light', 'dark'];
      const cur = document.documentElement.getAttribute('data-theme');
      const next = order[(order.indexOf(cur) + 1) % order.length];
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      document.getElementById('theme-toggle-btn').textContent = 'Theme: ' + (next ? next[0].toUpperCase() + next.slice(1) : 'Auto');
    }
  </script>`;
}

function renderFooter(t, sourceTokenomicsName, metricsPath, hasMetrics) {
  return `
  <footer class="report-footer">
    <p>${esc(t.notes)}</p>
    <p class="report-footer-src">Source: <code>reports/tokenomics/${esc(sourceTokenomicsName)}</code>${hasMetrics ? ` &middot; <code>reports/metrics/${esc(basename(metricsPath))}</code>` : ' &middot; no companion metrics file found'}</p>
    <p class="report-footer-gen">Generated ${esc(new Date().toISOString())} by build-tokenomics-html.mjs</p>
  </footer>`;
}

const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --gridline: #e1e0d9;
  --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
  }
}
html[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d;
  --surface: #1a1a19;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #898781;
  --gridline: #2c2c2a;
  --border: rgba(255,255,255,0.10);
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --series-4: #c98500;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  background: var(--page);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.report { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.report-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.report-header h1 { margin: 0 0 6px; font-size: 1.6rem; }
.report-sub { margin: 0; display: flex; gap: 8px; flex-wrap: wrap; }
.badge-outline {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.theme-toggle {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.kpi-card, .panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}
.kpi-card h3, .panel h2 { margin: 0 0 4px; font-size: 1rem; }
.panel h2 { font-size: 1.1rem; }
.panel-sub { margin: 0 0 14px; color: var(--text-secondary); font-size: 0.85rem; }
.panel-empty { color: var(--text-muted); font-style: italic; }
.kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-top: 10px; }
.stat { display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.stat-sub { display: block; font-size: 0.65rem; }
.stat-value { font-size: 1.3rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-value-sm { font-size: 0.85rem; font-weight: 500; }
.kpi-callout {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--gridline);
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.stacked-bar {
  display: flex;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--gridline);
  gap: 2px;
}
.bar-seg { min-width: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 20px; margin-top: 14px; }
.legend-grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; }
.legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
.legend-label { color: var(--text-secondary); }
.legend-value { margin-left: auto; font-variant-numeric: tabular-nums; }
.legend-pct { color: var(--text-muted); }
.table-scroll { overflow-x: auto; margin-top: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--gridline); white-space: nowrap; }
th { color: var(--text-muted); font-weight: 500; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }
td { font-variant-numeric: tabular-nums; }
.share-bar-track { display: inline-block; width: 80px; height: 8px; background: var(--gridline); border-radius: 4px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
.share-bar-fill { height: 100%; border-radius: 4px; }
.share-bar-label { font-size: 0.78rem; color: var(--text-secondary); }
.hbar-chart { display: flex; flex-direction: column; gap: 10px; margin-bottom: 6px; }
.hbar-row { display: grid; grid-template-columns: 140px 1fr 70px; align-items: center; gap: 10px; }
.hbar-label { font-size: 0.82rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hbar-track { height: 14px; background: var(--gridline); border-radius: 4px; overflow: hidden; }
.hbar-fill { height: 100%; border-radius: 4px; }
.hbar-value { font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.tc-layout { display: grid; grid-template-columns: 1fr 260px; gap: 16px; align-items: start; }
.tc-timeline { display: flex; flex-direction: column; gap: 8px; }
.tc-row {
  display: grid;
  grid-template-columns: 64px 1fr 60px 90px;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.tc-row:hover { background: var(--gridline); }
.tc-row-active { border-color: var(--border); background: var(--gridline); }
.tc-id { font-size: 0.82rem; font-weight: 600; }
.tc-track { height: 14px; background: var(--gridline); border-radius: 4px; overflow: hidden; }
.tc-fill { height: 100%; border-radius: 4px; }
.tc-duration { font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.tc-status { font-size: 0.78rem; font-weight: 600; white-space: nowrap; }
.tc-detail {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  background: var(--page);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.tc-detail h3 { margin: 0 0 4px; font-size: 0.95rem; }
.tc-detail .stat-value { font-size: 1rem; }
.badge {
  color: #fff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.report-footer { border-top: 1px solid var(--gridline); padding-top: 14px; font-size: 0.78rem; color: var(--text-muted); }
.report-footer p { margin: 2px 0; }
.report-footer code { font-size: 0.78rem; }
@media (max-width: 720px) {
  .tc-layout { grid-template-columns: 1fr; }
  .tc-row { grid-template-columns: 56px 1fr 50px 76px; }
}
`;

function buildHtml(runId, t, m, sourceTokenomicsName, metricsPath, hasMetrics) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tokenomics report — ${esc(runId)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="report">
${renderHeader(runId, t, m)}
${renderKpiRow(t, m)}
${renderTokenBar(t)}
${renderModelTable(t)}
${renderAgentSection(t)}
${renderTimelineAndTable(m)}
${renderFooter(t, sourceTokenomicsName, metricsPath, hasMetrics)}
</div>
</body>
</html>
`;
}

// --- Main ---

mkdirSync(HTML_DIR, { recursive: true });

for (const tokenomicsPath of targets) {
  const t = readJsonSafe(tokenomicsPath);
  if (!t) {
    console.error(`[build-tokenomics-html] skipping unreadable file: ${tokenomicsPath}`);
    continue;
  }

  const sourceTokenomicsName = basename(tokenomicsPath);
  const runId = sourceTokenomicsName.replace(/\.tokenomics\.json$/, '');
  const metricsPath = join(METRICS_DIR, `${runId}.json`);
  const m = readJsonSafe(metricsPath);
  const hasMetrics = m != null;
  if (!hasMetrics) {
    console.warn(`[build-tokenomics-html] no companion metrics file at ${metricsPath} — rendering without the test-case timeline`);
  }

  const html = buildHtml(runId, t, m, sourceTokenomicsName, metricsPath, hasMetrics);
  const outPath = join(HTML_DIR, `${runId}.tokenomics.html`);
  writeFileSync(outPath, html);
  console.log(`[build-tokenomics-html] wrote ${outPath}`);
}
