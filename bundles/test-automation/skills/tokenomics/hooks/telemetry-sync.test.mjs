// Tests for the two places that merge the shared telemetry branch:
// syncTelemetry (telemetry-capture.mjs, every capture) and pullTelemetry
// (install-hooks.mjs --pull). Real git in temp dirs — a bare "remote" and two
// clones standing in for two teammates' .agents/telemetry submodules. A merge
// that stops with conflicts must never end up committed, and must never cost
// the local capture data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync, rmSync, utimesSync, realpathSync, cpSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir, devNull } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tokenomics-sync-')));
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
  writeFileSync(join(tel(a), '.gitignore'), '*/live/\n'); // transient state, as the installer seeds it
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
/** Every working-tree file outside .git, path → content. */
function treeFiles(dir, root = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) treeFiles(p, root, out);
    else out[relative(root, p)] = readFileSync(p, 'utf8');
  }
  return out;
}
const filesWithMarkers = (dir) => Object.entries(treeFiles(dir)).filter(([, text]) => MARKERS.test(text)).map(([p]) => p);
/** Files of the HEAD commit that hold a conflict marker ('' = none). */
const committedMarkers = (repo) => { try { return g(tel(repo), 'grep', '-l', '-e', '^<<<<<<< ', 'HEAD'); } catch { return ''; } };
const rev = (repo, name) => { try { return g(tel(repo), 'rev-parse', '-q', '--verify', name); } catch { return null; } };
const midMerge = (repo) => rev(repo, 'MERGE_HEAD') !== null;
const unmerged = (repo) => g(tel(repo), 'ls-files', '-u');
const remoteHead = (repo) => g(tel(repo), 'ls-remote', 'origin', 'refs/heads/telemetry').split(/\s/)[0];
const lockDir = (repo) => join(resolve(tel(repo), g(tel(repo), 'rev-parse', '--git-dir')), 'tokenomics-sync.lock');
/** Everything a sync could disturb: commits, the open merge, the index (every stage), every working file. */
const snapshot = (repo) => ({
  head: rev(repo, 'HEAD'),
  mergeHead: rev(repo, 'MERGE_HEAD'),
  index: g(tel(repo), 'ls-files', '-s'),
  status: g(tel(repo), 'status', '--porcelain'),
  files: treeFiles(tel(repo)),
});
const assertSettled = (repo, what) => {
  assert.equal(midMerge(repo), false, `${what}: the tree is not left mid-merge`);
  assert.equal(unmerged(repo), '', `${what}: no unmerged paths`);
  assert.deepEqual(filesWithMarkers(tel(repo)), [], `${what}: no conflict markers in the telemetry tree`);
  assert.equal(committedMarkers(repo), '', `${what}: no conflict markers committed`);
  assert.ok(!existsSync(lockDir(repo)), `${what}: the sync lock is released`);
};

/** Both teammates changed the same two shared files; `a` already pushed its versions. */
function conflictingWorld(sync) {
  const { a, b } = world();
  write(a, 'config.json', '{"maxSweep":1}\n');
  write(a, 'factory-profile.json', '{"factory_id":"a"}\n');
  sync(a);
  assert.equal(rev(a, 'HEAD'), remoteHead(a), 'fixture: a pushed');
  write(b, 'config.json', '{"maxSweep":2}\n');
  write(b, 'factory-profile.json', '{"factory_id":"b"}\n');
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  write(b, 'live/sess-1.jsonl', '{"dispatch":1}\n'); // ignored working state
  return { a, b };
}

/**
 * A merge someone else left open in the telemetry tree — a person resolving a
 * conflict by hand: one file already resolved and staged, one still unmerged,
 * and captures that kept writing meanwhile.
 */
function openMergeByHand(repo) {
  g(tel(repo), 'add', '-A');
  g(tel(repo), 'commit', '-q', '-m', 'telemetry: capture');
  g(tel(repo), 'fetch', '-q', 'origin', 'telemetry');
  try { g(tel(repo), 'merge', '--no-edit', 'FETCH_HEAD'); } catch { /* the conflict is the fixture */ }
  write(repo, 'factory-profile.json', '{"factory_id":"resolved-by-hand"}\n');
  g(tel(repo), 'add', 'automation/factory-profile.json');
  write(repo, 'scopes/sess-1.json', '{"intent":"automation"}\n');                    // new, untracked
  appendFileSync(join(tel(repo), 'automation', 'usage-b.jsonl'), '{"id":"b2"}\n');   // tracked, uncommitted
  appendFileSync(join(tel(repo), 'automation', 'config.json'), '{"late":"line"}\n'); // into the conflicted file
  assert.equal(midMerge(repo), true, 'fixture: merge open');
  assert.match(unmerged(repo), /config\.json/, 'fixture: one file still unmerged');
  assert.doesNotMatch(unmerged(repo), /factory-profile\.json/, 'fixture: one file resolved and staged');
}

const hookSync = (repo) => syncTelemetry(repo, {});

test('syncTelemetry: distinct per-user files still converge through fetch + merge + push', () => {
  const { a, b } = world();
  write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
  hookSync(a);
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  hookSync(b);
  assert.match(g(tel(b), 'ls-files'), /usage-a\.jsonl[\s\S]*usage-b\.jsonl/);
  assert.equal(rev(b, 'HEAD'), remoteHead(b), 'merge pushed back');
  assertSettled(b, 'clean merge');
});

test('syncTelemetry: a merge this sync started and that conflicts is aborted — no markers, not mid-merge, local data kept, next sync commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  hookSync(b);
  assertSettled(b, 'after the conflicting sync');
  assert.equal(readAuto(b, 'config.json'), '{"maxSweep":2}\n', 'the local version of the conflicted file is intact');
  assert.equal(readAuto(b, 'usage-b.jsonl'), '{"id":"b1"}\n', 'local capture data is intact');
  assert.equal(readAuto(b, 'live/sess-1.jsonl'), '{"dispatch":1}\n', 'ignored working state is intact');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}', 'and committed locally');

  appendFileSync(join(tel(b), 'automation', 'usage-b.jsonl'), '{"id":"b2"}\n'); // the next capture
  write(b, 'scopes/sess-2.json', '{"intent":"other"}\n');
  hookSync(b);
  assertSettled(b, 'after the next sync');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}\n{"id":"b2"}', 'the next capture is committed, clean');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/scopes/sess-2.json'), '{"intent":"other"}');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/config.json'), '{"maxSweep":2}');
  assert.equal(readAuto(b, 'live/sess-1.jsonl'), '{"dispatch":1}\n');
});

// A merge that was already open is not ours — a person may be resolving it by
// hand. A file they already resolved and staged is not even listed as
// unmerged, so nothing a sync could do to "clean up" is safe. Hands off.
test('syncTelemetry: a merge that was already open is left exactly as it was — index and working tree unchanged, nothing committed', () => {
  const { b } = conflictingWorld(hookSync);
  openMergeByHand(b);
  const before = snapshot(b);
  assert.equal(hookSync(b), false);
  assert.deepEqual(snapshot(b), before, 'HEAD, MERGE_HEAD, every index stage and every working file are unchanged');
  assert.equal(committedMarkers(b), '', 'no conflict markers committed');
  assert.ok(!existsSync(lockDir(b)), 'the sync lock is released');
});

test('syncTelemetry: unmerged paths with no merge to conclude → no commit, local files untouched', () => {
  const { b } = conflictingWorld(hookSync);
  openMergeByHand(b);
  rmSync(join(resolve(tel(b), g(tel(b), 'rev-parse', '--git-dir')), 'MERGE_HEAD'));
  const before = snapshot(b);
  assert.equal(hookSync(b), false);
  assert.deepEqual(snapshot(b), before);
  assert.equal(committedMarkers(b), '', 'no conflict markers committed');
});

// Two captures must not interleave: A's merge stops with a conflict, B stages
// and commits the markers before A aborts. One lock around the whole sequence.
test('sync lock: while it is held a sync stages and commits nothing and is not an error; a stale lock is taken over', () => {
  const { b } = world();
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  mkdirSync(lockDir(b)); // another sync is running
  const before = snapshot(b);
  assert.equal(hookSync(b), false, 'skipped — the data waits in the working tree for the next sync');
  assert.equal(pullTelemetry(b).status, 'busy');
  assert.deepEqual(snapshot(b), before, 'nothing staged, nothing committed');
  assert.ok(existsSync(lockDir(b)), 'the holder\'s lock is not removed by the run that skipped');

  const longAgo = new Date(Date.now() - 60 * 60 * 1000); // its holder died an hour ago
  utimesSync(lockDir(b), longAgo, longAgo);
  assert.equal(hookSync(b), true, 'stale lock taken over');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}');
  assert.equal(rev(b, 'HEAD'), remoteHead(b), 'pushed');
  assert.ok(!existsSync(lockDir(b)), 'and released afterwards');
});

test('pullTelemetry: a merge this pull started and that conflicts is aborted — failed status naming the conflict, no markers, local data kept, next pull commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  const r = pullTelemetry(b);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /merge conflict/);
  assert.doesNotMatch(r.error, /offline/, 'a conflict is not blamed on the network');
  assertSettled(b, 'after the conflicting pull');
  assert.equal(readAuto(b, 'config.json'), '{"maxSweep":2}\n');
  assert.equal(readAuto(b, 'live/sess-1.jsonl'), '{"dispatch":1}\n', 'ignored working state is intact');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}', 'local capture data committed locally');

  appendFileSync(join(tel(b), 'automation', 'usage-b.jsonl'), '{"id":"b2"}\n');
  assert.equal(pullTelemetry(b).status, 'failed', 'still diverged — reported, not papered over');
  assertSettled(b, 'after the next pull');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}\n{"id":"b2"}');
});

test('pullTelemetry: a merge that was already open is left exactly as it was; the pull says so', () => {
  const { b } = conflictingWorld(hookSync);
  openMergeByHand(b);
  const before = snapshot(b);
  const r = pullTelemetry(b);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /unfinished merge/);
  assert.deepEqual(snapshot(b), before, 'HEAD, MERGE_HEAD, every index stage and every working file are unchanged');
  assert.ok(!existsSync(lockDir(b)), 'the sync lock is released');
});

test('pullTelemetry: a fetch that fails is reported as a fetch failure', () => {
  const { b } = world();
  g(tel(b), 'remote', 'set-url', 'origin', join(tel(b), 'no-such-remote.git'));
  const r = pullTelemetry(b);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /could not fetch the remote telemetry branch/);
  assert.doesNotMatch(r.error, /merge conflict/);
});

test('pullTelemetry: still merges a teammate\'s distinct files and pushes the merge back', () => {
  const { a, b } = world();
  write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
  hookSync(a);
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  assert.equal(pullTelemetry(b).status, 'pulled');
  assert.match(g(tel(b), 'ls-files'), /usage-a\.jsonl[\s\S]*usage-b\.jsonl/);
  assert.equal(remoteHead(b), rev(b, 'HEAD'), 'the bare remote\'s telemetry ref is the local merge commit');
  assert.equal(g(tel(b), 'rev-list', '--count', '--merges', 'HEAD'), '1', 'and that commit is the merge');
  assertSettled(b, 'clean pull');
});

// End to end through the CLI (main() refuses a repo that does not contain the
// installed skill, so the skill is copied into the repo and run from there).
test('CLI --pull: a conflict exits 1 and names the conflict, not "offline"', () => {
  const { b } = conflictingWorld(hookSync);
  const dest = join(b, '.claude', 'skills', 'tokenomics');
  cpSync(fileURLToPath(new URL('..', import.meta.url)), dest, { recursive: true });
  const r = spawnSync(process.execPath, [join(dest, 'scripts', 'install-hooks.mjs'), '--repo', b, '--pull'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /pull failed/);
  assert.match(r.stderr, /merge conflict/);
  assert.doesNotMatch(r.stderr, /offline/);
  assertSettled(b, 'after the CLI pull');
});
