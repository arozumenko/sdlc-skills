import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs } from './trial.mjs';

test('subagent evals request detailed role events for context and tool measurements', () => {
  const args = claudeArgs({ role: 'qa-engineer' }, 'Inspect the evidence.', {});
  assert.ok(args.includes('--forward-subagent-text'), 'without forwarding, Claude 2.1.310 omits role assistant events');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
});
