#!/usr/bin/env node
/**
 * build-screens.mjs — screen specs → standalone HTML reference pages.
 *
 *   node build-screens.mjs --system <design-system.json> --specs <dir|glob...> --out <dir>
 *
 * One page per flow: each screen shown as a device-framed mock beside the spec
 * a developer implements from, plus one mock per named state. Index page is the
 * design-system reference — colour roles, type scale, shape, elevation, the
 * component inventory and the standing platform calls.
 *
 * Pages are self-contained apart from the seed photography, which is referenced
 * relatively so the images aren't duplicated per page.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// screenspec.js is the core renderer; screenspec.web.js mutates the SAME
// cached module object to attach mockWeb/webCss (see its own header comment).
// Requiring both, in this order, gives Node a single ScreenSpec with both
// mobile and web capability.
const ScreenSpec = require(join(__dirname, 'screenspec.js'));
require(join(__dirname, 'screenspec.web.js'));
// The page's inlined <script> runs in a browser, not Node, so it needs the
// three UMD sources concatenated (styles first, then core, then web) rather
// than the `require`d objects above — those only serve Node-side rendering.
const LIB = ['styles.js', 'screenspec.js', 'screenspec.web.js']
  .map(f => readFileSync(join(__dirname, f), 'utf8'))
  .join('\n;\n');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (argv.includes('-h') || argv.includes('--help') || !argv.length) {
  console.log('usage: build-screens.mjs --system <design-system.json> --specs <dir> --out <dir> [--img ../assets/img/]');
  process.exit(argv.length ? 0 : 1);
}
const sysPath = resolve(arg('--system'));
const specDir = resolve(arg('--specs', dirname(sysPath)));
const outDir = resolve(arg('--out', join(specDir, 'html')));
const imgBase = arg('--img', '../assets/img/');
const ds = JSON.parse(readFileSync(sysPath, 'utf8'));
const specs = readdirSync(specDir).filter(f => f.endsWith('.screens.json'))
  .sort()
  .map(f => ({ file: f, data: JSON.parse(readFileSync(join(specDir, f), 'utf8')) }));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugOf = s => String(s.flow || s.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-');

/* -------------------------------------------------------- target-aware chrome
   One design system renders one target throughout a build, so these labels
   are computed once and threaded into every page's glue rather than resolved
   per-call in the browser. Mobile keeps its original MD3/iOS wording exactly;
   web reframes the same "two options were weighed" panel around the chosen
   visual style versus the platform's native behaviour. */
const isWebDS = ScreenSpec.frameKind(ds) === 'web';
const styleLabel = isWebDS
  ? String(ds.style || 'material').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  : 'MD3';
const CALL_TITLE = isWebDS ? `Where ${styleLabel} and native differ` : 'Where MD3 and iOS disagreed';
const CALL_A_LABEL = isWebDS ? styleLabel : 'MD3';
const CALL_B_LABEL = isWebDS ? 'Native' : 'iOS';
const CALL_A_WINS = isWebDS ? `${styleLabel} wins` : 'MD3 wins';
const CALL_B_WINS = 'platform wins';
// Duplicated in miniature from screenspec.web.js's own `webNav` map (kept
// intentionally small and literal here — it only feeds an index-page
// reference table, not rendering, so it doesn't need the shared source).
const WEBNAV = { sheet: 'drawer', push: 'page', root: 'page', dialog: 'modal', fullscreen: 'page',
  page: 'page', split: 'split', modal: 'modal', drawer: 'drawer', panel: 'panel' };
const BREAKPOINTS = [['mobile-web', 'Mobile-web', 400], ['tablet', 'Tablet', 768], ['desktop', 'Desktop', 1280]];

/* ------------------------------------------------------------ page chrome */
const CHROME = `
*{box-sizing:border-box}
body{margin:0;background:var(--m-surface,#f7fafa);color:var(--m-on-surface,#111);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body{overflow-x:hidden}
.wrap{max-width:1360px;margin:0 auto;padding:0 24px 96px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
nav.bar{display:flex;flex-wrap:wrap;gap:8px;padding:14px 0;position:sticky;top:0;z-index:30;
  background:var(--m-surface);border-bottom:1px solid var(--m-outline-variant)}
nav.bar a{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;text-decoration:none;
  font-size:13px;font-weight:500;color:var(--m-on-surface-variant);border:1px solid var(--m-outline-variant)}
nav.bar a.here{background:var(--m-secondary-container);color:var(--m-on-secondary-container);border-color:transparent}
nav.bar a.home{border-style:dashed}
header{padding:46px 0 6px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;text-transform:uppercase;font-size:12px;font-weight:600;
  letter-spacing:.6px;color:var(--m-primary);margin-bottom:12px}
.eyebrow::before{content:"";width:24px;height:2px;background:var(--m-primary);border-radius:2px}
h1{font-size:36px;line-height:44px;font-weight:400;margin:0;text-wrap:balance}
h2{font-size:23px;line-height:30px;font-weight:500;margin:0}
.lede{margin-top:14px;max-width:70ch;font-size:16px;line-height:24px;color:var(--m-on-surface-variant)}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chip{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;
  border:1px solid var(--m-outline-variant);background:var(--m-surface-container-low);
  color:var(--m-on-surface-variant);font-size:13.5px;font-weight:500}
.chip.on{background:var(--m-secondary-container);color:var(--m-on-secondary-container);border-color:transparent}
#bptoggle{display:flex;gap:8px;margin-top:10px}
.bpbtn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;cursor:pointer;
  border:1px solid var(--m-outline-variant);background:var(--m-surface-container-low);
  color:var(--m-on-surface-variant);font-size:13px;font-weight:500;font-family:inherit}
.bpbtn.on{background:var(--m-secondary-container);color:var(--m-on-secondary-container);border-color:transparent}
.screen{margin-top:44px;border-top:1px solid var(--m-outline-variant);padding-top:28px}
.screen h2 .id{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--m-primary);margin-right:10px}
.purpose{margin:8px 0 0;font-size:15px;line-height:23px;color:var(--m-on-surface-variant);max-width:74ch}
.layout{display:block;margin-top:20px}
/* the mock strip owns a full-width row and scrolls on its own axis, so the
   page never scrolls sideways no matter how many states a screen has */
.mocks-row{position:relative;margin:0 -24px;padding:4px 24px 10px}
.mocks{display:flex;gap:20px;overflow-x:auto;overflow-y:hidden;padding-bottom:10px;scrollbar-width:thin}
.mocks::-webkit-scrollbar{height:8px}
.mocks::-webkit-scrollbar-thumb{background:var(--m-outline-variant);border-radius:4px}
.mockcase{display:flex;flex-direction:column;gap:9px;align-items:center}
.mockcase .cap{font-size:11.5px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;
  color:var(--m-on-surface-variant);text-align:center;max-width:390px}
.mockcase .cap em{display:block;font-style:normal;font-weight:400;text-transform:none;letter-spacing:0;
  font-size:12px;margin-top:3px;opacity:.85}
.panels{display:flex;flex-direction:column;gap:16px;min-width:0;margin-top:22px}
.undrawn{margin-top:10px;font-size:11.5px;line-height:16px;color:var(--m-on-surface-variant);
  padding-left:11px;border-left:2px solid var(--m-outline-variant);max-width:760px}
.statehint{font-size:12px;color:var(--m-on-surface-variant);margin:0 0 8px}
.panel{border:1px solid var(--m-outline-variant);border-radius:16px;background:var(--m-surface-container-low);padding:16px 20px}
.panel h3{margin:0 0 12px;font-size:11.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--m-primary)}
.kv{display:grid;grid-template-columns:132px 1fr;gap:6px 16px;font-size:13.5px;line-height:20px}
.kv dt{color:var(--m-on-surface-variant);font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding-top:2px}
.kv dd{margin:0}
.ac{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 7px;border-radius:6px;
  margin:0 4px 4px 0;background:var(--m-primary-container);color:var(--m-on-primary-container)}
table{border-collapse:collapse;width:100%;font-size:13px;line-height:19px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--m-outline-variant);vertical-align:top}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--m-on-surface-variant);
  background:var(--m-surface-container);white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
td.t{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--m-primary);white-space:nowrap}
.tw{overflow-x:auto;border:1px solid var(--m-outline-variant);border-radius:12px}
.call{border-left:3px solid var(--m-tertiary);padding:2px 0 2px 14px}
.call+.call{margin-top:14px}
.call h4{margin:0 0 4px;font-size:13.5px;font-weight:600}
.call p{margin:0;font-size:13px;line-height:19px;color:var(--m-on-surface-variant)}
.call .pick{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
  padding:2px 8px;border-radius:6px;background:var(--m-tertiary-container);color:var(--m-on-tertiary-container);margin-left:6px}
.note{border-left:3px solid var(--m-error);padding:2px 0 2px 14px;font-size:13px;line-height:19px;color:var(--m-on-surface-variant)}
.note+.note{margin-top:12px}
ul.plain{margin:0;padding-left:18px;font-size:13.5px;line-height:20px;color:var(--m-on-surface-variant)}
ul.plain li{margin-bottom:4px}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}
.sw{border:1px solid var(--m-outline-variant);border-radius:12px;overflow:hidden}
.sw .band{height:56px}
.sw .lab{padding:7px 10px;font-size:11px;line-height:15px}
.sw .lab b{display:block;font-family:ui-monospace,Menlo,monospace;font-weight:600}
.sw .lab span{color:var(--m-on-surface-variant);font-family:ui-monospace,Menlo,monospace}
footer{margin-top:70px;padding-top:20px;border-top:1px solid var(--m-outline-variant);
  font-size:12px;line-height:18px;color:var(--m-on-surface-variant)}
a{color:var(--m-primary)}
:focus-visible{outline:3px solid var(--m-primary);outline-offset:2px}
`;

function page({ title, body, data, glue }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${ScreenSpec.tokens(ds)}${CHROME}${ScreenSpec.css}${ScreenSpec.frameKind(ds) === 'web' ? ScreenSpec.webCss : ''}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<script id="d" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${LIB}</script>
<script>
const DATA=JSON.parse(document.getElementById('d').textContent);
const IMG=${JSON.stringify(imgBase)};
const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;};
${glue}
/* A mock renders from the top of the screen. When a state's point sits further
   down — an inline error beside the stepper that triggered it — scroll the
   frame to it, exactly as the guest would already have done to get there. */
requestAnimationFrame(() => {
  document.querySelectorAll('.body[data-focus]').forEach(b => {
    const want = b.getAttribute('data-focus');
    const t = [...b.querySelectorAll('[data-region]')]
      .find(e => (e.getAttribute('data-region') || '').startsWith(want));
    if (!t) return;
    const pad = 12;
    const y = t.offsetTop - pad;
    const max = b.scrollHeight - b.clientHeight;
    b.scrollTop = Math.max(0, Math.min(y, max));
    if (b.scrollTop > 2) b.classList.add('scrolled');
  });
});
</script>
</body>
</html>
`;
}

const navBar = cur => '<nav class="bar">' +
  `<a class="${cur === 'index' ? 'here' : 'home'}" href="index.html">Design system</a>` +
  specs.map(s => `<a class="${slugOf(s.data) === cur ? 'here' : ''}" href="${slugOf(s.data)}.html">${esc(s.data.flow || s.data.title)}</a>`).join('') +
  '</nav>';

/* ------------------------------------------------------------ flow pages */
for (const { data } of specs) {
  const slug = slugOf(data);
  const body = `${navBar(slug)}
<header>
  <div class="eyebrow">Screen specs${data.flow ? ' · ' + esc(data.flow) : ''}</div>
  <h1>${esc(data.title || data.flow)}</h1>
  <p class="lede">Each screen below is shown as it should look, beside the spec to build it from. Both are generated from one source, so the mock and the contract cannot drift apart.</p>
  <div class="meta" id="meta"></div>
  ${isWebDS ? '<div class="meta" id="bptoggle"></div>' : ''}
</header>
<div id="screens"></div>
<footer><p>Mocks render the spec's own <code>regions</code> through the tokens in <code>design-system.json</code>. They show structure, hierarchy and real seeded content — not final visual polish. Where a spec records an open question, it is reproduced verbatim rather than resolved.</p></footer>`;

  const glue = `
(function(){
  const m=document.getElementById('meta');
  const scr=DATA.screens||[];
  const states=scr.reduce((a,s)=>a+((s.states||[]).length),0);
  const acs=new Set();scr.forEach(s=>(s.ac||[]).forEach(a=>acs.add(String(a).split(' ')[0])));
  const calls=scr.reduce((a,s)=>a+((s.platform||[]).length),0);
  [[scr.length+' screens',1],[states+' states',0],[acs.size+' criteria',0],[calls+' platform calls',0]]
    .forEach(([t,on])=>{const c=el('div','chip'+(on?' on':''));c.textContent=t;m.appendChild(c);});

  const host=document.getElementById('screens');
  // Rebuildable: a web page's breakpoint toggle re-invokes this for every
  // case on the page rather than patching a live tree, so \`DATA.system.__bp\`
  // is always the single source of truth a fresh render reads from.
  function renderScreens(){
  host.innerHTML='';
  scr.forEach(s=>{
    const sec=el('section','screen'); sec.id=s.id;
    const h2=el('h2'); const id=el('span','id'); id.textContent=s.id; h2.appendChild(id);
    h2.appendChild(document.createTextNode(s.title||'')); sec.appendChild(h2);
    if(s.purpose) sec.appendChild(el('p','purpose',s.purpose));
    const lay=el('div','layout');

    const mrow=el('div','mocks-row');
    const mocks=el('div','mocks');
    const addMock=(name,caption,sub)=>{
      const cse=el('div','mockcase');
      const holder=el('div');
      ScreenSpec.mock(holder,s,DATA.system||{},name,IMG);
      cse.appendChild(holder.firstChild);
      const cap=el('div','cap'); cap.textContent=caption;
      if(sub){const e=el('em');e.textContent=sub;cap.appendChild(e);}
      cse.appendChild(cap);
      // commentary the spec carried but the screen shouldn't display
      const notes=ScreenSpec.annotations(s,name);
      if(notes.length){const an=el('div','annots');
        notes.forEach(t=>{const d=el('div','annot');d.textContent=t;an.appendChild(d);});
        cse.appendChild(an);}
      mocks.appendChild(cse);
    };
    addMock(null,'Default');
    // Only draw a state that actually renders differently. Specs often describe
    // a state in prose ("the empty inset is replaced by one card per saved
    // hotel"), which no renderer can apply mechanically — drawing eight
    // identical phones labelled as eight different states is worse than
    // drawing one and saying so. The States table below carries them all.
    const sig=st=>JSON.stringify(ScreenSpec.applyState(s,st)
      .map(r=>[r.type,r.label,Array.isArray(r.content)?r.content.join('|'):(r.content||'')]));
    const base=sig(null); const undrawn=[], leaves=[], resting=[];
    (s.states||[]).forEach(st=>{
      if(/default/i.test(st.name)) return;            // already the default mock
      // A state that resolves to no regions is a transition: the dialog
      // dismisses, the cart empties into another screen, payment resolves and
      // navigates away. Drawing a blank phone would claim the screen still
      // exists in that state, which is the opposite of what the spec says.
      const rs=ScreenSpec.applyState(s,st.name);
      if(rs.length===0){leaves.push(st.name);return;}
      // Everything left is a pinned action — the screen body is empty because
      // the state only describes a delta that removes content. Drawing a phone
      // with nothing but a button bar claims less than the spec says.
      if(rs.every(r=>/^(cta|secondary-cta|price)$/.test(r.type))){resting.push(st.name);return;}
      if(sig(st.name)===base){undrawn.push(st.name);return;}
      addMock(st.name, st.name, st.trigger);
    });
    if(leaves.length){
      const n=el('div','undrawn');
      n.textContent='Leaves this screen — no mock: '+leaves.join(' · ')
        +'. The screen is dismissed or replaced; see the States table for where it goes.';
      mrow.appendChild(n);
    }
    if(resting.length){
      const n=el('div','undrawn');
      n.textContent='Returns to the default composition — no separate mock: '+resting.join(' · ')
        +'. These states only remove content; what remains is the screen as first shown.';
      mrow.appendChild(n);
    }
    if(undrawn.length){
      const n=el('div','undrawn');
      n.textContent='Described in prose, not separately drawn: '+undrawn.join(' · ')
        +' — see the States table below.';
      mrow.appendChild(n);
    }
    mrow.appendChild(mocks); lay.appendChild(mrow);

    const panels=el('div','panels');
    const panel=(title)=>{const p=el('div','panel');p.appendChild(el('h3',null,title));panels.appendChild(p);return p;};

    const p1=panel('Traceability');
    const dl=el('dl','kv');
    const kv=(k,v)=>{if(!v||(Array.isArray(v)&&!v.length))return;
      dl.appendChild(el('dt',null,k));
      const dd=el('dd');
      if(k==='Criteria'){(Array.isArray(v)?v:[v]).forEach(a=>{const s2=el('span','ac');s2.textContent=a;dd.appendChild(s2);});}
      else dd.textContent=Array.isArray(v)?v.join(', '):String(v);
      dl.appendChild(dd);};
    kv('Flow node',s.node); kv('Presentation',(s.nav||{}).kind); kv('Criteria',s.ac);
    if(s.content) kv('Seeded content',Object.entries(s.content).map(([k,v])=>k+': '+v).join(' · '));
    p1.appendChild(dl);

    if((s.regions||[]).length){
      const p=panel('Regions, top to bottom');
      const tw=el('div','tw'); const t=el('table');
      t.innerHTML='<thead><tr><th>Type</th><th>What it is</th><th>Material component</th><th>Tokens</th><th>AC</th></tr></thead>';
      const tb=el('tbody');
      s.regions.forEach(r=>{
        const tr=el('tr');
        const td=(c,cls)=>{const d=el('td',cls);if(typeof c==='string')d.textContent=c;else if(c)d.appendChild(c);tr.appendChild(d);};
        td(r.type,'t');
        td([r.label,(Array.isArray(r.content)?r.content.join(' · '):r.content)].filter(Boolean).join(' — '));
        td(((r.m3||{}).component)||'');
        td(Object.values(((r.m3||{}).tokens)||{}).filter(Boolean).join(' · '));
        const acd=el('span'); (r.ac?[r.ac]:[]).forEach(a=>{const s2=el('span','ac');s2.textContent=a;acd.appendChild(s2);});
        td(acd);
        tb.appendChild(tr);
      });
      t.appendChild(tb); tw.appendChild(t); p.appendChild(tw);
    }

    if((s.states||[]).length){
      const p=panel('States');
      const tw=el('div','tw'); const t=el('table');
      t.innerHTML='<thead><tr><th>State</th><th>Trigger</th><th>What changes</th><th>AC</th></tr></thead>';
      const tb=el('tbody');
      s.states.forEach(st=>{
        const tr=el('tr');
        const td=(c,cls)=>{const d=el('td',cls);if(typeof c==='string')d.textContent=c;else if(c)d.appendChild(c);tr.appendChild(d);};
        td(st.name,'t'); td(st.trigger||'');
        td((st.changes||[]).map(c=>typeof c==='string'?c:((c.region||c.label||c.type||'')+(c.content?': '+(Array.isArray(c.content)?c.content.join(' '):c.content):''))).join(' · '));
        const acd=el('span'); (st.ac?(Array.isArray(st.ac)?st.ac:[st.ac]):[]).forEach(a=>{const s2=el('span','ac');s2.textContent=a;acd.appendChild(s2);});
        td(acd);
        tb.appendChild(tr);
      });
      t.appendChild(tb); tw.appendChild(t); p.appendChild(tw);
    }

    if((s.platform||[]).length){
      const p=panel(${JSON.stringify(CALL_TITLE)});
      s.platform.forEach(c=>{
        const rc=ScreenSpec.readCall(c);
        const d=el('div','call');
        const h4=el('h4',null,rc.topic||'');
        const pk=el('span','pick'); pk.textContent=rc.chose==='b'?${JSON.stringify(CALL_B_WINS)}:${JSON.stringify(CALL_A_WINS)};
        h4.appendChild(pk); d.appendChild(h4);
        d.appendChild(el('p',null,[rc.a&&(${JSON.stringify(CALL_A_LABEL + ': ')}+rc.a),rc.b&&(${JSON.stringify(CALL_B_LABEL + ': ')}+rc.b),rc.why].filter(Boolean).join(' — ')));
        p.appendChild(d);
      });
    }

    if(s.a11y||s.swiftui){
      const p=panel('Implementation');
      const dl2=el('dl','kv');
      const add=(k,v)=>{if(!v)return;dl2.appendChild(el('dt',null,k));
        dl2.appendChild(el('dd',null,typeof v==='string'?v:(Array.isArray(v)?v.join(' · '):Object.entries(v).map(([a,b])=>a+': '+b).join(' · '))));};
      if(s.swiftui){add('View',s.swiftui.view);add('Navigation',s.swiftui.navigation);add('State',s.swiftui.state);
        if(s.swiftui.notes)add('Notes',s.swiftui.notes);}
      if(s.a11y)Object.entries(s.a11y).forEach(([k,v])=>add(k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()),v));
      p.appendChild(dl2);
    }

    if((s.refs||[]).length){
      const p=panel('Grounded in');
      const ul=el('ul','plain');
      s.refs.forEach(r=>{const li=el('li');
        li.textContent=[r.source,r.id,r.why].filter(Boolean).join(' — ');
        if(r.url){li.appendChild(document.createTextNode(' '));const a=el('a',null,'ref');a.href=r.url;a.target='_blank';li.appendChild(a);}
        ul.appendChild(li);});
      p.appendChild(ul);
    }

    if((s.notes||[]).length){
      const p=panel('Left open');
      s.notes.forEach(n=>{const d=el('div','note');d.textContent=typeof n==='string'?n:JSON.stringify(n);p.appendChild(d);});
    }

    lay.appendChild(panels); sec.appendChild(lay); host.appendChild(sec);
  });
  }
  renderScreens();

  ${isWebDS ? `
  // Web target: a breakpoint toggle rebuilds every mock on the page against
  // DATA.system.__bp — the same object every mockWeb() call reads from — so
  // switching breakpoints re-renders the whole page's cases in one step
  // rather than resizing frames in place.
  (function(){
    DATA.system.__bp = DATA.system.__bp || 'desktop';
    const tog = document.getElementById('bptoggle');
    const bps = ${JSON.stringify(BREAKPOINTS.map(([v, label]) => [v, label]))};
    function paintToggle(){
      tog.innerHTML='';
      bps.forEach(([v,label])=>{
        const b=el('button','bpbtn'+(DATA.system.__bp===v?' on':''));
        b.type='button'; b.textContent=label; b.setAttribute('data-bp',v);
        b.addEventListener('click',function(){
          DATA.system.__bp=v; renderScreens(); paintToggle();
        });
        tog.appendChild(b);
      });
    }
    paintToggle();
  })();
  ` : ''}
})();
`;
  writeFileSync(join(outDir, slug + '.html'),
    page({ title: (data.flow ? data.flow + ' screens' : data.title), body, data: { ...data, system: ds }, glue }));
  console.log('wrote', slug + '.html');
}

/* ------------------------------------------------------------ index page */
const roles = (ds.color.roles || {}).light || {};
const indexBody = `${navBar('index')}
<header>
  <div class="eyebrow">Design system</div>
  <h1>${esc(ds.name || 'Design system')}</h1>
  <p class="lede">${esc((ds.north_star || ds.color.seed?.why || '').split('. ')[0] + '.')}</p>
  <div class="meta" id="meta"></div>
</header>
<section style="margin-top:40px">
  <h2>Colour roles</h2>
  <p class="lede" style="margin-top:8px">${esc(ds.color.seed?.why || '')}</p>
  <div class="swatches" id="sw" style="margin-top:18px"></div>
</section>
<section style="margin-top:44px"><h2>Type scale</h2>
  <p class="lede" style="margin-top:8px">${esc((ds.type || {}).principle || '')}</p>
  <div class="tw" style="margin-top:16px" id="type"></div></section>
<section style="margin-top:44px"><h2>Shape &amp; elevation</h2><div class="tw" style="margin-top:16px" id="shape"></div></section>
<section style="margin-top:44px"><h2>Components</h2>
  <p class="lede" style="margin-top:8px">Every region type a spec may use, its Material component, and the SwiftUI view to reach for.</p>
  <div class="tw" style="margin-top:16px" id="comp"></div></section>
${isWebDS ? `<section style="margin-top:44px"><h2>Web presentation</h2>
  <p class="lede" style="margin-top:8px">Style, viewport breakpoints, and how a screen's presentation kind maps to browser chrome.</p>
  <div class="panel" style="margin-top:16px" id="webkv"></div>
  <div class="tw" style="margin-top:16px" id="webnav"></div></section>` : ''}
<section style="margin-top:44px"><h2>Standing platform calls</h2>
  <p class="lede" style="margin-top:8px">${esc(CALL_TITLE)}. ${isWebDS
    ? `Decided once, app-wide, so no screen re-litigates them. Per DEC-018: structure and interaction follow native browser behaviour, surface and styling follow ${esc(styleLabel)}.`
    : 'Decided once, app-wide, so no screen re-litigates them. Per DEC-018: structure and interaction follow the platform, surface and styling follow Material.'}</p>
  <div class="panel" style="margin-top:16px" id="calls"></div></section>
<footer><p>Generated from <code>design-system.json</code>. Change a token there and every mock in this set follows.</p></footer>`;

const indexGlue = `
(function(){
  const ds=DATA.system;
  const m=document.getElementById('meta');
  [[DATA.flows+' flows',1],[DATA.screens+' screens',0],[(ds.standing_platform_calls||[]).length+' platform calls',0],
   [(ds.component_inventory||[]).length+' components',0]].forEach(([t,on])=>{
    const c=el('div','chip'+(on?' on':''));c.textContent=t;m.appendChild(c);});

  const sw=document.getElementById('sw');
  const light=(ds.color.roles||{}).light||{};
  Object.keys(light).filter(k=>!/^on[A-Z]/.test(k)).forEach(k=>{
    const d=el('div','sw');
    const band=el('div','band'); band.style.background=light[k];
    const on=light['on'+k.charAt(0).toUpperCase()+k.slice(1)];
    if(on){band.style.color=on;band.style.display='grid';band.style.placeItems='center';
      band.style.fontSize='11px';band.style.fontWeight='600';band.textContent='Aa';}
    d.appendChild(band);
    const lab=el('div','lab'); const b=el('b',null,k); const s=el('span',null,light[k]);
    lab.appendChild(b);lab.appendChild(s); d.appendChild(lab); sw.appendChild(d);
  });

  const mkTable=(host,cols,rows)=>{
    const t=el('table');
    t.innerHTML='<thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead>';
    const tb=el('tbody');
    rows.forEach(r=>{const tr=el('tr');r.forEach((c,i)=>{const td=el('td',i===0?'t':null);td.textContent=c==null?'':String(c);tr.appendChild(td);});tb.appendChild(tr);});
    t.appendChild(tb);host.appendChild(t);
  };
  mkTable(document.getElementById('type'),['M3 role','M3 pt','iOS text style','Default pt','Weight','Used for'],
    ((ds.type||{}).scale||[]).map(t=>[t.m3_role,t.m3_size_pt,t.ios_text_style,t.ios_default_pt,t.weight,t.usage]));
  mkTable(document.getElementById('shape'),['Role','Radius','Used for'],
    ((ds.shape||{}).scale||[]).map(s=>[s.m3_role,(s.radius_pt!=null?s.radius_pt+'pt':''),s.usage]));
  mkTable(document.getElementById('comp'),['Region type','Material component','iOS realisation','SwiftUI'],
    (ds.component_inventory||[]).map(c=>[c.region_type,c.m3_component,c.ios_realization,c.swiftui||c.swiftui_view||'']));

  ${isWebDS ? `
  const webkv=document.getElementById('webkv');
  const dl=el('dl','kv');
  const kv=(k,v)=>{dl.appendChild(el('dt',null,k));dl.appendChild(el('dd',null,v));};
  kv('Style',${JSON.stringify(styleLabel)});
  kv('Breakpoints',${JSON.stringify(BREAKPOINTS.map(([, label, w]) => `${label} (${w}px)`).join(' · '))});
  webkv.appendChild(dl);

  const WEBNAV=${JSON.stringify(WEBNAV)};
  const navKinds=${JSON.stringify([...new Set(
    specs.flatMap(s => (s.data.screens || []).map(scr => (scr.nav || {}).kind)).filter(Boolean)
  )].sort())};
  mkTable(document.getElementById('webnav'),['Screen nav kind','Web presentation'],
    navKinds.map(k=>[k,WEBNAV[k]||'page']));
  ` : ''}

  const calls=document.getElementById('calls');
  (ds.standing_platform_calls||[]).forEach(c=>{
    const rc=ScreenSpec.readCall(c);
    const d=el('div','call');
    const h4=el('h4',null,rc.topic||c.title||'');
    const pk=el('span','pick'); pk.textContent=rc.chose==='b'?${JSON.stringify(CALL_B_WINS)}:(rc.chose==='a'?${JSON.stringify(CALL_A_WINS)}:'decided');
    h4.appendChild(pk); d.appendChild(h4);
    d.appendChild(el('p',null,[rc.a&&(${JSON.stringify(CALL_A_LABEL + ': ')}+rc.a),rc.b&&(${JSON.stringify(CALL_B_LABEL + ': ')}+rc.b),c.decision,rc.why].filter(Boolean).join(' — ')));
    calls.appendChild(d);
  });
})();
`;
const totalScreens = specs.reduce((a, s) => a + (s.data.screens || []).length, 0);
writeFileSync(join(outDir, 'index.html'),
  page({ title: (ds.name || 'Design system'), body: indexBody,
         data: { system: ds, flows: specs.length, screens: totalScreens }, glue: indexGlue }));
console.log('wrote index.html');
console.log('\n→', outDir, `(${specs.length} flows, ${totalScreens} screens)`);
