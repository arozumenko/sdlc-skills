import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscript, handleStop } from './dispatch-hook.mjs';
import { deliveryDir, sessionsDir, sessionPath } from '../scripts/lib/paths.mjs';
import { readDispatches } from '../scripts/lib/dispatches.mjs';
import { saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
import { resolveObservations } from '../scripts/lib/events.mjs';
const tmp = () => mkdtempSync(join(tmpdir(), 'dispatch-capture-'));
const at = '2026-11-18T10:00:00.000Z';
const rows = () => [
  { type: 'user', uuid: 'u1', timestamp: at, gitBranch: 'recorded/branch', message: { content: 'Build T1.11' } },
  { type: 'assistant', uuid: 'a1', timestamp: at, gitBranch: 'changed', message: { id: 'stable', model: 'claude-sonnet-5-5', content: 'done', usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'assistant', uuid: 'a2', timestamp: at, message: { id: 'stable', model: 'claude-sonnet-5-5', content: 'done', usage: { output_tokens: 20, cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 4 } } } },
  { type: 'assistant', uuid: 'a3', timestamp: at, requestId: 'request', message: { model: 'other', content: 'done', usage: { input_tokens: 3 } } },
  { type: 'assistant', uuid: 'a4', timestamp: at, message: { model: 'other', content: 'done', usage: { output_tokens: 5 } } },
];
function child(repo, r = rows()) { const dir = join(repo, 'transcripts', 's1', 'subagents'); mkdirSync(dir, { recursive: true }); const path = join(dir, 'agent-a1.jsonl'); writeFileSync(path, r.map(JSON.stringify).join('\n') + '\n'); writeFileSync(path.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'outside', description: 'Build T1.11' })); return { session_id: 's1', agent_id: 'a1', agent_transcript_path: path }; }
function plan(repo, status = 'open', bind = true) { const agent = join(repo, '.claude', 'agents', 'js-dev'); mkdirSync(agent, { recursive: true }); writeFileSync(join(agent, 'AGENT.md'), 'role'); saveRun(repo, { run: 'p/r', campaign_id: 'p', run_id: 'r', status, version: 1, roster: makeRoster(repo, ['feature-development']), items: [] }); if (bind) { mkdirSync(sessionsDir(repo), { recursive: true }); writeFileSync(sessionPath(repo, 'claude', 's1'), JSON.stringify({ plan: 'p/r' })); } }

test('capture parser preserves aggregate usage while exposing stable identity, anonymous usage and terminal evidence', () => {
 const repo = tmp(), payload = child(repo); const tr = parseTranscript(payload.agent_transcript_path);
 assert.deepEqual(tr.messages.stable, { model: 'claude-sonnet-5-5', input: 10, output: 20, cache_write: 6, cache_write_1h: 4, cache_read: 0 });
 assert.equal(tr.messages.request.input, 3); assert.deepEqual(Object.keys(tr.messages).sort(), ['request', 'stable']);
 assert.deepEqual(tr.anon, { records: 1, usage: { other: { input: 0, output: 5, cache_write: 0, cache_write_1h: 0, cache_read: 0 } } });
 assert.equal(tr.usage.other.input, 3); assert.equal(tr.usage.other.output, 5); assert.equal(tr.branch, 'recorded/branch');
 assert.equal(tr.last_uuid, 'a4'); assert.equal(tr.lastRecordAt, at); assert.equal(tr.torn, false);
});
test('parser captures last well-formed uuid and torn suffix without changing conservative legacy completion', () => {
 const repo = tmp(), p = child(repo); writeFileSync(p.agent_transcript_path, readFileSync(p.agent_transcript_path, 'utf8') + '{"type":');
 const tr = parseTranscript(p.agent_transcript_path); assert.equal(tr.last_uuid, 'a4'); assert.equal(tr.torn, true); assert.equal(tr.complete, false);
});
for (const guard of ['no-plan', 'unbound', 'closed', 'non-roster']) test(`hook captures ${guard} dispatch before ledger guards`, () => {
 const repo = tmp(), p = child(repo); if (guard !== 'no-plan') plan(repo, guard === 'closed' ? 'closed' : 'open', guard !== 'unbound');
 const result = handleStop(p, { repo, now: Date.parse(at) });
 assert.equal(readDispatches(repo).snapshots.length, 1); assert.equal(readDispatches(repo).snapshots[0].branch, 'recorded/branch');
 assert.deepEqual(result.wrote, []); assert.equal(resolveObservations(repo).active.length, 0); if (guard === 'non-roster') assert.equal(result.diagnostic, null);
});
test('no-child records one gap per identity before admission and emits no per-agent missing transcript diagnostics', () => {
 const repo = tmp(); plan(repo); const p = { session_id: 's1', agent_id: 'missing' };
 handleStop(p, { repo, now: Date.parse(at) }); handleStop(p, { repo, now: Date.parse(at) + 1000 });
 assert.deepEqual([...readDispatches(repo).gaps], ['claude:s1:missing']);
 const files = readdirSync(deliveryDir(repo)); const diagnostics = files.filter((f) => f.startsWith('diagnostics-')).flatMap((f) => readFileSync(join(deliveryDir(repo), f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
 assert.ok(!diagnostics.some((d) => ['no-transcript', 'unknown-role'].includes(d.kind)));
 const gapLines = files.filter((f) => f.startsWith('dispatches-')).flatMap((f) => readFileSync(join(deliveryDir(repo), f), 'utf8').trim().split('\n').map(JSON.parse)).filter((r) => r.gap);
 assert.equal(gapLines.length, 2);
});
