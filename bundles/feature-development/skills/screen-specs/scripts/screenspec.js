/*!
 * screenspec.js — screen design specs as agent reference
 * ---------------------------------------------------------------------------
 * Renders a screen spec two ways at once: a device-framed mock built from the
 * spec's own regions, beside the written spec a developer implements from.
 * Both come from one source, so the picture and the contract cannot drift.
 *
 * Every colour, radius and type size resolves through the design system's
 * tokens — swap the palette in design-system.json and the mocks follow.
 *
 * API
 *   ScreenSpec.tokens(ds)              -> :root CSS custom properties (light+dark)
 *   ScreenSpec.mock(host, screen, ds, stateName?)  -> device-framed mock
 *   ScreenSpec.spec(host, screen)      -> AC, states, platform calls, a11y, refs
 *   ScreenSpec.css                     -> stylesheet the markup expects
 */
(function (root, factory) {
  var Styles = (typeof module === 'object' && module.exports) ? require('./styles.js') : root.ScreenStyles;
  if (typeof module === 'object' && module.exports) module.exports = factory(Styles);
  else root.ScreenSpec = factory(Styles);
}(typeof self !== 'undefined' ? self : this, function (Styles) {
'use strict';

/* --------------------------------------------------------------- frameKind */
function frameKind(ds) { return ((ds && ds.target) || 'mobile') === 'web' ? 'web' : 'mobile'; }

/* ----------------------------------------------------------------- DEVICES
   The mobile frame used to be hardcoded (390pt iPhone geometry, dynamic
   island, home indicator). `deviceOf(ds)` resolves a preset from `ds.device`,
   falling back to `iphone` (today's exact geometry) for an absent or unknown
   id — so specs that never opt in keep rendering the frame they always did. */
var DEVICES = {
  'iphone':    { id:'iphone',    w:390, h:788, radius:52, chrome:'ios',      island:true,  homebar:true  },
  'iphone-max':{ id:'iphone-max',w:430, h:868, radius:56, chrome:'ios',      island:true,  homebar:true  },
  'android':   { id:'android',   w:412, h:824, radius:40, chrome:'android',  island:false, homebar:false },
  'iphone-se': { id:'iphone-se', w:375, h:667, radius:34, chrome:'ios-home', island:false, homebar:false }
};
function deviceOf(ds) { return DEVICES[(ds && ds.device)] || DEVICES.iphone; }

/* ------------------------------------------------------------------ tokens */
function tokens(ds) {
  var L = ((ds.color || {}).roles || {}).light || {};
  var D = ((ds.color || {}).roles || {}).dark || L;
  var kebab = function (k) { return k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); };
  var vars = function (o) {
    return Object.keys(o).map(function (k) { return '  --m-' + kebab(k) + ':' + o[k] + ';'; }).join('\n');
  };
  var shape = {}, type = {};
  ((ds.shape || {}).scale || []).forEach(function (s) { shape[s.m3_role] = s.radius_pt; });
  ((ds.type || {}).scale || []).forEach(function (t) { type[t.m3_role] = t; });
  var shapeVars = Object.keys(shape).map(function (k) {
    return '  --r-' + kebab(k) + ':' + shape[k] + 'px;'; }).join('\n');
  /* The type scale was parsed and then thrown away — every rendered size was a
     hand-picked pixel value, so the M3→iOS mapping the system is built around
     reached no mock at all. Emit it, in points (1pt ≈ 1px at the mock's 390pt
     width), so the scale is the single source of size and weight. */
  var W = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 };
  var typeVars = Object.keys(type).map(function (k) {
    var t = type[k], size = t.ios_default_pt || t.m3_size_pt;
    return '  --t-' + kebab(k) + ':' + size + 'px;' +
           '  --tw-' + kebab(k) + ':' + (W[String(t.weight || '').toLowerCase()] || 400) + ';';
  }).join('\n');
  var sp = (ds.spacing || {}).scale || ds.spacing || {};
  var spaceVars = Object.keys(sp).filter(function (k) { return typeof sp[k] === 'number'; })
    .map(function (k) { return '  --space-' + kebab(k) + ':' + sp[k] + 'px;'; }).join('\n');
  var styleCss = (frameKind(ds) === 'web' && Styles && Styles.styleVars) ? Styles.styleVars(ds.style) + '\n' : '';
  return ':root{\n' + styleCss + vars(L) + '\n' + shapeVars + '\n' + typeVars + '\n' + spaceVars + '\n}\n' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n' + vars(D) + '\n}}\n' +
    ':root[data-theme="dark"]{\n' + vars(D) + '\n}\n';
}

/* --------------------------------------------------------------- mock CSS */
var CSS = [
'.mocks-scroll{max-width:100%;overflow-x:auto;padding-bottom:6px}',
'.annots{margin-top:10px;max-width:390px;display:flex;flex-direction:column;gap:6px}',
'.annot{font-size:11.5px;line-height:16px;color:var(--m-on-surface-variant);padding-left:11px;',
'  border-left:2px solid var(--m-outline-variant)}',
'.device{width:390px;flex:none;border-radius:52px;padding:12px;background:#1b1d1d;',
'  box-shadow:0 22px 50px rgba(0,0,0,.22),0 3px 8px rgba(0,0,0,.16);position:relative}',
'.device .glass{border-radius:41px;overflow:hidden;background:var(--m-surface,#fff);height:788px;',
'  display:flex;flex-direction:column;position:relative}',
'.dyn{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:104px;height:30px;',
'  background:#000;border-radius:16px;z-index:9}',
'.sbar{height:52px;flex:none;display:flex;align-items:flex-end;justify-content:space-between;',
'  padding:0 26px 6px;font-size:14px;font-weight:600;color:var(--m-on-surface);letter-spacing:-.2px;z-index:8}',
'.sbar .rt{display:flex;align-items:center;gap:5px}',
'.homeind{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;',
'  border-radius:3px;background:var(--m-on-surface);opacity:.85;z-index:9}',
/* navigation chrome */
'.navb{flex:none;display:flex;align-items:center;gap:8px;padding:4px 16px 8px;min-height:44px;position:relative;z-index:6}',
'.navb.hair{border-bottom:.5px solid var(--m-outline-variant)}',
'.navb .chev{width:11px;height:11px;border-left:2.2px solid var(--m-primary);border-bottom:2.2px solid var(--m-primary);',
'  transform:rotate(45deg);flex:none;margin-right:2px}',
'.navb .ttl{font-size:var(--t-title-large,17px);font-weight:var(--tw-title-large,600);color:var(--m-on-surface);letter-spacing:-.3px;',
'  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58%}',
'.navb .icons{margin-left:auto;display:flex;align-items:center;gap:16px;color:var(--m-primary)}',
'.navb .icons svg{display:block}',
'.navb .lead{font-size:17px;color:var(--m-primary);letter-spacing:-.2px}',
'.navb .tr{margin-left:auto;font-size:17px;color:var(--m-primary);letter-spacing:-.2px}',
'.navb.centered{justify-content:center}',
'.navb.centered .ttl{position:absolute;left:50%;transform:translateX(-50%)}',
'.large{padding:2px 16px 6px}',
'.large h3{margin:0;font-size:var(--t-display-small,34px);line-height:1.2;font-weight:var(--tw-display-small,700);letter-spacing:-.8px;color:var(--m-on-surface)}',
/* scrolling content */
'.body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:var(--space-lg,16px);padding:6px 16px 16px;',
'  position:relative}',
'.body.hasart > .r{position:relative;z-index:1}',
'.body.hasart{justify-content:center}',
'.body.tight{gap:var(--space-md,12px)}',
/* content runs past the fold the way a real scroll view does — fade the edge
   so the cut reads as "there is more" rather than as a rendering fault */
'.body.scrolled::before{content:"";position:absolute;left:0;right:0;top:0;height:26px;pointer-events:none;',
'  z-index:2;background:linear-gradient(to top,transparent,var(--m-surface))}',
'.body::after{content:"";position:absolute;left:0;right:0;bottom:0;height:30px;pointer-events:none;',
'  background:linear-gradient(to bottom,transparent,var(--m-surface))}',
'.acts.stack{flex-direction:column}',
'.acts.stack span{border-right:0;border-top:.5px solid var(--m-outline-variant);',
'  padding:11px 14px;white-space:normal;line-height:1.25;text-align:center}',
'.acts span.sec{font-weight:500;color:var(--m-on-surface-variant)}',
'.sheet .inner{position:relative}',
'.bleed{margin:-6px -16px 0}',
'.herowrap{position:relative;display:block;line-height:0}',
'.herowrap .heroimg{display:block;width:100%;height:196px;object-fit:cover}',
'.herocap{position:absolute;left:0;right:0;bottom:0;padding:14px 16px 12px;line-height:1.25;',
'  background:linear-gradient(to top,rgba(3,12,26,.86),rgba(3,12,26,.30) 62%,transparent)}',
'.herocap .herologo{width:152px;height:auto;display:block;margin:0 0 6px}',
'.herocap .hl{color:#fff;font-size:20px;font-weight:650;letter-spacing:.2px}',
'.herocap .hs{color:rgba(255,255,255,.88);font-size:12.5px;font-weight:500}',
/* grouped inset list, the iOS convention */
'.grp{border-radius:var(--r-large,16px);background:var(--m-surface-container-low);overflow:hidden}',
'.grp .rowm{background:transparent;border-radius:0;padding:12px 14px}',
'.rowm .sw{margin-left:auto;flex:none;width:38px;height:23px;border-radius:12px;position:relative;',
'  background:var(--m-outline-variant);transition:none}',
'.rowm .sw.on{background:var(--m-primary)}',
'.rowm .sw i{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;',
'  background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)}',
'.rowm .sw.on i{left:auto;right:2px}',
'.rowm .chevr{margin-left:auto;flex:none;width:7px;height:7px;border-right:1.6px solid var(--m-outline);',
'  border-top:1.6px solid var(--m-outline);transform:rotate(45deg);opacity:.75}',
'.grp .rowm+.rowm{border-top:.5px solid var(--m-outline-variant)}',
'.grphead{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;',
'  color:var(--m-on-surface-variant);padding:2px 4px 0}',
/* pinned action bar */
'.actionbar{flex:none;border-top:.5px solid var(--m-outline-variant);background:var(--m-surface);',
'  padding:12px 16px 22px;display:flex;flex-direction:column;gap:9px;z-index:7}',
'.actionbar .lead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
'.actionbar .lead .big{font-size:20px;font-weight:700;color:var(--m-on-surface);letter-spacing:-.4px}',
'.actionbar .lead .sub{font-size:12px;color:var(--m-on-surface-variant)}',
/* tab bar */
'.tabbar{flex:none;height:56px;border-top:.5px solid var(--m-outline-variant);background:var(--m-surface);',
'  display:flex;align-items:center;padding-bottom:12px;z-index:7}',
'.tabbar .t{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;',
'  font-size:10px;font-weight:500;color:var(--m-on-surface-variant)}',
'.tabbar .t.on{color:var(--m-primary)}',
'.tabbar .t svg{display:block}',
/* sheet + dialog presentation */
'.scrim{position:absolute;inset:0;background:rgba(0,0,0,.42);z-index:10}',
'.behind{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;padding:60px 16px 0;opacity:.5;filter:blur(.4px)}',
'.behind i{display:block;height:15px;border-radius:8px;background:var(--m-on-surface);opacity:.18}',
'.sheet{position:absolute;left:0;right:0;bottom:0;z-index:11;background:var(--m-surface);',
'  border-radius:var(--r-extra-large,28px) var(--r-extra-large,28px) 0 0;padding:8px 16px 24px;display:flex;flex-direction:column;gap:12px;',
'  max-height:74%;box-shadow:0 -10px 30px rgba(0,0,0,.18)}',
'.sheet .grab{width:36px;height:5px;border-radius:3px;background:var(--m-outline-variant);margin:0 auto 4px}',
'.sheet .x{position:absolute;top:14px;right:16px;font-size:17px;color:var(--m-on-surface-variant)}',
'.dialog{position:absolute;left:36px;right:36px;top:50%;transform:translateY(-50%);z-index:11;',
'  background:var(--m-surface-container-low);border-radius:16px;padding:18px 18px 6px;text-align:center;',
'  box-shadow:0 14px 40px rgba(0,0,0,.28)}',
'.dialog .dt{font-size:15px;font-weight:600;color:var(--m-on-surface)}',
'.dialog .dm{font-size:12.5px;line-height:18px;color:var(--m-on-surface-variant);margin-top:5px}',
'.dialog .acts{display:flex;margin:14px -18px 0;border-top:.5px solid var(--m-outline-variant)}',
'.dialog .acts span{flex:1;padding:11px 0;font-size:15px;color:var(--m-primary)}',
'.dialog .acts span+span{border-left:.5px solid var(--m-outline-variant);font-weight:600}',
'.r{flex:none}',
'.r-appbar{display:flex;align-items:center;gap:10px;padding:4px 2px 6px}',
'.r-appbar .back{width:11px;height:11px;border-left:2px solid var(--m-primary);border-bottom:2px solid var(--m-primary);transform:rotate(45deg)}',
'.r-appbar h4{margin:0;font-size:17px;font-weight:600;color:var(--m-on-surface)}',
'.r-appbar .tr{margin-left:auto;font-size:13px;color:var(--m-primary);font-weight:500}',
'.r-search{display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:20px;',
'  background:var(--m-surface-container-high,#eee);color:var(--m-on-surface-variant,#555);font-size:13px}',
'.r-search .mag{width:11px;height:11px;border:1.6px solid currentColor;border-radius:50%;flex:none}',
'.chips{display:flex;gap:6px;flex-wrap:wrap}',
'.chip-m{font-size:11px;padding:5px 11px;border-radius:var(--r-extra-small,8px);border:1px solid var(--m-outline-variant,#ccc);',
'  color:var(--m-on-surface-variant,#555);background:var(--m-surface,#fff)}',
'.chip-m.on{background:var(--m-secondary-container);color:var(--m-on-secondary-container);border-color:transparent}',
'.seg{display:flex;background:var(--m-surface-container-high,#eee);border-radius:9px;padding:2px}',
'.seg span{flex:1;text-align:center;font-size:12px;padding:5px 0;border-radius:7px;color:var(--m-on-surface-variant)}',
'.seg span.on{background:var(--m-surface,#fff);color:var(--m-on-surface);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14)}',
'.hero{width:100%;height:172px;border-radius:var(--r-large,16px);object-fit:cover;display:block;background:var(--m-surface-container-high)}',
'.hero.flush{border-radius:0;height:196px}',
'.galwrap{display:flex;flex-direction:column;gap:6px}',
'.galhero{width:100%;height:168px;object-fit:cover;border-radius:var(--r-large,16px);display:block;background:var(--m-surface-container-high)}',
'.galmore{font-size:10.5px;color:var(--m-on-surface-variant)}',
'.gal{display:flex;gap:6px;overflow:hidden}',
'.gal img{width:72px;height:54px;object-fit:cover;border-radius:var(--r-medium,12px);flex:none;background:var(--m-surface-container-high)}',
'.sech{font-size:var(--t-headline-small,20px);line-height:1.28;font-weight:var(--tw-headline-small,600);',
'  letter-spacing:-.45px;color:var(--m-on-surface);margin-top:var(--space-xl,24px)}',
'.body > .sech:first-child{margin-top:0}',
'.shelf{display:flex;gap:12px;overflow:hidden;margin:0 -16px;padding:0 16px}',
'.shelf .scard{width:186px;flex:none;display:flex;flex-direction:column;gap:0}',
'.shelf .scard .ph{position:relative;width:100%;height:126px;border-radius:var(--r-large,16px);overflow:hidden;background:var(--m-surface-container-high)}',
'.shelf .scard .ph img{width:100%;height:100%;object-fit:cover;display:block}',
'.shelf .scard .hrt{position:absolute;top:9px;right:9px;width:28px;height:28px;border-radius:50%;',
'  background:rgba(255,255,255,.92);display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.22)}',
'.shelf .scard .t{font-size:var(--t-title-small,15px);line-height:1.3;font-weight:var(--tw-title-small,600);letter-spacing:-.2px;color:var(--m-on-surface);margin-top:9px}',
'.shelf .scard .s{font-size:var(--t-body-small,12.5px);line-height:1.35;color:var(--m-on-surface-variant);margin-top:1px}',
'.shelf .scard .p{font-size:var(--t-label-large,14px);line-height:1.3;font-weight:600;color:var(--m-tertiary);margin-top:5px}',
'.card-m{border-radius:var(--r-medium,12px);background:var(--m-surface-container-low,#f6f6f6);padding:10px;display:flex;gap:12px}',
'.card-m img{width:88px;height:78px;object-fit:cover;border-radius:var(--r-small,8px);flex:none}',
'.card-m .t{font-size:14px;font-weight:600;color:var(--m-on-surface);line-height:18px}',
'.card-m .s{font-size:12px;color:var(--m-on-surface-variant);margin-top:3px;line-height:16px}',
'.card-m .p{margin-top:auto;font-size:14px;font-weight:700;color:var(--m-on-surface)}',
'.rowm{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;',
'  border-radius:var(--r-medium,12px);background:var(--m-surface-container-low,#f6f6f6)}',
'.rowm .k{font-size:13px;color:var(--m-on-surface)}',
'.rowm .v{font-size:13px;font-weight:600;color:var(--m-on-surface)}',
'.fieldm{border:1px solid var(--m-outline,#888);border-radius:var(--r-small,8px);padding:8px 12px;background:var(--m-surface)}',
'.fieldm .lab{font-size:10px;color:var(--m-on-surface-variant);letter-spacing:.3px}',
'.fieldm .val{font-size:14px;color:var(--m-on-surface);margin-top:2px}',
'.stepm{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:var(--r-medium,12px);',
'  background:var(--m-surface-container-low,#f6f6f6)}',
'.stepm .ctl{display:flex;align-items:center;gap:12px}',
'.stepm .btn{width:26px;height:26px;border-radius:50%;border:1.4px solid var(--m-outline);color:var(--m-on-surface);',
'  display:grid;place-items:center;font-size:14px;line-height:1}',
'.stepm .n{font-size:14px;font-weight:600;min-width:14px;text-align:center;color:var(--m-on-surface)}',
'.pricem{display:flex;align-items:baseline;gap:8px;padding-top:2px}',
'.pricem .big{font-size:var(--t-headline-small,22px);font-weight:700;color:var(--m-tertiary);letter-spacing:-.4px}',
'.pricem .sub{font-size:12px;color:var(--m-on-surface-variant)}',
'.pricem .upd{font-size:12px;color:var(--m-primary);display:inline-flex;align-items:center;gap:6px}',
'.spin{width:12px;height:12px;border:2px solid var(--m-primary);border-right-color:transparent;border-radius:50%;display:inline-block}',
'.bannerm{border-radius:var(--r-medium,12px);padding:9px 12px;font-size:12px;line-height:17px;',
'  background:var(--m-tertiary-container);color:var(--m-on-tertiary-container)}',
'.noticem{border-radius:var(--r-medium,12px);padding:9px 12px;font-size:12px;line-height:17px;',
'  background:var(--m-tertiary-container);color:var(--m-on-tertiary-container)}',
'.errorm{border-radius:var(--r-medium,12px);padding:9px 12px;font-size:12px;line-height:17px;',
'  background:var(--m-error-container);color:var(--m-on-error-container)}',
'.ctam{height:48px;border-radius:var(--r-large,16px);background:var(--m-primary);color:var(--m-on-primary);display:grid;place-items:center;',
'  font-size:14px;font-weight:600;letter-spacing:.2px}',
'.ctam.disabled{background:var(--m-surface-container-high);color:var(--m-on-surface-variant);opacity:.55;',
'  box-shadow:none}',
'.ctam.tonal{background:var(--m-secondary-container);color:var(--m-on-secondary-container)}',
'.ctam2{height:46px;border-radius:var(--r-large,16px);border:1.4px solid var(--m-outline);color:var(--m-primary);display:grid;place-items:center;font-size:14px;font-weight:600}',
'.textm{font-size:var(--t-body-medium,13px);line-height:1.45;color:var(--m-on-surface-variant)}',
'.textm.strong{color:var(--m-on-surface);font-weight:600;font-size:var(--t-title-medium,15px)}',
'.ln+.ln{margin-top:3px}',
'.ln.lead{font-weight:600;color:var(--m-on-surface)}',
'.bannerm .ln.lead,.noticem .ln.lead,.errorm .ln.lead{color:inherit}',
'.rico{display:block;margin:0 auto 6px}',
'.divm{height:1px;background:var(--m-outline-variant);margin:2px 0}',
/* Backdrops built from geometry, not photographs. A photo behind an empty
   state is filler; a halftone field and a few rules read as designed surface
   and cost nothing. Everything derives from --m-primary, so both themes and
   any future re-seed follow automatically. */
'.halftone{position:absolute;inset:0;pointer-events:none;z-index:0;',
'  background-image:radial-gradient(var(--m-primary) 1.1px,transparent 1.2px);',
'  background-size:10px 10px;background-position:0 0;opacity:.26;',
'  -webkit-mask-image:radial-gradient(88% 52% at 50% 46%,#000 0%,rgba(0,0,0,.5) 55%,transparent 82%);',
'          mask-image:radial-gradient(88% 52% at 50% 46%,#000 0%,rgba(0,0,0,.5) 55%,transparent 82%)}',
/* the tower motif from the mark, drawn once, very quietly */
'.towerart{position:absolute;left:50%;top:50%;width:176px;height:196px;',
'  transform:translate(-50%,-46%);pointer-events:none;z-index:0;opacity:.17}',
'.towerart i{position:absolute;bottom:0;border-radius:3px;background:var(--m-primary);display:block}',
'.towerart i:nth-child(1){left:50%;margin-left:-13px;width:26px;height:100%}',
'.towerart i:nth-child(2){left:50%;margin-left:-40px;width:15px;height:72%}',
'.towerart i:nth-child(3){left:50%;margin-left:25px;width:15px;height:72%}',
'.towerart i:nth-child(4){left:50%;margin-left:-34px;width:68px;height:5px;bottom:-9px;border-radius:3px}',
/* horizon rules — the azure the name means, as a ground line */
'.rules{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:0;opacity:.30;',
'  background-image:linear-gradient(var(--m-outline-variant) 1px,transparent 1px);',
'  background-size:100% 28px;',
'  -webkit-mask-image:linear-gradient(transparent 0%,#000 40%,transparent 92%);',
'          mask-image:linear-gradient(transparent 0%,#000 40%,transparent 92%)}',
'.emptym{position:relative;z-index:1}',
'.emptym{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;text-align:center;',
'  padding:22px 20px;border-radius:var(--r-medium,12px);background:var(--m-surface-container-low);border:1px dashed var(--m-outline-variant)}',
'.emptym.full{flex:1;border:0;background:transparent;padding:0 24px;gap:10px}',
/* over artwork the empty state stops being a dashed placeholder box and
   becomes type floating on the pattern — the box would only hide it */
'.body.hasart .emptym{background:transparent;border:0;padding:26px 20px}',
/* the tower motif IS the illustration here — the generic placeholder
   square would just collide with it */
'.emptym .ico.mark{width:60px;height:60px;border:0;border-radius:17px;object-fit:contain;',
'  box-shadow:0 6px 18px rgba(0,0,0,.16)}',
'.emptym .ico{width:52px;height:52px;border-radius:16px;border:2px solid var(--m-outline-variant)}',
'.skelm{display:flex;flex-direction:column;gap:8px}',
'.skelm i{display:block;height:14px;border-radius:7px;background:var(--m-surface-container-high);opacity:.9}',
'.handle{width:36px;height:4px;border-radius:2px;background:var(--m-outline-variant);margin:2px auto 6px}',
'.mapm{height:190px;border-radius:var(--r-large,16px);background:var(--m-surface-container-high);position:relative;overflow:hidden}',
'.mapm .pin{position:absolute;padding:4px 9px;border-radius:12px;background:var(--m-primary);color:var(--m-on-primary);',
'  font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25)}',
'.footm{font-size:10.5px;line-height:15px;color:var(--m-on-surface-variant);opacity:.9}',
'.sheetm{margin-top:auto;background:var(--m-surface-container-low);border-radius:22px 22px 0 0;padding:10px 14px 16px;',
'  display:flex;flex-direction:column;gap:10px;box-shadow:0 -6px 20px rgba(0,0,0,.14)}',
/* per-device chrome — additive [data-device="…"] overrides only; the bare
   .device/.glass rules above stay the untouched iphone default */
'.device[data-device="iphone-max"]{border-radius:56px}',
'.device[data-device="iphone-max"] .glass{border-radius:45px}',
'.device[data-device="android"]{border-radius:40px}',
'.device[data-device="android"] .glass{border-radius:30px}',
'.device[data-device="iphone-se"]{border-radius:34px}',
'.device[data-device="iphone-se"] .glass{border-radius:24px}',
'.device[data-device="android"] .andstat{height:28px;flex:none;display:flex;align-items:center;',
'  justify-content:flex-end;padding:0 14px;z-index:8}',
'.device[data-device="android"] .andgest{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);',
'  width:100px;height:4px;border-radius:2px;background:var(--m-on-surface);opacity:.6;z-index:9}',
'.device[data-device="iphone-se"] .homebtn{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);',
'  width:46px;height:46px;border-radius:50%;border:2px solid var(--m-on-surface);opacity:.55;z-index:9}'
].join('\n');

/* --------------------------------------------------------------- helpers */
function h(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
function first(v) { return Array.isArray(v) ? v[0] : v; }
function lines(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
/* Names are extensionless by convention and resolve to .jpg — but a name that
   already carries an extension (an .svg logo lockup) must be left alone. */
function imgSrc(name, base) {
  var n = String(name || '');
  return (base || '../assets/img/') + n + (/\.(jpg|jpeg|png|svg|webp)$/i.test(n) ? '' : '.jpg');
}

/* A spec's `content` array is a headline followed by supporting lines, not one
   sentence — joining them produced run-ons like "Only 2 left Reduce to 2 to
   continue". And an entry naming an SF Symbol is an icon directive, not copy:
   the confirmation screen was literally printing "checkmark.circle.fill (SF
   Symbol, tinted primary)" to the user. */
var SFSYM = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+\s*(\(|$)/i;
function stack(cls, r) {
  var n = h('div', cls);
  var parts = lines(r.content).filter(Boolean);
  var icon = null;
  parts = parts.filter(function (x) {
    if (typeof x === 'string' && SFSYM.test(x.trim())) { icon = x.trim(); return false; }
    return true;
  });
  if (!parts.length && r.label) parts = [r.label];
  if (icon) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '26'); svg.setAttribute('height', '26'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'rico');
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
    c.setAttribute('fill', /check|success/i.test(icon) ? 'var(--m-primary)' : 'none');
    c.setAttribute('stroke', 'currentColor'); c.setAttribute('stroke-width', '1.6');
    svg.appendChild(c);
    if (/check/i.test(icon)) {
      var pa = document.createElementNS(NS, 'path');
      pa.setAttribute('d', 'M7.6 12.3 10.6 15.2 16.4 9.2');
      pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'var(--m-on-primary)');
      pa.setAttribute('stroke-width', '2'); pa.setAttribute('stroke-linecap', 'round');
      pa.setAttribute('stroke-linejoin', 'round'); svg.appendChild(pa);
    }
    n.appendChild(svg);
  }
  parts.forEach(function (t, i) {
    n.appendChild(h('div', i === 0 && parts.length > 1 ? 'ln lead' : 'ln', t));
  });
  return n;
}

/* ------------------------------------------------------- region renderers */
var R = {
  appbar: function (r) {
    var n = h('div', 'r r-appbar');
    if ((r.leading || '').toLowerCase() !== 'none') n.appendChild(h('span', 'back'));
    n.appendChild(h('h4', null, first(r.content) || r.label || ''));
    if (r.trailing) n.appendChild(h('span', 'tr', r.trailing));
    return n;
  },
  searchfield: function (r) {
    var n = h('div', 'r r-search');
    n.appendChild(h('span', 'mag'));
    n.appendChild(h('span', null, first(r.content) || r.label || 'Search'));
    return n;
  },
  chips: function (r) {
    var n = h('div', 'r chips');
    lines(r.content).forEach(function (c, i) {
      n.appendChild(h('span', 'chip-m' + (i === 0 && r.selected !== false ? ' on' : ''), c));
    });
    return n;
  },
  segmented: function (r) {
    var n = h('div', 'r seg');
    lines(r.content).forEach(function (c, i) { n.appendChild(h('span', i === 0 ? 'on' : '', c)); });
    return n;
  },
  hero: function (r, ds, base) {
    var txt = lines(r.content).filter(function (x) {
      return typeof x === 'string' && !/^(roomtype|hero)_|\.(jpg|png|svg)$/.test(x);
    });
    if (!r.image) {
      var d = h('div', 'r hero');
      if (txt.length) d.appendChild(heroCap(txt, r, base));
      return d;
    }
    var im = document.createElement('img');
    im.className = 'r hero'; im.src = imgSrc(r.image, base); im.alt = r.label || '';
    im.loading = 'lazy';
    /* A hero with words is a different component from a hero without: the text
       sits ON the photograph, over a scrim, the way a property introduces
       itself. Returning the bare <img> silently dropped every line of it. */
    if (!txt.length && !r.logo) return im;
    var wrap = h('div', 'r herowrap');
    wrap.appendChild(im);
    im.className = 'heroimg';
    wrap.appendChild(heroCap(txt, r, base));
    return wrap;
  },
  gallery: function (r, ds, base) {
    /* image names may arrive via `image`, via `content`, or split across both —
       gather from everywhere, keep order, drop duplicates */
    var names = lines(r.image).concat(lines(r.content))
      .filter(function (x) { return typeof x === 'string' && /^(roomtype|hero)_|\.(jpg|png)$/.test(x); });
    names = names.filter(function (x, i) { return names.indexOf(x) === i; });
    if (!names.length) return h('div', 'r gal');
    var wrapEl = h('div', 'r galwrap');
    var lead = document.createElement('img');
    lead.className = 'galhero';
    lead.src = /\.(jpg|png)$/.test(names[0]) ? names[0] : imgSrc(names[0], base);
    lead.alt = r.label || ''; lead.loading = 'lazy';
    wrapEl.appendChild(lead);
    if (names.length > 1) {
      var strip = h('div', 'gal');
      names.slice(1, 5).forEach(function (x) {
        var im = document.createElement('img');
        im.src = /\.(jpg|png)$/.test(x) ? x : imgSrc(x, base);
        im.alt = ''; im.loading = 'lazy'; strip.appendChild(im);
      });
      wrapEl.appendChild(strip);
      if (names.length > 5) {
        var more = h('div', 'galmore', '+' + (names.length - 5) + ' more');
        wrapEl.appendChild(more);
      }
    }
    return wrapEl;
  },
  list: function (r, ds, base) {
    var n = h('div', 'r'); n.style.display = 'flex'; n.style.flexDirection = 'column'; n.style.gap = '8px';
    lines(r.content).slice(0, 3).forEach(function (c, i) {
      n.appendChild(R.card({ type: 'card', content: c, image: lines(r.image)[i] || lines(r.image)[0] }, ds, base));
    });
    return n;
  },
  card: function (r, ds, base) {
    var n = h('div', 'r card-m');
    var img = lines(r.image)[0];
    if (img) { var im = document.createElement('img'); im.src = imgSrc(img, base); im.alt=''; im.loading='lazy'; n.appendChild(im); }
    var col = h('div'); col.style.cssText = 'display:flex;flex-direction:column;flex:1;min-width:0';
    var parts = lines(r.content);
    col.appendChild(h('div', 't', parts[0] || r.label || ''));
    if (parts[1]) col.appendChild(h('div', 's', parts[1]));
    if (parts[2]) col.appendChild(h('div', 'p', parts[2]));
    n.appendChild(col);
    return n;
  },
  row: function (r) {
    var n = h('div', 'r rowm');
    var parts = lines(r.content);
    n.appendChild(h('span', 'k', parts[0] || r.label || ''));
    n.appendChild(h('span', 'v', parts[1] || ''));
    /* A settings row's trailing affordance IS its meaning: a switch says this
       toggles, a chevron says this goes somewhere, and neither says it is inert
       text. A toggle screen drawn without its toggles shows nothing. The
       component name in the spec already carries the answer. */
    var comp = ((r.m3 || {}).component || '') + ' ' + (r.label || '') + ' ' + (parts[0] || '');
    if (/switch|toggle/i.test(comp)) {
      var on = /\bon\b|enabled|armed/i.test(String(parts[0] || '') + ' ' + String(r.state || ''));
      var sw = h('span', 'sw' + (on ? ' on' : ''));
      sw.appendChild(h('i'));
      n.appendChild(sw);
    } else if (/navigat|disclosure|→|opens|chevron/i.test(comp) || /…$/.test(String(parts[0] || ''))) {
      n.appendChild(h('span', 'chevr'));
    }
    return n;
  },
  field: function (r) {
    var n = h('div', 'r fieldm');
    n.appendChild(h('div', 'lab', r.label || ''));
    n.appendChild(h('div', 'val', first(r.content) || ''));
    return n;
  },
  datefield: function (r) { return R.field(r); },
  stepper: function (r) {
    var n = h('div', 'r stepm');
    var parts = lines(r.content);
    n.appendChild(h('span', 'k', parts[0] || r.label || ''));
    var ctl = h('div', 'ctl');
    ctl.appendChild(h('span', 'btn', '−'));
    ctl.appendChild(h('span', 'n', parts[1] || '2'));
    ctl.appendChild(h('span', 'btn', '+'));
    n.appendChild(ctl);
    return n;
  },
  price: function (r) {
    var n = h('div', 'r pricem');
    var parts = lines(r.content);
    if (r.updating) {
      n.appendChild(h('span', 'spin'));
      n.appendChild(h('span', 'upd', parts[0] || 'Updating price…'));
    } else {
      n.appendChild(h('span', 'big', parts[0] || ''));
      if (parts[1]) n.appendChild(h('span', 'sub', parts[1]));
    }
    return n;
  },
  banner: function (r) { return stack('r bannerm', r); },
  notice: function (r) { return stack('r noticem', r); },
  error:  function (r) { return stack('r errorm', r); },
  cta: function (r) {
    /* specs express disabled in prose as often as with a flag — "Book Now
       (disabled until a date is chosen)" — and the one state that most needs
       to read as "you cannot proceed" was rendering fully opaque */
    var txt = String(first(r.content) || r.label || '');
    var off = r.disabled === true ||
      /\b(disabled|greyed|grayed|inactive|not tappable|unavailable)\b/i.test(txt + ' ' + String(r.label || '') + ' ' + String(r.state || ''));
    return h('div', 'r ctam' + (off ? ' disabled' : '') + (r.tonal ? ' tonal' : ''), txt);
  },
  'secondary-cta': function (r) { return h('div', 'r ctam2', first(r.content) || r.label || ''); },
  divider: function () { return h('div', 'r divm'); },
  text: function (r) {
    return stack('r textm' + (r.emphasis === 'strong' ? ' strong' : ''), r);
  },
  footnote: function (r) { return stack('r footm', r); },
  empty: function (r, ds, base) {
    var n = h('div', 'r emptym' + (r.full ? ' full' : ''));
    /* An empty screen is a good place for the property to sign its name. If the
       design system defines a brand mark, use it — a generic outlined square
       says nothing and is the tell of an unfinished empty state. */
    var mark = ds && ds.brand && ds.brand.mark;
    if (mark) {
      var mi = document.createElement('img');
      mi.className = 'ico mark'; mi.src = imgSrc(mark, base); mi.alt = '';
      n.appendChild(mi);
    } else {
      n.appendChild(h('div', 'ico'));
    }
    var parts = lines(r.content);
    n.appendChild(h('div', 'textm strong', parts[0] || r.label || ''));
    if (parts[1]) n.appendChild(h('div', 'textm', parts[1]));
    return n;
  },
  skeleton: function (r) {
    var n = h('div', 'r skelm');
    var count = Number(r.count) || 4;
    for (var i = 0; i < count; i++) {
      var b = h('i'); b.style.width = (100 - i * 9) + '%'; n.appendChild(b);
    }
    return n;
  },
  'sheet-handle': function () { return h('div', 'r handle'); },
  map: function (r) {
    var n = h('div', 'r mapm');
    var pins = lines(r.content).slice(0, 4);
    var at = [[18, 22], [52, 40], [30, 62], [66, 70]];
    pins.forEach(function (p, i) {
      var pin = h('span', 'pin', p);
      pin.style.left = at[i][0] + '%'; pin.style.top = at[i][1] + '%';
      n.appendChild(pin);
    });
    return n;
  }
};

/* ---------------------------------------------------------- region roles
   A spec region is not always a piece of UI. Some carry commentary for the
   reader — "2 more cards scroll off-screen", "Capped at ~10 rows (AC-7.8)",
   "UNCHANGED from S-001-0, not restated here". Drawing those inside the phone
   is the same mistake as printing "(SF Symbols, not text buttons)" in a nav
   bar: the mock stops showing the screen and starts documenting itself. They
   are surfaced as annotations beside the device instead. */
var NOTEY = /\b(AC-\d|DEC-\d|not restated|scroll off-screen|off-screen|capped at|seeding scale|per DEC|same content shape|recommends|unchanged from|rendered in place|see §)\b/i;
function regionRole(r) {
  var label = String(r.label || ''), content = lines(r.content).join(' ');
  if (/\balt state\b/i.test(label)) return 'alt';           // belongs to another state
  if (/section header/i.test(label)) return 'header';
  if (/^(text|footnote)$/.test(r.type) && (NOTEY.test(content) || /\bnote\b/i.test(label))) return 'annotation';
  if (r.type === 'footnote' && NOTEY.test(label)) return 'annotation';
  return 'ui';
}

/* Consecutive cards under one header are a shelf — horizontally scrolled,
   image-first, the way every travel app presents a curated row. */
function shelfify(regions) {
  var out = [], run = null;
  regions.forEach(function (r) {
    if (r.type === 'card') { (run = run || []).push(r); return; }
    if (run) { out.push({ __shelf: run }); run = null; }
    out.push(r);
  });
  if (run) out.push({ __shelf: run });
  return out;
}

/* ------------------------------------------------------------------ mock */
function stateKeyOf(n){ return String(n==null?'':n).split(/\s*\(/)[0].trim().toLowerCase(); }

/* Compare region labels the way state names are compared: leading token, case
   and parenthetical insensitive, so `focus` can name a region the way a human
   would rather than by exact string. */
function stemOf(x) {
  /* split on a parenthetical or a spaced dash only — never a word-internal
     hyphen, or "Check-in / check-out dates" collapses to "check" and starts
     matching any region whose label happens to begin with that word */
  return String(x == null ? '' : x).split(/\s*\(|\s+[\u2014\u2013-]\s+/)[0].trim().toLowerCase();
}

function focusOf(screen, stateName) {
  var states = screen.states || [];
  var active = stateName ? stateKeyOf(stateName) : null;
  if (active) {
    var st = states.filter(function (s) { return stateKeyOf(s.name) === active; })[0];
    if (st && st.focus) return st.focus;
  }
  return screen.focus || null;
}

function applyState(screen, stateName) {
  var regions = (screen.regions || []).map(function (r) { return Object.assign({}, r); });
  var states = screen.states || [];
  var dflt = states.filter(function (s) { return /default/i.test(s.name || ''); })[0];
  var active = stateName ? stateKeyOf(stateName) : (dflt ? stateKeyOf(dflt.name) : null);
  var st = states.filter(function (s) { return stateKeyOf(s.name) === active; })[0];
  /* A region's `state` names the variant it depicts, and specs mark their own
     baseline inline — "not-favourited (default)", "zero-saved-hotels (default
     at first launch)". Those are region-local defaults: they must survive any
     view that doesn't explicitly replace them, or a screen renders its section
     headers with every shelf beneath them empty.

     A variant replaces a default only when the two are adjacent in the spec,
     which is how these files order alternatives — the empty inset immediately
     followed by its populated counterpart. Sibling regions in one shelf
     ("card 1 of 4", "card 2 of 4") are therefore never mistaken for
     alternatives to each other. */
  /* "not-favourited (default)" and a bare "default" both mean baseline; only
     matching the parenthesised form made a region vanish from every view. */
  var isDefault = function (v) { return /(^|\()default/i.test(String(v || '').trim()); };
  var matchesActive = function (r) { return r.state && stateKeyOf(r.state) === active; };
  regions = regions.filter(function (r, i) {
    if (!r.state) return true;
    if (matchesActive(r)) return true;
    if (!isDefault(r.state)) return false;
    var replaced = [regions[i - 1], regions[i + 1], regions[i + 2]]
      .some(function (n) { return n && matchesActive(n) && n.type === r.type; });
    return !replaced;
  });
  /* Apply the state's structured changes. A change targets a region by label
     (exact, then stem-prefix, then type) and either edits it, hides it, or
     inserts a new one. Prose entries are ignored here on purpose — they are
     for the reader and carry no mechanical effect; the builder detects a state
     that renders identically to the default and says so rather than drawing a
     duplicate phone. */
  if (st && Array.isArray(st.changes)) {
    var norm = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
    var findIdx = function (target, type) {
      var t = norm(target);
      if (!t && type) {
        for (var k = 0; k < regions.length; k++) if (regions[k].type === type) return k;
        return -1;
      }
      var i = regions.map(function (r) { return norm(r.label); }).indexOf(t);
      if (i >= 0) return i;
      for (var j = 0; j < regions.length; j++) {
        var l = norm(regions[j].label);
        if (l && (l.indexOf(t) === 0 || t.indexOf(l) === 0)) return j;
      }
      if (type) for (var m = 0; m < regions.length; m++) if (regions[m].type === type) return m;
      return -1;
    };
    st.changes.forEach(function (c) {
      if (!c || typeof c !== 'object') return;              /* prose: no effect */
      var idx = findIdx(c.region || c.label, c.type);
      if (c.hidden === true || c.remove === true) {
        if (idx >= 0) regions.splice(idx, 1);
        return;
      }
      var patch = {};
      Object.keys(c).forEach(function (k) {
        if (['region', 'hidden', 'remove', 'after', 'describe'].indexOf(k) < 0) patch[k] = c[k];
      });
      if (idx >= 0) { regions[idx] = Object.assign({}, regions[idx], patch); return; }
      if (!c.type) return;                                   /* nothing to insert */
      var at = c.after ? findIdx(c.after) : -1;
      if (at >= 0) regions.splice(at + 1, 0, patch); else regions.push(patch);
    });
  }
  return regions;
}

/* --- status bar and home indicator, drawn rather than faked with bullets --- */
function statusBar() {
  var bar = h('div', 'sbar');
  bar.appendChild(h('span', null, '9:41'));
  var rt = h('div', 'rt');
  var NS = 'http://www.w3.org/2000/svg';
  var sig = document.createElementNS(NS, 'svg');
  sig.setAttribute('width', '18'); sig.setAttribute('height', '12'); sig.setAttribute('viewBox', '0 0 18 12');
  [3, 6, 9, 12].forEach(function (hgt, i) {
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', i * 4.4); r.setAttribute('y', 12 - hgt);
    r.setAttribute('width', '3'); r.setAttribute('height', hgt); r.setAttribute('rx', '1');
    r.setAttribute('fill', 'currentColor'); sig.appendChild(r);
  });
  var wifi = document.createElementNS(NS, 'svg');
  wifi.setAttribute('width', '16'); wifi.setAttribute('height', '12'); wifi.setAttribute('viewBox', '0 0 16 12');
  [[2, 'M1 4.4a10 10 0 0 1 14 0'], [4, 'M3.6 7a6.4 6.4 0 0 1 8.8 0'], [6, 'M6.2 9.5a2.7 2.7 0 0 1 3.6 0']]
    .forEach(function (p) {
      var pa = document.createElementNS(NS, 'path');
      pa.setAttribute('d', p[1]); pa.setAttribute('stroke', 'currentColor');
      pa.setAttribute('stroke-width', '1.6'); pa.setAttribute('fill', 'none');
      pa.setAttribute('stroke-linecap', 'round'); wifi.appendChild(pa);
    });
  var bat = document.createElementNS(NS, 'svg');
  bat.setAttribute('width', '26'); bat.setAttribute('height', '13'); bat.setAttribute('viewBox', '0 0 26 13');
  var shell = document.createElementNS(NS, 'rect');
  shell.setAttribute('x', '.7'); shell.setAttribute('y', '.7'); shell.setAttribute('width', '21');
  shell.setAttribute('height', '11.6'); shell.setAttribute('rx', '3.4');
  shell.setAttribute('stroke', 'currentColor'); shell.setAttribute('opacity', '.4');
  shell.setAttribute('stroke-width', '1'); shell.setAttribute('fill', 'none'); bat.appendChild(shell);
  var fill = document.createElementNS(NS, 'rect');
  fill.setAttribute('x', '2.4'); fill.setAttribute('y', '2.4'); fill.setAttribute('width', '15.5');
  fill.setAttribute('height', '8.2'); fill.setAttribute('rx', '2.2'); fill.setAttribute('fill', 'currentColor');
  bat.appendChild(fill);
  var nub = document.createElementNS(NS, 'path');
  nub.setAttribute('d', 'M23.4 4.6v3.8a2 2 0 0 0 0-3.8z');
  nub.setAttribute('fill', 'currentColor'); nub.setAttribute('opacity', '.4'); bat.appendChild(nub);
  rt.appendChild(sig); rt.appendChild(wifi); rt.appendChild(bat);
  bar.appendChild(rt);
  return bar;
}

/* A spec describes a nav bar in prose — "share, favorite (SF Symbols, not text
   buttons)". Printing that verbatim is how a mock stops looking like an app, so
   drop the parenthetical asides and draw the named affordances instead. */
function navTitle(t) { return String(t || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); }

var GLYPH = {
  share: 'M9 2.6 L9 11 M9 2.6 L6.4 5.2 M9 2.6 L11.6 5.2 M4 8.4 v6.2 h10 v-6.2',
  favorite: 'M9 15.2 C3.6 11.4 2 9 2 6.8 A3.6 3.6 0 0 1 9 5.4 A3.6 3.6 0 0 1 16 6.8 C16 9 14.4 11.4 9 15.2 z',
  heart: 'M9 15.2 C3.6 11.4 2 9 2 6.8 A3.6 3.6 0 0 1 9 5.4 A3.6 3.6 0 0 1 16 6.8 C16 9 14.4 11.4 9 15.2 z',
  close: 'M4 4 L14 14 M14 4 L4 14',
  filter: 'M2.5 4.5h13 M4.8 9h8.4 M7.2 13.5h3.6',
  map: 'M2.5 4.5 6.8 3 11.2 5 15.5 3.5 v10 L11.2 15 6.8 13 2.5 14.5z M6.8 3v10 M11.2 5v10',
  search: 'M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z M11.6 11.6 15 15'
};
function navTrailing(txt) {
  var t = String(txt || '').replace(/\(.*?\)/g, ' ');
  var parts = t.split(/[,/]|\band\b/).map(function (x) { return x.trim(); }).filter(Boolean);
  var wrapEl = h('div', 'icons');
  var drew = 0;
  var NS = 'http://www.w3.org/2000/svg';
  parts.slice(0, 3).forEach(function (p) {
    var key = Object.keys(GLYPH).filter(function (k) { return p.toLowerCase().indexOf(k) >= 0; })[0];
    if (!key) return;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('viewBox', '0 0 18 18');
    var pa = document.createElementNS(NS, 'path');
    pa.setAttribute('d', GLYPH[key]); pa.setAttribute('stroke', 'currentColor');
    pa.setAttribute('stroke-width', '1.6'); pa.setAttribute('fill', 'none');
    pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pa); wrapEl.appendChild(svg); drew++;
  });
  if (drew) return wrapEl;
  /* not a named affordance — keep it as a short text action, the way Cancel/Done read */
  var label = parts[0] || '';
  if (label.length > 12) label = label.slice(0, 11) + '…';
  return h('span', 'tr', label);
}

var TABGLYPH = {
  search:   'M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z M11.6 11.6 15.4 15.4',
  bookings: 'M3.4 4.2h11.2v10.4H3.4z M3.4 7.2h11.2 M6.6 2.6v2.6 M11.4 2.6v2.6',
  account:  'M9 3.4a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z M3.6 15.2a5.4 5.4 0 0 1 10.8 0'
};
function tabBar(active) {
  var t = h('div', 'tabbar'), NS = 'http://www.w3.org/2000/svg';
  /* DEC-031 renamed the first tab: Explore, not Search. The glyph key stays
     'search' — that is the SF Symbol, not the label. */
  [['Explore', 'search'], ['Bookings', 'bookings'], ['Account', 'account']].forEach(function (p) {
    var on = String(active || '').toLowerCase() === p[1];
    var d = h('div', 't' + (on ? ' on' : ''));
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('viewBox', '0 0 18 18');
    var pa = document.createElementNS(NS, 'path');
    pa.setAttribute('d', TABGLYPH[p[1]]); pa.setAttribute('fill', 'none');
    pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', on ? '1.9' : '1.5');
    pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pa); d.appendChild(svg);
    d.appendChild(h('span', null, p[0]));
    t.appendChild(d);
  });
  return t;
}

/* Regions that belong in a pinned action bar rather than in the scroll flow —
   a booking app keeps its price and its commit button on screen, always. */
function splitActions(regions) {
  var body = regions.slice(), bar = [];
  while (body.length) {
    var last = body[body.length - 1];
    if (last && /^(cta|secondary-cta)$/.test(last.type)) { bar.unshift(body.pop()); continue; }
    if (bar.length && last && last.type === 'price') { bar.unshift(body.pop()); continue; }
    break;
  }
  return { body: body, bar: bar };
}

/* Consecutive key/value rows read as one inset group with hairline separators,
   which is what iOS does and what a flat stack of cards never looks like. */
function groupRows(regions) {
  var out = [], run = null;
  regions.forEach(function (r) {
    if (r.type === 'row') { (run = run || []).push(r); return; }
    if (run) { out.push({ __group: run }); run = null; }
    out.push(r);
  });
  if (run) out.push({ __group: run });
  return out;
}

function shelfCard(r, ds, base) {
  var c = h('div', 'scard');
  var ph = h('div', 'ph');
  var img = lines(r.image)[0] || lines(r.content).filter(function (x) {
    return typeof x === 'string' && /^(roomtype|hero)_/.test(x); })[0];
  if (img) {
    var im = document.createElement('img');
    im.src = imgSrc(img, base); im.alt = ''; im.loading = 'lazy'; ph.appendChild(im);
  }
  /* the heart is the one place the accent is allowed on a photo */
  var hrt = h('div', 'hrt');
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('viewBox', '0 0 18 18');
  var pa = document.createElementNS(NS, 'path');
  pa.setAttribute('d', 'M9 15.2 C3.6 11.4 2 9 2 6.8 A3.6 3.6 0 0 1 9 5.4 A3.6 3.6 0 0 1 16 6.8 C16 9 14.4 11.4 9 15.2 z');
  var on = /favourited|favorited|saved/i.test(String(r.state || '') + String(r.label || '')) &&
           !/not-fav|unsaved/i.test(String(r.state || ''));
  pa.setAttribute('fill', on ? 'var(--m-primary)' : 'none');
  pa.setAttribute('stroke', on ? 'var(--m-primary)' : '#2b2f2f');
  pa.setAttribute('stroke-width', '1.7'); svg.appendChild(pa); hrt.appendChild(svg);
  ph.appendChild(hrt);
  c.appendChild(ph);
  var parts = lines(r.content).filter(function (x) { return !/^(roomtype|hero)_/.test(String(x)); });
  if (parts[0]) c.appendChild(h('div', 't', parts[0]));
  var meta = parts.slice(1, 3).filter(Boolean).join(' · ');
  if (meta) c.appendChild(h('div', 's', meta));
  var price = parts.filter(function (x) { return /[€$£]|\/night|from /i.test(String(x)); }).pop();
  if (price) c.appendChild(h('div', 'p', price));
  return c;
}

/* Overlay block for a hero: optional logo lockup, then the lines, over a scrim. */
function heroCap(txt, r, base) {
  var cap = h('div', 'herocap');
  if (r.logo) {
    var lg = document.createElement('img');
    lg.className = 'herologo'; lg.src = imgSrc(r.logo, base); lg.alt = '';
    cap.appendChild(lg);
  }
  txt.forEach(function (t, i) {
    cap.appendChild(h('div', i === 0 && !r.logo ? 'hl' : 'hs', t));
  });
  return cap;
}

function renderRegions(host, regions, ds, base, opts) {
  opts = opts || {};
  var ui = regions.filter(function (r) {
    /* only hide an "alt state" region when nothing has already selected it —
       applyState decides visibility, this guards specs that tag but don't state */
    if (regionRole(r) === 'alt' && !r.state) return false;
    /* the chrome already draws the title bar — a spec that also lists an
       `appbar` region would otherwise print the screen name twice */
    if (opts.dropAppbar && r.type === 'appbar') return false;
    return true;
  });
  groupRows(shelfify(ui)).forEach(function (r, i) {
    if (r.__group) {
      if (r.__group.length === 1) { host.appendChild(R.row(r.__group[0])); return; }
      var g = h('div', 'r grp');
      r.__group.forEach(function (row) { g.appendChild(R.row(row)); });
      host.appendChild(g);
      return;
    }
    if (r.__shelf) {
      if (r.__shelf.length === 1) { host.appendChild(R.card(r.__shelf[0], ds, base)); return; }
      var sh = h('div', 'r shelf');
      r.__shelf.forEach(function (c) { sh.appendChild(shelfCard(c, ds, base)); });
      host.appendChild(sh);
      return;
    }
    var role = regionRole(r);
    if (role === 'annotation') return;                 /* surfaced beside the device */
    if (role === 'header') {
      host.appendChild(h('div', 'r sech', lines(r.content).join(' ') || r.label || ''));
      return;
    }
    var fn = R[r.type] || R.text;
    var el2;
    try { el2 = fn(r, ds, base); } catch (e) { el2 = R.text(r); }
    /* A hero bleeds to the edges — it is the screen's backdrop. A gallery does
       NOT: it is a lead image over a strip of thumbnails, and that is card
       language. Bleeding it pushed its own rounded corners off-screen and
       left the lead flush to the bezel while its thumbnails sat inset. */
    if (i === 0 && r.type === 'hero') el2.classList.add('bleed');
    if (r.label) el2.setAttribute('data-region', stemOf(r.label));
    host.appendChild(el2);
  });
}

function mock(host, screen, ds, stateName, base) {
  if (frameKind(ds) === 'web' && API && typeof API.mockWeb === 'function')
    return API.mockWeb(host, screen, ds, stateName, base);
  var kind = String((screen.nav || {}).kind || 'push').toLowerCase();
  var regions = applyState(screen, stateName);
  var dv = deviceOf(ds);
  var dev = h('div', 'device');
  var glass = h('div', 'glass');
  if (ds && ds.device) {
    dev.setAttribute('data-device', dv.id);
    dev.style.width = dv.w + 'px';
    dev.style.borderRadius = dv.radius + 'px';
    glass.style.height = dv.h + 'px';
  }
  if (dv.island) glass.appendChild(h('div', 'dyn'));
  else if (dv.chrome === 'android') glass.appendChild(h('div', 'andstat'));
  glass.appendChild(statusBar());

  var isOverlay = /sheet|dialog|alert/.test(kind);
  if (isOverlay) {
    /* the screen underneath stays visible, dimmed — that context is the point
       of presenting modally in the first place */
    var behind = h('div', 'behind');
    [92, 78, 88, 64, 84, 70].forEach(function (w) {
      var b = h('i'); b.style.width = w + '%'; behind.appendChild(b);
    });
    glass.appendChild(behind);
    glass.appendChild(h('div', 'scrim'));
    if (/dialog|alert/.test(kind)) {
      var dlg = h('div', 'dialog');
      /* A region describing the DIMMED LAYER is scenery, not dialog copy. It was
         being picked up as the message, so every such dialog announced itself
         with "Account (dimmed behind the dialog)". */
      var txt = regions.filter(function (r) {
        if (!/^(text|notice|error|banner)$/.test(r.type)) return false;
        var blob = (r.label || '') + ' ' + lines(r.content).join(' ');
        return !/^\s*backdrop\b/i.test(r.label || '') && !/dimmed behind|\(dimmed\)/i.test(blob);
      });
      dlg.appendChild(h('div', 'dt', (screen.nav || {}).title || screen.title || ''));
      if (txt[0]) {
        var msg = lines(txt[0].content);
        /* the headline is already the title — show the explanation, not a repeat */
        var body = msg.length > 1 ? msg.slice(1) : msg;
        dlg.appendChild(h('div', 'dm', body.join(' ')));
      }
      var btns = regions.filter(function (r) { return /cta/.test(r.type); });
      /* An alert offering a CHOICE needs its choices. Two side by side is the
         iOS default; three or more stack, which is also what iOS does. */
      var picked = (btns.length ? btns : [{ content: 'Cancel' }, { content: 'Continue' }]).slice(0, 3);
      var acts = h('div', 'acts' + (picked.length > 2 ? ' stack' : ''));
      picked.forEach(function (b) {
        acts.appendChild(h('span', /secondary/.test(b.type || '') ? 'sec' : null,
                           first(b.content) || b.label || ''));
      });
      dlg.appendChild(acts);
      glass.appendChild(dlg);
    } else {
      var sh = h('div', 'sheet');
      sh.appendChild(h('div', 'grab'));
      var sp = splitActions(regions.filter(function (r) { return r.type !== 'sheet-handle'; }));
      var inner = h('div'); inner.style.cssText = 'display:flex;flex-direction:column;gap:11px';
      renderRegions(inner, sp.body, ds, base);
      sh.appendChild(inner);
      sp.bar.forEach(function (r) { sh.appendChild((R[r.type] || R.cta)(r, ds, base)); });
      glass.appendChild(sh);
    }
    if (dv.homebar) glass.appendChild(h('div', 'homeind'));
    else if (dv.chrome === 'android') glass.appendChild(h('div', 'andgest'));
    else if (dv.chrome === 'ios-home') glass.appendChild(h('div', 'homebtn'));
    dev.appendChild(glass); host.appendChild(dev); return dev;
  }

  /* nav chrome */
  var nav = screen.nav || {};
  if (kind === 'root') {
    /* a root screen has a large title and no back affordance — rendering both
       a nav bar and a large title was showing the same word twice */
    if (nav.trailing) {
      var nb = h('div', 'navb');
      nb.appendChild(navTrailing(nav.trailing));
      glass.appendChild(nb);
    }
    var lg = h('div', 'large');
    lg.appendChild(h('h3', null, navTitle(nav.title || screen.title || '')));
    glass.appendChild(lg);
  } else {
    var nb2 = h('div', 'navb hair');
    if (String(nav.leading || '').toLowerCase() !== 'none') nb2.appendChild(h('span', 'chev'));
    nb2.appendChild(h('span', 'ttl', navTitle(nav.title || screen.title || '')));
    if (nav.trailing) nb2.appendChild(navTrailing(nav.trailing));
    glass.appendChild(nb2);
  }

  var split = splitActions(regions);
  /* density and hierarchy are different problems: a busy screen may want a
     tighter inter-region gap, but section rhythm is set by .sech's own margin
     and must not be squeezed by a region-count heuristic */
  var body = h('div', 'body' + (split.body.length > 8 ? ' tight' : ''));
  /* A screen that is mostly an empty or error state has room to be a designed
     surface rather than a blank one. Geometry only — no photograph. */
  var blank = split.body.filter(function (r) { return /^(empty|error)$/.test(r.type); }).length;
  if (blank && split.body.length <= 4) {
    /* halftone + rules only: the brand mark in the empty state already carries
       the tower, and drawing it twice reads as a mistake */
    body.appendChild(h('div', 'rules'));
    body.appendChild(h('div', 'halftone'));
    body.classList.add('hasart');
  }
  renderRegions(body, split.body, ds, base, { dropAppbar: true });
  /* A state whose changed region sits mid-screen cannot be shown by a mock that
     always renders from the top — the picture comes out identical to the
     default. `focus` names the region to scroll into view, the way the guest
     would already have scrolled to reach the control they just used. */
  var foc = focusOf(screen, stateName);
  if (foc) body.setAttribute('data-focus', stemOf(foc));
  glass.appendChild(body);

  if (split.bar.length) {
    var ab = h('div', 'actionbar');
    var priced = split.bar.filter(function (r) { return r.type === 'price'; });
    var rest = split.bar.filter(function (r) { return r.type !== 'price'; });
    priced.forEach(function (r) {
      var lead = h('div', 'lead');
      var parts = lines(r.content);
      lead.appendChild(h('span', 'big', parts[0] || ''));
      if (parts[1]) lead.appendChild(h('span', 'sub', parts[1]));
      ab.appendChild(lead);
    });
    rest.forEach(function (r) { ab.appendChild((R[r.type] || R.cta)(r, ds, base)); });
    glass.appendChild(ab);
  }
  if (kind === 'root') {
    var id = String(screen.id || '');
    var tab = screen.tab || (/-00[56]-/.test(id) ? 'bookings' : /-008-/.test(id) ? 'account' : 'search');
    glass.appendChild(tabBar(String(tab).toLowerCase()));
  }
  if (dv.homebar) glass.appendChild(h('div', 'homeind'));
  else if (dv.chrome === 'android') glass.appendChild(h('div', 'andgest'));
  else if (dv.chrome === 'ios-home') glass.appendChild(h('div', 'homebtn'));

  dev.appendChild(glass);
  host.appendChild(dev);
  return dev;
}

/* ------------------------------------------------------------------ spec */
function spec(host, screen) {
  var wrap = h('div', 'specpanel');
  var kv = function (k, v) {
    if (!v) return;
    var row = h('div', 'kv');
    row.appendChild(h('dt', null, k));
    row.appendChild(h('dd', null, Array.isArray(v) ? v.join(', ') : String(v)));
    wrap.appendChild(row);
  };
  kv('Flow node', Array.isArray(screen.node) ? screen.node.join(', ') : screen.node);
  kv('Presentation', screen.nav && screen.nav.kind);
  if (screen.ac && screen.ac.length) {
    var row = h('div', 'kv');
    row.appendChild(h('dt', null, 'Criteria'));
    var dd = h('dd');
    screen.ac.forEach(function (a) { dd.appendChild(h('span', 'ac', a)); });
    row.appendChild(dd); wrap.appendChild(row);
  }
  host.appendChild(wrap);
  return wrap;
}

/* the commentary pulled out of the mock, so it can sit beside the device
   instead of being silently dropped */
function annotations(screen, stateName) {
  return applyState(screen, stateName)
    .filter(function (r) { return regionRole(r) === 'annotation'; })
    .map(function (r) { return lines(r.content).join(' ') || r.label; })
    .filter(Boolean);
}

var API = {
  css: CSS,
  tokens: tokens,
  frameKind: frameKind,
  annotations: annotations,
  mock: mock,
  spec: spec,
  regionTypes: Object.keys(R),
  applyState: applyState,
  DEVICES: DEVICES,
  deviceOf: deviceOf,
  mockWeb: null,
  webCss: '',
  version: '1.0.0'
};
return API;
}));
