# screen-specs Web Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `screen-specs` skill to render responsive web screen mocks in four design styles (Material UI, Neo-Flat, Minimal-Neutral, Fluent) and give the mobile frame a small device library, without regressing the proven mobile renderer.

**Architecture:** A `target: mobile|web` axis on `design-system.json` dispatches `mock()` to the existing phone renderer or a new web renderer. Web visual identity comes from token+flag `STYLES` presets that layer *under* the project's own tokens. The single-file renderer is split into `styles.js` (presets) + `screenspec.js` (core + mobile) + `screenspec.web.js` (web), concatenated into the inlined page blob by `build-screens.mjs`.

**Tech Stack:** Plain ES5-ish UMD JavaScript (browser + Node, no deps), `node --test` (stdlib), the skill's own `build-screens.mjs` CLI.

**Spec:** `docs/superpowers/specs/2026-08-16-screen-specs-web-target-design.md`

## Global Constraints

- **Skill dir:** all script/reference paths below are under `bundles/feature-development/skills/screen-specs/`. Verbatim prefix: `bundles/feature-development/skills/screen-specs/`.
- **No dependencies.** Renderer and tests are stdlib-only; no jsdom, no npm installs. The DOM shim (Task 1) is hand-written.
- **Backward compatible.** Absent `target` ⇒ `mobile`; absent `device` ⇒ `iphone`; both must reproduce today's mobile render exactly (golden test, Task 1).
- **Self-contained output.** Pages inline the whole renderer; no external fetches.
- **UMD dual-env.** Every script works in browser (`root.X`) and Node (`module.exports`).
- **Styles are structural bases, not identities.** Presets set depth/border/radius/alpha + default palette; project `color.roles`/`type` override them (later-wins CSS var order).
- **Frontmatter descriptions must not contain `": "`** (strict-YAML test) — use `—`.
- **Do not edit the benchmark copy** (`~/Development/benchmark/.agents/...`); build only in the bundle copy.
- **Commit after each task.** Do not push. Branch is `feat/tool-call-economy` (already checked out).

---

## File Structure

| Path (under skill dir) | Responsibility | New/Mod |
|---|---|---|
| `scripts/styles.js` | `STYLES` preset table + `styleVars(style)` → CSS var lines. Pure, no DOM. | New |
| `scripts/screenspec.js` | Core: tokens, applyState, region renderers `R`, **mobile** frame, `DEVICES`, `frameKind`, Call reader, API object with `mockWeb` slot. | Mod |
| `scripts/screenspec.web.js` | Web frame (`mockWeb`, `webCss`), web region renderers, breakpoint-toggle glue helper. Registers onto the core API. | New |
| `scripts/build-screens.mjs` | Concatenate `[styles, core, web]` → `LIB`; require web for Node; page `<style>` += `webCss` for web; target-aware index + Call labels; breakpoint-toggle wiring. | Mod |
| `scripts/dom-shim.mjs` | Minimal serializable DOM (`document`) so `mock()`/`mockWeb()` render in `node --test`. | New |
| `scripts/__fixtures__/*.json` | Tiny mobile + per-style web design-systems and one screen each. | New |
| `scripts/*.test.mjs` | Golden + unit + smoke tests. | New |
| `scripts/__fixtures__/mobile.golden.txt` | Committed serialized baseline of the mobile default mock. | New |
| `references/schema.md` | Shared contract; generalized Call; `target`/`style`/`device` fields. | Mod |
| `references/targets/mobile.md` | Phone frame, `DEVICES` library, mobile nav kinds, MD3-vs-iOS, SF Symbols, tab bar. | New |
| `references/targets/web.md` | Browser frame, breakpoints, 4 styles, style-vs-native calls, web regions, "Working with frontend-design". | New |
| `references/verifying.md` | + per-breakpoint no-sideways-scroll, focus-visible, reduced-motion, style spot-check. | Mod |
| `SKILL.md` | Drop mobile-only caveat; name `target`/`style`/`device`; point to target refs. | Mod |
| `bundles/feature-development/agents/designer/AGENT.md` | Drop mobile-only caveat; add web/device + frontend-design companion. | Mod |

---

## Task 1: DOM shim + mobile golden baseline (regression lock FIRST)

Lock current mobile rendering before touching anything.

**Files:**
- Create: `scripts/dom-shim.mjs`
- Create: `scripts/__fixtures__/mobile.ds.json`, `scripts/__fixtures__/mobile.screens.json`
- Create: `scripts/screenspec.golden.test.mjs`
- Create: `scripts/__fixtures__/mobile.golden.txt` (generated, then committed)

**Interfaces:**
- Produces: `installDom()` (returns a fresh `document` global and a `serialize(node)` → string); `renderMobileDefault()` helper used by later tasks.

- [ ] **Step 1: Write the DOM shim**

`scripts/dom-shim.mjs` — a minimal document supporting exactly what `screenspec.js` uses: `createElement`, `createTextNode`, `className`, `textContent`, `setAttribute`, `getAttribute`, `appendChild`, `firstChild`, `classList.add/contains`, `style` (string props + `cssText`), `querySelectorAll` (used by build glue only, not by `mock`), `innerHTML` (used by build glue only).

```js
// scripts/dom-shim.mjs
function El(tag){ this.tag=tag; this.children=[]; this.attrs={}; this.className=''; this._text=null;
  this.style=new Proxy({cssText:''},{set(o,k,v){o[k]=v;return true;},get(o,k){return o[k]||''}});
  this.classList={ _s:new Set(), add:(...c)=>c.forEach(x=>this.classList._s.add(x)),
    contains:x=>this.classList._s.has(x) }; }
Object.defineProperty(El.prototype,'textContent',{get(){return this._text},set(v){this._text=String(v);this.children=[]}});
Object.defineProperty(El.prototype,'firstChild',{get(){return this.children[0]||null}});
El.prototype.appendChild=function(n){ this.children.push(n); return n; };
El.prototype.setAttribute=function(k,v){ this.attrs[k]=String(v); };
El.prototype.getAttribute=function(k){ return k in this.attrs?this.attrs[k]:null; };
function Txt(t){ this.text=String(t); }
export function installDom(){
  const document={ createElement:t=>new El(t), createTextNode:t=>new Txt(t) };
  globalThis.document=document; globalThis.self=globalThis;
  return document;
}
export function serialize(n){
  if(n instanceof Txt) return n.text;
  if(!n||!n.tag) return '';
  const cls=[n.className, [...n.classList._s].join(' ')].filter(Boolean).join(' ');
  const style=n.style.cssText|| Object.keys(n.style).filter(k=>k!=='cssText'&&n.style[k]).map(k=>k+':'+n.style[k]).join(';');
  const attrs=Object.entries(n.attrs).map(([k,v])=>` ${k}="${v}"`).join('')
    +(cls?` class="${cls}"`:'')+(style?` style="${style}"`:'');
  const kids=n._text!=null?n._text:n.children.map(serialize).join('');
  return `<${n.tag}${attrs}>${kids}</${n.tag}>`;
}
```

- [ ] **Step 2: Write minimal fixtures**

`mobile.ds.json` — a stripped design system: `color.roles.light/dark` (5–6 roles incl `surface`, `onSurface`, `primary`, `outlineVariant`, `surfaceContainerLow`), a 2-row `type.scale`, a 2-row `shape.scale`. `mobile.screens.json` — one screen, `nav.kind:"root"`, 3 regions (`appbar`, `list`, `cta`), one non-default `state`. Keep it small but exercising the tab bar + pinned action bar.

- [ ] **Step 3: Write the golden test (capture-or-compare)**

```js
// scripts/screenspec.golden.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installDom, serialize } from './dom-shim.mjs';
const __d=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);

export function renderMobileDefault(){
  installDom();
  const S=require('./screenspec.js');
  const ds=JSON.parse(readFileSync(join(__d,'__fixtures__/mobile.ds.json'),'utf8'));
  const scr=JSON.parse(readFileSync(join(__d,'__fixtures__/mobile.screens.json'),'utf8')).screens[0];
  const host=document.createElement('div');
  S.mock(host, scr, ds, null, '../img/');
  return serialize(host.firstChild);
}
test('mobile default mock matches golden baseline', () => {
  const out=renderMobileDefault();
  const gp=join(__d,'__fixtures__/mobile.golden.txt');
  if(!existsSync(gp)){ writeFileSync(gp,out); }        // first run captures baseline
  assert.strictEqual(out, readFileSync(gp,'utf8'));
});
```

- [ ] **Step 4: Run to capture + verify**

Run: `node --test scripts/screenspec.golden.test.mjs`
Expected: PASS (first run writes `mobile.golden.txt`, second run compares). Run it twice; second run must PASS against the committed baseline.

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/dom-shim.mjs \
        bundles/feature-development/skills/screen-specs/scripts/__fixtures__ \
        bundles/feature-development/skills/screen-specs/scripts/screenspec.golden.test.mjs
git commit -m "test(screen-specs): golden baseline + DOM shim locking mobile render"
```

---

## Task 2: `styles.js` — the four style presets

**Files:**
- Create: `scripts/styles.js`
- Test: `scripts/styles.test.mjs`

**Interfaces:**
- Produces: `STYLES` (object keyed by `material|neo-flat|minimal-neutral|fluent`), `styleVars(styleName)` → CSS var lines string (no `:root` wrapper), `STYLE_KEYS` array. Unknown/absent style ⇒ `material`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/styles.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('./styles.js');
test('every style emits its signature flag vars', () => {
  for (const k of ['material','neo-flat','minimal-neutral','fluent']) {
    const css=S.styleVars(k);
    assert.match(css, /--shadow-1:/, k+' has shadow var');
    assert.match(css, /--border-w:/, k+' has border var');
    assert.match(css, /--radius-scale:/, k+' has radius var');
  }
  assert.match(S.styleVars('neo-flat'), /--shadow-1:\s*none/);   // flat = no shadow
  assert.notMatch(S.styleVars('material'), /--shadow-1:\s*none/);// material has shadow
});
test('unknown style falls back to material', () => {
  assert.strictEqual(S.styleVars('nope'), S.styleVars('material'));
  assert.strictEqual(S.styleVars(undefined), S.styleVars('material'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/styles.test.mjs`
Expected: FAIL ("Cannot find module './styles.js'").

- [ ] **Step 3: Write `styles.js`**

UMD returning `{ STYLES, styleVars, STYLE_KEYS }`. Each preset is a flat map of CSS vars covering: `--shadow-1`, `--shadow-2`, `--border-w`, `--border-color-adjust`, `--radius-scale` (multiplier), `--surface-alpha`, `--btn-fill` (`solid|tonal|outline`), `--motion` (`full|reduced`), plus a **default palette** (`--m-surface`, `--m-on-surface`, `--m-primary`, `--m-outline-variant`, `--m-surface-container-low`, `--m-primary-container`, `--m-on-primary-container`) so a style renders even with no project colors. Concrete values:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScreenStyles = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var base = { '--m-surface':'#ffffff','--m-on-surface':'#1a1c1e','--m-primary':'#3b5bdb',
    '--m-outline-variant':'#d7dbe0','--m-surface-container-low':'#f5f7fa',
    '--m-primary-container':'#dde3fb','--m-on-primary-container':'#0b1b57','--surface-alpha':'1' };
  function merge(a,b){ var o={}; for(var k in a)o[k]=a[k]; for(var k in b)o[k]=b[k]; return o; }
  var STYLES = {
    'material':        merge(base,{ '--shadow-1':'0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.08)',
                                    '--shadow-2':'0 4px 12px rgba(0,0,0,.14)','--border-w':'0px',
                                    '--radius-scale':'1','--btn-fill':'solid','--motion':'full' }),
    'neo-flat':        merge(base,{ '--shadow-1':'none','--shadow-2':'none','--border-w':'1px',
                                    '--radius-scale':'.35','--btn-fill':'solid','--motion':'reduced',
                                    '--m-outline-variant':'#e2e5e9' }),
    'minimal-neutral': merge(base,{ '--shadow-1':'0 1px 2px rgba(16,24,40,.05)','--shadow-2':'0 4px 8px rgba(16,24,40,.06)',
                                    '--border-w':'1px','--radius-scale':'.6','--btn-fill':'solid','--motion':'full',
                                    '--m-primary':'#111827','--m-surface-container-low':'#f9fafb','--m-outline-variant':'#e5e7eb' }),
    'fluent':          merge(base,{ '--shadow-1':'0 2px 6px rgba(0,0,0,.10)','--shadow-2':'0 8px 20px rgba(0,0,0,.12)',
                                    '--border-w':'1px','--radius-scale':'.75','--btn-fill':'solid','--motion':'full',
                                    '--surface-alpha':'.86' })
  };
  function styleVars(name){
    var s = STYLES[name] || STYLES.material;
    return Object.keys(s).map(function(k){ return '  '+k+':'+s[k]+';'; }).join('\n');
  }
  return { STYLES: STYLES, styleVars: styleVars, STYLE_KEYS: Object.keys(STYLES) };
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/styles.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/styles.js \
        bundles/feature-development/skills/screen-specs/scripts/styles.test.mjs
git commit -m "feat(screen-specs): style presets (material/neo-flat/minimal-neutral/fluent)"
```

---

## Task 3: `frameKind` + `tokens()` style layering

**Files:**
- Modify: `scripts/screenspec.js:17-24` (UMD signature + Styles wiring) and `:24-52` (`tokens`)
- Test: `scripts/tokens.test.mjs`

**Interfaces:**
- Produces: `frameKind(ds)` → `'web'|'mobile'` (`(ds.target||'mobile')==='web' ? 'web':'mobile'`); `tokens(ds)` unchanged for mobile, prepends `styleVars(ds.style)` inside `:root{}` for web (before project vars, so project wins).
- Consumes: `styles.js`'s `styleVars`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/tokens.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('./screenspec.js');
const webDs={ target:'web', style:'material', color:{roles:{light:{primary:'#abc123'}}} };
const mobDs={ color:{roles:{light:{primary:'#abc123'}}} };
test('frameKind', () => {
  assert.strictEqual(S.frameKind(webDs),'web');
  assert.strictEqual(S.frameKind(mobDs),'mobile');
  assert.strictEqual(S.frameKind({}),'mobile');
});
test('web tokens include style vars; project color overrides preset', () => {
  const css=S.tokens(webDs);
  assert.match(css, /--shadow-1:/);                 // preset present
  const i=css.indexOf('--shadow-1'), j=css.lastIndexOf('--m-primary:#abc123');
  assert.ok(j>i, 'project --m-primary declared after preset (wins)');
});
test('mobile tokens carry no style vars', () => {
  assert.doesNotMatch(S.tokens(mobDs), /--shadow-1:/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/tokens.test.mjs`
Expected: FAIL (`S.frameKind is not a function`).

- [ ] **Step 3: Implement**

Change the UMD head (lines 17-20) to obtain Styles and pass it in:

```js
(function (root, factory) {
  var Styles = (typeof module === 'object' && module.exports) ? require('./styles.js') : root.ScreenStyles;
  if (typeof module === 'object' && module.exports) module.exports = factory(Styles);
  else root.ScreenSpec = factory(Styles);
}(typeof self !== 'undefined' ? self : this, function (Styles) {
```

Add near the top of the factory body:

```js
function frameKind(ds){ return ((ds && ds.target) || 'mobile') === 'web' ? 'web' : 'mobile'; }
```

In `tokens(ds)`, compute the preset lines and inject them first inside `:root{}`:

```js
var styleCss = (frameKind(ds) === 'web' && Styles && Styles.styleVars) ? Styles.styleVars(ds.style) + '\n' : '';
return ':root{\n' + styleCss + vars(L) + '\n' + shapeVars + '\n' + typeVars + '\n' + spaceVars + '\n}\n' +
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n' + vars(D) + '\n}}\n' +
  ':root[data-theme="dark"]{\n' + vars(D) + '\n}\n';
```

Add `frameKind: frameKind` to the returned API object (line ~1047).

- [ ] **Step 4: Run tests**

Run: `node --test scripts/tokens.test.mjs scripts/styles.test.mjs scripts/screenspec.golden.test.mjs`
Expected: PASS all. **The golden test must still pass** (mobile tokens/render unchanged).

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/tokens.test.mjs
git commit -m "feat(screen-specs): frameKind + web token style layering"
```

---

## Task 4: API object + `mockWeb` slot + `mock()` dispatch

**Files:**
- Modify: `scripts/screenspec.js:884` (`mock` head) and `:1047` (exports → named `API`)

**Interfaces:**
- Produces: exports are assigned to a local `var API = {...}; return API;`. `mock()` dispatches: web target with a registered `API.mockWeb` calls it; otherwise the phone path.

- [ ] **Step 1: Add dispatch + API capture**

At the exports (line ~1047), replace `return { ... };` with:

```js
var API = {
  css: CSS, tokens: tokens, annotations: annotations, mock: mock, spec: spec,
  regionTypes: Object.keys(R), applyState: applyState, frameKind: frameKind,
  mockWeb: null, webCss: '', version: '1.0.0'
};
return API;
```

At the top of `function mock(host, screen, ds, stateName, base)` (line 884), add:

```js
if (frameKind(ds) === 'web' && API && typeof API.mockWeb === 'function')
  return API.mockWeb(host, screen, ds, stateName, base);
```

(`API` is in factory scope by the time `mock` runs, since `mock` is only called after `factory()` returns.)

- [ ] **Step 2: Test dispatch seam**

Add to `scripts/tokens.test.mjs`:

```js
test('mock dispatches to registered mockWeb on web target', () => {
  let called=false; const prev=S.mockWeb;
  S.mockWeb=(h)=>{ called=true; return h; };
  S.mock({appendChild(){}}, {regions:[]}, {target:'web'}, null, '');
  S.mockWeb=prev;
  assert.ok(called);
});
```

- [ ] **Step 3: Run tests**

Run: `node --test scripts/tokens.test.mjs scripts/screenspec.golden.test.mjs`
Expected: PASS (golden unchanged — mobile path untouched).

- [ ] **Step 4: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/tokens.test.mjs
git commit -m "feat(screen-specs): API object with mockWeb slot + web dispatch in mock()"
```

---

## Task 5: `DEVICES` library + mobile device parameterization

**Files:**
- Modify: `scripts/screenspec.js` (add `DEVICES`; parameterize the device frame in `mock()`'s mobile path; add per-device CSS rules to `CSS`)
- Test: `scripts/devices.test.mjs`

**Interfaces:**
- Produces: `DEVICES` (keyed `iphone|iphone-max|android|iphone-se`), `deviceOf(ds)` → the resolved device object. `iphone` = today's geometry/chrome; absent ⇒ `iphone`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/devices.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('./screenspec.js');
test('device resolution', () => {
  assert.strictEqual(S.deviceOf({}).id,'iphone');            // default
  assert.strictEqual(S.deviceOf({device:'nope'}).id,'iphone');// fallback
  assert.strictEqual(S.deviceOf({device:'android'}).id,'android');
  assert.strictEqual(S.deviceOf({device:'iphone'}).w, 390);  // today's width
  assert.ok(S.deviceOf({device:'iphone-max'}).w > 390);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/devices.test.mjs`
Expected: FAIL (`S.deviceOf is not a function`).

- [ ] **Step 3: Implement**

Add the table + resolver in the factory:

```js
var DEVICES = {
  'iphone':    { id:'iphone',    w:390, h:788, radius:52, chrome:'ios',      island:true,  homebar:true  },
  'iphone-max':{ id:'iphone-max',w:430, h:868, radius:56, chrome:'ios',      island:true,  homebar:true  },
  'android':   { id:'android',   w:412, h:824, radius:40, chrome:'android',  island:false, homebar:false },
  'iphone-se': { id:'iphone-se', w:375, h:667, radius:34, chrome:'ios-home', island:false, homebar:false }
};
function deviceOf(ds){ return DEVICES[(ds && ds.device)] || DEVICES.iphone; }
```

In `mock()`'s mobile path, resolve `var dev = deviceOf(ds);` and:
- set `data-device` on the device element **only when `ds.device` is present** (keeps absent-device output byte-identical);
- when `ds.device` is present, set inline `width:dev.w+'px'` on the device and `height:dev.h+'px'` on `.glass`, `border-radius:dev.radius+'px'`;
- gate the chrome: the existing dynamic-island + home-indicator markup renders when `dev.island`/`dev.homebar`; for `chrome:'android'` render an alternate status strip + gesture pill; for `ios-home` render a bottom home-button bar. **The `iphone` branch (default) must emit exactly the current markup** — wrap only the *new* device branches in conditionals, leave the iphone path as-is.

Add per-device CSS selectors to the `CSS` array (additive; do not alter existing `.device`/`.glass` rules):

```
'.device[data-device="android"]{border-radius:40px}',
'.device[data-device="android"] .glass{border-radius:30px}',
/* etc. — only [data-device="…"] scoped rules; the bare .device default is unchanged */
```

Export `DEVICES` and `deviceOf` on `API`.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/devices.test.mjs scripts/screenspec.golden.test.mjs`
Expected: PASS. **Golden must still pass** — the mobile fixture has no `device` field, so its output is unchanged.

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/devices.test.mjs
git commit -m "feat(screen-specs): mobile device library (iphone/max/android/se)"
```

---

## Task 6: Platform Call generalization (`{a,b,chose}` + legacy aliases)

**Files:**
- Modify: `scripts/screenspec.js` (add `readCall(call)` helper; export it)
- Test: `scripts/call.test.mjs`

**Interfaces:**
- Produces: `readCall(c)` → `{ topic, a, b, chose, why }` where `a=c.a||c.md3`, `b=c.b||c.ios`, `chose` maps `md3→'a'`, `ios→'b'`, passes `a|b` through.

- [ ] **Step 1: Write the failing test**

```js
// scripts/call.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const S=createRequire(import.meta.url)('./screenspec.js');
test('legacy md3/ios and new a/b resolve identically', () => {
  const legacy=S.readCall({topic:'Date',md3:'M',ios:'N',chose:'ios',why:'w'});
  const modern=S.readCall({topic:'Date',a:'M',b:'N',chose:'b',why:'w'});
  assert.deepStrictEqual(legacy, modern);
  assert.strictEqual(legacy.chose,'b');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/call.test.mjs`
Expected: FAIL (`S.readCall is not a function`).

- [ ] **Step 3: Implement**

```js
function readCall(c){
  c = c || {};
  var chose = c.chose === 'md3' ? 'a' : c.chose === 'ios' ? 'b' : c.chose;
  return { topic: c.topic, a: c.a != null ? c.a : c.md3, b: c.b != null ? c.b : c.ios,
           chose: chose, why: c.why };
}
```

Export `readCall` on `API`. (Build-screens Task 9 uses it for target-aware labels; the browser `spec()` panel, if it renders calls, also routes through it.)

- [ ] **Step 4: Run + commit**

Run: `node --test scripts/call.test.mjs scripts/screenspec.golden.test.mjs` → PASS.

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/call.test.mjs
git commit -m "feat(screen-specs): generalize platform Call to {a,b} with md3/ios aliases"
```

---

## Task 7: `screenspec.web.js` — web frame skeleton

**Files:**
- Create: `scripts/screenspec.web.js`
- Test: `scripts/web-frame.test.mjs`

**Interfaces:**
- Consumes: core `API` (via `require('./screenspec.js')` in Node; `root.ScreenSpec` in browser) and `Styles`.
- Produces: sets `API.mockWeb(host, screen, ds, stateName, base)` (renders a browser-framed viewport at `ds.__bp || 'desktop'`) and `API.webCss` (string). Web nav mapping: `webNav(kind)` → `page|split|modal|drawer|panel` (default `page`; `sheet→drawer`, `push→page`, `root→page`, `dialog→modal`, `fullscreen→page`). Breakpoint widths: `{ 'mobile-web':400, tablet:768, desktop:1280 }`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/web-frame.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
import { installDom, serialize } from './dom-shim.mjs';
const require=createRequire(import.meta.url);
test('mockWeb renders a browser frame with nav chrome', () => {
  installDom();
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  assert.strictEqual(typeof S.mockWeb,'function');
  const scr={ nav:{kind:'page'}, regions:[{type:'appbar',label:'Top'},{type:'cta',label:'Go'}] };
  const host=document.createElement('div');
  S.mockWeb(host, scr, {target:'web',style:'material',__bp:'desktop'}, null, '');
  const html=serialize(host.firstChild);
  assert.match(html, /webframe/);        // browser chrome wrapper class
  assert.match(html, /topnav|sidebar/);  // page nav chrome
});
test('webCss respects reduced motion + focus ring', () => {
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  assert.match(S.webCss, /prefers-reduced-motion/);
  assert.match(S.webCss, /:focus-visible/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/web-frame.test.mjs`
Expected: FAIL (`Cannot find module './screenspec.web.js'`).

- [ ] **Step 3: Implement the web module**

UMD that mutates the shared API:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./screenspec.js'), require('./styles.js'));
  else factory(root.ScreenSpec, root.ScreenStyles);
}(typeof self !== 'undefined' ? self : this, function (S, Styles) {
  'use strict';
  var BP = { 'mobile-web':400, 'tablet':768, 'desktop':1280 };
  function webNav(k){ return ({sheet:'drawer',push:'page',root:'page',dialog:'modal',
    fullscreen:'page',page:'page',split:'split',modal:'modal',drawer:'drawer',panel:'panel'})[k]||'page'; }
  function el(t,c){ var n=document.createElement(t); if(c)n.className=c; return n; }
  function mockWeb(host, screen, ds, stateName, base){
    var bp = ds.__bp || 'desktop', w = BP[bp] || BP.desktop;
    var kind = webNav((screen.nav||{}).kind);
    var frame = el('div','webframe'); frame.setAttribute('data-bp',bp); frame.setAttribute('data-nav',kind);
    frame.style.cssText = 'width:'+w+'px';
    var bar = el('div','webbar'); bar.appendChild(el('span','dots'));
    var url = el('div','urlpill'); url.textContent = (ds.name||'app')+' / '+(screen.title||screen.id||''); bar.appendChild(url);
    frame.appendChild(bar);
    var view = el('div','webview');
    // nav chrome: page → topnav; split → sidebar+content; mobile-web collapses to hamburger
    // (region body reuses core region renderers via S.applyState + S.regionTypes)
    // … build the chrome + body here, mirroring the mobile assembly in screenspec.js …
    frame.appendChild(view); host.appendChild(frame); return frame;
  }
  S.mockWeb = mockWeb;
  S.webCss = [
    '.webframe{margin:0 auto;border:1px solid var(--m-outline-variant);border-radius:12px;overflow:hidden;background:var(--m-surface)}',
    '.webbar{height:34px;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--m-surface-container-low);border-bottom:1px solid var(--m-outline-variant)}',
    '.webframe .topnav,.webframe .sidebar{background:var(--m-surface-container-low)}',
    '.webframe :focus-visible{outline:3px solid var(--m-primary);outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){.webframe *{transition:none!important;animation:none!important}}'
  ].join('\n');
  return S;
}));
```

Implement the `// … build the chrome + body …` section concretely: for `page`, prepend a `.topnav` strip (brand + nav items from `screen.nav.trailing`), then a `.webcontent` max-width column that renders each region via the core renderers (call the exported `S.applyState(screen, stateName)` to get regions, then render each — reuse the same per-`type` renderers the mobile path uses; expose them if needed via `S.renderRegion(r, ds, base)` added to the core API in this task). For `split`, render a `.sidebar` + fluid `.webcontent`. For `mobile-web` (w=400), replace `.topnav` with a `.hamburger` bar. **Visual verification (Task 12) confirms the result; the test here asserts structure only.**

Note: this task also adds `renderRegion(r, ds, base)` to the core `API` in `screenspec.js` (a thin wrapper over the existing internal `R[r.type]`), so the web module reuses region rendering without duplicating it.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/web-frame.test.mjs scripts/screenspec.golden.test.mjs`
Expected: PASS (golden unaffected).

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.web.js \
        bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/web-frame.test.mjs
git commit -m "feat(screen-specs): web frame renderer (mockWeb + webCss)"
```

---

## Task 8: Web region variants + `type.fonts` seam

**Files:**
- Modify: `scripts/screenspec.web.js` (add `topnav`, `sidebar`, `datatable`, `breadcrumb` renderers used when present), `scripts/screenspec.js` (`tokens()` reads `ds.type.fonts`)
- Test: `scripts/web-regions.test.mjs`

**Interfaces:**
- Produces: web region renderers reachable through the web body assembly; `tokens()` emits `--font-display/--font-body/--font-mono` from `ds.type.fonts` when present (both targets — harmless on mobile, honored on web).

- [ ] **Step 1: Write the failing test**

```js
// scripts/web-regions.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
import { installDom, serialize } from './dom-shim.mjs';
const require=createRequire(import.meta.url);
test('datatable + breadcrumb render as web regions', () => {
  installDom();
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  const scr={ nav:{kind:'page'}, regions:[
    {type:'breadcrumb', content:['Home','Bookings']},
    {type:'datatable', content:['Ref','Guest','Status']} ] };
  const html=serialize(( ()=>{const h=document.createElement('div');
    S.mockWeb(h,scr,{target:'web',style:'minimal-neutral',__bp:'desktop'},null,'');return h.firstChild;})());
  assert.match(html,/breadcrumb/); assert.match(html,/datatable/);
});
test('type.fonts becomes font-family vars', () => {
  const S=require('./screenspec.js');
  const css=S.tokens({type:{fonts:{display:'"GT Sectra"',body:'Inter',mono:'"IBM Plex Mono"'}}});
  assert.match(css,/--font-display:\s*"GT Sectra"/);
  assert.match(css,/--font-body:\s*Inter/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/web-regions.test.mjs`
Expected: FAIL (regions not rendered / no `--font-*`).

- [ ] **Step 3: Implement**

- In `screenspec.web.js`, add renderers for `topnav`, `sidebar`, `datatable`, `breadcrumb` and route them in the web body assembly (a `WR` map checked before falling back to the core `renderRegion`). `datatable` renders a `<table>` with the `content` array as headers + 2 sample rows from `screen.content`; `breadcrumb` renders a `/`-separated trail; `topnav`/`sidebar` render nav lists.
- In `screenspec.js` `tokens()`, after the existing vars, append when `ds.type.fonts`:

```js
var fonts = (ds.type || {}).fonts || {};
var fontVars = ['display','body','mono'].filter(function(k){return fonts[k];})
  .map(function(k){ return '  --font-'+k+':'+fonts[k]+';'; }).join('\n');
```

Include `fontVars` inside the `:root{}` block. (Mobile ignores the vars unless its CSS references them — it does not today, so mobile output is unchanged only if `ds.type.fonts` is absent; the mobile fixture has none, so golden holds.)

- [ ] **Step 4: Run tests**

Run: `node --test scripts/web-regions.test.mjs scripts/screenspec.golden.test.mjs`
Expected: PASS (mobile fixture has no `type.fonts` ⇒ golden unchanged).

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/screenspec.web.js \
        bundles/feature-development/skills/screen-specs/scripts/screenspec.js \
        bundles/feature-development/skills/screen-specs/scripts/web-regions.test.mjs
git commit -m "feat(screen-specs): web regions (topnav/sidebar/datatable/breadcrumb) + type.fonts"
```

---

## Task 9: `build-screens.mjs` — concat, web wiring, target-aware chrome, breakpoint toggle

**Files:**
- Modify: `scripts/build-screens.mjs`
- Test: `scripts/build.test.mjs`
- Fixtures: `scripts/__fixtures__/web-material.ds.json` (+ `neo-flat`, `minimal-neutral`, `fluent`), `scripts/__fixtures__/web.screens.json`

**Interfaces:**
- Consumes: `styles.js`, `screenspec.js`, `screenspec.web.js`.
- Produces: for a web `design-system.json`, an HTML page whose inlined `LIB` = all three scripts concatenated, whose `<style>` includes `webCss`, whose glue renders a breakpoint toggle and rebuilds mocks on change.

- [ ] **Step 1: Write the failing test**

```js
// scripts/build.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __d=dirname(fileURLToPath(import.meta.url));
function build(ds, out){ execFileSync('node',[join(__d,'build-screens.mjs'),
  '--system',join(__d,'__fixtures__',ds),'--specs',join(__d,'__fixtures__'),'--out',out]); }
test('web build inlines all three scripts + toggle + style var', () => {
  const out=mkdtempSync(join(tmpdir(),'ss-'));
  build('web-material.ds.json', out);
  const html=readFileSync(join(out,'flow.html'),'utf8');
  assert.match(html,/ScreenStyles/); assert.match(html,/mockWeb/);  // core+styles+web inlined
  assert.match(html,/data-bp/);            // breakpoint toggle wiring
  assert.match(html,/--shadow-1/);         // style preset in <style>
});
```

*(Fixtures: web `*.ds.json` set `target:"web"` + `style`; `web.screens.json` uses `flow:"flow"` so the page is `flow.html`. Put web fixtures in a separate dir from mobile if the mobile fixture would otherwise be picked up — use `--specs` pointing at a web-only subdir, or name them so `readdirSync` only matches `*.screens.json` intended for the run. Keep mobile and web screens in separate fixture subfolders to avoid cross-pickup.)*

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/build.test.mjs`
Expected: FAIL (no toggle / web not inlined).

- [ ] **Step 3: Implement build changes**

- Read all three scripts and concatenate for `LIB` (order: styles, core, web):

```js
const LIB = ['styles.js','screenspec.js','screenspec.web.js']
  .map(f => readFileSync(join(__dirname, f), 'utf8')).join('\n;\n');
const ScreenSpec = require(join(__dirname,'screenspec.js'));
require(join(__dirname,'screenspec.web.js'));   // attaches mockWeb/webCss to the same cached object
```

- Page `<style>`: `${ScreenSpec.tokens(ds)}${CHROME}${ScreenSpec.css}${ScreenSpec.frameKind(ds)==='web'?ScreenSpec.webCss:''}`.
- In the flow-page glue, when `DATA.system.target==='web'`, render a breakpoint toggle (`Mobile-web / Tablet / Desktop`, default Desktop) that sets `DATA.system.__bp` and re-invokes the mock builder for every case on the page (rebuild, per spec §3). Keep the mobile glue path unchanged.
- Call labels: replace the hardcoded "Where MD3 and iOS disagreed" / "MD3:"/"iOS:" with `ScreenSpec.readCall`-driven, target-aware labels ("Where <style> and native differ" for web). Same in the index page's standing-calls section.
- Index page type/component tables: add web columns when `ds.target==='web'` (style name, breakpoints, web nav kinds) — keep mobile columns for mobile.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/build.test.mjs`
Expected: PASS. Then build the mobile fixture and confirm it still succeeds:
Run: `node scripts/build-screens.mjs --system scripts/__fixtures__/mobile.ds.json --specs scripts/__fixtures__/mobile --out /tmp/ss-mobile` → wrote pages, no error.

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/scripts/build-screens.mjs \
        bundles/feature-development/skills/screen-specs/scripts/build.test.mjs \
        bundles/feature-development/skills/screen-specs/scripts/__fixtures__
git commit -m "feat(screen-specs): web build wiring, breakpoint toggle, target-aware chrome"
```

---

## Task 10: References split

**Files:**
- Modify: `references/schema.md`
- Create: `references/targets/mobile.md`, `references/targets/web.md`
- Modify: `references/verifying.md`

- [ ] **Step 1: Generalize `schema.md`**

Add `target` and `style` and `device` to the top-level object table. Replace the "Call (platform decision)" section's `{topic, md3, ios, chose, why}` with `{topic, a, b, chose, why}` and note the `md3`/`ios` aliases + that label text is target-decided. Move the SF-Symbols / MD3-vs-iOS prose out to `targets/mobile.md`. Add one line pointing to the two target references.

- [ ] **Step 2: Write `targets/mobile.md`**

Phone frame; the 4-device `DEVICES` library table + the `device` field (default `iphone`); mobile `nav.kind` (`push/root/sheet/dialog/fullscreen`); MD3-vs-iOS calls; SF Symbols; tab bar. (Lift the mobile-specific content that used to live in `SKILL.md`/`schema.md`.)

- [ ] **Step 3: Write `targets/web.md`**

Browser frame + three breakpoints + the toggle; web `nav.kind` (`page/split/modal/drawer/panel`) and the mapping from mobile kinds; the four styles — for each, one paragraph on the look and when to pick it, and that it is a **structural base to override**; style-vs-native platform calls; hover/focus/keyboard states (authored via the existing `changes` mechanic); web regions (`topnav/sidebar/datatable/breadcrumb`). Add a **"Working with frontend-design"** subsection: run the plugin first for the identity, express its token system in `design-system.json` (nearest style as base, override palette + `type.fonts`), and treat copy as design material (active-voice CTAs consistent through the flow; error/empty states give direction).

- [ ] **Step 4: Update `verifying.md`**

Add web checks: no sideways scroll **at each breakpoint**; `:focus-visible` visible on interactive regions; `prefers-reduced-motion` respected; the chosen style's depth/border/radius actually applied (spot-check); correct nav chrome per `nav.kind`.

- [ ] **Step 5: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/references
git commit -m "docs(screen-specs): split mobile/web references; generalize schema"
```

---

## Task 11: `SKILL.md` + designer agent update

**Files:**
- Modify: `bundles/feature-development/skills/screen-specs/SKILL.md`
- Modify: `bundles/feature-development/agents/designer/AGENT.md`

- [ ] **Step 1: Update `SKILL.md`**

- In the workflow, add: choose `target` (`mobile`|`web`), `style` (web), and `device` (mobile) in `design-system.json`.
- Replace the "Presentation drives the chrome" mobile-only framing with a pointer: mobile chrome → `references/targets/mobile.md`; web chrome + styles → `references/targets/web.md`.
- Update the `Files` table to list `styles.js`, `screenspec.web.js`.
- **No `": "` in the frontmatter `description`.** If you touch the description, keep colons out (use `—`).

- [ ] **Step 2: Update the designer agent (feature-development)**

- Remove the "Platform scope of `screen-specs` (important): … mobile-only today" block.
- Replace with: `screen-specs` covers **mobile** (device library) and **web** (responsive, 4 styles), chosen via `target`/`style`/`device` in `design-system.json`; for **web aesthetic direction, invoke the `frontend-design` plugin first if available**, then express its token system in `design-system.json`.
- Keep the frontmatter `description` free of `": "`.

- [ ] **Step 3: Validate + regenerate**

Run:
```bash
cd /Users/arozumenko/Development/sdlc-skills
node --test bundles/feature-development/skills/screen-specs/scripts/*.test.mjs
npm test
npm run gen:marketplaces
npm run validate
```
Expected: all green; marketplaces regenerated if the designer description changed.

- [ ] **Step 4: Commit**

```bash
git add bundles/feature-development/skills/screen-specs/SKILL.md \
        bundles/feature-development/agents/designer/AGENT.md \
        .cursor-plugin/marketplace.json .codex-plugin/marketplace.json .github/plugin/marketplace.json
git commit -m "docs(screen-specs): web-capable SKILL + designer agent; drop mobile-only caveat"
```

---

## Task 12: Full integration + visual confirmation

**Files:** none (verification task)

- [ ] **Step 1: Full test + validate**

Run:
```bash
cd /Users/arozumenko/Development/sdlc-skills
npm test && npm run validate
```
Expected: all pass (incl. the golden mobile test and `frontmatter-strict`).

- [ ] **Step 2: Build every fixture and open the pages**

Run the build for the mobile fixture and each of the four web fixtures into a temp dir; open the generated `index.html` and flow pages in a browser. Confirm by looking: mobile device frames (switch `device`), web browser chrome, all three breakpoints via the toggle, each of the four styles visibly different (shadow/border/radius/alpha), focus rings on tabbing, reduced-motion honored. This is manual/agent inspection — the automated screenshot harness is the queued `visual-testing` skill, out of scope here.

- [ ] **Step 3: Update memory + final commit**

Update the `designer-role-and-web-screenspecs` memory: web target shipped (4 styles + device library), and the `visual-testing` designer skill remains queued.

```bash
git add -A && git commit -m "chore(screen-specs): web target integration verified"
```

---

## Self-Review

**Spec coverage:** target/style/device config (T3,T5), full-responsive web + toggle (T7,T9), 4 styles (T2), file split + inline concat (T7,T9), Call generalization (T6), web regions (T8), references split (T10), frontend-design integration incl. `type.fonts` + quality floor (T8,T10,T11), verification incl. golden + smoke + visual (T1,T9,T12), designer agent update (T11). Follow-ups (visual-testing skill, benchmark migration, mobile styling, per-screen override) intentionally have no tasks.

**Placeholder scan:** the two large visual surfaces (web body assembly in T7, web region markup in T8) specify interfaces, structure, and a concrete example each, with structural unit tests + T12 visual confirmation — deliberate, not a placeholder; exact pixel markup is design work verified by looking.

**Type consistency:** `frameKind`, `deviceOf`, `readCall`, `styleVars`, `mockWeb`, `webCss`, `renderRegion`, `STYLE_KEYS`, `DEVICES`, `BP`, `webNav` used consistently across tasks; the core exposes `renderRegion` (added T7) so the web module reuses region rendering.
