// Tests for telemetry-capture.mjs — fixture transcripts/event streams in temp
// dirs; ccusage is never invoked (config.priceAtCapture=false throughout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseClaudeTranscript, dedupUsage, captureClaudeSession, captureCopilotSession,
  knownSessions, appendLine, ledgerPath, sweep, main, readRecords, whoAmI,
  sameCwdOrUnder, encodeProjectPath, USD_PER_CREDIT,
  parseVsCodeChatSession, captureVsCodeSession, vscodeStorageRoots, workspaceFolderOf, ensureSink,
} from './telemetry-capture.mjs';
import { pathToFileURL } from 'node:url';

const CFG = { capturePrompts: false, priceAtCapture: false, maxSweep: 10 };
const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-test-'));

// A realistic little Claude transcript: agent-setting, a prompt, a streaming
// duplicate (same message id, growing output), a tool error, an Agent dispatch
// after a >30-min idle gap.
function claudeRecords() {
  return [
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'automate TC-101 please' }, timestamp: '2026-07-30T10:00:00Z' },
    {
      type: 'assistant', gitBranch: 'tests/batch-x', timestamp: '2026-07-30T10:01:00Z',
      message: {
        id: 'm1', model: 'claude-sonnet-5',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'test-automation-workflow' } }],
      },
    },
    { // streaming rewrite of m1 — output grows, everything else fixed. Max wins.
      type: 'assistant', timestamp: '2026-07-30T10:01:30Z',
      message: {
        id: 'm1', model: 'claude-sonnet-5',
        usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [],
      },
    },
    { type: 'user', timestamp: '2026-07-30T10:02:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } },
    { // 38-minute gap — excluded from active minutes, kept in wall clock
      type: 'assistant', timestamp: '2026-07-30T10:40:00Z',
      message: {
        id: 'm2', model: 'claude-sonnet-5',
        usage: { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'qa-engineer', description: 'analyse TC-101' } }],
      },
    },
    { type: 'user', isSidechain: true, message: { content: '<system-reminder>noise</system-reminder>' }, timestamp: '2026-07-30T10:40:10Z' },
  ];
}

test('dedupUsage: streaming duplicates collapse to max-per-message-id', () => {
  const { tokens, models } = dedupUsage(claudeRecords());
  assert.deepEqual(tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });
  assert.deepEqual([...models], ['claude-sonnet-5']);
});

test('parseClaudeTranscript: role, branch, turns, tools, idle-gap-capped active time', () => {
  const p = parseClaudeTranscript(claudeRecords());
  assert.equal(p.role, 'test-automation-lead');
  assert.equal(p.branch, 'tests/batch-x');
  assert.equal(p.turns, 2);
  assert.equal(p.toolCalls, 2);
  assert.equal(p.toolErrors, 1);
  assert.deepEqual([...p.skills], ['test-automation-workflow']);
  assert.equal(p.dispatched.length, 1);
  assert.equal(p.activeMin, 2);  // 60s + 30s + 30s + 10s counted; the 38-min gap dropped
  assert.equal(p.wallMin, 40);
  assert.equal(p.prompts.length, 0, 'prompts stay off unless capturePrompts');
});

test('parseClaudeTranscript: prompts opt-in captures user text truncated, skips wrappers', () => {
  const p = parseClaudeTranscript(claudeRecords(), { capturePrompts: true });
  assert.equal(p.prompts.length, 1);
  assert.equal(p.prompts[0].text, 'automate TC-101 please');
  assert.equal(p.dispatched[0].description, 'analyse TC-101');
});

function writeClaudeFixture(root, sessionId, { withSub = true } = {}) {
  mkdirSync(root, { recursive: true });
  const transcript = join(root, `${sessionId}.jsonl`);
  writeFileSync(transcript, jsonl(claudeRecords()));
  if (withSub) {
    const subDir = join(root, sessionId, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'qa-engineer', description: 'analyse' }));
    writeFileSync(join(subDir, 'agent-abc.jsonl'), jsonl([
      {
        type: 'assistant', timestamp: '2026-07-30T10:05:00Z',
        message: { id: 's1', model: 'claude-haiku-4-5', usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] },
      },
      { type: 'assistant', timestamp: '2026-07-30T10:07:00Z', message: { id: 's2', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
    ]));
  }
  return transcript;
}

test('captureClaudeSession: one line — parent tokens, per-dispatch sub-agent records, models merged', () => {
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-1');
  const line = captureClaudeSession(repo, transcript, 'sess-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'claude');
  assert.equal(line.role, 'test-automation-lead');
  assert.deepEqual(line.tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });
  assert.equal(line.subagents.length, 1);
  // One record PER DISPATCH (n:1) carrying its label — the attribution key
  // batch-cost joins receipt case ids against. No costUsd key when unpriced.
  assert.deepEqual(line.subagents[0], {
    // `id` joins this dispatch to its live-log record and its _returns receipt
    id: 'agent-abc', role: 'qa-engineer', label: 'analyse', n: 1,
    tokens: { input: 510, output: 55, cacheRead: 0, cacheWrite: 0 },
    // per-model quads ride each sub — the dataset's tokens_by_model source
    tokensByModel: { 'claude-haiku-4-5': { input: 500, output: 50, cacheRead: 0, cacheWrite: 0 } },
    activeMin: 2, toolCalls: 0, toolErrors: 0,
  });
  assert.deepEqual(line.models, ['claude-haiku-4-5', 'claude-sonnet-5']);
  assert.equal(line.activeMin, 4); // parent 2 + sub 2
  assert.equal(line.costUsd, null);
  assert.equal(line.costSource, 'none');
  assert.ok(!('prompts' in line), 'prompts key absent by default');
  assert.deepEqual(line.cases, ['TC-101'], 'case ids mined from prompt + dispatch label, ungated');
});

// A workflow dispatch has no description; its prompt opens with boilerplate and
// the case id can sit past the 160-char label window. The per-dispatch record
// must still carry the ids mined from the dispatch's own transcript (`cases`),
// or batch-cost mislabels the work as batch overhead.
test('captureClaudeSession: sub-agent record carries transcript-mined case ids', () => {
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-ids', { withSub: false });
  const subDir = join(proj, 'sess-ids', 'subagents');
  mkdirSync(subDir, { recursive: true });
  // No description in meta (workflow dispatch); prompt is sidechain-marked with
  // the id beyond where the label slice ends.
  writeFileSync(join(subDir, 'agent-wf1.meta.json'), JSON.stringify({ agentType: 'test-automation-engineer' }));
  writeFileSync(join(subDir, 'agent-wf1.jsonl'), jsonl([
    {
      type: 'user', isSidechain: true, timestamp: '2026-07-30T10:05:00Z',
      message: { role: 'user', content: `stabilize workflow. ${'x'.repeat(200)} target case TC-909 on branch tests/909` },
    },
    {
      type: 'assistant', timestamp: '2026-07-30T10:06:00Z',
      message: { id: 'w1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
    },
  ]));
  const line = captureClaudeSession(repo, transcript, 'sess-ids', { config: CFG, user: 'tester' });
  const wf = line.subagents.find((s) => s.role === 'test-automation-engineer');
  assert.deepEqual(wf.cases, ['TC-909']);
  assert.ok(!wf.label.includes('TC-909'), 'the label window itself missed the id — that is the point');
  assert.ok(line.cases.includes('TC-909'), 'session-level cases picks it up too');
});

// A declared work scope (work-scope.mjs) is the strongest identity surface —
// the capture stamps it onto the line and folds its case ids in.
test('captureClaudeSession: declared scope stamped onto the line, declared ids join cases', async () => {
  const { openScope, recordOutcomes } = await import('../scripts/work-scope.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-scope');
  openScope(repo, { session: 'sess-scope', batch: 'b7', cases: ['TC-500'] });
  recordOutcomes(repo, { session: 'sess-scope', outcomes: { 'TC-500': 'automated' } });
  const line = captureClaudeSession(repo, transcript, 'sess-scope', { config: CFG, user: 'tester' });
  assert.equal(line.scope.intent, 'automation');
  assert.equal(line.scope.batch, 'b7');
  assert.deepEqual(line.scope.outcomes, { 'TC-500': 'automated' }, 'compact outcome map, no timestamps');
  assert.ok(line.cases.includes('TC-500'), 'declared id joins the mined ones');
  assert.ok(line.cases.includes('TC-101'), 'mined ids are kept too');
});

// Copilot's agent cannot know its session id — `open --session auto` leaves a
// pending record; the capture claims it by time window, permanently.
test('sessionScope: pending record claimed by time window, then owned by the session', async () => {
  const { openScope, listScopes } = await import('../scripts/work-scope.mjs');
  const { sessionScope } = await import('./telemetry-capture.mjs');
  const repo = tmp();
  const s = openScope(repo, { session: 'pending-x1', batch: 'b8', now: '2026-07-30T10:03:00.000Z' });
  assert.match(s.session, /^pending-/);
  const win = { startTs: Date.parse('2026-07-30T10:00:00Z'), endTs: Date.parse('2026-07-30T11:00:00Z') };
  const claimed = sessionScope(repo, 'real-session', win);
  assert.equal(claimed.batch, 'b8');
  assert.equal(claimed.session, 'real-session');
  assert.equal(claimed.claimedFrom, 'pending-x1');
  const after = listScopes(repo);
  assert.deepEqual(after.map((x) => x.session), ['real-session'], 'claim renames — single-use');
  // outside any window → no claim
  const none = sessionScope(repo, 'other-session', { startTs: Date.parse('2026-07-31T10:00:00Z') });
  assert.equal(none, null);
});

// Measurements update AS DISPATCHES FINISH (SubagentStop), not only at session
// end — one line per dispatch in a transient per-session file, never N
// superseded whole-session rows in the git-committed ledger.
test('captureDispatches: one line per finished dispatch, idempotent, re-records on growth', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const sub = (id, text, turns = 1) => {
    const d = join(proj, 'sess-d', 'subagents');
    mkdirSync(d, { recursive: true });
    // No description — a workflow dispatch has none, so the label comes from
    // the prompt, exactly as in the field.
    writeFileSync(join(d, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'qa-engineer' }));
    writeFileSync(join(d, `agent-${id}.jsonl`), jsonl([
      { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:00:00Z', message: { role: 'user', content: text } },
      ...Array.from({ length: turns }, (_, i) => ({
        type: 'assistant', timestamp: `2026-07-30T10:0${i + 1}:00Z`,
        message: { id: `${id}-${i}`, usage: { input_tokens: 100, output_tokens: 20 }, content: [] },
      })),
    ]));
  };
  writeFileSync(join(proj, 'sess-d.jsonl'), jsonl([{ type: 'agent-setting', agentSetting: 'test-automation-lead' }]));
  sub('a1', 'Analyst slot — analyse TC-1');
  sub('a2', 'Implementer slot — implement TC-2');
  const CFGX = { ...CFG, priceAtCapture: false }; // no ccusage in tests

  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 2);
  const log = readDispatchLog(dispatchLogPath(repo, 'sess-d'));
  assert.deepEqual([...log.keys()].sort(), ['agent-a1', 'agent-a2']);
  assert.equal(log.get('agent-a1').role, 'qa-engineer');
  assert.deepEqual(log.get('agent-a1').cases, ['TC-1'], 'case attribution recorded at the moment the dispatch ends');
  assert.match(log.get('agent-a2').label, /^Implementer slot/);

  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 0, 'idempotent — a re-fired stop records nothing');
  // agentId narrows to the one that just finished
  sub('a3', 'Reviewer slot — STATIC review of TC-1');
  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX, agentId: 'agent-a3' }), 1);
  // a resumed dispatch grew → superseding line, latest wins on read
  const before = readDispatchLog(dispatchLogPath(repo, 'sess-d')).get('agent-a1').bytes;
  sub('a1', 'Analyst slot — analyse TC-1', 3);
  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 1);
  const after = readDispatchLog(dispatchLogPath(repo, 'sess-d'));
  assert.ok(after.get('agent-a1').bytes > before, 'the superseding record reflects the grown transcript');
  assert.equal(after.size, 3, 'still one ENTRY per dispatch, however many lines were appended');
});

// The session line is re-derived from transcripts, so it normally already has
// every dispatch — the fold exists for the one case it CANNOT: a sub-agent
// transcript gone by session end. Measured work must not vanish with it.
test('foldDispatchLog: a dispatch whose transcript disappeared survives into the session line', async () => {
  const { captureDispatches, captureClaudeSession } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-f');   // parent + 1 sub (agent-abc)
  // a SECOND dispatch finishes and is measured live…
  const d = join(proj, 'sess-f', 'subagents');
  writeFileSync(join(d, 'agent-gone.meta.json'), JSON.stringify({ agentType: 'test-automation-engineer' }));
  writeFileSync(join(d, 'agent-gone.jsonl'), jsonl([
    { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:05:00Z', message: { role: 'user', content: 'Implementer slot — implement TC-42' } },
    { type: 'assistant', timestamp: '2026-07-30T10:06:00Z', message: { id: 'g1', usage: { input_tokens: 300, output_tokens: 40 }, content: [] } },
  ]));
  assert.equal(captureDispatches(repo, 'sess-f', { projectDir: proj, config: { ...CFG, priceAtCapture: false } }), 2);
  // …then its transcript is gone by the time the session ends
  rmSync(join(d, 'agent-gone.jsonl')); rmSync(join(d, 'agent-gone.meta.json'));

  const line = captureClaudeSession(repo, transcript, 'sess-f', { config: CFG, user: 'tester' });
  const ids = line.subagents.map((s) => s.id).sort();
  assert.deepEqual(ids, ['agent-abc', 'agent-gone'], 'the vanished dispatch is folded back in');
  assert.equal(line.foldedFromLive, 1, 'and the line says so — never a silent merge');
  assert.ok(line.cases.includes('TC-42'), 'its case attribution survives too');
  const folded = line.subagents.find((s) => s.id === 'agent-gone');
  assert.match(folded.label, /^Implementer slot/);
  assert.equal(folded.role, 'test-automation-engineer');
});

// What makes capturing mid-run cheap: a dispatch the SubagentStop hook already
// priced is NOT re-metered when its transcript is byte-identical, so a capture
// prices the parent plus whatever finished unmeasured — not N+1 transcripts.
test('captureClaudeSession: reuses live-log dollars, meters only what changed', async () => {
  const { captureClaudeSession, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-r');           // parent + agent-abc
  const subPath = join(proj, 'sess-r', 'subagents', 'agent-abc.jsonl');
  const bytes = readFileSync(subPath, 'utf8').length;
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation', 'live'), { recursive: true });
  writeFileSync(dispatchLogPath(repo, 'sess-r'),
    `${JSON.stringify({ v: 1, session: 'sess-r', agentId: 'agent-abc', role: 'qa-engineer', label: 'analyse', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 4.25, bytes })}\n`);

  // a fake ccusage that prices ONLY the parent — proving the sub was not sent
  const fake = join(repo, 'fake-ccusage');
  writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({ session: [{ sessionId: 'sess-r', totalCost: 1 }] })}\nEOF\n`, { mode: 0o755 });
  const line = captureClaudeSession(repo, transcript, 'sess-r', {
    config: { ...CFG, priceAtCapture: true }, user: 'tester',
    // meterSession reads the binary from env at call time
    env: { ...process.env, TOKENOMICS_CCUSAGE_BIN: fake },
  });
  const sub = line.subagents.find((s) => s.id === 'agent-abc');
  assert.equal(sub.costUsd, 4.25, 'the already-priced dispatch keeps its recorded dollar');
  assert.equal(line.costUsd, 5.25, 'session total = metered parent + reused dispatch');
});

// Copilot has no sub-agent transcripts — its dispatches are events inside the
// session's own events.jsonl, and it prices the session once at shutdown, so
// these records are honestly tokens/time only.
test('captureDispatches: Copilot dispatches come from events.jsonl, tokens-only', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const copRoot = tmp();
  const sdir = join(copRoot, 'cp-sess');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, 'events.jsonl'), jsonl([
    { type: 'session.start', timestamp: '2026-08-13T10:00:00Z', data: { context: { branch: 'tests/batch-x' } } },
    { type: 'subagent.started', timestamp: '2026-08-13T10:01:00Z', data: { toolCallId: 't1', agentName: 'qa-engineer', agentDescription: 'Analyst slot — analyse TC-77' } },
    { type: 'subagent.completed', timestamp: '2026-08-13T10:09:00Z', data: { toolCallId: 't1', agentName: 'qa-engineer', totalTokens: 120000, durationMs: 480000, totalToolCalls: 14 } },
  ]));
  const env = { ...process.env, TOKENOMICS_COPILOT_ROOT: copRoot };
  assert.equal(captureDispatches(repo, 'cp-sess', { config: CFG, env }), 1);
  const rec = readDispatchLog(dispatchLogPath(repo, 'cp-sess')).get('t1');
  assert.equal(rec.role, 'qa-engineer');
  assert.match(rec.label, /^Analyst slot/);
  assert.deepEqual(rec.cases, ['TC-77'], 'case attribution from the dispatch description');
  assert.equal(rec.tokens.input, 120000, 'cache-inclusive total, same convention as the session capture');
  assert.equal(rec.activeMin, 8);
  assert.equal(rec.toolCalls, 14);
  assert.ok(!('costUsd' in rec), 'no per-dispatch dollars exist on this host — never invented');
  assert.equal(captureDispatches(repo, 'cp-sess', { config: CFG, env }), 0, 'idempotent');
});

// The transient log must not outlive the session it described.
test('main: the session-end ledger line supersedes and removes the live dispatch log', async () => {
  const { dispatchLogPath, captureDispatches } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-x');
  captureDispatches(repo, 'sess-x', { projectDir: proj, config: { ...CFG, priceAtCapture: false } });
  assert.ok(existsSync(dispatchLogPath(repo, 'sess-x')), 'dispatch recorded while the session ran');
  await main(['--transcript', transcript, '--session', 'sess-x', '--cwd', repo], { TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_BATCH_COST: '1' });
  assert.ok(!existsSync(dispatchLogPath(repo, 'sess-x')), 'removed once the real ledger line landed');
});

// ccusage keys each staged row by the FILE STEM, not the staged folder name.
// Matching the folder returned null for every per-dispatch dollar, so per-case
// attribution silently degraded to tokens-only (found live: session total
// priced $3.31, every dispatch "unpriced").
test('meterSession: per-file dollars join on the file stem, with the folder shape as fallback', async () => {
  const { meterSession } = await import('./telemetry-capture.mjs');
  const dir = tmp();
  const files = ['sess-1.jsonl', 'agent-aaa.jsonl', 'agent-bbb.jsonl'].map((n) => join(dir, n));
  for (const f of files) writeFileSync(f, '');
  // Fake ccusage: echoes a claude-session payload keyed by stem (current shape)
  const fake = join(dir, 'fake-ccusage');
  writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({
    session: [
      { sessionId: 'agent-bbb', totalCost: 2 },
      { sessionId: 'sess-1', totalCost: 1 },
      { sessionId: 'agent-aaa', totalCost: 0.5 },
    ],
  })}\nEOF\n`, { mode: 0o755 });
  const r = meterSession(files, { env: { ...process.env, TOKENOMICS_CCUSAGE_BIN: fake } });
  assert.equal(r.totalUsd, 3.5);
  assert.deepEqual(r.perFileUsd, [1, 0.5, 2], 'each staged file gets ITS OWN dollar, in order');
});

// A Workflow run spawns its agents through the workflow runtime, so the parent
// transcript holds ZERO Agent tool_use blocks — counting those reported
// `dispatches: 0` for a whole batch (found on a live workflow session).
test('captureClaudeSession: dispatches counts workflow sub-agents, not just Agent-tool calls', () => {
  const repo = tmp(); const proj = tmp();
  // fixture WITHOUT the Agent tool_use record, sub-agent under workflows/
  const transcript = join(proj, 'wf-sess.jsonl');
  mkdirSync(proj, { recursive: true });
  writeFileSync(transcript, jsonl([
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'run the batch' }, timestamp: '2026-07-30T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-07-30T10:01:00Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
  ]));
  const wfDir = join(proj, 'wf-sess', 'subagents', 'workflows', 'wf_abc');
  mkdirSync(wfDir, { recursive: true });
  for (const id of ['a1', 'a2']) {
    writeFileSync(join(wfDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'qa-engineer' }));
    writeFileSync(join(wfDir, `agent-${id}.jsonl`), jsonl([
      { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:02:00Z', message: { role: 'user', content: 'Analyst slot — analyse TC-7' } },
      { type: 'assistant', timestamp: '2026-07-30T10:03:00Z', message: { id: `s-${id}`, usage: { input_tokens: 100, output_tokens: 20 }, content: [] } },
    ]));
  }
  const line = captureClaudeSession(repo, transcript, 'wf-sess', { config: CFG, user: 'tester' });
  assert.equal(line.subagents.length, 2);
  assert.equal(line.dispatches, 2, 'workflow sub-agents counted even with no Agent tool_use blocks');
});

test('captureClaudeSession: empty transcript yields no line', () => {
  const repo = tmp(); const proj = tmp();
  mkdirSync(proj, { recursive: true });
  const t = join(proj, 'empty.jsonl');
  writeFileSync(t, jsonl([{ type: 'summary', summary: 'nothing' }]));
  assert.equal(captureClaudeSession(repo, t, 'empty', { config: CFG, user: 'tester' }), null);
});

function copilotEvents({ shutdown = true, cwd = '/repo', agent = null } = {}) {
  const ev = [
    { type: 'session.start', timestamp: '2026-07-30T09:00:00Z', data: { context: { cwd, branch: 'main' } } },
    // CLI ≥1.0.63 emits these; older sessions lack them (agent stays null below)
    ...(agent ? [
      { type: 'subagent.selected', timestamp: '2026-07-30T09:00:01Z', data: { agentName: agent, agentDisplayName: agent } },
      { type: 'skill.invoked', timestamp: '2026-07-30T09:00:02Z', data: { name: 'test-automation-workflow', path: '/x/SKILL.md' } },
      { type: 'subagent.started', timestamp: '2026-07-30T09:00:03Z', agentId: 'tc9', data: { toolCallId: 'tc9', agentName: 'qa-engineer', agentDescription: 'analyse SCRUM-T101 live' } },
    ] : []),
    { type: 'user.message', timestamp: '2026-07-30T09:00:10Z', data: { text: 'run the batch' } },
    { type: 'assistant.message', timestamp: '2026-07-30T09:00:20Z', data: {} },
    { type: 'tool.execution_start', timestamp: '2026-07-30T09:00:30Z', data: {} },
    { type: 'tool.execution_complete', timestamp: '2026-07-30T09:00:40Z', data: { success: false } },
    { type: 'subagent.started', timestamp: '2026-07-30T09:01:00Z', agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'qa-engineer' } },
    { type: 'assistant.message', timestamp: '2026-07-30T09:02:00Z', agentId: 'tc1', data: {} }, // sub-agent turn — not the parent's
    { type: 'subagent.completed', timestamp: '2026-07-30T09:03:00Z', agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'qa-engineer', totalTokens: 1000, totalToolCalls: 5, durationMs: 120000 } },
  ];
  if (shutdown) {
    ev.push({
      type: 'session.shutdown', timestamp: '2026-07-30T09:04:00Z',
      data: {
        totalNanoAiu: 19862850000,
        modelMetrics: { 'gpt-5': { usage: { inputTokens: 5000, outputTokens: 300, cacheReadTokens: 100, cacheWriteTokens: 10 } } },
      },
    });
  }
  return ev;
}

test('captureCopilotSession: billed nanoAIU → USD, parent netted of sub-agent tokens', () => {
  const repo = tmp();
  const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo })));
  const line = captureCopilotSession(repo, events, 'cop-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'copilot');
  assert.equal(line.role, null);
  assert.equal(line.branch, 'main');
  assert.ok(Math.abs(line.costUsd - (19862850000 / 1e9) * USD_PER_CREDIT) < 1e-9);
  assert.equal(line.costSource, 'copilot-nano-aiu');
  assert.equal(line.tokens.input, 4000); // 5000 session − 1000 sub-agent
  assert.equal(line.turns, 2);           // parent only — the sub-agent's turn excluded
  assert.equal(line.toolCalls, 1);
  assert.equal(line.toolErrors, 1);
  // This fixture's subagent.started carries no agentDescription — the label is
  // honestly empty (batch-cost will classify such a dispatch as overhead).
  assert.deepEqual(line.subagents[0], {
    role: 'qa-engineer', label: '', n: 1,
    tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 },
    activeMin: 2, toolCalls: 5, toolErrors: 0,
  });
});

test('captureCopilotSession: parent role from subagent.selected, skills from skill.invoked', () => {
  const repo = tmp(); const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo, agent: 'test-automation-lead' })));
  const line = captureCopilotSession(repo, events, 'cop-role', { config: CFG, user: 'tester' });
  assert.equal(line.role, 'test-automation-lead');
  assert.deepEqual(line.skills, ['test-automation-workflow']);
  assert.deepEqual(line.cases, ['SCRUM-T101'], 'case id mined from the dispatch description');
});

test('captureCopilotSession: no shutdown yet → null (still running)', () => {
  const repo = tmp(); const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ shutdown: false, cwd: repo })));
  assert.equal(captureCopilotSession(repo, events, 'cop-2', { config: CFG, user: 'tester' }), null);
});

test('sweep: harvests unknown sessions, skips known ids, respects maxSweep and live grace', () => {
  const repo = tmp();
  const claudeRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  for (const id of ['s-a', 's-b', 's-c']) {
    writeClaudeFixture(claudeRoot, id, { withSub: false });
    utimesSync(join(claudeRoot, `${id}.jsonl`), old, old);
  }
  // s-c is fully captured (ledger end == transcript end) and its file hasn't
  // grown past that end + margin — must be skipped without a re-parse.
  appendLine(repo, 'tester', { v: 1, host: 'claude', id: 's-c', endedAt: '2026-07-30T10:40:10Z' });
  const cDate = new Date('2026-07-30T10:41:00Z');
  utimesSync(join(claudeRoot, 's-c.jsonl'), cDate, cDate);
  // s-d looks live (fresh mtime) — must be deferred.
  writeClaudeFixture(claudeRoot, 's-d', { withSub: false });

  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot };
  const r1 = sweep(repo, { config: { ...CFG, maxSweep: 1 }, user: 'tester', env });
  assert.equal(r1.captured, 1);
  assert.ok(r1.skipped >= 1, 'the bounded sweep defers the rest');
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 1); // the remaining old one; s-c known, s-d live
  const ids = readRecords(ledgerPath(repo, 'tester')).map((l) => l.id).sort();
  assert.deepEqual(ids, ['s-a', 's-b', 's-c']);
});

test('sweep: re-captures a claude session that continued after its first capture', () => {
  const repo = tmp();
  const claudeRoot = tmp();
  writeClaudeFixture(claudeRoot, 's-grow', { withSub: false });
  // First capture happened mid-life: ledger end 10:02, but the transcript now
  // runs to 10:40:10 and the file was written well past end + margin.
  appendLine(repo, 'tester', { v: 1, host: 'claude', id: 's-grow', endedAt: '2026-07-30T10:02:00Z' });
  const grown = new Date('2026-07-30T10:45:00Z');
  utimesSync(join(claudeRoot, 's-grow.jsonl'), grown, grown);

  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1, 'grown transcript is re-captured');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 's-grow');
  assert.equal(lines.length, 2, 'superseding line appended, old one kept (reports dedup latest-wins)');
  assert.equal(lines[1].endedAt, '2026-07-30T10:40:10.000Z');
  assert.deepEqual(lines[1].tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });

  // No further growth: mtime (10:45) is inside the new end (10:40:10) + margin.
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 0, 'no growth since the re-capture → nothing appended');
});

test('sweep: re-captures a resumed Copilot session after its second shutdown', () => {
  const repo = tmp();
  const copRoot = tmp();
  mkdirSync(join(copRoot, 'cop-grow'), { recursive: true });
  const events = join(copRoot, 'cop-grow', 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo })));
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: copRoot };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1);

  // The session is resumed: more events land and a SECOND shutdown carries the
  // updated billed totals (last shutdown wins).
  appendFileSync(events, jsonl([
    { type: 'assistant.message', timestamp: '2026-07-30T09:29:00Z', data: {} },
    {
      type: 'session.shutdown', timestamp: '2026-07-30T09:30:00Z',
      data: {
        totalNanoAiu: 30000000000,
        modelMetrics: { 'gpt-5': { usage: { inputTokens: 9000, outputTokens: 700, cacheReadTokens: 100, cacheWriteTokens: 10 } } },
      },
    },
  ]));
  const grown = new Date('2026-07-30T09:35:00Z');
  utimesSync(events, grown, grown);

  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 1, 'resumed session re-captured after growth');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'cop-grow');
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[1].costUsd - 30 * USD_PER_CREDIT) < 1e-9, 'cost follows the latest billed figure');
  assert.equal(lines[1].tokens.input, 8000, '9000 session − 1000 sub-agent');
  assert.equal(lines[1].endedAt, '2026-07-30T09:30:00.000Z');

  const r3 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r3.captured, 0, 'stable after the re-capture');
});

test('main: direct capture appends once, re-run with unchanged transcript is a no-op', async () => {
  const repo = tmp();
  const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-m', { withSub: false });
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'config.json'), JSON.stringify({ priceAtCapture: false }));
  // Empty override roots keep the trailing sweep hermetic (off the real stores).
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp() };
  const argv = ['--transcript', transcript, '--session', 'sess-m', '--cwd', repo];
  assert.equal(await main(argv, env), 0);
  assert.equal(await main(argv, env), 0);
  const me = whoAmI(repo).slug;
  const lines = readRecords(ledgerPath(repo, me));
  assert.equal(lines.length, 1, 'unchanged transcript must not append a duplicate');
  assert.equal(lines[0].id, 'sess-m');
});

// The live page is a pure derivation over scope + receipts + whatever lines
// exist right now — no metering, overwrite-in-place, absent scope → silent no-op.
test('renderLiveReport: writes the live batch page on the telemetry side', async () => {
  const { renderLiveReport } = await import('./telemetry-capture.mjs');
  const repo = tmp();
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(tele, 'scopes'), { recursive: true });
  writeFileSync(join(tele, 'scopes', 'sess-live.json'), JSON.stringify({
    v: 1, session: 'sess-live', intent: 'automation', batch: 'b-live', cases: ['TC-1'], declaredAt: 'x', updatedAt: 'x',
  }));
  const dir = join(repo, '.agents', 'automation', 'b-live');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b-live', cases: [{ id: 'TC-1', outcome: 'automated' }] }));
  assert.equal(await renderLiveReport(repo, 'sess-live', { TOKENOMICS_NO_BATCH_COST: '1' }), null, 'off-switch respected');
  const out = await renderLiveReport(repo, 'sess-live', {});
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith(join('telemetry', 'automation', 'reports', 'b-live.html')), `landed at ${out[0]}`);
  assert.match(readFileSync(out[0], 'utf8'), /b-live/);
  assert.ok(!existsSync(join(dir, 'cost.json')), 'live render never writes into the batch dir');
  assert.equal(await renderLiveReport(repo, 'sess-unknown', {}), null, 'no scope → no page, no error');
});

test('sweep: harvests a completed Copilot session for this repo, ignores other cwds', () => {
  const repo = tmp();
  const copRoot = tmp();
  for (const [id, cwd] of [['cop-here', repo], ['cop-elsewhere', '/somewhere/else']]) {
    mkdirSync(join(copRoot, id), { recursive: true });
    writeFileSync(join(copRoot, id, 'events.jsonl'), jsonl(copilotEvents({ cwd })));
  }
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: copRoot };
  const r = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r.captured, 1);
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.equal(lines[0].id, 'cop-here');
  assert.equal(lines[0].host, 'copilot');
});

// A realistic sidebar op-log: snapshot, a full-array rewrite introducing a
// custom-agent request, then path ops REWRITING request 0's counters as it
// streams (the shape measured live — naive summing overcounts ~3×).
function vscodeOplog() {
  const req0 = {
    requestId: 'request_aaa', timestamp: 1785849104000, modelId: 'copilot/claude-sonnet-4.6',
    agent: { id: 'github.copilot.editsAgent' },
    modeInfo: {
      kind: 'agent', isBuiltin: false,
      modeInstructions: { uri: { external: 'file:///repo/.github/agents/test-automation-lead.agent.md' } },
    },
    message: { text: 'automate CALCRATE-44 please' },
  };
  const req1 = {
    requestId: 'request_bbb', timestamp: 1785849404000, modelId: 'copilot/gpt-5-mini',
    elapsedMs: 60000, promptTokens: 1000, completionTokens: 20,
    result: { errorDetails: { message: 'rate limited' } },
  };
  return [
    { kind: 0, v: { requests: [req0], inputState: {} } },
    { kind: 1, k: 'requests', v: [req0, req1] },
    // streaming rewrites of request 0 — LAST value wins, never the sum
    { kind: 1, k: 'requests,0,promptTokens', v: 10000 },
    { kind: 1, k: 'requests,0,promptTokens', v: 30000 },
    { kind: 1, k: 'requests,0,promptTokens', v: 48472 },
    { kind: 1, k: 'requests,0,completionTokens', v: 100 },
    { kind: 1, k: 'requests,0,completionTokens', v: 498 },
    { kind: 1, k: 'requests,0,copilotCredits', v: 6.5 },
    { kind: 1, k: 'requests,0,copilotCredits', v: 18.1173 },
    { kind: 1, k: 'requests,0,elapsedMs', v: 120000 },
    { kind: 1, k: 'customTitle', v: 'CALCRATE-44 - automate the rate slider' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
}

test('parseVsCodeChatSession: last-write-wins replay, role from agent file uri, error counted', () => {
  const p = parseVsCodeChatSession(vscodeOplog());
  assert.equal(p.requests, 2);
  assert.deepEqual(p.tokens, { input: 49472, output: 518, cacheRead: 0, cacheWrite: 0 }); // finals, not rewrite sums
  assert.ok(Math.abs(p.credits - 18.1173) < 1e-9, 'credits = final value of the rewritten field');
  assert.equal(p.role, 'test-automation-lead');
  assert.deepEqual([...p.models].sort(), ['claude-sonnet-4.6', 'gpt-5-mini']);
  assert.equal(p.activeMin, 3); // 120s + 60s
  assert.equal(p.toolErrors, 1);
  assert.equal(p.prompts.length, 0, 'prompts off by default');
  assert.equal(p.title, 'CALCRATE-44 - automate the rate slider');
  assert.deepEqual(p.cases, ['CALCRATE-44'], 'ids mined from title + message text, ungated');
});

test('parseVsCodeChatSession: LIVE format — array path keys, kind-2 indexed inserts', () => {
  // exactly the measured shapes: {kind:0,v:snapshot}, {kind:2,k:["requests"],v:[req]},
  // {kind:2,k:["requests"],v:[req],i:1}, {kind:1,k:["requests",0,"field"],v}
  const req0 = { requestId: 'r0', timestamp: 1785849104257, modelId: 'copilot/claude-sonnet-4.6', modeInfo: { isBuiltin: false, modeInstructions: { uri: { external: 'file:///x/.github/agents/scout.agent.md' } } }, message: { text: 'seed CALCRATE-261' } };
  const req1 = { requestId: 'r1', timestamp: 1785849365143, modelId: 'copilot/claude-sonnet-4.6' };
  const doc = [
    { kind: 0, v: { version: 3, sessionId: 'x', requests: [] } },
    { kind: 1, k: ['customTitle'], v: 'Automate test cases for CALCRATE-44' },
    { kind: 2, k: ['requests'], v: [req0] },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 20000 },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 52633 },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 1333 },
    { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 18.1173 },
    { kind: 1, k: ['requests', 0, 'elapsedMs'], v: 66429 },
    { kind: 2, k: ['requests'], v: [req1], i: 1 },
    { kind: 1, k: ['requests', 1, 'completionTokens'], v: 55 },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 2);
  assert.deepEqual(p.tokens, { input: 52633, output: 1388, cacheRead: 0, cacheWrite: 0 });
  assert.ok(Math.abs(p.credits - 18.1173) < 1e-9);
  assert.equal(p.title, 'Automate test cases for CALCRATE-44');
  assert.equal(p.role, 'scout');
  assert.deepEqual(p.cases, ['CALCRATE-261', 'CALCRATE-44']);
});

test('parseVsCodeChatSession: a re-sent full array never double-counts a request', () => {
  const req = { requestId: 'r0', promptTokens: 100, completionTokens: 10, timestamp: 1785849104257 };
  const doc = [
    { kind: 2, k: ['requests'], v: [req] },
    { kind: 2, k: ['requests'], v: [req] }, // duplicate append — merge by requestId
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 1);
  assert.equal(p.tokens.input, 100);
});

test('parseVsCodeChatSession: pre-oplog plain-JSON document still parses', () => {
  const doc = JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 500, completionTokens: 5, modelId: 'gpt-4o', timestamp: 1700000000000 }] });
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 1);
  assert.equal(p.tokens.input, 500);
  assert.equal(p.credits, null, 'no credits recorded → null, never 0');
});

test('captureVsCodeSession: billed credits → USD; tokens-only stays honest', () => {
  const repo = tmp(); const dir = tmp();
  const f = join(dir, 'chat-1.jsonl');
  writeFileSync(f, vscodeOplog());
  const line = captureVsCodeSession(repo, f, 'chat-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'copilot-vscode');
  assert.equal(line.role, 'test-automation-lead');
  assert.ok(Math.abs(line.costUsd - 18.1173 * USD_PER_CREDIT) < 1e-9);
  assert.equal(line.costSource, 'copilot-credits');
  assert.equal(line.turns, 2);
  const noCredit = JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 9, timestamp: 1700000000000 }] });
  writeFileSync(f, noCredit);
  const l2 = captureVsCodeSession(repo, f, 'chat-1', { config: CFG, user: 'tester' });
  assert.equal(l2.costUsd, null);
  assert.equal(l2.costSource, 'none');
});

// The sidebar has no hooks, so `open --session auto` (a pending scope) is the
// ONLY way a sidebar session declares — and the time-window claim at capture
// is the only join. Without it every sidebar session reads undeclared.
test('captureVsCodeSession: claims a pending scope by time window, same as the other hosts', () => {
  const repo = tmp(); const dir = tmp();
  const scopes = join(repo, '.agents', 'telemetry', 'automation', 'scopes');
  mkdirSync(scopes, { recursive: true });
  writeFileSync(join(scopes, 'pending-abc.json'), JSON.stringify({
    v: 1, session: 'pending-abc', intent: 'automation', batch: 'b-side', cases: ['TC-9'],
    declaredAt: '2023-11-14T22:14:00.000Z', updatedAt: '2023-11-14T22:14:00.000Z',
  }));
  const f = join(dir, 'chat-2.jsonl');
  writeFileSync(f, JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 50, completionTokens: 5, timestamp: 1700000000000 }] })); // 2023-11-14T22:13:20Z
  const line = captureVsCodeSession(repo, f, 'chat-2', { config: CFG, user: 'tester' });
  assert.equal(line.scope?.intent, 'automation');
  assert.equal(line.scope?.batch, 'b-side');
  assert.ok(line.cases.includes('TC-9'), 'declared ids join the mined ones');
  assert.ok(existsSync(join(scopes, 'chat-2.json')), 'pending record claimed to the exact session id');
  assert.ok(!existsSync(join(scopes, 'pending-abc.json')), 'claim is single-use');
});

test('sweep: vscode sessions matched via workspace.json, re-captured on growth', () => {
  const repo = tmp();
  const root = tmp(); // a workspaceStorage dir
  const hash = join(root, 'abc123');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  const other = join(root, 'zzz999'); // different workspace — must be ignored
  mkdirSync(join(other, 'chatSessions'), { recursive: true });
  writeFileSync(join(other, 'workspace.json'), JSON.stringify({ folder: 'file:///somewhere/else' }));
  writeFileSync(join(other, 'chatSessions', 'x.jsonl'), vscodeOplog());
  const f = join(hash, 'chatSessions', 'chat-9.jsonl');
  writeFileSync(f, vscodeOplog());
  const old = new Date('2026-08-01T10:00:00Z');
  utimesSync(f, old, old);
  utimesSync(join(other, 'chatSessions', 'x.jsonl'), old, old);
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1, 'only this repo\'s session captured');
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 0, 'unchanged file not re-captured');
  // the chat grows later → mtime moves past the recorded end → re-capture
  appendFileSync(f, JSON.stringify({ kind: 1, k: 'requests,1,completionTokens', v: 999 }) + '\n');
  // growth is detected by mtime moving past the recorded session end (+margin);
  // the fixture's request timestamps end ~2026-08-04T14:04Z, so 20:00Z is past
  // the margin while still safely older than "now" (never live-grace territory)
  const grown = new Date('2026-08-04T20:00:00Z');
  utimesSync(f, grown, grown);
  const r3 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r3.captured, 1, 'grown file re-captured');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'chat-9');
  assert.equal(lines.length, 2, 'append-only: both captures kept; the report dedups latest-wins');
  assert.equal(lines[1].tokens.output, 518 - 20 + 999, 'recapture carries the grown final values');
});

test('vscodeStorageRoots: env override wins; config extras accepted as user-data or storage dirs', () => {
  const ws = tmp();
  assert.deepEqual(vscodeStorageRoots('/x', { TOKENOMICS_VSCODE_ROOT: ws }, {}), [ws]);
  const userData = tmp();
  mkdirSync(join(userData, 'User', 'workspaceStorage'), { recursive: true });
  const roots = vscodeStorageRoots('/x', { TOKENOMICS_VSCODE_ROOT: '' }, { vscodeUserDataDirs: [userData] });
  assert.ok(roots.includes(join(userData, 'User', 'workspaceStorage')));
});

test('workspaceFolderOf: decodes file URIs including windows drive form', () => {
  const hash = tmp();
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: 'file:///c%3A/Repos/My%20App' }));
  assert.equal(workspaceFolderOf(hash), 'c:/Repos/My App');
  assert.equal(workspaceFolderOf(tmp()), null, 'no workspace.json → null');
});

test('ensureSink: refuses to manage a remote collector', () => {
  assert.equal(ensureSink({ enabled: true, endpoint: 'https://otel.example.com:4318' }), false);
});

test('knownSessions reads every user ledger and keeps the latest endedAt', () => {
  const repo = tmp();
  appendLine(repo, 'alice', { v: 1, host: 'claude', id: 'x', endedAt: '2026-07-30T10:00:00Z' });
  appendLine(repo, 'bob', { v: 1, host: 'claude', id: 'x', endedAt: '2026-07-30T12:00:00Z' });
  appendLine(repo, 'bob', { v: 1, host: 'copilot', id: 'y', endedAt: null });
  const known = knownSessions(repo);
  assert.equal(known.get('claude:x'), Date.parse('2026-07-30T12:00:00Z'));
  assert.ok(known.has('copilot:y'));
});

test('sameCwdOrUnder: exact, nested, separator/case-insensitive', () => {
  assert.ok(sameCwdOrUnder('/a/b', '/a/b'));
  assert.ok(sameCwdOrUnder('/a/b/c', '/a/b'));
  assert.ok(!sameCwdOrUnder('/a/bc', '/a/b'));
  assert.ok(sameCwdOrUnder('C:\\Repo\\X', 'c:/repo'));
});

test('encodeProjectPath matches the transcript-store encoding', () => {
  assert.equal(encodeProjectPath('/Users/x y/repo.name'), '-Users-x-y-repo-name');
});

// Field case 2026-08-18 (manual-qa-verified route): the dispatch prompt names
// the run report "RUN-2026-08-17-001", and the case-id regex minted a phantom
// case "RUN-2026" that siphoned half the combined slot's cost attribution.
// A real case id is never immediately followed by another dash-digit segment.
test('extractCaseIds rejects fragments of longer dash-number chains', async () => {
  const { extractCaseIds } = await import('./telemetry-capture.mjs');
  assert.deepEqual(extractCaseIds('validated by RUN-2026-08-17-001 evidence'), []);
  assert.deepEqual(extractCaseIds('implement TC-001 per tasks/smoke/TC-001_home.md'), ['TC-001']);
  assert.deepEqual(extractCaseIds('ELITEA-2083 on branch tests/batch-chat-2083'), ['ELITEA-2083']);
  // a bare run-report-shaped token with no continuation still counts — honesty
  // over cleverness; the scope intersection is the second guard for those
  assert.deepEqual(extractCaseIds('see RUN-2026 for details'), ['RUN-2026']);
});

// Attribution reads the workflow-return RECEIPT first — a parameter round-trip
// (workflow args → prompt → schema-required unit_ids echo → receipt) — and
// only falls back to scope-gated prompt mining where no receipt exists.
test('receiptCaseIds: unit_ids echo wins; analyst cases[] and triage units[] parse too', async () => {
  const { receiptCaseIds } = await import('./telemetry-capture.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const repo = mkdtempSync(join(tmpdir(), 'receipt-ids-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'returns', 'wf_x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaa.json'), JSON.stringify({ result: { unit_ids: ['TC-2', 'TC-1'] } }));
  writeFileSync(join(dir, 'bbb.json'), JSON.stringify({ result: { cases: [{ case_id: 'TC-7' }, { case_id: 'TC-7' }] } }));
  writeFileSync(join(dir, 'ccc.json'), JSON.stringify({ result: { units: [{ ids: ['TC-1'] }, { ids: ['TC-2'] }] } }));
  writeFileSync(join(dir, 'ddd.json'), JSON.stringify({ result: { text: 'no ids here' } }));
  assert.deepEqual(receiptCaseIds(repo, 'aaa'), ['TC-1', 'TC-2']);
  assert.deepEqual(receiptCaseIds(repo, 'bbb'), ['TC-7']);
  assert.deepEqual(receiptCaseIds(repo, 'ccc'), ['TC-1', 'TC-2']);
  assert.equal(receiptCaseIds(repo, 'ddd'), null, 'text-shaped receipt → fall back to mining');
  assert.equal(receiptCaseIds(repo, 'zzz'), null, 'no receipt → fall back to mining');
});
