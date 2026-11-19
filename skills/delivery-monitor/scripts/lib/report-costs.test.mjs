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
function snap(f, { id = 'a', desc = 'T1', usd = 2, at = T, complete = true } = {}) {
  f.snaps.push(snapshotFromTranscript({ firstTs: at, lastRecordAt: at, records: 2, complete, last_uuid: 'u', messages: { x0: { model: 'm', input: tok(usd) } } },
    { session: 's', agent_id: id, description: desc, now: Date.parse(at) }));
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
const syntaxError = () => new SyntaxError('Unexpected token in JSON');
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
test('5 error boundary: ENOENT inside attribution and a SyntaxError inside task-cost input assembly are ATTRIBUTION-UNAVAILABLE from calibrate', async (t) => {
  for (const [inside, make, outside] of [['attributeSpend', enoent, ['loadRunsChecked']], ['taskCosts', syntaxError, ['attributeSpend']]]) {
    await t.test(inside, async (tt) => {
      const f = await landed(tt); failInside(tt, inside, make, outside);
      const r = await cli(f.repo, ['calibrate', '--dry-run']);
      assert.equal(r.code, 2, r.stderr); assert.match(r.stderr, /^ATTRIBUTION-UNAVAILABLE\(/);
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

test('5 error boundary: status still prints CALIBRATION invalid for unavailable attribution, but a programming error is INTERNAL', async (t) => {
  const f = await landed(t); failInside(t, 'taskCosts', enoent, ['attributeSpend']);
  let r = await cli(f.repo, ['status']); assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^CALIBRATION invalid: ATTRIBUTION-UNAVAILABLE\(/m);
  t.mock.restoreAll(); failInside(t, 'taskCosts', typeError, ['attributeSpend']);
  r = await cli(f.repo, ['status']); assert.equal(r.code, 1); assert.match(r.stderr, /^INTERNAL\(injected programming error\)/);
});
