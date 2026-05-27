import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeProjectPath, extractSignals, detectRetries,
  renderDigest, parseSession, resolveProjectDir, readSubagents,
} from './distill-sessions.mjs';

test('encodeProjectPath replaces slashes and dots with dashes', () => {
  assert.equal(encodeProjectPath('/Users/a/dev/x'), '-Users-a-dev-x');
  assert.equal(encodeProjectPath('/U/x.y.z'), '-U-x-y-z');
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

test('detectRetries flags a repeated tool+target', () => {
  const calls = [
    { turn: 1, tool: 'Bash', target: 'npm test' },
    { turn: 2, tool: 'Bash', target: 'npm test' },
  ];
  const r = detectRetries(calls);
  assert.equal(r.length, 1);
  assert.equal(r[0][0], 'Bash on npm test');
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
