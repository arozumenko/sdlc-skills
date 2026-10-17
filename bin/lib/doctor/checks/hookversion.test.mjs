import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeFs } from '../fsx.mjs';
import { sha256 } from '../shell-literals.mjs';
import { CORE_HOOK_FILES } from '../../core-hook-spec.mjs';
import { targetsCheck } from './targets.mjs';
import { hookversionCheck } from './hookversion.mjs';

const PKG = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgFile = (f) => readFileSync(join(PKG, 'hooks', f), 'utf8');
function project(overrides = {}) {
  const d = mkdtempSync(join(tmpdir(), 'dhv-'));
  const files = { ...Object.fromEntries(['run-hook.cmd', 'session-start', 'agent-start', 'lib.sh'].map((f) => [`.claude/hooks/sdlc-skills/${f}`, pkgFile(f)])), ...overrides };
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), c); }
  return d;
}
const run = (d, history) => { const ctx = { projectDir: d, pkgRoot: PKG, fs: createSafeFs(d), targets: ['claude'], facts: {}, hookHistory: history }; targetsCheck.run(ctx); return hookversionCheck.run(ctx); };

test('current hooks: ok', () => {
  const d = project();
  try { assert.deepEqual(run(d).map((f) => f.severity), ['ok']); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('current hooks with a high literal override: warning', () => {
  const d = project({ '.claude/hooks/sdlc-skills/config.sh': 'SDLC_CTX_CAP=32768\n' });
  try { assert.ok(run(d).some((f) => f.severity === 'warning' && /32,768.*exceeds/.test(f.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('complete-set match of an earlier version: warning with the version fact', () => {
  const old = "default_ctx_cap() {\n  if [ -n \"${COPILOT_CLI:-}\" ]; then printf '10240'; else printf '32768'; fi\n}\n";
  const d = project({ '.claude/hooks/sdlc-skills/lib.sh': old });
  const files = Object.fromEntries(['run-hook.cmd', 'session-start', 'agent-start'].map((f) => [f, sha256(pkgFile(f))]));
  files['lib.sh'] = sha256(old);
  try {
    const f = run(d, { versions: [{ commit: 'abc123', date: '2026-08-21', files, defaultBudget: { claude: 32768, copilot: 10240 } }] });
    assert.ok(f.some((x) => x.severity === 'warning' && /match an earlier sdlc-skills version \(abc123, 2026-08-21\).*32,768 bytes/.test(x.message)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('unknown config syntax: budget unknown', () => {
  const d = project({ '.claude/hooks/sdlc-skills/config.sh': 'if true; then SDLC_CTX_CAP=1; fi\n' });
  try { assert.ok(run(d).some((f) => f.severity === 'unknown' && /config\.sh/.test(f.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('unrecognized hook set: warning', () => {
  const d = project({ '.claude/hooks/sdlc-skills/agent-start': '#!/bin/sh\necho patched\n' });
  try { assert.ok(run(d, { versions: [] }).some((f) => f.severity === 'warning' && /unrecognized hook version/.test(f.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('hook-history.json is current: the package hook set is a recorded complete-set version', () => {
  const history = JSON.parse(readFileSync(new URL('../hook-history.json', import.meta.url), 'utf8'));
  const current = Object.fromEntries(CORE_HOOK_FILES.map((f) => [f, sha256(pkgFile(f))]));
  assert.ok(history.versions.some((v) => CORE_HOOK_FILES.every((f) => v.files[f] === current[f])),
    'hooks/ changed but bin/lib/doctor/hook-history.json was not regenerated: run `npm run gen:hook-history` and commit the JSON (after committing the hooks/ change)');
});

test('budget risk wording is target-appropriate', () => {
  const d = mkdtempSync(join(tmpdir(), 'dhv-'));
  try {
    for (const f of CORE_HOOK_FILES) { mkdirSync(join(d, '.cursor/hooks/sdlc-skills'), { recursive: true }); writeFileSync(join(d, '.cursor/hooks/sdlc-skills', f), pkgFile(f)); }
    writeFileSync(join(d, '.cursor/hooks/sdlc-skills/config.sh'), 'SDLC_CTX_CAP=32768\n');
    const ctx = { projectDir: d, pkgRoot: PKG, fs: createSafeFs(d), targets: ['cursor'], facts: {} }; targetsCheck.run(ctx);
    const w = hookversionCheck.run(ctx).find((f) => f.severity === 'warning');
    assert.match(w.message, /32,768 bytes.*exceeds 10,000 bytes: truncation risk/); assert.doesNotMatch(w.message, /Claude/);
    assert.match(w.fix, /\.cursor\/hooks\/sdlc-skills\/config\.sh/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  const c = project({ '.claude/hooks/sdlc-skills/config.sh': 'SDLC_CTX_CAP=32768\n' });
  try { assert.match(run(c).find((f) => f.severity === 'warning').message, /exceeds Claude's 10,000-character limit/); } finally { rmSync(c, { recursive: true, force: true }); }
});
