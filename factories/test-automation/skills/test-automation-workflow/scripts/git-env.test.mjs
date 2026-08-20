import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRemote } from './git-env.mjs';

/** A throwaway repo with one commit and no remotes. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'genv-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'f.txt'), 'x');
  g('add', '.'); g('commit', '-qm', 'init');
  return { dir, g };
}

// `origin` was hardcoded across the gate and cleanup, so a fork checkout
// (`upstream`) or any renamed remote broke fetch, checkout and delete alike —
// and it surfaced as a red gate rather than as an infrastructure error. git
// answers this in one command; a script that already shells out should ask.
test('the single remote is used whatever it is called', () => {
  const { dir, g } = repo();
  try {
    g('remote', 'add', 'upstream', 'https://example.invalid/x.git');
    assert.equal(resolveRemote(dir), 'upstream');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('among several remotes, origin is the conventional default', () => {
  const { dir, g } = repo();
  try {
    g('remote', 'add', 'upstream', 'https://example.invalid/u.git');
    g('remote', 'add', 'origin', 'https://example.invalid/o.git');
    assert.equal(resolveRemote(dir), 'origin');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an explicit override always wins', () => {
  const { dir, g } = repo();
  try {
    g('remote', 'add', 'origin', 'https://example.invalid/o.git');
    g('remote', 'add', 'fork', 'https://example.invalid/f.git');
    assert.equal(resolveRemote(dir, 'fork'), 'fork');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A local-only repo is a legitimate state, not an error: the gate can still
// prove what is on disk, and it says so in its note rather than failing.
test('no remote is null, not a throw and not a guess', () => {
  const { dir } = repo();
  try {
    assert.equal(resolveRemote(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a path that is not a repo answers null rather than exploding', () => {
  assert.equal(resolveRemote('/nope/not/a/repo'), null);
});
