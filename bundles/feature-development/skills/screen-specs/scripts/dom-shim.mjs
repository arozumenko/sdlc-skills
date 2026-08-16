// scripts/dom-shim.mjs
//
// A tiny, hand-written, serializable DOM shim — just enough of `document` for
// screenspec.js's `mock()` (and the build glue) to run under `node --test`
// without jsdom or any other dependency. Not a general DOM: it supports
// exactly the surface screenspec.js touches.
function El(tag) {
  this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this._text = null;
  this.style = new Proxy({ cssText: '' }, { set(o, k, v) { o[k] = v; return true; }, get(o, k) { return o[k] || ''; } });
  this.classList = {
    _s: new Set(),
    add: (...c) => c.forEach(x => this.classList._s.add(x)),
    contains: x => this.classList._s.has(x)
  };
}
Object.defineProperty(El.prototype, 'textContent', {
  get() { return this._text; },
  set(v) { this._text = String(v); this.children = []; }
});
Object.defineProperty(El.prototype, 'firstChild', { get() { return this.children[0] || null; } });
// `innerHTML` is only touched by the browser-side build glue (embedded script
// strings, never executed here) — store/return the raw string verbatim.
Object.defineProperty(El.prototype, 'innerHTML', {
  get() { return this._html || ''; },
  set(v) { this._html = String(v); this.children = []; this._text = null; }
});
El.prototype.appendChild = function (n) { this.children.push(n); return n; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
// `querySelectorAll` — used by build glue only, not by `mock`. Supports a
// small subset: single-token `.class`, `[attr]`, `tag`, and combinations of
// those on one token (e.g. `.body[data-focus]`), joined by descendant
// (whitespace) combinators.
function matchesToken(node, token) {
  if (!node || !node.tag) return false;
  var tagM = token.match(/^[a-z][a-z0-9-]*/i);
  if (tagM && node.tag.toLowerCase() !== tagM[0].toLowerCase()) return false;
  var rest = tagM ? token.slice(tagM[0].length) : token;
  var re = /\.[\w-]+|\[[\w-]+(?:=[^\]]*)?\]/g, m;
  while ((m = re.exec(rest))) {
    var part = m[0];
    if (part[0] === '.') {
      var cls = part.slice(1);
      var have = [node.className, [...node.classList._s].join(' ')].join(' ');
      if (have.split(/\s+/).indexOf(cls) < 0) return false;
    } else {
      var body = part.slice(1, -1);
      var eq = body.indexOf('=');
      var key = eq >= 0 ? body.slice(0, eq) : body;
      if (!(key in node.attrs)) return false;
    }
  }
  return true;
}
function walk(node, out) {
  (node.children || []).forEach(function (c) { if (c && c.tag) { out.push(c); walk(c, out); } });
}
El.prototype.querySelectorAll = function (selector) {
  var tokens = String(selector).trim().split(/\s+/);
  var pool = []; walk(this, pool);
  tokens.forEach(function (token) { pool = pool.filter(function (n) { return matchesToken(n, token); }); });
  return pool;
};
function Txt(t) { this.text = String(t); }

export function installDom() {
  var document = {
    createElement: t => new El(t),
    createElementNS: (ns, t) => new El(t),
    createTextNode: t => new Txt(t),
    getElementById: () => null,
    querySelectorAll: () => []
  };
  globalThis.document = document;
  globalThis.self = globalThis;
  return document;
}

export function serialize(n) {
  if (n instanceof Txt) return n.text;
  if (!n || !n.tag) return '';
  var cls = [n.className, [...n.classList._s].join(' ')].filter(Boolean).join(' ');
  var style = n.style.cssText || Object.keys(n.style).filter(k => k !== 'cssText' && n.style[k]).map(k => k + ':' + n.style[k]).join(';');
  var attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')
    + (cls ? ` class="${cls}"` : '') + (style ? ` style="${style}"` : '');
  var kids = n._text != null ? n._text : (n._html != null ? n._html : n.children.map(serialize).join(''));
  return `<${n.tag}${attrs}>${kids}</${n.tag}>`;
}
