import { CORE_HOOK_FILES, expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { finding } from '../finding.mjs';
import { readJson, hookEntries } from './common.mjs';

const canon = (json) => JSON.stringify(hookEntries(json).map((e) => [e.event, e.entry]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

export function fileState(git, rel) {
  if (git.run(['ls-files', '--error-unmatch', '--', rel]).ok) return 'tracked';
  const ign = git.run(['ls-files', '--others', '--ignored', '--exclude-standard', '--', rel]);
  if (!ign.ok) return 'undetermined';
  if (ign.stdout.trim()) return 'ignored';
  const unt = git.run(['ls-files', '--others', '--exclude-standard', '--', rel]);
  if (!unt.ok) return 'undetermined';
  return unt.stdout.trim() ? 'untracked' : 'undetermined';
}

export const persistCheck = {
  name: 'persist',
  run(ctx) {
    const out = [];
    const targets = (ctx.detected || []).filter((t) => t.evidence && t.examined);
    if (!targets.length) return out;
    if (!ctx.git.run(['rev-parse', '--show-toplevel']).ok) {
      return targets.map((t) => finding({ check: 'persist', target: t.target, severity: 'unknown', message: 'not a Git repository: persistence undetermined' }));
    }
    const add = (t, severity, message, fix = null) => out.push(finding({ check: 'persist', target: t.target, severity, message, fix }));
    for (const t of targets) {
      const spec = expectedCoreHookSpec(t.target);
      const before = out.length;
      for (const file of t.markerIn) {
        const state = fileState(ctx.git, file);
        if (state === 'ignored') { add(t, 'warning', `wiring is in ${file}, which is ignored (other clones get no hooks)`, `commit ${file} (remove it from .gitignore), or re-run init in every clone`); continue; }
        if (state === 'untracked') { add(t, 'warning', `wiring is in ${file}, which is untracked (other clones get no hooks)`, `git add ${file} and commit`); continue; }
        if (state === 'undetermined') { add(t, 'unknown', `${file}: Git state undetermined`); continue; }
        if (ctx.git.run(['check-ignore', '-q', '--no-index', '--', file]).ok) ctx.facts[`ignore:${file}`] = 'tracked but matches an ignore rule';
        const wt = readJson(ctx.fs, file);
        const idx = ctx.git.showFile('', file);
        const head = ctx.git.showFile('HEAD', file);
        if ([idx, head].some((r) => r.status === 'undetermined')) { add(t, 'unknown', `${file}: persistence undetermined (Git < 2.45 or object unavailable)`); continue; }
        const parse = (r) => { if (r.status !== 'ok') return '[]'; try { return canon(JSON.parse(r.content)); } catch { return 'malformed'; } };
        const W = wt.status === 'ok' ? canon(wt.value) : '[]';
        const I = parse(idx);
        const H = parse(head);
        if (W === H) continue;
        if (W === I) add(t, 'warning', `wiring in ${file} is staged but not committed`, 'commit it');
        else add(t, 'warning', `wiring in ${file} has uncommitted changes`, `git add ${file} and commit`);
      }
      for (const f of [...CORE_HOOK_FILES, 'config.sh', 'config-defaults.sh']) {
        const rel = `${spec.scriptsDir}/${f}`;
        if (!ctx.fs.exists(rel)) continue; // missing scripts are the wiring check's error
        const st = fileState(ctx.git, rel);
        if (st === 'untracked' || st === 'ignored') { add(t, 'warning', `committed wiring references ${st} script ${rel}; other clones will not have it`, `git add ${spec.scriptsDir} and commit`); continue; }
        if (st === 'undetermined') { add(t, 'unknown', `${rel}: Git state undetermined`); continue; }
        // Bytes compared as utf8 text on both sides (showFile returns utf8); a lossless-decoding difference cannot hide an edit.
        const wt = ctx.fs.read(rel);
        const idx = ctx.git.showFile('', rel);
        const head = ctx.git.showFile('HEAD', rel);
        if (wt.status !== 'ok' || [idx, head].some((r) => r.status === 'undetermined')) { add(t, 'unknown', `${rel}: persistence undetermined (Git < 2.45 or object unavailable)`); continue; }
        const W = wt.content.toString('utf8');
        if (head.status === 'ok' && W === head.content) continue;
        if (idx.status === 'ok' && W === idx.content) add(t, 'warning', `${rel} is staged but not committed`, 'commit it');
        else add(t, 'warning', `${rel} has uncommitted changes`, `git add ${rel} and commit`);
      }
      if (out.length === before) add(t, 'ok', 'wiring and hook scripts are committed');
    }
    return out;
  },
};
