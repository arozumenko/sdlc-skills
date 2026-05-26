#!/usr/bin/env node
// Validate every bundles/<id>/bundle.json against the repo. Run in CI and
// before publishing. Checks, per bundle:
//   - directory name matches manifest `id`
//   - a README.md exists (the team's front-door doc)
//   - `agents` is a non-empty array and every entry exists under agents/
//   - every `briefings` role is in `agents` and its file exists
//   - every `skills` id resolves in skills.json (or a monorepo skills/ dir)
//   - `instructions` (if set) points at an existing file
//   - `hooks` (if set) points at a file that parses as JSON
//   - every `localAgents` entry has agents/<name>/AGENT.md in the bundle dir
// Exits non-zero with a per-error report when anything fails.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    const declaredAgents = Array.isArray(b.agents) ? b.agents : [];
    if (b.agents !== undefined && !Array.isArray(b.agents)) {
      err(id, "`agents` must be an array");
    } else if (declaredAgents.length === 0 && !hasLocal) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of declaredAgents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }

    for (const [role, rel] of Object.entries(b.briefings || {})) {
      if (!Array.isArray(b.agents) || !b.agents.includes(role))
        err(id, `briefing role "${role}" not in agents[]`);
      if (!existsSync(join(dir, rel))) err(id, `briefing file missing: ${rel}`);
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

    for (const la of b.localAgents || [])
      if (!existsSync(join(dir, "agents", la, "AGENT.md")))
        err(id, `localAgent "${la}" missing agents/${la}/AGENT.md`);

    for (const src of Object.keys(b.seed || {}))
      if (!existsSync(join(dir, src))) err(id, `seed source missing: ${src}`);

    for (const [role, ov] of Object.entries(b.skillOverlays || {})) {
      if (!Array.isArray(b.agents) || !b.agents.includes(role))
        err(id, `skillOverlay role "${role}" not in agents[]`);
      for (const s of (ov && ov.add) || [])
        if (!skillIds.has(s))
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
