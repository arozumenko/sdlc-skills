import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { finding } from '../finding.mjs';

// Where init copies skills, per target (`<target dir>/skills/<id>`, a straight copy for every target).
const SKILL_DIRS = { claude: '.claude/skills', cursor: '.cursor/skills', windsurf: '.windsurf/skills', copilot: '.github/skills', codex: '.codex/skills' };

export function skillSources(pkgRoot) {
  const map = new Map();
  const add = (id, dir) => { if (!map.has(id)) map.set(id, []); map.get(id).push(dir); };
  const top = join(pkgRoot, 'skills');
  if (existsSync(top)) for (const id of readdirSync(top)) if (lstatSync(join(top, id)).isDirectory()) add(id, join(top, id));
  const bundles = join(pkgRoot, 'bundles');
  if (existsSync(bundles)) for (const b of readdirSync(bundles)) { const s = join(bundles, b, 'skills'); if (existsSync(s)) for (const id of readdirSync(s)) if (lstatSync(join(s, id)).isDirectory()) add(id, join(s, id)); }
  return map;
}

export function externalSkillIds(pkgRoot) {
  try { return new Set((JSON.parse(readFileSync(join(pkgRoot, 'skills.json'), 'utf8')).skills || []).filter((s) => s.repo).map((s) => s.id)); } catch { return new Set(); }
}

function pkgFiles(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...pkgFiles(join(dir, e.name), `${prefix}${e.name}/`));
    else if (e.isFile()) out.push(`${prefix}${e.name}`);
  }
  return out;
}

export const driftCheck = {
  name: 'drift',
  run(ctx) {
    const out = [];
    const sources = skillSources(ctx.pkgRoot), externals = externalSkillIds(ctx.pkgRoot);
    for (const t of (ctx.detected || []).filter((x) => x.evidence && SKILL_DIRS[x.target])) {
      const base = SKILL_DIRS[t.target];
      const listing = ctx.fs.list(base);
      if (listing.status !== 'ok') continue;
      let same = 0;
      for (const e of listing.entries) {
        const id = e.name;
        if (e.type === 'symlink') { out.push(finding({ check: 'drift', target: t.target, severity: 'skipped', message: `${id}: not compared: symlinked skill` })); continue; }
        if (e.type !== 'dir') continue;
        if (externals.has(id)) { out.push(finding({ check: 'drift', target: t.target, severity: 'skipped', message: `${id}: not compared: external skill` })); continue; }
        const src = sources.get(id) || [];
        if (src.length !== 1) { out.push(finding({ check: 'drift', target: t.target, severity: 'skipped', message: `${id}: not compared: ${src.length ? `ambiguous origin (${src.length} package copies)` : 'not in this package'}` })); continue; }
        const differing = [];
        for (const rel of pkgFiles(src[0])) {
          const mine = ctx.fs.read(`${base}/${id}/${rel}`);
          if (mine.status !== 'ok' || !mine.content.equals(readFileSync(join(src[0], rel)))) differing.push(rel);
        }
        if (differing.length) out.push(finding({ check: 'drift', target: t.target, severity: 'warning', message: `${id}: differs from the running package: ${differing.length} file${differing.length === 1 ? '' : 's'}`, fix: 'npx github:arozumenko/sdlc-skills init <your usual flags> --update (overwrites local edits)', data: { files: differing } }));
        else same++;
      }
      if (same) out.push(finding({ check: 'drift', target: t.target, severity: 'ok', message: `${same} skill${same === 1 ? '' : 's'} match the running package` }));
      out.push(finding({ check: 'drift', target: t.target, severity: 'skipped', message: 'not compared in this version: agents (rewritten by overlays), settings, generated roster, seeds, briefings, instruction blocks' }));
    }
    return out;
  },
};
