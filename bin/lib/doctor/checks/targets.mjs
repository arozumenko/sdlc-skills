import { expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { finding } from '../finding.mjs';
import { readJson, hookEntries } from './common.mjs';

const ALL = [['claude', '.claude'], ['cursor', '.cursor'], ['copilot', '.github'], ['codex', '.codex'], ['windsurf', '.windsurf']];
export const KNOWN_TARGETS = ALL.map(([id]) => id);

export function detectTargets(ctx) {
  const wanted = ctx.targets;
  return ALL.filter(([id]) => !wanted || wanted.includes(id)).map(([target, dir]) => {
    const spec = expectedCoreHookSpec(target);
    const dirExists = ctx.fs.list(dir).status === 'ok';
    if (!spec) return { target, dirExists, evidence: false, scriptsPresent: false, markerIn: [], examined: false };
    const scriptsPresent = ctx.fs.exists(`${spec.scriptsDir}/run-hook.cmd`);
    const markerIn = spec.configFiles.filter((f) => { const j = readJson(ctx.fs, f); return j.status === 'ok' && hookEntries(j.value).length > 0; });
    return { target, dirExists, evidence: scriptsPresent || markerIn.length > 0, scriptsPresent, markerIn, examined: true };
  });
}

export const targetsCheck = {
  name: 'targets',
  run(ctx) {
    const ts = detectTargets(ctx);
    ctx.detected = ts;
    ctx.facts.installed = ts.some((t) => t.evidence);
    ctx.facts.targets = ts.filter((t) => t.dirExists || t.evidence)
      .map((t) => `${t.target} (${!t.examined ? 'not examined' : t.evidence ? 'installed' : 'directory only, not examined'})`).join(', ') || 'none';
    if (!ctx.facts.installed) return [];
    return [finding({ check: 'targets', severity: 'skipped', message: 'not examined: factory-specific hooks, native-plugin wiring, targets without core hooks' })];
  },
};
