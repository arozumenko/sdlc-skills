import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toClaudeRecords, readSubagents, readEvents, sessionsForCwd } from './copilot-events.mjs';
import { extractSignals, promptFingerprintOf, finalResultOf } from './distill-sessions.mjs';

// Event shapes are verbatim from a real Copilot CLI 1.0.63 stream.
const ev = (type, data, extra = {}) => ({ type, data, timestamp: '2026-04-22T14:42:56.351Z', ...extra });

const START = ev('session.start', {
  sessionId: 's1',
  context: { cwd: '/repo', branch: 'feat/x', gitRoot: '/repo' },
});

test('session.start seeds cwd and branch onto every record', () => {
  const recs = toClaudeRecords([START, ev('user.message', { content: 'hi' })]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].cwd, '/repo');
  assert.equal(recs[0].gitBranch, 'feat/x');
  assert.equal(recs[0].timestamp, '2026-04-22T14:42:56.351Z');
});

// The distiller derives date/duration/branch from these fields; dropping them
// renders every Copilot session as "? / 0 min".
test('the raw prompt is kept, not the context-injected rewrite', () => {
  const recs = toClaudeRecords([START, ev('user.message', {
    content: 'automate CALCRATE-166',
    transformedContent: '<agent_instructions>…20KB of skill context…</agent_instructions>',
  })]);
  assert.equal(recs[0].message.content, 'automate CALCRATE-166');
  // Otherwise every dispatch fingerprints as unique and repeat detection dies.
  assert.doesNotMatch(JSON.stringify(recs), /agent_instructions/);
});

test('tool requests become tool_use blocks under their Claude names', () => {
  const recs = toClaudeRecords([START, ev('assistant.message', {
    content: 'working',
    toolRequests: [
      { toolCallId: 't1', name: 'bash', arguments: { command: 'ls' } },
      { toolCallId: 't2', name: 'edit', arguments: { path: '/repo/a.js', old_str: 'x', new_str: 'y' } },
      { toolCallId: 't3', name: 'Tracker_MCP-JiraIntegration_search_using_jql', arguments: { jql: 'x' } },
    ],
  })]);
  const blocks = recs[0].message.content;
  assert.equal(blocks[0].type, 'text');
  assert.deepEqual(blocks.slice(1).map((b) => b.name), ['Bash', 'Edit', 'Tracker_MCP-JiraIntegration_search_using_jql']);
  // file_path, not path: the churn counter reads Claude's key.
  assert.equal(blocks[2].input.file_path, '/repo/a.js');
});

// success===false is the ONLY error signal; a missing field must not invent one.
test('completions become tool_result blocks; only explicit failure is an error', () => {
  const recs = toClaudeRecords([
    START,
    ev('tool.execution_complete', { toolCallId: 't1', success: true, result: { content: 'ok' } }),
    ev('tool.execution_complete', { toolCallId: 't2', success: false, result: { content: 'boom' } }),
    ev('tool.execution_complete', { toolCallId: 't3', result: { content: 'unknown' } }),
  ]);
  const flags = recs.map((r) => r.message.content[0].is_error);
  assert.deepEqual(flags, [false, true, false]);
});

test('end to end: extractSignals counts the error against the right tool', () => {
  const recs = toClaudeRecords([
    START,
    ev('user.message', { content: 'go' }),
    ev('assistant.message', { toolRequests: [{ toolCallId: 't1', name: 'bash', arguments: { command: 'npm test' } }] }),
    ev('tool.execution_complete', { toolCallId: 't1', success: false, result: { content: 'exit 1' } }),
  ]);
  const sig = extractSignals(recs);
  assert.equal(sig.toolErrors['Bash: error'], 1);
  assert.equal(sig.userTurns, 2);      // the prompt + the tool result
  assert.equal(sig.assistantTurns, 1);
});

const SUB_EVENTS = [
  START,
  ev('assistant.message', {
    toolRequests: [{ toolCallId: 'a1', name: 'task', arguments: { name: 'test-analyst', prompt: 'Analyse TC-1 live.' } }],
  }),
  ev('subagent.started', { toolCallId: 'a1', agentName: 'test-analyst', agentDescription: 'the analyst' }),
  ev('assistant.message', { content: 'AFS written, status ready-for-automation' }, { agentId: 'a1' }),
  ev('subagent.completed', {
    toolCallId: 'a1', agentName: 'test-analyst', model: 'claude-sonnet-4.6',
    totalTokens: 5661760, totalToolCalls: 86, durationMs: 1308900,
  }),
];

test('sub-agents come back in the shape summarizeSubagents consumes', () => {
  const [a] = readSubagents(SUB_EVENTS, extractSignals);
  assert.equal(a.agentType, 'test-analyst');       // not `agent` — the summarizer groups on this
  assert.equal(a.description, 'the analyst');
  assert.equal(a.ended, 'ok');
  assert.equal(a.errors, 0);
  assert.ok(a.turns > 0);
});

// Copilot pre-aggregates what Claude makes you meter with ccusage.
test('the metering fields ride along for the efficiency audit', () => {
  const [a] = readSubagents(SUB_EVENTS, extractSignals);
  assert.equal(a.model, 'claude-sonnet-4.6');
  assert.equal(a.totalTokens, 5661760);
  assert.equal(a.toolCalls, 86);
  assert.equal(a.durationMs, 1308900);
});

// A Copilot sub-agent's own stream has no user.message: the dispatch prompt is
// in the PARENT's task call. Without seeding it, every fingerprint is '' and
// repeated-identical-dispatch detection silently finds nothing.
test('the dispatch prompt is recovered from the parent task call', () => {
  const [a] = readSubagents(SUB_EVENTS, extractSignals);
  assert.equal(promptFingerprintOf(a.records), 'Analyse TC-1 live.');
  assert.match(finalResultOf(a.records), /ready-for-automation/);
});

test('a completed sub-agent with no matching start still reports', () => {
  const orphan = [START, ev('subagent.completed', { toolCallId: 'zz', agentName: 'qa-engineer' })];
  const [a] = readSubagents(orphan, extractSignals);
  assert.equal(a.agentType, 'qa-engineer');
  assert.equal(a.model, null);
});

test('malformed lines are skipped, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cop-'));
  try {
    const p = join(dir, 'events.jsonl');
    writeFileSync(p, [JSON.stringify(START), 'not json', '', JSON.stringify(ev('user.message', { content: 'hi' })), '{"no":"type"}'].join('\n'));
    const events = readEvents(p);
    assert.equal(events.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// 22 MB of streams on one machine — filtering by project must not parse them all.
test('sessionsForCwd matches the project and its subdirectories, oldest first', () => {
  const root = mkdtempSync(join(tmpdir(), 'coproot-'));
  try {
    const mk = (id, cwd) => {
      mkdirSync(join(root, id), { recursive: true });
      writeFileSync(join(root, id, 'events.jsonl'),
        JSON.stringify({ type: 'session.start', data: { context: { cwd } } }) + '\n');
    };
    mk('s-here', '/repo');
    mk('s-under', '/repo/packages/api');
    mk('s-elsewhere', '/other');
    mk('s-prefix-trap', '/repo-other');       // must NOT match /repo
    const ids = sessionsForCwd('/repo', root).map((s) => s.id);
    assert.deepEqual(ids.sort(), ['s-here', 's-under']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
