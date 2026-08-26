// scripts/build.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = dirname(fileURLToPath(import.meta.url));

// Web and mobile fixtures live in separate subfolders (`__fixtures__/web`,
// `__fixtures__/mobile.*` at the top level) so build-screens.mjs's
// `readdirSync(specDir).filter(f => f.endsWith('.screens.json'))` never
// cross-picks the other target's flow when --specs points at one or the other.
const WEB_DIR = join(__d, '__fixtures__', 'web');

function build(system, specs, out) {
  execFileSync('node', [join(__d, 'build-screens.mjs'),
    '--system', system, '--specs', specs, '--out', out]);
}

test('web build inlines all three scripts + toggle + style var', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-'));
  build(join(WEB_DIR, 'web-material.ds.json'), WEB_DIR, out);
  const html = readFileSync(join(out, 'flow.html'), 'utf8');
  assert.match(html, /ScreenStyles/); assert.match(html, /mockWeb/);  // core+styles+web inlined
  assert.match(html, /data-bp/);            // breakpoint toggle wiring
  assert.match(html, /--shadow-1/);         // style preset in <style>
});

test('web build renders a breakpoint toggle with all three cases', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-'));
  build(join(WEB_DIR, 'web-material.ds.json'), WEB_DIR, out);
  const html = readFileSync(join(out, 'flow.html'), 'utf8');
  assert.match(html, /Mobile.web/i);
  assert.match(html, /Tablet/);
  assert.match(html, /Desktop/);
});

test('web build renders target-aware call labels, not the mobile MD3/iOS wording', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-'));
  build(join(WEB_DIR, 'web-material.ds.json'), WEB_DIR, out);
  const html = readFileSync(join(out, 'flow.html'), 'utf8');
  assert.match(html, /and native differ/i);
  assert.doesNotMatch(html, /Where MD3 and iOS disagreed/);
});

test('each web style preset builds without error and carries its own style vars', () => {
  // Distinct expected --shadow-1 values (styles.js's STYLES presets), scoped
  // to the computed <style> block so a match proves the *right* preset was
  // selected, not just that the inlined styles.js source mentions the key.
  const expect = { 'neo-flat': '--shadow-1:none', 'minimal-neutral': '--shadow-1:0 1px 2px rgba(16,24,40,.05)',
    'fluent': '--shadow-1:0 2px 6px rgba(0,0,0,.10)' };
  for (const style of ['neo-flat', 'minimal-neutral', 'fluent']) {
    const out = mkdtempSync(join(tmpdir(), 'ss-'));
    build(join(WEB_DIR, `web-${style}.ds.json`), WEB_DIR, out);
    const html = readFileSync(join(out, 'flow.html'), 'utf8');
    const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(styleBlock.includes(expect[style]), `expected ${expect[style]} in ${style} build`);
  }
});

test('mobile fixture still builds unchanged (no web wiring leaks into mobile pages)', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-'));
  build(join(__d, '__fixtures__', 'mobile.ds.json'), join(__d, '__fixtures__'), out);
  const html = readFileSync(join(out, 'flow.html'), 'utf8');
  assert.match(html, /screen/); // page renders
  assert.doesNotMatch(html, /id="bptoggle"/); // no breakpoint toggle markup for mobile
  // The inlined LIB script's raw source (styles.js) mentions "--shadow-1" as a
  // literal object key regardless of target, so scope the "no style preset"
  // check to the computed :root CSS the mobile page actually rendered.
  const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.doesNotMatch(styleBlock, /--shadow-1:/);
});

test('index page renders web-appropriate sections for a web design system', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-'));
  build(join(WEB_DIR, 'web-material.ds.json'), WEB_DIR, out);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /Breakpoints/);
  assert.match(html, /and native differ/i);
});
