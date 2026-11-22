// Baseline for the calibration-from-attributed-dispatches change: the read-command output of a fixed scenario with hooked and
// recovered dispatches. golden.json was produced by running runScenario with the `main`, `makeObservation` and
// `snapshotFromTranscript` of the code from before that change, so the test compares against an independent baseline and never
// against the code under test. To regenerate after an intended output change, run runScenario and write its result to golden.json.
// It has been regenerated since for intended label changes, through legacyScenario (the tests compare through it). Each
// time, the new file was checked to differ from the old one only in those label lines.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const T = '2026-11-02T10:00:00.000Z', END = '2026-11-02T10:10:00.000Z', DONE = '2026-11-03T10:00:00.000Z';
export const READS = [['report'], ['report', '--json'], ['report', '--html'], ['spend'], ['spend', '--json'], ['spend', '--by', 'plan'], ['plan', 'list'], ['plan', 'show', '--plan', 'sec/run-1']];

export async function runScenario({ main, makeObservation, snapshotFromTranscript }, { skillDir = resolve(fileURLToPath(new URL('../..', import.meta.url))) } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-tcbase-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@x'); git('config', 'user.name', 'Tester');
    const dir = join(repo, '.agents', 'telemetry', 'delivery'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prices.json'), JSON.stringify({ as_of: '2026-11-01', models: { m: { input: 1, output: 2, cache_write: 3, cache_read: 0.1 } } }));
    const tokens = [[realpathSync(repo), '<REPO>'], [repo, '<REPO>'], [realpathSync(skillDir), '<SKILL>'], [skillDir, '<SKILL>'], [basename(repo), '<TMP>']];
    const clean = (s) => tokens.reduce((t, [from, to]) => t.split(from).join(to), s).replace(/[0-9a-f]{64}/g, '<SHA>').replace(/"bytes": \d+/g, '"bytes": 0');
    const cli = async (argv) => {
      let stdout = '', stderr = '';
      const code = await main(argv, { repo, now: NOW, env: { DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '' }, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } });
      return { argv, code, stdout: clean(stdout), stderr: clean(stderr) };
    };
    const plan = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
      source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group',
      missions: [{ ref: 'G1', sequence: 1, tasks: ['T1', 'T2', 'T3'].map((ref) => ({ ref, role: 'js-dev', type: 'feature', estimate: { unit: 'usd', low: 1, high: 4, tier: 'ROM', proposed_by: 'tl', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'tl', accepted_at: '2026-11-01T00:00:00Z' } })) }] };
    writeFileSync(join(repo, 'plan.md'), `# p\n\`\`\`json delivery-plan\n${JSON.stringify(plan)}\n\`\`\`\n`);
    const reg = await cli(['plan', 'register', '--from', 'plan.md', '--id', 'reg-1', '--no-calibrate', '--no-bind', '--created-at', '2026-11-01T00:00:00Z']);
    const run = JSON.parse(execFileSync('cat', [join(dir, 'plans', 'sec%2Frun-1.json')], { encoding: 'utf8' }));
    const id = (ref) => run.items.find((i) => i.ref === ref).item_id;
    const obs = [], snaps = [];
    const usage = (usd) => ({ m: { input: usd * 1e6 } });
    // T1: hooked only. T3: hooked and also captured. T2: captured only (recovered by its description).
    for (const [ref, key, usd] of [['T1', 'h1', 2], ['T3', 'h3', 1]]) {
      const base = { user: null, host: 'claude', basis: 'observed', level: 'task', plan: 'sec/run-1', item_id: id(ref), ref, source: 'hook', source_record_id: `claude:s:${key}`, agentId: key };
      obs.push(makeObservation({ ...base, event: 'dispatched', at: T, transition_id: `${id(ref)}/dispatched/${key}`, meta: { stage: 'build', version: 1 } }, { now: NOW }));
      obs.push(makeObservation({ ...base, event: 'dispatch_ended', at: END, transition_id: `${id(ref)}/dispatch_ended/${key}`, meta: { stage: 'build', version: 1, agent: { turns: 3, usage: usage(usd), cost_usd: usd, split: 1 } } }, { now: NOW }));
    }
    for (const [key, desc, usd] of [['h3', 'T3', 2], ['r2', 'T2', 5], ['r0', 'unrelated', 7]]) {
      snaps.push(snapshotFromTranscript({ firstTs: T, lastRecordAt: END, records: 2, complete: true, last_uuid: 'u', messages: { x: { model: 'm', input: usd * 1e6 } } }, { session: 's', agent_id: key, description: desc, now: NOW }));
    }
    for (const ref of ['T1', 'T2', 'T3']) obs.push(makeObservation({ user: null, host: 'cli', basis: 'observed', level: 'task', plan: 'sec/run-1', item_id: id(ref), ref, event: 'done', at: DONE, source: 'cli', source_record_id: `done-${ref}`, transition_id: `${id(ref)}/done/episode-1`, meta: { version: 1 } }, { now: NOW }));
    writeFileSync(join(dir, 'events-t.jsonl'), obs.map((o) => JSON.stringify(o)).join('\n') + '\n');
    writeFileSync(join(dir, 'dispatches-t.jsonl'), snaps.map((s) => JSON.stringify(s)).join('\n') + '\n');
    const reads = []; for (const argv of READS) reads.push(await cli(argv));
    return { register: { code: reg.code }, reads };
  } finally { rmSync(repo, { recursive: true, force: true }); }
}
