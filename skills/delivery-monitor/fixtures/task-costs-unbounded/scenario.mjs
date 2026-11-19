// Baseline for the report's bounded task-cost projection: what the unbounded `taskCosts` (calibration's call) and `collect`
// returned before that change, on a scenario with hooked, recovered, renamed and crossing dispatches, a ledger allocation with
// no known start, and an unpriced hook end whose key the store has tombstoned (so `spend` does not list it). golden.json was
// produced by running runScenario with the functions of the code from before that change, so the test compares against an
// independent baseline. To regenerate after an intended change, run runScenario and write its result to golden.json.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const T = '2026-11-02T10:00:00.000Z', END = '2026-11-02T10:10:00.000Z', DONE = '2026-11-03T10:00:00.000Z';
const sorted = (m, f = (v) => v) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, f(v)]);

/** Only the fields `taskCosts` returned before the bounded call existed. */
export const serializeTaskCosts = (tc) => ({ tasks: sorted(tc.tasks), marks: sorted(tc.marks, (s) => [...s].sort()), noCost: sorted(tc.noCost, (s) => [...s].sort()), keys: tc.keys, ownerless_usd: tc.ownerless_usd });

export async function runScenario({ main, makeObservation, snapshotFromTranscript, taskCosts, collect }) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-tcunb-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@x'); git('config', 'user.name', 'Tester');
    const dir = join(repo, '.agents', 'telemetry', 'delivery'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prices.json'), JSON.stringify({ as_of: '2026-11-01', models: { m: { input: 1, output: 2, cache_write: 3, cache_read: 0.1 } } }));
    const io = { repo, now: NOW, env: { DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '' }, stdout: { write() {} }, stderr: { write() {} } };
    const refs = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
    const plan = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
      source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group',
      missions: [{ ref: 'G1', sequence: 1, tasks: refs.map((ref) => ({ ref, role: 'js-dev', type: 'feature' })) }] };
    writeFileSync(join(repo, 'plan.md'), `# p\n\`\`\`json delivery-plan\n${JSON.stringify(plan)}\n\`\`\`\n`);
    const code = await main(['plan', 'register', '--from', 'plan.md', '--id', 'reg-1', '--no-calibrate', '--no-bind', '--created-at', '2026-11-01T00:00:00Z'], io);
    if (code !== 0) throw new Error(`register exited ${code}`);
    const runFile = join(dir, 'plans', 'sec%2Frun-1.json'), run = JSON.parse(readFileSync(runFile, 'utf8'));
    const id = (ref) => run.items.find((i) => i.ref === ref).item_id;
    // T5 was renamed: dispatch cost recorded under its old id moves to it.
    run.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-old5': id('T5') } }; writeFileSync(runFile, JSON.stringify(run));
    const obs = [], snaps = [];
    const usage = (usd) => ({ m: { input: usd * 1e6 } });
    const hook = (ref, key, { usd = 1, itemId = id(ref), start = true, agent, crossed } = {}) => {
      const base = { user: null, host: 'claude', basis: 'observed', level: 'task', plan: 'sec/run-1', item_id: itemId, ref, source: 'hook', source_record_id: `claude:s:${key}`, agentId: key };
      if (start) obs.push(makeObservation({ ...base, event: 'dispatched', at: T, transition_id: `${itemId}/dispatched/${key}`, meta: { stage: 'build', version: 1 } }, { now: NOW }));
      const effort = agent === null ? {} : { turns: 3, usage: usage(usd), cost_usd: usd, split: 1, ...(crossed ? { crossed } : {}) };
      obs.push(makeObservation({ ...base, event: 'dispatch_ended', at: END, transition_id: `${itemId}/dispatch_ended/${key}`, meta: { stage: 'build', version: 1, agent: effort } }, { now: NOW }));
    };
    hook('T1', 'h1', { usd: 2 });
    hook('T3', 'h3', { usd: 1 });
    hook('T4', 'u4', { usd: 3, start: false });                         // ledger allocation, no known start
    hook('T5', 'h5', { usd: 1, itemId: 'sec/run-1/task-old5' });        // under the renamed id
    hook('T6', 'tb', { agent: null });                                  // no cost recorded; the store tombstones the key
    hook('T7', 'h7', { usd: 2, crossed: [id('T8')] });                  // crossed into T8
    for (const [key, desc, usd] of [['h3', 'T3', 2], ['r2', 'T2', 5], ['r8', 'T8', 1], ['r0', 'unrelated', 7]]) {
      snaps.push(snapshotFromTranscript({ firstTs: T, lastRecordAt: END, records: 2, complete: true, last_uuid: 'u', messages: { x: { model: 'm', input: usd * 1e6 } } }, { session: 's', agent_id: key, description: desc, now: NOW }));
    }
    snaps.push({ v: 'dispatch.v2', dispatch_key: 'claude:s:tb', retracted: true, reason: 'test', at: END });
    for (const ref of refs) obs.push(makeObservation({ user: null, host: 'cli', basis: 'observed', level: 'task', plan: 'sec/run-1', item_id: id(ref), ref, event: 'done', at: DONE, source: 'cli', source_record_id: `done-${ref}`, transition_id: `${id(ref)}/done/episode-1`, meta: { version: 1 } }, { now: NOW }));
    writeFileSync(join(dir, 'events-t.jsonl'), obs.map((o) => JSON.stringify(o)).join('\n') + '\n');
    writeFileSync(join(dir, 'dispatches-t.jsonl'), snaps.map((s) => JSON.stringify(s)).join('\n') + '\n');
    const tc = taskCosts(repo), c = collect(repo, { now: NOW });
    const scrub = (v) => JSON.parse(JSON.stringify(v).split(repo).join('<REPO>'));
    return scrub({ taskCosts: serializeTaskCosts(tc), collect: { samples: c.samples, landed: c.landed, left_out: c.left_out } });
  } finally { rmSync(repo, { recursive: true, force: true }); }
}
