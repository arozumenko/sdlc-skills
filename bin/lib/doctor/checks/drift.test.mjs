import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createSafeFs } from '../fsx.mjs';
import { driftCheck } from './drift.mjs';

function tree(root, files) { for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); } }
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ddr-'));
  const pkg = join(root, 'pkg'), proj = join(root, 'proj');
  tree(pkg, {
    'skills.json': JSON.stringify({ skills: [{ id: 'ext', repo: 'o/r' }] }),
    'skills/memory/SKILL.md': 'm1', 'skills/memory/ref.md': 'r',
    'bundles/a/skills/dup/SKILL.md': 'a', 'bundles/b/skills/dup/SKILL.md': 'b',
  });
  tree(proj, {
    '.claude/hooks/sdlc-skills/run-hook.cmd': '#',
    '.claude/skills/memory/SKILL.md': 'm1-edited', '.claude/skills/memory/ref.md': 'r',
    '.claude/skills/dup/SKILL.md': 'a', '.claude/skills/ext/SKILL.md': 'x',
  });
  symlinkSync(join(pkg, 'skills', 'memory'), join(proj, '.claude', 'skills', 'linked'));
  return { root, pkg, proj };
}

test('drift: straight copies compared; externals, symlinks and ambiguous origins not compared', () => {
  const { root, pkg, proj } = setup();
  try {
    const f = driftCheck.run({ projectDir: proj, pkgRoot: pkg, fs: createSafeFs(proj), facts: {}, detected: [{ target: 'claude', evidence: true, examined: true }] });
    const w = f.find((x) => x.severity === 'warning');
    assert.match(w.message, /memory: differs from the running package: 1 file/);
    assert.deepEqual(w.data.files, ['SKILL.md']);
    assert.ok(f.some((x) => x.severity === 'skipped' && /ext: not compared: external skill/.test(x.message)));
    assert.ok(f.some((x) => x.severity === 'skipped' && /dup: not compared: ambiguous origin \(2 package copies\)/.test(x.message)));
    assert.ok(f.some((x) => x.severity === 'skipped' && /linked: not compared: symlinked skill/.test(x.message)));
    assert.ok(f.some((x) => x.severity === 'skipped' && /agents \(rewritten by overlays\)/.test(x.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('drift: copilot and codex skill directories are compared too', () => {
  const { root, pkg, proj } = setup();
  try {
    tree(proj, { '.github/skills/memory/SKILL.md': 'm1', '.github/skills/memory/ref.md': 'r', '.codex/skills/memory/SKILL.md': 'edited', '.codex/skills/memory/ref.md': 'r' });
    const detected = ['copilot', 'codex'].map((target) => ({ target, evidence: true, examined: true }));
    const f = driftCheck.run({ projectDir: proj, pkgRoot: pkg, fs: createSafeFs(proj), facts: {}, detected });
    assert.ok(f.some((x) => x.target === 'copilot' && x.severity === 'ok' && /1 skill match/.test(x.message)));
    assert.ok(f.some((x) => x.target === 'codex' && x.severity === 'warning' && /memory: differs/.test(x.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
