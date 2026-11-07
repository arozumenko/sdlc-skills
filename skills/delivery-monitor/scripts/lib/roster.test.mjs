// scripts/lib/roster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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

// Source-repo only: factory manifests do not ship with installed skill copies.
const inSourceRepo = existsSync(new URL('../../../../skills.json', import.meta.url))
  && existsSync(new URL('../../../../bin/init.mjs', import.meta.url));
test('feature-development monitor roles match the factory localAgents exactly', {
  skip: !inSourceRepo && 'not in the sdlc-skills source repo',
}, () => {
  const map = JSON.parse(readFileSync(new URL('../../references/factory-roles.json', import.meta.url), 'utf8'));
  const factory = JSON.parse(readFileSync(new URL('../../../../bundles/feature-development/factory.json', import.meta.url), 'utf8'));
  assert.deepEqual(map.factories['feature-development'], [...factory.localAgents].sort());
});

test('release-engineer is retained in default and requested rosters', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dm-release-roster-'));
  try {
    const dir = join(repo, '.claude/agents/release-engineer');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AGENT.md'), 'role');
    const roster = makeRoster(repo, ['feature-development']);
    assert.deepEqual(roster.agents, ['release-engineer']);
    const requested = makeRoster(repo, ['feature-development'], ['release-engineer']);
    assert.deepEqual(requested, roster);
    assert.equal(validRoster(requested), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
