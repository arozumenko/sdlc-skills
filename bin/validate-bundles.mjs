#!/usr/bin/env node
// Validate every bundles/<id>/bundle.json against the repo. Run in CI and
// before publishing. Checks, per bundle:
//   - directory name matches manifest `id`
//   - a README.md exists (the team's front-door doc, human/LLM-readable)
//   - a BUNDLE.md exists with non-empty name/description/owner frontmatter
//     (the structured catalog descriptor)
//   - `agents` is a non-empty array and every entry exists under agents/
//   - every `briefings` role is in `agents` and its file exists
//   - every `skills` id resolves in skills.json (or a monorepo skills/ dir)
//   - `instructions` (if set) points at an existing file
//   - `hooks` (if set) points at a file that parses as JSON
//   - every `localAgents` entry has agents/<name>/AGENT.md in the bundle dir
//   - every `localSkills` entry has skills/<name>/SKILL.md in the bundle dir
// Exits non-zero with a per-error report when anything fails.

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Parse the YAML frontmatter of a BUNDLE.md into a flat key→value map.
// Only the simple `key: value` lines we care about — no full YAML needed.
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function dirsWith(parent, marker) {
  const root = join(PKG_ROOT, parent);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(
    (d) =>
      !d.startsWith(".") &&
      statSync(join(root, d)).isDirectory() &&
      (marker ? existsSync(join(root, d, marker)) : true)
  );
}

function loadSkillIds() {
  const ids = new Set(dirsWith("skills")); // monorepo skill dirs
  const registryPath = join(PKG_ROOT, "skills.json");
  if (existsSync(registryPath)) {
    try {
      const reg = JSON.parse(readFileSync(registryPath, "utf8"));
      for (const s of reg.skills || []) ids.add(s.id);
    } catch (err) {
      console.error(`! skills.json failed to parse: ${err.message}`);
      process.exitCode = 1;
    }
  }
  return ids;
}

function main() {
  const bundlesRoot = join(PKG_ROOT, "bundles");
  if (!existsSync(bundlesRoot)) {
    console.log("No bundles/ directory — nothing to validate.");
    return;
  }
  const agents = new Set(dirsWith("agents", "AGENT.md"));
  const skillIds = loadSkillIds();
  const bundleDirs = readdirSync(bundlesRoot).filter((d) =>
    existsSync(join(bundlesRoot, d, "bundle.json"))
  );

  if (bundleDirs.length === 0) {
    console.log("No bundles found.");
    return;
  }

  let errorCount = 0;
  const err = (id, msg) => {
    console.error(`  ✗ ${id}: ${msg}`);
    errorCount++;
  };

  for (const id of bundleDirs.sort()) {
    const dir = join(bundlesRoot, id);
    const before = errorCount;
    let b;
    try {
      b = JSON.parse(readFileSync(join(dir, "bundle.json"), "utf8"));
    } catch (e) {
      err(id, `bundle.json failed to parse: ${e.message}`);
      continue;
    }

    if (b.id !== id) err(id, `manifest id "${b.id}" != directory name "${id}"`);
    if (!existsSync(join(dir, "README.md"))) err(id, "missing README.md");

    const bundleMd = join(dir, "BUNDLE.md");
    if (!existsSync(bundleMd)) {
      err(id, "missing BUNDLE.md (catalog descriptor)");
    } else {
      const fm = parseFrontmatter(readFileSync(bundleMd, "utf8"));
      if (!fm) err(id, "BUNDLE.md has no YAML frontmatter");
      else
        for (const k of ["name", "description", "owner"])
          if (!fm[k]) err(id, `BUNDLE.md frontmatter missing "${k}"`);
    }

    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    const declaredAgents = Array.isArray(b.agents) ? b.agents : [];
    if (b.agents !== undefined && !Array.isArray(b.agents)) {
      err(id, "`agents` must be an array");
    } else if (declaredAgents.length === 0 && !hasLocal) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of declaredAgents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }

    // A briefing/overlay role may target any installed agent — shared (agents[])
    // or bundle-local (localAgents[]). Build the combined roster once.
    const roster = new Set([
      ...declaredAgents,
      ...(Array.isArray(b.localAgents) ? b.localAgents : []),
    ]);

    for (const [role, rel] of Object.entries(b.briefings || {})) {
      if (!roster.has(role))
        err(id, `briefing role "${role}" not in agents[] or localAgents[]`);
      if (!existsSync(join(dir, rel))) err(id, `briefing file missing: ${rel}`);
    }

    // Per-bundle skill universe = global catalog + this bundle's localSkills.
    // `b.skills` (team-wide extras) is global-only by spec; overlay adds may
    // reference a localSkill.
    const localSkills = Array.isArray(b.localSkills) ? b.localSkills : [];
    if (b.localSkills !== undefined && !Array.isArray(b.localSkills))
      err(id, "`localSkills` must be an array");
    for (const ls of localSkills) {
      const sp = join(dir, "skills", ls);
      if (!existsSync(join(sp, "SKILL.md")))
        err(id, `localSkill "${ls}" missing skills/${ls}/SKILL.md`);
      if (existsSync(sp) && lstatSync(sp).isSymbolicLink())
        err(id, `skill "${ls}" must be a real directory, not a symlink`);
    }
    const effectiveSkillIds = new Set([...skillIds, ...localSkills]);

    // feature-development-style bundles: flat devRoles + platform overlays.
    if (b.coreAgents !== undefined) {
      if (!Array.isArray(b.coreAgents)) err(id, "`coreAgents` must be an array");
      else for (const a of b.coreAgents) {
        roster.add(a);
        if (!(b.localAgents || []).includes(a)) err(id, `coreAgent "${a}" not in localAgents`);
      }
    }
    if (b.devRoles !== undefined) {
      if (typeof b.devRoles !== "object" || Array.isArray(b.devRoles)) {
        err(id, "`devRoles` must be an object");
      } else {
        for (const [r, def] of Object.entries(b.devRoles)) {
          roster.add(r);
          if (!(b.localAgents || []).includes(r)) err(id, `devRole "${r}" not in localAgents`);
          if (!def || !def.platform) err(id, `devRole "${r}" missing platform`);
          else if (!b.platforms || !b.platforms[def.platform])
            err(id, `devRole "${r}" platform "${def && def.platform}" not in platforms`);
          if (def && def.briefing && !existsSync(join(dir, def.briefing)))
            err(id, `devRole "${r}" briefing missing: ${def.briefing}`);
          for (const s of (def && def.skillOverlay && def.skillOverlay.add) || [])
            if (!effectiveSkillIds.has(s))
              console.warn(`  • ${id}: devRole "${r}" skillOverlay add "${s}" not in catalog yet (pending content)`);
        }
      }
    }
    for (const [pid, pdef] of Object.entries(b.platforms || {})) {
      for (const [role, rel] of Object.entries((pdef && pdef.briefings) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" briefing role "${role}" not in roster`);
        if (!existsSync(join(dir, rel))) err(id, `platform "${pid}" briefing file missing: ${rel}`);
      }
      for (const [role, ov] of Object.entries((pdef && pdef.skillOverlays) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" skillOverlay role "${role}" not in roster`);
        for (const s of (ov && ov.add) || [])
          if (!effectiveSkillIds.has(s))
            console.warn(`  • ${id}: platform "${pid}" skillOverlay add "${s}" not in catalog yet (pending content)`);
      }
    }

    for (const s of b.skills || [])
      if (!skillIds.has(s)) err(id, `skill "${s}" not in skills.json or skills/`);

    if (b.instructions && !existsSync(join(dir, b.instructions)))
      err(id, `instructions file missing: ${b.instructions}`);

    if (b.hooks) {
      const hp = join(dir, b.hooks);
      if (!existsSync(hp)) err(id, `hooks file missing: ${b.hooks}`);
      else {
        try {
          JSON.parse(readFileSync(hp, "utf8"));
        } catch (e) {
          err(id, `hooks file failed to parse: ${e.message}`);
        }
      }
    }

    for (const la of b.localAgents || []) {
      const ap = join(dir, "agents", la);
      if (!existsSync(join(ap, "AGENT.md")))
        err(id, `localAgent "${la}" missing agents/${la}/AGENT.md`);
      if (existsSync(ap) && lstatSync(ap).isSymbolicLink())
        err(id, `agent "${la}" must be a real directory, not a symlink`);
    }

    for (const src of Object.keys(b.seed || {}))
      if (!existsSync(join(dir, src))) err(id, `seed source missing: ${src}`);

    for (const [role, ov] of Object.entries(b.skillOverlays || {})) {
      if (!roster.has(role))
        err(id, `skillOverlay role "${role}" not in agents[] or localAgents[]`);
      for (const s of (ov && ov.add) || [])
        if (!effectiveSkillIds.has(s))
          console.warn(`  • ${id}: skillOverlay add "${s}" not in catalog yet (pending content)`);
    }

    if (errorCount === before) {
      const n = (b.agents || []).length + (b.localAgents || []).length;
      console.log(`  ✓ ${id} (${n} agents)`);
    }
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s) across ${bundleDirs.length} bundle(s).`);
    process.exit(1);
  }
  console.log(`\nAll ${bundleDirs.length} bundle(s) valid.`);
}

main();
