// scripts/lib/roster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedAgents, makeRoster, validRoster } from './roster.mjs';
test('factory map intersects installed roles on every supported layout', () => {
  for (const host of ['.claude', '.cursor', '.windsurf', '.github', '.codex']) {
    const repo = mkdtempSync(join(tmpdir(), 'dm-roster-'));
    const dir = join(repo, host, 'agents'); mkdirSync(dir, { recursive: true });
    for (const role of ['js-dev', 'test-automation-lead', 'qa-auditor']) {
      if (host === '.codex') writeFileSync(join(dir, `${role}.toml`), 'role');
      else if (host === '.github') writeFileSync(join(dir, `${role}.agent.md`), 'role');
      else { mkdirSync(join(dir, role)); writeFileSync(join(dir, role, 'AGENT.md'), 'role'); }
    }
    assert.equal(installedAgents(repo).length, 3);
    const s = makeRoster(repo, ['feature-development', 'test-automation']);
    assert.deepEqual(s.agents, ['js-dev', 'test-automation-lead']); assert.equal(validRoster(s), true);
    assert.equal(validRoster({ ...s, agents: [...s.agents, 'qa-auditor'] }), false);
    assert.equal(validRoster({ ...s, map_sha256: 'changed' }), false);
    assert.throws(() => makeRoster(repo, s.factories, ['qa-auditor']), /roster must equal/);
  }
});
