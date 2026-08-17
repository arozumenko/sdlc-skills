import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./agent-start', import.meta.url));

// Build a throwaway project with a role-memory dir and shared docs.
function project({ role = 'qa-engineer', memory = {}, shared = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
  const mem = join(dir, '.agents', 'memory', role);
  mkdirSync(mem, { recursive: true });
  for (const [name, body] of Object.entries(memory)) writeFileSync(join(mem, name), body);
  for (const [name, body] of Object.entries(shared)) writeFileSync(join(dir, '.agents', `${name}.md`), body);
  return dir;
}

// Run agent-start the way a host does: payload on stdin, project dir in env.
function run(dir, role, env = {}) {
  const res = execFileSync('bash', [HOOK], {
    input: JSON.stringify({ agent_type: role }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return res;
}
// The hook exits 0 even when it warns, so execFileSync never throws and its
// stderr would be lost — spawnSync returns both streams unconditionally.
function runCapturingStderr(dir, role, env = {}) {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ agent_type: role }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
  return { out: r.stdout ?? '', err: r.stderr ?? '', status: r.status };
}

const line = (i) => `- [Entry ${i}](entry_${i}.md) — a short hook for entry ${i}\n`;
const index = (n) => `# Memory index — qa-engineer\n\n${Array.from({ length: n }, (_, i) => line(i)).join('')}`;

test('small memory is inlined verbatim', () => {
  const dir = project({ memory: { 'MEMORY.md': index(5) } });
  try {
    const out = run(dir, 'qa-engineer');
    assert.match(out, /additionalContext/);
    assert.match(out, /Entry 0/);
    assert.match(out, /Entry 4/);
    assert.doesNotMatch(out, /REQUIRED READING/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The regression this whole change exists for: on Claude Code an oversized
// payload used to be emitted uncapped, and the host silently replaced it with a
// ~2KB preview (302 of 302 dispatches in one campaign).
test('an oversized index is capped on Claude Code, not emitted whole', () => {
  const dir = project({ memory: { 'MEMORY.md': index(4000) } }); // ~200KB
  try {
    const out = run(dir, 'qa-engineer', { SDLC_CTX_CAP: '8192' });
    assert.ok(out.length < 40000, `payload should be capped, got ${out.length} bytes`);
    // and the agent is told what it did not get
    assert.match(out, /REQUIRED READING/);
    assert.match(out, /\.agents\/memory\/qa-engineer\/MEMORY\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Whole-file spill would leave the agent with no map at all. MEMORY.md is
// line-oriented, so a head-slice is N complete hooks rather than a severed page.
test('an over-budget index still delivers its first entries plus a pointer', () => {
  const dir = project({ memory: { 'MEMORY.md': index(4000) } });
  try {
    const out = run(dir, 'qa-engineer', { SDLC_CTX_CAP: '8192' });
    assert.match(out, /FIRST \d+ ENTRIES/);
    assert.match(out, /Entry 0/);            // usable content survived
    assert.doesNotMatch(out, /Entry 3999/);  // but not all of it
    assert.match(out, /REQUIRED READING/);          // and the rest is named
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Copilot keeps its own 10KB default — unchanged by the Claude-side raise', () => {
  const dir = project({ memory: { 'MEMORY.md': index(4000) } });
  try {
    const out = run(dir, 'qa-engineer', { COPILOT_CLI: '1' });
    assert.ok(out.length < 20000, `copilot payload should stay ~10KB, got ${out.length}`);
    assert.match(out, /REQUIRED READING/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an oversized payload warns on stderr without corrupting stdout JSON', () => {
  const dir = project({ memory: { 'MEMORY.md': index(4000) } });
  try {
    // Force the cap wide open to simulate a bypass / a host we misjudged.
    const { out, err } = runCapturingStderr(dir, 'qa-engineer', {
      SDLC_CTX_CAP: '999999', SDLC_EMIT_WARN_BYTES: '4096',
    });
    assert.match(err, /WARNING/);
    assert.match(err, /partial memory/);
    JSON.parse(out); // stdout must remain valid JSON for the host
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no memory dir for the role → no output, exit 0 (unseeded project)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-hook-empty-'));
  try {
    assert.equal(run(dir, 'nobody').trim(), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- session-start: the visible half of the loop -----------------------------
// agent-start caps silently (correct, but nobody learns). Hook stderr goes
// nowhere a human reads, so the condition must surface in the ONE session a
// human is talking to.
const SESSION_HOOK = fileURLToPath(new URL('./session-start', import.meta.url));

function runSession(dir, env = {}) {
  const r = spawnSync('bash', [SESSION_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
  return { out: r.stdout ?? '', err: r.stderr ?? '', status: r.status };
}

test('session-start flags any role whose index is over budget', () => {
  const dir = project({ memory: { 'MEMORY.md': index(4000) } });   // ~200KB
  try {
    const { out, status } = runSession(dir);
    assert.equal(status, 0);
    assert.match(out, /memory-budget/);
    assert.match(out, /qa-engineer/);                 // names WHICH role
    assert.match(out, /compaction pass/);             // and what to do about it
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session-start checks every role, not just the session\'s own', () => {
  const dir = project({ memory: { 'MEMORY.md': index(5) } });       // this role is fine
  try {
    mkdirSync(join(dir, '.agents', 'memory', 'test-automation-engineer'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'memory', 'test-automation-engineer', 'MEMORY.md'), index(4000));
    const { out } = runSession(dir);
    // The bloated role is named even though the session was not launched as it.
    assert.match(out, /test-automation-engineer/);
    assert.match(out, /memory-budget/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session-start stays quiet when every index is within budget', () => {
  const dir = project({ memory: { 'MEMORY.md': index(5) } });
  try {
    assert.doesNotMatch(runSession(dir).out, /memory-budget/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- per-role config overrides ---------------------------------------------
// These hooks are SHARED — they fire for every dispatched agent in the repo,
// including other bundles'. SDLC_SHARED_DOCS_<ROLE> / SDLC_ROLE_MEMORY_FILES_<ROLE>
// tune what one role receives; `__none__` opts a role out entirely; a role with no
// override inherits the globals (a new agent needs zero config).

test('per-role SDLC_SHARED_DOCS override narrows that role only', () => {
  const dir = project({
    memory: { 'MEMORY.md': index(3) },
    shared: { testing: '# testing doc', profile: '# profile doc' },
  });
  try {
    const out = run(dir, 'qa-engineer', { SDLC_SHARED_DOCS_QA_ENGINEER: 'testing' });
    assert.match(out, /testing doc/);
    assert.doesNotMatch(out, /profile doc/, 'the override replaced the global list for this role');
    // another role with no override still inherits the full default set
    mkdirSync(join(dir, '.agents', 'memory', 'scout'), { recursive: true });
    const other = run(dir, 'scout', { SDLC_SHARED_DOCS_QA_ENGINEER: 'testing' });
    assert.match(other, /profile doc/, 'foreign override does not leak onto other roles');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('`__none__` opts a role out of shared docs while memory still flows', () => {
  const dir = project({
    memory: { 'MEMORY.md': index(3) },
    shared: { testing: '# testing doc' },
  });
  try {
    const out = run(dir, 'qa-engineer', { SDLC_SHARED_DOCS_QA_ENGINEER: '__none__' });
    assert.doesNotMatch(out, /testing doc/);
    assert.match(out, /Entry 0/, 'role memory unaffected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both lists `__none__` → the hook injects nothing at all for that role', () => {
  const dir = project({
    memory: { 'MEMORY.md': index(3) },
    shared: { testing: '# testing doc' },
  });
  try {
    const out = run(dir, 'qa-engineer', {
      SDLC_SHARED_DOCS_QA_ENGINEER: '__none__',
      SDLC_ROLE_MEMORY_FILES_QA_ENGINEER: '__none__',
    });
    assert.equal(out.trim(), '', 'fully opted-out role gets a silent hook');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('per-role SDLC_ROLE_MEMORY_FILES override picks specific files', () => {
  const dir = project({
    memory: { 'MEMORY.md': index(3), 'RULES.md': '- always be terse' },
    shared: {},
  });
  try {
    const out = run(dir, 'qa-engineer', { SDLC_ROLE_MEMORY_FILES_QA_ENGINEER: 'RULES.md' });
    assert.match(out, /always be terse/);
    assert.doesNotMatch(out, /Entry 0/, 'MEMORY.md excluded by the override');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('global __none__ silences a list for every role, not just one', () => {
  const dir = project({
    memory: { 'MEMORY.md': index(3) },
    shared: { testing: '# testing doc' },
  });
  try {
    const out = run(dir, 'qa-engineer', { SDLC_SHARED_DOCS: '__none__' });
    assert.doesNotMatch(out, /testing doc/);
    assert.match(out, /Entry 0/, 'memory list untouched by the docs sentinel');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- roster mode (generated config-defaults.sh present) --------------------
// The installer generates per-role lines for every INSTALLED agent; the file's
// presence flips default-deny for everyone else. SDLC_CONFIG_DIR points lib.sh
// at a fixture dir so the repo's own hooks/ stays pristine under test.

function configDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-cfg-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('roster mode: an installed role keeps its context, an unknown role gets silence', () => {
  const dir = project({ memory: { 'MEMORY.md': index(3) }, shared: { testing: '# testing doc' } });
  const cfg = configDir({
    'config-defaults.sh':
      ': "${SDLC_SHARED_DOCS_QA_ENGINEER:=${SDLC_SHARED_DOCS:-testing profile}}"\n'
      + ': "${SDLC_ROLE_MEMORY_FILES_QA_ENGINEER:=${SDLC_ROLE_MEMORY_FILES:-MEMORY.md}}"\n',
  });
  try {
    const rostered = run(dir, 'qa-engineer', { SDLC_CONFIG_DIR: cfg });
    assert.match(rostered, /testing doc/);
    assert.match(rostered, /Entry 0/);
    // a role the installer never saw: no docs, no memory, silent hook
    mkdirSync(join(dir, '.agents', 'memory', 'Plan'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'memory', 'Plan', 'MEMORY.md'), '- stray');
    const unknown = runCapturingStderr(dir, 'Plan', { SDLC_CONFIG_DIR: cfg });
    assert.equal(unknown.out.trim(), '', 'unrostered role receives nothing');
    assert.equal(unknown.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('roster mode: config.sh grants an unrostered role, and beats generated lines', () => {
  const dir = project({ memory: { 'MEMORY.md': index(3) }, shared: { testing: '# testing doc', profile: '# profile doc' } });
  const cfg = configDir({
    'config.sh':
      ': "${SDLC_SHARED_DOCS_PLAN:=profile}"\n'
      + ': "${SDLC_SHARED_DOCS_QA_ENGINEER:=__none__}"\n',
    'config-defaults.sh':
      ': "${SDLC_SHARED_DOCS_QA_ENGINEER:=testing profile}"\n'
      + ': "${SDLC_ROLE_MEMORY_FILES_QA_ENGINEER:=MEMORY.md}"\n',
  });
  try {
    mkdirSync(join(dir, '.agents', 'memory', 'Plan'), { recursive: true });
    const granted = run(dir, 'Plan', { SDLC_CONFIG_DIR: cfg });
    assert.match(granted, /profile doc/, 'user config serves a host builtin');
    assert.doesNotMatch(granted, /testing doc/);
    const muted = run(dir, 'qa-engineer', { SDLC_CONFIG_DIR: cfg });
    assert.doesNotMatch(muted, /testing doc/, 'user __none__ beats the generated grant');
    assert.match(muted, /Entry 0/, 'memory list untouched by the docs override');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('no config-defaults.sh → legacy allow-all is unchanged', () => {
  const dir = project({ memory: { 'MEMORY.md': index(3) }, shared: { testing: '# testing doc' } });
  const cfg = configDir({}); // empty config dir — no defaults file
  try {
    const out = run(dir, 'qa-engineer', { SDLC_CONFIG_DIR: cfg });
    assert.match(out, /testing doc/);
    assert.match(out, /Entry 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cfg, { recursive: true, force: true });
  }
});

// Both lists tolerate the "wrong" spelling — a mismatched entry is otherwise
// skipped silently, which reads as "hook broken" with no error anywhere.
test('naming tolerance: testing.md in the docs list and bare snapshot in the memory list both resolve', () => {
  const dir = project({ memory: { 'snapshot.md': 'snapshot body' }, shared: { testing: '# testing doc' } });
  try {
    const out = run(dir, 'qa-engineer', {
      SDLC_SHARED_DOCS: 'testing.md',
      SDLC_ROLE_MEMORY_FILES: 'snapshot',
    });
    assert.match(out, /testing doc/);
    assert.match(out, /snapshot body/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
