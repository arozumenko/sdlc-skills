// Text policy (spec: learning-loops design, implementation contract item 2): profile.json storeText false is a veto over
// every free-text source. Default (true) keeps the shipped behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRaw, resolveObservations } from './events.mjs';
import { deliveryDir } from './paths.mjs';

const CLI = fileURLToPath(new URL('../delivery.mjs', import.meta.url));
const run = (repo, args) => { const r = spawnSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '' } }); return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; };
const initRepo = () => { const r = mkdtempSync(join(tmpdir(), 'dm-text-')); for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@x'], ['config', 'user.name', 'Tester']]) execFileSync('git', a, { cwd: r }); return r; };
const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const profile = (repo, obj) => { const d = deliveryDir(repo); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'profile.json'), JSON.stringify(obj)); };
const prRec = (number, head, base, mergedAt, title) => ({ number, title, headRefName: head, baseRefName: base, createdAt: '2026-09-17T00:00:00Z', mergedAt, mergeCommit: { oid: `sha${number}` }, url: `u${number}` });

const setup = () => {
  const repo = initRepo();
  const p = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
    source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group',
    missions: [{ ref: 'M1', sequence: 1, tasks: [{ ref: 'T1.1' }] }], branch_map: [{ pattern: 'era-m(?<m>\\d+)$', ref: 'M{m}' }] };
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, p), '--id', 'reg-1']).code, 0);
  const prs = join(repo, 'prs.json'); writeFileSync(prs, JSON.stringify([prRec(7, 'feat/era-m1', 'main', '2026-09-20T10:00:00Z', 'Secret customer name in title')]));
  return { repo, prs };
};
const prDone = (repo) => resolveObservations(repo).active.find((o) => o.event === 'done' && o.ref === 'M1');

test('default: PR backfill stores the title (shipped behaviour)', () => {
  const { repo, prs } = setup();
  assert.equal(run(repo, ['backfill', '--pr', '--from-json', prs, '--cutoff', '2026-12-31T00:00:00Z']).code, 0);
  assert.match(String(prDone(repo).raw ?? ''), /Secret customer name/);
});

test('storeText false: PR backfill stores no title; nothing in the ledger carries it', () => {
  const { repo, prs } = setup(); profile(repo, { storeText: false });
  const r = run(repo, ['backfill', '--pr', '--from-json', prs, '--cutoff', '2026-12-31T00:00:00Z']); assert.equal(r.code, 0, r.stderr);
  assert.equal(prDone(repo).raw ?? null, null);
  assert.ok(!readRaw(repo).lines.some(({ rec }) => JSON.stringify(rec).includes('Secret customer')), 'no record holds the text');
});

test('storeText false: a replay against records written with text SKIPs (no conflict); text is not erased; a structured change still conflicts', () => {
  const { repo, prs } = setup();
  assert.equal(run(repo, ['backfill', '--pr', '--from-json', prs, '--cutoff', '2026-12-31T00:00:00Z']).code, 0);
  profile(repo, { storeText: false });
  const again = run(repo, ['backfill', '--pr', '--from-json', prs, '--cutoff', '2026-12-31T00:00:00Z']);
  assert.equal(again.code, 0, again.stderr); assert.match(again.stdout, /BACKFILL events=0 skipped=1 conflicts=0/);
  assert.match(String(prDone(repo).raw), /Secret customer/, 'historical text stays');
  // Same PR, different merge time → a different fact: still a conflict, exactly as before.
  writeFileSync(prs, JSON.stringify([prRec(7, 'feat/era-m1', 'main', '2026-09-21T10:00:00Z', 'Secret customer name in title')]));
  const moved = run(repo, ['backfill', '--pr', '--from-json', prs, '--cutoff', '2026-12-31T00:00:00Z']);
  assert.notEqual(moved.code, 0); assert.match(moved.stdout + moved.stderr, /CONFLICT/);
});

test('storeText false: a retracted record is still revived (not skipped)', () => {
  const { repo, prs } = setup();
  assert.equal(run(repo, ['backfill', '--pr', '--from-json', prs]).code, 0);
  writeFileSync(prs, '[]'); assert.equal(run(repo, ['backfill', '--pr', '--from-json', prs]).code, 0);
  assert.equal(prDone(repo), undefined, 'retracted by reconciliation');
  profile(repo, { storeText: false });
  writeFileSync(prs, JSON.stringify([prRec(7, 'feat/era-m1', 'main', '2026-09-20T10:00:00Z', 'Secret customer name in title')]));
  const back = run(repo, ['backfill', '--pr', '--from-json', prs]);
  assert.equal(back.code, 0, back.stderr); assert.match(back.stdout, /BACKFILL events=1 /);
  assert.ok(prDone(repo)); assert.equal(prDone(repo).raw ?? null, null);
});

test('storeText false: CLI --note and --raw are refused; without them the event is recorded', () => {
  const { repo } = setup(); profile(repo, { storeText: false });
  for (const flag of ['--note', '--raw']) {
    const r = run(repo, ['event', 'T1.1', 'dispatched', flag, 'free text', '--id', `e${flag}`]);
    assert.equal(r.code, 2); assert.match(r.stderr, /^USAGE\(.*storeText/);
  }
  assert.equal(run(repo, ['event', 'T1.1', 'dispatched', '--id', 'e-ok']).code, 0);
});

test('default: CLI --note is stored (shipped behaviour)', () => {
  const { repo } = setup();
  assert.equal(run(repo, ['event', 'T1.1', 'dispatched', '--note', 'hello', '--id', 'e1']).code, 0);
  assert.ok(readRaw(repo).lines.some(({ rec }) => rec.meta?.note === 'hello'));
});
