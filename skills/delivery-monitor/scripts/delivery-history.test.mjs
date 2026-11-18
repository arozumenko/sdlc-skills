import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './delivery.mjs';
import { deliveryDir, runPath, sessionPath, sessionsDir } from './lib/paths.mjs';
import { saveRun } from './lib/plan.mjs';
import { runScenario } from '../fixtures/history-baseline/scenario.mjs';

const BASELINE = JSON.parse(readFileSync(new URL('../fixtures/history-baseline/golden.json', import.meta.url), 'utf8'));

const T0 = Date.parse('2026-09-16T10:00:00Z');
const iso = (t) => new Date(t).toISOString();
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const initRepo = () => { const r = mkdtempSync(join(tmpdir(), 'dm-histcli-')); git(r, 'init', '-q', '-b', 'main'); git(r, 'config', 'user.email', 't@x'); git(r, 'config', 'user.name', 'Tester'); return r; };
const HIST = (repo) => join(deliveryDir(repo), 'history-tester.jsonl');
const lines = (repo) => { try { return readFileSync(HIST(repo), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const cli = async (repo, argv, { now = T0, env = {} } = {}) => {
  let stdout = '', stderr = '';
  const code = await main(argv, { repo, now, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, env: { DELIVERY_NO_SYNC: '1', ...env } });
  return { code, stdout, stderr };
};
const plan = (v = 1) => ({
  campaign_id: 'demo', run_id: 'run-1', version: v, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
  source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'demo' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', branch: 'task/task-001' }, { ref: 'TASK-002' }] }],
});
const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const S1 = { CLAUDE_CODE_SESSION_ID: 's1' };
const RUN = 'demo/run-1';
const summaryOf = (o) => ({ status: o.status, version: o.version, registered_at: o.registered_at, updated_at: o.updated_at });

test('G1/G2: writers each append one record with kind, key, by, prev and next; no-op writes keep pre-write timestamps in prev', async () => {
  const repo = initRepo(); const f = writePlan(repo, plan());
  let r = await cli(repo, ['plan', 'register', '--from', f, '--id', 'reg-1'], { env: S1 });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stderr, '');
  let l = lines(repo);
  assert.deepEqual(l.map((x) => [x.kind, x.key, x.by, x.prev.state]), [['run', RUN, 'register', 'missing'], ['session', 'claude:s1', 'register', 'missing']]);
  assert.deepEqual(l[0].next, { status: 'open', version: 1, registered_at: iso(T0), updated_at: iso(T0) });
  assert.deepEqual(l[1].next, { plan: RUN, at: iso(T0) });
  assert.ok(l.every((x) => x.v === 'history.v1' && x.recorded_at === iso(T0) && Object.keys(x).join() === 'v,kind,key,by,recorded_at,prev,next'));

  // new version, same-plan rebind (a no-op write)
  const T1 = T0 + 3600e3;
  r = await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan(2)), '--id', 'reg-2', '--at', iso(T1)], { now: T1, env: S1 });
  assert.equal(r.code, 0, r.stderr);
  l = lines(repo).slice(2);
  assert.deepEqual(l.map((x) => [x.kind, x.by]), [['run', 'register'], ['session', 'register']]);
  assert.deepEqual(l[0].prev.value, { status: 'open', version: 1, registered_at: iso(T0), updated_at: iso(T0) });
  assert.deepEqual(l[0].next, { status: 'open', version: 2, registered_at: iso(T0), updated_at: iso(T1) });
  assert.deepEqual(l[1].prev, { state: 'present', value: { plan: RUN, at: iso(T0) } }, 'a rebind to the same plan keeps the old at in prev');
  assert.deepEqual(l[1].next, { plan: RUN, at: iso(T1) });

  // close, repeated close
  const T2 = T1 + 3600e3, T3 = T2 + 3600e3;
  assert.equal((await cli(repo, ['plan', 'close', RUN], { now: T2 })).code, 0);
  assert.equal((await cli(repo, ['plan', 'close', RUN], { now: T3 })).code, 0);
  l = lines(repo).slice(4);
  assert.deepEqual(l.map((x) => [x.kind, x.key, x.by]), [['run', RUN, 'close'], ['run', RUN, 'close']]);
  assert.equal(l[0].prev.value.status, 'open'); assert.equal(l[0].next.status, 'closed');
  assert.deepEqual([l[1].prev.value.status, l[1].prev.value.updated_at, l[1].next.updated_at], ['closed', iso(T2), iso(T3)]);

  // reopen by registering a later version
  const T4 = T3 + 3600e3;
  r = await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan(3)), '--id', 'reg-3', '--at', iso(T4)], { now: T4, env: S1 });
  assert.equal(r.code, 0, r.stderr);
  l = lines(repo).slice(6);
  assert.deepEqual([l[0].prev.value.status, l[0].next.status, l[0].next.version], ['closed', 'open', 3]);
  assert.equal(l.length, 2);
});

test('G1: session set appends a session record with by session_set and no bound_by', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  assert.equal(lines(repo).length, 1, 'only the run record: the caller session is unknown, so nothing is bound');
  const r = await cli(repo, ['session', 'set', '--host', 'claude', '--session', 's9', '--plan', RUN], { now: T0 + 1000 });
  assert.equal(r.code, 0, r.stderr);
  const rec = lines(repo)[1];
  assert.deepEqual(rec, { v: 'history.v1', kind: 'session', key: 'claude:s9', by: 'session_set', recorded_at: iso(T0 + 1000), prev: { state: 'missing' }, next: { plan: RUN, at: iso(T0 + 1000) } });
  assert.equal(readFileSync(sessionPath(repo, 'claude', 's9'), 'utf8'), `{"host":"claude","session":"s9","plan":"${RUN}","at":"${iso(T0 + 1000)}"}\n`);
});

test('G1: an identical retry appends one session record by retry and no run record', async () => {
  const repo = initRepo(); const f = writePlan(repo, plan());
  await cli(repo, ['plan', 'register', '--from', f, '--id', 'reg-1'], { env: S1 });
  const before = lines(repo).length;
  const r = await cli(repo, ['plan', 'register', '--from', f, '--id', 'reg-1'], { now: T0 + 1000, env: { CLAUDE_CODE_SESSION_ID: 's2' } });
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /\(retry\)/);
  const added = lines(repo).slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual([added[0].kind, added[0].key, added[0].by, added[0].prev.state], ['session', 'claude:s2', 'retry', 'missing']);
});

test('G1/G2: roster and backfill each append one run record (backfill_at set); backfill --dry-run appends none; timestamps in prev stay', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
  const head = git(repo, 'rev-parse', 'HEAD');
  for (const a of ['js-dev', 'tech-lead']) { const d = join(repo, '.claude', 'agents', a); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), '# a\n'); }
  const T1 = T0 + 3600e3, T2 = T1 + 3600e3, T3 = T2 + 3600e3;
  let r = await cli(repo, ['plan', 'roster', '--plan', RUN, '--agents', 'js-dev,tech-lead'], { now: T1 });
  assert.equal(r.code, 0, r.stderr);
  r = await cli(repo, ['backfill', '--git', '--head', head, '--cutoff', '2026-12-31T00:00:00Z', '--dry-run'], { now: T2 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lines(repo).length, 2, 'dry-run appends nothing');
  r = await cli(repo, ['backfill', '--git', '--head', head, '--cutoff', '2026-12-31T00:00:00Z'], { now: T2 });
  assert.equal(r.code, 0, r.stderr);
  r = await cli(repo, ['backfill', '--git', '--head', head, '--cutoff', '2026-12-31T00:00:00Z'], { now: T3 });
  assert.equal(r.code, 0, r.stderr);
  const l = lines(repo).slice(1);
  assert.deepEqual(l.map((x) => [x.kind, x.key, x.by]), [['run', RUN, 'roster'], ['run', RUN, 'backfill'], ['run', RUN, 'backfill']]);
  assert.equal(l[0].prev.value.updated_at, iso(T0)); assert.equal(l[0].next.updated_at, iso(T1));
  assert.equal('backfill_at' in l[0].prev.value, false);
  assert.equal(l[1].next.backfill_at, iso(T2)); assert.equal(l[1].prev.value.updated_at, iso(T1));
  assert.equal(l[2].prev.value.backfill_at, iso(T2)); assert.equal(l[2].next.backfill_at, iso(T3));
});

test('G3/G4: first overwrite of a pre-history file freezes its old values; a corrupt file is unreadable; a new file is missing', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  // A run file and a session file written by an older version: no history exists for them.
  const rec = JSON.parse(readFileSync(runPath(repo, RUN), 'utf8')); rec.registered_at = '2026-01-01T00:00:00.000Z'; rec.updated_at = '2026-01-02T00:00:00.000Z';
  saveRun(repo, rec);
  mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, 'claude', 'old'), `${JSON.stringify({ host: 'claude', session: 'old', plan: RUN, at: '2026-01-03T00:00:00.000Z' })}\n`);
  writeFileSync(sessionPath(repo, 'claude', 'bad'), '{oops');
  const T1 = T0 + 1000;
  await cli(repo, ['plan', 'close', RUN], { now: T1 });
  await cli(repo, ['session', 'set', '--host', 'claude', '--session', 'old', '--plan', RUN], { now: T1 });
  await cli(repo, ['session', 'set', '--host', 'claude', '--session', 'bad', '--plan', RUN], { now: T1 });
  const l = lines(repo).slice(1);
  assert.deepEqual(l[0].prev.value, { status: 'open', version: 1, registered_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(l[1].prev.value, { plan: RUN, at: '2026-01-03T00:00:00.000Z' });
  assert.deepEqual(l[2].prev, { state: 'unreadable' });
  assert.ok(!('value' in l[2].prev));
});

test('G5: a state-write failure writes no record and keeps the existing error (exit 1, no history warning)', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const before = lines(repo).length;
  writeFileSync(sessionsDir(repo), 'a regular file where the sessions dir should be');
  const r = await cli(repo, ['session', 'set', '--host', 'claude', '--session', 's1', '--plan', RUN]);
  assert.equal(r.code, 1); assert.match(r.stderr, /^INTERNAL\(/); assert.doesNotMatch(r.stderr, /WARN history/);
  assert.equal(r.stdout, '');
  assert.equal(lines(repo).length, before);
});

test('G6: an append failure leaves the state write, stdout and exit alone and adds one WARN line', async () => {
  const control = initRepo(), broken = initRepo();
  for (const repo of [control, broken]) await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  rmSync(HIST(broken)); mkdirSync(HIST(broken));
  const argv = ['session', 'set', '--host', 'claude', '--session', 's1', '--plan', RUN];
  const a = await cli(control, argv), b = await cli(broken, argv);
  assert.equal(b.code, a.code); assert.equal(b.stdout, a.stdout); assert.equal(a.stderr, '');
  assert.match(b.stderr, /^WARN history not recorded: .+\n$/);
  assert.equal(b.stderr.split('\n').filter(Boolean).length, 1);
  assert.equal(readFileSync(sessionPath(broken, 'claude', 's1'), 'utf8'), readFileSync(sessionPath(control, 'claude', 's1'), 'utf8'));
});

test('G6: several failed appends in one command print the WARN once; plan register with a later ID-CONFLICT still exits 2, logs the run record and warns', async () => {
  // Seed a conflicting observation: same registration token and items, different time.
  const seed = initRepo();
  await cli(seed, ['plan', 'register', '--from', writePlan(seed, plan()), '--id', 'reg-1'], { now: T0 - 86400e3 });
  const events = readFileSync(join(deliveryDir(seed), 'events-tester.jsonl'), 'utf8');
  const arrange = () => { const repo = initRepo(); mkdirSync(deliveryDir(repo), { recursive: true }); writeFileSync(join(deliveryDir(repo), 'events-seed.jsonl'), events); return repo; };

  const ok = arrange();
  const r1 = await cli(ok, ['plan', 'register', '--from', writePlan(ok, plan()), '--id', 'reg-1'], { env: S1 });
  assert.equal(r1.code, 2); assert.match(r1.stderr, /^ID-CONFLICT\(/); assert.doesNotMatch(r1.stderr, /WARN history/);
  assert.deepEqual(lines(ok).map((x) => [x.kind, x.by]), [['run', 'register']], 'the run was saved and logged before the conflict; nothing is bound');

  const bad = arrange(); mkdirSync(HIST(bad), { recursive: true });
  const r2 = await cli(bad, ['plan', 'register', '--from', writePlan(bad, plan()), '--id', 'reg-1'], { env: S1 });
  assert.equal(r2.code, 2); assert.equal(r2.stdout, r1.stdout);
  const err = r2.stderr.split('\n').filter(Boolean);
  assert.equal(err.length, 2); assert.match(err[0], /^ID-CONFLICT\(/); assert.match(err[1], /^WARN history not recorded: /);
  assert.ok(existsSync(runPath(bad, RUN)));

  // register's two writes (run, then bind) both fail to log: still one line
  const both = initRepo(); mkdirSync(HIST(both), { recursive: true });
  const r3 = await cli(both, ['plan', 'register', '--from', writePlan(both, plan()), '--id', 'reg-1'], { env: S1 });
  assert.equal(r3.code, 0); assert.equal(r3.stderr.split('\n').filter((x) => x.startsWith('WARN history')).length, 1);
});

test('G8: session and run files have no new keys and exact bytes', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1'], { env: S1 });
  assert.equal(readFileSync(sessionPath(repo, 'claude', 's1'), 'utf8'), `{"host":"claude","session":"s1","plan":"${RUN}","at":"${iso(T0)}"}\n`);
  const text = readFileSync(runPath(repo, RUN), 'utf8'), obj = JSON.parse(text);
  assert.equal(text, `${JSON.stringify(obj, null, 2)}\n`);
  assert.deepEqual(Object.keys(obj), ['run', 'campaign_id', 'run_id', 'version', 'factory', 'status', 'registered_at', 'updated_at', 'observation_start', 'source_epoch', 'mission_kind', 'branch_map', 'branch_prefix', 'source', 'canonical_sha256', 'roster', 'import', 'supersedes', 'items', 'versions', 'requests']);
  // The file on disk equals what it would be with history disabled (compare with a direct, history-free save).
  const copy = initRepo(); saveRun(copy, obj);
  assert.equal(readFileSync(runPath(copy, RUN), 'utf8'), text);
});

test('G8: state files, writer output and read-command output equal the baseline recorded before history existed', async () => {
  let records = 0;
  const got = await runScenario(main, { between: (dir) => { records = readFileSync(join(dir, 'history-tester.jsonl'), 'utf8').split('\n').filter(Boolean).length; } });
  assert.equal(records, 7, 'the scenario exercised the history writers: register x2 (run + bind), roster, close, session set');
  for (const name of Object.keys(BASELINE.files)) assert.equal(got.files[name], BASELINE.files[name], name);
  for (const kind of ['writes', 'reads']) BASELINE[kind].forEach((want, i) => assert.deepEqual(got[kind][i], want, `${kind}: ${want.argv}`));
  assert.deepEqual(got, BASELINE);
});

test('G8: read commands print the baseline output when the history file is gone', async () => {
  const got = await runScenario(main, { between: (dir) => rmSync(join(dir, 'history-tester.jsonl')) });
  BASELINE.reads.forEach((want, i) => assert.deepEqual(got.reads[i], want, want.argv));
});

test('G9: history snapshot appends one by-snapshot record per file with no prev; output lines; unreadable file skipped', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1'], { env: S1 });
  writeFileSync(sessionPath(repo, 'claude', 'bad'), '{oops');
  const before = lines(repo).length;
  const r = await cli(repo, ['history', 'snapshot'], { now: T0 + 1000 });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stderr, '');
  assert.equal(r.stdout, 'SKIP session claude:bad unreadable\nSNAPSHOT session claude:s1\nSNAPSHOT run demo/run-1\nHISTORY snapshot sessions=1 runs=1 skipped=1\n');
  const added = lines(repo).slice(before);
  assert.deepEqual(added.map((x) => [x.kind, x.key, x.by, 'prev' in x]), [['session', 'claude:s1', 'snapshot', false], ['run', RUN, 'snapshot', false]]);
  assert.equal(added[0].recorded_at, iso(T0 + 1000));
  assert.deepEqual(added[1].next, { status: 'open', version: 1, registered_at: iso(T0), updated_at: iso(T0) });
  // not idempotent: a second run appends the same observations again
  await cli(repo, ['history', 'snapshot']);
  assert.equal(lines(repo).length, before + 4);
});

test('G9: history snapshot --dry-run writes nothing and ends with DRY-RUN; other sub-commands are USAGE; an append failure exits non-zero', async () => {
  const repo = initRepo();
  await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1'], { env: S1 });
  const before = readFileSync(HIST(repo), 'utf8');
  const d = await cli(repo, ['history', 'snapshot', '--dry-run']);
  assert.equal(d.code, 0); assert.equal(d.stdout, 'WOULD-SNAPSHOT session claude:s1\nWOULD-SNAPSHOT run demo/run-1\nHISTORY snapshot sessions=1 runs=1 skipped=0\nDRY-RUN not written\n');
  assert.equal(readFileSync(HIST(repo), 'utf8'), before);
  for (const argv of [['history'], ['history', 'list'], ['history', 'snapshot-all']]) { const u = await cli(repo, argv); assert.equal(u.code, 2, argv.join(' ')); assert.match(u.stderr, /^USAGE\(/); }
  rmSync(HIST(repo)); mkdirSync(HIST(repo));
  const f = await cli(repo, ['history', 'snapshot']);
  assert.notEqual(f.code, 0);
  const empty = initRepo();
  const e = await cli(empty, ['history', 'snapshot']);
  assert.equal(e.stdout, 'HISTORY snapshot sessions=0 runs=0 skipped=0\n');
  // Only a missing directory counts as empty: a sessions path that cannot be listed fails the command.
  mkdirSync(deliveryDir(empty), { recursive: true }); writeFileSync(sessionsDir(empty), 'a regular file where the sessions dir should be');
  const x = await cli(empty, ['history', 'snapshot']);
  assert.notEqual(x.code, 0); assert.doesNotMatch(x.stdout, /HISTORY snapshot/);
});

test('G11: with a telemetry git repo and sync on, a mutating command leaves history-<slug>.jsonl committed', async () => {
  const repo = initRepo(); const tel = join(repo, '.agents', 'telemetry'); mkdirSync(tel, { recursive: true });
  git(tel, 'init', '-q', '-b', 'main'); git(tel, 'config', 'user.email', 't@x'); git(tel, 'config', 'user.name', 'Tester');
  const env = { DELIVERY_NO_SYNC: '0', ...S1 };
  const r = await cli(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1'], { env });
  assert.equal(r.code, 0, r.stderr); assert.doesNotMatch(r.stderr, /WARN sync/);
  assert.match(git(tel, 'ls-files'), /delivery\/history-tester\.jsonl/);
  assert.equal(git(tel, 'status', '--porcelain'), '');
  assert.match(git(tel, 'show', 'HEAD:delivery/history-tester.jsonl'), /"by":"register"/);
});
