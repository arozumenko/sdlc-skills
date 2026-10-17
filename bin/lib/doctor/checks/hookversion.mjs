import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_HOOK_FILES, expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { finding } from '../finding.mjs';
import { sha256, parseShellLiterals, literalDefaultCap } from '../shell-literals.mjs';

const HISTORY = JSON.parse(readFileSync(new URL('../hook-history.json', import.meta.url), 'utf8'));
const fmt = (n) => n.toLocaleString('en-US');

export function hookVersionInfo(ctx, target) {
  const spec = expectedCoreHookSpec(target);
  const installed = {};
  for (const f of CORE_HOOK_FILES) { const r = ctx.fs.readText(`${spec.scriptsDir}/${f}`); installed[f] = r.status === 'ok' ? r.content : null; }
  const hashes = Object.fromEntries(Object.entries(installed).map(([f, t]) => [f, t == null ? null : sha256(t)]));
  const pkg = Object.fromEntries(CORE_HOOK_FILES.map((f) => [f, sha256(readFileSync(join(ctx.pkgRoot, 'hooks', f), 'utf8'))]));
  const history = ctx.hookHistory ?? HISTORY;
  let match = 'unrecognized', version = null;
  if (CORE_HOOK_FILES.every((f) => hashes[f] === pkg[f])) match = 'current';
  else { version = history.versions.find((v) => CORE_HOOK_FILES.every((f) => v.files[f] === hashes[f])) || null; if (version) match = 'historical'; }
  const host = target === 'copilot' ? 'copilot' : 'claude';
  let budget = match === 'current' ? literalDefaultCap(installed['lib.sh'] || '')[host] : match === 'historical' ? version.defaultBudget[host] : null;
  let budgetSource = budget == null ? 'unknown' : 'lib.sh';
  let configKnown = true;
  for (const cfg of ['config.sh', 'config-defaults.sh']) {
    const r = ctx.fs.readText(`${spec.scriptsDir}/${cfg}`);
    if (r.status === 'missing') continue;
    if (r.status !== 'ok') { configKnown = false; continue; }
    const p = parseShellLiterals(r.content);
    if (!p.known) { configKnown = false; continue; }
    if (p.vars.SDLC_CTX_CAP !== undefined && budgetSource !== 'config.sh') {
      if (/^\d+$/.test(p.vars.SDLC_CTX_CAP)) { budget = Number(p.vars.SDLC_CTX_CAP); budgetSource = cfg; } else configKnown = false;
    }
  }
  if (!configKnown) { budget = null; budgetSource = 'unknown'; }
  return { match, version, budget, budgetSource, configKnown, installed };
}

export const hookversionCheck = {
  name: 'hookversion',
  run(ctx) {
    const out = [];
    for (const t of (ctx.detected || []).filter((x) => x.evidence && x.examined && x.scriptsPresent)) {
      const i = hookVersionInfo(ctx, t.target);
      ctx.hookInfo = { ...(ctx.hookInfo || {}), [t.target]: i };
      const budgetRisk = i.configKnown && i.budget != null && t.target !== 'copilot' && i.budget > 10000;
      if (i.match === 'historical' && !(budgetRisk && i.budgetSource === 'lib.sh')) out.push(finding({ check: 'hookversion', target: t.target, severity: 'warning', message: `installed hooks match an earlier sdlc-skills version (${i.version.commit}, ${i.version.date})`, fix: 'npx github:arozumenko/sdlc-skills init <your usual flags> --update' }));
      if (i.match === 'unrecognized') out.push(finding({ check: 'hookversion', target: t.target, severity: 'warning', message: 'unrecognized hook version: installed core hook scripts match no known sdlc-skills version', fix: 'npx github:arozumenko/sdlc-skills init <your usual flags> --update' }));
      if (!i.configKnown) out.push(finding({ check: 'hookversion', target: t.target, severity: 'unknown', message: 'context budget unknown: config.sh or config-defaults.sh uses syntax doctor does not evaluate' }));
      else if (i.budget == null) out.push(finding({ check: 'hookversion', target: t.target, severity: 'unknown', message: 'context budget unknown for this hook version' }));
      else if (budgetRisk) {
        const where = i.budgetSource === 'lib.sh' && i.match === 'historical' ? `match an earlier sdlc-skills version (${i.version.commit}, ${i.version.date}) whose default Claude budget was ${fmt(i.budget)} bytes` : `budget is ${fmt(i.budget)} bytes (from ${i.budgetSource})`;
        const limit = t.target === 'claude' ? "Claude's 10,000-character limit" : '10,000 bytes';
        out.push(finding({ check: 'hookversion', target: t.target, severity: 'warning', message: `installed hooks ${where}, which exceeds ${limit}: truncation risk`, fix: i.budgetSource === 'lib.sh' ? 'npx github:arozumenko/sdlc-skills init <your usual flags> --update' : `lower SDLC_CTX_CAP in ${expectedCoreHookSpec(t.target).scriptsDir}/${i.budgetSource} to 9000 or less` }));
      }
      if (!out.some((f) => f.target === t.target)) out.push(finding({ check: 'hookversion', target: t.target, severity: 'ok', message: `core hooks match the running package; budget ${fmt(i.budget)} bytes` }));
    }
    return out;
  },
};
