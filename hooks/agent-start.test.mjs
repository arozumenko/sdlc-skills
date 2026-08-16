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

// ── SOUL.md reaches every host ────────────────────────────────────────────────────────────────
// Regression guard. SOUL.md used to be gated to Copilot on the premise that Claude and Codex got
// it via an @-import in the agent body. No agent ever contained one — all 23 said only "Read
// `SOUL.md` in this directory", and an agent body is a system prompt, so that resolves to nothing.
// The persona reached Claude/Codex through no channel at all: measured across two real boards,
// 0 of 290 dispatched subagents opened it, and the single one that managed it (of 86 on the other)
// spent three tool calls hunting the file with `find`.

test('SOUL.md is injected on Claude, not only under Copilot', () => {
  const dir = project({ role: 'tech-lead', memory: { 'SOUL.md': 'I am Rio, and I block on flaws.' } });
  try {
    const out = run(dir, 'tech-lead'); // no SDLC_VSCODE / COPILOT_CLI → the Claude path
    assert.match(out, /I am Rio, and I block on flaws\./,
      'the persona must be delivered on the default (Claude) host');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SOUL.md is still injected under Copilot', () => {
  const dir = project({ role: 'tech-lead', memory: { 'SOUL.md': 'I am Rio, and I block on flaws.' } });
  try {
    const out = run(dir, 'tech-lead', { SDLC_VSCODE: '1' });
    assert.match(out, /I am Rio, and I block on flaws\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SOUL.md is found in the agent directory, not just the memory dir', () => {
  // On Claude the file ships inside .claude/agents/<role>/, which is where resolve_role_file must
  // look — a memory-dir-only lookup is exactly how this went unnoticed.
  const dir = project({ role: 'tech-lead' });
  try {
    const agentDir = join(dir, '.claude', 'agents', 'tech-lead');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'SOUL.md'), 'persona from the agent dir');
    const out = run(dir, 'tech-lead');
    assert.match(out, /persona from the agent dir/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
