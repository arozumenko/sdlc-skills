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
test('mock dispatches to registered mockWeb on web target', () => {
  let called=false; const prev=S.mockWeb;
  S.mockWeb=(h)=>{ called=true; return h; };
  S.mock({appendChild(){}}, {regions:[]}, {target:'web'}, null, '');
  S.mockWeb=prev;
  assert.ok(called);
});
