import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSafeFs } from '../fsx.mjs';
import { createGitRunner } from '../git.mjs';
import { deliveryMonitorCheck, preloadDeliveryMonitor } from './delivery-monitor.mjs';

const PKG = fileURLToPath(new URL('../../../../', import.meta.url));
const ctxFor = (d) => ({ projectDir: d, pkgRoot: PKG, fs: createSafeFs(d), git: createGitRunner({ cwd: d }), facts: {}, detected: [{ target: 'claude', evidence: true, examined: true }] });

test('skipped entirely when the skill and marker are absent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ddm-'));
  try { assert.deepEqual(deliveryMonitorCheck.run(ctxFor(d)), []); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('installed but unwired: warning; uses the package code, never the project copy', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ddm-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: d });
    mkdirSync(join(d, '.claude/skills/delivery-monitor/scripts'), { recursive: true });
    const sentinel = join(d, 'PROJECT_CODE_RAN');
    writeFileSync(join(d, '.claude/skills/delivery-monitor/scripts/install-hooks.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'x'); export function doctorFindings() { return []; }`);
    const ctx = ctxFor(d);
    await preloadDeliveryMonitor(ctx);
    const f = deliveryMonitorCheck.run(ctx);
    assert.ok(f.some((x) => x.severity === 'warning' && /main checkout: hook: not wired/.test(x.message)));
    assert.equal(existsSync(sentinel), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
