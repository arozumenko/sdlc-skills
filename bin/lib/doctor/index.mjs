import { createGitRunner } from './git.mjs';
import { createSafeFs } from './fsx.mjs';
import { finding } from './finding.mjs';
import { targetsCheck, KNOWN_TARGETS } from './checks/targets.mjs';
import { wiringCheck } from './checks/wiring.mjs';
import { persistCheck } from './checks/persist.mjs';
import { hookversionCheck } from './checks/hookversion.mjs';
import { payloadCheck } from './checks/payload.mjs';
import { driftCheck } from './checks/drift.mjs';
import { rolesCheck } from './checks/roles.mjs';
import { deliveryMonitorCheck, preloadDeliveryMonitor } from './checks/delivery-monitor.mjs';

// Later tasks add their checks here, in this order.
export const DEFAULT_CHECKS = [targetsCheck, wiringCheck, persistCheck, hookversionCheck, payloadCheck, driftCheck, rolesCheck, deliveryMonitorCheck];

export const DOCTOR_USAGE = `
  Usage: npx github:arozumenko/sdlc-skills init doctor [--json] [--strict] [--target <list>]

  Read-only, offline health check of this project's sdlc-skills install. Never runs project code.

    --json             Machine-readable output: { facts, findings, summary }
    --strict           Exit 1 on warnings as well as errors
    --target <list>    Only these targets (${KNOWN_TARGETS.join(', ')})
    --help, -h         Show this help

  Exit codes: 0 no errors, 1 errors (or warnings with --strict), 2 doctor itself failed.
`;

// Bad values are reported in `unknown`, like unknown arguments, so doctorMain exits 2.
export function parseDoctorArgs(argv) {
  const out = { json: false, strict: false, help: false, targets: null, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--target') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { out.unknown.push('--target needs a value'); continue; }
      i++;
      out.targets = v.split(',').map((s) => s.trim()).filter(Boolean);
      for (const t of out.targets) if (!KNOWN_TARGETS.includes(t)) out.unknown.push(`unknown target "${t}" (known: ${KNOWN_TARGETS.join(', ')})`);
    }
    else out.unknown.push(a);
  }
  return out;
}

export function makeContext({ projectDir, pkgRoot, targets = null, git = null, fs = null }) {
  return { projectDir, pkgRoot, targets, git: git ?? createGitRunner({ cwd: projectDir }), fs: fs ?? createSafeFs(projectDir), facts: {} };
}

// If the delivery-monitor preload throws, its check reports one `unknown` finding instead of failing the run.
const safe = (fn) => async (ctx) => { try { await fn(ctx); } catch { ctx.deliveryMonitorFindings = [finding({ check: 'delivery-monitor', target: 'claude', severity: 'unknown', message: 'delivery-monitor check failed to run' })]; } };
export const DEFAULT_PREPARE = [safe(preloadDeliveryMonitor)];

export function runDoctor({ projectDir, pkgRoot, targets = null, checks = DEFAULT_CHECKS, git = null, fs = null, prepared = {} }) {
  const ctx = { ...makeContext({ projectDir, pkgRoot, targets, git, fs }), ...prepared };
  const findings = [];
  for (const c of checks) findings.push(...c.run(ctx));
  const count = (s) => findings.filter((f) => f.severity === s).length;
  return { facts: ctx.facts, findings, summary: { errors: count('error'), warnings: count('warning'), unknown: count('unknown') } };
}

export const exitCodeFor = (summary, { strict }) => (summary.errors > 0 || (strict && summary.warnings > 0) ? 1 : 0);

const ICON = { error: '✗', warning: '!', ok: '✓', unknown: '?', skipped: '—' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Text mode shows facts in the spec's `Label:` form; `installed` is internal (JSON keeps it)
// and persist's `ignore:<file>` facts fold into one Notes line.
export function formatText({ facts, findings, summary }) {
  const lines = ['', '  sdlc-skills doctor'];
  const notes = [];
  for (const [k, v] of Object.entries(facts)) {
    if (k === 'installed') continue;
    if (k.startsWith('ignore:')) { notes.push(`${k.slice('ignore:'.length)} is ${v}`); continue; }
    lines.push(`  ${`${k[0].toUpperCase()}${k.slice(1)}:`.padEnd(9)} ${v}`);
  }
  if (notes.length) lines.push(`  ${'Notes:'.padEnd(9)} ${notes.join('; ')}`);
  lines.push('');
  for (const f of findings) {
    const label = f.target ? `${f.check}` : f.check;
    lines.push(`  ${ICON[f.severity]} ${label.padEnd(12)} ${f.target ? `${f.target}: ` : ''}${f.message}`);
    if (f.fix) lines.push(`  ${' '.repeat(15)}fix: ${f.fix}`);
  }
  if (facts.installed === false) return lines.join('\n') + '\n';
  lines.push('', `  ${plural(summary.errors, 'error')}, ${plural(summary.warnings, 'warning')}${summary.unknown ? `, ${summary.unknown} unknown` : ''}`, '');
  return lines.join('\n');
}

export async function doctorMain(argv, { cwd, pkgRoot, checks = DEFAULT_CHECKS, prepare = DEFAULT_PREPARE, format = formatText }) {
  const args = parseDoctorArgs(argv);
  if (args.help) { console.log(DOCTOR_USAGE); return 0; }
  if (args.unknown.length) { console.error(`  ! Invalid doctor argument(s): ${args.unknown.join(', ')}\n    run: npx github:arozumenko/sdlc-skills init doctor --help`); return 2; }
  let output, result;
  try {
    const base = makeContext({ projectDir: cwd, pkgRoot, targets: args.targets });
    for (const step of prepare) await step(base);
    result = runDoctor({ projectDir: cwd, pkgRoot, targets: args.targets, checks, git: base.git, fs: base.fs, prepared: base });
    if (checks === DEFAULT_CHECKS && result.facts.installed === false) {
      result.findings.unshift(finding({ check: 'targets', severity: 'skipped', message: `no sdlc-skills installation found in ${cwd}` }));
    } else if (checks === DEFAULT_CHECKS && result.findings.length === 0) {
      result.facts.installed = false;
      result.findings.push(finding({ check: 'targets', severity: 'skipped', message: `no sdlc-skills installation found in ${cwd}` }));
    }
    output = args.json ? JSON.stringify(result, null, 2) : format(result);
  }
  catch (err) {
    if (args.json) console.log(JSON.stringify({ facts: {}, findings: [], summary: { errors: 0, warnings: 0, unknown: 0 }, failure: String(err.message) }));
    else console.error(`  ! doctor failed: ${err.message}`);
    return 2;
  }
  console.log(output);
  return exitCodeFor(result.summary, { strict: args.strict });
}
