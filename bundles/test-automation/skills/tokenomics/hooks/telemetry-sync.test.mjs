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
import { syncTelemetry, acquireSyncLock, mergeFetchedTelemetry } from './telemetry-capture.mjs';
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
  write(a, 'usage-same.jsonl', '{"id":"a1"}\n'); // one git user name, two clones → the same ledger file
  sync(a);
  assert.equal(rev(a, 'HEAD'), remoteHead(a), 'fixture: a pushed');
  write(b, 'config.json', '{"maxSweep":2}\n');
  write(b, 'factory-profile.json', '{"factory_id":"b"}\n');
  write(b, 'usage-same.jsonl', '{"id":"b0"}\n');
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
/** A git runner for the telemetry tree, same contract as the ones the code builds: throws on a non-zero exit. */
const runner = (repo) => (args) => execFileSync('git', ['-C', tel(repo), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
/** Run fn, return its result and everything it wrote to stderr. */
function withStderr(fn) {
  const orig = process.stderr.write;
  let out = '';
  process.stderr.write = (chunk) => { out += chunk; return true; };
  try { return { result: fn(), out }; } finally { process.stderr.write = orig; }
}
/** The moment right before the converge step: everything local committed, the remote branch fetched. */
function commitAndFetch(repo) {
  g(tel(repo), 'add', '-A');
  g(tel(repo), 'commit', '-q', '-m', 'telemetry: capture');
  g(tel(repo), 'fetch', '-q', 'origin', 'telemetry');
}

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

test('syncTelemetry: a merge that would conflict is not started — no markers, not mid-merge, local data kept, next sync commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  const { out } = withStderr(() => hookSync(b));
  assert.match(out, /would conflict — not started/, 'the conflict is found without starting the merge');
  assert.doesNotMatch(out, /aborted/);
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
test('sync lock: while it is held a sync stages and commits nothing and is not an error', () => {
  const { b } = world();
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  const holder = acquireSyncLock(tel(b), runner(b)); // another sync is running
  const before = snapshot(b);
  const { result, out } = withStderr(() => hookSync(b));
  assert.equal(result, false, 'skipped — the data waits in the working tree for the next sync');
  assert.equal(out, '', 'a running sync is normal — nothing to report');
  const r = pullTelemetry(b);
  assert.equal(r.status, 'busy');
  assert.equal(r.abandoned, false);
  assert.deepEqual(snapshot(b), before, 'nothing staged, nothing committed');
  assert.ok(existsSync(lockDir(b)), 'the holder\'s lock is not removed by the run that skipped');

  holder.release();
  assert.equal(hookSync(b), true, 'the next capture syncs');
  assert.equal(g(tel(b), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}');
  assert.equal(rev(b, 'HEAD'), remoteHead(b), 'pushed');
  assert.ok(!existsSync(lockDir(b)), 'and released afterwards');
});

test('sync lock: acquire, refuse a second acquire, release, acquire again', () => {
  const { b } = world();
  const first = acquireSyncLock(tel(b), runner(b));
  assert.equal(typeof first.release, 'function');
  assert.equal(first.lock, lockDir(b), 'inside the telemetry git dir — never in the tree');
  assert.ok(existsSync(lockDir(b)));
  assert.equal(g(tel(b), 'status', '--porcelain'), '', 'invisible to git');
  const second = acquireSyncLock(tel(b), runner(b));
  assert.equal(second.release, null);
  assert.equal(second.abandoned, false);
  first.release();
  assert.ok(!existsSync(lockDir(b)));
  const third = acquireSyncLock(tel(b), runner(b));
  assert.equal(typeof third.release, 'function');
  third.release();
  assert.ok(!existsSync(lockDir(b)));
});

// Age cannot prove the holder is dead (a sleeping machine, a suspended
// process), and a takeover lets two runs both "replace" the same old lock:
// A replaces it and acquires, B removes A's fresh lock and acquires too.
// So an old lock is reported, never taken over.
test('sync lock: an old lock is never taken over — two competing acquires both stay out, the sync says where it is', () => {
  const { b } = world();
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  mkdirSync(lockDir(b));
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(lockDir(b), longAgo, longAgo);
  const before = snapshot(b);

  const one = acquireSyncLock(tel(b), runner(b));
  const two = acquireSyncLock(tel(b), runner(b));
  assert.deepEqual([one.release, two.release], [null, null], 'neither acquires');
  assert.deepEqual([one.abandoned, two.abandoned], [true, true]);
  assert.ok(existsSync(lockDir(b)), 'the old lock is still there');

  const { result, out } = withStderr(() => hookSync(b));
  assert.equal(result, false);
  assert.ok(out.includes(lockDir(b)) && /looks abandoned/.test(out) && /by hand/.test(out), out);
  const r = pullTelemetry(b);
  assert.equal(r.status, 'busy');
  assert.equal(r.abandoned, true);
  assert.equal(r.lock, lockDir(b));
  assert.deepEqual(snapshot(b), before, 'nothing staged, nothing committed');
  assert.ok(existsSync(lockDir(b)));
});

test('sync lock: release removes only a lock that still holds this run\'s token', () => {
  const { b } = world();
  const mine = acquireSyncLock(tel(b), runner(b));
  // someone removed the lock by hand while this run was still going, and another sync took it
  rmSync(lockDir(b), { recursive: true });
  const theirs = acquireSyncLock(tel(b), runner(b));
  assert.equal(typeof theirs.release, 'function');
  mine.release();
  assert.ok(existsSync(lockDir(b)), 'a lock with a foreign token is left in place');
  assert.equal(acquireSyncLock(tel(b), runner(b)).release, null, 'and still held');
  theirs.release();
  assert.ok(!existsSync(lockDir(b)));
});

// A failure between creating the lock directory and handing back `release`
// would leave a lock nobody can release — every later sync would skip.
test('sync lock: a failure while acquiring leaves no lock directory behind', () => {
  const { b } = world();
  const boom = () => { throw new Error('injected failure'); };
  assert.throws(() => acquireSyncLock(tel(b), runner(b), { newToken: boom }), /injected failure/);
  assert.ok(!existsSync(lockDir(b)), 'token generation failed → no lock left');
  assert.throws(() => acquireSyncLock(tel(b), runner(b), { writeOwner: boom }), /injected failure/);
  assert.ok(!existsSync(lockDir(b)), 'owner-file write failed → the just-created lock is removed');
  const next = acquireSyncLock(tel(b), runner(b));
  assert.equal(typeof next.release, 'function', 'the next sync can still take the lock');
  next.release();
  assert.ok(!existsSync(lockDir(b)));
});

// A merge that will conflict is never started: the conflict is found with a
// dry run that touches neither the index nor the working tree, so a capture
// another process appends at that very moment cannot be lost to an abort.
test('mergeFetchedTelemetry: conflicting histories → no merge is started, index and working tree byte-identical', () => {
  const { b } = conflictingWorld(hookSync);
  commitAndFetch(b);
  // another process's captures landing right now: a line appended to the
  // conflicting ledger file, and a new untracked record
  appendFileSync(join(tel(b), 'automation', 'usage-same.jsonl'), '{"id":"late"}\n');
  write(b, 'scopes/late.json', '{"intent":"automation"}\n');
  const before = snapshot(b);
  const calls = [];
  const real = runner(b);
  const result = mergeFetchedTelemetry((args) => { calls.push(args.join(' ')); return real(args); });
  assert.equal(result, 'conflict');
  assert.ok(calls.some((c) => c.startsWith('merge-tree --write-tree')), 'the dry run ran');
  assert.deepEqual(calls.filter((c) => /(^| )merge( |$)/.test(c)), [], 'git merge was never run — MERGE_HEAD never existed');
  assert.deepEqual(snapshot(b), before, 'HEAD, every index stage and every working file are unchanged');
  assert.equal(readAuto(b, 'usage-same.jsonl'), '{"id":"b0"}\n{"id":"late"}\n');
});

test('mergeFetchedTelemetry: clean histories merge', () => {
  const { a, b } = world();
  write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
  hookSync(a);
  write(b, 'usage-b.jsonl', '{"id":"b1"}\n');
  commitAndFetch(b);
  assert.equal(mergeFetchedTelemetry(runner(b)), 'merged');
  assert.match(g(tel(b), 'ls-files'), /usage-a\.jsonl[\s\S]*usage-b\.jsonl/);
  assert.equal(g(tel(b), 'rev-list', '--count', '--merges', 'HEAD'), '1');
});

// The dry run says "clean", but git refuses to START the real merge because an
// uncommitted local change would be overwritten (another capture appended to a
// file the remote also changed). No MERGE_HEAD, nothing touched: not a
// conflict state — the next capture tries again.
test('a merge git refuses to start leaves the uncommitted change intact: not a conflict, try again later', () => {
  const setup = () => {
    const { a, b } = world();
    write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
    hookSync(a);
    hookSync(b);                                  // b now has a's ledger
    appendFileSync(join(tel(a), 'automation', 'usage-a.jsonl'), '{"id":"a2"}\n');
    hookSync(a);                                  // the remote moved on in that same file
    write(b, 'usage-b.jsonl', '{"id":"b1"}\n');   // b's own capture, to be committed by the sync
    return b;
  };
  const late = (b) => appendFileSync(join(tel(b), 'automation', 'usage-a.jsonl'), '{"id":"late"}\n');
  const intact = (b, what) => {
    assert.equal(readAuto(b, 'usage-a.jsonl'), '{"id":"a1"}\n{"id":"late"}\n', `${what}: the uncommitted change is intact`);
    assert.equal(midMerge(b), false, `${what}: no merge was started`);
    assert.equal(unmerged(b), '');
  };

  const b = setup();
  commitAndFetch(b);
  late(b);
  const before = snapshot(b);
  assert.equal(mergeFetchedTelemetry(runner(b)), 'not-started');
  assert.deepEqual(snapshot(b), before);
  intact(b, 'direct');

  // through the two real entry points: the change lands right after their own commit
  const lateHook = (b2) => writeFileSync(join(resolve(tel(b2), g(tel(b2), 'rev-parse', '--git-dir')), 'hooks', 'post-commit'),
    `#!/bin/sh\nprintf '%s\\n' '{"id":"late"}' >> automation/usage-a.jsonl\n`, { mode: 0o755 });
  const viaSync = setup();
  lateHook(viaSync);
  const { out } = withStderr(() => hookSync(viaSync));
  assert.equal(out, '', 'nothing conflicted and nothing was aborted — nothing to report');
  intact(viaSync, 'syncTelemetry');
  assert.equal(g(tel(viaSync), 'show', 'HEAD:automation/usage-b.jsonl'), '{"id":"b1"}', 'the capture itself is committed locally');

  const viaPull = setup();
  lateHook(viaPull);
  const r = pullTelemetry(viaPull);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /could not start/);
  assert.doesNotMatch(r.error, /conflict/);
  intact(viaPull, 'pullTelemetry');
});

// git older than 2.38 has no `merge-tree --write-tree`: the old path stays —
// start the merge, abort it on the spot when it stops.
test('mergeFetchedTelemetry: without merge-tree --write-tree it falls back to merge, then abort on a conflict', () => {
  const oldVersion = (repo) => { const real = runner(repo); return (args) => (args[0] === 'version' ? 'git version 2.30.1\n' : real(args)); };
  const noWriteTree = (repo) => {
    const real = runner(repo);
    return (args) => {
      if (args[0] === 'merge-tree') throw Object.assign(new Error('usage: git merge-tree <base-tree> <branch1> <branch2>'), { status: 129 });
      return real(args);
    };
  };
  for (const [name, unsupported] of [['an old git version', oldVersion], ['a usage error from merge-tree', noWriteTree]]) {
    const { b } = conflictingWorld(hookSync);
    commitAndFetch(b);
    const calls = [];
    const git = unsupported(b);
    assert.equal(mergeFetchedTelemetry((args) => { calls.push(args.join(' ')); return git(args); }), 'aborted', name);
    assert.ok(calls.some((c) => /(^| )merge --no-edit FETCH_HEAD$/.test(c)), `${name}: the real merge ran`);
    assert.ok(calls.includes('merge --abort'), `${name}: and was aborted`);
    assertSettled(b, name);
    assert.equal(readAuto(b, 'usage-same.jsonl'), '{"id":"b0"}\n', `${name}: back at the local commit`);

    const { a, b: clean } = world();
    write(a, 'usage-a.jsonl', '{"id":"a1"}\n');
    hookSync(a);
    write(clean, 'usage-b.jsonl', '{"id":"b1"}\n');
    commitAndFetch(clean);
    assert.equal(mergeFetchedTelemetry(unsupported(clean)), 'merged', `${name}: clean histories still merge`);
  }
});

test('pullTelemetry: a merge that would conflict is not started — failed status naming the conflict, no markers, local data kept, next pull commits no markers', () => {
  const { b } = conflictingWorld(hookSync);
  const r = pullTelemetry(b);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /merge conflict/);
  assert.match(r.error, /not started/);
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

test('CLI --pull: an old lock exits 1, names the lock and says it looks abandoned', () => {
  const { b } = world();
  mkdirSync(lockDir(b));
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(lockDir(b), longAgo, longAgo);
  const dest = join(b, '.claude', 'skills', 'tokenomics');
  cpSync(fileURLToPath(new URL('..', import.meta.url)), dest, { recursive: true });
  const r = spawnSync(process.execPath, [join(dest, 'scripts', 'install-hooks.mjs'), '--repo', b, '--pull'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(lockDir(b)) && /looks abandoned/.test(r.stderr) && /by hand/.test(r.stderr), r.stderr);
  assert.ok(existsSync(lockDir(b)));
});
