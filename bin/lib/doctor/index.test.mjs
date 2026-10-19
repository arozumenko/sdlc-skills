import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finding } from './finding.mjs';
import { runDoctor, exitCodeFor, formatText, parseDoctorArgs, doctorMain, makeContext, DEFAULT_CHECKS, DEFAULT_PREPARE } from './index.mjs';
import { deliveryMonitorCheck } from './checks/delivery-monitor.mjs';

const fake = (findings) => [{ name: 'fake', run: () => findings }];

test('finding rejects unknown severities', () => {
  assert.throws(() => finding({ check: 'x', severity: 'bad', message: 'm' }));
});

test('summary and exit codes; --strict changes the exit only', () => {
  const r = runDoctor({ projectDir: '/tmp', pkgRoot: '/tmp', checks: fake([
    finding({ check: 'a', severity: 'warning', message: 'w' }),
    finding({ check: 'a', severity: 'unknown', message: 'u' }),
  ]) });
  assert.deepEqual(r.summary, { errors: 0, warnings: 1, unknown: 1 });
  assert.equal(exitCodeFor(r.summary, { strict: false }), 0);
  assert.equal(exitCodeFor(r.summary, { strict: true }), 1);
  assert.equal(r.findings[0].severity, 'warning', 'strict never changes severity');
  const e = runDoctor({ projectDir: '/tmp', pkgRoot: '/tmp', checks: fake([finding({ check: 'a', severity: 'error', message: 'e', fix: 'do x' })]) });
  assert.equal(exitCodeFor(e.summary, { strict: false }), 1);
  assert.match(formatText(e), /✗ a\s+e\n\s+fix: do x/);
  assert.match(formatText(e), /1 error, 0 warnings/);
});

test('parseDoctorArgs', () => {
  assert.deepEqual(parseDoctorArgs(['--json', '--strict', '--target', 'claude,codex']), { json: true, strict: true, help: false, targets: ['claude', 'codex'], unknown: [] });
  assert.deepEqual(parseDoctorArgs(['--bogus']).unknown, ['--bogus']);
  assert.equal(parseDoctorArgs(['--help']).help, true); assert.equal(parseDoctorArgs(['-h']).help, true);
});

test('parseDoctorArgs: a missing --target value never swallows the next flag', () => {
  const a = parseDoctorArgs(['--target', '--json']);
  assert.equal(a.json, true); assert.equal(a.unknown.length, 1); assert.match(a.unknown[0], /--target needs a value/);
  assert.match(parseDoctorArgs(['--target']).unknown[0], /--target needs a value/);
});

test('parseDoctorArgs: unknown target ids are reported', () => {
  const a = parseDoctorArgs(['--target', 'claud,cursor', '--strict']);
  assert.equal(a.unknown.length, 1); assert.match(a.unknown[0], /unknown target "claud".*claude, cursor, copilot, codex, windsurf/);
});

const capture = async (fn) => {
  const out = [], err = []; const log = console.log, error = console.error;
  console.log = (s) => out.push(String(s)); console.error = (s) => err.push(String(s));
  try { return { code: await fn(), out: out.join('\n'), err: err.join('\n') }; } finally { console.log = log; console.error = error; }
};

test('doctorMain: bad --target is exit 2 with a clear message, even with --strict', async () => {
  const r = await capture(() => doctorMain(['--target', 'claud', '--strict'], { cwd: '/tmp', pkgRoot: '/tmp' }));
  assert.equal(r.code, 2); assert.match(r.err, /unknown target "claud"/); assert.doesNotMatch(r.out, /no sdlc-skills installation/);
  assert.equal((await capture(() => doctorMain(['--target', '--json'], { cwd: '/tmp', pkgRoot: '/tmp' }))).code, 2);
});

test('doctorMain: --help and -h print usage and exit 0', async () => {
  for (const flag of ['--help', '-h']) {
    const r = await capture(() => doctorMain([flag], { cwd: '/tmp', pkgRoot: '/tmp' }));
    assert.equal(r.code, 0); assert.match(r.out, /init doctor \[--json\] \[--strict\] \[--target <list>\]/); assert.equal(r.err, '');
  }
});

test('doctorMain: a formatting failure is exit 2, not 1', async () => {
  const bad = fake([finding({ check: 'a', severity: 'error', message: 'e' })]);
  const r = await capture(() => doctorMain([], { cwd: '/tmp', pkgRoot: '/tmp', checks: bad, prepare: [], format: () => { throw new Error('fmt'); } }));
  assert.equal(r.code, 2); assert.match(r.err, /doctor failed: fmt/);
});

test('formatText: spec Label: facts, no internal installed fact, ignore notes folded', () => {
  const text = formatText({ facts: { installed: true, targets: 'claude (installed)', roles: 'scout', memory: '1 role, 0 with a memory directory', 'ignore:.claude/settings.json': 'tracked but matches an ignore rule' }, findings: [], summary: { errors: 0, warnings: 0, unknown: 0 } });
  assert.match(text, /^  Targets:  claude \(installed\)$/m);
  assert.match(text, /^  Roles:    scout$/m);
  assert.match(text, /^  Memory:   1 role, 0 with a memory directory$/m);
  assert.match(text, /^  Notes:    \.claude\/settings\.json is tracked but matches an ignore rule$/m);
  assert.doesNotMatch(text, /installed  *true|ignore:/);
});

test('doctorMain: a crashing check is exit 2; JSON shape', async () => {
  const out = []; const log = console.log; console.log = (s) => out.push(s);
  try {
    const code = await doctorMain(['--json'], { cwd: '/tmp', pkgRoot: '/tmp', checks: [{ name: 'boom', run: () => { throw new Error('kaput'); } }] });
    assert.equal(code, 2);
    const ok = await doctorMain(['--json'], { cwd: '/tmp', pkgRoot: '/tmp', checks: fake([finding({ check: 'a', severity: 'ok', message: 'fine' })]) });
    assert.equal(ok, 0);
    const parsed = JSON.parse(out[out.length - 1]);
    assert.deepEqual(Object.keys(parsed).sort(), ['facts', 'findings', 'summary']);
  } finally { console.log = log; }
});

test('nothing installed: one clear finding, exit 0, no healthy verdict (Review Focus 5)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dnone-'));
  const out = []; const log = console.log; console.log = (s) => out.push(s);
  try {
    const code = await doctorMain([], { cwd: d, pkgRoot: d });
    assert.equal(code, 0);
    const text = out.join('\n');
    assert.match(text, /no sdlc-skills installation found in /);
    assert.doesNotMatch(text, /0 errors, 0 warnings/);
  } finally { console.log = log; rmSync(d, { recursive: true, force: true }); }
});

test('delivery-monitor runs last; a failing preload is one unknown finding, not a doctor failure', async () => {
  assert.equal(DEFAULT_CHECKS.at(-1), deliveryMonitorCheck);
  const d = mkdtempSync(join(tmpdir(), 'dprep-')), pkg = mkdtempSync(join(tmpdir(), 'dprep-pkg-'));
  try {
    mkdirSync(join(d, '.claude/skills/delivery-monitor'), { recursive: true });
    const ctx = makeContext({ projectDir: d, pkgRoot: pkg });
    for (const step of DEFAULT_PREPARE) await step(ctx); // pkg has no install-hooks.mjs: the import throws
    const f = deliveryMonitorCheck.run({ ...ctx, detected: [{ target: 'claude', evidence: true, examined: true }] });
    assert.deepEqual(f.map((x) => [x.severity, x.message]), [['unknown', 'delivery-monitor check failed to run']]);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(pkg, { recursive: true, force: true }); }
});
