#!/usr/bin/env node
/**
 * build-flowmaps.mjs — turn a flow spec into a set of standalone HTML pages.
 *
 *   node build-flowmaps.mjs <spec.json> --out <dir> [--title "..."]
 *
 * Writes one page per flow plus an index that links them. Every page is a
 * single self-contained file: flowmap.js and its stylesheet are inlined, so
 * the output opens straight from disk with no server and no network.
 *
 * The spec is data only. Positioning, routing and collision handling live in
 * flowmap.js — nothing here computes a coordinate.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LIB = readFileSync(join(__dirname, 'flowmap.js'), 'utf8');
// flowmap.js is a plain CJS UMD file with no package.json of its own in this
// directory (unlike screen-specs/scripts, which pins { "type": "commonjs" }
// next to screenspec.js) — Node's require() walks up to the repo root's
// { "type": "module" } and (mis)loads it as ESM, which throws since it isn't
// valid ESM. Evaluate the already-read source through a minimal manual CJS
// wrapper instead of Node's loader; this is the same source used for the
// browser-inlined <script>, so both sides render off one file, unchanged.
const flowmapModule = { exports: {} };
new Function('module', 'exports', 'require', LIB)(flowmapModule, flowmapModule.exports, require);
const FlowMap = flowmapModule.exports;

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
  console.log(`usage: build-flowmaps.mjs <spec.json> --out <dir> [--title "Set title"] [--layout flat|story] [--screens <dir|file>]

spec.json:
  { "title": "...",                     // set title, shown on the index
    "flows":  [ <flow>, ... ],          // see flowmap.js header for the flow shape
    "composition": { "flows": [...] },  // optional: how the flows join up
    "findings":    [ {group,title,body,tone}, ... ]   // optional: index notes
  }

--layout story writes flow pages into <out>/flows/ instead of <out>/ and, when
--screens points at the matching *.screens.json spec(s), links each flow node
to its screen spec page (../screens/<slug>.html#<screenId>).`);
  process.exit(argv.length ? 0 : 1);
}
const specPath = resolve(argv[0]);
const outDir = resolve(argv[argv.indexOf('--out') + 1] || './flowmaps');
const layout = argv.includes('--layout') ? argv[argv.indexOf('--layout') + 1] : 'flat';
const screensArg = argv.includes('--screens') ? resolve(argv[argv.indexOf('--screens') + 1]) : null;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const setTitle = argv.includes('--title') ? argv[argv.indexOf('--title') + 1]
  : (spec.title || 'Flow maps');
// Story layout writes into a flows/ subdir so it can sit next to build-screens.mjs's
// screens/ output (and the future design-story hub's index.html) without a filename
// collision. Flat (default) keeps writing straight to --out, unchanged.
const flowsDir = layout === 'story' ? join(outDir, 'flows') : outDir;
if (!existsSync(flowsDir)) mkdirSync(flowsDir, { recursive: true });

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = f => String(f.key || f.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cleanTitle = f => String(f.title || f.key || '')
  .replace(/^\s*Flow map\s*[^A-Za-z0-9(]+\s*/, '');

// Mirrors build-screens.mjs's own `slugOf()` exactly (same formula, no trim)
// so a flow node's link to `../screens/<slug>.html` lands on the file that
// script actually writes for that spec.
const screenSlugOf = s => String(s.flow || s.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function loadScreenSpecs(p) {
  if (!p || !existsSync(p)) return [];
  if (statSync(p).isDirectory()) {
    return readdirSync(p).filter(f => f.endsWith('.screens.json'))
      .map(f => JSON.parse(readFileSync(join(p, f), 'utf8')));
  }
  return [JSON.parse(readFileSync(p, 'utf8'))];
}

// node id -> {slug, screenId}, keyed by flow key (the join key shared with
// screen-specs's own `flow` field). Empty/absent --screens just yields {}
// per flow, so a flow renders normally with no screen links (T2 degrades
// gracefully rather than failing when the sibling build hasn't run yet).
const screensByFlow = {};
for (const s of loadScreenSpecs(screensArg)) {
  if (s.flow == null) continue;
  const map = screensByFlow[s.flow] || (screensByFlow[s.flow] = {});
  const sSlug = screenSlugOf(s);
  (s.screens || []).forEach(scr => {
    const nodes = Array.isArray(scr.node) ? scr.node : (scr.node != null ? [scr.node] : []);
    nodes.forEach(n => { map[String(n)] = { slug: sSlug, screenId: scr.id }; });
  });
}

/* ------------------------------------------------------------------ shell */
function page({ title, body, data, glue }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${FlowMap.css}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<script id="flow-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${LIB}</script>
<script>
const DATA = JSON.parse(document.getElementById('flow-data').textContent);
const el=(t,a,p)=>{const n=document.createElement(t);if(a)for(const k in a){k==='class'?n.className=a[k]:n.setAttribute(k,a[k]);}if(p)p.appendChild(n);return n;};
${glue}
</script>
</body>
</html>
`;
}

function nav(flows, current) {
  const items = [['index', 'Overview']].concat(flows.map(f => [slug(f), f.key || cleanTitle(f)]));
  return '<nav class="bar">' + items.map(([s, label]) =>
    `<a class="${s === current ? 'here' : (s === 'index' ? 'home' : '')}" href="${s}.html">${esc(label)}</a>`
  ).join('') + '</nav>';
}

/* ------------------------------------------------------------- flow pages */
const flows = spec.flows || [];
flows.forEach((f, i) => {
  const body = `${nav(flows, slug(f))}
<header>
  <div class="eyebrow label-m">Flow map${f.tab ? ' · ' + esc(f.tab) + ' tab' : ''}</div>
  <h1 class="display-s">${esc(cleanTitle(f))}</h1>
  <p class="lede body-l" id="lede"></p>
  <div class="personas" id="personas"></div>
  <div class="meta" id="meta"></div>
</header>
<section>
  <div class="scope" id="scope"></div>
  <div id="poster"></div>
  <p class="hint">Scroll the canvas sideways to follow the whole path. Whole-numbered screens sit on the main row; decimal ids are branches above the step they hang from. Every connector is drawn from this flow's own transition data, so the picture and the table below cannot disagree.</p>
</section>
<section>
  <div class="sec-head"><div class="num">${String(i + 1).padStart(2, '0')}</div><div>
    <h2 class="headline-s">Every transition</h2>
    <p class="sec-sub body-m">The authoritative edge list: what triggers each move, where it goes, how it navigates, and the criterion it satisfies.</p>
  </div></div>
  <div id="table"></div>
</section>
<section><div class="card"><div id="legend"></div></div></section>
${f.file ? `<footer><p>Source: <code>${esc(f.file)}</code>. Screen skeletons are structural placeholders showing what information is present, not visual design.</p></footer>` : ''}`;

  const glue = `
const F = DATA;
(function(){
  const s = FlowMap.summary(F);
  document.getElementById('lede').textContent = F.trigger ||
    'Every screen, branch and failure path in this flow, with each transition tagged to the criterion it satisfies.';
  const pr = document.getElementById('personas');
  (F.persona||'').split(',').map(x=>x.trim()).filter(Boolean)
    .forEach(x=>{const c=el('span',{class:'pchip'},pr);c.textContent=x;});
  const pl=(k,w)=>k+' '+w+(k===1?'':'s');
  const m = document.getElementById('meta');
  [[pl(s.nodes,'node'),1],[pl(s.decisions,'decision'),0],[pl(s.transitions,'transition'),0],
   [s.criteria+' criteri'+(s.criteria===1?'on':'a'),0]].forEach(([t,on])=>{
    const c=el('div',{class:'chip'+(on?' on':'')},m);c.textContent=t;});

  const host = document.getElementById('scope');
  const about = el('div',{class:'about'},host);
  el('h3',{},about).textContent='What this flow covers';
  const lead = el('p',{class:'lead'},about);
  lead.textContent = F.bet ? 'The bet \\u2014 '+F.bet : 'Behaviour only: screens, branches and failure paths.';
  const cov = el('div',{class:'covers'},about);
  (F.nodes||[]).filter(n=>!FlowMap.isDecision(n)).forEach(n=>{
    const c=el('span',{class:'cchip'},cov);c.textContent=n.label;});
  (F.nodes||[]).filter(FlowMap.isDecision).forEach(n=>{
    const c=el('span',{class:'cchip dec'},cov);c.textContent=n.label;});
  if((F.notes||F.scope||[]).length){
    const d=el('details',{class:'note'},about);
    el('summary',{},d).textContent='Authoring note from the source flow';
    (F.notes||F.scope).forEach(t=>{const p=el('p',{},d);p.textContent=t;});
  }
  const io = el('div',{class:'io'},host);
  const dl = el('dl',{class:'spec'},io);
  const row=(k,v)=>{if(!v)return;el('dt',{},dl).textContent=k;el('dd',{},dl).textContent=v;};
  row('Tab',F.tab); row('Position',F.stack);
  row('Hypothesis',(F.hypothesis||'').split('/').pop().replace(/\\.md$/,''));
  row('Source',F.file);
  const mk=(t,items,cls)=>{
    if(!items||!items.length)return;
    el('h3',{},io).textContent=t;
    const ul=el('ul',{class:'ports'},io);
    items.forEach(x=>{const li=el('li',{class:cls},ul);
      li.textContent=String(x).replace(/^.*\\//,'').replace(/\\.flow\\.md/,'').replace(/^->\\s*/,'');});
  };
  mk('Entered from',F.entered_from,'');
  mk('Hands off to',F.hands_off_to,'out');
})();
FlowMap.render(document.getElementById('poster'), F);
FlowMap.table(document.getElementById('table'), F);
FlowMap.legend(document.getElementById('legend'));
` + (layout === 'story' ? `// story layout (A — cross-link flow -> screens): every rendered node gets a
// stable id="node-<id>" anchor; a node whose id has a matching screen (from
// --screens) becomes a click-through to that screen's spec page. The badge
// FlowMap.render() already stamps with n.id is the only reliable way to
// recover which node a .n cell is, since L.ord's render order isn't exposed.
(function(){
  var SCREEN_MAP = ${JSON.stringify(screensByFlow[f.key] || {})};
  document.querySelectorAll('#poster .n').forEach(function(cell){
    var badge = cell.querySelector('.badge');
    if(!badge) return;
    var id = badge.textContent;
    cell.id = 'node-' + id;
    var hit = SCREEN_MAP[id];
    if(!hit) return;
    var a = document.createElement('a');
    a.href = '../screens/' + hit.slug + '.html#' + hit.screenId;
    a.className = 'node-link';
    a.style.cssText = 'position:absolute;inset:0;';
    a.setAttribute('aria-label', 'Open screen spec for node ' + id);
    cell.appendChild(a);
  });
})();
` : '');
  const html = page({ title: f.page_title || (f.key ? f.key + ' Flow' : cleanTitle(f)), body, data: f, glue });
  writeFileSync(join(flowsDir, slug(f) + '.html'), html);
  console.log('wrote', slug(f) + '.html', html.length, 'bytes');
});

/* ------------------------------------------------------------------ index */
const findings = spec.findings || [];
const groups = [...new Set(findings.map(f => f.group || 'Findings'))];
const indexBody = `${nav(flows, 'index')}
<header>
  <div class="eyebrow label-m">User-flow maps</div>
  <h1 class="display-s">${esc(setTitle)}</h1>
  <p class="lede body-l">${esc(spec.lede || 'One page per flow. Each maps every screen, branch and failure path, with every transition tagged by the criterion it satisfies.')}</p>
  <div class="meta" id="meta"></div>
</header>
<section>
  <div class="sec-head"><div class="num">01</div><div>
    <h2 class="headline-s">The flows</h2>
    <p class="sec-sub body-m">Open each on its own page — a flow is the unit a reviewer signs off on.</p>
  </div></div>
  <div class="cards" id="cards"></div>
</section>
<section>
  <div class="sec-head"><div class="num">02</div><div>
    <h2 class="headline-s">How to read them</h2>
    <p class="sec-sub body-m">Whole numbers are the main path, read left to right. Decimals are branches off the step they hang from. Diamonds are decisions. Start and End markers show where a flow is entered and where it hands off.</p>
  </div></div>
  <div class="card"><div id="legend"></div></div>
</section>
${spec.composition ? `<section>
  <div class="sec-head"><div class="num">03</div><div>
    <h2 class="headline-s">How they compose</h2>
    <p class="sec-sub body-m">${esc(spec.composition_note || 'Where each flow sits, and how they hand off to one another.')}</p>
  </div></div>
  <div id="composition"></div>
</section>` : ''}
${groups.map((g, gi) => `<section>
  <div class="sec-head"><div class="num">${String(gi + (spec.composition ? 4 : 3)).padStart(2, '0')}</div><div>
    <h2 class="headline-s">${esc(g)}</h2>
  </div></div>
  <div class="card">
  ${findings.filter(f => (f.group || 'Findings') === g).map(f =>
    `<div class="finding ${esc(f.tone || '')}"><h4>${esc(f.title)}</h4><p>${esc(f.body)}</p></div>`).join('\n  ')}
  </div>
</section>`).join('\n')}`;

const indexGlue = `
FlowMap.legend(document.getElementById('legend'));
(function(){
  let n=0,d=0,e=0;const acs={};let c=0;
  DATA.flows.forEach(f=>{const s=FlowMap.summary(f);n+=s.nodes;d+=s.decisions;e+=s.transitions;
    (f.nodes||[]).forEach(x=>(x.transitions||[]).forEach(t=>FlowMap.parseAc(t.ac).ids.forEach(a=>{if(!acs[a]){acs[a]=1;c++;}})));});
  const m=document.getElementById('meta');
  [[DATA.flows.length+' flows',1],[n+' nodes',0],[d+' decision points',0],[e+' transitions',0],[c+' criteria',0]]
    .forEach(([t,on])=>{const x=el('div',{class:'chip'+(on?' on':'')},m);x.textContent=t;});
  const cards=document.getElementById('cards');
  DATA.flows.forEach(f=>{
    const s=FlowMap.summary(f);
    const a=el('a',{class:'flowcard',href:f.slug+'.html'},cards);
    if(f.key){const k=el('div',{class:'k'},a);k.textContent=f.key;}
    const h=el('h3',{},a);h.textContent=(f.title||f.key||'').replace(/^\\s*Flow map\\s*[^A-Za-z0-9(]+\\s*/,'').replace(/^[A-Z]+-\\d+:\\s*/,'');
    const p=el('div',{class:'s'},a);
    p.textContent=f.trigger||(s.screens+' screens \\u00b7 '+s.decisions+' decisions');
    const q=el('div',{class:'s',style:'margin-top:8px;opacity:.8'},a);
    q.textContent=s.screens+' screens \\u00b7 '+s.decisions+' decisions \\u00b7 '+s.transitions+' transitions \\u00b7 '+s.criteria+' criteria';
  });
})();
(function(){
  const host=document.getElementById('composition'); if(!host||!DATA.composition) return;
  const list=DATA.composition.flows||[]; const tabs={};
  list.forEach(f=>{const t=f.tab||'Other';(tabs[t]=tabs[t]||[]).push(f);});
  const grid=el('div',{class:'grid two'},host);
  Object.keys(tabs).forEach(tab=>{
    const col=el('div',{class:'tabcol'},grid);
    const th=el('div',{class:'tabhead'},col);
    const t=el('div',{class:'title-m'},th);t.textContent=tab+' tab';
    const c=el('div',{class:'label-m',style:'margin-left:auto;opacity:.85'},th);
    c.textContent=tabs[tab].length+(tabs[tab].length===1?' flow':' flows');
    tabs[tab].forEach((f,i)=>{
      const it=el('div',{class:'stackitem'+(i>0?' sub':'')},col);
      const hd=el('div',{style:'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap'},it);
      const a=el('a',{class:'title-s',href:String(f.id||'').toLowerCase()+'.html'},hd);a.textContent=f.id;
      const lb=el('span',{class:'body-m dim'},hd);lb.textContent=f.label||'';
      if(f.stack_position){const dp=el('div',{class:'depth'},it);dp.textContent=f.stack_position;}
      const ul=el('ul',{class:'ports'},it);
      (f.entry_points||[]).forEach(p=>{const li=el('li',{},ul);li.textContent='in \\u00b7 '+p;});
      (f.exit_points||[]).forEach(p=>{const li=el('li',{class:'out'},ul);li.textContent='out \\u00b7 '+String(p).replace(/^->\\s*/,'');});
    });
  });
})();
`;
const indexData = {
  flows: flows.map(f => ({ ...f, slug: slug(f) })),
  composition: spec.composition || null
};
writeFileSync(join(flowsDir, 'index.html'),
  page({ title: setTitle, body: indexBody, data: indexData, glue: indexGlue }));
console.log('wrote index.html');
console.log('\n→', outDir);
