import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGitRunner, parseGitVersion } from './git.mjs';

const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'dgit-'));
  g(d, 'init', '-q'); g(d, 'config', 'user.email', 't@t'); g(d, 'config', 'user.name', 't');
  g(d, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(d, 'a.txt'), 'one\n'); g(d, 'add', 'a.txt'); g(d, 'commit', '-qm', 'c');
  return d;
}

test('parseGitVersion', () => {
  assert.deepEqual(parseGitVersion('git version 2.50.1 (Apple Git-155)'), [2, 50, 1]);
  assert.deepEqual(parseGitVersion('git version 2.45.0.windows.1'), [2, 45, 0]);
  assert.equal(parseGitVersion('nonsense'), null);
});

test('object reads are gated on 2.45', () => {
  const d = repo();
  try {
    assert.equal(createGitRunner({ cwd: d, versionText: 'git version 2.44.2' }).objectReadsAllowed, false);
    assert.equal(createGitRunner({ cwd: d, versionText: 'git version 2.45.0' }).objectReadsAllowed, true);
    assert.equal(createGitRunner({ cwd: d, versionText: 'git version 2.44.2' }).showFile('HEAD', 'a.txt').status, 'undetermined');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('showFile reads HEAD and index, missing is distinct', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'two\n'); g(d, 'add', 'a.txt');
    const r = createGitRunner({ cwd: d });
    assert.deepEqual(r.showFile('HEAD', 'a.txt'), { status: 'ok', content: 'one\n' });
    assert.deepEqual(r.showFile('', 'a.txt'), { status: 'ok', content: 'two\n' });
    assert.equal(r.showFile('HEAD', 'nope.txt').status, 'missing');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a configured fsmonitor hook is never run and the index is not rewritten', () => {
  const d = repo();
  try {
    const marker = join(d, 'FSMONITOR_RAN');
    const hook = join(d, 'fsmon.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`); chmodSync(hook, 0o755);
    g(d, 'config', 'core.fsmonitor', hook);
    const before = readFileSync(join(d, '.git', 'index'));
    const r = createGitRunner({ cwd: d });
    r.run(['ls-files']); r.run(['check-ignore', '-q', '--no-index', '--', 'x']); r.showFile('HEAD', 'a.txt'); r.showFile('', 'a.txt');
    assert.equal(existsSync(marker), false, 'fsmonitor hook must not run');
    assert.deepEqual(readFileSync(join(d, '.git', 'index')), before, 'index must be byte-identical');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('routing env vars from the caller are ignored', () => {
  const d = repo(); const other = repo();
  const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    writeFileSync(join(other, 'only-in-other.txt'), 'x\n'); g(other, 'add', 'only-in-other.txt');
    process.env.GIT_DIR = join(other, '.git');
    process.env.GIT_WORK_TREE = other;
    process.env.GIT_INDEX_FILE = join(other, '.git', 'index');
    const r = createGitRunner({ cwd: d });
    assert.equal(realpathSync(r.run(['rev-parse', '--absolute-git-dir']).stdout.trim()), realpathSync(join(d, '.git')));
    assert.equal(realpathSync(r.run(['rev-parse', '--show-toplevel']).stdout.trim()), realpathSync(d));
    const listed = r.run(['ls-files']).stdout;
    assert.ok(listed.includes('a.txt'));
    assert.ok(!listed.includes('only-in-other.txt'), 'must list the cwd repo, not the routed one');
  } finally {
    for (const k of names) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(d, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
  }
});

test('partial clone: a missing promisor blob is reported undetermined and never fetched', () => {
  const src = repo();
  const clone = mkdtempSync(join(tmpdir(), 'dgit-pc-'));
  try {
    g(src, 'config', 'uploadpack.allowFilter', 'true');
    execFileSync('git', ['clone', '-q', '--no-checkout', '--filter=blob:none', `file://${src}`, clone]);
    const packsBefore = execFileSync('git', ['-C', clone, 'count-objects', '-v'], { encoding: 'utf8' });
    const r = createGitRunner({ cwd: clone });
    if (!r.objectReadsAllowed) return; // older git: covered by the gate test
    assert.equal(r.showFile('HEAD', 'a.txt').status, 'undetermined');
    assert.equal(execFileSync('git', ['-C', clone, 'count-objects', '-v'], { encoding: 'utf8' }), packsBefore, 'object store unchanged');
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); }
});

test('showFile resolves paths relative to cwd when it is a repo subdirectory', () => {
  const d = repo();
  try {
    mkdirSync(join(d, 'pkg'));
    writeFileSync(join(d, 'pkg', 'b.txt'), 'sub\n'); g(d, 'add', 'pkg/b.txt'); g(d, 'commit', '-qm', 'sub');
    writeFileSync(join(d, 'pkg', 'b.txt'), 'staged\n'); g(d, 'add', 'pkg/b.txt');
    const r = createGitRunner({ cwd: join(d, 'pkg') });
    assert.deepEqual(r.showFile('HEAD', 'b.txt'), { status: 'ok', content: 'sub\n' });
    assert.deepEqual(r.showFile('', 'b.txt'), { status: 'ok', content: 'staged\n' });
    assert.equal(r.showFile('HEAD', 'a.txt').status, 'missing');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
