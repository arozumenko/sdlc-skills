// Tests for scope-hook.mjs — announce / mark-dispatch / gate decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceLine, markDispatch, gateDecision, sweepMarkers, scopesDir } from './scope-hook.mjs';
import { openScope, closeScope } from '../scripts/work-scope.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'scope-hook-'));
const SCRIPT = fileURLToPath(new URL('./scope-hook.mjs', import.meta.url));
const runHook = (args, payload, env = {}) => execFileSync('node', [SCRIPT, ...args], {
  input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env },
});

test('announceLine: no scope → the ask, carrying the session id and the script path', () => {
  const repo = tmp();
  const line = announceLine(repo, 'sess-1');
  assert.match(line, /session sess-1/);
  assert.match(line, /work-scope\.mjs open --session sess-1/);
  // The label vocabulary is SUGGESTED, not enforced — sessions that all
  // collapse into "other" say nothing about where the money went.
  assert.match(line, /investigation/, 'more than one non-automation label is offered');
  assert.match(line, /other/);
  assert.match(line, /only this intent feeds cost-per-case/, 'says which label the $/case figures use');
  assert.equal(announceLine(repo, ''), null, 'no session id → inject nothing');
});

test('announceLine: existing scope → digest, so resume//clear keeps the batch in context', () => {
  const repo = tmp();
  openScope(repo, { session: 'sess-2', batch: 'b1', cases: ['TC-1', 'TC-2'] });
  const line = announceLine(repo, 'sess-2');
  assert.match(line, /automation \/ batch b1/);
  assert.match(line, /2 case\(s\)/);
});

test('gateDecision: blocks exactly once — and only when work was dispatched with no scope', () => {
  const repo = tmp();
  // no dispatch marker → silent
  assert.equal(gateDecision(repo, { session_id: 's1' }), null);
  markDispatch(repo, 's1');
  // dispatched, undeclared → block, once
  const out = gateDecision(repo, { session_id: 's1' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /open --session s1/);
  assert.equal(gateDecision(repo, { session_id: 's1' }), null, 'nagged marker prevents a second block');
});

// A lead reliably does the git half of closing and then writes its own summary
// in chat — measured on a real batch: scope declared, outcomes recorded,
// merged, cleaned up… and no report, because nothing asked. Declaring got done
// precisely because the gate asked. This is host- and mode-independent: it only
// reads files, so it holds for a Workflow run or a sequential dispatch loop.
test('gateDecision: asks ONCE to close when the batch has a receipt and the scope is open', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const repo = tmp();
  openScope(repo, { session: 's-open', batch: 'b7', cases: ['TC-1'] });
  // no receipt yet → the batch is still running, say nothing
  assert.equal(gateDecision(repo, { session_id: 's-open' }), null);
  const dir = join(repo, '.agents', 'automation', 'b7');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b7', cases: [{ id: 'TC-1', outcome: 'automated' }] }));

  const out = gateDecision(repo, { session_id: 's-open' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /close --session s-open/);
  assert.match(out.reason, /batch-report\.md/);
  assert.equal(gateDecision(repo, { session_id: 's-open' }), null, 'asked once, never again');

  // a nested campaign wave's receipt is found too
  const repo2 = tmp();
  openScope(repo2, { session: 's-w', batch: 'wave-01', cases: [] });
  const wdir = join(repo2, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, 'report.json'), '{}');
  assert.equal(gateDecision(repo2, { session_id: 's-w' })?.decision, 'block');
});

test('gateDecision: a CLOSED scope is never nagged', () => {
  const repo = tmp();
  openScope(repo, { session: 's-done', batch: 'b8', cases: [] });
  closeScope(repo, { session: 's-done' });
  const dir = join(repo, '.agents', 'automation', 'b8');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), '{}');
  assert.equal(gateDecision(repo, { session_id: 's-done' }), null);
});

test('gateDecision: declared scope or an active stop chain never blocks', () => {
  const repo = tmp();
  markDispatch(repo, 's2');
  openScope(repo, { session: 's2', intent: 'other' });
  assert.equal(gateDecision(repo, { session_id: 's2' }), null, 'intent:other satisfies the contract');
  markDispatch(repo, 's3');
  assert.equal(gateDecision(repo, { session_id: 's3', stop_hook_active: true }), null, 'never block a continuation');
  assert.equal(gateDecision(repo, {}), null, 'payload without a session id → do nothing');
});

// Copilot: camelCase payload (sessionId, cwd) and hook stdout parsed as JSON —
// announce wraps its line in {additionalContext}; the gate emits the identical
// decision/reason shape both hosts accept.
test('CLI: Copilot encoding — payload cwd + sessionId honored, --json wraps announce', () => {
  const repo = tmp();
  const out = runHook(['--announce', '--json'], { sessionId: 'cp-1', cwd: repo });
  const parsed = JSON.parse(out);
  assert.match(parsed.additionalContext, /session cp-1/);
  assert.match(parsed.additionalContext, /open --session cp-1/);
  // Claude encoding: raw text, session_id snake_case, repo from env
  const claude = runHook(['--announce'], { session_id: 'cl-1' }, { CLAUDE_PROJECT_DIR: repo });
  assert.match(claude, /^tokenomics \[session cl-1\]/);
  // gate end-to-end over the same dir: dispatch marker via CLI, then block JSON
  runHook(['--mark-dispatch'], { sessionId: 'cp-1', cwd: repo });
  const gate = JSON.parse(runHook(['--gate'], { sessionId: 'cp-1', cwd: repo }));
  assert.equal(gate.decision, 'block');
  assert.equal(runHook(['--gate'], { sessionId: 'cp-1', cwd: repo }), '', 'second stop: silent');
});

test('sweepMarkers: stale pending/nagged markers removed, fresh ones and scopes kept', () => {
  const repo = tmp();
  const dir = scopesDir(repo);
  mkdirSync(dir, { recursive: true });
  markDispatch(repo, 'old');
  const old = new Date(Date.now() - 10 * 86_400_000);
  utimesSync(join(dir, '.pending-old'), old, old);
  markDispatch(repo, 'fresh');
  writeFileSync(join(dir, 'kept.json'), '{}');
  assert.equal(sweepMarkers(repo), 1);
  assert.ok(!existsSync(join(dir, '.pending-old')));
  assert.ok(existsSync(join(dir, '.pending-fresh')));
  assert.ok(existsSync(join(dir, 'kept.json')));
});
