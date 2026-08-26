/*!
 * flowmap.js — user-flow map renderer
 * ------------------------------------------------------------------
 * Draws a flow spec as a poster: numbered screen wireframes on a main
 * row, decimal-id branches on an upper row, decision diamonds, Start
 * and End markers, and orthogonal connectors routed from the spec's own
 * transition data. Layout, lane packing, routing and label collision
 * are all handled here — callers supply data, never coordinates.
 *
 * Runs in the browser (window.FlowMap) and in Node (module.exports),
 * so the same file both renders a page and is inlined into one.
 *
 * API
 *   FlowMap.render(hostEl, flow)        -> draws the poster
 *   FlowMap.table(hostEl, flow)         -> draws the authoritative edge table
 *   FlowMap.legend(hostEl)              -> draws the key
 *   FlowMap.summary(flow)               -> {screens,decisions,transitions,criteria}
 *   FlowMap.css                         -> the stylesheet this markup expects
 *
 * A flow spec is:
 *   { key, title, trigger?, persona?, bet?, tab?, stack?,
 *     entered_from?[], hands_off_to?[], outs?[], names?{}, keys?{},
 *     nodes: [ { id, label, archetype, regions[], decision?{question,outcomes[]},
 *                transitions: [ {target, trigger, kind, nav, ac} ] } ] }
 * Node ids drive layout: whole numbers form the main row in order,
 * decimals hang above the step they branch from. Nothing else positions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowMap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var CSS = "\n:root{\n  --primary:#00696e;--on-primary:#fff;--primary-container:#9df0f7;--on-primary-container:#002022;\n  --secondary:#4a6365;--on-secondary:#fff;--secondary-container:#cce8ea;--on-secondary-container:#051f21;\n  --tertiary:#4c5f7d;--on-tertiary:#fff;--tertiary-container:#d4e3ff;--on-tertiary-container:#061c36;\n  --error:#ba1a1a;--error-container:#ffdad6;--on-error-container:#410002;\n  --surface:#f5fafa;--on-surface:#171d1d;\n  --sc-lowest:#fff;--sc-low:#eff5f5;--sc:#e9efef;--sc-high:#e3eaea;\n  --on-surface-variant:#3f4948;--outline:#6f7979;--outline-variant:#bec8c8;\n  --skeleton:#c3d2d6;--skeleton-strong:#9fb4ba;--canvas:#eef4f5;\n  --edge:#7b8a8c;\n  --shadow:0 1px 2px rgba(0,0,0,.2),0 1px 3px 1px rgba(0,0,0,.1);\n  --shadow-2:0 1px 2px rgba(0,0,0,.2),0 2px 6px 2px rgba(0,0,0,.1);\n  --font:ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;\n  --mono:ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,Consolas,monospace;\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme=\"light\"]){\n  --primary:#4ddae4;--on-primary:#00363a;--primary-container:#004f53;--on-primary-container:#9df0f7;\n  --secondary:#b1cbcd;--on-secondary:#1c3436;--secondary-container:#324b4e;--on-secondary-container:#cce8ea;\n  --tertiary:#b4c8eb;--on-tertiary:#1d314d;--tertiary-container:#354a67;--on-tertiary-container:#d4e3ff;\n  --error:#ffb4ab;--error-container:#93000a;--on-error-container:#ffdad6;\n  --surface:#0e1414;--on-surface:#dee4e4;\n  --sc-lowest:#090f0f;--sc-low:#161d1d;--sc:#1a2121;--sc-high:#252b2c;\n  --on-surface-variant:#bec8c8;--outline:#899393;--outline-variant:#3f4948;\n  --skeleton:#3c4b4f;--skeleton-strong:#5a6f75;--canvas:#131a1b;--edge:#8b9a9c;\n  --shadow:0 1px 2px rgba(0,0,0,.45),0 1px 3px 1px rgba(0,0,0,.3);\n  --shadow-2:0 1px 2px rgba(0,0,0,.45),0 2px 6px 2px rgba(0,0,0,.3);\n}}\n:root[data-theme=\"dark\"]{\n  --primary:#4ddae4;--on-primary:#00363a;--primary-container:#004f53;--on-primary-container:#9df0f7;\n  --secondary:#b1cbcd;--on-secondary:#1c3436;--secondary-container:#324b4e;--on-secondary-container:#cce8ea;\n  --tertiary:#b4c8eb;--on-tertiary:#1d314d;--tertiary-container:#354a67;--on-tertiary-container:#d4e3ff;\n  --error:#ffb4ab;--error-container:#93000a;--on-error-container:#ffdad6;\n  --surface:#0e1414;--on-surface:#dee4e4;\n  --sc-lowest:#090f0f;--sc-low:#161d1d;--sc:#1a2121;--sc-high:#252b2c;\n  --on-surface-variant:#bec8c8;--outline:#899393;--outline-variant:#3f4948;\n  --skeleton:#3c4b4f;--skeleton-strong:#5a6f75;--canvas:#131a1b;--edge:#8b9a9c;\n  --shadow:0 1px 2px rgba(0,0,0,.45),0 1px 3px 1px rgba(0,0,0,.3);\n  --shadow-2:0 1px 2px rgba(0,0,0,.45),0 2px 6px 2px rgba(0,0,0,.3);\n}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--surface);color:var(--on-surface);font-family:var(--font);-webkit-font-smoothing:antialiased}\n.wrap{max-width:1180px;margin:0 auto;padding:0 24px 88px}\n.display-s{font-size:36px;line-height:44px;font-weight:400;text-wrap:balance;margin:0}\n.headline-s{font-size:24px;line-height:32px;font-weight:400;text-wrap:balance;margin:0}\n.title-m{font-size:16px;line-height:24px;font-weight:500;letter-spacing:.15px;margin:0}\n.title-s{font-size:14px;line-height:20px;font-weight:500;letter-spacing:.1px;margin:0}\n.body-l{font-size:16px;line-height:24px;letter-spacing:.5px;margin:0}\n.body-m{font-size:14px;line-height:20px;letter-spacing:.25px;margin:0}\n.label-m{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.5px}\n.dim{color:var(--on-surface-variant)}\nheader{padding:48px 0 8px}\n.eyebrow{display:inline-flex;align-items:center;gap:8px;text-transform:uppercase;color:var(--primary);margin-bottom:14px}\n.eyebrow::before{content:\"\";width:24px;height:2px;background:var(--primary);border-radius:2px}\n.lede{margin-top:14px;max-width:66ch;color:var(--on-surface-variant)}\n.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}\n.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--outline-variant);\n  border-radius:8px;background:var(--sc-low);color:var(--on-surface-variant);font-size:14px;font-weight:500;letter-spacing:.1px}\n.chip.on{background:var(--secondary-container);color:var(--on-secondary-container);border-color:transparent}\n.card{background:var(--sc-low);border:1px solid var(--outline-variant);border-radius:16px;padding:20px 24px}\n.grid{display:grid;gap:16px}\n@media(min-width:820px){.grid.two{grid-template-columns:1fr 1fr}}\nsection{margin-top:48px}\n.sec-head{display:flex;gap:16px;align-items:flex-start;margin-bottom:6px}\n.sec-head .num{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;\n  background:var(--primary-container);color:var(--on-primary-container);font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}\n.sec-sub{color:var(--on-surface-variant);max-width:78ch;margin:8px 0 0}\nnav.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:14px 0;border-bottom:1px solid var(--outline-variant);\n  position:sticky;top:0;background:var(--surface);z-index:20}\nnav.bar a{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;text-decoration:none;\n  font-size:13px;font-weight:500;letter-spacing:.1px;color:var(--on-surface-variant);border:1px solid var(--outline-variant)}\nnav.bar a.here{background:var(--secondary-container);color:var(--on-secondary-container);border-color:transparent}\nnav.bar a.home{border-style:dashed}\nnav.bar a:hover{background:var(--sc)}\n/* ---- canvas ---- */\n.posterwrap{margin-top:20px;border:1px solid var(--outline-variant);border-radius:16px;background:var(--canvas);overflow-x:auto;overflow-y:hidden}\n.canvas{position:relative}\n.canvas svg.edges{position:absolute;inset:0;overflow:visible;pointer-events:none}\n.n{position:absolute}\n.n .cap{position:absolute;left:50%;transform:translateX(-50%);text-align:center;width:150px;\n  font-size:11px;line-height:14px;font-weight:500;letter-spacing:.3px;color:var(--on-surface-variant)}\n.stackitem{position:relative}\n.stackitem.sub{margin-left:26px}\n.stackitem.sub::before{content:\"\";position:absolute;left:-15px;top:-13px;width:14px;height:34px;\n  border-left:2px solid var(--outline-variant);border-bottom:2px solid var(--outline-variant);border-bottom-left-radius:8px}\n.screen{position:absolute;border-radius:12px;background:var(--sc-lowest);border:1px solid var(--outline-variant);\n  box-shadow:var(--shadow);padding:7px}\n.screen svg{display:block;width:100%;height:100%}\n.dia{position:absolute;background:var(--tertiary);color:var(--on-tertiary);border-radius:12px;\n  box-shadow:var(--shadow-2);display:grid;place-items:center}\n.dia .q{font-size:9px;line-height:11.5px;font-weight:500;letter-spacing:.1px;text-align:center;padding:0 4px;overflow-wrap:break-word;word-break:normal;hyphens:auto}\n.badge{position:absolute;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;\n  font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;background:var(--secondary);color:var(--on-secondary);\n  box-shadow:var(--shadow);border:2px solid var(--canvas);z-index:3}\n.badge.br{background:var(--tertiary);color:var(--on-tertiary)}\n.elabel{position:absolute;transform:translate(-50%,-50%);box-shadow:0 0 0 3px var(--canvas);font-size:9.5px;line-height:12px;font-weight:500;letter-spacing:.2px;\n  color:var(--on-surface-variant);background:var(--canvas);padding:1px 5px;border-radius:4px;white-space:nowrap;z-index:2}\n.dia .q.md{font-size:8.2px;line-height:10.2px}\n.dia .q.sm{font-size:7.4px;line-height:9.2px}\n.exit{position:absolute;transform:translateX(-50%);font-size:10px;font-weight:500;letter-spacing:.2px;\n  color:var(--on-surface-variant);background:var(--sc);border:1px dashed var(--outline);border-radius:8px;padding:3px 8px;white-space:nowrap}\n.startpill{position:absolute;transform:translate(0,-50%);display:inline-flex;align-items:center;height:34px;\n  padding:0 18px;border-radius:17px;background:var(--primary);color:var(--on-primary);\n  font-size:13px;font-weight:600;letter-spacing:.4px;box-shadow:var(--shadow-2);z-index:3}\n.endpill{position:absolute;transform:translate(0,-50%);display:inline-flex;align-items:center;gap:7px;\n  height:32px;padding:0 14px;border-radius:16px;background:var(--secondary-container);\n  color:var(--on-secondary-container);font-size:12px;font-weight:600;letter-spacing:.3px;\n  box-shadow:var(--shadow);z-index:3;white-space:nowrap}\n.endpill .to{font-weight:500;opacity:.9}\n.personas{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}\n.pchip{font-size:11.5px;line-height:16px;padding:4px 11px;border-radius:8px;\n  background:var(--tertiary-container);color:var(--on-tertiary-container);font-weight:500}\n.scope{display:grid;gap:14px;margin-top:18px}\n@media(min-width:860px){.scope{grid-template-columns:1.35fr 1fr}}\n.scope .about{background:var(--sc-low);border:1px solid var(--outline-variant);border-radius:16px;padding:18px 22px}\n.scope .about p{margin:0;font-size:14px;line-height:21px;letter-spacing:.15px;color:var(--on-surface-variant)}\n.scope .about p.lead{color:var(--on-surface);font-size:15px;line-height:23px}\n.covers{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}\n.cchip{font-size:11.5px;line-height:16px;padding:3px 9px;border-radius:7px;background:var(--sc);\n  color:var(--on-surface-variant);border:1px solid var(--outline-variant)}\n.cchip.dec{background:var(--tertiary-container);color:var(--on-tertiary-container);border-color:transparent}\ndetails.note{margin-top:14px;border-top:1px solid var(--outline-variant);padding-top:12px}\ndetails.note summary{cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;\n  color:var(--on-surface-variant);list-style:none}\ndetails.note summary::-webkit-details-marker{display:none}\ndetails.note summary::before{content:\"\u25b8 \";color:var(--primary)}\ndetails.note[open] summary::before{content:\"\u25be \"}\ndetails.note p{margin-top:8px;font-size:12.5px;line-height:19px}\ndl.spec{margin:0 0 14px;display:grid;grid-template-columns:auto 1fr;gap:5px 14px;align-items:baseline}\ndl.spec dt{font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--on-surface-variant)}\ndl.spec dd{margin:0;font-size:13px;line-height:19px}\ndl.spec dd code{font-family:var(--mono);font-size:11.5px}\n.scope .about h3{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--primary)}\n.scope .io{background:var(--sc-lowest);border:1px solid var(--outline-variant);border-radius:16px;padding:18px 22px}\n.scope .io h3{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--primary)}\n.scope .io h3+h3{margin-top:16px}\n.scope .io ul+h3{margin-top:18px}\n.scope .io .ports{margin-top:8px}\n.hint{margin-top:10px;font-size:12px;line-height:17px;color:var(--on-surface-variant)}\n/* ---- table ---- */\n.tablewrap{overflow-x:auto;margin-top:20px;border:1px solid var(--outline-variant);border-radius:12px}\ntable{border-collapse:collapse;width:100%;min-width:660px;font-size:13px;line-height:18px}\nth,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--outline-variant);vertical-align:top}\nth{background:var(--sc);color:var(--on-surface-variant);font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap}\ntbody tr:last-child td{border-bottom:0}\ntbody tr:nth-child(even){background:var(--sc-low)}\ntd.id{font-family:var(--mono);font-size:12px;white-space:nowrap}\n.ac{display:inline-block;font-family:var(--mono);font-size:11px;padding:2px 7px;border-radius:6px;margin:0 3px 3px 0;\n  background:var(--primary-container);color:var(--on-primary-container);white-space:nowrap}\n.ac.none{background:var(--sc-high);color:var(--on-surface-variant)}\n.acnote{margin-top:3px;font-size:11px;line-height:15px;color:var(--on-surface-variant);max-width:42ch}\n.kind{display:inline-block;font-size:11px;font-weight:500;letter-spacing:.4px;padding:2px 8px;border-radius:6px;text-transform:uppercase}\n.kind.primary{background:var(--secondary-container);color:var(--on-secondary-container)}\n.kind.conditional{border:1px dashed var(--outline);color:var(--on-surface-variant)}\n/* ---- misc ---- */\n.legend{display:flex;flex-wrap:wrap;gap:20px 28px;align-items:center}\n.legend .item{display:flex;align-items:center;gap:10px;color:var(--on-surface-variant);font-size:13.5px}\n.finding{border-left:3px solid var(--error);padding:2px 0 2px 16px}\n.finding+.finding{margin-top:18px}\n.finding.warn{border-left-color:var(--tertiary)}.finding.ok{border-left-color:var(--primary)}\n.finding h4{margin:0 0 4px;font-size:14px;font-weight:600}\n.finding p{margin:0;font-size:13.5px;line-height:20px;color:var(--on-surface-variant)}\n.tabcol{display:flex;flex-direction:column;gap:12px}\n.tabhead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:var(--primary-container);color:var(--on-primary-container)}\n.stackitem{border:1px solid var(--outline-variant);border-radius:12px;padding:14px 16px;background:var(--sc-lowest)}\n.depth{font-family:var(--mono);font-size:11px;color:var(--on-surface-variant);margin-top:4px}\n.ports{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}\n.ports li{font-size:12px;line-height:17px;color:var(--on-surface-variant);padding-left:16px;position:relative}\n.ports li::before{content:\"\";position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:2px;background:var(--outline)}\n.ports li.out::before{background:var(--primary)}\n.cards{display:grid;gap:14px}\n@media(min-width:760px){.cards{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}}\na.flowcard{display:block;text-decoration:none;color:inherit;border:1px solid var(--outline-variant);border-radius:16px;\n  padding:18px 20px;background:var(--sc-low)}\na.flowcard:hover{background:var(--sc);border-color:var(--outline)}\na.flowcard .k{font-family:var(--mono);font-size:12px;color:var(--primary)}\na.flowcard h3{margin:6px 0 8px;font-size:17px;line-height:23px;font-weight:500}\na.flowcard .s{font-size:12.5px;color:var(--on-surface-variant)}\nfooter{margin-top:64px;padding-top:20px;border-top:1px solid var(--outline-variant);color:var(--on-surface-variant);\n  font-size:12px;line-height:18px}\nfooter code{font-family:var(--mono)}\na{color:var(--primary)}\n:focus-visible{outline:3px solid var(--primary);outline-offset:2px;border-radius:4px}\n@media(prefers-reduced-motion:no-preference){.screen{transition:box-shadow .18s,transform .18s}\n  .screen:hover{box-shadow:var(--shadow-2);transform:translateY(-2px)}}\n";


const SVGNS='http://www.w3.org/2000/svg';
const el=(t,a,p)=>{const n=document.createElement(t);if(a)for(const k in a){k==='class'?n.className=a[k]:n.setAttribute(k,a[k]);}if(p)p.appendChild(n);return n;};
const sv=(t,a,p)=>{const n=document.createElementNS(SVGNS,t);for(const k in a)n.setAttribute(k,a[k]);if(p)p.appendChild(n);return n;};

/* ---------- skeletons ---------- */
const W=98,H=158;
function bx(p,x,y,w,h,r,f,o){sv('rect',{x,y,width:w,height:h,rx:r||2,fill:f||'var(--skeleton)','fill-opacity':o==null?1:o},p);}
function bar(p){bx(p,8,6,34,5,2.5,'var(--skeleton-strong)');}
function cta(p,y){bx(p,8,y,W-16,13,6,'var(--skeleton-strong)');}
const SK={
 form(p,n){bar(p);let y=18;const f=Math.min(4,Math.max(2,(n.regions||[]).length-1));
  for(let i=0;i<f;i++){bx(p,8,y,26,4,2,'var(--skeleton)',.75);bx(p,8,y+7,W-16,12,3,'var(--skeleton)',.4);
   sv('rect',{x:8,y:y+7,width:W-16,height:12,rx:3,fill:'none',stroke:'var(--skeleton)','stroke-width':1},p);y+=25;}cta(p,Math.min(y+4,H-18));},
 list(p){bar(p);bx(p,8,17,W-16,11,5.5,'var(--skeleton)',.45);
  sv('rect',{x:8,y:17,width:W-16,height:11,rx:5.5,fill:'none',stroke:'var(--skeleton)','stroke-width':1},p);
  let y=34;for(let i=0;i<4;i++){bx(p,8,y,W-16,26,4,'var(--skeleton)',.35);bx(p,12,y+4,26,18,3,'var(--skeleton-strong)');
   bx(p,42,y+6,W-56,4,2);bx(p,42,y+13,26,3,1.5,'var(--skeleton)',.7);y+=30;}},
 detail(p){bar(p);bx(p,8,17,W-16,44,5,'var(--skeleton-strong)');bx(p,8,66,58,6,3);bx(p,8,76,34,4,2,'var(--skeleton)',.7);
  let y=86;for(let i=0;i<3;i++){bx(p,8,y,W-16-(i===2?30:0),4,2,'var(--skeleton)',.55);y+=8;}cta(p,H-20);},
 split(p){bar(p);bx(p,8,17,30,H-30,4,'var(--skeleton)',.4);let y=17;
  for(let i=0;i<4;i++){bx(p,11,y+3,24,4,2);y+=11;}bx(p,42,17,W-50,30,4,'var(--skeleton-strong)');
  let z=52;for(let i=0;i<4;i++){bx(p,42,z,W-50-(i===3?18:0),4,2,'var(--skeleton)',.55);z+=8;}},
 dialog(p){bx(p,0,0,W,H,3,'var(--skeleton)',.26);bx(p,10,44,W-20,70,8,'var(--sc-lowest)');
  sv('rect',{x:10,y:44,width:W-20,height:70,rx:8,fill:'none',stroke:'var(--skeleton-strong)','stroke-width':1.2},p);
  bx(p,18,54,44,5,2.5,'var(--skeleton-strong)');bx(p,18,65,W-36,4,2,'var(--skeleton)',.7);bx(p,18,72,W-46,4,2,'var(--skeleton)',.7);
  bx(p,18,92,28,12,6,'var(--skeleton)',.5);bx(p,52,92,28,12,6,'var(--skeleton-strong)');},
 confirmation(p){sv('circle',{cx:W/2,cy:44,r:17,fill:'var(--skeleton-strong)'},p);
  sv('path',{d:'M'+(W/2-7)+' 44 l5 5 l9 -10',fill:'none',stroke:'var(--sc-lowest)','stroke-width':2.6,'stroke-linecap':'round','stroke-linejoin':'round'},p);
  bx(p,20,72,W-40,6,3);bx(p,28,84,W-56,4,2,'var(--skeleton)',.6);bx(p,8,102,W-16,26,4,'var(--skeleton)',.32);
  bx(p,13,107,40,4,2);bx(p,13,115,W-40,3,1.5,'var(--skeleton)',.7);cta(p,H-18);},
 'empty-state'(p){bar(p);sv('rect',{x:W/2-16,y:46,width:32,height:26,rx:4,fill:'none',stroke:'var(--skeleton-strong)','stroke-width':1.6},p);
  sv('path',{d:'M'+(W/2-9)+' 66 l7 -9 l6 7 l4 -4',fill:'none',stroke:'var(--skeleton-strong)','stroke-width':1.6,'stroke-linecap':'round'},p);
  bx(p,22,84,W-44,5,2.5);bx(p,30,94,W-60,4,2,'var(--skeleton)',.6);bx(p,24,112,W-48,13,6.5,'var(--skeleton-strong)');},
 'error-state'(p){bar(p);sv('circle',{cx:W/2,cy:56,r:15,fill:'none',stroke:'var(--skeleton-strong)','stroke-width':1.8},p);
  bx(p,W/2-1.2,48,2.4,11,1.2,'var(--skeleton-strong)');sv('circle',{cx:W/2,cy:63,r:1.6,fill:'var(--skeleton-strong)'},p);
  bx(p,20,82,W-40,5,2.5);bx(p,28,92,W-56,4,2,'var(--skeleton)',.6);bx(p,26,110,W-52,13,6.5,'var(--skeleton)',.5);},
 'loading-state'(p){bar(p);let y=22;for(let i=0;i<5;i++){bx(p,8,y,W-16,20,4,'var(--skeleton)',.5-i*.07);y+=24;}},
 notice(p){bar(p);bx(p,8,17,W-16,22,4,'var(--skeleton-strong)');bx(p,13,23,12,10,2,'var(--sc-lowest)');
  bx(p,29,23,W-42,4,2,'var(--sc-lowest)');bx(p,29,30,W-56,3,1.5,'var(--sc-lowest)');
  let y=46;for(let i=0;i<4;i++){bx(p,8,y,W-16-(i===3?26:0),4,2,'var(--skeleton)',.5);y+=9;}cta(p,H-18);},
 handoff(p){bx(p,6,26,38,60,5,'var(--skeleton)',.45);bx(p,W-44,26,38,60,5,'var(--skeleton)',.45);
  sv('path',{d:'M48 56 h'+(W-96),stroke:'var(--skeleton-strong)','stroke-width':2,fill:'none'},p);
  sv('path',{d:'M'+(W-50)+' 52 l5 4 l-5 4 z',fill:'var(--skeleton-strong)'},p);
  bx(p,10,32,30,4,2);bx(p,10,40,22,3,1.5,'var(--skeleton)',.7);bx(p,W-40,32,30,4,2);bx(p,W-40,40,22,3,1.5,'var(--skeleton)',.7);
  bx(p,20,98,W-40,5,2.5);bx(p,28,108,W-56,4,2,'var(--skeleton)',.55);}
};
function skel(n){const s=document.createElementNS(SVGNS,'svg');s.setAttribute('viewBox','0 0 '+W+' '+H);
  s.setAttribute('aria-hidden','true');(SK[n.archetype]||SK.detail)(s,n);return s;}

/* ---------- ac parsing ---------- */
function parseAc(raw){
  if(!raw)return{ids:[],note:''};
  const str=String(raw);
  const ids=str.match(/(?:AC|HYP)-[0-9]+(?:\.[0-9]+)*(?:\/[0-9.]+)*/g)||[];
  const lead=str.match(/^(?:\s*(?:AC|HYP)-[0-9]+(?:\.[0-9]+)*(?:\/[0-9.]+)*[,;]?\s*)+/);
  let note=(lead?str.slice(lead[0].length):(ids.length?'':str)).trim().replace(/^[—–-]\s*/,'');
  return{ids:[...new Set(ids)],note};
}
const acIds=r=>parseAc(r).ids;
const isDec=n=>!!(n.decision&&n.decision.question);

/* ---------- geometry ----------
   Captions sit on the OUTSIDE of each row (above the upper row, below the lower
   one). That leaves both rows' facing edges free, so every routed connection runs
   through the corridor between them without ever wrapping around a node. */
const SCR_W=112,SCR_H=172,DIA=112,DIA_BOX=Math.round(DIA*1.4142);
const CELL_W=150,COL_GAP=34,CAP_H=34,PAD=36,START_W=96,LANE_H=15;
const shapeW=n=>isDec(n)?DIA_BOX:SCR_W, shapeH=n=>isDec(n)?DIA_BOX:SCR_H;

function layout(nodes){
  const ord=nodes.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  const isB=n=>String(n.id).includes('.');
  const hasTop=ord.some(isB);
  /* x first — it does not depend on how tall the corridor turns out to be */
  const pos=new Map();
  ord.forEach((n,i)=>{
    pos.set(String(n.id),{n,i,isTop:isB(n),w:shapeW(n),h:shapeH(n),
      cx:PAD+START_W+i*(CELL_W+COL_GAP)+CELL_W/2});
  });
  /* pack routed edges into lanes: an edge reuses a lane when its horizontal
     span clears everything already in it, so the corridor stays as thin as the
     flow actually needs */
  const lanes=[];
  const assign=(x1,x2)=>{
    const a=Math.min(x1,x2)-14,b=Math.max(x1,x2)+14;
    for(let i=0;i<lanes.length;i++)
      if(lanes[i].every(([p,q])=>b<p||a>q)){lanes[i].push([a,b]);return i;}
    lanes.push([[a,b]]);return lanes.length-1;
  };
  const routed=new Map();
  nodes.forEach(n=>{
    const s0=pos.get(String(n.id));if(!s0)return;
    (n.transitions||[]).forEach((t,ti)=>{
      const tg=t.target==null?null:pos.get(String(t.target));
      if(!tg) return;                                  /* exits get their own stub */
      if(s0.isTop===tg.isTop&&tg.i===s0.i+1) return;   /* direct neighbour, no lane */
      routed.set(String(n.id)+'>'+ti,assign(s0.cx,tg.cx));
    });
  });
  const GAP=Math.max(96,44+lanes.length*LANE_H+26);
  const topH=hasTop?Math.max(...ord.filter(isB).map(shapeH)):0;
  const botH=Math.max(...ord.filter(n=>!isB(n)).map(shapeH));
  const topCapY=PAD, topTop=hasTop?PAD+CAP_H:PAD;      /* caption above upper row */
  const topMid=topTop+topH/2;
  const botTop=hasTop?(topTop+topH+GAP):PAD;
  const botMid=botTop+botH/2;                          /* caption BELOW lower row */
  const laneY=i=>hasTop?(topTop+topH+22+i*LANE_H):(botTop-22-(lanes.length-i)*LANE_H);
  ord.forEach(n=>{const p=pos.get(String(n.id));p.cy=p.isTop?topMid:botMid;});
  const width=PAD*2+START_W+ord.length*CELL_W+(ord.length-1)*COL_GAP+300;
  const laneTopRoom=hasTop?0:lanes.length*LANE_H+30;
  const height=botMid+botH/2+CAP_H+PAD+10;
  return{ord,pos,width,height:height,topMid,botMid,hasTop,topH,botH,topCapY,laneY,routed,lanes,laneTopRoom};
}

/* rounded orthogonal path through waypoints */
function orth(pts,r){
  r=r||12;let d='M'+pts[0].x+' '+pts[0].y;
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i-1],c=pts[i],q=pts[i+1];
    const d1=Math.hypot(c.x-p.x,c.y-p.y),d2=Math.hypot(q.x-c.x,q.y-c.y);
    const rr=Math.min(r,d1/2,d2/2);
    const a={x:c.x-(c.x-p.x)/(d1||1)*rr,y:c.y-(c.y-p.y)/(d1||1)*rr};
    const b={x:c.x+(q.x-c.x)/(d2||1)*rr,y:c.y+(q.y-c.y)/(d2||1)*rr};
    d+=' L'+a.x+' '+a.y+' Q'+c.x+' '+c.y+' '+b.x+' '+b.y;
  }
  const e=pts[pts.length-1];d+=' L'+e.x+' '+e.y;return d;
}

function renderFlow(flow,host){
  const nodes=flow.nodes||[];
  const L=layout(nodes);
  const wrap=el('div',{class:'posterwrap'},host);
  const canvas=el('div',{class:'canvas'},wrap);
  const extra=L.laneTopRoom||0;
  canvas.style.width=L.width+'px';canvas.style.height=(L.height+extra)+'px';
  const svg=document.createElementNS(SVGNS,'svg');
  svg.setAttribute('class','edges');svg.setAttribute('width',L.width);svg.setAttribute('height',L.height+extra);
  svg.setAttribute('viewBox','0 0 '+L.width+' '+(L.height+extra));canvas.appendChild(svg);
  const defs=sv('defs',{},svg);
  const m=sv('marker',{id:'ahs',viewBox:'0 0 10 10',refX:'8.5',refY:'5',markerWidth:'6.5',markerHeight:'6.5',orient:'auto-start-reverse'},defs);
  sv('path',{d:'M0 1 L9 5 L0 9 z',fill:'var(--edge)'},m);
  const OY=extra;                       /* shift everything down when lanes sit on top */

  /* nodes */
  L.ord.forEach(n=>{
    const p=L.pos.get(String(n.id));
    const cell=el('div',{class:'n'},canvas);
    const top=p.cy-p.h/2+OY;
    cell.style.left=(p.cx-CELL_W/2)+'px';
    cell.style.top=(top-(p.isTop?CAP_H:0))+'px';
    cell.style.width=CELL_W+'px';cell.style.height=(p.h+CAP_H)+'px';
    const cap=el('div',{class:'cap'},cell);
    cap.textContent=n.label||'';
    cap.style.top=p.isTop?'0':(p.h+8)+'px';            /* caption on the outside */
    if(isDec(n)){
      const d=el('div',{class:'dia'},cell);
      d.style.width=DIA+'px';d.style.height=DIA+'px';
      d.style.left=((CELL_W-DIA)/2)+'px';d.style.top=((p.isTop?CAP_H:0)+(p.h-DIA)/2)+'px';
      d.style.transform='rotate(45deg)';
      const qs=(n.decision.question||'').length;
      const q=el('div',{class:'q'+(qs>96?' sm':qs>54?' md':'')},d);
      q.style.transform='rotate(-45deg)';q.style.width=(DIA+14)+'px';
      q.textContent=n.decision.question||'';d.setAttribute('title',n.decision.question||'');
      const bg=el('div',{class:'badge br'},cell);bg.textContent=n.id;
      bg.style.left=(CELL_W/2+DIA_BOX/2-30)+'px';
      bg.style.top=((p.isTop?CAP_H:0)+p.h/2-DIA_BOX/2+22)+'px';
    }else{
      const sc=el('div',{class:'screen'},cell);
      sc.style.width=SCR_W+'px';sc.style.height=SCR_H+'px';
      sc.style.left=((CELL_W-SCR_W)/2)+'px';sc.style.top=(p.isTop?CAP_H:0)+'px';
      sc.setAttribute('role','img');
      sc.setAttribute('aria-label',(n.label||'')+': '+((n.regions||[]).join('; ')||n.archetype||'screen'));
      sc.appendChild(skel(n));
      const bg=el('div',{class:'badge'+(p.isTop?' br':'')},cell);bg.textContent=n.id;
      bg.style.left=(CELL_W/2+SCR_W/2-10)+'px';bg.style.top=((p.isTop?CAP_H:0)-10)+'px';
    }
  });

  /* where an exit or a handoff actually leads */
  const OUTS=flow.outs||[], KEYS=flow.keys||{}, NAMES=flow.names||{};
  function dest(str){
    const t=String(str||'').toLowerCase();
    for(const k in KEYS){
      const fk=KEYS[k];
      if(t.indexOf(k)>=0 && OUTS.some(o=>o.flow===fk))
        return {flow:fk,label:fk+' '+(NAMES[fk]||'')};
    }
    if(t.indexOf('origin')>=0) return {flow:null,label:'back to origin screen'};
    if(OUTS.length===1&&OUTS[0].flow)
      return {flow:OUTS[0].flow,label:OUTS[0].flow+' '+(NAMES[OUTS[0].flow]||'')};
    return {flow:null,label:String(str||'exit')};
  }
  function endPill(x,y,d,anchorLeft){
    const pill=el('div',{class:'endpill'},canvas);
    const a=el('span',{},pill);a.textContent='End';
    const b=el('span',{class:'to'},pill);b.textContent='\u2192 '+d.label;
    pill.style.left=x+'px';pill.style.top=y+'px';
    if(!anchorLeft) pill.style.transform='translate(-100%,-50%)';
    pill.setAttribute('title','leaves this flow \u2192 '+d.label);
    return pill;
  }

  /* start marker — every flow needs a visible way in */
  const first=L.ord.find(n=>!String(n.id).includes('.'))||L.ord[0];
  const fp=L.pos.get(String(first.id));
  const st=el('div',{class:'startpill'},canvas);
  st.textContent='Start';
  st.style.left=(PAD+6)+'px';st.style.top=(fp.cy+OY)+'px';
  const sx=PAD+6+START_W-42;
  sv('path',{d:'M'+sx+' '+(fp.cy+OY)+' H'+(fp.cx-fp.w/2-8),stroke:'var(--edge)','stroke-width':1.8,fill:'none','marker-end':'url(#ahs)'},svg);

  /* a handoff node IS the end of this flow — mark it like one */
  L.ord.forEach(n=>{
    const isHandoff = n.archetype==='handoff' || /^\[handoff\]/i.test(n.label||'');
    if(!isHandoff) return;
    const p=L.pos.get(String(n.id));
    const x0=p.cx+p.w/2+6;
    sv('path',{d:'M'+x0+' '+(p.cy+OY)+' h26',stroke:'var(--edge)','stroke-width':1.8,fill:'none','marker-end':'url(#ahs)'},svg);
    endPill(x0+34,p.cy+OY,dest(n.label),true);
  });

  /* edges — every routed path leaves and enters through a facing edge */
  /* anchors live in the same offset space as the lanes (OY shifts everything down
     when the lane band sits above a single-row flow) */
  const anchorOut=(p,laneY)=>{const cy=p.cy+OY;
    return laneY>cy?{x:p.cx,y:cy+p.h/2+4}:{x:p.cx,y:cy-p.h/2-4};};
  const anchorIn =(p,laneY)=>{const cy=p.cy+OY;
    return laneY>cy?{x:p.cx,y:cy+p.h/2+8}:{x:p.cx,y:cy-p.h/2-8};};
  nodes.forEach(n=>{
    const s=L.pos.get(String(n.id));if(!s)return;
    (n.transitions||[]).forEach((t,ti)=>{
      const tgt=t.target==null?null:L.pos.get(String(t.target));
      const dashed=(t.kind||'')!=='primary';
      if(!tgt){
        const dir=s.isTop?-1:1;
        const y0=s.cy+OY+dir*(s.h/2+4), y1=y0+dir*22;
        sv('path',{d:'M'+s.cx+' '+y0+' V'+y1,stroke:'var(--edge)','stroke-width':1.8,fill:'none',
          'stroke-dasharray':dashed?'5 4':'none','marker-end':'url(#ahs)'},svg);
        endPill(s.cx-46,dir>0?y1+18:y1-18,dest(t.target),true);
        return;
      }
      let pts,lp;
      if(s.isTop===tgt.isTop&&tgt.i===s.i+1){
        pts=[{x:s.cx+s.w/2+4,y:s.cy+OY},{x:tgt.cx-tgt.w/2-8,y:tgt.cy+OY}];
        lp={x:(pts[0].x+pts[1].x)/2,y:s.cy+OY-12};
      }else{
        const li=L.routed.get(String(n.id)+'>'+ti)||0;
        const ly=L.laneY(li)+OY;
        const o=anchorOut(s,ly), i2=anchorIn(tgt,ly);
        pts=[o,{x:o.x,y:ly},{x:i2.x,y:ly},i2];
        lp={x:o.x+(tgt.cx>s.cx?34:-34),y:(o.y+ly)/2};   /* label near where it leaves */
      }
      sv('path',{d:orth(pts,11),stroke:'var(--edge)','stroke-width':1.6,fill:'none',
        'stroke-linecap':'round','stroke-dasharray':dashed?'5 4':'none','marker-end':'url(#ahs)'},svg);
      if(isDec(n)&&n.decision&&n.decision.outcomes){
        const oc=n.decision.outcomes.find(o2=>String(o2.target)===String(t.target));
        if(oc&&oc.label){
          const lab=el('div',{class:'elabel'},canvas);
          lab.style.left=lp.x+'px';lab.style.top=lp.y+'px';
          const txt=String(oc.label);
          lab.textContent=txt.length>26?txt.slice(0,25)+'…':txt;
          lab.setAttribute('title',txt);
        }
      }
    });
  });
  declutter(canvas);
  return L;
}

/* Labels are positioned from geometry, which cannot know how wide the rendered
   text turns out to be. Measure once the DOM is real and nudge anything that
   landed on a shape or a caption. */
function declutter(canvas){
  const cv=canvas.getBoundingClientRect();
  const box=e=>{const b=e.getBoundingClientRect();
    return{x1:b.left-cv.left,y1:b.top-cv.top,x2:b.right-cv.left,y2:b.bottom-cv.top};};
  const hit=(a,b)=>!(a.x2<=b.x1||b.x2<=a.x1||a.y2<=b.y1||b.y2<=a.y1);
  const obstacles=[...canvas.querySelectorAll('.screen,.dia')].map(box)
    .concat([...canvas.querySelectorAll('.n .cap')].map(c=>{
      const r=document.createRange();r.selectNodeContents(c);const b=r.getBoundingClientRect();
      return{x1:b.left-cv.left-2,y1:b.top-cv.top,x2:b.right-cv.left+2,y2:b.bottom-cv.top};}));
  const placed=[];
  const DY=[0,-15,-30,-45,15,30,-60,45,-75,60,-90,75];
  const DX=[0,-26,26,-52,52,-78,78];
  canvas.querySelectorAll('.elabel,.exit,.endpill').forEach(l=>{
    const by=parseFloat(l.style.top), bxv=parseFloat(l.style.left);
    let best=null;
    outer:
    for(const dy of DY) for(const dx of DX){
      l.style.top=(by+dy)+'px'; l.style.left=(bxv+dx)+'px';
      const b=box(l);
      if(!obstacles.some(x=>hit(b,x))&&!placed.some(x=>hit(b,x))){best=[by+dy,bxv+dx];break outer;}
    }
    l.style.top=((best?best[0]:by))+'px'; l.style.left=((best?best[1]:bxv))+'px';
    placed.push(box(l));
  });
}

function renderTable(flow,host){
  const tw=el('div',{class:'tablewrap'},host);
  const tb=el('table',{},tw);
  el('thead',{},tb).innerHTML='<tr><th>From</th><th>Screen</th><th>Trigger</th><th>To</th><th>Nav</th><th>Kind</th><th>AC</th></tr>';
  const body=el('tbody',{},tb);
  (flow.nodes||[]).forEach(n=>{
    const ts=n.transitions||[];
    if(!ts.length){
      const tr=el('tr',{},body);el('td',{class:'id'},tr).textContent=n.id;
      el('td',{},tr).textContent=n.label||'';
      const td=el('td',{colspan:'5',class:'dim'},tr);td.textContent='terminal — no outgoing transition';return;
    }
    ts.forEach((t,j)=>{
      const tr=el('tr',{},body);
      el('td',{class:'id'},tr).textContent=j===0?n.id:'';
      el('td',{},tr).textContent=j===0?(n.label||''):'';
      el('td',{},tr).textContent=t.trigger||'';
      el('td',{class:'id'},tr).textContent=t.target==null?'—':t.target;
      el('td',{class:'dim'},tr).textContent=t.nav||'';
      const kd=el('td',{},tr);
      const k=el('span',{class:'kind '+((t.kind||'')==='primary'?'primary':'conditional')},kd);k.textContent=t.kind||'—';
      const at=el('td',{},tr);const P=parseAc(t.ac);
      if(P.ids.length)P.ids.forEach(a=>{const s=el('span',{class:'ac'},at);s.textContent=a;});
      else if(!P.note){const s=el('span',{class:'ac none'},at);s.textContent='none';}
      if(P.note){const nz=el('div',{class:'acnote'},at);nz.textContent=P.note;}
    });
  });
}

function legend(host){
  const L=el('div',{class:'legend'},host);
  function item(mk,txt){const it=el('div',{class:'item'},L);it.appendChild(mk);const s=el('span',{},it);s.textContent=txt;}
  const a=el('div',{style:'width:34px;height:22px;border-radius:5px;background:var(--sc-lowest);border:1px solid var(--outline-variant);box-shadow:var(--shadow)'});
  item(a,'Screen — whole number, main row');
  const b=el('div',{style:'width:22px;height:22px;background:var(--tertiary);border-radius:4px;transform:rotate(45deg);margin:0 6px'});
  item(b,'Decision point');
  const c=el('div',{style:'width:22px;height:22px;border-radius:50%;background:var(--tertiary);opacity:.85'});
  item(c,'Decimal id — branch, upper row');
  const d=document.createElementNS(SVGNS,'svg');d.setAttribute('width','38');d.setAttribute('height','12');d.setAttribute('viewBox','0 0 38 12');
  sv('line',{x1:1,y1:6,x2:30,y2:6,stroke:'var(--edge)','stroke-width':1.7},d);sv('path',{d:'M29 2 L36 6 L29 10 z',fill:'var(--edge)'},d);
  item(d,'Primary transition');
  const e=document.createElementNS(SVGNS,'svg');e.setAttribute('width','38');e.setAttribute('height','12');e.setAttribute('viewBox','0 0 38 12');
  sv('line',{x1:1,y1:6,x2:30,y2:6,stroke:'var(--edge)','stroke-width':1.7,'stroke-dasharray':'5 4'},e);sv('path',{d:'M29 2 L36 6 L29 10 z',fill:'var(--edge)'},e);
  item(e,'Conditional transition');
  const f=el('div');const sp=el('span',{class:'ac'},f);sp.textContent='AC-2.4';
  item(f,'Criterion this edge satisfies');
  const g=el('div',{style:'display:inline-flex;align-items:center;height:26px;padding:0 12px;border-radius:13px;background:var(--primary);color:var(--on-primary);font-size:11px;font-weight:600'});
  g.textContent='Start';item(g,'Where the flow begins');
  const h=el('div',{style:'display:inline-flex;align-items:center;height:26px;padding:0 12px;border-radius:13px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:11px;font-weight:600'});
  h.textContent='End \u2192';item(h,'Where it leaves, and to which flow');
}


/* ---------------- public API ---------------- */
function summary(flow){
  var n=flow.nodes||[], dec=n.filter(isDec).length;
  var edges=n.reduce(function(a,x){return a+((x.transitions||[]).length);},0);
  var acs={},c=0;
  n.forEach(function(x){(x.transitions||[]).forEach(function(t){
    acIds(t.ac).forEach(function(a){if(!acs[a]){acs[a]=1;c++;}});});});
  return {screens:n.length-dec, decisions:dec, nodes:n.length, transitions:edges, criteria:c};
}
return {
  css: CSS,
  render: function(host, flow){ return renderFlow(flow, host); },
  table:  function(host, flow){ return renderTable(flow, host); },
  legend: function(host){ return legend(host); },
  summary: summary,
  parseAc: parseAc,
  isDecision: isDec,
  version: '1.0.0'
};
}));
