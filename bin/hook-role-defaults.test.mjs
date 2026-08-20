// The generated config-defaults.sh is the roster deciding which roles the
// shared hooks serve. These pin the three generator pieces: name discovery
// across every installed format, default-list extraction from lib.sh (single
// source of truth), and the emitted file's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listInstalledAgentNames, hookDefaultLists, buildRoleDefaultsFile, agentContextConfig, diffRoleDefaults } from './init.mjs';

test('listInstalledAgentNames: every installed format, sorted, dotfiles skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-'));
  try {
    mkdirSync(join(dir, 'qa-engineer'));                       // Claude/Cursor dir form
    writeFileSync(join(dir, 'scout.agent.md'), '');            // Copilot flat form
    writeFileSync(join(dir, 'test-automation-lead.toml'), ''); // Codex form
    writeFileSync(join(dir, 'ba.md'), '');                     // loose md
    writeFileSync(join(dir, '.DS_Store'), '');
    assert.deepEqual(listInstalledAgentNames(dir), ['ba', 'qa-engineer', 'scout', 'test-automation-lead']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listInstalledAgentNames: missing dir → empty roster, never a throw', () => {
  assert.deepEqual(listInstalledAgentNames('/nope/agents'), []);
});

test('hookDefaultLists parses the real lib.sh, not a stale copy', () => {
  const lib = readFileSync(fileURLToPath(new URL('../hooks/lib.sh', import.meta.url)), 'utf8');
  const lists = hookDefaultLists(lib);
  assert.match(lists.sharedDocs, /testing/);
  assert.match(lists.sharedDocs, /role-overrides/);
  assert.match(lists.memoryFiles, /MEMORY\.md/);
  assert.match(lists.memoryFiles, /RULES\.md/);
});

test('buildRoleDefaultsFile: one pair per role, user-overridable form, global pass-through', () => {
  const out = buildRoleDefaultsFile(['qa-engineer', 'scout'], { sharedDocs: 'a b', memoryFiles: 'M.md' });
  assert.match(out, /^: "\$\{SDLC_SHARED_DOCS_QA_ENGINEER:=\$\{SDLC_SHARED_DOCS:-a b\}\}"$/m);
  assert.match(out, /^: "\$\{SDLC_ROLE_MEMORY_FILES_QA_ENGINEER:=\$\{SDLC_ROLE_MEMORY_FILES:-M\.md\}\}"$/m);
  assert.match(out, /SDLC_SHARED_DOCS_SCOUT/);
  assert.match(out, /GENERATED, do not edit/);
  // the `:=` form is what lets config.sh (sourced first) always win
  assert.doesNotMatch(out, /^SDLC_SHARED_DOCS_QA_ENGINEER=/m);
});

// context-docs / context-memory: the agent's own frontmatter declares what it
// needs injected; declared values are emitted VERBATIM (no global passthrough
// — the author excluded those docs on purpose), `none` → `__none__`.
test('agentContextConfig: frontmatter keys, quotes stripped, none → sentinel, body ignored', () => {
  const md = '---\nname: test-runner\ncontext-docs: manual-qa/app_profile\ncontext-memory: "snapshot.md"\n---\n\ncontext-docs: not-this-one\n';
  assert.deepEqual(agentContextConfig(md), { docs: 'manual-qa/app_profile', memory: 'snapshot.md' });
  assert.deepEqual(agentContextConfig('---\ncontext-docs: none\n---\n'), { docs: '__none__', memory: null });
  assert.deepEqual(agentContextConfig('---\nname: x\n---\n'), { docs: null, memory: null });
});

test('agentContextConfig: toml mode reads the re-emitted comment lines', () => {
  const toml = 'name = "test-runner"\n# context-docs: manual-qa/app_profile\ndeveloper_instructions = """x"""\n';
  assert.deepEqual(agentContextConfig(toml, { toml: true }), { docs: 'manual-qa/app_profile', memory: null });
});

test('buildRoleDefaultsFile: a declared list is verbatim, an undeclared one passes the global through', () => {
  const out = buildRoleDefaultsFile(
    [{ name: 'test-runner', docs: 'manual-qa/app_profile' }, { name: 'scout' }],
    { sharedDocs: 'a b', memoryFiles: 'M.md' },
  );
  assert.match(out, /^: "\$\{SDLC_SHARED_DOCS_TEST_RUNNER:=manual-qa\/app_profile\}"$/m);
  assert.match(out, /^: "\$\{SDLC_SHARED_DOCS_SCOUT:=\$\{SDLC_SHARED_DOCS:-a b\}\}"$/m);
  // memory undeclared for both → passthrough form for both
  assert.match(out, /^: "\$\{SDLC_ROLE_MEMORY_FILES_TEST_RUNNER:=\$\{SDLC_ROLE_MEMORY_FILES:-M\.md\}\}"$/m);
});

test('diffRoleDefaults: reports only genuinely moved defaults, not new or removed roles', () => {
  const oldC = ': "${SDLC_SHARED_DOCS_TEST_RUNNER:=a b}"\n: "${SDLC_ROLE_MEMORY_FILES_TEST_RUNNER:=M.md}"\n: "${SDLC_SHARED_DOCS_GONE:=x}"\n';
  const newC = ': "${SDLC_SHARED_DOCS_TEST_RUNNER:=manual-qa/app_profile.md}"\n: "${SDLC_ROLE_MEMORY_FILES_TEST_RUNNER:=M.md}"\n: "${SDLC_SHARED_DOCS_FRESH:=y}"\n';
  assert.deepEqual(diffRoleDefaults(oldC, newC), ['test-runner (docs)']);
  assert.deepEqual(diffRoleDefaults(newC, newC), [], 'no-op regeneration is silent');
});
