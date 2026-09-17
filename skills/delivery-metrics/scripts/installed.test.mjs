import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), 'dm-installed-'));
const config = join(sandbox, 'gitconfig'); writeFileSync(config, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', SDLC_SKILLS_CACHE_DIR: join(sandbox, 'cache'), DELIVERY_NO_SYNC: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const entries = JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8')).skills.filter((e) => e.repo);
for (const repo of new Set(entries.map((e) => e.repo))) {
  const mirror = join(sandbox, 'mirrors', repo.replaceAll('/', '__')); mkdirSync(mirror, { recursive: true });
  git(mirror, 'init', '-q', '-b', 'fixture');
  const mine = entries.filter((e) => e.repo === repo);
  for (const e of mine) {
    const dir = join(mirror, e.subdir ?? ''); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${e.id}\ndescription: Offline installer fixture\n---\n# Fixture\n`);
  }
  git(mirror, 'add', '.'); git(mirror, 'commit', '-q', '-m', 'fixtures');
  for (const ref of new Set(mine.map((e) => e.ref ?? 'main'))) git(mirror, 'branch', ref);
  git(sandbox, 'config', '--file', config, `url.file://${mirror}.insteadOf`, `https://github.com/${repo}`);
}
for (const factory of ['feature-development', 'test-automation']) for (const [target, dir] of [['claude', '.claude'], ['copilot', '.github'], ['codex', '.codex']]) {
  test(`installed CLI: ${factory}/${target}`, () => {
    const installed = mkdtempSync(join(sandbox, 'install-'));
    execFileSync('node', [join(root, 'bin/init.mjs'), 'init', '--factory', factory, '--target', target, '--yes'], { cwd: installed, env, stdio: 'pipe' });
    const consumer = mkdtempSync(join(sandbox, 'consumer-')); cpSync(installed, consumer, { recursive: true, dereference: true }); rmSync(installed, { recursive: true });
    const skill = join(consumer, dir, 'skills', 'delivery-metrics');
    assert.ok(existsSync(join(skill, 'references', 'factory-roles.json')));
    const cli = (...args) => execFileSync('node', [join(skill, 'scripts/delivery.mjs'), ...args], { cwd: consumer, env: { ...env, CLAUDE_PROJECT_DIR: consumer }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Review fix (spec §6.5/D21): `doctor` always exits 0 now, `ok` is purely informational — plain
    // `cli(...)` works here even though this fixture never runs install-hooks.mjs and the consumer
    // dir isn't a git repo (so doctor prints `doctor: attention`, never a nonzero exit).
    const block = { campaign_id: 'smoke', run_id: 'r1', version: 1, factory, observation_start: '2026-09-14T00:00:00Z', source_epoch: { from: '2026-09-14T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'smoke' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }] }] };
    writeFileSync(join(consumer, 'plan.json'), JSON.stringify(block));
    assert.match(cli('plan', 'register', '--from', 'plan.json', '--id', 'r', '--created-at', '2026-09-14T00:00:00Z'), /PLAN smoke\/r1/);
    const saved = JSON.parse(cli('plan', 'show', '--plan', 'smoke/r1'));
    assert.deepEqual(saved.roster.factories, [factory]);
    assert.ok(saved.roster.agents.includes(factory === 'feature-development' ? 'js-dev' : 'test-automation-lead'));
    assert.ok(!saved.roster.agents.includes('qa-auditor'));
    assert.match(cli('session', 'set', '--host', target, '--session', 's', '--plan', 'smoke/r1'), /SESSION/);
    cli('event', 'TASK-001', 'dispatched', '--id', 'd', '--at', '2026-09-14T09:00:00Z');
    cli('event', 'TASK-001', 'done', '--id', 'f', '--at', '2026-09-14T11:00:00Z');
    const report = JSON.parse(cli('report', '--json', '--cutoff', '2026-09-17T00:00:00Z'));
    assert.equal(report.plans[0].metrics.flow.task.strata.all.cycle_time.min, 7200);
    assert.match(cli('doctor'), /plans: 1 open/);
  });
}
