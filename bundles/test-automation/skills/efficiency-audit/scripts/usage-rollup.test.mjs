import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeProjectPath, dedupUsage, parseUnit, mergeUsage, cacheHitRate, outputShare,
  costWeight, indexCcusage, allocateCost, filterGroupsByDateRange,
  buildRollup, renderDiff, renderMarkdown, parseArgs, HELP, collectSessionGroups,
} from './usage-rollup.mjs';

test('encodeProjectPath replaces slashes and dots with dashes', () => {
  assert.equal(encodeProjectPath('/Users/a/dev/x'), '-Users-a-dev-x');
  assert.equal(encodeProjectPath('/U/x.y.z'), '-U-x-y-z');
});

// The correctness linchpin: streaming writes the same message.id repeatedly
// with growing output while input/cache stay fixed. Summing double-counts;
// max-per-id reproduces ccusage. This test pins that rule.
test('dedupUsage: takes MAX output per message.id, not the sum (ccusage-faithful)', () => {
  const records = [
    { message: { id: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } } },
    { message: { id: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 250, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } } }, // same request, output grew
    { message: { id: 'm2', model: 'claude-opus-4-8', usage: { input_tokens: 40, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  const u = dedupUsage(records);
  assert.equal(u.output, 250 + 80, 'output = max(10,250) + 80, NOT 10+250+80');
  assert.equal(u.input, 100 + 40, 'input counted once per id');
  assert.equal(u.cacheRead, 5 + 0);
});

test('dedupUsage: records with no message.id never merge', () => {
  const records = [
    { message: { usage: { output_tokens: 10 } } },
    { message: { usage: { output_tokens: 20 } } },
  ];
  assert.equal(dedupUsage(records).output, 30);
});

test('parseUnit: reads agent-setting role, counts assistant turns, tracks date range', () => {
  const records = [
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'assistant', timestamp: '2026-06-01T10:00:00.000Z', gitBranch: 'main', message: { id: 'a', usage: { output_tokens: 5 } } },
    { type: 'assistant', timestamp: '2026-06-01T10:30:00.000Z', message: { id: 'b', usage: { output_tokens: 7 } } },
  ];
  const u = parseUnit(records);
  assert.equal(u.agentSetting, 'test-automation-lead');
  assert.equal(u.turns, 2);
  assert.equal(u.date, '2026-06-01');
  assert.equal(u.durationMin, 30);
  assert.equal(u.usage.output, 12);
});

test('parseUnit: counts tool calls + errors, collects skill names, and records Agent dispatches', () => {
  const records = [
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', name: 'Skill', input: { skill: 'memory', args: 'load' } },
      { type: 'tool_use', name: 'Agent', input: { subagent_type: 'qa-engineer', description: 'Analyst: T532' } },
      { type: 'tool_use', name: 'Agent', input: { description: 'stop the failing one' } }, // no subagent_type -> unknown
    ] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'x', is_error: true },
      { type: 'tool_result', tool_use_id: 'y' },
    ] } },
    { attributionSkill: 'test-automation-workflow', type: 'assistant', message: { content: [] } },
  ];
  const u = parseUnit(records);
  assert.equal(u.toolCalls, 4);
  assert.equal(u.toolErrors, 1);
  assert.deepEqual([...u.skills].sort(), ['memory', 'test-automation-workflow']);
  assert.deepEqual(u.dispatched, [
    { type: 'qa-engineer', description: 'Analyst: T532' },
    { type: 'unknown', description: 'stop the failing one' },
  ]);
});

test('parseUnit: a shared seen context dedups replayed messages/tools across forked units', () => {
  const seen = { msg: new Set(), tool: new Set() };
  const original = [
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
  ];
  const fork = [ // replays m1/t1 (a resume), then adds new m2/t2
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't2', name: 'Read' }] } },
  ];
  const a = parseUnit(original, seen);
  assert.equal(a.usage.output, 50);
  assert.equal(a.turns, 1);
  assert.equal(a.toolCalls, 1);
  const b = parseUnit(fork, seen);
  assert.equal(b.usage.output, 5, 'replayed m1 tokens skipped, only new m2 counted');
  assert.equal(b.usage.input, 10);
  assert.equal(b.turns, 1, 'replayed assistant turn skipped');
  assert.equal(b.toolCalls, 1, 'replayed tool_use skipped');
});

test('parseUnit: without a shared seen (default), dedup is within-file only (unchanged behaviour)', () => {
  const recs = [
    { type: 'assistant', message: { id: 'm1', usage: { output_tokens: 50 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
  ];
  const a = parseUnit(recs); // fresh seen
  const b = parseUnit(recs); // fresh seen again — NOT deduped against the first call
  assert.equal(a.usage.output, 50);
  assert.equal(b.usage.output, 50);
  assert.equal(b.toolCalls, 1);
});

test('buildRollup: aggregates tool calls/errors, skills (union), Agent dispatches, and bySkill', () => {
  const groups = [{
    sessionId: 's1', projectDir: '/p', date: '2026-06-01',
    units: [
      { id: 's1', kind: 'session', parentId: null, role: 'lead', usage: { output: 10, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 5, turns: 3, projectDir: '/p', toolCalls: 20, toolErrors: 4, skills: new Set(['memory']), dispatched: [{ type: 'impl', description: 'a' }, { type: 'impl', description: 'b' }] },
      { id: 'a', kind: 'subagent', parentId: 's1', role: 'impl', usage: { output: 30, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 9, turns: 8, projectDir: '/p', toolCalls: 50, toolErrors: 1, skills: new Set(['memory', 'test-automation-workflow']), dispatched: [] },
    ],
  }];
  const r = buildRollup(groups, { meteredMap: new Map([['s1', 3], ['a', 7]]) });
  assert.equal(r.totals.toolCalls, 70);
  assert.equal(r.totals.toolErrors, 5);
  assert.equal(r.totals.toolSuccess, 65);
  assert.equal(r.totals.subagentsDispatched, 2, 'only the lead dispatched (2 Agent calls)');
  assert.deepEqual(r.totals.skills.sort(), ['memory', 'test-automation-workflow']);
  assert.equal(r.byRole.lead.subagentsDispatched, 2);
  assert.equal(r.byRole.impl.subagentsDispatched, 0);
  // bySkill: memory used by both units, workflow by one
  assert.equal(r.bySkill.memory.units, 2);
  assert.equal(r.bySkill['test-automation-workflow'].units, 1);
  // ledger exposes skills as a JSON-safe array
  assert.ok(Array.isArray(JSON.parse(JSON.stringify(r.ledger))[0].skills));
});

test('cacheHitRate and outputShare: 0 with no tokens, else the ratio', () => {
  assert.equal(cacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }), 0);
  const u = { input: 100, output: 50, cacheRead: 300, cacheCreation: 100 };
  assert.equal(cacheHitRate(u), 300 / 500);
  assert.equal(outputShare(u), 50 / 550);
});

test('costWeight: cost-ratio by default, output/total modes on request', () => {
  const u = { input: 100, output: 50, cacheRead: 300, cacheCreation: 100 };
  // default 'cost' = output*5 + input*1 + cacheCreation*1.25 + cacheRead*0.1
  assert.equal(costWeight(u), 50 * 5 + 100 * 1 + 100 * 1.25 + 300 * 0.1);
  assert.equal(costWeight(u, 'output'), 50);
  assert.equal(costWeight(u, 'total'), 550);
});

test('allocateCost (cost-weighted, default): a cache-heavy unit gets a fairer slice than output-only would give', () => {
  // Unit A: output-heavy. Unit B: cache-heavy, little output. Same session $10.
  const group = { sessionId: 's1', units: [
    { id: 'A', role: 'implementer', usage: { output: 1000, input: 0, cacheRead: 0, cacheCreation: 0 } },
    { id: 'B', role: 'reviewer', usage: { output: 200, input: 0, cacheRead: 500000, cacheCreation: 0 } },
  ] };
  const sessionMap = new Map([['s1', { costUsd: 10 }]]);
  const costW = allocateCost(group, { sessionMap }); // default cost weighting
  const outW = allocateCost(group, { sessionMap, weight: 'output' });
  const sum = costW.reduce((a, u) => a + u.costUsd, 0);
  assert.ok(Math.abs(sum - 10) < 1e-9, 'still sums to the real ccusage $10');
  const bCost = costW.find((u) => u.id === 'B').costUsd;
  const bOut = outW.find((u) => u.id === 'B').costUsd;
  assert.ok(bCost > bOut, 'cost-weighting credits B for its 500k cache reads; output-only ignores them');
});

test('indexCcusage: parses the real v20 shape (session[].period/totalCost) and filters by agent', () => {
  const parsed = { session: [
    { period: 's1', totalCost: 30.96, agent: 'claude', outputTokens: 239012, modelsUsed: ['claude-sonnet-4-6'] },
    { period: 's2', totalCost: 1.5, agent: 'codex', outputTokens: 100 },
  ] };
  const all = indexCcusage(parsed);
  assert.equal(all.get('s1').costUsd, 30.96);
  assert.equal(all.get('s2').costUsd, 1.5);
  const claudeOnly = indexCcusage(parsed, 'claude');
  assert.equal(claudeOnly.has('s2'), false, 'codex session filtered out when agent=claude');
});

test('allocateCost: METERED path wins — each unit takes its own per-file ccusage cost', () => {
  const group = { sessionId: 's1', units: [
    { id: 's1', role: 'test-automation-lead', usage: { output: 44328 } },
    { id: 'agent-a', role: 'test-automation-engineer', usage: { output: 73456 } },
    { id: 'agent-b', role: 'qa-engineer', usage: { output: 10012 } },
  ] };
  const meteredMap = new Map([['s1', 5.52], ['agent-a', 7.17], ['agent-b', 1.56]]);
  const sessionMap = new Map([['s1', { costUsd: 30.96 }]]); // present, but metered must win
  const priced = allocateCost(group, { meteredMap, sessionMap });
  assert.deepEqual(priced.map((u) => u.costUsd), [5.52, 7.17, 1.56]);
  assert.ok(priced.every((u) => u.costSource === 'ccusage-metered'));
});

test('allocateCost: falls back to allocation when metered map lacks a unit', () => {
  const group = { sessionId: 's1', units: [
    { id: 's1', role: 'lead', usage: { output: 100 } },
    { id: 'agent-a', role: 'impl', usage: { output: 300 } },
  ] };
  const meteredMap = new Map([['s1', 5.0]]); // missing agent-a -> can't meter the group
  const sessionMap = new Map([['s1', { costUsd: 8.0 }]]);
  const priced = allocateCost(group, { meteredMap, sessionMap, weight: 'output' });
  assert.ok(priced.every((u) => u.costSource === 'ccusage-allocated'));
  assert.ok(Math.abs(priced.reduce((a, u) => a + u.costUsd, 0) - 8.0) < 1e-9);
});

test('allocateCost: single whole-session unit takes the session total directly', () => {
  const group = { sessionId: 's1', units: [{ id: 's1', role: 'scout', usage: { output: 1000 } }] };
  const priced = allocateCost(group, { sessionMap: new Map([['s1', { costUsd: 2.68 }]]) });
  assert.equal(priced[0].costUsd, 2.68);
  assert.equal(priced[0].costSource, 'ccusage');
});

test('allocateCost: multi-unit allocation is cost-weighted and sums back to the real ccusage total', () => {
  const group = { sessionId: 's1', units: [
    { id: 's1', role: 'test-automation-lead', usage: { output: 44328 } },
    { id: 'a', role: 'test-automation-engineer', usage: { output: 73456 } },
    { id: 'b', role: 'qa-engineer', usage: { output: 10012 } },
  ] };
  const total = 30.96;
  const priced = allocateCost(group, { sessionMap: new Map([['s1', { costUsd: total }]]) });
  const sum = priced.reduce((a, u) => a + u.costUsd, 0);
  assert.ok(Math.abs(sum - total) < 1e-9, 'allocated shares sum to the ccusage total');
  assert.ok(priced.every((u) => u.costSource === 'ccusage-allocated'));
  assert.ok(priced[1].costUsd > priced[0].costUsd && priced[0].costUsd > priced[2].costUsd);
});

test('allocateCost: no ccusage entry -> null cost, source unavailable (never estimated)', () => {
  const group = { sessionId: 'gone', units: [{ id: 'gone', role: 'scout', usage: { output: 10 } }] };
  const priced = allocateCost(group, {});
  assert.equal(priced[0].costUsd, null);
  assert.equal(priced[0].costSource, 'unavailable');
});

test('filterGroupsByDateRange: keeps in-window, drops+counts unknown-date groups', () => {
  const groups = [{ date: '2026-06-01' }, { date: '2026-06-15' }, { date: '?' }];
  const { kept, droppedUnknownDate } = filterGroupsByDateRange(groups, '2026-06-10', '2026-06-30');
  assert.equal(kept.length, 1);
  assert.equal(droppedUnknownDate, 1);
});

test('buildRollup: orchestrator counts as its own unit alongside its sub-agents; totals sum to ccusage', () => {
  const groups = [{
    sessionId: 's1', projectDir: '/p', date: '2026-06-01',
    units: [
      { id: 's1', kind: 'session', parentId: null, role: 'test-automation-lead', usage: { output: 44328, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 10, turns: 154, projectDir: '/p' },
      { id: 'a', kind: 'subagent', parentId: 's1', role: 'test-automation-engineer', usage: { output: 73456, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 20, turns: 241, projectDir: '/p' },
    ],
  }];
  const meteredMap = new Map([['s1', 5.52], ['a', 25.44]]); // exact per-file
  const r = buildRollup(groups, { meteredMap });
  assert.ok('test-automation-lead' in r.byRole, 'orchestrator role appears, not only the dispatched sub-agent');
  assert.ok('test-automation-engineer' in r.byRole);
  assert.equal(r.totals.count, 2);
  assert.equal(r.costMethod, 'metered');
  assert.ok(Math.abs(r.totals.costUsd - 30.96) < 1e-9);
});

test('buildRollup: surfaces each unit/role model(s) as a JSON-safe array (not an empty Set)', () => {
  const groups = [{
    sessionId: 's1', projectDir: '/p', date: '2026-06-01',
    units: [
      { id: 's1', kind: 'session', parentId: null, role: 'test-automation-lead', usage: { output: 100, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set(['claude-opus-4-8', 'claude-sonnet-4-6']) }, date: '2026-06-01', durationMin: 5, turns: 10, projectDir: '/p' },
      { id: 'a', kind: 'subagent', parentId: 's1', role: 'test-automation-engineer', usage: { output: 300, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set(['claude-sonnet-4-6']) }, date: '2026-06-01', durationMin: 8, turns: 20, projectDir: '/p' },
    ],
  }];
  const meteredMap = new Map([['s1', 5.52], ['a', 25.44]]);
  const r = buildRollup(groups, { meteredMap });
  // orchestrator ran two models; sub-agent one — both exposed as arrays
  assert.deepEqual(r.byRole['test-automation-lead'].models.sort(), ['claude-opus-4-8', 'claude-sonnet-4-6']);
  assert.deepEqual(r.byRole['test-automation-engineer'].models, ['claude-sonnet-4-6']);
  // ledger entries are JSON-safe (array, survives round-trip; a Set would become {})
  const roundTripped = JSON.parse(JSON.stringify(r.ledger));
  assert.ok(Array.isArray(roundTripped[0].models));
  assert.ok(roundTripped[0].models.length >= 1);
});

test('buildRollup: ccusage unavailable -> null totals cost, structure still built', () => {
  const groups = [{ sessionId: 's1', projectDir: '/p', date: '2026-06-01',
    units: [{ id: 's1', kind: 'session', parentId: null, role: 'scout', usage: { output: 5, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 1, turns: 3, projectDir: '/p' }] }];
  const r = buildRollup(groups, { meteredMap: null, sessionMap: null });
  assert.equal(r.ccusageAvailable, false);
  assert.equal(r.costMethod, 'unavailable');
  assert.equal(r.totals.costUsd, null);
  assert.equal(r.totals.count, 1);
});

test('reconciliation: breakdowns tie to the total and account for every metered file', () => {
  const mk = (id, kind, parentId, role, out) => ({ id, kind, parentId, role, usage: { output: out, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 1, turns: 1, projectDir: '/p' });
  const groups = [{ sessionId: 's1', projectDir: '/p', date: '2026-06-01', units: [mk('s1', 'session', null, 'lead', 100), mk('a', 'subagent', 's1', 'impl', 300)] }];
  const r = buildRollup(groups, { meteredMap: new Map([['s1', 5.52], ['a', 25.44]]) }).reconciliation;
  assert.equal(r.internalOk, true);
  assert.ok(Math.abs(r.total - 30.96) < 1e-9);
  assert.ok(Math.abs(r.ledgerSum - 30.96) < 1e-9 && Math.abs(r.byRoleSum - 30.96) < 1e-9 && Math.abs(r.byDaySum - 30.96) < 1e-9 && Math.abs(r.byProjectSum - 30.96) < 1e-9);
  assert.ok(Math.abs(r.ccusageMeteredSum - 30.96) < 1e-9);
  assert.equal(r.orphanFiles, 0);
  assert.equal(r.externalOk, true);
});

test('reconciliation: a metered file with no ledger unit is flagged as an orphan (externalOk false)', () => {
  const groups = [{ sessionId: 's1', projectDir: '/p', date: '2026-06-01', units: [{ id: 's1', kind: 'session', parentId: null, role: 'lead', usage: { output: 100, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '2026-06-01', durationMin: 1, turns: 1, projectDir: '/p' }] }];
  const r = buildRollup(groups, { meteredMap: new Map([['s1', 5], ['ghost', 3]]) }).reconciliation; // 'ghost' metered but no unit
  assert.equal(r.orphanFiles, 1);
  assert.equal(r.externalOk, false);
});

test('unpriced models: buildRollup carries them and renderMarkdown warns of the undercount', () => {
  const groups = [{ sessionId: 's1', projectDir: '/p', date: '2026-06-01',
    units: [{ id: 's1', kind: 'session', parentId: null, role: 'x', usage: { output: 10, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set(['claude-sonnet-5']) }, date: '2026-06-01', durationMin: 1, turns: 1, projectDir: '/p' }] }];
  const r = buildRollup(groups, { meteredMap: new Map([['s1', 0]]), unpricedModels: ['claude-sonnet-5'] });
  assert.deepEqual(r.unpricedModels, ['claude-sonnet-5']);
  const md = renderMarkdown(r, {});
  assert.match(md, /UNDERCOUNTED/);
  assert.match(md, /claude-sonnet-5/);
  assert.match(md, /--online/);
});

test('parseUnit: duplicate tool_result errors for one tool_use_id count ONCE — toolSuccess never negative', () => {
  const records = [
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 't1', is_error: true },
      { type: 'tool_result', tool_use_id: 't1', is_error: true }, // retried/duplicated error block
      { type: 'tool_result', tool_use_id: 't1', is_error: true },
    ] } },
  ];
  const u = parseUnit(records);
  assert.equal(u.toolCalls, 1);
  assert.equal(u.toolErrors, 1, 'one error per tool_use_id, not three');
  assert.ok(u.toolCalls - u.toolErrors >= 0, 'toolSuccess never negative');
});

test('parseUnit: errors for a tool call replayed from an earlier unit are skipped too', () => {
  const seen = { msg: new Set(), tool: new Set(['t1']) }; // t1 counted under an earlier unit
  const u = parseUnit([
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } },
  ], seen);
  assert.equal(u.toolErrors, 0);
});

test('parseUnit: day bucketing uses the LOCAL calendar day (matches ccusage defaults)', () => {
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles'; // PDT = UTC-7 on this date
  try {
    // 03:00 UTC on June 1 is 20:00 on MAY 31 in Los Angeles.
    const u = parseUnit([{ type: 'assistant', timestamp: '2026-06-01T03:00:00.000Z', message: { id: 'm', usage: { output_tokens: 1 } } }]);
    assert.equal(u.date, '2026-05-31');
    const v = parseUnit([{ type: 'assistant', timestamp: '2026-06-01T12:00:00.000Z', message: { id: 'm2', usage: { output_tokens: 1 } } }]);
    assert.equal(v.date, '2026-06-01');
  } finally {
    if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
});

test('allocateCost: a group with only zero-token units falls back to an equal split', () => {
  const group = { sessionId: 's1', units: [
    { id: 'a', role: 'x', usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
    { id: 'b', role: 'y', usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
  ] };
  const priced = allocateCost(group, { sessionMap: new Map([['s1', { costUsd: 4 }]]) });
  assert.deepEqual(priced.map((u) => u.costUsd), [2, 2], 'zero total weight -> equal split');
  assert.ok(priced.every((u) => u.costSource === 'ccusage-allocated'));
});

test('buildRollup: units with no resolvable date land in an explicit "unknown" day bucket (byDay still reconciles)', () => {
  const groups = [{ sessionId: 's1', projectDir: '/p', date: '?',
    units: [{ id: 's1', kind: 'session', parentId: null, role: 'x', usage: { output: 10, input: 0, cacheRead: 0, cacheCreation: 0, models: new Set() }, date: '?', durationMin: 1, turns: 1, projectDir: '/p' }] }];
  const r = buildRollup(groups, { meteredMap: new Map([['s1', 5]]) });
  assert.ok('unknown' in r.byDay, 'timestamp-less unit bucketed as "unknown", not dropped');
  assert.equal(r.byDay.unknown.costUsd, 5);
  assert.equal(r.reconciliation.internalOk, true, 'byDaySum ties to the total — no false alarm');
});

test('parseArgs: valid flags land in the options bag (repeatables as arrays)', () => {
  const a = parseArgs(['--since', '2026-06-01', '--tag', 's1=lead', '--tag', 's2=impl', '--json', '--project-dir', '/p', '--ccusage-bin', 'ccusage']);
  assert.equal(a.error, undefined);
  assert.equal(a.since, '2026-06-01');
  assert.deepEqual(a.tag, ['s1=lead', 's2=impl']);
  assert.equal(a.json, true);
  assert.deepEqual(a.projectDir, ['/p']);
  assert.equal(a['ccusage-bin'], 'ccusage');
});

test('parseArgs: a value-taking flag with no value is a clear error, not a crash', () => {
  assert.match(parseArgs(['--tag']).error, /--tag requires a value/);
  assert.match(parseArgs(['--since', '--json']).error, /--since requires a value/);
});

test('parseArgs: unknown flags error instead of being silently swallowed', () => {
  assert.match(parseArgs(['--sinse', '2026-06-01']).error, /unknown flag --sinse/);
  assert.match(parseArgs(['stray']).error, /unexpected argument stray/);
});

test('parseArgs: --help / -h request help; HELP lists the flags', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['-h']), { help: true });
  assert.match(HELP, /--project-dir/);
  assert.match(HELP, /--exclude-session/);
});

test('collectSessionGroups (fs fixture): fork tiebreak is deterministic and a shared sub-agent is emitted once', () => {
  const root = mkdtempSync(join(tmpdir(), 'effaudit-test-'));
  try {
    const proj = join(root, '-p');
    mkdirSync(proj, { recursive: true });
    const T = '2026-06-01T10:00:00.000Z';
    const m1 = JSON.stringify({ type: 'assistant', timestamp: T, message: { id: 'm1', usage: { output_tokens: 50 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
    const m2 = JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:01:00.000Z', message: { id: 'm2', usage: { output_tokens: 7 }, content: [{ type: 'tool_use', id: 't2', name: 'Read' }] } });
    // SAME first timestamp; filename order alone would parse the fork first —
    // the fewer-records tiebreak must hand shared content to the original.
    writeFileSync(join(proj, 'zzzz-orig.jsonl'), `${m1}\n`);
    writeFileSync(join(proj, 'aaaa-fork.jsonl'), `${m1}\n${m2}\n`);
    // One sub-agent transcript, inherited under BOTH parents (fork copies subagents/).
    const sa = JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:30.000Z', message: { id: 'm3', usage: { output_tokens: 5 }, content: [] } });
    const saMeta = JSON.stringify({ agentType: 'impl', description: 'shared worker' });
    for (const parent of ['zzzz-orig', 'aaaa-fork']) {
      const dir = join(proj, parent, 'subagents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'agent-shared.jsonl'), `${sa}\n`);
      writeFileSync(join(dir, 'agent-shared.meta.json'), saMeta);
    }
    const groups = collectSessionGroups([proj]);
    const units = groups.flatMap((g) => g.units);
    assert.equal(units.length, 3, 'two sessions + ONE shared sub-agent (not one per parent)');
    assert.equal(units.filter((u) => u.id === 'agent-shared').length, 1);
    assert.equal(units.find((u) => u.id === 'agent-shared').role, 'impl');
    const orig = units.find((u) => u.id === 'zzzz-orig');
    const fork = units.find((u) => u.id === 'aaaa-fork');
    assert.equal(orig.usage.output, 50, 'original (fewer records) owns the shared replayed content');
    assert.equal(orig.toolCalls, 1);
    assert.equal(fork.usage.output, 7, 'fork contributes only its NEW work');
    assert.equal(fork.toolCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderDiff: reads the snapshot {rollup,resolved} shape and computes deltas', () => {
  const prior = { resolved: 2, rollup: { totals: { costUsd: 10, cacheHitRate: 0.5 } } };
  const current = { resolved: 4, totals: { costUsd: 8, cacheHitRate: 0.6 } };
  const text = renderDiff(current, { ...prior.rollup, resolved: prior.resolved });
  assert.match(text, /\$10\.00.*\$8\.00/s);
  assert.match(text, /\$5\.00.*\$2\.00/s); // $/resolved: 10/2 -> 8/4
});
