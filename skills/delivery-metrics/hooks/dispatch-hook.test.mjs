import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStage, resolveRefs, handleStop, ownerRepo, parseTranscript, findChildTranscript } from './dispatch-hook.mjs';
import { loadRun, saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
import { resolveObservations } from '../scripts/lib/events.mjs';
import { deliveryDir, sessionsDir, sessionPath } from '../scripts/lib/paths.mjs';

const SCRIPT = fileURLToPath(new URL('./dispatch-hook.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-hook-'));
const R = 'sec/run-1';
const run = { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', roster_agents: ['js-dev', 'tech-lead'], items: [
  { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
  { item_id: `${R}/task-task-023`, ref: 'TASK-023', level: 'task', parent_item_id: `${R}/mission-g1`, branch: 'task/task-023' }, { item_id: `${R}/task-task-034`, ref: 'TASK-034', level: 'task', parent_item_id: `${R}/mission-g1`, branch: 'task/task-034' }] };
const setup = ({ bind = true } = {}) => { const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true }); for (const role of ['js-dev', 'tech-lead', 'test-automation-lead', 'qa-auditor']) { const d = join(repo, '.claude', 'agents', role); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), 'role'); } const roster = makeRoster(repo, ['feature-development', 'test-automation']); saveRun(repo, { ...run, roster, roster_agents: roster.agents }); if (bind) { mkdirSync(sessionsDir(repo), { recursive: true }); writeFileSync(sessionPath(repo, 'claude', 'sess-1'), JSON.stringify({ host: 'claude', session: 'sess-1', plan: R })); } return repo; };
const transcripts = ({ agentType = 'js-dev', description = 'Implement TASK-023 build-report core', first = 'You are js-dev. Implement TASK-023.', t0 = '2026-09-16T09:00:00.000Z', t1 = '2026-09-16T10:00:00.000Z', agentId = 'agent-1', complete = true, session = 'sess-1' } = {}) => {
  const proj = tmp(); const parent = join(proj, `${session}.jsonl`); writeFileSync(parent, `${JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: 'hi' } })}\n`);
  const dir = join(proj, session, 'subagents'); mkdirSync(dir, { recursive: true });
  const lines = [JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: [{ type: 'text', text: first }] } })]; if (complete) lines.push(JSON.stringify({ type: 'assistant', timestamp: t1, message: { role: 'assistant', content: 'done' } }));
  writeFileSync(join(dir, `${agentId}.jsonl`), `${lines.join('\n')}\n`); writeFileSync(join(dir, `${agentId}.meta.json`), JSON.stringify({ agentType, description }));
  return { parent, child: join(dir, `${agentId}.jsonl`) };
};
const payload = (t, over = {}) => ({ session_id: 'sess-1', agent_id: 'agent-1', transcript_path: t.parent, hook_event_name: 'SubagentStop', ...over });
const NOW = Date.parse('2026-09-16T10:00:05Z');

test('classifyStage', () => {
  assert.equal(classifyStage('Implement TASK-1'), 'build'); assert.equal(classifyStage('Build the thing'), 'build'); assert.equal(classifyStage('Review PR for TASK-1'), 'review');
  assert.equal(classifyStage('fix round 2 for TASK-1'), 'fix'); assert.equal(classifyStage('TASK-1: address review 1'), 'fix'); assert.equal(classifyStage('mini-gate'), 'gate'); assert.equal(classifyStage('merge task'), 'merge'); assert.equal(classifyStage('write docs'), 'other');
});

test('resolveRefs: description, unique message match, branch alias, ambiguity, whole word', () => {
  assert.deepEqual(resolveRefs(run, { description: 'Implement TASK-023', firstUserText: 'TASK-034 also mentioned' }).items.map((i) => i.ref), ['TASK-023']);
  assert.deepEqual(resolveRefs(run, { description: 'boilerplate', firstUserText: 'You are js-dev … now implement TASK-034 …' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(run, { description: '', firstUserText: 'TASK-023 and TASK-034' }).how, 'ambiguous');
  assert.deepEqual(resolveRefs(run, { description: '', firstUserText: 'nothing', branch: 'task/task-034' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(run, { description: 'TASK-0230', firstUserText: '' }).items.length, 0);
});

test('findChildTranscript: documented shape; agent_transcript_path accepted only when correlated to session and agent', () => {
  const t = transcripts();
  assert.equal(findChildTranscript(payload(t)).path, t.child);
  const foreign = transcripts({ session: 'sess-9' });
  assert.equal(findChildTranscript({ session_id: 'sess-1', agent_id: 'agent-1', transcript_path: t.parent, agent_transcript_path: foreign.child }).path, t.child, 'uncorrelated explicit path ignored, documented shape used');
  assert.equal(findChildTranscript({ session_id: 'sess-1', agent_id: 'agent-2', transcript_path: t.parent, agent_transcript_path: t.child }), null, 'basename must match the agent id');
});

test('handleStop: emits dispatched/dispatch_ended; retry SKIPs; grown transcript revises; user-only transcript emits nothing (F13)', () => {
  const repo = setup(); const t = transcripts();
  const r = handleStop(payload(t), { repo, now: NOW }); assert.equal(r.diagnostic, null); assert.deepEqual(r.wrote.map((w) => w.result), ['EVENT', 'EVENT']);
  let { active } = resolveObservations(repo); const d = active.find((o) => o.event === 'dispatched');
  assert.equal(d.item_id, `${R}/task-task-023`); assert.equal(d.at, '2026-09-16T09:00:00.000Z'); assert.equal(d.source, 'hook'); assert.equal(d.host, 'claude'); assert.equal(d.transition_id, `${R}/task-task-023/dispatched/agent-1`);
  assert.equal(d.meta.stage, 'build'); assert.equal(d.meta.version, 1); assert.equal(d.role, 'js-dev'); assert.equal(d.session, 'sess-1'); assert.equal(d.agentId, 'agent-1'); assert.equal(d.label, 'TASK-023 build'); assert.equal(d.source_record_id, 'claude:sess-1:agent-1');
  assert.equal(active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T10:00:00.000Z');
  assert.deepEqual(handleStop(payload(t), { repo, now: NOW }).wrote.map((w) => w.result), ['SKIP', 'SKIP']);
  writeFileSync(t.child, `${readFileSync(t.child, 'utf8')}${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T11:00:00.000Z', message: { content: 'more' } })}\n`);
  assert.deepEqual(handleStop(payload(t), { repo, now: NOW }).wrote.map((w) => [w.result, w.revision]), [['SKIP', 0], ['EVENT', 1]]);
  assert.equal(resolveObservations(repo).active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T11:00:00.000Z');
  // F13 (revised from the brief): a user-only transcript is not evidence that the subagent ever
  // started real work — the documented shape's child transcript begins with the host's own dispatch
  // payload (the user/prompt record), so a file containing *only* that record proves nothing beyond
  // "the host wrote a prompt". Emit nothing at all (no `dispatched` either), just the diagnostic.
  const inc = transcripts({ agentId: 'agent-5', complete: false }); const ri = handleStop(payload(inc, { agent_id: 'agent-5' }), { repo, now: NOW });
  assert.equal(ri.diagnostic, 'incomplete-transcript'); assert.deepEqual(ri.wrote, []); assert.equal(resolveObservations(repo).active.filter((o) => o.agentId === 'agent-5').length, 0);
});

test('F13: progress row + torn trailing JSON is not completion evidence — dispatched observed, dispatch_ended withheld', () => {
  const repo = setup();
  const t = transcripts({ agentId: 'agent-20' }); // establishes the sess-1/subagents dir
  const dir = dirname(t.child);
  const child = join(dir, 'agent-21.jsonl');
  writeFileSync(child, [
    JSON.stringify({ type: 'user', timestamp: '2026-09-16T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Implement TASK-023.' }] } }),
    // A progress/tool-use row: non-user, timestamped, but no text block or stop_reason — must NOT
    // be accepted as completion evidence merely for being "some non-user record after a user record".
    JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T09:30:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }),
    // Torn/truncated trailing line — must be skipped, not treated as (or as concealing) completion.
    '{"type":"assistant","timestamp":"2026-09-16T09:4',
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'agent-21.meta.json'), JSON.stringify({ agentType: 'js-dev', description: 'Implement TASK-023' }));
  const r = handleStop(payload(t, { agent_id: 'agent-21' }), { repo, now: NOW });
  assert.equal(r.diagnostic, 'incomplete-transcript');
  assert.deepEqual(r.wrote.map((w) => w.result), ['EVENT']);
  const { active } = resolveObservations(repo);
  const mine = active.filter((o) => o.agentId === 'agent-21');
  assert.equal(mine.length, 1); assert.equal(mine[0].event, 'dispatched'); assert.equal(mine[0].item_id, `${R}/task-task-023`);
});

test('F9: hook re-fire after a plan re-cut (run.version bump) SKIPs — semantic identity excludes meta.version', () => {
  const repo = setup();
  const t = transcripts({ agentId: 'agent-30' });
  const first = handleStop(payload(t, { agent_id: 'agent-30' }), { repo, now: NOW });
  assert.deepEqual(first.wrote.map((w) => w.result), ['EVENT', 'EVENT']);
  const saved = loadRun(repo, R);
  saveRun(repo, { ...saved, version: saved.version + 1 });
  const retry = handleStop(payload(t, { agent_id: 'agent-30' }), { repo, now: NOW });
  assert.deepEqual(retry.wrote.map((w) => w.result), ['SKIP', 'SKIP']);
});

test('handleStop: fix stage adds rework_observed; unresolved/ambiguous → unattributed pair', () => {
  const repo = setup();
  handleStop(payload(transcripts({ description: 'fix round 1 for TASK-034', agentId: 'agent-2' }), { agent_id: 'agent-2' }), { repo, now: NOW });
  assert.ok(resolveObservations(repo).active.some((o) => o.event === 'rework_observed' && o.item_id === `${R}/task-task-034`));
  handleStop(payload(transcripts({ description: 'tidy docs', first: 'no ids here', agentId: 'agent-3' }), { agent_id: 'agent-3' }), { repo, now: NOW });
  const un = resolveObservations(repo).active.filter((o) => o.meta.unattributed); assert.equal(un.length, 2); assert.equal(un[0].item_id, null); assert.equal(un[0].plan, R);
});

test('guards: no open plan → nothing; unbound session → diagnostic; foreign-but-installed role → nothing; unknown role → admitted + diagnostic; no transcript → diagnostic', () => {
  const t = transcripts();
  const none = tmp(); assert.deepEqual(handleStop(payload(t), { repo: none, now: NOW }), { wrote: [], diagnostic: null }); assert.ok(!existsSync(deliveryDir(none)));
  const unbound = setup({ bind: false }); assert.equal(handleStop(payload(t), { repo: unbound, now: NOW }).diagnostic, 'unbound-session'); assert.equal(resolveObservations(unbound).active.length, 0); assert.ok(readdirSync(deliveryDir(unbound)).some((f) => f.startsWith('diagnostics-')));
  const positive = setup(); assert.equal(handleStop(payload(transcripts({ agentType: 'test-automation-lead' })), { repo: positive, now: NOW }).wrote.length, 2);
  const foreign = setup(); assert.deepEqual(handleStop(payload(transcripts({ agentType: 'qa-auditor' })), { repo: foreign, now: NOW }), { wrote: [], diagnostic: null }, 'qa-auditor is not in the plan roster even if installed');
  const unknown = setup(); const ru = handleStop(payload(transcripts({ agentType: '' })), { repo: unknown, now: NOW }); assert.equal(ru.diagnostic, 'unknown-role'); assert.equal(ru.wrote.length, 2);
  const missing = setup(); const rm = handleStop(payload(t, { agent_id: 'agent-9' }), { repo: missing, now: NOW }); assert.equal(rm.diagnostic, 'no-transcript'); assert.equal(rm.wrote.length, 0);
});

test('diagnostics file lines: exactly {at, kind, session, agent_id, detail} (F19)', () => {
  const unbound = setup({ bind: false });
  handleStop(payload(transcripts()), { repo: unbound, now: NOW });
  const file = readdirSync(deliveryDir(unbound)).find((f) => f.startsWith('diagnostics-'));
  const line = readFileSync(join(deliveryDir(unbound), file), 'utf8').trim().split('\n')[0];
  const rec = JSON.parse(line);
  assert.deepEqual(Object.keys(rec).sort(), ['agent_id', 'at', 'detail', 'kind', 'session']);
  assert.equal(rec.kind, 'unbound-session'); assert.equal(rec.session, 'sess-1'); assert.equal(rec.agent_id, 'agent-1');
});

test('ownerRepo: linked worktree (any path) resolves to the main checkout via worktree list; plain dirs pass through', () => {
  const main = tmp(); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: main }); execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'x'], { cwd: main, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  mkdirSync(join(main, '.agents', 'telemetry', 'delivery'), { recursive: true });
  const wt = join(tmp(), 'elsewhere'); execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: main });
  assert.equal(ownerRepo({ cwd: wt }, {}), realpathSync(main)); assert.equal(ownerRepo({ cwd: main }, {}), realpathSync(main)); assert.equal(ownerRepo({}, { CLAUDE_PROJECT_DIR: main }), realpathSync(main));
  assert.ok(parseTranscript('/nonexistent').firstTs === null);
});

test('register and bind in an arbitrary linked worktree, capture there, report one owner ledger', async () => {
  const { main } = await import('../scripts/delivery.mjs');
  const { assemble } = await import('../scripts/lib/report.mjs');
  const mainRepo = tmp();
  const g = (...args) => execFileSync('git', ['-C', mainRepo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(tmp(), 'arbitrary-linked-checkout'); g('worktree', 'add', '-q', '-b', 'feature', wt);
  const agents = join(mainRepo, '.claude', 'agents', 'js-dev'); mkdirSync(agents, { recursive: true }); writeFileSync(join(agents, 'AGENT.md'), 'role');
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-09-14T00:00:00Z', source_epoch: { from: '2026-09-14T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-023', role: 'js-dev' }] }] };
  writeFileSync(join(wt, 'plan.json'), JSON.stringify(block));
  const io = { write() {} };
  const call = (args) => main(args, { repo: wt, now: NOW, stdout: io, stderr: io, env: { DELIVERY_NO_SYNC: '1' } });
  assert.equal(await call(['plan', 'register', '--from', 'plan.json', '--id', 'reg', '--created-at', '2026-09-14T00:00:00Z']), 0);
  assert.equal(await call(['session', 'set', '--host', 'claude', '--session', 'sess-1', '--plan', R]), 0);
  assert.equal(handleStop(payload(transcripts(), { cwd: wt }), { repo: wt, now: NOW }).wrote.length, 2);
  const options = { since: '2026-09-14T00:00:00Z', cutoff: '2026-09-17T00:00:00Z', now: NOW };
  assert.deepEqual(assemble(mainRepo, options), assemble(wt, options));
  assert.equal(resolveObservations(mainRepo).active.filter((o) => o.source === 'hook').length, 2);
  assert.equal(existsSync(join(wt, '.agents', 'telemetry', 'delivery')), false);
  assert.equal(existsSync(sessionPath(mainRepo, 'claude', 'sess-1')), true);
});

test('script: malformed stdin / missing fields → exit 0, no stdout, no files', () => {
  const repo = setup();
  for (const input of ['not json', '{}', JSON.stringify({ session_id: 'sess-1' })]) assert.equal(execFileSync('node', [SCRIPT, '--stop'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DELIVERY_NO_SYNC: '1' } }), '');
  assert.equal(resolveObservations(repo).active.length, 0);
});
