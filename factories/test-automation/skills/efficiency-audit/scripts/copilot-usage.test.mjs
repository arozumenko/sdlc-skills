import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { sessionUsage, subagentUnits, collectCopilotGroups, priceGroups, copilotRoots, sameCwdOrUnder, firstCwdOfEvents } from './copilot-usage.mjs';

const ev = (type, data, extra = {}) => ({ type, data, timestamp: '2026-04-22T14:00:00.000Z', ...extra });
const shutdown = (models, premium = 0) => ev('session.shutdown', {
  totalPremiumRequests: premium, totalApiDurationMs: 1000, modelMetrics: models,
});
const metrics = (input, output, cacheRead = 0, cacheWrite = 0, count = 1) => ({
  requests: { count, cost: 0 },
  usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: 0 },
});

// A long session shuts down more than once (resume, compaction) and each
// shutdown reports the totals SO FAR. Summing them double-counts the session.
test('repeated shutdowns are cumulative, not deltas — the last one wins', () => {
  const { usage, premiumRequests } = sessionUsage([
    shutdown({ 'sonnet-4.6': metrics(100, 10) }, 2),
    shutdown({ 'sonnet-4.6': metrics(300, 30) }, 5),
  ]);
  assert.equal(usage.input, 300);
  assert.equal(usage.output, 30);
  assert.equal(premiumRequests, 5);
});

test('per-model usage sums across models and records every model seen', () => {
  const { usage } = sessionUsage([
    shutdown({ 'sonnet-4.6': metrics(100, 10, 50, 5), 'haiku-4.5': metrics(20, 2, 8, 1) }),
  ]);
  assert.equal(usage.input, 120);
  assert.equal(usage.output, 12);
  assert.equal(usage.cacheRead, 58);
  assert.equal(usage.cacheCreation, 6);
  assert.deepEqual([...usage.models].sort(), ['haiku-4.5', 'sonnet-4.6']);
});

test('no shutdown event (session still open) yields zeroed usage, not a throw', () => {
  const { usage, premiumRequests } = sessionUsage([ev('user.message', { content: 'hi' })]);
  assert.equal(usage.input, 0);
  assert.equal(premiumRequests, 0);
});

const SUB_EVENTS = [
  ev('session.start', { sessionId: 's1', context: { cwd: '/repo', branch: 'main' } }),
  ev('subagent.started', { toolCallId: 'a1', agentName: 'qa-engineer', agentDescription: 'analyse' }),
  ev('assistant.message', { content: 'working' }, { agentId: 'a1' }),
  ev('user.message', { content: 'result' }, { agentId: 'a1' }),
  ev('tool.execution_complete', { toolCallId: 'x', success: false }, { agentId: 'a1' }),
  ev('subagent.completed', {
    toolCallId: 'a1', agentName: 'qa-engineer', model: 'sonnet-4.6',
    totalTokens: 5000, totalToolCalls: 12, durationMs: 120000,
  }),
];

// Copilot pre-aggregates what the Claude path has to meter with ccusage.
test('sub-agent units carry Copilot\'s own per-agent accounting', () => {
  const [u] = subagentUnits(SUB_EVENTS, 's1');
  assert.equal(u.role, 'qa-engineer');
  assert.equal(u.kind, 'subagent');
  assert.equal(u.parentId, 's1');
  assert.equal(u.toolCalls, 12);
  assert.equal(u.durationMin, 2);
  assert.equal(u.usage.input, 5000);
  assert.ok(u.tokensOnly, 'must be flagged: there is no input/output split per sub-agent');
});

// subagent.completed reports tool calls and duration but NOT turns or errors —
// those only exist as agentId-tagged events in the parent stream.
test('turns and errors are counted from the agentId-tagged events', () => {
  const [u] = subagentUnits(SUB_EVENTS, 's1');
  assert.equal(u.turns, 2);
  assert.equal(u.toolErrors, 1);
});

function stageSession(root, id, events) {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

test('groups are one per session, parent first, filtered to the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-'));
  try {
    stageSession(root, 's1', [...SUB_EVENTS, shutdown({ 'sonnet-4.6': metrics(9000, 100) }, 3)]);
    stageSession(root, 's2', [ev('session.start', { context: { cwd: '/other' } }), shutdown({ 'x': metrics(1, 1) })]);
    const groups = collectCopilotGroups('/repo', { root });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].sessionId, 's1');
    assert.equal(groups[0].units[0].kind, 'session');
    assert.equal(groups[0].units[1].kind, 'subagent');
    assert.equal(groups[0].units[0].premiumRequests, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// CLI ≥1.0.63 names the parent session's --agent (subagent.selected) and the
// skills it loads (skill.invoked) — verified live 2026-08-05; older streams
// lack both, so the fields default rather than break.
test('parent role from subagent.selected and skills from skill.invoked; a tag still wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-'));
  try {
    stageSession(root, 's1', [
      ev('session.start', { context: { cwd: '/repo', branch: 'main' } }),
      ev('subagent.selected', { agentName: 'test-automation-lead', agentDisplayName: 'test-automation-lead' }),
      ev('skill.invoked', { name: 'test-automation-workflow', path: '/x/SKILL.md' }),
      shutdown({ 'sonnet-4.6': metrics(100, 1) }),
    ]);
    const [g] = collectCopilotGroups('/repo', { root });
    assert.equal(g.units[0].role, 'test-automation-lead');
    assert.deepEqual(g.units[0].skills, ['test-automation-workflow']);
    const [tagged] = collectCopilotGroups('/repo', { root, tags: { s1: 'operator' } });
    assert.equal(tagged.units[0].role, 'operator', 'an explicit tag overrides the stream');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pre-1.0.63 stream (no subagent.selected) keeps role null', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-'));
  try {
    stageSession(root, 's1', [ev('session.start', { context: { cwd: '/repo' } }), shutdown({ m: metrics(1, 1) })]);
    const [g] = collectCopilotGroups('/repo', { root });
    assert.equal(g.units[0].role, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The session total already includes its sub-agents; reporting both at full
// value would inflate the project's spend by the sub-agent share.
test('the parent row is net of its sub-agents so they do not double-count', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-'));
  try {
    stageSession(root, 's1', [...SUB_EVENTS, shutdown({ 'sonnet-4.6': metrics(9000, 100) })]);
    const [g] = collectCopilotGroups('/repo', { root });
    assert.equal(g.units[1].usage.input, 5000);      // the sub-agent
    assert.equal(g.units[0].usage.input, 4000);      // 9000 total − 5000
    assert.equal(g.units.reduce((n, u) => n + u.usage.input, 0), 9000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a sub-agent bigger than the reported session total floors at zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-'));
  try {
    stageSession(root, 's1', [...SUB_EVENTS, shutdown({ 'sonnet-4.6': metrics(100, 1) })]);
    const [g] = collectCopilotGroups('/repo', { root });
    assert.equal(g.units[0].usage.input, 0);         // never negative
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('several roots are read together and an explicit root pins one', () => {
  const a = mkdtempSync(join(tmpdir(), 'cu-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cu-b-'));
  try {
    stageSession(a, 's-local', [ev('session.start', { context: { cwd: '/repo' } }), shutdown({ m: metrics(1, 1) })]);
    stageSession(b, 's-home', [ev('session.start', { context: { cwd: '/repo' } }), shutdown({ m: metrics(1, 1) })]);
    assert.equal(collectCopilotGroups('/repo', { roots: [a, b] }).length, 2);
    assert.equal(collectCopilotGroups('/repo', { root: a }).length, 1);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// COPILOT_HOME relocates the config dir, and pointing it at a repo-local
// .copilot is a documented setup — a home-only lookup would miss those.
test('copilotRoots honours COPILOT_HOME and the repo-local dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'ch-'));
  try {
    mkdirSync(join(home, 'session-state'), { recursive: true });
    const roots = copilotRoots('/nonexistent-project', { COPILOT_HOME: home });
    assert.ok(roots.includes(join(home, 'session-state')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('copilotRoots returns nothing when no root exists', () => {
  assert.deepEqual(copilotRoots('/nonexistent-project', { COPILOT_HOME: '/nonexistent-home' })
    .filter((p) => !p.startsWith(homedir())), []);
});

// This skill never invents a rate: no OTel data means no dollars, stated.
test('with no billed figure at all, cost is null — never a confident $0', () => {
  const groups = [{ sessionId: 's', units: [{ id: 'p', kind: 'session', usage: { input: 10, output: 1 } }] }];
  priceGroups(groups);
  assert.equal(groups[0].units[0].cost, null);
  assert.equal(groups[0].units[0].costSource, 'copilot-tokens-only');
});

// GitHub moved Copilot to usage-based billing on 2026-06-01: cost = model +
// tokens, denominated in AI credits at 1 credit = $0.01, and Copilot reports it
// as `session.shutdown.totalNanoAiu`. Premium requests are the legacy unit.
test('totalNanoAiu converts to credits and dollars', () => {
  const { nanoAiu, credits, usd } = sessionUsage([
    { type: 'session.shutdown', data: { totalNanoAiu: 19_862_850_000, modelMetrics: {} } },
  ]);
  assert.equal(nanoAiu, 19_862_850_000);
  assert.equal(credits, 19.86285);
  assert.ok(Math.abs(usd - 0.1986285) < 1e-9);
});

// A pre-transition session has no credit figure. Unknown must not read as free.
test('a session predating usage-based billing reports null cost, not zero', () => {
  const { nanoAiu, credits, usd, premiumRequests } = sessionUsage([
    { type: 'session.shutdown', data: { totalPremiumRequests: 4, modelMetrics: {} } },
  ]);
  assert.equal(nanoAiu, null);
  assert.equal(credits, null);
  assert.equal(usd, null);
  assert.equal(premiumRequests, 4);
});

test('priceGroups splits the session\'s own billed dollars across its units', () => {
  const groups = [{
    sessionId: 's',
    units: [
      { id: 'p', kind: 'session', usd: 1.0, usage: { input: 30, output: 0 } },
      { id: 'a', kind: 'subagent', usage: { input: 10, output: 0 } },
    ],
  }];
  priceGroups(groups);
  assert.deepEqual(groups[0].units.map((u) => u.cost), [0.75, 0.25]);
  assert.deepEqual(groups[0].units.map((u) => u.costSource), ['copilot-nano-aiu', 'copilot-nano-aiu']);
});

test('an external ccusage figure overrides Copilot\'s own and is labelled so', () => {
  const groups = [{ sessionId: 's', units: [{ id: 'p', kind: 'session', usd: 1.0, usage: { input: 10, output: 0 } }] }];
  priceGroups(groups, { costBySession: new Map([['s', 2]]) });
  assert.equal(groups[0].units[0].cost, 2);
  assert.equal(groups[0].units[0].costSource, 'ccusage-copilot');
});

// A sub-agent reports ONE cache-inclusive `totalTokens` (parked in usage.input),
// while a session row carries a true split. Weighing by input+output therefore
// counted the sub-agent's cache traffic and dropped the parent's — systematically
// over-crediting sub-agents on exactly the cache-heavy orchestrator sessions this
// pipeline produces. Every bucket counts, so both sides are measured alike.
test('the credit split weighs cache tokens on both sides, not just the sub-agent\'s', () => {
  const groups = [{
    sessionId: 's',
    units: [
      // Parent: 10 in + 0 out, but 90 of cache traffic — 100 tokens of real work.
      { id: 'p', kind: 'session', usd: 1.0, usage: { input: 10, output: 0, cacheRead: 80, cacheCreation: 10 } },
      // Sub-agent: 100 total, cache-inclusive, in `input` by construction.
      { id: 'a', kind: 'subagent', usage: { input: 100, output: 0 } },
    ],
  }];
  priceGroups(groups);
  // Equal real work → equal split. Input+output weighting gave the sub-agent
  // 100/110 ≈ 91% of the session's dollars.
  assert.deepEqual(groups[0].units.map((u) => u.cost), [0.5, 0.5]);
});

// Windows mixes `\` and `/` and is case-insensitive; an exact === comparison
// matched nothing there, so a Copilot audit on Windows silently found no sessions.
test('cwd matching survives Windows separators and case', () => {
  assert.ok(sameCwdOrUnder('C:\\repo\\pkg', 'C:/repo/pkg'));
  assert.ok(sameCwdOrUnder('C:\\Repo\\Pkg\\sub', 'c:/repo/pkg'), 'a subdirectory counts');
  assert.ok(sameCwdOrUnder('/home/u/proj/', '/home/u/proj'), 'a trailing slash is not a difference');
  assert.ok(!sameCwdOrUnder('/home/u/proj-other', '/home/u/proj'), 'a sibling prefix is NOT under it');
  assert.ok(!sameCwdOrUnder(null, '/home/u/proj'), 'unknown cwd never matches a filter');
  assert.ok(sameCwdOrUnder('/anything', null), 'no filter matches everything');
});

// The cwd probe must READ a bounded head, not slice a full read: Copilot pools
// every project's sessions in one directory and streams reach 22 MB.
test('firstCwdOfEvents answers from the head and tolerates junk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const p = join(dir, 'events.jsonl');
    writeFileSync(p, [
      'not json at all',
      JSON.stringify({ type: 'session.start', data: { context: { cwd: '/x/y' } } }),
      `${'x'.repeat(200000)}`,             // a huge tail that must never be parsed
    ].join('\n'));
    assert.equal(firstCwdOfEvents(p), '/x/y');
    writeFileSync(join(dir, 'none.jsonl'), 'nothing here\n');
    assert.equal(firstCwdOfEvents(join(dir, 'none.jsonl')), null);
    assert.equal(firstCwdOfEvents(join(dir, 'missing.jsonl')), null, 'unreadable is unknown, not a throw');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The sub-agent join keys on `agentId` and reads back by `data.toolCallId`. It
// works only because Copilot uses ONE id for both, which is a property of the
// stream, not of this code — if it ever stops holding, every sub-agent silently
// reports 0 turns and 0 errors, which reads as "quiet sub-agent" rather than as
// a parsing failure.
//
// This fixture mirrors a REAL CLI stream (measured 2026-07-31 against a 4.7 MB
// session with 17 sub-agents): `agentId` sits at the EVENT's top level and
// equals `data.toolCallId`, on subagent.started/completed, assistant.message
// and tool.execution_start/complete alike. 17 of 17 matched there.
test('sub-agent turns and errors join on agentId === data.toolCallId', () => {
  const TC = 'toolu_01RBW9cFJ458ErVMRaLFE53u';
  const events = [
    ev('subagent.started', { toolCallId: TC, agentName: 'qa-engineer', agentDisplayName: 'qa-engineer', agentDescription: 'analyse TC-1' }, { agentId: TC }),
    ev('assistant.message', {}, { agentId: TC }),
    ev('assistant.message', {}, { agentId: TC }),
    ev('tool.execution_complete', { success: false }, { agentId: TC }),
    // The parent's own traffic carries NO agentId and must not be credited.
    ev('assistant.message', {}),
    ev('subagent.completed', {
      toolCallId: TC, agentName: 'qa-engineer', model: 'claude-sonnet-4.6',
      totalToolCalls: 25, totalTokens: 1307347, durationMs: 783931,
    }, { agentId: TC }),
  ];
  const [u] = subagentUnits(events, 's1');
  assert.equal(u.id, TC, 'the unit is keyed by the tool-call id');
  assert.equal(u.turns, 2, 'turns came from agentId-tagged messages — a broken join would give 0');
  assert.equal(u.toolErrors, 1);
  assert.equal(u.toolCalls, 25);
  assert.equal(u.usage.input, 1307347, 'cache-INCLUSIVE total, parked in input by construction');
  assert.equal(u.role, 'qa-engineer');
});

// An older session (pre-2026-06 usage billing) reports premium requests and NO
// totalNanoAiu. Unknown must never collapse to a confident $0.
test('a legacy session prices as unknown, not as free', () => {
  const { nanoAiu, credits, usd, premiumRequests, usage } = sessionUsage([
    shutdown({ 'claude-sonnet-4.6': metrics(22197306, 297739, 20933459, 0, 330) }, 5),
  ]);
  assert.equal(nanoAiu, null);
  assert.equal(credits, null);
  assert.equal(usd, null);
  assert.equal(premiumRequests, 5);
  assert.equal(usage.input, 22197306, 'tokens are still counted — only the dollars are unknown');
  assert.equal(usage.cacheRead, 20933459);
});

// `subagent.started` is the PARENT dispatching, but the event carries the
// CHILD's id in `agentId` (18 of 18 across CLI 1.0.35 and 1.0.63). Reading it
// behind the sub-agent skip made the push unreachable, so every session
// reported zero dispatches while dispatching normally — a dead signal that
// looked like a quiet session. Shapes here mirror a real 1.0.63 stream.
test('a session reports the sub-agents it dispatched', () => {
  const root = mkdtempSync(join(tmpdir(), 'cu-d-'));
  const TC = 'toolu_01H84Azbq84wqy6iwYauyynw';
  try {
    stageSession(root, 's1', [
      ev('session.start', { context: { cwd: '/repo' } }),
      ev('user.message', {}),
      ev('assistant.message', {}),
      ev('tool.execution_start', { toolCallId: TC, toolName: 'task' }),
      ev('subagent.started', { toolCallId: TC, agentName: 'general-purpose' }, { agentId: TC }),
      ev('assistant.message', {}, { agentId: TC }),
      ev('subagent.completed', {
        toolCallId: TC, agentName: 'general-purpose',
        totalTokens: 22631, totalToolCalls: 0, durationMs: 4674,
      }, { agentId: TC }),
      shutdown({ 'claude-haiku-4.5': metrics(78411, 813, 36846, 41530) }),
    ]);
    const [g] = collectCopilotGroups('/repo', { root });
    const parent = g.units.find((u) => u.kind === 'session');
    assert.deepEqual(parent.dispatched, ['general-purpose']);
    assert.equal(parent.turns, 2, "the sub-agent's own message is not a parent turn");
    assert.equal(parent.toolCalls, 1);
    // Parent tokens are net of the sub-agent's, so the two never double-count.
    assert.equal(parent.usage.input, 78411 - 22631);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
