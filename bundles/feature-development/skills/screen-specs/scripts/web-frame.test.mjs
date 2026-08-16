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
test('mockWeb renders split nav chrome with a sidebar', () => {
  installDom();
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  const scr={ nav:{kind:'split'}, regions:[{type:'appbar',label:'Top'},{type:'cta',label:'Go'}] };
  const host=document.createElement('div');
  const frame=S.mockWeb(host, scr, {target:'web',style:'material',__bp:'desktop'}, null, '');
  const html=serialize(frame);
  assert.match(html, /sidebar/);
});
test('mockWeb collapses nav to a hamburger at the mobile-web breakpoint', () => {
  installDom();
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  const scr={ nav:{kind:'page'}, regions:[{type:'appbar',label:'Top'}] };
  const host=document.createElement('div');
  const frame=S.mockWeb(host, scr, {target:'web',style:'material',__bp:'mobile-web'}, null, '');
  const html=serialize(frame);
  assert.match(html, /hamburger/);
  assert.match(html, /data-bp="mobile-web"/);
});
test('webCss respects reduced motion + focus ring', () => {
  const S=require('./screenspec.js'); require('./screenspec.web.js');
  assert.match(S.webCss, /prefers-reduced-motion/);
  assert.match(S.webCss, /:focus-visible/);
});
