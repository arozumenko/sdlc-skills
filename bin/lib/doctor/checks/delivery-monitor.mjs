import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { finding } from '../finding.mjs';
import { readJson } from './common.mjs';

const MARKER = '_delivery';

export function deliveryMonitorPresent(ctx) {
  const installed = ctx.fs.list('.claude/skills/delivery-monitor').status === 'ok';
  const wired = ['.claude/settings.json', '.claude/settings.local.json'].some((f) => { const j = readJson(ctx.fs, f); return j.status === 'ok' && (j.value.hooks?.SubagentStop ?? []).some((e) => e && e[MARKER]); });
  return installed || wired;
}

export const deliveryMonitorCheck = {
  name: 'delivery-monitor',
  run(ctx) {
    if (!(ctx.detected || []).some((t) => t.target === 'claude' && t.evidence)) return [];
    if (!deliveryMonitorPresent(ctx)) return [];
    return ctx.deliveryMonitorFindings ?? [];
  },
};

// Loaded asynchronously from the PACKAGE (never the project's copy) before checks run.
export async function preloadDeliveryMonitor(ctx) {
  if (!deliveryMonitorPresent(ctx)) return;
  const mod = await import(pathToFileURL(join(ctx.pkgRoot, 'skills', 'delivery-monitor', 'scripts', 'install-hooks.mjs')).href);
  const git = (cwd, args) => { const r = ctx.git.run(['-C', cwd, ...args]); return r.ok ? r.stdout.trim() : null; };
  const gitExec = (cwd, args) => { const r = ctx.git.run(['-C', cwd, ...args]); return { ok: r.ok, status: r.status }; };
  const raw = mod.doctorFindings(ctx.projectDir, '.claude/skills/delivery-monitor', { env: {}, git, gitExec });
  const warnings = raw.filter((f) => f.severity === 'warning');
  ctx.deliveryMonitorFindings = warnings.length
    ? warnings.map((f) => finding({ check: 'delivery-monitor', target: 'claude', severity: 'warning', message: `${f.checkout} checkout: ${f.message}`, fix: f.fix }))
    : [finding({ check: 'delivery-monitor', target: 'claude', severity: 'ok', message: `${raw[0]?.checkout ?? 'main'} checkout: no attention items` })];
}
