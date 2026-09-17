import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveOwnerRepo, ownerRepo, deliveryDir, encodeSegment, decodeSegment, runPath, eventsPath, sessionPath, withLock, nowIso, sha256, whoAmI, cliError } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-paths-'));

test('deliveryDir is .agents/telemetry/delivery under the repo', () => {
  const repo = tmp();
  assert.equal(deliveryDir(repo), join(repo, '.agents', 'telemetry', 'delivery'));
});

test('owner is shared before telemetry exists, from linked and nested directories', () => {
  const repo = tmp();
  const g = (...args) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(tmp(), 'arbitrary'); g('worktree', 'add', '-q', '-b', 'work', wt);
  mkdirSync(join(wt, 'nested'));
  assert.equal(resolveOwnerRepo(join(wt, 'nested')), realpathSync(repo));
  assert.equal(ownerRepo({ cwd: wt }, { CLAUDE_PROJECT_DIR: tmp() }), realpathSync(repo));
  assert.equal(deliveryDir(wt), deliveryDir(repo));
  assert.equal(runPath(wt, 'a/b'), runPath(repo, 'a/b'));
  assert.equal(sessionPath(wt, 'claude', 's'), sessionPath(repo, 'claude', 's'));
  assert.equal(resolveOwnerRepo(tmp()).startsWith('/'), true);
});

test('encodeSegment percent-encodes / % : reversibly and leaves the rest', () => {
  assert.equal(encodeSegment('sec/run-1'), 'sec%2Frun-1');
  assert.equal(encodeSegment('a%b'), 'a%25b');
  assert.equal(decodeSegment(encodeSegment('x/y%z%2F:q')), 'x/y%z%2F:q');
  assert.equal(encodeSegment('TASK-023'), 'TASK-023');
});

test('runPath / eventsPath / sessionPath', () => {
  const repo = tmp();
  assert.equal(runPath(repo, 'sec/run-1'), join(deliveryDir(repo), 'plans', 'sec%2Frun-1.json'));
  assert.equal(eventsPath(repo, 'daniel-sallai'), join(deliveryDir(repo), 'events-daniel-sallai.jsonl'));
  assert.equal(sessionPath(repo, 'claude', 'sess/1'), join(deliveryDir(repo), 'sessions', 'claude%3Asess%2F1.json'));
});

test('withLock: mkdir lock, LOCK-BUSY while fresh, reclaimed when stale', () => {
  const repo = tmp();
  let ran = 0;
  withLock(repo, () => { ran++; assert.ok(existsSync(join(deliveryDir(repo), '.lock'))); });
  assert.equal(ran, 1); assert.ok(!existsSync(join(deliveryDir(repo), '.lock')));
  mkdirSync(join(deliveryDir(repo), '.lock'), { recursive: true });
  assert.throws(() => withLock(repo, () => {}, { now: Date.now() }), (e) => e.code === 'LOCK-BUSY' && e.exit === 2);
  const old = (Date.now() - 120000) / 1000;
  utimesSync(join(deliveryDir(repo), '.lock'), old, old);
  withLock(repo, () => { ran++; }, { now: Date.now() });
  assert.equal(ran, 2);
});

test('nowIso, sha256, cliError, whoAmI', () => {
  assert.equal(nowIso(0), '1970-01-01T00:00:00.000Z');
  assert.match(sha256('x'), /^[0-9a-f]{64}$/);
  assert.equal(sha256(Buffer.from('x')), sha256('x'));
  const e = cliError('NO-PLAN', 'a\nb');
  assert.equal(e.exit, 3); assert.equal(e.message, 'NO-PLAN(a b)');
  assert.equal(cliError('USAGE', 'x').exit, 2); assert.equal(cliError('WHAT', 'x').exit, 1);
  assert.match(whoAmI(tmp()).slug, /^[a-z0-9-]+$/);
});
