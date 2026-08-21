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
