import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createSafeFs } from '../fsx.mjs';
import { expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { targetsCheck } from './targets.mjs';
import { wiringCheck } from './wiring.mjs';

const SCRIPTS = (dir) => Object.fromEntries(['run-hook.cmd', 'session-start', 'agent-start', 'lib.sh'].map((f) => [`${dir}/${f}`, '#']));
function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'dwr-'));
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), typeof c === 'string' ? c : JSON.stringify(c)); }
  return d;
}
function run(d) { const ctx = { projectDir: d, fs: createSafeFs(d), targets: null, facts: {} }; targetsCheck.run(ctx); return wiringCheck.run(ctx); }
const claudeSettings = (events) => ({ hooks: Object.fromEntries(Object.entries(events).map(([e, gs]) => [e, gs.map((g) => ({ ...g, _factory: 'sdlc-core' }))])) });

test('canonical Claude wiring is ok', () => {
  const s = expectedCoreHookSpec('claude');
  const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.json': claudeSettings(s.events) });
  try { const f = run(d); assert.deepEqual(f.map((x) => x.severity), ['ok']); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('scripts installed but SubagentStart unwired is an error with a fix', () => {
  const s = expectedCoreHookSpec('claude');
  const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.json': claudeSettings({ SessionStart: s.events.SessionStart }) });
  try {
    const e = run(d).find((x) => x.severity === 'error');
    assert.match(e.message, /SubagentStart not wired/); assert.match(e.fix, /init .*--target claude --update/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('wiring in settings.local.json counts', () => {
  const s = expectedCoreHookSpec('claude');
  const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.local.json': claudeSettings(s.events) });
  try { assert.deepEqual(run(d).map((x) => x.severity), ['ok']); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('disableAllHooks is an error', () => {
  const s = expectedCoreHookSpec('claude');
  const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.json': { ...claudeSettings(s.events), disableAllHooks: true } });
  try { assert.ok(run(d).some((x) => x.severity === 'error' && /disableAllHooks/.test(x.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('noncanonical entry is unrecognized wiring, not unwired', () => {
  const s = expectedCoreHookSpec('claude');
  const ev = structuredClone(s.events); ev.SubagentStart[0].matcher = 'qa-*';
  const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.json': claudeSettings(ev) });
  try {
    const f = run(d);
    assert.ok(f.some((x) => x.severity === 'warning' && /unrecognized wiring/.test(x.message)));
    assert.ok(!f.some((x) => x.severity === 'error'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('wired command pointing at a missing script is an error', () => {
  const s = expectedCoreHookSpec('claude');
  const d = project({ [`${s.scriptsDir}/run-hook.cmd`]: '#', '.claude/settings.json': claudeSettings(s.events) });
  try { assert.ok(run(d).some((x) => x.severity === 'error' && /missing .*agent-start/.test(x.message))); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('empty and malformed settings are warnings distinct from absent (Review Focus 2)', () => {
  const s = expectedCoreHookSpec('claude');
  for (const bad of ['', '{"hooks": {},}']) {
    const d = project({ ...SCRIPTS(s.scriptsDir), '.claude/settings.json': bad, '.claude/settings.local.json': claudeSettings(s.events) });
    try {
      const f = run(d);
      assert.ok(f.some((x) => x.severity === 'warning' && /settings\.json .*(malformed|empty)/.test(x.message)), JSON.stringify(f));
      assert.ok(!f.some((x) => x.severity === 'error'));
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('Cursor needs only sessionStart; Copilot env is part of canonical', () => {
  const c = expectedCoreHookSpec('cursor'); const p = expectedCoreHookSpec('copilot');
  const wrongEnv = structuredClone(p.writeSpec); wrongEnv.hooks.subagentStart[0].env = { SDLC_VSCODE: '1' };
  const d = project({ ...SCRIPTS(c.scriptsDir), '.cursor/hooks.json': { version: 1, hooks: c.events }, ...SCRIPTS(p.scriptsDir), '.github/hooks/sdlc-skills.json': wrongEnv });
  try {
    const f = run(d);
    assert.ok(f.some((x) => x.target === 'cursor' && x.severity === 'ok'));
    assert.ok(f.some((x) => x.target === 'copilot' && x.severity === 'warning' && /subagentStart.*unrecognized/.test(x.message)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
