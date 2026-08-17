#!/usr/bin/env node
/**
 * build-story.mjs — the design-story hub (C) and coverage matrix (E).
 *
 *   node build-story.mjs --flows <flowspec.json|dir> --screens <dir|glob of *.screens.json>
 *                         --out <dir> [--system <design-system.json>]
 *
 * Reads BOTH a flow spec (build-flowmaps.mjs's input) and screen spec(s)
 * (build-screens.mjs's input) and writes two pages into <out>/, the same
 * site both `--layout story` builds write `flows/<slug>.html` and
 * `screens/<slug>.html` into (see docs/superpowers/specs/2026-08-17-design-
 * story-presentation-uplift.md, section "design-story site layout"):
 *
 *   <out>/index.html      — Problem -> Journey -> Screens -> Coverage
 *   <out>/coverage.html   — every AC id x which node(s)/screen(s)/state(s)
 *                           realize it, red where it's a gap
 *
 * This script does not render mocks or flow posters — it only links to the
 * pages the other two builds produce. It never modifies them.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journeyOrder } from './journey.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ AC ids
 * Two idioms already exist, one per side of the join, and cross-links from
 * T2 already hard-code them into hrefs. Reproducing the exact expressions
 * (not inventing a third) is what keeps `coverage.html#ac-<id>` resolving
 * against what a flow/screen page actually emits. */

// Mirrors flowmap.js's own parseAc() regex: a flow transition's `ac` is one
// free-text string that may name several ids plus trailing prose
// ("AC-2.1 AC-2.2 - see note").
const AC_RE = /(?:AC|HYP)-[0-9]+(?:\.[0-9]+)*(?:\/[0-9.]+)*/g;

// A token itself may be slash-joined shorthand for sibling ids
// ("AC-1.1/1.2" meaning AC-1.1 and AC-1.2"). The token as matched is always
// kept FIRST and whole, because that is the literal string build-screens.mjs
// puts in `coverage.html#ac-<...>` hrefs (String(a).split(' ')[0], never
// slash-split) — losing it would break the anchor those hrefs target. The
// split constituents are added after it purely so each sibling criterion
// still gets its own coverage row.
function expandSlash(id) {
  if (!id.includes('/')) return [id];
  const m = id.match(/^([A-Za-z]+-)([0-9.]+)((?:\/[0-9.]+)+)$/);
  if (!m) return [id];
  const [, prefix, first, restSlashed] = m;
  const rest = restSlashed.slice(1).split('/');
  return [id, prefix + first, ...rest.map(p => prefix + p)];
}

function flowAcIds(raw) {
  if (raw == null) return [];
  const ids = String(raw).match(AC_RE) || [];
  return [...new Set(ids.flatMap(expandSlash))];
}

// Mirrors build-screens.mjs's own anchor normalization exactly:
// String(a).split(' ')[0] applied to one screen/region/state `ac` entry.
function screenAcIds(raw) {
  const arr = raw == null ? [] : (Array.isArray(raw) ? raw : [raw]);
  return [...new Set(arr.flatMap(a => expandSlash(String(a).split(' ')[0])))];
}

/* ------------------------------------------------------------ slugs
 * Copied verbatim from build-flowmaps.mjs's slug() and build-screens.mjs's
 * slugOf(), so a flow/screen's URL here is byte-for-byte the file the other
 * build actually writes. */
const flowSlug = f => String(f.key || f.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const screenSlug = s => String(s.flow || s.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------ computeCoverage
 * Pure data transform, no file/DOM IO — the unit-tested core (E).
 *
 *   flowSpecs:   [ { title, flows:[...], findings:[...] }, ... ]  (as loaded
 *                from --flows; build-flowmaps.mjs's own spec shape)
 *   screenSpecs: [ { flow, title, screens:[...] }, ... ]          (as loaded
 *                from --screens; build-screens.mjs's own spec shape)
 *
 * Returns { [acId]: { nodes:[{flowKey,flowSlug,nodeId}],
 *                      screens:[{screenSlug,screenId,flow}],
 *                      states:[{screenSlug,screenId,stateName}],
 *                      gap: bool, findings:[{title,tone}] } }
 *
 * A criterion is a gap when either:
 *   - no screen realizes it (referenced by a node/state but never listed on
 *     a screen), or
 *   - it is named in a flow spec's `findings` prose (findings carry no
 *     structured `ac` field, so this scans title+body the same way a
 *     transition's own trailing note is read) — a known issue even where a
 *     screen nominally exists.
 */
export function computeCoverage({ flowSpecs = [], screenSpecs = [] } = {}) {
  const criteria = {};
  const ensure = id => criteria[id] || (criteria[id] = { nodes: [], screens: [], states: [], gap: false, findings: [] });

  for (const doc of flowSpecs) {
    for (const flow of doc.flows || []) {
      const key = flow.key || flow.title || 'flow';
      const fSlug = flowSlug(flow);
      for (const node of flow.nodes || []) {
        for (const t of node.transitions || []) {
          for (const id of flowAcIds(t.ac)) {
            const c = ensure(id);
            if (!c.nodes.some(n => n.flowKey === key && n.nodeId === node.id)) {
              c.nodes.push({ flowKey: key, flowSlug: fSlug, nodeId: node.id });
            }
          }
        }
      }
    }
    for (const f of doc.findings || []) {
      const text = [f.title, f.body].filter(Boolean).join(' ');
      for (const id of flowAcIds(text)) {
        const c = ensure(id);
        c.gap = true;
        c.findings.push({ title: f.title, tone: f.tone || '' });
      }
    }
  }

  for (const doc of screenSpecs) {
    const sSlug = screenSlug(doc);
    for (const screen of doc.screens || []) {
      const addScreen = id => {
        const c = ensure(id);
        if (!c.screens.some(s => s.screenSlug === sSlug && s.screenId === screen.id)) {
          c.screens.push({ screenSlug: sSlug, screenId: screen.id, flow: doc.flow });
        }
        return c;
      };
      screenAcIds(screen.ac).forEach(addScreen);
      (screen.regions || []).forEach(r => screenAcIds(r.ac).forEach(addScreen));
      (screen.states || []).forEach(st => {
        screenAcIds(st.ac).forEach(id => {
          addScreen(id);
          const c = criteria[id];
          if (!c.states.some(s => s.screenSlug === sSlug && s.screenId === screen.id && s.stateName === st.name)) {
            c.states.push({ screenSlug: sSlug, screenId: screen.id, stateName: st.name });
          }
        });
      });
    }
  }

  for (const c of Object.values(criteria)) {
    if (c.screens.length === 0) c.gap = true;
  }

  return criteria;
}

/* ------------------------------------------------------------------ CLI */
function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('-h') || argv.includes('--help') || !argv.length) {
    console.log('usage: build-story.mjs --flows <flowspec.json|dir> --screens <dir|glob of *.screens.json> --out <dir> [--system <design-system.json>]');
    process.exit(argv.length ? 0 : 1);
  }
  const flowsArg = resolve(arg('--flows'));
  const screensArg = resolve(arg('--screens'));
  const outDir = resolve(arg('--out'));
  const sysPath = arg('--system');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const flowSpecs = loadDocs(flowsArg, '.flowspec.json');
  const screenSpecs = loadDocs(screensArg, '.screens.json');
  const ds = sysPath ? JSON.parse(readFileSync(resolve(sysPath), 'utf8')) : null;

  const coverage = computeCoverage({ flowSpecs, screenSpecs });

  writeFileSync(join(outDir, 'coverage.html'), coveragePage({ coverage }));
  console.log('wrote coverage.html');

  writeFileSync(join(outDir, 'index.html'), hubPage({ flowSpecs, screenSpecs, coverage, ds }));
  console.log('wrote index.html');
  console.log('\n→', outDir);
}

// Loads one JSON doc from a file path, or every matching *.suffix file from a
// directory (screen-specs' own loadScreenSpecs()/build-flowmaps.mjs's
// loadScreenSpecs() do the same file-vs-dir dance for their own inputs).
function loadDocs(p, suffix) {
  if (!p || !existsSync(p)) return [];
  if (statSync(p).isDirectory()) {
    return readdirSync(p).filter(f => f.endsWith(suffix)).sort()
      .map(f => JSON.parse(readFileSync(join(p, f), 'utf8')));
  }
  return [JSON.parse(readFileSync(p, 'utf8'))];
}

/* ------------------------------------------------------------ page chrome
 * A self-contained look-alike of the two builds' own CHROME/CSS (same token
 * names, light+dark via prefers-color-scheme) so the hub and coverage pages
 * read as part of the same site rather than a bolted-on nav bar. */
const CHROME = `
*{box-sizing:border-box}
:root{
  --surface:#f7fafa;--on-surface:#111;--sc-low:#eef4f4;--sc:#e6eded;--outline-variant:#c7d1d1;
  --primary:#00696e;--on-primary:#fff;--primary-container:#9df0f7;--on-primary-container:#002022;
  --secondary-container:#cce8ea;--on-secondary-container:#051f21;
  --error:#ba1a1a;--error-container:#ffdad6;--on-error-container:#410002;
}
@media (prefers-color-scheme:dark){:root{
  --surface:#0e1414;--on-surface:#dee4e4;--sc-low:#161d1d;--sc:#1a2121;--outline-variant:#3f4948;
  --primary:#4ddae4;--on-primary:#00363a;--primary-container:#004f53;--on-primary-container:#9df0f7;
  --secondary-container:#324b4e;--on-secondary-container:#cce8ea;
  --error:#ffb4ab;--error-container:#93000a;--on-error-container:#ffdad6;
}}
body{margin:0;background:var(--surface);color:var(--on-surface);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px 96px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
nav.bar{display:flex;flex-wrap:wrap;gap:8px;padding:14px 0;position:sticky;top:0;z-index:30;
  background:var(--surface);border-bottom:1px solid var(--outline-variant)}
nav.bar a{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;text-decoration:none;
  font-size:13px;font-weight:500;color:var(--on-surface);border:1px solid var(--outline-variant)}
nav.bar a.here{background:var(--secondary-container);color:var(--on-secondary-container);border-color:transparent}
header{padding:46px 0 6px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;text-transform:uppercase;font-size:12px;font-weight:600;
  letter-spacing:.6px;color:var(--primary);margin-bottom:12px}
.eyebrow::before{content:"";width:24px;height:2px;background:var(--primary);border-radius:2px}
h1{font-size:36px;line-height:44px;font-weight:400;margin:0;text-wrap:balance}
h2{font-size:23px;line-height:30px;font-weight:500;margin:0}
.lede{margin-top:14px;max-width:70ch;font-size:16px;line-height:24px;color:var(--on-surface)}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chip{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;
  border:1px solid var(--outline-variant);background:var(--sc-low);color:var(--on-surface);font-size:13.5px;font-weight:500}
.chip.on{background:var(--secondary-container);color:var(--on-secondary-container);border-color:transparent}
.chip.gap{background:var(--error-container);color:var(--on-error-container);border-color:transparent}
section{margin-top:52px}
.sec-num{display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:600;letter-spacing:.6px;
  text-transform:uppercase;color:var(--primary);margin-bottom:10px}
.sec-num .n{width:26px;height:26px;border-radius:8px;background:var(--primary-container);color:var(--on-primary-container);
  display:grid;place-items:center;font-size:12px}
.lead{max-width:74ch;font-size:15px;line-height:23px;color:var(--on-surface)}
.cards{display:grid;gap:14px;margin-top:18px}
@media(min-width:760px){.cards{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}}
a.card{display:block;text-decoration:none;color:inherit;border:1px solid var(--outline-variant);border-radius:16px;
  padding:18px 20px;background:var(--sc-low)}
a.card:hover{background:var(--sc);border-color:var(--primary)}
a.card .k{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--primary)}
a.card h3{margin:6px 0 8px;font-size:17px;line-height:23px;font-weight:500}
a.card .s{font-size:12.5px;color:var(--on-surface)}
.flowgroup{margin-top:26px}
.flowgroup h3{font-size:16px;font-weight:500;margin:0 0 12px}
.screenchips{display:flex;flex-wrap:wrap;gap:8px}
a.screenchip{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:inherit;
  border:1px solid var(--outline-variant);border-radius:10px;padding:8px 12px;background:var(--sc-low);font-size:13px}
a.screenchip:hover{border-color:var(--primary)}
a.screenchip .id{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--primary)}
table{border-collapse:collapse;width:100%;font-size:13px;line-height:19px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--outline-variant);vertical-align:top}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--on-surface);background:var(--sc);white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tr.gap{background:var(--error-container)}
tr.gap td{color:var(--on-error-container)}
td.id{font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:nowrap}
.tw{overflow-x:auto;border:1px solid var(--outline-variant);border-radius:12px}
.status{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
  padding:2px 8px;border-radius:6px}
.status.ok{background:var(--secondary-container);color:var(--on-secondary-container)}
.status.gap{background:var(--error);color:#fff}
.linklist{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.linklist a{font-size:12px}
.empty{color:var(--on-surface);opacity:.65;font-size:12px}
footer{margin-top:70px;padding-top:20px;border-top:1px solid var(--outline-variant);font-size:12px;line-height:18px;color:var(--on-surface)}
a{color:var(--primary)}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
`;

function shell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CHROME}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;
}

function topNav(current) {
  return `<nav class="bar">
  <a class="${current === 'index' ? 'here' : ''}" href="index.html">Design story</a>
  <a class="${current === 'coverage' ? 'here' : ''}" href="coverage.html">Coverage</a>
</nav>`;
}

/* ------------------------------------------------------------ coverage.html (E) */
function coveragePage({ coverage }) {
  const ids = Object.keys(coverage).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const gapCount = ids.filter(id => coverage[id].gap).length;

  const nodeLinks = c => c.nodes.length
    ? `<ul class="linklist">${c.nodes.map(n =>
        `<li><a href="flows/${esc(n.flowSlug)}.html#node-${esc(n.nodeId)}">${esc(n.flowKey)} · node ${esc(n.nodeId)}</a></li>`).join('')}</ul>`
    : '<span class="empty">none</span>';
  const screenLinks = c => c.screens.length
    ? `<ul class="linklist">${c.screens.map(s =>
        `<li><a href="screens/${esc(s.screenSlug)}.html#${esc(s.screenId)}">${esc(s.screenId)}</a></li>`).join('')}</ul>`
    : '<span class="empty">none — gap</span>';
  const stateLinks = c => c.states.length
    ? `<ul class="linklist">${c.states.map(s =>
        `<li><a href="screens/${esc(s.screenSlug)}.html#${esc(s.screenId)}">${esc(s.stateName)}</a></li>`).join('')}</ul>`
    : '<span class="empty">—</span>';

  const rows = ids.map(id => {
    const c = coverage[id];
    const cls = c.gap ? 'row gap' : 'row';
    const noteBits = c.findings.map(f => esc(f.title)).join('; ');
    return `<tr class="${cls}" id="ac-${esc(id)}">
  <td class="id">${esc(id)}</td>
  <td>${nodeLinks(c)}</td>
  <td>${screenLinks(c)}</td>
  <td>${stateLinks(c)}</td>
  <td><span class="status ${c.gap ? 'gap' : 'ok'}">${c.gap ? 'Gap' : 'Covered'}</span>${noteBits ? `<div class="acnote">${noteBits}</div>` : ''}</td>
</tr>`;
  }).join('\n');

  const body = `${topNav('coverage')}
<header>
  <div class="eyebrow">Coverage</div>
  <h1>Every acceptance criterion, and what realizes it</h1>
  <p class="lede">One row per criterion referenced anywhere in the flow or the screens: the flow node(s) that transition on it, the screen(s) that list it, and the state(s) it drives. A criterion with no realizing screen — or named as an open issue in a flow's findings — is a gap.</p>
  <div class="meta">
    <div class="chip on">${ids.length} criteri${ids.length === 1 ? 'on' : 'a'}</div>
    <div class="chip">${ids.length - gapCount} covered</div>
    <div class="chip${gapCount ? ' gap' : ''}">${gapCount} gap${gapCount === 1 ? '' : 's'}</div>
  </div>
</header>
<section>
  <div class="tw"><table>
    <thead><tr><th>Criterion</th><th>Flow node(s)</th><th>Screen(s)</th><th>State(s)</th><th>Status</th></tr></thead>
    <tbody>
${rows || '<tr><td colspan="5" class="empty">No criteria found in the supplied specs.</td></tr>'}
    </tbody>
  </table></div>
</section>
<footer><p>Generated by <code>build-story.mjs</code> from the flow spec(s) passed via <code>--flows</code> and the screen spec(s) passed via <code>--screens</code>. It renders nothing from either — every link here opens the page the matching build actually produced.</p></footer>`;

  return shell({ title: 'Coverage — design story', body });
}

/* ------------------------------------------------------------ index.html (C) */
function hubPage({ flowSpecs, screenSpecs, coverage, ds }) {
  const flows = flowSpecs.flatMap(doc => doc.flows || []);
  const findingsAll = flowSpecs.flatMap(doc => doc.findings || []);
  const ids = Object.keys(coverage);
  const gapCount = ids.filter(id => coverage[id].gap).length;

  const screensByFlowKey = {};
  for (const doc of screenSpecs) {
    if (doc.flow == null) continue;
    screensByFlowKey[doc.flow] = doc;
  }

  const setTitle = flowSpecs[0]?.title || (ds && ds.name) || 'Design story';

  /* --- Problem --- */
  const problemCards = flows.map(f => `<div class="card" style="padding:18px 20px">
  <div class="k mono" style="color:var(--primary);font-size:12px">${esc(f.key || '')}</div>
  <h3 style="margin:6px 0 8px;font-size:17px;font-weight:500">${esc(f.title || f.key || 'Flow')}</h3>
  ${f.trigger ? `<p class="lead" style="margin:0 0 6px"><b>Trigger —</b> ${esc(f.trigger)}</p>` : ''}
  ${f.bet ? `<p class="lead" style="margin:0"><b>The bet —</b> ${esc(f.bet)}</p>` : ''}
</div>`).join('\n');

  /* --- Journey --- */
  const journeyCards = flows.map(f => {
    const slug = flowSlug(f);
    const screenDoc = screensByFlowKey[f.key];
    const screenCount = screenDoc ? (screenDoc.screens || []).length : 0;
    const nodeCount = (f.nodes || []).length;
    return `<a class="card" href="flows/${esc(slug)}.html">
  <div class="k">${esc(f.key || '')}</div>
  <h3>${esc(f.title || f.key || 'Flow')}</h3>
  <div class="s">${nodeCount} node${nodeCount === 1 ? '' : 's'} · ${screenCount} screen${screenCount === 1 ? '' : 's'}</div>
</a>`;
  }).join('\n');

  /* --- Screens, grouped by flow in journey order --- */
  const screenGroups = flows.map(f => {
    const slug = flowSlug(f);
    const screenDoc = screensByFlowKey[f.key];
    if (!screenDoc || !(screenDoc.screens || []).length) {
      return `<div class="flowgroup">
  <h3>${esc(f.title || f.key || 'Flow')}</h3>
  <p class="empty">No screens yet.</p>
</div>`;
    }
    const sSlug = screenSlug(screenDoc);
    const ordered = journeyOrder(screenDoc.screens);
    const chips = ordered.map(s => `<a class="screenchip" href="screens/${esc(sSlug)}.html#${esc(s.id)}">
  <span class="id">${esc(s.id)}</span>${esc(s.title || '')}
</a>`).join('');
    return `<div class="flowgroup">
  <h3><a href="screens/${esc(sSlug)}.html">${esc(f.title || f.key || 'Flow')}</a></h3>
  <div class="screenchips">${chips}</div>
</div>`;
  }).join('\n');

  const body = `${topNav('index')}
<header>
  <div class="eyebrow">Design story</div>
  <h1>${esc(setTitle)}</h1>
  <p class="lede">Walk the story top to bottom: the problem that started it, the journey a guest takes through it, every screen that journey renders, and the acceptance criteria that tie it all back to the backlog.</p>
  <div class="meta">
    <div class="chip on">${flows.length} flow${flows.length === 1 ? '' : 's'}</div>
    <div class="chip">${ids.length} criteria</div>
    <div class="chip${gapCount ? ' gap' : ''}">${gapCount} gap${gapCount === 1 ? '' : 's'}</div>
  </div>
</header>

<section>
  <div class="sec-num"><span class="n">01</span>Problem</div>
  <p class="lead">What each flow is betting on, and the trigger that starts it.</p>
  <div class="cards">${problemCards || '<p class="empty">No flows in the supplied spec.</p>'}</div>
</section>

<section>
  <div class="sec-num"><span class="n">02</span>Journey</div>
  <p class="lead">Open a flow to walk its poster — every screen, branch and failure path, tagged to the criterion it satisfies.</p>
  <div class="cards">${journeyCards || '<p class="empty">No flows in the supplied spec.</p>'}</div>
</section>

<section>
  <div class="sec-num"><span class="n">03</span>Screens</div>
  <p class="lead">Every screen the journey renders, in the order a guest reaches it.</p>
  ${screenGroups}
</section>

<section>
  <div class="sec-num"><span class="n">04</span>Coverage</div>
  <p class="lead">${ids.length} acceptance criteri${ids.length === 1 ? 'on' : 'a'} referenced across the flow(s) and screens: <b>${ids.length - gapCount} covered</b>, <b>${gapCount} gap${gapCount === 1 ? '' : 's'}</b>.</p>
  <p><a class="card" href="coverage.html" style="display:inline-block">Open the coverage matrix →</a></p>
  ${findingsAll.length ? `<details style="margin-top:16px"><summary style="cursor:pointer;color:var(--primary)">${findingsAll.length} finding${findingsAll.length === 1 ? '' : 's'} from the flow spec</summary>
  ${findingsAll.map(f => `<div class="card" style="margin-top:10px;padding:14px 18px"><b>${esc(f.title)}</b><p class="lead" style="margin-top:4px">${esc(f.body)}</p></div>`).join('')}
  </details>` : ''}
</section>

<footer><p>Generated by <code>build-story.mjs</code> from the flow spec(s) and screen spec(s) it was pointed at. It links to <code>flows/</code> and <code>screens/</code> — the pages <code>build-flowmaps.mjs --layout story</code> and <code>build-screens.mjs --layout story</code> write — and renders nothing itself.</p></footer>`;

  return shell({ title: setTitle, body });
}

/* Only run the file-IO/HTML side when invoked directly, so
 * `import { computeCoverage }` (the test file's unit-test path) never
 * touches argv or the filesystem. Must run after every const/function above
 * it references (CHROME, shell, coveragePage, hubPage) is initialized. */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
