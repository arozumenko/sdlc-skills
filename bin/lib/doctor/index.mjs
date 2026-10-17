import { createGitRunner } from './git.mjs';
import { createSafeFs } from './fsx.mjs';
import { finding } from './finding.mjs';
import { targetsCheck } from './checks/targets.mjs';
import { wiringCheck } from './checks/wiring.mjs';
import { persistCheck } from './checks/persist.mjs';
import { hookversionCheck } from './checks/hookversion.mjs';
import { payloadCheck } from './checks/payload.mjs';

// Later tasks add their checks here, in this order.
export const DEFAULT_CHECKS = [targetsCheck, wiringCheck, persistCheck, hookversionCheck, payloadCheck];

export function parseDoctorArgs(argv) {
  const out = { json: false, strict: false, targets: null, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--target') out.targets = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else out.unknown.push(a);
  }
  return out;
}

export function makeContext({ projectDir, pkgRoot, targets = null, git = null, fs = null }) {
  return { projectDir, pkgRoot, targets, git: git ?? createGitRunner({ cwd: projectDir }), fs: fs ?? createSafeFs(projectDir), facts: {} };
}

// Later tasks add async preparation steps here (Task 12).
export const DEFAULT_PREPARE = [];

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

export function formatText({ facts, findings, summary }) {
  const lines = ['', '  sdlc-skills doctor'];
  for (const [k, v] of Object.entries(facts)) lines.push(`  ${k.padEnd(9)} ${v}`);
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

export async function doctorMain(argv, { cwd, pkgRoot, checks = DEFAULT_CHECKS, prepare = DEFAULT_PREPARE }) {
  const args = parseDoctorArgs(argv);
  if (args.unknown.length) { console.error(`  ! Unknown doctor argument(s): ${args.unknown.join(', ')}`); return 2; }
  let result;
  try {
    const base = makeContext({ projectDir: cwd, pkgRoot, targets: args.targets });
    for (const step of prepare) await step(base);
    result = runDoctor({ projectDir: cwd, pkgRoot, targets: args.targets, checks, git: base.git, fs: base.fs, prepared: base });
  }
  catch (err) {
    if (args.json) console.log(JSON.stringify({ facts: {}, findings: [], summary: { errors: 0, warnings: 0, unknown: 0 }, failure: String(err.message) }));
    else console.error(`  ! doctor failed: ${err.message}`);
    return 2;
  }
  if (checks === DEFAULT_CHECKS && result.facts.installed === false) {
    result.findings.unshift(finding({ check: 'targets', severity: 'skipped', message: `no sdlc-skills installation found in ${cwd}` }));
  } else if (checks === DEFAULT_CHECKS && result.findings.length === 0) {
    result.facts.installed = false;
    result.findings.push(finding({ check: 'targets', severity: 'skipped', message: `no sdlc-skills installation found in ${cwd}` }));
  }
  console.log(args.json ? JSON.stringify(result, null, 2) : formatText(result));
  return exitCodeFor(result.summary, { strict: args.strict });
}
