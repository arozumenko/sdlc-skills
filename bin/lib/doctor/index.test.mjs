import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finding } from './finding.mjs';
import { runDoctor, exitCodeFor, formatText, parseDoctorArgs, doctorMain } from './index.mjs';

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
  assert.deepEqual(parseDoctorArgs(['--json', '--strict', '--target', 'claude,codex']), { json: true, strict: true, targets: ['claude', 'codex'], unknown: [] });
  assert.deepEqual(parseDoctorArgs(['--bogus']).unknown, ['--bogus']);
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
