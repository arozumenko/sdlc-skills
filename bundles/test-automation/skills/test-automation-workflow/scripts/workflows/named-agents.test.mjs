import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// EVERY dispatch in a shipped workflow must name its agentType.
//
// `SubagentStart` fires for workflow-spawned agents and delivers the agent type,
// which is how a worker gets its role memory and project briefing — but ONLY for
// a named dispatch. An `agent()` call without `agentType:` arrives as
// `workflow-subagent`, resolves to no role, and runs blind to the project.
//
// Measured on one real campaign: 1004 of 2123 units arrived anonymous. They were
// board clerks (since deleted), but the same silence would hide a real worker —
// nothing errors, the agent just knows nothing. Hence a test, not a convention.
const DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = readdirSync(DIR).filter((f) => f.endsWith('.workflow.mjs'));

/** agent(...) calls with comments stripped — `agent(` appears in prose too. */
function agentCalls(src) {
  const s = src.replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  for (const m of s.matchAll(/\bagent\(/g)) {
    let depth = 0, j = m.index + 'agent('.length - 1;
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) break;
    }
    out.push(s.slice(m.index, j + 1));
  }
  return out;
}

test('every shipped workflow script exists and dispatches something', () => {
  assert.ok(SCRIPTS.length >= 4, `expected the shipped workflows, found ${SCRIPTS.join(', ')}`);
});

for (const file of SCRIPTS) {
  test(`${file}: no anonymous dispatch`, () => {
    const calls = agentCalls(readFileSync(join(DIR, file), 'utf8'));
    assert.ok(calls.length > 0, 'a workflow with no agent() call is not a workflow');
    const anon = calls
      .filter((c) => !/agentType:/.test(c))
      .map((c) => (c.match(/label:\s*[`'"]([^`'"]*)/) || [, '(unlabelled)'])[1]);
    assert.deepEqual(anon, [], `anonymous dispatch(es) in ${file}: ${anon.join(', ')} — ` +
      'add agentType so SubagentStart can resolve the role and inject its memory');
  });
}
