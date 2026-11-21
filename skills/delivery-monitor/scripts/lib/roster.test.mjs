// scripts/lib/roster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FACTORIES, installedAgents, makeRoster, unmappedFactories, validRoster } from './roster.mjs';
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

// product-management and security-testing ship no role map in this skill. Their plans register; the roster holds no role of theirs.
test('a factory with no role map gives a valid roster with none of its roles; an unknown factory id is still refused', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dm-unmapped-roster-'));
  try {
    for (const role of ['security-lead', 'threat-modeler', 'js-dev']) { const dir = join(repo, '.claude/agents', role); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'AGENT.md'), 'role'); }
    assert.deepEqual(FACTORIES, ['feature-development', 'test-automation', 'manual-qa', 'product-management', 'security-testing']);
    const alone = makeRoster(repo, ['security-testing']);
    assert.deepEqual([alone.factories, alone.agents], [['security-testing'], []]);
    assert.equal(validRoster(alone), true); assert.deepEqual(unmappedFactories(alone), ['security-testing']);
    assert.equal(validRoster({ ...alone, agents: ['security-lead'] }), false, 'a role the map does not hold is never valid');
    const mixed = makeRoster(repo, ['security-testing', 'feature-development']);
    assert.deepEqual([mixed.factories, mixed.agents], [['feature-development', 'security-testing'], ['js-dev']]);
    assert.equal(validRoster(mixed), true); assert.deepEqual(unmappedFactories(mixed), ['security-testing']);
    assert.deepEqual(unmappedFactories(makeRoster(repo, ['feature-development'])), []);
    assert.throws(() => makeRoster(repo, ['ops']), /unknown participating factory/);
    assert.equal(validRoster({ ...alone, factories: ['ops'] }), false);
    assert.throws(() => makeRoster(repo, ['security-testing'], ['security-lead']), /roster must equal/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('the role map file is unchanged: its hash is the one saved rosters carry', () => {
  // Changing references/factory-roles.json changes map_sha256 and invalidates every saved roster in a project that updates.
  const repo = mkdtempSync(join(tmpdir(), 'dm-roster-hash-'));
  try { assert.equal(makeRoster(repo, ['feature-development']).map_sha256, 'ef508bef34abdf6cc9b08fe1c61f8249367f0408f63a30e1b4803aa285577b9c'); } finally { rmSync(repo, { recursive: true, force: true }); }
});
