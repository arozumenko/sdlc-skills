import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSafeFs } from '../fsx.mjs';
import { rolesCheck } from './roles.mjs';

test('roles: facts only, never a warning for a missing memory dir', () => {
  const d = mkdtempSync(join(tmpdir(), 'drl-'));
  try {
    for (const r of ['ba', 'scout']) mkdirSync(join(d, '.claude/agents', r), { recursive: true });
    mkdirSync(join(d, '.agents/memory/ba'), { recursive: true });
    const ctx = { projectDir: d, fs: createSafeFs(d), facts: {}, detected: [{ target: 'claude', evidence: true, examined: true }] };
    assert.deepEqual(rolesCheck.run(ctx), []);
    assert.equal(ctx.facts.roles, 'ba, scout');
    assert.equal(ctx.facts.memory, '2 roles, 1 with a memory directory');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
