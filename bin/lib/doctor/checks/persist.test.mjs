import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSafeFs } from '../fsx.mjs';
import { createGitRunner } from '../git.mjs';
import { expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { targetsCheck } from './targets.mjs';
import { persistCheck } from './persist.mjs';

const g = (d, ...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' });
const s = expectedCoreHookSpec('claude');
const settings = (events) => JSON.stringify({ hooks: Object.fromEntries(Object.entries(events).map(([e, gs]) => [e, gs.map((x) => ({ ...x, _factory: 'sdlc-core' }))])) });
// `sub`: the installed project lives in this subdirectory of the repo.
function project({ git = true, sub = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dps-'));
  const d = sub ? join(root, sub) : root;
  mkdirSync(join(d, s.scriptsDir), { recursive: true });
  for (const f of ['run-hook.cmd', 'session-start', 'agent-start', 'lib.sh']) writeFileSync(join(d, s.scriptsDir, f), '#');
  mkdirSync(join(d, '.claude'), { recursive: true });
  if (git) { g(root, 'init', '-q'); g(root, 'config', 'user.email', 't@t'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'commit.gpgsign', 'false'); }
  return { root, d };
}
const run = (d) => { const ctx = { projectDir: d, fs: createSafeFs(d), git: createGitRunner({ cwd: d }), targets: ['claude'], facts: {} }; targetsCheck.run(ctx); return persistCheck.run(ctx); };

test('committed wiring and scripts are ok', () => {
  const { root, d } = project();
  try {
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events)); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'c');
    const f = run(d);
    assert.ok(f.length > 0 && f.every((x) => x.severity === 'ok'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project as a repo subdirectory: committed wiring is ok', () => {
  const { root, d } = project({ sub: 'packages/app' });
  try {
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events)); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'c');
    const f = run(d);
    assert.ok(f.length > 0 && f.every((x) => x.severity === 'ok'), JSON.stringify(f));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project as a repo subdirectory: uncommitted wiring is a warning', () => {
  const { root, d } = project({ sub: 'packages/app' });
  try {
    writeFileSync(join(d, '.claude/settings.json'), '{"hooks":{}}'); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'c');
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events));
    assert.ok(run(d).some((f) => f.severity === 'warning' && /uncommitted/.test(f.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tracked settings with uncommitted wiring is a warning', () => {
  const { root, d } = project();
  try {
    writeFileSync(join(d, '.claude/settings.json'), '{"hooks":{}}'); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'c');
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events));
    assert.ok(run(d).some((f) => f.severity === 'warning' && /uncommitted/.test(f.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('staged-only wiring is a warning', () => {
  const { root, d } = project();
  try {
    writeFileSync(join(d, '.claude/settings.json'), '{"hooks":{}}'); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'c');
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events)); g(root, 'add', '.claude/settings.json');
    assert.ok(run(d).some((f) => f.severity === 'warning' && /staged but not committed/.test(f.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ignored settings file is a warning naming the consequence', () => {
  const { root, d } = project();
  try {
    writeFileSync(join(d, '.gitignore'), '.claude/*\n'); writeFileSync(join(d, '.claude/settings.json'), settings(s.events));
    assert.ok(run(d).some((f) => f.severity === 'warning' && /ignored.*other clones/.test(f.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('committed wiring referencing untracked scripts is a warning', () => {
  const { root, d } = project();
  try {
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events)); g(root, 'add', '.claude/settings.json'); g(root, 'commit', '-qm', 'c');
    assert.ok(run(d).some((f) => f.severity === 'warning' && /untracked/.test(f.message) && /run-hook\.cmd/.test(f.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('not a git repository: unknown, never a crash (Review Focus 1)', () => {
  const { root, d } = project({ git: false });
  try {
    writeFileSync(join(d, '.claude/settings.json'), settings(s.events));
    const f = run(d);
    assert.deepEqual(f.map((x) => x.severity), ['unknown']); assert.match(f[0].message, /not a Git repository/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
