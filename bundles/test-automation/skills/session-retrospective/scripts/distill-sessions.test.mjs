import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeProjectPath,
  extractSignals,
  detectRetries,
  classifyCorrection,
  renderDigest,
  parseSession,
  resolveProjectDir,
  readSubagents,
  readWatermark,
  promptFingerprintOf,
  finalResultOf,
  summarizeSubagents,
  parseArgs,
} from './distill-sessions.mjs';

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const assistantTurn = { type: 'assistant', message: { role: 'assistant', content: [] } };

// Must stay identical to usage-rollup.mjs's copy: both skills have to land on
// the same project directory, or a retrospective and an audit of "the same
// project" quietly describe different ones.
test('encodeProjectPath maps every separator Claude Code maps', () => {
  assert.equal(encodeProjectPath('/Users/a/dev/x'), '-Users-a-dev-x');
  assert.equal(encodeProjectPath('/U/x.y.z'), '-U-x-y-z');
  assert.equal(encodeProjectPath('/Users/Ada_Lovelace/dev'), '-Users-Ada-Lovelace-dev');
  assert.equal(encodeProjectPath('/Users/a/AI baseline'), '-Users-a-AI-baseline');
  assert.equal(encodeProjectPath('C:\\Users\\a\\dev'), 'C--Users-a-dev');
});

test('extractSignals: tool errors (name-correlated), file churn, corrections', () => {
  const recs = [
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.js' } }] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', is_error: true }] } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'a.js' } }] } },
    { type: 'user', message: { role: 'user', content: 'no, that is wrong, revert it' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'a.js' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: 'a.js' } }] } },
  ];
  const s = extractSignals(recs);
  assert.equal(s.toolErrors['Edit: error'], 1);
  const churn = Object.fromEntries(s.fileChurn);
  assert.equal(churn['a.js'], 4);
  assert.equal(s.corrections.length, 1);
  assert.match(s.corrections[0].text, /no, that is wrong/);
});

// The previous detector was one regex anchored to `^`. Measured on a real
// 160-turn session it matched ONE turn. It failed SILENTLY: an empty
// corrections list reads as a clean session, not as a detector that missed.
test('classifyCorrection: unanchored — a correction mid-message still counts', () => {
  assert.equal(classifyCorrection('hm, why not fold it into hooks then?')?.kind, 'challenge');
  assert.equal(classifyCorrection('ok so about the other thing — actually, do it the other way')?.kind, 'redirect');
  // The old regex required the message to START with the trigger word.
  assert.ok(classifyCorrection('I read it through and that is not what I asked for'));
});

test('classifyCorrection: each tier is reachable and labelled', () => {
  assert.equal(classifyCorrection('revert that last change')?.kind, 'reversal');
  assert.equal(classifyCorrection('please don\'t touch the installer')?.kind, 'prohibition');
  assert.equal(classifyCorrection('no, that is not what I asked')?.kind, 'wrong');
  assert.equal(classifyCorrection('you forgot the migration step')?.kind, 'missed');
  assert.equal(classifyCorrection('wait, do it the other way')?.kind, 'redirect');
  assert.equal(classifyCorrection('are you sure about that?')?.kind, 'challenge');
  assert.equal(classifyCorrection('looks good, ship it'), null);
});

// The matcher must stay correct for whatever alternatives a team adds for its
// own language: JS `\b` is ASCII-only, so a non-Latin pattern written with it
// matches inside unrelated words and turns ordinary prose into corrections.
test('classifyCorrection: word boundaries are Unicode-aware, not ASCII \\b', () => {
  assert.equal(classifyCorrection('the undoing of that release was messy'), null, 'no match inside a longer word');
  assert.equal(classifyCorrection('we stopped short of the gate'), null);
  assert.equal(classifyCorrection('stop there')?.kind, 'prohibition', 'the standalone word still matches');
});

test('classifyCorrection: rejects text the human did not type', () => {
  assert.equal(classifyCorrection('<system-reminder>never commit secrets</system-reminder>'), null);
  assert.equal(classifyCorrection('<task-notification><task-id>w1</task-id></task-notification>'), null);
  assert.equal(classifyCorrection('This session is being continued from a previous conversation. no, that is wrong'), null);
  assert.equal(classifyCorrection('// never duplicates the index line'), null);
  assert.equal(classifyCorrection('function f() { /* do not call twice */ }'), null);
  // A correction is a reaction, and reactions are short. A long pasted brief
  // that happens to contain "never" is not one.
  assert.equal(classifyCorrection('never '.padEnd(600, 'x')), null);
});

test('classifyCorrection: scores leading and brief hits above buried ones', () => {
  const lead = classifyCorrection('revert that');
  const buried = classifyCorrection(
    'here is a long piece of background about the pipeline and the batch trunk and how it '
    + 'all fits together over several clauses, and only at the very end do I say revert that');
  assert.ok(lead.score > buried.score, `${lead.score} should beat ${buried.score}`);
});

test('extractSignals: corrections are ranked, capped, de-duplicated; interrupts counted', () => {
  const recs = [assistantTurn];
  // 14 weak hits, one strong one buried at the end, plus the same message
  // replayed twice (Claude Code rehydrates user turns after compaction).
  for (let i = 0; i < 14; i++) recs.push(user(`are you sure about step ${i}? here is some more context to make it long enough to lose the brevity bonus and rank low`));
  recs.push(user('no, that is completely wrong'));
  recs.push(user('no, that is completely wrong'));
  recs.push(user('[Request interrupted by user]'));
  recs.push(user('[Request interrupted by user for tool use]'));
  const s = extractSignals(recs);
  assert.equal(s.corrections.length, 12, 'capped at MAX_CORRECTIONS_PER_SESSION');
  assert.ok(s.correctionsFound > 12, 'reports how many were actually found');
  // Ranking, not first-N: the strong one arrived last and must survive the cap.
  assert.ok(s.corrections.some((c) => c.kind === 'wrong'), 'strongest hit survives the cap');
  assert.equal(s.corrections.filter((c) => c.kind === 'wrong').length, 1, 'replay counted once');
  assert.equal(s.interrupts.length, 2);
});

test('detectRetries flags a repeated tool+target', () => {
  const calls = [
    { turn: 1, tool: 'Bash', target: 'npm test' },
    { turn: 2, tool: 'Bash', target: 'npm test' },
  ];
  const r = detectRetries(calls);
  assert.equal(r.length, 1);
  assert.equal(r[0][0], 'Bash on npm test');
  assert.equal(r[0][1], 1);
});

test('detectRetries counts multiple repeats of the same tool+target', () => {
  const calls = [
    { turn: 1, tool: 'Bash', target: 'npm test' },
    { turn: 2, tool: 'Bash', target: 'npm test' },
    { turn: 3, tool: 'Bash', target: 'npm test' },
  ];
  const r = detectRetries(calls);
  assert.equal(r.length, 1);
  assert.equal(r[0][1], 2);
});

test('renderDigest is bounded markdown with session + sub-agent sections', () => {
  const sessions = [{
    id: 'abc', date: '2026-05-27', branch: 'main', durationMin: 12,
    userTurns: 3, assistantTurns: 5, skills: ['memory'],
    toolErrors: { 'Edit: error': 2 }, retries: [], fileChurn: [['a.js', 4]],
    corrections: [{ turn: 4, text: 'revert that' }],
    subagents: [{ agentType: 'python-dev', description: 'add endpoint', turns: 9, errors: 0, ended: 'ok' }],
  }];
  const md = renderDigest(sessions);
  assert.match(md, /## Session abc/);
  assert.match(md, /### Sub-agents/);
  assert.match(md, /python-dev/);
  assert.ok(md.length < 50_000, 'digest stays bounded');
});

test('resolveProjectDir returns null when projects root is missing', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'sr-')), 'nope');
  assert.equal(resolveProjectDir('/Users/a/dev/x', root), null);
});

test('parseSession + readSubagents on a written fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-'));
  const jsonl = join(dir, 'sess1.jsonl');
  const recs = [
    { type: 'assistant', timestamp: '2026-05-27T10:00:00Z', gitBranch: 'main', attributionSkill: 'memory',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', timestamp: '2026-05-27T10:05:00Z', message: { role: 'user', content: 'thanks' } },
  ];
  writeFileSync(jsonl, recs.map(r => JSON.stringify(r)).join('\n'));
  const s = parseSession(jsonl);
  assert.equal(s.id, 'sess1');
  assert.equal(s.branch, 'main');
  assert.deepEqual(s.skills, ['memory']);
  assert.equal(s.assistantTurns, 1);
  assert.equal(s.userTurns, 1);

  const sessDir = join(dir, 'sess1');
  mkdirSync(join(sessDir, 'subagents'), { recursive: true });
  writeFileSync(join(sessDir, 'subagents', 'agent-1.meta.json'),
    JSON.stringify({ agentType: 'python-dev', description: 'add endpoint' }));
  writeFileSync(join(sessDir, 'subagents', 'agent-1.jsonl'),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [] } }));
  const subs = readSubagents(sessDir);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].agentType, 'python-dev');
});

test('readWatermark: missing file, valid file, malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-'));
  // missing file → empty analyzed list
  assert.deepEqual(readWatermark(join(dir, 'none')), { analyzed: [] });
  // valid file → parsed object
  const ok = join(dir, 'wm.json');
  writeFileSync(ok, JSON.stringify({ lastRun: '2026-05-27T00:00:00Z', analyzed: ['a', 'b'] }));
  assert.deepEqual(readWatermark(ok).analyzed, ['a', 'b']);
  // malformed JSON → falls back to empty analyzed list
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.deepEqual(readWatermark(bad), { analyzed: [] });
});

test('--help prints usage instead of distilling every transcript on disk', async () => {
  const { HELP } = await import('./distill-sessions.mjs');
  assert.match(HELP, /usage: node distill-sessions\.mjs/);
  for (const flag of ['--project-dir', '--all', '--exclude-session', '--watermark', '--out', '--help']) {
    assert.ok(HELP.includes(flag), `HELP omits ${flag}`);
  }
  assert.match(HELP, /exit codes/);
});

// --- unattended runs: workflows and plain sub-agent dispatches ---------------
// The human-facing signals (corrections quoted from user text) are always empty
// when nobody is watching, and the sub-agent reader used to see only the top
// level. These cover the agent-side equivalents.

test('readSubagents recurses: workflow-nested agents are found, not just top level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'retro-nested-'));
  try {
    const flat = join(dir, 'subagents');
    const nested = join(flat, 'workflows', 'wf_abc123');
    mkdirSync(nested, { recursive: true });
    for (const [base, d] of [['agent-aaa', flat], ['agent-bbb', nested], ['agent-ccc', nested]]) {
      writeFileSync(join(d, `${base}.meta.json`), JSON.stringify({ agentType: 'qa-engineer' }));
      writeFileSync(join(d, `${base}.jsonl`),
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: `do ${base}` }] } }) + '\n');
    }
    const subs = readSubagents(dir);
    assert.equal(subs.length, 3, 'nested workflow agents must be found too');
    assert.ok(subs.every(s => s.agentType === 'qa-engineer'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('promptFingerprintOf takes the first user message; finalResultOf prefers StructuredOutput', () => {
  const recs = [
    { type: 'user', message: { content: [{ type: 'text', text: '  Analyst slot —   analyse TC-1  ' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'StructuredOutput', input: { status: 'blocked', notes: 'env missing' } },
    ] } },
  ];
  assert.equal(promptFingerprintOf(recs), 'Analyst slot — analyse TC-1');   // whitespace normalized
  assert.match(finalResultOf(recs), /"status":"blocked"/);                   // schema-forced result wins
  // No StructuredOutput → fall back to the last assistant text.
  assert.equal(finalResultOf(recs.slice(0, 2)), 'working on it');
  assert.equal(promptFingerprintOf([]), '');
});

const sub = (agentType, prompt, turns, errors, result) =>
  ({ agentType, description: '', turns, errors, ended: errors ? 'with errors' : 'ok', fingerprint: prompt, result });

test('summarizeSubagents: per-type rollup, exact-prompt repeats, outliers', () => {
  const subs = [
    sub('qa', 'review TC-1', 10, 0, 'APPROVED'),
    sub('qa', 'review TC-1', 10, 0, 'APPROVED'),          // identical prompt → a repeat
    sub('qa', 'review TC-2', 10, 1, 'CHANGES_REQUESTED'),
    sub('qa', 'review TC-3', 90, 0, 'APPROVED'),          // 9x the median → outlier
    sub('impl', 'build TC-1', 20, 0, 'ready'),
  ];
  const s = summarizeSubagents(subs);
  assert.equal(s.total, 5);
  const qa = s.types.find(t => t.type === 'qa');
  assert.equal(qa.count, 4);
  assert.equal(qa.withErrors, 1);
  assert.equal(s.repeats.length, 1);
  assert.equal(s.repeats[0].count, 2);
  assert.equal(s.repeats[0].agentType, 'qa');
  assert.ok(s.outliers.some(o => o.turns === 90), 'the 90-turn agent is an outlier');
  assert.ok(!s.outliers.some(o => o.turns === 10), 'median-ish agents are not');
});

// Per-case values (ids, branches, PR numbers) make raw returns almost unique —
// 594 distinct out of 761 on a real campaign. Blanking digit runs leaves shape.
test('summarizeSubagents: outcomes collapse to shapes; failure-shaped ones are pulled out', () => {
  const subs = [
    sub('impl', 'p1', 5, 0, '{"status":"ready","pr":1001}'),
    sub('impl', 'p2', 5, 0, '{"status":"ready","pr":1002}'),
    sub('impl', 'p3', 5, 0, '{"status":"ready","pr":1003}'),
    sub('impl', 'p4', 5, 0, "You've hit your session limit · resets 7:50am"),
    sub('impl', 'p5', 5, 0, '{"status":"blocked","notes":".env.test missing in worktree"}'),
  ];
  const s = summarizeSubagents(subs);
  const ready = s.outcomes.find(([txt]) => txt.includes('"status":"ready"'));
  assert.equal(ready[1], 3, 'three per-case returns collapse into one shape');
  const failureText = s.failures.map(([t]) => t).join(' | ');
  assert.match(failureText, /session limit/);
  assert.match(failureText, /blocked/);
  assert.ok(!failureText.includes('"status":"ready"'), 'clean returns are not failures');
});

test('renderDigest stays bounded with hundreds of sub-agents', () => {
  const many = Array.from({ length: 400 }, (_, i) =>
    sub(i % 2 ? 'qa' : 'impl', `work ${i % 7}`, 10 + (i % 5), i % 9 === 0 ? 1 : 0, `{"status":"ok","n":${i}}`));
  const md = renderDigest([{
    id: 's1', date: '2026-07-24', branch: 'main', durationMin: 60, skills: [],
    userTurns: 1, assistantTurns: 2, toolErrors: {}, retries: [], fileChurn: [], corrections: [],
    subagents: many,
  }]);
  assert.match(md, /### Sub-agents \(400\)/);
  assert.ok(md.split('\n').length < 120, `digest must not list every agent, got ${md.split('\n').length} lines`);
  assert.match(md, /Repeated identical dispatches/);
});

// A plausible-but-absent flag used to be swallowed: `--since 2026-07-31` was
// accepted and the run quietly digested every session on disk instead of the
// window asked for — a wrong answer shaped exactly like a right one. This
// reader selects by WATERMARK, and the error has to say so, because the user
// reaching for --since is asking a question the flag list alone doesn't answer.
test('an unknown flag is refused, and the error explains the watermark model', () => {
  assert.deepEqual(parseArgs(['--all', '--host', 'copilot']), { all: true, host: 'copilot' });
  let e;
  try { parseArgs(['--since', '2026-07-31']); } catch (err) { e = err; }
  assert.ok(e, '--since must be refused, not silently swallowed');
  assert.equal(e.code, 'UNKNOWN_FLAG');
  assert.match(e.message, /unknown flag --since/);
  assert.match(e.message, /WATERMARK/);
  assert.match(e.message, /--all/);
  // Every documented flag must parse — the guard must not outlaw real usage.
  for (const f of ['host', 'project-dir', 'all', 'exclude-session', 'watermark', 'out', 'help']) {
    assert.doesNotThrow(() => parseArgs([`--${f}`, 'v']), `--${f} should be accepted`);
  }
});
