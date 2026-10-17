// e2e.test.mjs — end-to-end safety tests for `init doctor`, offline.
// Runs the real installer into a throwaway repo, then doctor against it.
// Network is blocked and HOME/cache pinned to the temp root (pattern:
// bin/security-testing-e2e.test.mjs); personal-assistant has monorepo-only skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const INIT = fileURLToPath(new URL('../../init.mjs', import.meta.url));
const NO_NETWORK = fileURLToPath(new URL('../../fixtures/security-testing-e2e/no-network.gitconfig', import.meta.url));
const envFor = (root) => ({ ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, '.cache'), GIT_CONFIG_GLOBAL: NO_NETWORK });
// Fixture git calls never read the developer's global or system config.
const g = (d, ...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NO_NETWORK } });
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (p) => { for (const n of readdirSync(p).sort()) { const f = join(p, n); const s = statSync(f); h.update(f); if (s.isDirectory()) walk(f); else h.update(readFileSync(f)); } };
  walk(dir); return h.digest('hex');
}
function installed(name = 'proj') {
  const root = mkdtempSync(join(tmpdir(), 'de2e-'));
  const d = join(root, name); mkdirSync(d);
  const env = envFor(root);
  g(d, 'init', '-q'); g(d, 'config', 'user.email', 't@t'); g(d, 'config', 'user.name', 't'); g(d, 'config', 'commit.gpgsign', 'false');
  execFileSync(process.execPath, [INIT, 'init', '--agents', 'personal-assistant', '--target', 'claude', '--yes'], { cwd: d, env, stdio: 'ignore' });
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'install');
  return { root, d };
}
const doctor = (root, d, ...args) => spawnSync(process.execPath, [INIT, 'init', 'doctor', ...args], { cwd: d, env: envFor(root), encoding: 'utf8' });

test('fresh committed install: no wiring or persist errors', () => {
  const { root, d } = installed();
  try {
    const r = doctor(root, d, '--json');
    const j = JSON.parse(r.stdout);
    assert.equal(j.findings.filter((f) => ['wiring', 'persist'].includes(f.check) && f.severity === 'error').length, 0);
    assert.equal(r.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('never executes project code and leaves tree and index unchanged', () => {
  const { root, d } = installed();
  try {
    const marker = join(root, 'RAN');
    const evil = `#!/bin/sh\ntouch "${marker}"\n`;
    for (const f of ['config.sh', 'config-defaults.sh', 'lib.sh', 'agent-start', 'session-start', 'run-hook.cmd']) writeFileSync(join(d, '.claude/hooks/sdlc-skills', f), `touch "${marker}"\n`);
    mkdirSync(join(d, '.claude/skills/delivery-monitor/scripts'), { recursive: true });
    writeFileSync(join(d, '.claude/skills/delivery-monitor/scripts/install-hooks.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'x');`);
    const hook = join(root, 'fsmon.sh'); writeFileSync(hook, evil); chmodSync(hook, 0o755); g(d, 'config', 'core.fsmonitor', hook);
    const before = treeHash(d);
    doctor(root, d); doctor(root, d, '--json', '--strict');
    assert.equal(existsSync(marker), false, 'no project code ran');
    assert.equal(treeHash(d), before, 'project tree (including .git) unchanged');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unwired install is exit 1; --strict turns warnings into exit 1', () => {
  const { root, d } = installed();
  try {
    writeFileSync(join(d, '.claude/settings.json'), '{}\n');
    assert.equal(doctor(root, d).status, 1);
    const { root: r2, d: d2 } = installed();
    try {
      writeFileSync(join(d2, '.claude/hooks/sdlc-skills/config.sh'), 'SDLC_CTX_CAP=32768\n');
      assert.equal(doctor(r2, d2).status, 0);
      assert.equal(doctor(r2, d2, '--strict').status, 1);
    } finally { rmSync(r2, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('path with spaces and non-ASCII characters (Review Focus 4)', () => {
  const { root, d } = installed('my projekt ünï');
  try { assert.equal(doctor(root, d).status, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});
