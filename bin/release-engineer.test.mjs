import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildItemIndex, resolveItem } from './lib/item-resolver.mjs';
import { parseAgentSkillSplit, parseSkillsFromFrontmatter } from './init.mjs';
import { buildBriefingPlan } from './lib/factory-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const factoryRoot = join(root, 'bundles/feature-development');
const workflows = ['release-planning', 'pre-production-checks', 'progressive-delivery', 'release-recovery', 'infrastructure-monitoring'];

const normalize = text => text.replace(/\s+/g, ' ');
function assertClosure(text) {
  assert.match(text, /Closed with accepted risk requires a named human's explicit waiver of the remaining observation/);
  assert.match(text, /Never report it as verified healthy/);
  assert.match(text, /record must list the evidence gaps and the follow-up owner/);
}
function assertPersistence(text) {
  assert.match(text, /carry it in chat marked "persistence pending", keep it visibly unfinished/);
  assert.match(text, /write it to the repo at the first opportunity/);
  assert.match(text, /release cannot be closed while the record is still pending persistence/);
}
function assertCheckpoints(text) {
  assert.match(text, /append-only checkpoints on a dedicated release-record branch, committed and pushed/);
  assert.match(text, /recording approvals, run\/lock state and the next observation owner/);
  assert.match(text, /Handoffs cite the branch and exact commit so a resumed session can continue before merge/);
  assert.match(text, /Tech Lead reviews and PM merges through the normal gate/);
  assert.match(text, /An unmerged checkpoint never counts as completion/);
}
function assertDestructiveConfirmation(text) {
  assert.match(text, /destructive action always needs a specific human confirmation for the current situation, even when a runbook preauthorizes it/);
}
function assertIncidentApproval(text) {
  assert.match(text, /Incident remediation outside authorized runbooks escalates/);
  assert.match(text, /Explicit chat approval scoped to the specific action, recorded with a named approver under the release-planning record contract, authorizes it/);
}

test('the spec and record template capture the five owner rulings', () => {
  const spec = normalize(readFileSync(join(root, 'docs/superpowers/specs/2026-11-06-dora-release-engineer-design.md'), 'utf8'));
  assert.match(spec, /Owner ruled on .* on 2026-11-07/);
  for (const check of [assertClosure, assertPersistence, assertCheckpoints, assertDestructiveConfirmation, assertIncidentApproval]) check(spec);
  const record = normalize(readFileSync(join(factoryRoot, 'skills/release-planning/templates/release-record.md'), 'utf8'));
  assertCheckpoints(record);
  assert.match(record, /Specific named human confirmation for each destructive action in the current situation, even when a runbook preauthorizes it/);
  assert.match(record, /Persistence pending .*blocks closure/);
  assert.match(record, /named human's explicit waiver of remaining observation for accepted-risk closure; evidence gaps and follow-up owner/);
});

// Check workflow bodies, including installed copies, independently of agent routing.
function assertReleaseContracts(readSkill) {
  const text = Object.fromEntries(workflows.map(id => [id, readSkill(id).replace(/\s+/g, ' ')]));
  const planning = text['release-planning'];
  for (const id of ['release-planning', 'progressive-delivery']) {
    assertClosure(text[id]);
    assertPersistence(text[id]);
    assertCheckpoints(text[id]);
  }
  assertDestructiveConfirmation(planning);
  assertDestructiveConfirmation(text['release-recovery']);
  assertDestructiveConfirmation(text['infrastructure-monitoring']);
  assert.match(text['release-recovery'], /preauthorized non-destructive runbook without repeated approval/);
  assertIncidentApproval(text['infrastructure-monitoring']);
  for (const contract of [
    /Where authority is absent, finish preparation and ask for the specific production action/,
    /missing, stale, failed or inconclusive required gate holds promotion by default/,
    /Explicit written human approval in chat can waive that gate/,
    /Proceed without asking again while approval covers the action/,
    /re-open only for materially different risks or changed scope/,
    /Keep gate status \*\*waived\*\*, never passed/,
    /Distinguish gate waiver from deployment\/remediation authority/,
    /Approval cannot bypass credentials, enforced access controls or technical impossibility/,
    /Record the named approving human/,
    /ask for the approver's name in chat and record it as self-declared/,
  ]) assert.match(planning, contract);
  for (const id of workflows.filter(id => id !== 'release-planning')) {
    assert.match(text[id], /load `release-planning` for its authority, chat-waiver and record contract/, `${id} must surface the shared prerequisite`);
    assert.match(text[id], /[Ss]tandalone/, `${id} must explain standalone installation`);
  }
  assert.match(text['pre-production-checks'], /missing prerequisite rather than inventing a conflicting approval policy/);
  assert.match(text['pre-production-checks'], /hold promotion unless explicitly waived under release-planning/);
  assert.match(text['progressive-delivery'], /Missing\/stale telemetry holds advancement as inconclusive unless explicitly waived/);
  assert.match(text['progressive-delivery'], /lacking recovery authority, hold and present the specific action for approval/);
  assert.match(text['progressive-delivery'], /gate waiver alone does not establish exclusive ownership/);
  assert.match(text['release-recovery'], /Helm rollback or redeploying an older container does not restore data or undo external effects/);
  assert.match(text['infrastructure-monitoring'], /Investigate read-only by default/);
  assert.match(text['infrastructure-monitoring'], /stale, absent or insufficient samples are unknown/);
}

test('release skill bodies preserve authority, hold, waiver and standalone prerequisite contracts', () => {
  assertReleaseContracts(id => readFileSync(join(factoryRoot, 'skills', id, 'SKILL.md'), 'utf8'));
});

test('shared core briefings survive role selection without duplication or overriding platform guidance', () => {
  const factory = {
    coreAgents: ['release-engineer'],
    briefings: { 'release-engineer': 'briefings/release-engineer.md' },
    devRoles: { web: { platform: 'web' }, ios: { platform: 'ios' } },
    platforms: { web: { label: 'Web' }, ios: { label: 'iOS' } },
  };
  for (const selected of [[], ['web'], ['ios'], ['web', 'ios']]) {
    assert.deepEqual(buildBriefingPlan(factory, selected)['release-engineer'], [
      { label: 'release-engineer', path: 'briefings/release-engineer.md' },
    ]);
  }
  factory.platforms.web.briefings = { 'release-engineer': 'briefings/web/release-engineer.md' };
  assert.deepEqual(buildBriefingPlan(factory, ['web'])['release-engineer'], [
    { label: 'Web', path: 'briefings/web/release-engineer.md' },
  ]);
});

test('Dora is a core factory role with a resolvable briefing and standalone identity', () => {
  const factory = JSON.parse(readFileSync(join(factoryRoot, 'factory.json'), 'utf8'));
  assert.ok(factory.coreAgents.includes('release-engineer'));
  assert.ok(factory.localAgents.includes('release-engineer'));
  assert.ok(existsSync(join(factoryRoot, factory.briefings['release-engineer'])));
  assert.equal(resolveItem(buildItemIndex(root), 'agents', 'release-engineer').factory, 'feature-development');
});

test('Dora installs all workflows on demand and every declared dependency resolves', () => {
  const text = readFileSync(join(factoryRoot, 'agents/release-engineer/AGENT.md'), 'utf8');
  const { preload, onDemand } = parseAgentSkillSplit(text);
  const factory = JSON.parse(readFileSync(join(factoryRoot, 'factory.json'), 'utf8'));
  const index = buildItemIndex(root);
  const registry = JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8'));
  for (const id of workflows) {
    assert.ok(onDemand.includes(id), `${id} must install without preloading`);
    assert.ok(!preload.includes(id));
    assert.ok(factory.localSkills.includes(id));
    assert.equal(resolveItem(index, 'skills', id).factory, 'feature-development');
  }
  for (const id of parseSkillsFromFrontmatter(text)) {
    assert.ok(resolveItem(index, 'skills', id) || registry.skills.some(s => s.id === id), `unresolved ${id}`);
  }
});

test('standalone Dora installs native agent formats, persona and workflow assets without external dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dora-install-'));
  try {
    const result = spawnSync(process.execPath, [join(root, 'bin/init.mjs'), 'init',
      '--agents', 'release-engineer', '--target', 'claude,cursor,windsurf,copilot,codex', '--yes'],
    { cwd: dir, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    const agents = [
      '.claude/agents/release-engineer/AGENT.md',
      '.cursor/agents/release-engineer/AGENT.md',
      '.windsurf/agents/release-engineer/AGENT.md',
      '.github/agents/release-engineer.agent.md',
      '.codex/agents/release-engineer.toml',
    ];
    for (const path of agents) {
      const installed = readFileSync(join(dir, path), 'utf8');
      assert.match(installed, /Dora/);
      for (const id of workflows) assert.ok(installed.includes(id), `${path} lost ${id} routing`);
    }
    for (const host of ['.claude', '.cursor', '.windsurf', '.github', '.codex']) {
      assertReleaseContracts(id => readFileSync(join(dir, host, 'skills', id, 'SKILL.md'), 'utf8'));
      assert.ok(existsSync(join(dir, host, 'skills/release-planning/templates/release-record.md')));
      assert.ok(existsSync(join(dir, host, 'skills/release-planning/references/platforms.md')));
    }
    assert.match(readFileSync(join(dir, '.codex/agents/release-engineer.toml'), 'utf8'), /## Persona/);
    assert.match(readFileSync(join(dir, '.agents/memory/release-engineer/SOUL.md'), 'utf8'), /Dora/);
    assert.match(readFileSync(join(dir, '.github/agents/release-engineer.agent.md'), 'utf8'), /\.agents\/memory\/release-engineer\/SOUL\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
