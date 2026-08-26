/*!
 * screenspec.web.js — web frame renderer
 * ---------------------------------------------------------------------------
 * Registers `mockWeb` and `webCss` onto the shared screenspec core API (the
 * SAME object build-screens.mjs / screenspec.js hold — this module mutates it
 * in place rather than exporting a new one). A `target:'web'` design system
 * renders a browser-framed viewport instead of a phone: chrome (browser bar +
 * nav) sized to a breakpoint, with regions rendered by the same per-type
 * renderers the mobile mock uses via the core's `renderRegion`.
 *
 * API added
 *   ScreenSpec.mockWeb(host, screen, ds, stateName?, base?) -> browser-framed mock
 *   ScreenSpec.webCss                                       -> stylesheet the markup expects
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./screenspec.js'), require('./styles.js'));
  else factory(root.ScreenSpec, root.ScreenStyles);
}(typeof self !== 'undefined' ? self : this, function (S, Styles) {
  'use strict';

  /* eslint-disable no-unused-vars -- Styles is part of the declared UMD
     interface (screenspec.js consults it for style-token CSS); this module
     doesn't need it directly yet, but keeps the require so a browser build
     that concatenates scripts in dependency order stays correct. */

  var BP = { 'mobile-web': 400, 'tablet': 768, 'desktop': 1280 };

  function webNav(k) {
    return ({
      sheet: 'drawer', push: 'page', root: 'page', dialog: 'modal', fullscreen: 'page',
      page: 'page', split: 'split', modal: 'modal', drawer: 'drawer', panel: 'panel'
    })[k] || 'page';
  }

  function el(t, c) { var n = document.createElement(t); if (c) n.className = c; return n; }
  function text(t, c, s) { var n = el(t, c); if (s != null) n.textContent = s; return n; }

  /* Trailing nav items arrive as free-text prose ("share, favorite (SF
     Symbols)") the same way the mobile nav bar's `trailing` does — split on
     the same delimiters and drop parentheticals, but render as short text
     links since a browser top nav reads as words, not glyphs. */
  function navItems(trailing) {
    var t = String(trailing || '').replace(/\(.*?\)/g, ' ');
    return t.split(/[,/]|\band\b/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 5);
  }

  function browserBar(ds, screen) {
    var bar = el('div', 'webbar');
    var dots = el('span', 'dots');
    dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
    bar.appendChild(dots);
    var url = el('div', 'urlpill');
    url.textContent = (ds.name || 'app') + ' / ' + (screen.title || screen.id || '');
    bar.appendChild(url);
    return bar;
  }

  function topNav(screen, isMobile) {
    var nav = screen.nav || {};
    var strip = el('div', isMobile ? 'hamburger' : 'topnav');
    if (isMobile) {
      strip.appendChild(el('span', 'burger'));
      strip.appendChild(text('span', 'brand', nav.title || screen.title || ''));
      return strip;
    }
    strip.appendChild(text('div', 'brand', nav.title || screen.title || ''));
    var items = el('div', 'navitems');
    navItems(nav.trailing).forEach(function (label) { items.appendChild(text('span', 'navitem', label)); });
    strip.appendChild(items);
    return strip;
  }

  function sidebar(screen) {
    var side = el('div', 'sidebar');
    side.appendChild(text('div', 'brand', (screen.nav || {}).title || screen.title || ''));
    var items = el('nav', 'navitems');
    navItems((screen.nav || {}).trailing).forEach(function (label) { items.appendChild(text('span', 'navitem', label)); });
    side.appendChild(items);
    return side;
  }

  function lines(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

  /* Web-specific region renderers, keyed by region `type`. Checked BEFORE the
     core's `renderRegion` fallback in `renderBody` below — anything not
     listed here keeps using the shared per-type renderer the mobile mock
     uses, so the two targets stay in sync everywhere except the handful of
     region kinds that genuinely read as browser chrome, not phone chrome. */
  var WR = {
    breadcrumb: function (r) {
      var n = el('div', 'r breadcrumb');
      var parts = lines(r.content).filter(Boolean);
      n.textContent = parts.join(' / ');
      return n;
    },
    topnav: function (r) {
      var n = el('div', 'r topnav-region');
      var list = el('nav', 'navitems');
      lines(r.content).filter(Boolean).forEach(function (label) {
        list.appendChild(text('span', 'navitem', label));
      });
      n.appendChild(list);
      return n;
    },
    sidebar: function (r) {
      var n = el('div', 'r sidebar-region');
      var list = el('nav', 'navitems');
      lines(r.content).filter(Boolean).forEach(function (label) {
        list.appendChild(text('span', 'navitem', label));
      });
      n.appendChild(list);
      return n;
    },
    datatable: function (r, ds, base, screen) {
      var n = el('div', 'r datatable');
      var headers = lines(r.content).filter(Boolean);
      var table = el('table', 'dtable');
      var thead = el('thead');
      var htr = el('tr');
      headers.forEach(function (h) { htr.appendChild(text('th', null, h)); });
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = el('tbody');
      var srcRows = Array.isArray((screen || {}).content) ? screen.content : [];
      for (var i = 0; i < 2; i++) {
        var tr = el('tr');
        var rowSrc = srcRows[i];
        headers.forEach(function (h, ci) {
          var cell = Array.isArray(rowSrc) ? rowSrc[ci]
            : (rowSrc && typeof rowSrc === 'object') ? rowSrc[h]
            : undefined;
          tr.appendChild(text('td', null, cell != null ? String(cell) : '—'));
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      n.appendChild(table);
      return n;
    }
  };

  function renderBody(screen, ds, stateName, base) {
    var content = el('div', 'webcontent');
    var regions = S.applyState(screen, stateName).filter(function (r) { return r.type !== 'appbar'; });
    regions.forEach(function (r) {
      var fn = WR[r.type];
      var node = fn ? fn(r, ds, base, screen) : S.renderRegion(r, ds, base);
      if (node) content.appendChild(node);
    });
    return content;
  }

  function mockWeb(host, screen, ds, stateName, base) {
    ds = ds || {};
    var bp = ds.__bp || 'desktop', w = BP[bp] || BP.desktop;
    var isMobile = bp === 'mobile-web';
    var kind = webNav((screen.nav || {}).kind);

    var frame = el('div', 'webframe');
    frame.setAttribute('data-bp', bp);
    frame.setAttribute('data-nav', kind);
    frame.style.cssText = 'width:' + w + 'px';

    frame.appendChild(browserBar(ds, screen));

    var view = el('div', 'webview');
    var body = renderBody(screen, ds, stateName, base);

    if (kind === 'split') {
      view.appendChild(sidebar(screen));
      view.appendChild(body);
    } else {
      view.appendChild(topNav(screen, isMobile));
      view.appendChild(body);
    }

    frame.appendChild(view);
    host.appendChild(frame);
    return frame;
  }

  S.mockWeb = mockWeb;
  S.webCss = [
    '.webframe{margin:0 auto;border:1px solid var(--m-outline-variant);border-radius:12px;overflow:hidden;background:var(--m-surface)}',
    '.webbar{height:34px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;',
    '  background:var(--m-surface-container-low);border-bottom:1px solid var(--m-outline-variant)}',
    '.webbar .dots{display:flex;gap:6px;flex:none}',
    '.webbar .dots i{width:9px;height:9px;border-radius:50%;background:var(--m-outline-variant);display:block}',
    '.webbar .urlpill{flex:1;height:22px;border-radius:11px;background:var(--m-surface);',
    '  display:flex;align-items:center;padding:0 12px;font-size:11px;color:var(--m-on-surface-variant)}',
    '.webview{display:flex;flex-direction:column}',
    '.webframe[data-nav="split"] .webview{flex-direction:row}',
    '.topnav,.hamburger{flex:none;display:flex;align-items:center;gap:16px;padding:12px 20px;',
    '  background:var(--m-surface-container-low);border-bottom:1px solid var(--m-outline-variant)}',
    '.topnav .brand,.hamburger .brand{font-weight:600;color:var(--m-on-surface)}',
    '.topnav .navitems{margin-left:auto;display:flex;gap:16px}',
    '.topnav .navitem{font-size:13px;color:var(--m-on-surface-variant)}',
    '.hamburger .burger{width:20px;height:14px;position:relative;flex:none}',
    '.hamburger .burger::before,.hamburger .burger::after{content:"";position:absolute;left:0;right:0;',
    '  height:2px;background:var(--m-on-surface)}',
    '.hamburger .burger::before{top:0}',
    '.hamburger .burger::after{bottom:0}',
    '.sidebar{flex:none;width:220px;padding:16px;background:var(--m-surface-container-low);',
    '  border-right:1px solid var(--m-outline-variant);display:flex;flex-direction:column;gap:16px}',
    '.sidebar .brand{font-weight:600;color:var(--m-on-surface)}',
    '.sidebar .navitems{display:flex;flex-direction:column;gap:10px}',
    '.sidebar .navitem{font-size:13px;color:var(--m-on-surface-variant)}',
    '.webcontent{flex:1;min-width:0;max-width:960px;margin:0 auto;padding:24px 32px;',
    '  display:flex;flex-direction:column;gap:16px;box-sizing:border-box}',
    '.webframe[data-nav="split"] .webcontent{margin:0}',
    '.webframe :focus-visible{outline:3px solid var(--m-primary);outline-offset:2px}',
    '.r.breadcrumb{font-size:12px;color:var(--m-on-surface-variant)}',
    '.r.topnav-region .navitems,.r.sidebar-region .navitems{display:flex;gap:16px}',
    '.r.sidebar-region .navitems{flex-direction:column;gap:10px}',
    '.r.topnav-region .navitem,.r.sidebar-region .navitem{font-size:13px;color:var(--m-on-surface-variant)}',
    '.r.datatable .dtable{width:100%;border-collapse:collapse;font-size:13px}',
    '.r.datatable th,.r.datatable td{text-align:left;padding:8px 12px;',
    '  border-bottom:1px solid var(--m-outline-variant)}',
    '.r.datatable th{color:var(--m-on-surface-variant);font-weight:600}',
    '@media (prefers-reduced-motion:reduce){.webframe *{transition:none!important;animation:none!important}}'
  ].join('\n');

  return S;
}));
