// scripts/story.test.mjs
//
// Build-smoke coverage for `--layout story` (T2): subdir output under
// `screens/` plus the A cross-links (screen -> its flow node, screen's AC ->
// coverage.html), and a regression lock that the default (flat) layout still
// writes exactly where it always has, at --out root.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__d, 'build-screens.mjs');
const SYSTEM = join(__d, '__fixtures__', 'mobile.ds.json');
const STORY_SPECS = join(__d, '__fixtures__', 'story');

function build(args) {
  return execFileSync('node', [BUILD, '--system', SYSTEM, '--specs', STORY_SPECS, ...args]).toString();
}

test('flat (default, no --layout) writes screen pages at --out root, unchanged', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-flat-'));
  build(['--out', out]);
  assert.ok(existsSync(join(out, 'story-flow.html')), 'flow page at root');
  assert.ok(existsSync(join(out, 'index.html')), 'design-system index at root');
  assert.ok(!existsSync(join(out, 'screens')), 'no screens/ subdir under flat');
});

test('--layout flat (explicit) is the same as default', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-flat2-'));
  build(['--out', out, '--layout', 'flat']);
  assert.ok(existsSync(join(out, 'story-flow.html')));
  assert.ok(!existsSync(join(out, 'screens')));
});

test('--layout story writes screen pages into screens/', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-story-'));
  build(['--out', out, '--layout', 'story']);
  assert.ok(existsSync(join(out, 'screens', 'story-flow.html')), 'flow page under screens/');
  assert.ok(existsSync(join(out, 'screens', 'index.html')), 'design-system index under screens/');
  assert.ok(!existsSync(join(out, 'story-flow.html')), 'not also written at root');
});

test('--layout story emits screen -> flow-node and AC -> coverage cross-links (A)', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-story-links-'));
  build(['--out', out, '--layout', 'story']);
  const html = readFileSync(join(out, 'screens', 'story-flow.html'), 'utf8');
  // flow slug mirrors build-flowmaps.mjs's own slug() over the shared key.
  assert.match(html, /FLOW_SLUG=\{?"story-flow"\}?|FLOW_SLUG="story-flow"/);
  assert.match(html, /'\.\.\/flows\/'\s*\+\s*FLOW_SLUG\s*\+\s*'\.html#node-'\s*\+\s*n/, 'flow-node link');
  assert.match(html, /\.\.\/coverage\.html#ac-/, 'AC -> coverage.html link');
});

test('flat layout does not carry story-only cross-link glue', () => {
  const out = mkdtempSync(join(tmpdir(), 'ss-flat-nolinks-'));
  build(['--out', out]);
  const html = readFileSync(join(out, 'story-flow.html'), 'utf8');
  assert.doesNotMatch(html, /coverage\.html#ac-/);
  assert.doesNotMatch(html, /FLOW_SLUG/);
});
