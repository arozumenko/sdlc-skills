import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createSafeFs } from '../fsx.mjs';
import { detectTargets, targetsCheck } from './targets.mjs';

function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'dtg-'));
  for (const [rel, content] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), content); }
  return d;
}
const ctxFor = (d) => ({ projectDir: d, fs: createSafeFs(d), targets: null, facts: {} });

test('directory alone is not installation evidence', () => {
  const d = project({ '.github/workflows/ci.yml': 'x' });
  try {
    const t = detectTargets(ctxFor(d)).find((x) => x.target === 'copilot');
    assert.equal(t.dirExists, true); assert.equal(t.evidence, false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('scripts or a marker entry (even broken) are evidence', () => {
  const d = project({
    '.claude/hooks/sdlc-skills/run-hook.cmd': '#',
    '.cursor/hooks.json': JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'BROKEN ./.cursor/hooks/sdlc-skills/run-hook.cmd nope' }] } }),
  });
  try {
    const ts = detectTargets(ctxFor(d));
    assert.equal(ts.find((x) => x.target === 'claude').evidence, true);
    const cur = ts.find((x) => x.target === 'cursor');
    assert.equal(cur.evidence, true); assert.equal(cur.scriptsPresent, false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('facts and out-of-scope note', () => {
  const d = project({ '.claude/hooks/sdlc-skills/run-hook.cmd': '#', '.windsurf/x': 'y' });
  try {
    const ctx = ctxFor(d);
    const f = targetsCheck.run(ctx);
    assert.equal(ctx.facts.installed, true);
    assert.match(ctx.facts.targets, /claude \(installed\)/);
    assert.match(ctx.facts.targets, /windsurf \(not examined\)/);
    assert.ok(f.some((x) => x.severity === 'skipped' && /factory-specific hooks, native-plugin wiring/.test(x.message)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
