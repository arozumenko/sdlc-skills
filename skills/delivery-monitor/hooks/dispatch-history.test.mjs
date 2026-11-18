import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStop } from './dispatch-hook.mjs';
import { saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
import { historyPath } from '../scripts/lib/history.mjs';
import { deliveryDir, sessionPath, sessionsDir, whoAmI } from '../scripts/lib/paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-hookhist-'));
const R = 'demo/run-1';
const NOW = Date.parse('2026-09-16T10:00:05Z');
const run = { run: R, campaign_id: 'demo', run_id: 'run-1', version: 1, status: 'open', registered_at: '2026-09-16T08:00:00.000Z', updated_at: '2026-09-16T08:00:00.000Z', items: [
  { item_id: `${R}/campaign`, ref: 'demo', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
  { item_id: `${R}/task-task-023`, ref: 'TASK-023', level: 'task', parent_item_id: `${R}/mission-g1`, branch: 'task/task-023' }] };
const setup = () => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true });
  for (const role of ['js-dev', 'tech-lead']) { const d = join(repo, '.claude', 'agents', role); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), 'role'); }
  saveRun(repo, { ...run, roster: makeRoster(repo, ['feature-development']) });
  return repo;
};
const transcripts = () => {
  const proj = tmp(); const parent = join(proj, 's1.jsonl'); writeFileSync(parent, `${JSON.stringify({ type: 'user', timestamp: '2026-09-16T09:00:00.000Z', message: { role: 'user', content: 'hi' } })}\n`);
  const dir = join(proj, 's1', 'subagents'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a1.jsonl'), `${JSON.stringify({ type: 'user', timestamp: '2026-09-16T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Implement TASK-023.' }] } })}\n${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', message: { role: 'assistant', content: 'done' } })}\n`);
  writeFileSync(join(dir, 'a1.meta.json'), JSON.stringify({ agentType: 'js-dev', description: 'Implement TASK-023' }));
  return parent;
};
const branchRepo = () => { const d = tmp(); const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }; execFileSync('git', ['init', '-q', '-b', 'task/task-023'], { cwd: d }); execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'x'], { cwd: d, env }); return d; };
const payload = (cwd) => ({ session_id: 's1', agent_id: 'a1', transcript_path: transcripts(), hook_event_name: 'SubagentStop', cwd });
const histLines = (repo) => { try { return readFileSync(historyPath(repo, whoAmI(repo).slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const BOUND = `{"host":"claude","session":"s1","plan":"${R}","at":"${new Date(NOW).toISOString()}","bound_by":"branch"}\n`;

test('G1: hook auto-bind writes the same session file bytes as before and appends one branch record', () => {
  const repo = setup(); const res = handleStop(payload(branchRepo()), { repo, now: NOW });
  assert.equal(res.wrote.length, 2);
  assert.equal(readFileSync(sessionPath(repo, 'claude', 's1'), 'utf8'), BOUND);
  assert.deepEqual(histLines(repo), [{ v: 'history.v1', kind: 'session', key: 'claude:s1', by: 'branch', recorded_at: new Date(NOW).toISOString(), prev: { state: 'missing' }, next: { plan: R, at: new Date(NOW).toISOString(), bound_by: 'branch' } }]);
  // an already-bound session is not rebound, so a later stop adds no record
  handleStop(payload(tmp()), { repo, now: NOW });
  assert.equal(histLines(repo).length, 1);
});

test('G5: a state-write failure in the hook returns the unbound diagnostic and writes no record', () => {
  const repo = setup(); writeFileSync(sessionsDir(repo), 'a regular file where the sessions dir should be');
  const res = handleStop(payload(branchRepo()), { repo, now: NOW });
  assert.deepEqual(res, { wrote: [], diagnostic: 'unbound-session' });
  assert.equal(histLines(repo).length, 0); assert.equal(existsSync(historyPath(repo, whoAmI(repo).slug)), false);
});

test('G7: an append failure in the hook leaves the result, the session file and the ledger identical', () => {
  const control = setup(), broken = setup();
  mkdirSync(historyPath(broken, whoAmI(broken).slug), { recursive: true });
  const a = handleStop(payload(branchRepo()), { repo: control, now: NOW }), b = handleStop(payload(branchRepo()), { repo: broken, now: NOW });
  const shape = (r) => ({ n: r.wrote.length, diagnostic: r.diagnostic, results: r.wrote.map((w) => w.result) });
  assert.deepEqual(shape(b), shape(a)); assert.equal(b.wrote.length, 2);
  assert.equal(readFileSync(sessionPath(broken, 'claude', 's1'), 'utf8'), BOUND);
  assert.equal(readFileSync(sessionPath(broken, 'claude', 's1'), 'utf8'), readFileSync(sessionPath(control, 'claude', 's1'), 'utf8'));
  const events = (repo) => readFileSync(join(deliveryDir(repo), `events-${whoAmI(repo).slug}.jsonl`), 'utf8');
  assert.equal(events(broken).replace(/"recorded_at":"[^"]*"/g, ''), events(control).replace(/"recorded_at":"[^"]*"/g, ''));
});
