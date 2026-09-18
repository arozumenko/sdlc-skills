import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bestEffortSync } from './sync.mjs';

const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** A bare remote + two clones standing in for two teammates' .agents/telemetry submodules. */
const world = () => {
  const root = mkdtempSync(join(tmpdir(), 'dm-sync-'));
  const remote = join(root, 'remote.git'); g(root, 'init', '-q', '--bare', remote);
  const clone = (name) => { const repo = join(root, name); mkdirSync(join(repo, '.agents'), { recursive: true }); g(root, 'clone', '-q', remote, join(repo, '.agents', 'telemetry')); const tel = join(repo, '.agents', 'telemetry'); g(tel, 'config', 'user.email', 't@x'); g(tel, 'config', 'user.name', 'T'); return repo; };
  const a = clone('a'); const tel = join(a, '.agents', 'telemetry'); writeFileSync(join(tel, 'README.md'), 'x'); g(tel, 'add', '-A'); g(tel, 'commit', '-q', '-m', 'init'); g(tel, 'push', '-q', '-u', 'origin', 'HEAD');
  const b = clone('b'); g(join(b, '.agents', 'telemetry'), 'pull', '-q');
  return { a, b, remote };
};
const write = (repo, name, text) => { const d = join(repo, '.agents', 'telemetry', 'delivery'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), text); };

test('no-op reasons: DELIVERY_NO_SYNC, plain-dir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dm-sync-'));
  assert.deepEqual(bestEffortSync(repo, { env: { DELIVERY_NO_SYNC: '1' } }), { synced: false, reason: 'DELIVERY_NO_SYNC' });
  assert.deepEqual(bestEffortSync(repo, { env: {} }), { synced: false, reason: 'plain-dir' });
});

test('two writers: rejected push → fetch/merge/push succeeds; distinct per-user files never conflict', () => {
  const { a, b } = world();
  write(a, 'events-a.jsonl', '{"a":1}\n'); assert.equal(bestEffortSync(a, { env: {} }).synced, true);
  write(b, 'events-b.jsonl', '{"b":1}\n'); const r = bestEffortSync(b, { env: {} });
  assert.equal(r.synced, true, r.reason);
  assert.match(g(join(b, '.agents', 'telemetry'), 'ls-files'), /events-a\.jsonl[\s\S]*events-b\.jsonl/);
});

// Issue 4: a rejected push followed by a fetch that fails outright (remote unreachable/network down)
// must be reported distinctly from a real merge conflict — it is not something a manual merge can fix.
test('sync: fetch failure after a rejected push is reported distinctly from a merge conflict', () => {
  const { a, b } = world();
  write(a, 'events-a.jsonl', '{"a":1}\n'); assert.equal(bestEffortSync(a, { env: {} }).synced, true);
  write(b, 'events-b.jsonl', '{"b":1}\n');
  const tel = join(b, '.agents', 'telemetry');
  g(tel, 'remote', 'set-url', 'origin', join(tel, 'no-such-remote.git'));
  const r = bestEffortSync(b, { env: {} });
  assert.equal(r.synced, false);
  assert.match(r.reason, /fetch failed/);
  assert.doesNotMatch(r.reason, /merge conflict/);
});

test('conflicting shared file: merge aborted, nothing committed as resolved, reason names manual repair; unmerged tree is never staged', () => {
  const { a, b } = world();
  write(a, 'profile.json', '{"x":1}\n'); bestEffortSync(a, { env: {} });
  write(b, 'profile.json', '{"x":2}\n'); const r = bestEffortSync(b, { env: {} });
  assert.equal(r.synced, false); assert.match(r.reason, /merge conflict/);
  const tel = join(b, '.agents', 'telemetry');
  assert.equal(g(tel, 'ls-files', '-u'), '', 'merge was aborted, tree left clean');
  // now fake an unresolved merge state and make sure sync refuses to stage
  g(tel, 'fetch', '-q'); try { g(tel, 'merge', '--no-edit', 'origin/HEAD'); } catch { /* conflict */ }
  assert.notEqual(g(tel, 'ls-files', '-u'), '');
  const r2 = bestEffortSync(b, { env: {} });
  assert.equal(r2.synced, false); assert.match(r2.reason, /unresolved merge/);
  assert.notEqual(g(tel, 'ls-files', '-u'), '', 'still unmerged; sync did not touch it');
});
