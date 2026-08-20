// scripts/story.test.mjs
//
// Build-smoke coverage for `--layout story` (T2): subdir output under
// `flows/` plus the A cross-link (flow node -> its screen spec page), and a
// regression lock that the default (flat) layout still writes exactly where
// it always has, at --out root.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__d, 'build-flowmaps.mjs');
const SPEC = join(__d, '__fixtures__', 'story.flowspec.json');
const SCREENS = join(__d, '__fixtures__', 'story.screens.json');

function build(args) {
  return execFileSync('node', [BUILD, ...args]).toString();
}

test('flat (default, no --layout) writes flow pages at --out root, unchanged', () => {
  const out = mkdtempSync(join(tmpdir(), 'fm-flat-'));
  build([SPEC, '--out', out]);
  assert.ok(existsSync(join(out, 'story-flow.html')), 'flow page at root');
  assert.ok(existsSync(join(out, 'index.html')), 'index at root');
  assert.ok(!existsSync(join(out, 'flows')), 'no flows/ subdir under flat');
});

test('--layout flat (explicit) is the same as default', () => {
  const out = mkdtempSync(join(tmpdir(), 'fm-flat2-'));
  build([SPEC, '--out', out, '--layout', 'flat']);
  assert.ok(existsSync(join(out, 'story-flow.html')));
  assert.ok(!existsSync(join(out, 'flows')));
});

test('--layout story writes flow pages into flows/', () => {
  const out = mkdtempSync(join(tmpdir(), 'fm-story-'));
  build([SPEC, '--out', out, '--layout', 'story']);
  assert.ok(existsSync(join(out, 'flows', 'story-flow.html')), 'flow page under flows/');
  assert.ok(existsSync(join(out, 'flows', 'index.html')), 'flow index under flows/');
  assert.ok(!existsSync(join(out, 'story-flow.html')), 'not also written at root');
});

test('--layout story without --screens degrades gracefully (no screens link, still builds)', () => {
  const out = mkdtempSync(join(tmpdir(), 'fm-story-noscreens-'));
  build([SPEC, '--out', out, '--layout', 'story']);
  const html = readFileSync(join(out, 'flows', 'story-flow.html'), 'utf8');
  assert.match(html, /SCREEN_MAP = \{\}/, 'empty screen map when --screens is absent');
});

test('--layout story with --screens emits a node -> screen cross-link (A)', () => {
  const out = mkdtempSync(join(tmpdir(), 'fm-story-screens-'));
  build([SPEC, '--out', out, '--layout', 'story', '--screens', SCREENS]);
  const html = readFileSync(join(out, 'flows', 'story-flow.html'), 'utf8');
  // node "1" (the fixture's only screen-bearing node) resolves to the
  // matching screen spec's slug + screen id.
  assert.match(html, /SCREEN_MAP = \{"1":\{"slug":"story-flow","screenId":"S-001-0"\}\}/);
  assert.match(html, /'\.\.\/screens\/' \+ hit\.slug \+ '\.html#' \+ hit\.screenId/);
  assert.match(html, /cell\.id = 'node-' \+ id/);
});
