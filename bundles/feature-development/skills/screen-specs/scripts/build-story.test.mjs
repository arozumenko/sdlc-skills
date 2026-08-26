// scripts/build-story.test.mjs
//
// T3: build-story.mjs — coverage (E) + design-story hub (C).
//
// Two layers:
//   1. computeCoverage() — pure, no file/DOM IO. Fixture flow+screen specs
//      share a flow key/node id/ac id so one criterion resolves as covered
//      and one (referenced only in a flow `findings` entry, with no screen)
//      resolves as a gap.
//   2. CLI build-smoke — run the real binary against tiny fixture files
//      written to a tmpdir, assert coverage.html + index.html exist and
//      carry the expected anchors/links.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCoverage } from './build-story.mjs';

const __d = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__d, 'build-story.mjs');

/* -------------------------------------------------------- fixture specs */
// One flow, two nodes, two criteria:
//   AC-1 — has a transition AND a screen that lists it -> covered.
//   AC-2 — has a transition only; no screen realizes it, and a `findings`
//          entry names it in prose -> gap (both by the "no screen" rule and
//          the "named in findings" rule).
const flowDoc = {
  title: 'Fixture flow',
  flows: [
    {
      key: 'story-flow',
      title: 'Flow map — story-flow: Test',
      trigger: 'Guest opens the app',
      bet: 'A faster path to booking',
      nodes: [
        { id: '0', label: 'Start', transitions: [{ target: '1', trigger: 'go', kind: 'primary', nav: 'push', ac: 'AC-1' }] },
        { id: '1', label: 'Result', transitions: [{ target: '2', trigger: 'confirm', kind: 'primary', nav: 'push', ac: 'AC-2' }] },
        { id: '2', label: 'End', transitions: [] }
      ]
    }
  ],
  findings: [
    { group: 'Gaps', title: 'AC-2 has no screen', tone: 'warn', body: 'Confirmation screen not yet designed for AC-2.' }
  ]
};

const screensDoc = {
  flow: 'story-flow',
  title: 'Story flow screens',
  screens: [
    {
      id: 'S-001-0',
      node: '1',
      title: 'Result',
      purpose: 'show result',
      ac: ['AC-1'],
      nav: { kind: 'root', title: 'Result' },
      regions: [{ type: 'appbar', label: 'Header', content: 'Result' }],
      states: [{ name: 'Loaded', trigger: 'data arrives', ac: ['AC-1'] }]
    }
  ]
};

/* --------------------------------------------------------- computeCoverage */
test('computeCoverage: covered criterion lists its node, screen and state', () => {
  const cov = computeCoverage({ flowSpecs: [flowDoc], screenSpecs: [screensDoc] });
  assert.ok(cov['AC-1'], 'AC-1 present');
  assert.equal(cov['AC-1'].gap, false);
  assert.ok(cov['AC-1'].nodes.some(n => n.nodeId === '0' && n.flowKey === 'story-flow'), 'node realizes AC-1');
  assert.ok(cov['AC-1'].screens.some(s => s.screenId === 'S-001-0'), 'screen realizes AC-1');
  assert.ok(cov['AC-1'].states.some(s => s.stateName === 'Loaded'), 'state realizes AC-1');
});

test('computeCoverage: criterion with no realizing screen is a gap', () => {
  const cov = computeCoverage({ flowSpecs: [flowDoc], screenSpecs: [screensDoc] });
  assert.ok(cov['AC-2'], 'AC-2 present (referenced by a transition)');
  assert.equal(cov['AC-2'].gap, true);
  assert.equal(cov['AC-2'].screens.length, 0);
  assert.ok(cov['AC-2'].nodes.some(n => n.nodeId === '1'), 'still tracks the node that references it');
});

test('computeCoverage: a criterion named in `findings` prose is flagged gap even if realized', () => {
  const doc = {
    ...flowDoc,
    findings: [{ group: 'Gaps', title: 'AC-1 needs a second look', tone: 'warn', body: 'Screen exists but under-specifies AC-1.' }]
  };
  const cov = computeCoverage({ flowSpecs: [doc], screenSpecs: [screensDoc] });
  assert.equal(cov['AC-1'].gap, true, 'findings mention forces gap even though a screen realizes it');
  assert.ok(cov['AC-1'].screens.length > 0, 'the screen realization is still recorded');
});

test('computeCoverage: with no specs at all returns an empty map', () => {
  assert.deepEqual(computeCoverage({ flowSpecs: [], screenSpecs: [] }), {});
});

/* ------------------------------------------------------------- CLI smoke */
function writeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'story-src-'));
  writeFileSync(join(dir, 'fixture.flowspec.json'), JSON.stringify(flowDoc));
  writeFileSync(join(dir, 'fixture.screens.json'), JSON.stringify(screensDoc));
  return dir;
}

function build(args) {
  return execFileSync('node', [BUILD, ...args]).toString();
}

test('CLI: writes coverage.html and index.html', () => {
  const src = writeFixtures();
  const out = mkdtempSync(join(tmpdir(), 'story-out-'));
  build(['--flows', join(src, 'fixture.flowspec.json'), '--screens', join(src, 'fixture.screens.json'), '--out', out]);
  assert.ok(existsSync(join(out, 'coverage.html')), 'coverage.html written');
  assert.ok(existsSync(join(out, 'index.html')), 'index.html written');
});

test('CLI: coverage.html has an ac-<id> anchor per criterion and marks the gap row', () => {
  const src = writeFixtures();
  const out = mkdtempSync(join(tmpdir(), 'story-out2-'));
  build(['--flows', join(src, 'fixture.flowspec.json'), '--screens', join(src, 'fixture.screens.json'), '--out', out]);
  const html = readFileSync(join(out, 'coverage.html'), 'utf8');
  assert.match(html, /id="ac-AC-1"/, 'covered criterion anchor');
  assert.match(html, /id="ac-AC-2"/, 'gap criterion anchor');
  assert.match(html, /class="row gap"[^>]*id="ac-AC-2"|id="ac-AC-2"[^>]*class="[^"]*gap/, 'gap row is marked');
  // matches the href a screen's AC chip actually emits (build-screens.mjs):
  // '../coverage.html#ac-' + String(a).split(' ')[0]
  assert.match(html, /screens\/story-flow\.html#S-001-0/, 'links back to the realizing screen');
  assert.match(html, /flows\/story-flow\.html#node-0/, 'links back to a realizing node');
});

test('CLI: index.html hub has Problem/Journey/Screens/Coverage sections and cross-links', () => {
  const src = writeFixtures();
  const out = mkdtempSync(join(tmpdir(), 'story-out3-'));
  build(['--flows', join(src, 'fixture.flowspec.json'), '--screens', join(src, 'fixture.screens.json'), '--out', out]);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, />Problem</);
  assert.match(html, />Journey</);
  assert.match(html, />Screens</);
  assert.match(html, />Coverage</);
  assert.match(html, /Guest opens the app/, 'flow trigger surfaced');
  assert.match(html, /href="flows\/story-flow\.html"/, 'links to the flow page');
  assert.match(html, /href="screens\/story-flow\.html"/, 'links to the screens page');
  assert.match(html, /href="coverage\.html"/, 'links to the coverage page');
  assert.match(html, /2 criteria/, 'coverage summary count');
  assert.match(html, /1 gap/, 'coverage summary gap count');
});
