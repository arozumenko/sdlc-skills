// Shared telemetry publish policy (.agents/telemetry/policy.json; learning-loops spec, implementation contract item 1):
// tokenomics must never push the shared tree when the project is local-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installTelemetrySubmodule, publishAllowed } from './install-hooks.mjs';
import { syncTelemetry } from '../hooks/telemetry-capture.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
const world = () => {
  const repo = mkdtempSync(join(tmpdir(), 'tok-pol-')); g(repo, 'init', '-q', '-b', 'main'); g(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
  const remote = mkdtempSync(join(tmpdir(), 'tok-remote-')); g(remote, 'init', '-q', '--bare'); g(repo, 'remote', 'add', 'origin', remote);
  return { repo, remote };
};
const policy = (repo, text) => { mkdirSync(join(repo, '.agents', 'telemetry'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'policy.json'), text); };
const remoteHas = (remote) => { try { g(remote, 'rev-parse', '--verify', 'refs/heads/telemetry'); return true; } catch { return false; } };

test('publishAllowed: legacy and private-remote yes; local-only, broken policy, TOKENOMICS_NO_SYNC no', () => {
  const r = () => mkdtempSync(join(tmpdir(), 'tok-pa-'));
  assert.equal(publishAllowed(r(), {}), true);
  let x = r(); policy(x, '{"publish":"private-remote"}'); assert.equal(publishAllowed(x, {}), true);
  x = r(); policy(x, '{"publish":"local-only"}'); assert.equal(publishAllowed(x, {}), false);
  x = r(); policy(x, '{broken'); assert.equal(publishAllowed(x, {}), false);
  x = r(); policy(x, '{"publish":"world"}'); assert.equal(publishAllowed(x, {}), false);
  assert.equal(publishAllowed(r(), { TOKENOMICS_NO_SYNC: '1' }), false);
});

test('installer: legacy pushes the telemetry branch (unchanged); local-only with an origin keeps a plain directory and pushes nothing', () => {
  let { repo, remote } = world();
  assert.equal(installTelemetrySubmodule(repo).status, 'installed'); assert.equal(remoteHas(remote), true);
  ({ repo, remote } = world()); policy(repo, '{"publish":"local-only"}');
  const r = installTelemetrySubmodule(repo);
  assert.equal(r.status, 'skipped'); assert.equal(remoteHas(remote), false);
  assert.ok(!existsSync(join(repo, '.agents', 'telemetry', '.git'))); assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'policy.json')));
});

test('capture sync: local-only commits inside the submodule but never pushes', () => {
  const { repo, remote } = world();
  assert.equal(installTelemetrySubmodule(repo).status, 'installed');
  const before = g(remote, 'rev-parse', 'refs/heads/telemetry');
  policy(repo, '{"publish":"local-only"}');
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'x.jsonl'), '{}\n');
  syncTelemetry(repo, {});
  assert.equal(g(remote, 'rev-parse', 'refs/heads/telemetry'), before, 'remote untouched');
  assert.equal(g(join(repo, '.agents', 'telemetry'), 'status', '--porcelain'), '', 'committed locally');
});

test('installer settings check: a local policy the telemetry branch would shadow stops bootstrap with nothing changed', () => {
  const { repo } = world();
  const ENVX = { ...ENV };
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: '{"publish":"private-remote"}\n', encoding: 'utf8', env: ENVX }).trim();
  const tree = execFileSync('git', ['mktree'], { cwd: repo, input: `100644 blob ${blob}\tpolicy.json\n`, encoding: 'utf8', env: ENVX }).trim();
  g(repo, 'update-ref', 'refs/heads/telemetry', g(repo, 'commit-tree', tree, '-m', 'seed'));
  policy(repo, '{"publish":"private-remote","x":1}\n');
  const index = g(repo, 'ls-files', '--stage');
  const r = installTelemetrySubmodule(repo);
  assert.equal(r.status, 'conflict'); assert.match(r.reason, /policy\.json/);
  assert.equal(g(repo, 'ls-files', '--stage'), index);
  assert.ok(!existsSync(join(repo, '.agents', 'telemetry', '.git')) && !existsSync(join(repo, '.agents', 'telemetry.pre-submodule')));
});
