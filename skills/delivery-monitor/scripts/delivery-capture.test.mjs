import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './delivery.mjs';
import { deliveryDir, profilePath } from './lib/paths.mjs';
import { saveRun } from './lib/plan.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const temp = () => mkdtempSync(join(tmpdir(), 'dm-capture-cli-'));
async function run(repo, argv, options = {}) {
  let stdout = '', stderr = '';
  const env = { DELIVERY_NO_SYNC: '1', CLAUDE_CONFIG_DIR: join(repo, 'claude-config') };
  const code = await main(argv, { repo, now: NOW, env, stdout: { write(s) { stdout += s; } }, stderr: { write(s) { stderr += s; } }, ...options });
  return { code, stdout, stderr };
}
function snapshot(id, at = '2026-11-17T00:00:00Z') {
  return { v: 'dispatch.v1', dispatch_key: `claude:s1:${id}`, session: 's1', agent_id: id, agent_type: null,
    started_at: at, last_at: at, complete: true, torn: false, last_uuid: id, stage: 'other', branch: null,
    refs: { desc: [], msg: [], truncated: false }, follow_ups: [], records: 1,
    messages: { [id]: { model: 'claude-sonnet-4-6', input: 1_000_000, output: 0, cache_write: 0, cache_write_1h: 0, cache_read: 0 } },
    anon: { records: 0, usage: {} }, capture: 'hook', captured_at: '2026-11-18T00:00:00Z', writer: { kind: 'hook', pid: 1 } };
}
function store(repo, records) {
  mkdirSync(deliveryDir(repo), { recursive: true });
  const path = join(deliveryDir(repo), 'dispatches-test.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}
function emptyPlan(repo) {
  saveRun(repo, { run: 'test/run-1', version: 1, status: 'open', items: [], versions: [], observation_start: '2026-11-01T00:00:00Z', source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' } });
}

test('spend works globally with zero plans and plans without observations', async () => {
  const repo = temp(); store(repo, [snapshot('a')]);
  for (const withPlan of [false, true]) {
    if (withPlan) emptyPlan(repo);
    const r = await run(repo, ['spend', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const d = JSON.parse(r.stdout);
    assert.equal(d.total_usd, 3);
    assert.deepEqual(d.by_class['not-in-ledger'], { usd: 3, count: 1 });
    assert.equal(Object.values(d.by_class).reduce((n, c) => n + c.usd, 0), d.total_usd);
    assert.equal(d.unattributed_share, 1);
  }
  const text = await run(repo, ['spend']);
  assert.match(text.stdout, /spend of dispatches started in/i);
  assert.match(text.stdout, /FLAG/);
});

test('spend cohort is inclusive at since, exclusive at until; unknown starts are all-time only', async () => {
  const repo = temp();
  store(repo, [snapshot('before', '2026-11-09T00:00:00Z'), snapshot('from', '2026-11-10T00:00:00Z'), snapshot('end', '2026-11-11T00:00:00Z'), snapshot('unknown', null)]);
  const window = await run(repo, ['spend', '--since', '2026-11-10', '--until', '2026-11-11', '--json']);
  assert.equal(window.code, 0, window.stderr);
  assert.equal(JSON.parse(window.stdout).total_usd, 3);
  assert.equal(JSON.parse((await run(repo, ['spend', '--json'])).stdout).total_usd, 12);
  assert.equal(JSON.parse((await run(temp(), ['spend', '--json'])).stdout).unattributed_share, null);
});

test('spend validates window values and ordering as USAGE', async () => {
  for (const flags of [['--since'], ['--until'], ['--since', 'yesterday'], ['--since', '2026-11-12', '--until', '2026-11-11']]) {
    const r = await run(temp(), ['spend', ...flags]);
    assert.equal(r.code, 2, r.stderr); assert.match(r.stderr, /^USAGE\((?:--since|--until|invalid --|since)/);
  }
});

test('status keeps NO-PLAN and NO-EVENTS exit codes and adds the seven day spend line', async () => {
  for (const withPlan of [false, true]) {
    const repo = temp(); if (withPlan) emptyPlan(repo);
    store(repo, [snapshot('inside'), snapshot('lower', '2026-11-11T12:00:00Z'), snapshot('old', '2026-11-11T11:59:59Z'), snapshot('upper', '2026-11-18T12:00:00Z')]);
    const r = await run(repo, ['status']);
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, withPlan ? /^NO-EVENTS/ : /^NO-PLAN/);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /SPEND.*total_usd=6(?:\.0+)?(?:\D|$)/);
  }
});

test('retract --dispatch requires reason, works without a plan, and is permanent', async () => {
  const repo = temp(), first = snapshot('a'), path = store(repo, [first]);
  const before = readFileSync(path, 'utf8');
  const dry = await run(repo, ['retract', '--dispatch', first.dispatch_key, '--reason', 'wrong source', '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr); assert.match(dry.stdout, /WOULD-RETRACT/);
  assert.equal(readFileSync(path, 'utf8'), before);
  const missing = await run(repo, ['retract', '--dispatch', first.dispatch_key]);
  assert.equal(missing.code, 2); assert.match(missing.stderr, /^USAGE/);
  const r = await run(repo, ['retract', '--dispatch', first.dispatch_key, '--reason', 'wrong source']);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /RETRACT/);
  appendFileSync(path, JSON.stringify({ ...first, records: 2 }) + '\n');
  assert.equal(JSON.parse((await run(repo, ['spend', '--json'])).stdout).total_usd, 0);
});

test('dispatch retraction selectors and backfill modes are exclusive', async () => {
  for (const args of [['retract', '--dispatch', 'claude:s1:a', '--agent', 'a', '--reason', 'x'], ['backfill', '--transcripts', '--git'], ['backfill', '--transcripts', '--pr']]) {
    const r = await run(temp(), args); assert.equal(r.code, 2); assert.match(r.stderr, /^USAGE/);
  }
});

test('transcript backfill works without a plan and prints all recovery counters', async () => {
  const repo = temp();
  const r = await run(repo, ['backfill', '--transcripts', '--since', '2026-11-01', '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^BACKFILL children=0 ingested=0 unchanged=0 tombstoned=0 unidentified=0 unreadable=0 failed=0 parents=0 interrupted=0 no-child=0$/m);
});

test('doctor coverage is count-only, read-only, and exits zero', async () => {
  const repo = temp(), path = store(repo, [snapshot('a'), { v: 'dispatch.v1', dispatch_key: 'claude:s1:lost', gap: true, at: '2026-11-18T00:00:00Z' }]);
  const before = readFileSync(path, 'utf8'), files = readdirSync(deliveryDir(repo));
  const r = await run(repo, ['doctor']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /coverage: identities=0 in_store=\d+ missing_from_store=0 gaps_resolved=0 gaps_unresolved=1 interrupted=0 unreadable_children=0 oldest_transcript_date=/);
  assert.doesNotMatch(r.stdout, /claude:s1:lost/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.deepEqual(readdirSync(deliveryDir(repo)), files);
});

test('captureRefs and captureBranch profile switches are booleans and default true', async () => {
  const repo = temp(), file = join(repo, 'profile.json');
  writeFileSync(file, JSON.stringify({ captureRefs: false, captureBranch: false }));
  const r = await run(repo, ['profile', 'set', '--from', file]);
  assert.equal(r.code, 0, r.stderr);
  const profile = JSON.parse(readFileSync(profilePath(repo), 'utf8'));
  assert.equal(profile.captureRefs, false); assert.equal(profile.captureBranch, false);
  for (const key of ['captureRefs', 'captureBranch']) {
    writeFileSync(file, JSON.stringify({ [key]: 'false' }));
    const bad = await run(repo, ['profile', 'set', '--from', file]);
    assert.equal(bad.code, 2); assert.match(bad.stderr, /must be boolean/);
  }
  writeFileSync(file, '{}');
  assert.equal((await run(repo, ['profile', 'set', '--from', file])).code, 0);
  const defaults = JSON.parse(readFileSync(profilePath(repo), 'utf8'));
  assert.equal(defaults.captureRefs, true); assert.equal(defaults.captureBranch, true);
});

test('status spend failure preserves NO-PLAN and NO-EVENTS errors', async () => {
 for(const withPlan of [false,true]) {
   const repo=temp(); if(withPlan) emptyPlan(repo);
   mkdirSync(join(deliveryDir(repo),'dispatches-unreadable.jsonl'),{recursive:true});
   const r=await run(repo,['status']);
   assert.equal(r.code,3); assert.match(r.stderr,withPlan ? /^NO-EVENTS/ : /^NO-PLAN/);
   assert.match(r.stdout,/SPEND unavailable:/);
 }
});
