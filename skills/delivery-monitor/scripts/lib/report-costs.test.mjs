// The report's task costs (spec PR 3b): one bounded task-cost projection per report, estimate quality as effort bands, per-plan
// cost lines, and the error boundary around attribution. Test numbers in names are the spec's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../delivery.mjs';
import { loadRunsChecked } from './attribution.mjs';
import { snapshotFromTranscript } from './dispatches.mjs';
import { makeObservation } from './events.mjs';
import { deliveryDir, runPath } from './paths.mjs';
import { costView, taskCosts, taskKey } from './task-costs.mjs';
import { resolveObservations } from './events.mjs';
import { selectOccurrences } from './timeline.mjs';
import { assemble } from './report.mjs';
import { estimateBands } from './metrics.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const T = '2026-11-02T10:00:00.000Z', DONE = '2026-11-03T10:00:00.000Z';
const PRICES = { as_of: '2026-11-01', models: { m: { input: 1, output: 2, cache_write: 3, cache_read: 0.1 } } };
const tok = (usd) => Math.round(usd * 1e6);

async function cli(repo, args, { now = NOW } = {}) {
  let stdout = '', stderr = '';
  const code = await main(args, { repo, now, env: { DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '' }, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } });
  return { code, stdout, stderr };
}
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const planDoc = (campaign, run, missions) => ({ campaign_id: campaign, run_id: run, version: 1, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
  source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: campaign }, mission_kind: 'group', missions });
/** runs: [{ campaign, run, tasks: [ref | {ref, class, estimate, ...}] }] */
async function fx(t, runs = [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2'] }]) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-rc-'));
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
const plus = (at, ms) => new Date(Date.parse(at) + ms).toISOString();
/** A hooked dispatch. refs: strings or {item_id, ref}. endAt: null for no end. agent: null (no cost) or fields merged into the effort. */
function ledger(f, { run = 'sec/run-1', refs = ['T1'], id = 'a', usd = 2, at = T, endAt, stage = 'build', agent, start = true, crossed } = {}) {
  const split = refs.length, end = endAt === undefined ? plus(at, 600_000) : endAt;
  const effort = agent === null ? {} : { usage: { m: { input: tok(usd) } }, cost_usd: usd / split, split, ...(crossed ? { crossed } : {}), ...agent };
  for (const r of refs) {
    const one = typeof r === 'string' ? { item_id: f.itemId(run, r), ref: r } : r;
    const base = { ...one, plan: run, source: 'hook', source_record_id: `claude:s:${id}`, agentId: id };
    const tid = (ev) => `${one.item_id}/${ev}/${id}`;
    if (start) f.obs.push(mk({ ...base, event: 'dispatched', at, transition_id: tid('dispatched'), meta: { stage, version: 1 } }));
    if (end) f.obs.push(mk({ ...base, event: 'dispatch_ended', at: end, transition_id: tid('dispatch_ended'), meta: { stage, version: 1, agent: { turns: 10, ...effort } } }));
  }
}
/** A captured dispatch in the store; with a ledger id of the same value it is that dispatch's snapshot. */
function snap(f, { id = 'a', desc = 'T1', usd = 2, at = T, last = at, complete = true, follow } = {}) {
  f.snaps.push(snapshotFromTranscript({ firstTs: at, lastRecordAt: last, ...(follow ? { followUps: follow.map((text) => ({ at, text })) } : {}), records: 2, complete, last_uuid: 'u', messages: { x0: { model: 'm', input: tok(usd) } } },
    { session: 's', agent_id: id, description: desc, now: Date.parse(last) }));
}
const land = (f, run, ref, at = DONE) => f.obs.push(mk({ plan: run, item_id: f.itemId(run, ref), ref, event: 'done', at, source: 'cli', host: 'cli', source_record_id: `done-${run}-${ref}`, transition_id: `${f.itemId(run, ref)}/done/episode-1`, meta: { version: 1 } }));

/** Makes fs.readdirSync throw `make()` whenever the call stack is inside `inside` and not inside any of `outside` (function names). */
function failInside(t, inside, make, outside = []) {
  const orig = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (...a) {
    const limit = Error.stackTraceLimit; Error.stackTraceLimit = 100; const stack = new Error().stack; Error.stackTraceLimit = limit;
    const at = (n) => stack.includes(`at ${n} `);
    if (at(inside) && !outside.some(at)) throw make();
    return orig.apply(this, a);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}
const enoent = () => Object.assign(new Error('gone'), { code: 'ENOENT', syscall: 'scandir' });
const typeError = () => new TypeError('injected programming error');
// Programming errors that look like input errors: a SyntaxError the code computed itself, and a TypeError carrying an E-code but
// no file-system call. Neither may read as "unavailable".
const syntaxError = () => new SyntaxError('injected programming error');
const codedTypeError = () => Object.assign(new TypeError('injected programming error'), { code: 'EBUG' });
async function landed(t) { const f = await fx(t); ledger(f, { refs: ['T1'], usd: 2 }); land(f, 'sec/run-1', 'T1'); f.flush(); return f; }

// ---------- 5. error boundary ----------
test('5 error boundary: a TypeError inside attribution or inside task-cost input assembly is INTERNAL (exit 1) from calibrate', async (t) => {
  for (const [inside, outside] of [['attributeSpend', ['loadRunsChecked']], ['taskCosts', ['attributeSpend']]]) {
    await t.test(inside, async (tt) => {
      const f = await landed(tt); failInside(tt, inside, typeError, outside);
      const r = await cli(f.repo, ['calibrate', '--dry-run']);
      assert.equal(r.code, 1, r.stderr); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
    });
  }
});
test('5 error boundary: ENOENT inside attribution or inside task-cost input assembly is ATTRIBUTION-UNAVAILABLE from calibrate', async (t) => {
  for (const [inside, make, outside] of [['attributeSpend', enoent, ['loadRunsChecked']], ['taskCosts', enoent, ['attributeSpend']]]) {
    await t.test(inside, async (tt) => {
      const f = await landed(tt); failInside(tt, inside, make, outside);
      const r = await cli(f.repo, ['calibrate', '--dry-run']);
      assert.equal(r.code, 2, r.stderr); assert.match(r.stderr, /^ATTRIBUTION-UNAVAILABLE\(/);
    });
  }
});
test('5 error boundary: a computed SyntaxError or a TypeError with an E-code is INTERNAL (exit 1) from calibrate and from report', async (t) => {
  for (const make of [syntaxError, codedTypeError]) for (const [inside, outside] of [['attributeSpend', ['loadRunsChecked']], ['taskCosts', ['attributeSpend']]]) for (const cmd of ['calibrate', 'report']) {
    await t.test(`${cmd} ${inside} ${make().constructor.name}${make().code ? ` ${make().code}` : ''}`, async (tt) => {
      const f = await landed(tt); failInside(tt, inside, make, outside);
      const r = await cli(f.repo, cmd === 'calibrate' ? ['calibrate', '--dry-run'] : ['report', '--json']);
      assert.equal(r.code, 1, r.stderr); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
    });
  }
});
test('5 run reader: malformed JSON and an invalid schema are RUN-UNREADABLE; an unreadable file keeps its Node code; an exception inside propagates', async (t) => {
  const f = await landed(t), path = join(deliveryDir(f.repo), 'plans', 'broken.json');
  writeFileSync(path, '{ not json');
  assert.throws(() => loadRunsChecked(f.repo), (e) => e.code === 'RUN-UNREADABLE' && e.exit === 2 && e.message.includes(path));
  writeFileSync(path, JSON.stringify({ run: 'broken', items: [] }));
  assert.throws(() => loadRunsChecked(f.repo), (e) => e.code === 'RUN-UNREADABLE' && /invalid run schema/.test(e.message));
  rmSync(path); mkdirSync(path);
  assert.throws(() => loadRunsChecked(f.repo), (e) => e.code === 'EISDIR' && e.message.includes(path));
  rmSync(path, { recursive: true });
  failInside(t, 'loadRunsChecked', typeError);
  assert.throws(() => loadRunsChecked(f.repo), TypeError);
  const r = await cli(f.repo, ['calibrate', '--dry-run']);
  assert.equal(r.code, 1, r.stderr); assert.match(r.stderr, /^INTERNAL\(/);
});
test('5 run reader: through calibrate, a malformed-JSON and an invalid-schema run file are ATTRIBUTION-UNAVAILABLE (exit 2)', async (t) => {
  for (const body of ['{ not json', JSON.stringify({ run: 'broken', items: [] })]) {
    const f = await landed(t); writeFileSync(join(deliveryDir(f.repo), 'plans', 'broken.json'), body);
    const r = await cli(f.repo, ['calibrate', '--dry-run']);
    assert.equal(r.code, 2, r.stderr); assert.match(r.stderr, /^ATTRIBUTION-UNAVAILABLE\(.*RUN-UNREADABLE/);
  }
});

test('5 real readers: a corrupt run file and an unreadable dispatch store make report fall back (exit 0) and calibrate exit 2', async (t) => {
  for (const breakIt of [(f) => writeFileSync(join(deliveryDir(f.repo), 'plans', 'broken.json'), '{ not json'), (f) => { const p = join(deliveryDir(f.repo), 'dispatches-t.jsonl'); rmSync(p); mkdirSync(p); }]) {
    const f = await landed(t); breakIt(f);
    const r = await cli(f.repo, ['report', '--json']); assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).envelope.cost_fallback.code, 'ATTRIBUTION-UNAVAILABLE');
    const c = await cli(f.repo, ['calibrate', '--dry-run']); assert.equal(c.code, 2, c.stderr); assert.match(c.stderr, /^ATTRIBUTION-UNAVAILABLE\(/);
  }
});
test('5 error boundary: status still prints CALIBRATION invalid for unavailable attribution, but a programming error is INTERNAL', async (t) => {
  const f = await landed(t); failInside(t, 'taskCosts', enoent, ['attributeSpend']);
  let r = await cli(f.repo, ['status']); assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^CALIBRATION invalid: ATTRIBUTION-UNAVAILABLE\(/m);
  t.mock.restoreAll(); failInside(t, 'taskCosts', typeError, ['attributeSpend']);
  r = await cli(f.repo, ['status']); assert.equal(r.code, 1); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
});

// ---------- 1. cutoff (bounded taskCosts) ----------
const END = '2026-11-02T12:00:00.000Z', AFTER = '2026-11-02T13:00:00.000Z';
const bounded = (f, end = END) => { f.flush(); return taskCosts(f.repo, { end }); };
const cost = (tc, f, ref, run = 'sec/run-1') => tc.tasks.get(taskKey(run, f.itemId(run, ref)))?.cost_usd ?? null;
test('1 cutoff: a key started before the end counts with its later cumulative cost; at or after the end, or with no known start, it is left out', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3', 'T4'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 }); snap(f, { id: 'a', desc: 'T1', usd: 5, last: AFTER });   // the store snapshot grew after the end
  ledger(f, { refs: ['T2'], id: 'b', usd: 3, at: END });                                              // started exactly at the end
  ledger(f, { refs: ['T3'], id: 'u', usd: 4, start: false });                                         // no known start
  snap(f, { id: 'r', desc: 'T4', usd: 1, at: AFTER });                                                // recovered, after the end
  const tc = bounded(f);
  assert.equal(cost(tc, f, 'T1'), 5); assert.equal(cost(tc, f, 'T2'), null); assert.equal(cost(tc, f, 'T3'), null); assert.equal(cost(tc, f, 'T4'), null);
  assert.deepEqual(tc.keys.map((k) => k.dispatch_key), ['claude:s:a']);
  const all = taskCosts(f.repo);
  assert.deepEqual([cost(all, f, 'T1'), cost(all, f, 'T2'), cost(all, f, 'T3'), cost(all, f, 'T4')], [5, 3, 4, 1], 'unbounded keeps every key');
});
test('1 cutoff: a left-out key gives no marks and no noCost; an end whose key spend does not list counts only before the end', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 });
  snap(f, { id: 'x', desc: 'T2', usd: 1, at: AFTER, follow: ['now T1'] });            // after the end: its crossing must not mark T1
  ledger(f, { refs: ['T2'], id: 'n', agent: null, at: AFTER });                        // no cost recorded, after the end
  ledger(f, { refs: ['T3'], id: 'gone1', agent: null }); ledger(f, { refs: ['T3'], id: 'gone2', agent: null, at: AFTER });
  for (const id of ['gone1', 'gone2']) f.snaps.push({ v: 'dispatch.v2', dispatch_key: `claude:s:${id}`, retracted: true, reason: 'test', at: T });
  const tc = bounded(f), tk = (ref) => taskKey('sec/run-1', f.itemId('sec/run-1', ref));
  assert.equal(tc.marks.get(tk('T1')), undefined); assert.equal(tc.noCost.get(tk('T2')), undefined);
  assert.deepEqual([...tc.noCost.get(tk('T3'))], ['claude:s:gone1']);
  const all = taskCosts(f.repo);
  assert.ok(all.marks.get(tk('T1')).has('crossed-into-another-task')); assert.deepEqual([...all.noCost.get(tk('T2'))], ['claude:s:n']); assert.deepEqual([...all.noCost.get(tk('T3'))].sort(), ['claude:s:gone1', 'claude:s:gone2']);
});

// ---------- 4 / 4b. the cost view: renames, crossings and time ----------
const view = (f, run = 'sec/run-1', end = END) => {
  f.flush(); const res = resolveObservations(f.repo), tc = taskCosts(f.repo, { resolved: res, end });
  const { occurrences } = selectOccurrences(res.active, res.conflicts);
  const v = costView(tc, f.run(run), occurrences);
  return (ref) => v.get(f.itemId(run, ref));
};
test('4 renames: cost under a mapped old id is kept and its crossing marker moves; an unmapped old id withholds the run', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2'] }]);
  const id1 = f.itemId('sec/run-1', 'T1'), id2 = f.itemId('sec/run-1', 'T2');
  f.mutate('sec/run-1', (r) => { r.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-old1': id1, 'sec/run-1/task-old2': id2 } }; });
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-old1', ref: 'T1' }], id: 'a', usd: 2, crossed: ['sec/run-1/task-old2'] });
  let get = view(f);
  assert.equal(get('T1').cost_usd, 2); assert.ok(get('T1').cost_gaps.includes('crossed-into-another-task'));
  assert.ok(get('T2').cost_gaps.includes('crossed-into-another-task'), 'the marker moved to the renamed T2');
  assert.ok(!get('T1').cost_gaps.includes('crossing-unreadable'));
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-lost', ref: 'TX' }], id: 'b', usd: 1 });
  get = view(f);
  assert.ok(get('T1').cost_gaps.includes('cost-under-unknown-id') && get('T2').cost_gaps.includes('cost-under-unknown-id'));
});
test('4b cost view time: ended after the end is not dispatch-not-ended; a late crossing marks both; start-only before the end is not ended, after it nothing; a future orphan does not withhold', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3', 'T4'] }]);
  const id2 = f.itemId('sec/run-1', 'T2');
  ledger(f, { refs: ['T1'], id: 'a', usd: 2, endAt: AFTER, crossed: [id2] });     // started before, ended (and crossed) after the end
  ledger(f, { refs: ['T3'], id: 's', endAt: null });                              // start-only, before the end
  ledger(f, { refs: ['T4'], id: 'z', endAt: null, at: AFTER });                   // start-only, after the end
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-lost', ref: 'TX' }], id: 'o', usd: 1, at: AFTER });   // a future orphan end
  const get = view(f);
  assert.equal(get('T1').cost_usd, 2); assert.ok(!get('T1').cost_gaps.includes('dispatch-not-ended'), get('T1').cost_gaps.join());
  assert.ok(get('T1').cost_gaps.includes('crossed-into-another-task')); assert.ok(get('T2').cost_gaps.includes('crossed-into-another-task'));
  assert.ok(get('T3').cost_gaps.includes('dispatch-not-ended')); assert.ok(!get('T4').cost_gaps.includes('dispatch-not-ended'));
  for (const ref of ['T1', 'T2', 'T3', 'T4']) assert.ok(!get(ref).cost_gaps.includes('cost-under-unknown-id'), ref);
});

// ---------- report: C1 replaces the hook's task costs ----------
const usdEst = (low, high, tier = 'calibrated') => ({ unit: 'usd', low, high, tier, proposed_by: 'tl', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'tl', accepted_at: '2026-11-01T00:00:00Z',
  ...(tier === 'calibrated' ? { reference: { path: '.agents/telemetry/delivery/calibration.json', sha256: 'c'.repeat(64), population: 'all n=12' } } : {}) });
const report = async (f, args = []) => { f.flush(); const r = await cli(f.repo, ['report', '--json', ...args]); assert.equal(r.code, 0, r.stderr); return JSON.parse(r.stdout); };
const item = (doc, ref, run = 'sec/run-1') => doc.plans.find((p) => p.run === run).items.find((i) => i.ref === ref);
const row = (doc, ref, run = 'sec/run-1') => doc.plans.find((p) => p.run === run).metrics.estimate_rows.find((r) => r.ref === ref);

test('1 cutoff through report: the effective end is min(--until, --cutoff) in either order; the policy says lifetime cost, may be revised', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 }); ledger(f, { refs: ['T2'], id: 'b', usd: 3, at: AFTER });
  for (const args of [['--until', END, '--cutoff', '2026-11-04T00:00:00Z'], ['--until', '2026-11-04T00:00:00Z', '--cutoff', END]]) {
    const doc = await report(f, args);
    assert.equal(doc.envelope.window.effective_end, END);
    assert.equal(item(doc, 'T1').cost_usd, 2, args.join(' ')); assert.equal(item(doc, 'T2').cost_usd, null, args.join(' '));
  }
  const all = await report(f, ['--cutoff', '2026-11-04T00:00:00Z']);
  assert.equal(item(all, 'T2').cost_usd, 3); assert.equal(all.envelope.cost_basis, 'c1'); assert.equal(all.envelope.prices_as_of, '2026-11-01');
  assert.equal(all.envelope.cost_fallback, null);
  assert.equal(all.envelope.policy.task_cost, 'lifetime cost of dispatches started before the effective end; may be revised');
});
test('2 global owners: a key shared by tasks in two plans keeps half per task under --plan of either', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1'] }, { campaign: 'sec', run: 'run-2', tasks: ['T1'] }]);
  ledger(f, { run: 'sec/run-1', refs: [{ item_id: f.itemId('sec/run-1', 'T1'), ref: 'T1' }], id: 'a', usd: 4 });
  ledger(f, { run: 'sec/run-2', refs: [{ item_id: f.itemId('sec/run-2', 'T1'), ref: 'T1' }], id: 'a', usd: 4 });
  for (const run of ['sec/run-1', 'sec/run-2']) {
    const doc = await report(f, ['--plan', run, '--cutoff', '2026-11-04T00:00:00Z']);
    assert.equal(item(doc, 'T1', run).cost_usd, 2, run); assert.equal(item(doc, 'T1', run).cost_source, 'ledger');
  }
});
test('3 projection: a recovered-only task is a scored row; a hook no-cost-recorded repaired by a priced store snapshot is usable', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [{ ref: 'T1', estimate: usdEst(1, 4) }, { ref: 'T2', estimate: usdEst(1, 4) }] }]);
  snap(f, { id: 'r', desc: 'T1', usd: 3 });                                          // recovered only: the hook saw nothing
  ledger(f, { refs: ['T2'], id: 'a', agent: null }); snap(f, { id: 'a', desc: 'T2', usd: 2 });   // old hook end, no cost
  land(f, 'sec/run-1', 'T1'); land(f, 'sec/run-1', 'T2');
  const doc = await report(f, ['--cutoff', '2026-11-04T00:00:00Z']);
  assert.deepEqual([row(doc, 'T1').reason, row(doc, 'T1').actual_usd, item(doc, 'T1').cost_source, item(doc, 'T1').cost_gaps], [null, 3, 'recovered', []]);
  assert.deepEqual([row(doc, 'T2').reason, row(doc, 'T2').actual_usd, item(doc, 'T2').cost_gaps], [null, 2, []]);
  const usd = doc.plans[0].metrics.estimates.task.strata['usd:all'];
  assert.equal(usd.eligible, 2); assert.equal(usd.excluded.missing_actual, 0);
});
const nonCost = (doc) => JSON.parse(JSON.stringify(doc, (k, v) => (['cost_usd', 'cost_source', 'cost_gaps', 'cost_basis', 'cost_fallback', 'prices_as_of', 'task_cost', 'cost', 'estimate_bands', 'planner_size_bands', 'class_bounds_usd', 'cost_band'].includes(k) ? undefined : v)));
test('3 projection: non-cost output equals the report without task costs on a fixture with renames, crossings and reopens', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3'] }]);
  const id2 = f.itemId('sec/run-1', 'T2');
  f.mutate('sec/run-1', (r) => { r.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-old1': f.itemId('sec/run-1', 'T1') } }; });
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-old1', ref: 'T1' }], id: 'a', usd: 2, crossed: [id2] });
  ledger(f, { refs: ['T2'], id: 'b', usd: 1, at: plus(T, 3_600_000) }); ledger(f, { refs: ['T3'], id: 'c', usd: 1, endAt: AFTER });
  for (const ref of ['T1', 'T2', 'T3']) land(f, 'sec/run-1', ref);
  f.obs.push(mk({ plan: 'sec/run-1', item_id: f.itemId('sec/run-1', 'T3'), ref: 'T3', event: 'reopened', at: '2026-11-03T12:00:00.000Z', source: 'cli', host: 'cli', source_record_id: 'reopen-T3', transition_id: `${f.itemId('sec/run-1', 'T3')}/reopened/1`, meta: { version: 1 } }));
  f.flush();
  for (const cutoff of [END, '2026-11-04T00:00:00Z']) {
    const opts = { cutoff, now: NOW }, withCosts = assemble(f.repo, opts), without = assemble(f.repo, { ...opts, costs: false });
    // Cost gaps differ by design (C1 recomputes them); everything else must be identical.
    assert.deepEqual(nonCost(withCosts), nonCost(without), cutoff);
  }
});

// ---------- 5. report fallback and error boundary ----------
test('5 fallback: attribution unavailable or invalid prices → hook costs, cost_basis hook, cost_fallback, one caveat, exit 0', async (t) => {
  for (const [code, breakIt] of [['ATTRIBUTION-UNAVAILABLE', (f) => writeFileSync(join(deliveryDir(f.repo), 'plans', 'broken.json'), '{ not json')], ['PRICES-INVALID', (f) => writeFileSync(join(deliveryDir(f.repo), 'prices.json'), '{ nope')]]) {
    const f = await fx(t); ledger(f, { refs: ['T1'], usd: 2 }); snap(f, { id: 'a', desc: 'T1', usd: 5 }); land(f, 'sec/run-1', 'T1'); f.flush();
    assert.equal(item(await report(f), 'T1').cost_usd, 5, 'C1: the store total');
    breakIt(f);
    const doc = await report(f);
    assert.equal(doc.envelope.cost_basis, 'hook', code); assert.equal(doc.envelope.cost_fallback.code, code); assert.ok(doc.envelope.cost_fallback.reason);
    assert.equal(doc.envelope.prices_as_of, null); assert.equal(item(doc, 'T1').cost_usd, 2, 'the hook-time cost'); assert.equal(item(doc, 'T1').cost_source, null);
    assert.equal(doc.envelope.caveats.filter((c) => c.startsWith('task cost:')).length, 1); assert.match(doc.envelope.caveats.find((c) => c.startsWith('task cost:')), new RegExp(code));
    const md = await cli(f.repo, ['report']); assert.equal(md.code, 0, md.stderr);
  }
});
test('5 error boundary: a TypeError inside attribution or task-cost input assembly is exit 1 from report; ENOENT there falls back', async (t) => {
  for (const [inside, make, outside, code] of [['attributeSpend', typeError, ['loadRunsChecked'], 1], ['taskCosts', typeError, ['attributeSpend'], 1], ['attributeSpend', enoent, ['loadRunsChecked'], 0], ['taskCosts', enoent, ['attributeSpend'], 0]]) {
    await t.test(`${inside} ${make().code ?? make().constructor.name}`, async (tt) => {
      const f = await landed(tt); failInside(tt, inside, make, outside);
      const r = await cli(f.repo, ['report', '--json']);
      assert.equal(r.code, code, r.stderr);
      if (code) assert.match(r.stderr, /^INTERNAL\(injected programming error\)/); else assert.equal(JSON.parse(r.stdout).envelope.cost_fallback.code, 'ATTRIBUTION-UNAVAILABLE');
    });
  }
});

// ---------- 6. estimate bands ----------
const CUT = '2026-11-04T00:00:00Z';
const calibration = (f, over = {}) => writeFileSync(join(deliveryDir(f.repo), 'calibration.json'), typeof over === 'string' ? over : JSON.stringify({ v: 1, unit: 'usd', min_n: 5, prices_as_of: '2026-11-01', samples: 12, class_bounds_usd: [1, 2, 3], cells: {}, ...over }));
/** One landed task per [ref, estimate, actual usd]; each has its own hooked dispatch. */
async function banded(t, rows, { cls } = {}) {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: rows.map(([ref, estimate], k) => ({ ref, ...(estimate ? { estimate } : {}), ...(cls ? { class: cls[k] } : {}) })) }]);
  rows.forEach(([ref, , usd], k) => { if (usd != null) ledger(f, { refs: [ref], id: `d${k}`, usd }); land(f, 'sec/run-1', ref); });
  return f;
}
test('6 bands: calibrated low, planner midpoint and point value against inclusive bounds; distances 0, 1 and >= 2', async (t) => {
  // T1's low (1.5, E2) and midpoint (2.25, E3) differ; T4 has no cost, so it is not a scoring row and is not banded.
  const f = await banded(t, [['T1', usdEst(1.5, 3), 1.5], ['T2', usdEst(1, 3, 'ROM'), 3], ['T3', usdEst(0.5, 0.5, 'ROM'), 5], ['T4', usdEst(1, 2, 'ROM'), null]]);
  calibration(f);
  const doc = await report(f, ['--cutoff', CUT]), m = doc.plans[0].metrics;
  assert.deepEqual(['T1', 'T2', 'T3'].map((r) => [row(doc, r).estimated_band, row(doc, r).actual_band, row(doc, r).band_distance]), [['E2', 'E2', 0], ['E2', 'E3', 1], ['E1', 'E4', 3]]);
  assert.equal(row(doc, 'T4').reason, 'missing_actual'); assert.equal(row(doc, 'T4').estimated_band, undefined);
  assert.deepEqual({ ...m.estimate_bands, matrix: undefined }, { n: 3, same: 1, one_off: 1, two_or_more_off: 1, within_one: 2, matrix: undefined });
  assert.deepEqual(m.estimate_bands.matrix, { E1: { E4: 1 }, E2: { E2: 1, E3: 1 } });
  assert.deepEqual(doc.envelope.estimate_bands, { bounds_usd: [1, 2, 3], suppressed: null, calibration_prices_as_of: '2026-11-01' });
  assert.equal(item(doc, 'T3').cost_band, 'E4');
  assert.equal(doc.envelope.caveats.filter((c) => /estimate bands/.test(c)).length, 0, 'same price date: no caveat');
});
test('6 bands: values on a bound fall in the lower band; equal bounds skip the empty band', () => {
  const rows = [1, 2, 3, 1.5].map((v, k) => ({ item_id: `i${k}`, estimate: { unit: 'usd', low: v, high: v }, tier: 'ROM', reason: null }));
  const items = new Map(rows.map((r) => [r.item_id, { cost_usd: r.estimate.low, cost_gaps: [] }]));
  estimateBands(rows, items, [1, 2, 3]); assert.deepEqual(rows.map((r) => r.actual_band), ['E1', 'E2', 'E3', 'E2']);
  estimateBands(rows, items, [1, 1, 3]); assert.deepEqual(rows.map((r) => r.actual_band), ['E1', 'E3', 'E3', 'E3']);
});
test('6 bands: a calibrated range with a mid is banded and scored on the mid; one without falls back to low', () => {
  const rows = [{ item_id: 'a', estimate: { unit: 'usd', low: 1, mid: 2.5, high: 4 }, tier: 'calibrated', reason: null }, { item_id: 'b', estimate: { unit: 'usd', low: 1.5, high: 4 }, tier: 'calibrated', reason: null }];
  const items = new Map([['a', { cost_usd: 2, cost_gaps: [] }], ['b', { cost_usd: 2, cost_gaps: [] }]]);
  estimateBands(rows, items, [1, 2, 3]);
  assert.deepEqual(rows.map((r) => [r.estimate_rep_usd, r.estimated_band]), [[2.5, 'E3'], [1.5, 'E2']]);
});
test('6 bands: each suppression reason keeps the dollar detail and says why', async (t) => {
  const cases = [['no-calibration', null], ['unreadable', '{'], ['too-few-samples', { class_bounds_usd: null }], ['invalid-bounds', { class_bounds_usd: [3, 2, 1] }], ['invalid-bounds', { class_bounds_usd: [1, 2] }],
    ['invalid-bounds', { class_bounds_usd: [-1, 2, 3] }], ['invalid-bounds', { class_bounds_usd: [1, 'x', 3] }], ['fallback', {}]];
  for (const [reason, cal] of cases) {
    const f = await banded(t, [['T1', usdEst(1, 4, 'ROM'), 2]]);
    if (cal !== null) calibration(f, cal);
    if (reason === 'fallback') writeFileSync(join(deliveryDir(f.repo), 'plans', 'broken.json'), '{ not json');
    const doc = await report(f, ['--cutoff', CUT]);
    assert.equal(doc.envelope.estimate_bands.suppressed, reason, JSON.stringify(cal)); assert.equal(doc.plans[0].metrics.estimate_bands, null);
    assert.equal(row(doc, 'T1').ratio, 0.8, 'dollar detail kept'); assert.equal(row(doc, 'T1').estimated_band, undefined); assert.equal(item(doc, 'T1').cost_band, null);
  }
});
test('6 bands: a calibration priced on another date adds one caveat, whether or not bands can be shown', async (t) => {
  const price = (c) => c.startsWith('prices: ');
  for (const [cal, bands] of [[{ prices_as_of: '2026-10-01' }, true], [{ prices_as_of: '2026-10-01', class_bounds_usd: null }, false], [{ prices_as_of: '2026-10-01', class_bounds_usd: [3, 2, 1] }, false]]) {
    const f = await banded(t, [['T1', usdEst(1, 4, 'ROM'), 2]]); calibration(f, cal);
    const doc = await report(f, ['--cutoff', CUT]);
    assert.equal(doc.plans[0].metrics.estimate_bands != null, bands, JSON.stringify(cal)); assert.equal(row(doc, 'T1').ratio, 0.8, 'dollar detail');
    assert.deepEqual(doc.envelope.caveats.filter(price), ['prices: calibration priced as of 2026-10-01, task costs at current prices as of 2026-11-01; estimates keep their recorded dollars'], JSON.stringify(cal));
  }
  const same = await banded(t, [['T1', usdEst(1, 4, 'ROM'), 2]]); calibration(same, { class_bounds_usd: null });
  assert.equal((await report(same, ['--cutoff', CUT])).envelope.caveats.filter(price).length, 0, 'same date: no caveat');
  writeFileSync(join(deliveryDir(same.repo), 'plans', 'broken.json'), '{ not json'); calibration(same, { prices_as_of: '2026-10-01' });
  assert.equal((await report(same, ['--cutoff', CUT])).envelope.caveats.filter(price).length, 0, 'fallback: no current-price costs, no caveat');
});
test('6 bands: --latest-estimate bands the latest accepted estimate', async (t) => {
  const f = await banded(t, [['T1', usdEst(0.5, 0.5, 'ROM'), 2.5]]); calibration(f);
  const file = join(f.repo, 'plan-v2.md'), late = { ...usdEst(2.5, 2.5, 'ROM'), proposed_at: '2026-11-01T12:00:00Z', accepted_at: '2026-11-01T12:00:00Z' };
  writeFileSync(file, `# p\n\`\`\`json delivery-plan\n${JSON.stringify({ ...planDoc('sec', 'run-1', [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'T1', estimate: late }] }]), version: 2 })}\n\`\`\`\n`);
  const reg = await cli(f.repo, ['plan', 'register', '--from', file, '--id', 'reg-v2', '--no-calibrate', '--no-bind', '--at', '2026-11-01T12:00:00Z']); assert.equal(reg.code, 0, reg.stderr);
  assert.deepEqual([row(await report(f, ['--cutoff', CUT]), 'T1').estimated_band, row(await report(f, ['--cutoff', CUT, '--latest-estimate']), 'T1').estimated_band], ['E1', 'E3']);
});

// ---------- 7. planner size × actual band ----------
test('7 planner sizes: shown from 5 tasks; a reopened task and filtered-out tasks are left out; no verdict', async (t) => {
  const refs = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], usd = [0.5, 1.5, 2.5, 3.5, 0.5, 2.5];
  const f = await banded(t, refs.map((r, k) => [r, null, usd[k]]), { cls: ['S', 'S', 'M', 'M', 'S', 'S'] }); calibration(f);
  let m = (await report(f, ['--cutoff', CUT])).plans[0].metrics.planner_size_bands;
  assert.deepEqual(m, { n: 6, min_n: 5, matrix: { M: { E3: 1, E4: 1 }, S: { E1: 2, E2: 1, E3: 1 } } });
  f.obs.push(mk({ plan: 'sec/run-1', item_id: f.itemId('sec/run-1', 'T6'), ref: 'T6', event: 'reopened', at: '2026-11-03T12:00:00.000Z', source: 'cli', host: 'cli', source_record_id: 'reopen-T6', transition_id: `${f.itemId('sec/run-1', 'T6')}/reopened/1`, meta: { version: 1 } }));
  m = (await report(f, ['--cutoff', CUT])).plans[0].metrics.planner_size_bands;
  assert.deepEqual(m, { n: 5, min_n: 5, matrix: { M: { E3: 1, E4: 1 }, S: { E1: 2, E2: 1 } } });
  m = (await report(f, ['--cutoff', CUT, '--class', 'S'])).plans[0].metrics.planner_size_bands;
  assert.deepEqual(m, { n: 3, min_n: 5, matrix: null });
});

// ---------- 8. per-plan cost partition ----------
test('8 per-plan cost: (c) is the sum of per-task costs; (a) plus the other tasks is (c); (b) counts done tasks without a usable cost', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1', 'T2', 'T3', 'T4', 'T5'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 }); ledger(f, { refs: ['T2'], id: 'b', usd: 3 });
  ledger(f, { refs: ['T3'], id: 'c', usd: 1, endAt: null }); snap(f, { id: 'c', desc: 'T3', usd: 1, complete: false });  // done, not ended
  ledger(f, { refs: ['T4'], id: 'd', usd: 4 });                                                                            // in progress
  for (const r of ['T1', 'T2', 'T3']) land(f, 'sec/run-1', r);
  land(f, 'sec/run-1', 'T5', '2026-11-05T00:00:00.000Z');                                                                   // done after the window: no cost either way
  const doc = await report(f, ['--cutoff', CUT]), p = doc.plans[0], tasks = p.items.filter((i) => i.level === 'task');
  const sum = (xs) => xs.reduce((n, i) => n + (i.cost_usd ?? 0), 0);
  assert.equal(p.cost.all_tasks_usd, sum(tasks)); assert.equal(p.cost.all_tasks_usd, 10);
  assert.deepEqual([p.cost.done_in_window_usd, p.cost.done_in_window_n, p.cost.done_without_cost], [5, 2, 1]);
  const inA = new Set(['T1', 'T2']);
  assert.equal(p.cost.done_in_window_usd + sum(tasks.filter((i) => !inA.has(i.ref))), p.cost.all_tasks_usd);
});

// ---------- 9. Markdown, HTML, JSON and --from-json ----------
async function rendered(t) {
  const f = await banded(t, [['T1', usdEst(1.5, 3), 1.5], ['T2', usdEst(1, 3, 'ROM'), 3], ['T3', usdEst(0.5, 0.5, 'ROM'), 5], ['T4', null, 2.5]], { cls: ['S', 'S', 'M', 'M'] });
  calibration(f); f.flush();
  const md = (await cli(f.repo, ['report', '--cutoff', CUT])).stdout, html = (await cli(f.repo, ['report', '--html', '--cutoff', CUT])).stdout;
  return { f, md, html, doc: await report(f, ['--cutoff', CUT]) };
}
test('9 Markdown: a Cost section with basis, plan cost, band headline and matrix, dollar detail renamed, and a task cost table', async (t) => {
  const { md } = await rendered(t);
  const cost = md.slice(md.indexOf('## Cost'), md.indexOf('## Coverage'));
  assert.match(cost, /^- basis: current prices as of 2026-11-01; lifetime cost of dispatches started before the effective end; may be revised$/m);
  assert.match(cost, /^- plan cost: done in window \$12 \(4 tasks\), done without a usable cost 0, all tasks \$12$/m);
  assert.match(cost, /^- estimate bands: same 1 · one off 1 · two or more off 1 — within one band 2 of 3 \(E1 ≤ \$1, E2 ≤ \$2, E3 ≤ \$3, E4 above\)$/m);
  assert.match(cost, /^\| estimated \\ actual \| E2 \| E3 \| E4 \|$/m); assert.match(cost, /^\| E1 \| — \| — \| 1 \|$/m); assert.match(cost, /^\| E2 \| 1 \| 1 \| — \|$/m);
  assert.match(cost, /^- planner size × actual band: — \(4 tasks, shown from 5\)$/m);
  assert.match(cost, /within dollar range/); assert.match(cost, /^\| T2 \| task \| S \| ROM \| original \| \[\$1, \$3\] \| \$2 E2 \| \$3 E3 \| 1\.5 \| yes \| — \|$/m);
  assert.match(cost, /^\| ref \| state \| cost \| band \| source \| gaps \|$/m); assert.match(cost, /^\| T4 \| done \| \$2\.5 \| E3 \| ledger \| — \|$/m);
  const est = md.slice(md.indexOf('## Estimates'), md.indexOf('## Cost'));
  assert.doesNotMatch(est, /usd:/, 'dollar strata moved to the Cost section');
});
test('9 HTML: cost column with the actual band chip, band card without hook wording, and a Cost panel', async (t) => {
  const { html } = await rendered(t);
  assert.match(html, /<div class="c">cost<\/div>/);
  assert.match(html, /<span title="sec\/run-1\/task-t3">T3<\/span>.*?\$5 <span class="oc band">E4<\/span>/s);
  assert.match(html, /2 <span class="stat-sub">of 3<\/span><\/span><span class="hero-label">estimates within one effort band<\/span>/);
  assert.doesNotMatch(html, /hooked dispatches/); assert.match(html, /<h2>Cost<\/h2>/);
});
test('9 --from-json: an archived report without the cost fields renders Markdown and HTML with no cost values and no bands', async (t) => {
  const { f, doc } = await rendered(t);
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['cost_usd', 'cost_source', 'cost_gaps', 'cost_band', 'cost_basis', 'cost_fallback', 'prices_as_of', 'task_cost', 'cost', 'estimate_bands', 'planner_size_bands', 'estimate_rep_usd', 'estimated_band', 'actual_band', 'band_distance'].includes(k) ? undefined : x)));
  const file = join(f.repo, 'old.json'); writeFileSync(file, JSON.stringify(strip(doc)));
  const md = await cli(f.repo, ['report', '--from-json', file]), html = await cli(f.repo, ['report', '--from-json', file, '--html']);
  assert.equal(md.code, 0, md.stderr); assert.equal(html.code, 0, html.stderr);
  assert.match(md.stdout, /^- basis: — \(archived report without task costs\)$/m); assert.doesNotMatch(md.stdout, /estimate bands: same/);
  assert.match(md.stdout, /^\| T4 \| done \| — \| — \| — \| — \|$/m);
  assert.doesNotMatch(html.stdout, /class="oc band"/); assert.doesNotMatch(html.stdout, /within one effort band/);
});

test('4b cost view time: a dispatch spend does not list and with no known start is not admitted, even with an end before the cutoff', async (t) => {
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['T1'] }]);
  ledger(f, { refs: ['T1'], id: 'a', usd: 2 });
  // An orphan end (an id the run neither knows nor maps), no start, its key tombstoned so `spend` does not list it.
  ledger(f, { refs: [{ item_id: 'sec/run-1/task-lost', ref: 'TX' }], id: 'o', usd: 1, start: false });
  f.snaps.push({ v: 'dispatch.v2', dispatch_key: 'claude:s:o', retracted: true, reason: 'test', at: T });
  const get = view(f);
  assert.equal(get('T1').cost_usd, 2); assert.ok(!get('T1').cost_gaps.includes('cost-under-unknown-id'), get('T1').cost_gaps.join());
});

test('5 error boundary: doctor and the status spend line keep their soft messages for unreadable input, but a programming error is INTERNAL', async (t) => {
  const f = await landed(t);
  failInside(t, 'taskCosts', enoent, ['attributeSpend']);
  let r = await cli(f.repo, ['doctor']); assert.notEqual(r.code, 1, r.stderr); assert.match(r.stdout, /warning: calibration: ledger unreadable: ATTRIBUTION-UNAVAILABLE\(/);
  t.mock.restoreAll(); failInside(t, 'taskCosts', typeError, ['attributeSpend']);
  r = await cli(f.repo, ['doctor']); assert.equal(r.code, 1); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
  t.mock.restoreAll(); failInside(t, 'statusSpend', enoent);
  r = await cli(f.repo, ['status']); assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^SPEND unavailable: /m);
  t.mock.restoreAll(); failInside(t, 'statusSpend', typeError);
  r = await cli(f.repo, ['status']); assert.equal(r.code, 1); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
});

// ---------- historical renames: a report ending before the re-cut ----------
async function recut(t, chain) {
  // v1 registers chain[0]; each later version (one day apart, from Nov 5) renames the previous ref to the next one.
  const f = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: [chain[0]] }]);
  const ids = [f.itemId('sec/run-1', chain[0])];
  ledger(f, { refs: [chain[0]], id: 'a', usd: 2 }); land(f, 'sec/run-1', chain[0]); f.flush();
  for (let v = 1; v < chain.length; v++) {
    const file = join(f.repo, `v${v + 1}.md`), at = `2026-11-0${4 + v}T00:00:00Z`, newId = `sec/run-1/task-${chain[v].toLowerCase()}`;
    writeFileSync(file, `# p\n\`\`\`json delivery-plan\n${JSON.stringify({ ...planDoc('sec', 'run-1', [{ ref: 'G1', sequence: 1, tasks: [{ ref: chain[v] }] }]), version: v + 1, supersedes: { run: 'sec/run-1', item_map: { [ids[v - 1]]: newId } } })}\n\`\`\`\n`);
    const r = await cli(f.repo, ['plan', 'register', '--from', file, '--id', `reg-v${v + 1}`, '--no-calibrate', '--no-bind', '--at', at]); assert.equal(r.code, 0, r.stderr);
    ids.push(f.itemId('sec/run-1', chain[v]));
  }
  return { f, ids };
}
test('historical rename: a report ending before the re-cut keeps the cost on the old item the timeline still has', async (t) => {
  const { f } = await recut(t, ['OLD', 'NEW']);
  const doc = await report(f, ['--until', '2026-11-04T00:00:00Z', '--cutoff', '2026-11-10T00:00:00Z']);
  assert.ok(item(doc, 'OLD'), 'the timeline at the end still has OLD'); assert.equal(item(doc, 'NEW'), undefined);
  assert.equal(item(doc, 'OLD').cost_usd, 2); assert.deepEqual(item(doc, 'OLD').cost_gaps, []);
  // (The report's own replay reads only ids the latest catalogue knows, so OLD is not done here: a non-cost limit left as it is.)
  assert.equal(doc.plans[0].cost.all_tasks_usd, 2);
  const after = await report(f, ['--cutoff', '2026-11-10T00:00:00Z']);
  assert.equal(item(after, 'NEW').cost_usd, 2, 'after the re-cut the cost sits on NEW, once'); assert.equal(after.plans[0].cost.all_tasks_usd, 2);
});
test('historical rename: a two-step chain stays withheld as in calibration; a cost goes to one old item only', async (t) => {
  const { f, ids } = await recut(t, ['OLD', 'MID', 'NEW']);
  // Even with both links in the map, the cost view maps one step, exactly as calibration does: OLD's cost lands under MID, an id
  // the run no longer knows, so the whole run is withheld rather than credited to OLD.
  f.mutate('sec/run-1', (r) => { r.supersedes.item_map = { [ids[0]]: ids[1], [ids[1]]: ids[2] }; });
  const doc = await report(f, ['--until', '2026-11-04T00:00:00Z', '--cutoff', '2026-11-10T00:00:00Z']);
  assert.equal(item(doc, 'OLD').cost_usd, null); assert.ok(item(doc, 'OLD').cost_gaps.includes('cost-under-unknown-id'));
  // Two old ids mapped to one new id (register refuses this; a hand-edited run file can hold it): only the first takes its cost.
  const g = await fx(t, [{ campaign: 'sec', run: 'run-1', tasks: ['A', 'B'] }]);
  const [a, b] = ['A', 'B'].map((x) => g.itemId('sec/run-1', x));
  ledger(g, { refs: ['A'], id: 'a', usd: 2 }); g.flush();
  const file = join(g.repo, 'v2.md');
  writeFileSync(file, `# p\n\`\`\`json delivery-plan\n${JSON.stringify({ ...planDoc('sec', 'run-1', [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'C' }] }]), version: 2, supersedes: { run: 'sec/run-1', item_map: { [a]: 'sec/run-1/task-c' } } })}\n\`\`\`\n`);
  const r = await cli(g.repo, ['plan', 'register', '--from', file, '--id', 'reg-v2', '--no-calibrate', '--no-bind', '--at', '2026-11-05T00:00:00Z']); assert.equal(r.code, 0, r.stderr);
  g.mutate('sec/run-1', (x) => { x.supersedes.item_map[b] = 'sec/run-1/task-c'; });
  const d2 = await report(g, ['--until', '2026-11-04T00:00:00Z', '--cutoff', '2026-11-10T00:00:00Z']);
  assert.deepEqual([item(d2, 'A').cost_usd, item(d2, 'B').cost_usd, d2.plans[0].cost.all_tasks_usd], [2, null, 2]);
});
