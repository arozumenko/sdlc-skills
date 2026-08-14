import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isWorkflowTranscript, idsFromTranscript, extractResult, transcriptPathOf, run, resolveAgentTranscript,
} from './scripts/workflow-return.mjs';

const jsonl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n');
const assistant = (...blocks) => ({ type: 'assistant', message: { content: blocks } });
const structured = (input) => ({ type: 'tool_use', name: 'StructuredOutput', input });

/** A project with one workflow transcript on disk. */
function fixture({ recs, meta = { agentType: 'test-automation-engineer' }, direct = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wfret-'));
  const dir = direct
    ? join(root, '.claude/projects/p/sess/subagents')
    : join(root, '.claude/projects/p/sess/subagents/workflows/wf_abc-123');
  mkdirSync(dir, { recursive: true });
  const tp = join(dir, 'agent-def456.jsonl');
  writeFileSync(tp, recs);
  if (meta) writeFileSync(tp.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(meta));
  return { root, tp, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Both kinds carry the same agentType — verified on a live run, where one
// test-automation-engineer sat in each place at the same moment. So the hook
// matcher cannot separate them and the PATH is the only discriminator.
test('only workflow dispatches are recognised', () => {
  assert.ok(isWorkflowTranscript('/h/.claude/projects/p/s/subagents/workflows/wf_x/agent-y.jsonl'));
  // repo-local store — same suffix, must work identically
  assert.ok(isWorkflowTranscript('/repo/.claude/projects/p/s/subagents/workflows/wf_x/agent-y.jsonl'));
  assert.ok(isWorkflowTranscript('C:\\r\\.claude\\projects\\p\\s\\subagents\\workflows\\wf_x\\agent-y.jsonl'));
  // a lead's own dispatch is none of this hook's business
  assert.equal(isWorkflowTranscript('/h/.claude/projects/p/s/subagents/agent-y.jsonl'), false);
  assert.equal(isWorkflowTranscript('/h/.claude/projects/p/s.jsonl'), false);
  assert.equal(isWorkflowTranscript(undefined), false);
});

test('run and agent ids come from the path, needing no payload fields', () => {
  assert.deepEqual(
    idsFromTranscript('/h/subagents/workflows/wf_d9c0c9e2-6e1/agent-a038dfc2969a48df8.jsonl'),
    { runId: 'wf_d9c0c9e2-6e1', agentId: 'a038dfc2969a48df8' });
});

test('payload field name is tolerated in either casing, and may be absent', () => {
  assert.equal(transcriptPathOf({ transcript_path: '/a' }), '/a');
  assert.equal(transcriptPathOf({ transcriptPath: '/b' }), '/b');
  assert.equal(transcriptPathOf({}), null);
  assert.equal(transcriptPathOf(null), null);
});

// A schema-constrained agent returns via a StructuredOutput tool call, not
// text — checked against real transcripts. That is why the documented
// `last_assistant_message` is not sufficient by itself.
test('extractResult prefers the StructuredOutput call over trailing text', () => {
  const out = extractResult(jsonl(
    assistant({ type: 'text', text: 'let me finish up' }),
    assistant(structured({ status: 'ready-for-mini-gate', branch: 'tests/foundation-x', pr: 179 })),
  ).split('\n'));
  assert.equal(out.shape, 'structured');
  assert.equal(out.result.status, 'ready-for-mini-gate');
  assert.equal(out.result.pr, 179);
});

test('extractResult takes the LAST structured call, not the first', () => {
  const out = extractResult(jsonl(
    assistant(structured({ status: 'blocked' })),
    assistant(structured({ status: 'built' })),
  ).split('\n'));
  assert.equal(out.result.status, 'built');
});

test('extractResult falls back to text for an unschema’d agent', () => {
  const out = extractResult(jsonl(assistant({ type: 'text', text: 'done, all green' })).split('\n'));
  assert.equal(out.shape, 'text');
  assert.match(out.result.text, /all green/);
});

test('extractResult survives truncated and malformed lines', () => {
  const lines = ['{"type":"assis', '', 'not json at all',
    JSON.stringify(assistant(structured({ status: 'built' })))];
  assert.equal(extractResult(lines).result.status, 'built');
});

test('a workflow result is written, keyed by run and agent', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ status: 'built', branch: 'tests/x' }))) });
  try {
    const written = run({ transcript_path: f.tp }, { projectDir: f.root, now: '2026-07-30T00:00:00Z' });
    assert.equal(written, join(f.root, '.agents/automation/_returns/wf_abc-123/def456.json'));
    const body = JSON.parse(readFileSync(written, 'utf8'));
    assert.equal(body.run_id, 'wf_abc-123');
    assert.equal(body.agent_id, 'def456');
    assert.equal(body.agent_type, 'test-automation-engineer');   // from the sidecar
    assert.equal(body.result.branch, 'tests/x');
  } finally { f.cleanup(); }
});

// Once the telemetry area exists, receipts are working state that must survive
// branch switches — they land on the telemetry side, not in the main tree.
test('with a telemetry area, the receipt lands under telemetry/returns/', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ status: 'built' }))) });
  try {
    mkdirSync(join(f.root, '.agents/automation/telemetry'), { recursive: true });
    const written = run({ transcript_path: f.tp }, { projectDir: f.root, now: '2026-08-14T00:00:00Z' });
    assert.equal(written, join(f.root, '.agents/automation/telemetry/returns/wf_abc-123/def456.json'));
    assert.equal(JSON.parse(readFileSync(written, 'utf8')).run_id, 'wf_abc-123');
  } finally { f.cleanup(); }
});

// The guarantee that lets this ship: a bookkeeping hook must never be the
// reason a dispatch behaves differently.
test('a NON-workflow dispatch is left completely alone', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ status: 'built' }))), direct: true });
  try {
    assert.equal(run({ transcript_path: f.tp }, { projectDir: f.root }), null);
    assert.equal(existsSync(join(f.root, '.agents')), false, 'writes nothing at all');
  } finally { f.cleanup(); }
});

test('every bad input is a silent no-op, never a throw', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ status: 'built' }))) });
  try {
    assert.equal(run(null, { projectDir: f.root }), null);
    assert.equal(run({}, { projectDir: f.root }), null);
    assert.equal(run({ transcript_path: '/nope/wf_x/agent-y.jsonl' }, { projectDir: f.root }), null);
    // a workflow transcript with nothing to record: still not a failure
    const empty = fixture({ recs: '' });
    try { assert.equal(run({ transcript_path: empty.tp }, { projectDir: empty.root }), null); }
    finally { empty.cleanup(); }
    // an unwritable destination must not throw either
    assert.doesNotThrow(() => run({ transcript_path: f.tp }, { projectDir: '/proc/nonexistent-xyz' }));
  } finally { f.cleanup(); }
});

test('a missing sidecar does not stop the write', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ status: 'built' }))), meta: null });
  try {
    const written = run({ transcript_path: f.tp, agent_type: 'qa-engineer' }, { projectDir: f.root });
    assert.ok(written);
    assert.equal(JSON.parse(readFileSync(written, 'utf8')).agent_type, 'qa-engineer', 'falls back to the payload');
  } finally { f.cleanup(); }
});

// ---- SubagentStop payload reality (field lesson 2026-08-03) ----------------
// transcript_path names the PARENT session transcript, not the subagent file,
// and no subagent-path field exists — three field runs produced ZERO receipts.
// The agent file is derived from parent path + agent_id instead.

test('resolveAgentTranscript: derives the workflow file from parent + agent_id', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ ok: true }))) });
  try {
    const parent = join(f.root, '.claude/projects/p/sess.jsonl');
    assert.equal(resolveAgentTranscript({ transcript_path: parent, agent_id: 'def456' }), f.tp);
    // the payload's id may carry the filename prefix — tolerate it
    assert.equal(resolveAgentTranscript({ transcript_path: parent, agent_id: 'agent-def456' }), f.tp);
    // and run() writes the receipt keyed by the derived run + agent
    const proj = join(f.root, 'proj');
    const file = run({ transcript_path: parent, agent_id: 'def456' }, { projectDir: proj, now: 't' });
    assert.ok(file && existsSync(file));
    const body = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(body.run_id, 'wf_abc-123');
    assert.equal(body.agent_id, 'def456');
    assert.deepEqual(body.result, { ok: true });
  } finally { f.cleanup(); }
});

test('resolveAgentTranscript: a DIRECT dispatch still resolves to null', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ ok: true }))), direct: true });
  try {
    const parent = join(f.root, '.claude/projects/p/sess.jsonl');
    assert.equal(resolveAgentTranscript({ transcript_path: parent, agent_id: 'def456' }), null);
    assert.equal(run({ transcript_path: parent, agent_id: 'def456' }, { projectDir: f.root }), null);
  } finally { f.cleanup(); }
});

test('resolveAgentTranscript: a host that hands the agent file directly is honored', () => {
  const f = fixture({ recs: jsonl(assistant(structured({ ok: true }))) });
  try {
    assert.equal(resolveAgentTranscript({ transcript_path: f.tp }), f.tp);
  } finally { f.cleanup(); }
});

// The runtime can leave hook stdin OPEN after the payload (same behaviour that
// forced lib.sh's bounded read). readFileSync(0) then blocks to the hook
// timeout — the second half of the zero-receipts failure. The bounded read
// finishes the moment the buffer parses.
test('open stdin does not hang the hook: exits fast and writes the receipt', async () => {
  const { spawn } = await import('node:child_process');
  const f = fixture({ recs: jsonl(assistant(structured({ ok: 1 }))) });
  const proj = join(f.root, 'proj');
  const script = new URL('./scripts/workflow-return.mjs', import.meta.url).pathname;
  const parent = join(f.root, '.claude/projects/p/sess.jsonl');
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  try {
    child.stdin.write(JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: parent, agent_id: 'def456' }));
    // stdin deliberately NOT closed
    const code = await Promise.race([
      new Promise((res) => child.on('exit', res)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('hook hung on open stdin')), 6000)),
    ]);
    assert.equal(code, 0);
    assert.ok(existsSync(join(proj, '.agents/automation/_returns/wf_abc-123/def456.json')));
  } finally {
    try { child.stdin.destroy(); child.kill(); } catch { /* done */ }
    f.cleanup();
  }
});
