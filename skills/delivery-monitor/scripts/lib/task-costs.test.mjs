import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../delivery.mjs';
import { snapshotFromTranscript } from './dispatches.mjs';
import { makeObservation } from './events.mjs';
import { attributeSpend } from './attribution.mjs';
import { collect } from './calibrate.mjs';
import { deliveryDir, runPath } from './paths.mjs';
import { spendReport } from './spend.mjs';
import { taskCosts, taskKey } from './task-costs.mjs';
import { runScenario } from '../../fixtures/task-costs-baseline/scenario.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const T = '2026-11-02T10:00:00.000Z', T2 = '2026-11-02T11:00:00.000Z', DONE = '2026-11-03T10:00:00.000Z';
const PRICES = { models: { m: { input: 1, output: 2, cache_write: 3, cache_read: 0.1 }, n: { input: 2, output: 4, cache_write: 6, cache_read: 0.2 } } };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} != ${b}`);
const tok = (m, usd) => Math.round(usd / PRICES.models[m].input * 1e6);
const U = (usd) => Object.fromEntries(Object.entries(typeof usd === 'number' ? { m: usd } : usd).map(([m, u]) => [m, { input: tok(m, u) }]));

async function cli(repo, args, { now = NOW } = {}) {
  let stdout = '', stderr = '';
  const code = await main(args, { repo, now, env: { DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '' }, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } });
  return { code, stdout, stderr };
}
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const planDoc = (campaign, run, missions) => ({ campaign_id: campaign, run_id: run, version: 1, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
  source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: campaign }, mission_kind: 'group', missions });
/** runs: [{ campaign, run, tasks: [ref | {ref, branch}], missions?: [...] }] */
async function fx(t, runs = [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2'] }]) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-tc-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@x'], ['config', 'user.name', 'Tester']]) git(repo, ...a);
  mkdirSync(deliveryDir(repo), { recursive: true });
  writeFileSync(join(deliveryDir(repo), 'prices.json'), JSON.stringify(PRICES));
  for (const [k, r] of runs.entries()) {
    const missions = r.missions ?? [{ ref: 'G1', sequence: 1, tasks: r.tasks.map((x) => (typeof x === 'string' ? { ref: x } : x)) }];
    const file = join(repo, `plan-${k}.md`);
    writeFileSync(file, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(planDoc(r.campaign, r.run, missions))}\n\`\`\`\n`);
    const res = await cli(repo, ['plan', 'register', '--from', file, '--id', `reg-${k}`, '--no-calibrate', '--no-bind', '--created-at', '2026-11-01T00:00:00Z']);
    assert.equal(res.code, 0, res.stderr);
  }
  const f = { repo, obs: [], snaps: [] };
  f.flush = () => {
    writeFileSync(join(deliveryDir(repo), 'events-t.jsonl'), f.obs.map((o) => JSON.stringify(o)).join('\n') + '\n');
    writeFileSync(join(deliveryDir(repo), 'dispatches-t.jsonl'), f.snaps.map((s) => JSON.stringify(s)).join('\n') + '\n');
  };
  f.run = (runId) => JSON.parse(readFileSync(runPath(repo, runId), 'utf8'));
  f.mutate = (runId, fn) => { const r = f.run(runId); fn(r); writeFileSync(runPath(repo, runId), JSON.stringify(r)); };
  f.itemId = (runId, ref) => f.run(runId).items.find((i) => i.ref === ref).item_id;
  return f;
}
const mk = (o) => makeObservation({ user: null, host: 'claude', basis: 'observed', level: 'task', ...o }, { now: NOW });
/** A hooked dispatch. refs: strings, {item_id, ref}, or null (unattributed). agent: null (old hook, no cost) or fields merged into the effort payload. */
function ledger(f, { run = 'sec/run-1', refs = ['T1'], id = 'a', usd = 2, usage, at = T, stage = 'build', agent, end = true, crossed } = {}) {
  const split = refs.length;
  const effort = agent === null ? {} : { usage: usage ?? U(usd), cost_usd: usd / split, split, ...(crossed ? { crossed } : {}), ...agent };
  for (const r of refs) {
    const one = r === null ? { item_id: null, ref: null, level: null } : typeof r === 'string' ? { item_id: f.itemId(run, r), ref: r } : r;
    const meta = { stage, version: 1, ...(r === null ? { unattributed: true } : {}) };
    const base = { ...one, plan: run, source: 'hook', source_record_id: `claude:s:${id}`, agentId: id };
    const tid = (ev) => `${one.item_id ?? 'unattributed'}/${ev}/${id}`;
    f.obs.push(mk({ ...base, event: 'dispatched', at, transition_id: tid('dispatched'), meta }));
    if (end) f.obs.push(mk({ ...base, event: 'dispatch_ended', at: new Date(Date.parse(at) + 600_000).toISOString(), transition_id: tid('dispatch_ended'), meta: { ...meta, agent: { turns: 10, ...effort } } }));
  }
}
/** A captured dispatch in the store; with a ledger id of the same value it is that dispatch's snapshot. */
function snap(f, { id = 'a', desc = 'T1', usd = 2, models, at = T, complete = true, follow, msg = '', branch = null } = {}) {
  const messages = Object.fromEntries(Object.entries(models ?? { m: usd }).map(([m, u], k) => [`x${k}`, { model: m, input: tok(m, u) }]));
  f.snaps.push(snapshotFromTranscript({ firstTs: at, lastRecordAt: at, records: 2, complete, last_uuid: 'u', messages, firstUserText: msg, branch, ...(follow ? { followUps: follow.map((text) => ({ at, text })) } : {}) },
    { session: 's', agent_id: id, description: desc, now: Date.parse(at) }));
}
const land = (f, run, ref, at = DONE) => f.obs.push(mk({ plan: run, item_id: f.itemId(run, ref), ref, event: 'done', at, source: 'cli', host: 'cli', source_record_id: `done-${run}-${ref}`, transition_id: `${f.itemId(run, ref)}/done/episode-1`, meta: { version: 1 } }));
const result = (f) => { f.flush(); return collect(f.repo, { now: NOW }); };
const costs = (f) => { f.flush(); return taskCosts(f.repo); };
const share = (tc, f, run, ref) => tc.tasks.get(taskKey(run, f.itemId(run, ref)))?.cost_usd ?? null;
const bySample = (r) => Object.fromEntries(r.samples.map((s) => [s.ref, s]));

// ---------- 1. owners and shares ----------
test('owners: a split-two ledger key gives two equal shares, equal to cost / split at current prices', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1', 'T2'], usd: 4 });
  const tc = costs(f);
  near(share(tc, f, 'sec/run-1', 'T1'), 2); near(share(tc, f, 'sec/run-1', 'T2'), 2);
});
test('owners: a key with allocations in two runs gives each task half', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1'] }, { campaign: 'sec', run: 'run-2', tasks: ['T1'] }]);
  const a = { item_id: f.itemId('sec/run-1', 'T1'), ref: 'T1' }, b = { item_id: f.itemId('sec/run-2', 'T1'), ref: 'T1' };
  ledger(f, { run: 'sec/run-1', refs: [a], usd: 2 }); ledger(f, { run: 'sec/run-2', refs: [b], usd: 2 });
  const tc = costs(f);
  near(share(tc, f, 'sec/run-1', 'T1'), 1); near(share(tc, f, 'sec/run-2', 'T1'), 1);
});
test('owners: a resumed key with an item allocation and a null allocation gives the item everything; a task plus a mission gives the task everything', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2'], missions: [{ ref: 'M1', sequence: 1, tasks: [{ ref: 'T1' }] }, { ref: 'M2', sequence: 2, tasks: [{ ref: 'T2' }] }] }]);
  ledger(f, { refs: ['T1', null], id: 'a', usd: 3 });
  const m1 = f.run('sec/run-1').items.find((i) => i.ref === 'M2');
  ledger(f, { refs: ['T2', { item_id: m1.item_id, ref: 'M2', level: 'mission' }], id: 'b', usd: 5 });
  const tc = costs(f);
  near(share(tc, f, 'sec/run-1', 'T1'), 3); near(share(tc, f, 'sec/run-1', 'T2'), 5);
});
test('owners: an allocation under a renamed id and one under the new id are one canonical owner', async (t) => {
  const f = await fx(t);
  const id = f.itemId('sec/run-1', 'T1');
  f.mutate('sec/run-1', (r) => { r.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-old': id } }; });
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-old', ref: 'T1' }, { item_id: id, ref: 'T1' }], usd: 4 });
  near(share(costs(f), f, 'sec/run-1', 'T1'), 4);
});
test('owners: a partly withdrawn key keeps only its active allocations', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1', 'T2'], usd: 4 });
  const gone = f.obs.filter((o) => o.event === 'dispatch_ended' && o.ref === 'T2')[0];
  f.obs.push({ ...gone, revision: 1, status: 'retracted' });
  const tc = costs(f);
  near(share(tc, f, 'sec/run-1', 'T1'), 4); assert.equal(share(tc, f, 'sec/run-1', 'T2'), null);
});
test('owners: a recovered key has the one task PR 2 names; heuristic evidence has no owner', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [{ ref: 'T1', branch: 'feat/t1' }, 'T2'] }]);
  snap(f, { id: 'r1', desc: 'T1', usd: 3 });
  snap(f, { id: 'r2', desc: 'nothing', usd: 7, branch: 'feat/t1' });   // branch-only
  snap(f, { id: 'r3', desc: 'nothing', usd: 11, msg: 'T2' });          // brief-only
  const tc = costs(f);
  near(share(tc, f, 'sec/run-1', 'T1'), 3); assert.equal(share(tc, f, 'sec/run-1', 'T2'), null);
  assert.deepEqual(tc.keys.filter((k) => k.owners.length).map((k) => k.dispatch_key), ['claude:s:r1']);
});

// ---------- 2. accounting ----------
test('accounting: every key is assigned at most its usd, all of it when it has owners; ownerless spend is the independent remainder', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3'] }]);
  ledger(f, { refs: ['T1', 'T2'], id: 'a', usd: 4 }); ledger(f, { refs: [null], id: 'b', usd: 2 });
  snap(f, { id: 'r1', desc: 'T3', usd: 3 }); snap(f, { id: 'r2', desc: 'nothing', usd: 5 });
  const tc = costs(f), base = spendReport(f.repo);
  for (const k of tc.keys) {
    assert.ok(k.assigned <= k.usd + 1e-9, k.dispatch_key);
    if (k.owners.length) near(k.assigned, k.usd, k.dispatch_key); else assert.equal(k.assigned, 0);
  }
  const assigned = [...tc.tasks.values()].reduce((n, x) => n + x.cost_usd, 0);
  near(tc.ownerless_usd, base.total_usd - assigned); assert.ok(tc.ownerless_usd >= 0);
  near(assigned, 4 + 3); near(tc.ownerless_usd, 7);
});

// ---------- 3. model vector ----------
test('model vector: the store side wins when its total is at least the ledger total; each vector sums to the key usd', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1'], id: 'a', usd: { m: 1 } }); snap(f, { id: 'a', desc: 'T1', models: { m: 1, n: 3 } });
  const tc = costs(f), k = tc.keys[0];
  near(k.usd, 4); near(Object.values(k.vector).reduce((a, b) => a + b, 0), k.usd);
  assert.deepEqual(Object.keys(k.vector).sort(), ['m', 'n']);
  land(f, 'sec/run-1', 'T1'); assert.equal(result(f).samples[0].model, 'n', 'the highest summed model');
});
test('model vector: the ledger side wins when larger; of several allocations the highest priced total, ties by lowest observation id', async (t) => {
  const f = await fx(t);
  ledger(f, { refs: ['T1'], id: 'a', usage: U({ m: 1 }) }); ledger(f, { refs: ['T2'], id: 'a', usage: U({ n: 3 }) });
  snap(f, { id: 'a', desc: 'T1', usd: 1 });
  let k = costs(f).keys[0]; near(k.usd, 3); assert.deepEqual(Object.keys(k.vector), ['n']); near(k.vector.n, 3);
  // tie on total: m $2 against n $2, the lower observation id wins
  const g = await fx(t);
  ledger(g, { refs: ['T1'], id: 'a', usage: U({ m: 2 }) }); ledger(g, { refs: ['T2'], id: 'a', usage: U({ n: 2 }) });
  const ends = g.obs.filter((o) => o.event === 'dispatch_ended').sort((x, y) => (x.observation_id < y.observation_id ? -1 : 1));
  k = costs(g).keys[0];
  assert.deepEqual(Object.keys(k.vector), [Object.keys(ends[0].meta.agent.usage)[0]]);
});
test('model vector: a sample model is the highest summed model, ties by name ascending', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1'], usd: 0, usage: { m: { input: 1e6 }, n: { input: 5e5 } } }); land(f, 'sec/run-1', 'T1');
  const s = result(f).samples[0]; near(s.cost_usd, 2); assert.equal(s.model, 'm');
});

// ---------- 4. completeness gaps ----------
test('gaps: a recovered build before a ledger review is not excluded; the reverse order is', async (t) => {
  const f = await fx(t);
  ledger(f, { refs: ['T1'], id: 'rv', stage: 'review', at: T2 }); snap(f, { id: 'bd', desc: 'T1 implement', at: T }); land(f, 'sec/run-1', 'T1');
  assert.deepEqual(result(f).samples.map((s) => s.ref), ['T1']);
  const g = await fx(t);
  ledger(g, { refs: ['T1'], id: 'bd', stage: 'build', at: T2 }); snap(g, { id: 'rv', desc: 'T1 review', at: T }); land(g, 'sec/run-1', 'T1');
  const r = result(g); assert.equal(r.samples.length, 0); assert.deepEqual(r.left_out, { 'first-dispatch-review-or-fix': 1 });
});
test('gaps: a recovered key whose snapshot is not complete leaves the task out as dispatch-not-ended', async (t) => {
  const f = await fx(t); snap(f, { desc: 'T1', complete: false }); land(f, 'sec/run-1', 'T1');
  assert.deepEqual(result(f).left_out, { 'dispatch-not-ended': 1 });
});
test('gaps: a hook-time unpriced model that current prices cover is included; a key unpriced now is excluded', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1'], usd: 2, agent: { unpriced_models: ['gone-model'] } }); land(f, 'sec/run-1', 'T1');
  assert.deepEqual(result(f).samples.map((s) => [s.ref, s.cost_usd]), [['T1', 2]]);
  const g = await fx(t); ledger(g, { refs: ['T1'], usage: { mystery: { input: 10 } } }); land(g, 'sec/run-1', 'T1');
  assert.deepEqual(result(g).left_out, { 'unpriced-model': 1 });
});
test('gaps: a follow-up naming a task of another run marks the owner and that task', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1'] }, { campaign: 'sec', run: 'run-2', tasks: ['B1'] }]);
  snap(f, { id: 'r1', desc: 'T1', follow: ['now do B1'] }); ledger(f, { run: 'sec/run-2', refs: ['B1'], id: 'b', usd: 1 });
  land(f, 'sec/run-1', 'T1'); land(f, 'sec/run-2', 'B1');
  const r = result(f); assert.equal(r.samples.length, 0); assert.deepEqual(r.left_out, { 'crossed-into-another-task': 2 });
});
test('gaps: text-incomplete on an owning recovered key leaves the task out', async (t) => {
  const f = await fx(t); snap(f, { desc: 'T1' }); land(f, 'sec/run-1', 'T1'); f.flush();
  const base = spendReport(f.repo), enriched = attributeSpend(f.repo, base);
  enriched.keys[0].attribution.flags = ['text-incomplete'];
  const tc = taskCosts(f.repo, { enriched });
  assert.ok(tc.marks.get(taskKey('sec/run-1', f.itemId('sec/run-1', 'T1'))).has('text-incomplete'));
});
test('gaps: branch-disagrees is allowed', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', { ref: 'T2', branch: 'feat/t2' }] }]);
  snap(f, { desc: 'T1', branch: 'feat/t2' }); land(f, 'sec/run-1', 'T1');
  assert.deepEqual(result(f).samples.map((s) => s.ref), ['T1']);
});
test('gaps: a cancelled competitor named in the description or the brief makes the attribution unstable', async (t) => {
  const f = await fx(t); snap(f, { desc: 'T1 T2' }); land(f, 'sec/run-1', 'T1');
  assert.equal(result(f).samples.length, 0, 'T1 T2 is ambiguous before the cancel: plan-level, no owner');
  f.mutate('sec/run-1', (r) => { r.items.find((i) => i.ref === 'T2').cancelled = true; });
  let r = result(f); assert.equal(r.samples.length, 0); assert.deepEqual(r.left_out, { 'attribution-unstable': 1 });
  const g = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [{ ref: 'T1', branch: 'feat/t1' }, 'T2'] }]);
  snap(g, { desc: 'nothing', msg: 'T1 T2', branch: 'feat/t1' }); land(g, 'sec/run-1', 'T1');
  assert.deepEqual(result(g).samples.map((s) => s.ref), ['T1'], 'brief-derived, branch-confirmed, nothing cancelled');
  g.mutate('sec/run-1', (x) => { x.items.find((i) => i.ref === 'T2').cancelled = true; });
  r = result(g); assert.deepEqual(r.left_out, { 'attribution-unstable': 1 });
});
test('gaps: a new item that disables a qualifier makes the attribution unstable', async (t) => {
  const f = await fx(t, [{ campaign: 'h0001-demo', run: 'run-1', tasks: [{ ref: 'T1', branch: 'feat/t1' }] }]);
  snap(f, { desc: 'H0001 T1', branch: 'feat/t1' }); land(f, 'h0001-demo/run-1', 'T1');
  assert.deepEqual(result(f).samples.map((s) => s.ref), ['T1']);
  f.mutate('h0001-demo/run-1', (r) => { r.items.push({ item_id: 'h0001-demo/run-1/task-h0001', ref: 'H0001', level: 'task' }); });
  assert.deepEqual(result(f).left_out, { 'attribution-unstable': 1 });
});

// ---------- 5b. crossing, missions, old ends ----------
test('crossing: a follow-up repeating an owner keeps both owners; one naming a third task excludes all three', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3'] }]);
  ledger(f, { refs: ['T1', 'T2'], id: 'a', usd: 4 }); snap(f, { id: 'a', desc: 'T1 T2', usd: 4, follow: ['continue with T1'] });
  land(f, 'sec/run-1', 'T1'); land(f, 'sec/run-1', 'T2');
  assert.deepEqual(result(f).samples.map((s) => s.ref).sort(), ['T1', 'T2']);
  const g = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3'] }]);
  ledger(g, { refs: ['T1', 'T2'], id: 'a', usd: 4 }); snap(g, { id: 'a', desc: 'T1 T2', usd: 4, follow: ['now T3'] }); ledger(g, { refs: ['T3'], id: 'c', usd: 1 });
  for (const r of ['T1', 'T2', 'T3']) land(g, 'sec/run-1', r);
  const r = result(g); assert.equal(r.samples.length, 0); assert.deepEqual(r.left_out, { 'crossed-into-another-task': 3 });
});
test('missions: M1 T1 is an owner pair before and attribution-unstable after M1 is cancelled', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [], missions: [{ ref: 'M1', sequence: 1, tasks: [{ ref: 'A1' }] }, { ref: 'M2', sequence: 2, tasks: [{ ref: 'T1', branch: 'feat/t1' }] }] }]);
  // description and brief variants
  snap(f, { id: 'd', desc: 'M1 T1', branch: 'feat/t1' }); land(f, 'sec/run-1', 'T1');
  assert.deepEqual(result(f).samples.map((s) => s.ref), ['T1']);
  f.mutate('sec/run-1', (r) => { r.items.find((i) => i.ref === 'M1').cancelled = true; });
  assert.deepEqual(result(f).left_out, { 'attribution-unstable': 1 });
  const g = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [], missions: [{ ref: 'M1', sequence: 1, tasks: [{ ref: 'A1' }] }, { ref: 'M2', sequence: 2, tasks: [{ ref: 'T1', branch: 'feat/t1' }] }] }]);
  snap(g, { id: 'b', desc: 'nothing', msg: 'M1 T1', branch: 'feat/t1' }); land(g, 'sec/run-1', 'T1');
  assert.deepEqual(result(g).samples.map((s) => s.ref), ['T1']);
  g.mutate('sec/run-1', (r) => { r.items.find((i) => i.ref === 'M1').cancelled = true; });
  assert.deepEqual(result(g).left_out, { 'attribution-unstable': 1 });
});
test('old ends: a hook end with no cost plus a priced store snapshot is a sample; the same without a snapshot is no-cost-recorded', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1'], id: 'a', agent: null }); snap(f, { id: 'a', desc: 'T1', usd: 2 }); land(f, 'sec/run-1', 'T1');
  const r = result(f); assert.deepEqual(r.samples.map((s) => [s.ref, s.cost_usd, s.cost_source]), [['T1', 2, 'ledger']]);
  const g = await fx(t); ledger(g, { refs: ['T1'], id: 'a', agent: null }); land(g, 'sec/run-1', 'T1');
  assert.deepEqual(result(g).left_out, { 'no-cost-recorded': 1 });
});

// ---------- samples and sources ----------
test('samples: cost_source says where a task cost came from; a task with no cost or zero cost is left out', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3', 'T4', 'T5'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 }); snap(f, { id: 'r', desc: 'T2', usd: 3 });
  ledger(f, { refs: ['T3'], id: 'b', usd: 1 }); snap(f, { id: 'r3', desc: 'T3', usd: 4 });
  ledger(f, { refs: ['T4'], id: 'z', usd: 0 });
  for (const r of ['T1', 'T2', 'T3', 'T4', 'T5']) land(f, 'sec/run-1', r);
  const r = result(f), s = bySample(r);
  assert.deepEqual([s.T1.cost_source, s.T2.cost_source, s.T3.cost_source], ['ledger', 'recovered', 'both']);
  near(s.T3.cost_usd, 5); assert.deepEqual(r.left_out, { 'no-cost-recorded': 1, 'zero-cost': 1 });
  const cal = JSON.parse((await cli(f.repo, ['calibrate', '--dry-run', '--json'])).stdout);
  assert.deepEqual(cal.samples_by_source, { ledger: 1, recovered: 1, both: 1 });
});

// ---------- 5. commands ----------
const bad = (f) => { writeFileSync(join(deliveryDir(f.repo), 'plans', 'broken.json'), '{ not json'); };
const tableOf = (f) => { const p = join(deliveryDir(f.repo), 'calibration.json'); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
async function landed(t) { const f = await fx(t); ledger(f, { refs: ['T1'], usd: 2 }); land(f, 'sec/run-1', 'T1'); f.flush(); return f; }
test('commands: calibrate exits 2 with ATTRIBUTION-UNAVAILABLE and writes nothing (plain, --json, --dry-run)', async (t) => {
  const f = await landed(t); bad(f);
  for (const args of [['calibrate'], ['calibrate', '--json'], ['calibrate', '--dry-run']]) {
    const r = await cli(f.repo, args);
    assert.equal(r.code, 2, args.join(' ')); assert.match(r.stderr, /^ATTRIBUTION-UNAVAILABLE\(/); assert.equal(r.stdout, ''); assert.equal(tableOf(f), null);
  }
});
test('commands: no samples is exit 3 as today', async (t) => {
  const f = await fx(t); ledger(f, { refs: ['T1'], usd: 2 }); f.flush();
  const r = await cli(f.repo, ['calibrate']); assert.equal(r.code, 3); assert.match(r.stderr, /NO-EVENTS\(no landed task yet/);
});
test('commands: register keeps the saved table and warns once when attribution is unavailable', async (t) => {
  const f = await landed(t); assert.equal((await cli(f.repo, ['calibrate'])).code, 0);
  const before = tableOf(f); bad(f);
  const file = join(f.repo, 'p2.md'); writeFileSync(file, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(planDoc('sec', 'run-9', [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'N1' }] }]))}\n\`\`\`\n`);
  const r = await cli(f.repo, ['plan', 'register', '--from', file, '--id', 'reg-9', '--no-bind', '--created-at', '2026-11-01T00:00:00Z']);
  assert.equal(tableOf(f), before, 'table kept');
  assert.equal(r.stderr.match(/WARN ATTRIBUTION-UNAVAILABLE/g)?.length, 1, r.stderr);
  assert.equal(r.code, 0, r.stderr);
});
test('commands: status prints the no-table lines, and an invalid line when attribution or prices fail', async (t) => {
  const none = await fx(t); ledger(none, { refs: ['T1'], usd: 2 }); none.flush();
  assert.match((await cli(none.repo, ['status'])).stdout, /^CALIBRATION none: no priced landed task yet$/m);
  const f = await landed(t);
  let r = await cli(f.repo, ['status']); assert.equal(r.code, 0); assert.match(r.stdout, /^CALIBRATION none: not built yet: run plan register or calibrate$/m);
  writeFileSync(join(deliveryDir(f.repo), 'prices.json'), '{ nope');
  r = await cli(f.repo, ['status']); assert.equal(r.code, 0); assert.match(r.stdout, /^CALIBRATION invalid: PRICES-INVALID\(/m);
  writeFileSync(join(deliveryDir(f.repo), 'prices.json'), JSON.stringify(PRICES)); bad(f);
  r = await cli(f.repo, ['status']); assert.equal(r.code, 0); assert.match(r.stdout, /^CALIBRATION invalid: ATTRIBUTION-UNAVAILABLE\(/m);
});
test('commands: an empty ledger and zero plans fail as before', async (t) => {
  const f = await fx(t, []);
  assert.equal((await cli(f.repo, ['calibrate'])).code, 3);
  const r = await cli(f.repo, ['status']); assert.equal(r.code, 3);
});

test('report, spend and plan output is byte-identical to the baseline produced before this change', async () => {
  const baseline = JSON.parse(readFileSync(new URL('../../fixtures/task-costs-baseline/golden.json', import.meta.url), 'utf8'));
  const got = await runScenario({ main, makeObservation, snapshotFromTranscript });
  assert.deepEqual(got.register, baseline.register);
  baseline.reads.forEach((want, i) => assert.deepEqual(got.reads[i], want, want.argv.join(' ')));
  assert.deepEqual(got, baseline);
});
