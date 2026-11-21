// Which project a hook works in. Under Copilot, session-start writes and deletes
// files under <project>/.github/instructions/, so it must never follow a
// CLAUDE_PROJECT_DIR inherited from another shell (a Copilot session started from
// a Claude Code terminal). Under Claude Code nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
// Host markers and hook tunables from the developer's own shell must not decide
// the outcome; HOME is a temp dir so no real ~/.copilot state is read.
const HOST_ENV = /^(CLAUDE_.*|CLAUDECODE|COPILOT_.*|SDLC_.*|CODEX_HOOK|CURSOR_.*|PLUGIN_ROOT)$/;

// Two throwaway projects: `own` is the one the session runs in, `other` is the
// one a stale CLAUDE_PROJECT_DIR points at. Each has a shared doc, a role memory
// with its own sentinel, and an instruction file the Copilot refresh would delete.
function projects() {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-pdir-'));
  const make = (name) => {
    const dir = join(root, name);
    mkdirSync(join(dir, '.agents', 'memory', 'qa-engineer'), { recursive: true });
    mkdirSync(join(dir, '.github', 'instructions'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'profile.md'), `# Profile of ${name}\n`);
    writeFileSync(join(dir, '.agents', 'memory', 'qa-engineer', 'MEMORY.md'), `# Memory index\n\n- sentinel-${name}\n`);
    writeFileSync(join(dir, '.github', 'instructions', 'sdlc-shared.instructions.md'), 'old combined file\n');
    return dir;
  };
  mkdirSync(join(root, 'home'));
  return { root, own: make('own'), other: make('other') };
}
function run(hook, { root, cwd, env, payload = {} }) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !HOST_ENV.test(k)));
  const r = spawnSync('bash', [HOOK(hook)], {
    cwd, input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...base, HOME: join(root, 'home'), SDLC_CONFIG_DIR: join(root, 'home'), ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const instr = (dir, name) => join(dir, '.github', 'instructions', `${name}.instructions.md`);
// The refresh ran in `dir`: its shared doc was mirrored and the old combined file removed.
const refreshed = (dir) => existsSync(instr(dir, 'profile')) && !existsSync(instr(dir, 'sdlc-shared'));
const untouched = (dir) => !existsSync(instr(dir, 'profile')) && existsSync(instr(dir, 'sdlc-shared'));

for (const [host, flag] of [['Copilot CLI', 'COPILOT_CLI'], ['VS Code Copilot Chat', 'SDLC_VSCODE']]) {
  test(`${host}: session-start ignores a stale CLAUDE_PROJECT_DIR and writes only into its own project`, () => {
    const p = projects();
    try {
      run('session-start', { root: p.root, cwd: p.own, env: { [flag]: '1', COPILOT_PROJECT_DIR: p.own, CLAUDE_PROJECT_DIR: p.other } });
      assert.ok(untouched(p.other), 'the other project was written to');
      assert.ok(refreshed(p.own), 'the session project was not refreshed');
      assert.match(readFileSync(instr(p.own, 'profile'), 'utf8'), /Profile of own/);
    } finally { rmSync(p.root, { recursive: true, force: true }); }
  });

  test(`${host}: agent-start reads role memory from its own project, not the stale one`, () => {
    const p = projects();
    try {
      const out = run('agent-start', { root: p.root, cwd: p.own, payload: { agentName: 'qa-engineer', agent_type: 'qa-engineer' }, env: { [flag]: '1', COPILOT_PROJECT_DIR: p.own, CLAUDE_PROJECT_DIR: p.other } });
      assert.match(out, /sentinel-own/);
      assert.doesNotMatch(out, /sentinel-other/);
    } finally { rmSync(p.root, { recursive: true, force: true }); }
  });
}

test('Copilot CLI without COPILOT_PROJECT_DIR falls back to the working directory, not CLAUDE_PROJECT_DIR', () => {
  const p = projects();
  try {
    run('session-start', { root: p.root, cwd: p.own, env: { COPILOT_CLI: '1', CLAUDE_PROJECT_DIR: p.other } });
    assert.ok(untouched(p.other), 'the other project was written to');
    assert.ok(refreshed(p.own), 'the session project was not refreshed');
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});

test('Claude Code is unchanged: CLAUDE_PROJECT_DIR wins over COPILOT_PROJECT_DIR and the working directory', () => {
  const p = projects();
  try {
    const env = { CLAUDE_PROJECT_DIR: p.own, COPILOT_PROJECT_DIR: p.other };
    const out = run('agent-start', { root: p.root, cwd: p.other, payload: { agent_type: 'qa-engineer' }, env });
    assert.match(out, /sentinel-own/);
    assert.doesNotMatch(out, /sentinel-other/);
    // session-start writes no instruction files under Claude Code, in either project.
    run('session-start', { root: p.root, cwd: p.other, env });
    assert.ok(untouched(p.own) && untouched(p.other));
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});
