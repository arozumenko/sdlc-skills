// Baseline for the write-history change: the state files and read-command output of a fixed scenario.
// golden.json was produced by running runScenario with `main` from the last version that kept no history, so the
// history tests compare against an independent baseline and never against the code under test. To regenerate after
// an intended output change, run runScenario(main) and write its result to golden.json.
// It has been regenerated since for intended label changes, through legacyScenario (the tests compare through it). Each
// time, the new file was checked to differ from the old one only in those label lines.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const T0 = Date.parse('2026-09-16T10:00:00Z'), HOUR = 3600e3;
const iso = (t) => new Date(t).toISOString();
const RUN = 'demo/run-1';
const plan = (version) => ({
  campaign_id: 'demo', run_id: 'run-1', version, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
  source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'demo' }, mission_kind: 'group',
  missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', branch: 'task/task-001' }, { ref: 'TASK-002' }] }],
});
export const READS = [['plan', 'show', '--plan', RUN], ['plan', 'list'], ['status'], ['report', '--json'], ['spend'], ['spend', '--json'], ['spend', '--by', 'plan'], ['calibrate', '--dry-run', '--json'], ['doctor']];

/** Runs the scenario in a fresh temp repo. `between` is called after the writes and before the reads. `skillDir` is the skill
 * directory `main` was loaded from (its price table is listed as an input by `spend`). */
export async function runScenario(main, { between = () => {}, skillDir = resolve(fileURLToPath(new URL('../..', import.meta.url))) } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-baseline-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@x'); git('config', 'user.name', 'Tester');
  for (const role of ['js-dev', 'tech-lead']) { const d = join(repo, '.claude', 'agents', role); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), '# role\n'); }
  // The temp path is part of the run file, so the path and the run file's own hash and size are replaced by fixed tokens.
  // The price table is not part of this baseline either: its hash and size are replaced too, and so is its date in the report.
  const tokens = [[realpathSync(repo), '<REPO>'], [repo, '<REPO>'], [realpathSync(skillDir), '<SKILL>'], [skillDir, '<SKILL>']];
  const clean = (s) => tokens.reduce((t, [from, to]) => t.split(from).join(to), s)
    .replace(/(<SKILL>\/references\/prices\.json sha256=)[0-9a-f]{64}/g, '$1<PRICES>')
    .replace(/(<SKILL>\/references\/prices\.json",\s*"sha256": ")[0-9a-f]{64}(",\s*"bytes": )\d+/g, '$1<PRICES>$20')
    .replace(/("prices_as_of": )"[^"]*"/g, '$1"<PRICES-DATE>"')
    // The run file holds the temp path, so its size depends on how long that path is on this machine.
    .replace(/("sha256": "<RUN-FILE-SHA256>",\s*"bytes": )\d+/g, '$10');
  const cli = async (argv, now, env = {}) => {
    let stdout = '', stderr = '';
    const code = await main(argv, { repo, now, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, env: { DELIVERY_NO_SYNC: '1', ...env } });
    return { argv: clean(argv.join(' ')), code, stdout: clean(stdout), stderr: clean(stderr) };
  };
  const planFile = (v) => { const f = join(repo, 'plan.md'); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(plan(v))}\n\`\`\`\n`); return f; };
  const S1 = { CLAUDE_CODE_SESSION_ID: 's1' };
  const writes = [
    await cli(['plan', 'register', '--from', planFile(1), '--id', 'reg-1'], T0, S1),
    await cli(['event', 'TASK-001', 'dispatched', '--id', 'e1', '--at', iso(T0 + HOUR)], T0 + HOUR),
    await cli(['plan', 'roster', '--plan', RUN, '--agents', 'js-dev,tech-lead'], T0 + 2 * HOUR),
    await cli(['plan', 'close', RUN], T0 + 3 * HOUR),
    await cli(['plan', 'register', '--from', planFile(2), '--id', 'reg-2', '--at', iso(T0 + 4 * HOUR)], T0 + 4 * HOUR, S1),
    await cli(['session', 'set', '--host', 'claude', '--session', 's9', '--plan', RUN], T0 + 5 * HOUR),
  ];
  const dir = join(repo, '.agents', 'telemetry', 'delivery');
  const file = (...p) => clean(readFileSync(join(dir, ...p), 'utf8'));
  const files = { 'sessions/claude%3As1.json': file('sessions', 'claude%3As1.json'), 'sessions/claude%3As9.json': file('sessions', 'claude%3As9.json'), 'plans/demo%2Frun-1.json': file('plans', 'demo%2Frun-1.json'), 'events-tester.jsonl': file('events-tester.jsonl') };
  tokens.push([createHash('sha256').update(readFileSync(join(dir, 'plans', 'demo%2Frun-1.json'))).digest('hex'), '<RUN-FILE-SHA256>']);
  between(dir);
  const reads = []; for (const argv of READS) reads.push(await cli(argv, T0 + 6 * HOUR));
  return { writes, files, reads };
}
