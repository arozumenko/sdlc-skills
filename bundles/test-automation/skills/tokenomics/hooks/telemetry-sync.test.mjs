// Tests for the two places that merge the shared telemetry branch:
// syncTelemetry (telemetry-capture.mjs, every capture) and pullTelemetry
// (install-hooks.mjs --pull). Real git in temp dirs — a bare "remote" and two
// clones standing in for two teammates' .agents/telemetry submodules. A merge
// that stops with conflicts must never end up committed, and must never cost
// the local capture data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { syncTelemetry } from './telemetry-capture.mjs';
import { pullTelemetry } from '../scripts/install-hooks.mjs';

// Hermetic git: the code under test spawns git with this process's env, so
// the developer's own global/system git config must not leak in.
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=T', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tel = (repo) => join(repo, '.agents', 'telemetry');

/** A bare remote with a `telemetry` branch + two repos whose .agents/telemetry is a clone of it. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'tokenomics-sync-'));
  const remote = join(root, 'remote.git');
  g(root, 'init', '-q', '--bare', remote);
  const clone = (name, ...args) => {
    const repo = join(root, name);
    mkdirSync(join(repo, '.agents'), { recursive: true });
    g(root, 'clone', '-q', ...args, remote, tel(repo));
    return repo;
  };
  const a = clone('a');
  g(tel(a), 'checkout', '-q', '-b', 'telemetry');
  writeFileSync(join(tel(a), 'README.md'), 'seed\n');
  g(tel(a), 'add', '-A');
  g(tel(a), 'commit', '-q', '-m', 'telemetry: seed');
  g(tel(a), 'push', '-q', 'origin', 'HEAD:telemetry');
  const b = clone('b', '-b', 'telemetry');
  return { a, b };
}

const write = (repo, name, text) => {
  const p = join(tel(repo), 'automation', name);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
  return p;
};
const readAuto = (repo, name) => readFileSync(join(tel(repo), 'automation', name), 'utf8');

const MARKERS = /^(<{7}|>{7}) /m;
/** Every working-tree file (outside .git) that holds a conflict marker. */
function filesWithMarkers(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) filesWithMarkers(p, out);
    else if (MARKERS.test(readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}
/** Files of the HEAD commit that hold a conflict marker ('' = none). */
const committedMarkers = (repo) => { try { return g(tel(repo), 'grep', '-l', '-e', '^<<<<<<< ', 'HEAD'); } catch { return ''; } };
const midMerge = (repo) => { try { g(tel(repo), 'rev-parse', '-q', '--verify', 'MERGE_HEAD'); return true; } catch { return false; } };
const unmerged = (repo) => g(tel(repo), 'ls-files', '-u');
const assertSettled = (repo, what) => {
  assert.equal(midMerge(repo), false, `${what}: the tree is not left mid-merge`);
  assert.equal(unmerged(repo), '', `${what}: no unmerged paths`);
  assert.deepEqual(filesWithMarkers(tel(repo)), [], `${what}: no conflict markers in the telemetry tree`);
  assert.equal(committedMarkers(repo), '', `${what}: no conflict markers committed`);
};

/** Both teammates changed the same shared file; `a` already pushed its version. */
function conflictingWorld(sync) {
  const { a, b } = world();
  write(a, 'config.json', '{"maxSweep":1}\n');
  sync(a);
  assert.equal(g(tel(a), 'rev-parse', 'HEAD'), g(tel(a), 'rev-parse', 'origin/telemetry'), 'fixture: a pushed');
  write(b, 'config.json', '{"maxSweep":2}\n');
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  return { a, b };
}

/** The state an older version left behind: a conflicted merge, still open. */
function leaveUnfinishedMerge(repo) {
  g(tel(repo), 'add', '-A');
  g(tel(repo), 'commit', '-q', '-m', 'telemetry: capture');
  g(tel(repo), 'fetch', '-q', 'origin', 'telemetry');
  try { g(tel(repo), 'merge', '--no-edit', 'FETCH_HEAD'); } catch { /* the conflict is the fixture */ }
  assert.equal(midMerge(repo), true, 'fixture: merge left open');
  assert.notEqual(unmerged(repo), '', 'fixture: unmerged paths');
}

const hookSync = (repo) => syncTelemetry(repo, {});

test('syncTelemetry: distinct per-user files still converge through fetch + merge + push', () => {
  const { a, b } = world();
  write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
  hookSync(a);
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  hookSync(b);
  assert.match(g(tel(b), 'ls-files'), /usage-a\.jsonl[\s\S]*usage-b\.jsonl/);
  assert.equal(g(tel(b), 'rev-parse', 'HEAD'), g(tel(b), 'ls-remote', 'origin', 'refs/heads/telemetry').split(/\s/)[0], 'merge pushed back');
  assertSettled(b, 'clean merge');
});

test('syncTelemetry: a conflicting merge is aborted — no markers, not mid-merge, local data kept, next sync commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  hookSync(b);
  assertSettled(b, 'after the conflicting sync');
  assert.equal(readAuto(b, 'config.json'), '{"maxSweep":2}\n', 'the local version of the conflicted file is intact');
  assert.equal(readAuto(b, 'usage-b.jsonl'), '{"id":"b1"}\n', 'local capture data is intact');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}', 'and committed locally');

  appendFileSync(join(tel(b), 'automation', 'usage-b.jsonl'), '{"id":"b2"}\n'); // the next capture
  hookSync(b);
  assertSettled(b, 'after the next sync');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}\n{"id":"b2"}', 'the next capture is committed, clean');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/config.json'), '{"maxSweep":2}');
});

test('syncTelemetry: an unfinished merge found before staging is aborted first; data written meanwhile survives', () => {
  const { b } = conflictingWorld(hookSync);
  leaveUnfinishedMerge(b);
  // captures kept writing while the merge sat open: a new record, and a line
  // appended to the conflicted file itself
  write(b, 'scopes/sess-1.json', '{"intent":"automation"}\n');
  appendFileSync(join(tel(b), 'automation', 'config.json'), '{"late":"line"}\n');

  hookSync(b);
  assertSettled(b, 'after the sync');
  assert.equal(readAuto(b, 'scopes/sess-1.json'), '{"intent":"automation"}\n', 'new record still on disk');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/scopes/sess-1.json'), '{"intent":"automation"}', 'and committed');
  assert.equal(readAuto(b, 'config.json'), '{"maxSweep":2}\n', 'conflicted file is back at the last local commit');
  // the abort resets the conflicted file, so its working copy (with the late
  // line) is saved outside the tree first — inside the git dir, never committed
  const rescueRoot = join(resolve(tel(b), g(tel(b), 'rev-parse', '--git-dir')), 'tokenomics-rescue');
  const stamps = readdirSync(rescueRoot);
  assert.equal(stamps.length, 1);
  assert.match(readFileSync(join(rescueRoot, stamps[0], 'automation', 'config.json'), 'utf8'), /\{"late":"line"\}/,
    'the line appended to the conflicted file is not lost');
});

test('syncTelemetry: unmerged paths that cannot be aborted → no commit, local files untouched', () => {
  const { b } = conflictingWorld(hookSync);
  leaveUnfinishedMerge(b);
  rmSync(join(resolve(tel(b), g(tel(b), 'rev-parse', '--git-dir')), 'MERGE_HEAD')); // `merge --abort` now refuses
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n{"id":"b2"}\n');
  const head = g(tel(b), 'rev-parse', 'HEAD');
  const conflicted = readAuto(b, 'config.json');
  const statusBefore = g(tel(b), 'status', '--porcelain');

  assert.equal(hookSync(b), false);
  assert.equal(g(tel(b), 'rev-parse', 'HEAD'), head, 'nothing committed');
  assert.equal(g(tel(b), 'status', '--porcelain'), statusBefore, 'index untouched — nothing staged');
  assert.equal(readAuto(b, 'config.json'), conflicted, 'conflicted file left exactly as it was');
  assert.equal(readAuto(b, 'usage-b.jsonl'), '{"id":"b1"}\n{"id":"b2"}\n', 'local capture data untouched');
  assert.equal(committedMarkers(b), '', 'no conflict markers committed');
  const rescueRoot = join(resolve(tel(b), g(tel(b), 'rev-parse', '--git-dir')), 'tokenomics-rescue');
  assert.ok(!existsSync(rescueRoot) || readdirSync(rescueRoot).length === 0,
    'nothing was reset, so no rescue copy piles up on every capture');
});

test('pullTelemetry: a conflicting merge is aborted — failed status, no markers, local data kept, next pull commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  const r = pullTelemetry(b);
  assert.equal(r.status, 'failed');
  assertSettled(b, 'after the conflicting pull');
  assert.equal(readAuto(b, 'config.json'), '{"maxSweep":2}\n');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}', 'local capture data committed locally');

  appendFileSync(join(tel(b), 'automation', 'usage-b.jsonl'), '{"id":"b2"}\n');
  assert.equal(pullTelemetry(b).status, 'failed', 'still diverged — reported, not papered over');
  assertSettled(b, 'after the next pull');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}\n{"id":"b2"}');
});

test('pullTelemetry: an unfinished merge is aborted before staging; one that cannot be aborted stops the pull', () => {
  const { b } = conflictingWorld(hookSync);
  leaveUnfinishedMerge(b);
  write(b, 'scopes/sess-1.json', '{"intent":"automation"}\n');
  pullTelemetry(b);
  assertSettled(b, 'after the pull');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/scopes/sess-1.json'), '{"intent":"automation"}');

  const { b: stuck } = conflictingWorld(hookSync);
  leaveUnfinishedMerge(stuck);
  rmSync(join(resolve(tel(stuck), g(tel(stuck), 'rev-parse', '--git-dir')), 'MERGE_HEAD'));
  const head = g(tel(stuck), 'rev-parse', 'HEAD');
  const conflicted = readAuto(stuck, 'config.json');
  const r = pullTelemetry(stuck);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /unfinished merge/);
  assert.equal(g(tel(stuck), 'rev-parse', 'HEAD'), head, 'nothing committed');
  assert.equal(readAuto(stuck, 'config.json'), conflicted, 'local files untouched');
});

test('pullTelemetry: still merges a teammate\'s distinct files and pushes the merge back', () => {
  const { a, b } = world();
  write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
  hookSync(a);
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  assert.equal(pullTelemetry(b).status, 'pulled');
  assert.match(g(tel(b), 'ls-files'), /usage-a\.jsonl[\s\S]*usage-b\.jsonl/);
  assertSettled(b, 'clean pull');
});
