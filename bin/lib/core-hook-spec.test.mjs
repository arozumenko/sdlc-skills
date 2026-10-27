import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectedCoreHookSpec, CORE_HOOK_MARKER } from './core-hook-spec.mjs';

const INIT = fileURLToPath(new URL('../init.mjs', import.meta.url));
const NO_NETWORK = fileURLToPath(new URL('../fixtures/security-testing-e2e/no-network.gitconfig', import.meta.url));
const strip = (g) => { const { _factory, ...rest } = g; return rest; };

test('expectedCoreHookSpec matches what init writes for every hooked target', () => {
  // Offline: HOME and the installer cache live in the temp dir; git cannot reach the network.
  const home = mkdtempSync(join(tmpdir(), 'chs-'));
  const d = join(home, 'project');
  try {
    mkdirSync(d);
    const env = { ...process.env, HOME: home, SDLC_SKILLS_CACHE_DIR: join(home, '.cache'), GIT_CONFIG_GLOBAL: NO_NETWORK };
    const g = spawnSync('git', ['init', '-q'], { cwd: d, env, encoding: 'utf8' });
    assert.equal(g.status, 0, g.stderr);
    const r = spawnSync(process.execPath, [INIT, 'init', '--agents', 'personal-assistant', '--target', 'claude,cursor,copilot,codex', '--yes'], { cwd: d, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const claude = JSON.parse(readFileSync(join(d, '.claude/settings.json'), 'utf8'));
    const cs = expectedCoreHookSpec('claude');
    for (const [ev, groups] of Object.entries(cs.events)) assert.deepEqual(claude.hooks[ev].filter((x) => x._factory === 'sdlc-core').map(strip), groups);
    const cursor = JSON.parse(readFileSync(join(d, '.cursor/hooks.json'), 'utf8'));
    assert.deepEqual(cursor.hooks.sessionStart.filter((e) => e.command.includes('sdlc-skills')), expectedCoreHookSpec('cursor').events.sessionStart);
    assert.deepEqual(JSON.parse(readFileSync(join(d, '.github/hooks/sdlc-skills.json'), 'utf8')), expectedCoreHookSpec('copilot').writeSpec);
    const codex = JSON.parse(readFileSync(join(d, '.codex/hooks.json'), 'utf8'));
    for (const [ev, groups] of Object.entries(expectedCoreHookSpec('codex').events)) assert.deepEqual(codex.hooks[ev].filter((x) => x._factory === 'sdlc-core').map(strip), groups);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('windsurf and unknown targets have no core hooks', () => {
  assert.equal(expectedCoreHookSpec('windsurf'), null);
  assert.equal(expectedCoreHookSpec('nope'), null);
});

test('every expected command carries the marker', () => {
  for (const t of ['claude', 'cursor', 'copilot', 'codex']) {
    const json = JSON.stringify(expectedCoreHookSpec(t).events);
    assert.ok(json.includes(CORE_HOOK_MARKER), t);
  }
});
