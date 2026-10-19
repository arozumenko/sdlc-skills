import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeFs } from '../fsx.mjs';
import { targetsCheck } from './targets.mjs';
import { hookversionCheck } from './hookversion.mjs';
import { payloadCheck } from './payload.mjs';

const PKG = fileURLToPath(new URL('../../../../', import.meta.url));
const hookFiles = Object.fromEntries(['run-hook.cmd', 'session-start', 'agent-start', 'lib.sh'].map((f) => [`.claude/hooks/sdlc-skills/${f}`, readFileSync(join(PKG, 'hooks', f), 'utf8')]));
const defaults = (roles) => roles.map((r) => { const s = r.toUpperCase().replace(/[^A-Z0-9]/g, '_'); return `: "\${SDLC_SHARED_DOCS_${s}:=\${SDLC_SHARED_DOCS:-testing profile}}"\n: "\${SDLC_ROLE_MEMORY_FILES_${s}:=\${SDLC_ROLE_MEMORY_FILES:-SOUL.md RULES.md MEMORY.md}}"\n`; }).join('');
function project(extra) {
  const d = mkdtempSync(join(tmpdir(), 'dpl-'));
  const files = { ...hookFiles, '.claude/agents/qa-engineer/AGENT.md': '---\nname: qa-engineer\n---\n', '.claude/agents/js-dev/AGENT.md': '---\nname: js-dev\n---\n', '.claude/hooks/sdlc-skills/config-defaults.sh': defaults(['js-dev', 'qa-engineer']), ...extra };
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), c); }
  return d;
}
const run = (d) => { const ctx = { projectDir: d, pkgRoot: PKG, fs: createSafeFs(d), targets: ['claude'], facts: {} }; targetsCheck.run(ctx); hookversionCheck.run(ctx); return payloadCheck.run(ctx); };

test('small inputs: ok', () => {
  const d = project({ '.agents/memory/qa-engineer/MEMORY.md': 'short' });
  try { assert.deepEqual(run(d).map((f) => f.severity), ['ok']); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('oversized candidate input: warning with top contributors, in bytes', () => {
  const d = project({ '.agents/memory/qa-engineer/MEMORY.md': 'x'.repeat(12000), '.agents/testing.md': 'y'.repeat(500) });
  try {
    const w = run(d).find((f) => f.severity === 'warning');
    assert.match(w.message, /qa-engineer: estimated candidate input 12,500 bytes > 9,000-byte budget; some content may become required reading/);
    assert.equal(w.data.top[0].rel, '.agents/memory/qa-engineer/MEMORY.md');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('RULES.md falls back to the agent directory', () => {
  const d = project({ '.claude/agents/js-dev/RULES.md': 'r'.repeat(9500) });
  try { assert.ok(run(d).some((f) => f.severity === 'warning' && /js-dev/.test(f.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('escaping counts: quotes and newlines cost extra bytes', () => {
  const d = project({ '.agents/memory/qa-engineer/MEMORY.md': '"\n'.repeat(3000) }); // 6000 chars → 12000 escaped bytes
  try { assert.ok(run(d).some((f) => f.severity === 'warning' && /12,000 bytes/.test(f.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('unreadable or binary memory file: that role unknown, others estimated (Review Focus 3)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const d = project({ '.agents/memory/qa-engineer/MEMORY.md': 'x', '.agents/memory/js-dev/MEMORY.md': Buffer.from([0xff, 0xfe]) });
  chmodSync(join(d, '.agents/memory/qa-engineer/MEMORY.md'), 0o000);
  try {
    const f = run(d);
    assert.ok(f.some((x) => x.severity === 'unknown' && /qa-engineer/.test(x.message) && /MEMORY\.md/.test(x.message)));
    assert.ok(f.some((x) => x.severity === 'unknown' && /js-dev/.test(x.message)));
  } finally { chmodSync(join(d, '.agents/memory/qa-engineer/MEMORY.md'), 0o644); rmSync(d, { recursive: true, force: true }); }
});

test('unrecognized hooks make the estimate unknown', () => {
  const d = project({ '.claude/hooks/sdlc-skills/agent-start': '#!/bin/sh\n' });
  try { assert.ok(run(d).every((f) => f.severity === 'unknown')); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('config.sh global list wins over the generated default; empty values count as unset', () => {
  const d = project({ '.claude/hooks/sdlc-skills/config.sh': 'SDLC_ROLE_MEMORY_FILES="MEMORY.md"\n', '.claude/agents/js-dev/RULES.md': 'r'.repeat(9500), '.agents/memory/qa-engineer/MEMORY.md': 'x'.repeat(9500) });
  try {
    const f = run(d);
    assert.ok(!f.some((x) => /js-dev/.test(x.message)));
    assert.ok(f.some((x) => x.severity === 'warning' && /qa-engineer/.test(x.message)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('per-role config.sh override beats config-defaults.sh', () => {
  const d = project({ '.claude/hooks/sdlc-skills/config.sh': ': "${SDLC_ROLE_MEMORY_FILES_JS_DEV:=__none__}"\n', '.claude/agents/js-dev/RULES.md': 'r'.repeat(9500) });
  try { assert.deepEqual(run(d).map((f) => f.severity), ['ok']); } finally { rmSync(d, { recursive: true, force: true }); }
});
