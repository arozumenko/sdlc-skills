// scripts/screenspec.golden.test.mjs
//
// Regression lock: captures (or compares against) a serialized snapshot of
// the mobile `mock()` render so later web-target work can prove it did not
// change the existing phone renderer.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installDom, serialize } from './dom-shim.mjs';
const __d = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function renderMobileDefault() {
  installDom();
  const S = require('./screenspec.js');
  const ds = JSON.parse(readFileSync(join(__d, '__fixtures__/mobile.ds.json'), 'utf8'));
  const scr = JSON.parse(readFileSync(join(__d, '__fixtures__/mobile.screens.json'), 'utf8')).screens[0];
  const host = document.createElement('div');
  S.mock(host, scr, ds, null, '../img/');
  return serialize(host.firstChild);
}

test('mobile default mock matches golden baseline', () => {
  const out = renderMobileDefault();
  const gp = join(__d, '__fixtures__/mobile.golden.txt');
  if (!existsSync(gp)) { writeFileSync(gp, out); }        // first run captures baseline
  assert.strictEqual(out, readFileSync(gp, 'utf8'));
});
