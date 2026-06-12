#!/usr/bin/env node
/**
 * sdlc-skills installer.
 *
 * Three ways to consume this repo:
 *
 *   1. Claude Code plugin marketplace (preferred inside Claude Code):
 *        /plugin marketplace add arozumenko/sdlc-skills
 *        /plugin install sdlc-skills@sdlc-skills
 *
 *   2. This CLI (works for Claude Code, Cursor, Windsurf, GitHub Copilot,
 *      Codex — installs agents and skills in each host's native form:
 *      directories (Claude/Cursor/Windsurf), flat .agent.md (Copilot), or
 *      .codex/agents/<name>.toml (Codex)):
 *        npx github:arozumenko/sdlc-skills init
 *        npx github:arozumenko/sdlc-skills init --all
 *        npx github:arozumenko/sdlc-skills init --agents ba,tech-lead,pm
 *        npx github:arozumenko/sdlc-skills init --skills bugfix-workflow,code-review
 *        npx github:arozumenko/sdlc-skills init --agents all --skills all
 *        npx github:arozumenko/sdlc-skills init --update   # overwrite existing
 *        npx github:arozumenko/sdlc-skills init --target claude
 *
 *      GitHub Copilot CLI target (--target copilot) flattens agents to
 *      `.github/agents/<name>.agent.md` (not a directory) with SOUL.md
 *      appended as a `## Persona` section, and rewrites `model: sonnet`
 *      → `model: Claude Sonnet 4.6` (Copilot's picker display name). The
 *      Codex target assigns each role a concrete Codex (GPT) model by name.
 *      Other targets keep the directory layout and the authored model.
 *
 *      To repair an already-directory-installed project for Copilot:
 *        npx github:arozumenko/sdlc-skills init fix-copilot
 *        npx github:arozumenko/sdlc-skills init fix-copilot --soul keep
 *        npx github:arozumenko/sdlc-skills init fix-copilot --dry-run
 *        npx github:arozumenko/sdlc-skills init fix-copilot --help
 *
 *   3. agentskills.io / Vercel / any third-party tool: point directly at
 *      skills/<name>/SKILL.md — the agentskills.io spec frontmatter is
 *      authoritative at that path.
 *
 * This installer only covers modes 1 and 2. The plugin marketplace path
 * is handled natively by Claude Code and does not invoke this script.
 *
 * Every CLI install also wires the core hooks/ scripts (per-role memory +
 * lean .agents/*.md project-context injection) into each target's native hook
 * config — Claude .claude/settings.json, Cursor .cursor/hooks.json, Copilot
 * .github/hooks/sdlc-skills.json. See installCoreHooks() and hooks/README.md.
 */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, dirname, basename, resolve } from "path";
import { fileURLToPath } from "url";
import {
  resolveSelection as resolveDevRoleSelection,
  buildOverlays,
  buildBriefingPlan,
  composeBriefing,
  briefingDescription,
} from "./lib/bundle-selection.mjs";
import { buildItemIndex, resolveItem, catalogIds, itemKnown } from "./lib/item-resolver.mjs";
import { execSync } from "child_process";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CWD = process.cwd();

const TARGETS = [
  { id: "claude", dir: ".claude", label: "Claude Code" },
  { id: "cursor", dir: ".cursor", label: "Cursor" },
  { id: "windsurf", dir: ".windsurf", label: "Windsurf" },
  { id: "copilot", dir: ".github", label: "GitHub Copilot" },
  { id: "codex", dir: ".codex", label: "Codex" },
];

// GitHub Copilot's model picker lists Claude models by display name
// ("Claude Sonnet 4.6"), not by a dashed provider id. Copilot agent frontmatter
// must match that display name, so the Copilot flatten path maps each authored
// `model:` alias through this table.
const COPILOT_MODEL_NAMES = {
  sonnet: "Claude Sonnet 4.6",
  opus: "Claude Opus 4.7",
  haiku: "Claude Haiku 4.5",
};

// Codex is an OpenAI host, so a Claude model (alias or dashed id) is unusable
// there. The Codex flatten path ignores the authored `model:` tier and assigns
// each role a concrete Codex (GPT) model BY NAME; any role not listed gets the
// lightweight default. Tune here when the roster or the Codex lineup changes.
const CODEX_MODELS = {
  scout: "gpt-5.5",
  "test-automation-lead": "gpt-5.4",
  "project-manager": "gpt-5.4",
  "test-run-lead": "gpt-5.4",
};
const CODEX_MODEL_DEFAULT = "gpt-5.4-mini";

// ---------------------------------------------------------------------------
// Catalog discovery — read the agents/ and skills/ dirs at the repo root so
// the installer stays correct as content is added or removed. No hardcoded
// lists.
// ---------------------------------------------------------------------------

function listDirs(parent) {
  const root = join(PKG_ROOT, parent);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && name !== "README.md")
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

// Recursively copy a tree into the user's project, dereferencing every
// symlink (top-level AND nested). Node's `cpSync({ dereference: true })`
// only follows the source root if it's a symlink — internal symlinks get
// converted to absolute-path links into the source location, which is fatal
// for our installer because the source lives in the npx cache or this
// repo (neither exists on the user's machine after install). Upstream
// content sometimes ships intra-skill symlinks (e.g. twostraws' Swift skills
// have a `skills/<name>/references → ../../references` symlink to satisfy
// multiple plugin layouts) — those need to be materialized.
function copyTreeDereferenced(src, dest, { force = false } = {}) {
  // Resolve any top-level symlink to its real target.
  let stat;
  try { stat = lstatSync(src); } catch { return; }
  if (stat.isSymbolicLink()) {
    return copyTreeDereferenced(realpathSync(src), dest, { force });
  }
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyTreeDereferenced(join(src, entry), join(dest, entry), { force });
    }
    return;
  }
  if (stat.isFile()) {
    if (force || !existsSync(dest)) copyFileSync(src, dest);
    return;
  }
  // Sockets, fifos, etc. — skip silently (none expected in skill/agent content).
}

function loadCatalog() {
  const index = buildItemIndex(PKG_ROOT);
  return {
    agents: catalogIds(index, "agents"),
    skills: catalogIds(index, "skills"),
    registry: loadSkillRegistry(),
    index,
  };
}

// ---------------------------------------------------------------------------
// Bundles — bundles/<id>/bundle.json describes a curated team: which shared
// agents to install, any team-wide extra skills, per-role briefing overlays,
// team instructions, and hooks. See bundles/SPEC.md. A bundle expands into
// the normal agent/skill install path: its `agents` populate the agent
// selection (so each agent's declared skills auto-resolve as usual) and its
// `skills` are appended as extras. `localAgents` live in bundles/<id>/agents/
// and install like shared agents but from the bundle dir. `localSkills` live
// in bundles/<id>/skills/ and install like monorepo skills but from the
// bundle dir — they don't need a skills.json entry and are scoped to the
// bundle (an agent in another team that declares the same id would resolve
// it against the global catalog, not this bundle's copy).
// ---------------------------------------------------------------------------

function listBundles() {
  const root = join(PKG_ROOT, "bundles");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, "bundle.json")))
    .sort();
}

function loadBundle(id) {
  const dir = join(PKG_ROOT, "bundles", id);
  const manifest = join(dir, "bundle.json");
  if (!existsSync(manifest)) {
    console.error(`  ! Unknown bundle: ${id}`);
    console.error(`    Available bundles: ${listBundles().join(", ") || "(none)"}`);
    process.exit(1);
  }
  let b;
  try {
    b = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (err) {
    console.error(`  ! Failed to parse bundles/${id}/bundle.json: ${err.message}`);
    process.exit(1);
  }
  b.dir = dir;
  b.agents = b.agents || [];
  b.skills = b.skills || [];
  b.localAgents = b.localAgents || [];
  b.localSkills = b.localSkills || [];
  b.briefings = b.briefings || {};
  b.skillOverlays = b.skillOverlays || {}; // role -> { add: [], remove: [] }
  b.seed = b.seed || {}; // bundle-relative source → project-relative dest (reference files)
  b.coreAgents = b.coreAgents || null; // present => devRole selection path
  b.devRoles = b.devRoles || null;     // { name: { label, platform, briefing?, skillOverlay? } }
  b.platforms = b.platforms || {};     // { id: { label, briefings{}, skillOverlays{} } }
  return b;
}

// Parse the `description` field out of a SKILL.md's YAML frontmatter. Used to
// register bundle-local skills into the in-memory catalog so non-Claude
// targets get a proper description in their injected SKILLS section.
function parseSkillDescription(skillMdPath) {
  if (!existsSync(skillMdPath)) return null;
  let text;
  try {
    text = readFileSync(skillMdPath, "utf8");
  } catch {
    return null;
  }
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return null;
  const m = fm[1].match(/^description:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

// Validate a bundle against the catalog and resolve the skills its local
// agents declare. Returns { localAgents, extraSkillIds } and mutates
// args.agents to include the bundle's shared agents.
async function applyBundle(bundle, args, catalog) {
  // ----- Flat dev-role selection (feature-development-style bundles) -----
  // When the manifest declares devRoles, the install roster is
  // coreAgents ∪ (picked dev roles). Selection is a flat, unrestricted
  // multi-select; the picked roles' platforms drive the core-role overlays.
  if (bundle.devRoles) {
    const devRoleNames = Object.keys(bundle.devRoles);
    const sel = resolveDevRoleSelection({
      explicit: args.agents,
      devRoleNames,
      yes: args.yes,
      isTTY: process.stdin.isTTY,
    });
    // Core roles always install, so naming one in --agents is harmless — only
    // warn about names that match neither a dev role nor a core role.
    const coreSet = new Set(bundle.coreAgents || []);
    const unknown = sel.unknown.filter((n) => !coreSet.has(n));
    if (unknown.length) {
      console.error(`  ! --agents names not recognized for ${bundle.id}: ${unknown.join(", ")}`);
    }
    if (sel.unknown.length !== unknown.length) {
      console.log("  (core roles always install — no need to name them in --agents)");
    }
    let selected;
    if (sel.mode === "picker") {
      selected = await selectMany(
        "Developer roles — pick any combination (space toggles, enter confirms):",
        devRoleNames.map((r) => ({ value: r, label: r, desc: bundle.devRoles[r].label, default: true }))
      );
    } else {
      selected = sel.roles;
    }
    // Dev roles install ONLY as bundle-local agents — clear them from the global
    // --agents path so they aren't also resolved against the global catalog. For
    // a devRoles bundle bundle.agents is [], so the legacy union below is a no-op.
    args.agents = [...bundle.agents];
    // Restrict the installed roster and pre-merge the overlays/briefings.
    bundle.localAgents = [...new Set([...(bundle.coreAgents || []), ...selected])];
    bundle.skillOverlays = buildOverlays(bundle, selected);
    const bplan = buildBriefingPlan(bundle, selected);
    bundle._resolvedBriefings = {};
    for (const [role, entries] of Object.entries(bplan)) {
      const resolved = entries.map((e) => ({
        label: e.label,
        content: readFileSync(join(bundle.dir, e.path), "utf8"),
      }));
      bundle._resolvedBriefings[role] = {
        content: composeBriefing(resolved),
        description: briefingDescription(resolved),
      };
    }
    console.log(
      `  Roster: ${bundle.coreAgents.length} core + ${selected.length} dev role(s)` +
        (selected.length ? ` (${selected.join(", ")})` : " (none selected)")
    );
  }

  const unknownShared = bundle.agents.filter((a) => !catalog.agents.includes(a));
  if (unknownShared.length) {
    console.error(
      `  ! Bundle ${bundle.id} references unknown agents: ${unknownShared.join(", ")}`
    );
    console.error(`    Available agents: ${catalog.agents.join(", ")}`);
    process.exit(1);
  }
  const bundleAgentsRoot = join(bundle.dir, "agents");
  for (const la of bundle.localAgents) {
    if (!existsSync(join(bundleAgentsRoot, la, "AGENT.md"))) {
      console.error(
        `  ! Bundle ${bundle.id} declares localAgent "${la}" but bundles/${bundle.id}/agents/${la}/AGENT.md is missing`
      );
      process.exit(1);
    }
  }

  // localSkills are the capability twin of localAgents: skill content shipped
  // inside the bundle dir, not the global catalog. They install like monorepo
  // skills but from bundles/<id>/skills/. Register each into the in-memory
  // catalog so (a) the unknown-id partition doesn't reject them and (b)
  // injected SKILLS sections pick up a real description.
  const bundleSkillsRoot = join(bundle.dir, "skills");
  for (const ls of bundle.localSkills) {
    const skillMd = join(bundleSkillsRoot, ls, "SKILL.md");
    if (!existsSync(skillMd)) {
      console.error(
        `  ! Bundle ${bundle.id} declares localSkill "${ls}" but bundles/${bundle.id}/skills/${ls}/SKILL.md is missing`
      );
      process.exit(1);
    }
    if (!registryEntry(catalog.registry, ls)) {
      catalog.registry.skills.push({
        id: ls,
        bundle: bundle.id,
        name: ls,
        description: parseSkillDescription(skillMd) || `Bundle-local skill (${bundle.id})`,
      });
    }
  }
  const localSkillSet = new Set(bundle.localSkills);

  // Shared agents from the bundle join any explicit --agents selection.
  const explicit = args.agents || [];
  args.agents = [...new Set([...explicit, ...bundle.agents])];

  // Skills declared by local agents are resolved from the bundle dir (their
  // AGENT.md lives there, not in the monorepo agents/).
  const localDeclared = new Set();
  for (const la of bundle.localAgents) {
    for (const s of parseAgentSkillDeps(la, bundleAgentsRoot)) localDeclared.add(s);
  }

  // ----- Per-role skill overlays (the capability twin of briefings) -----
  // A bundle tunes a shared agent's *skills* for its stack at setup:
  //   skillOverlays: { qa-engineer: { add: ["xcuitest"], remove: ["playwright-testing"] } }
  // The shared agent stays unforked — we rewrite only the installed copy's
  // `skills:` frontmatter (done in main, per target). Here we compute the
  // effective skill set so the install resolves the right union: removed
  // skills no agent still needs are dropped; added skills that resolve are
  // installed; added skills that don't exist yet are surfaced as "pending".
  const overlays = bundle.skillOverlays;
  // Overlays may target a shared agent (in args.agents) OR a bundle-local one
  // (via the symlink pattern, the same role can be in localAgents). Build the
  // combined roster once and validate/iterate against it.
  const combinedRoster = [...new Set([...args.agents, ...bundle.localAgents])];
  for (const role of Object.keys(overlays)) {
    if (!combinedRoster.includes(role)) {
      console.error(`  ! Bundle ${bundle.id} skillOverlay targets "${role}", not in the team`);
      process.exit(1);
    }
  }
  const declaredOf = (a) => {
    // Bundle owns its agents — read declared skills from THIS bundle's copy
    // when present, else resolve the agent's real location (orphan or another
    // bundle). Top-level `agents/` no longer holds bundle agents.
    if (existsSync(join(bundleAgentsRoot, a, "AGENT.md")))
      return parseAgentSkillDeps(a, bundleAgentsRoot);
    const r = resolveItem(catalog.index, "agents", a);
    return r ? parseAgentSkillDeps(r.name, join(r.dir, "agents")) : [];
  };
  const isResolvable = (id) => {
    const e = registryEntry(catalog.registry, id);
    return catalog.skills.includes(id) || !!(e && e.repo);
  };
  const effectiveByAgent = {};
  const neededByAny = new Set();
  const allDeclared = new Set();
  const resolvableAdds = new Set();
  const pendingAdds = new Set();
  for (const a of combinedRoster) {
    const declared = declaredOf(a);
    declared.forEach((s) => allDeclared.add(s));
    const ov = overlays[a] || {};
    const removeSet = new Set(ov.remove || []);
    const eff = declared.filter((s) => !removeSet.has(s));
    for (const s of ov.add || []) {
      if (isResolvable(s)) {
        if (!eff.includes(s)) eff.push(s);
        resolvableAdds.add(s);
      } else {
        pendingAdds.add(s);
      }
    }
    effectiveByAgent[a] = eff;
    eff.forEach((s) => neededByAny.add(s));
  }
  // Skills that were declared somewhere but, after overlays, no agent needs.
  const droppable = new Set([...allDeclared].filter((s) => !neededByAny.has(s)));

  // Skills satisfied by localSkills install from the bundle dir, not from the
  // global catalog — strip them before partitioning so they aren't flagged as
  // unknown. The dedicated localSkills install loop in main() handles copying.
  const extraSkillIds = [...new Set([...bundle.skills, ...localDeclared, ...resolvableAdds])]
    .filter((id) => !localSkillSet.has(id));

  console.log(
    `  Bundle: ${bundle.title || bundle.id} — ${bundle.agents.length} shared agent(s)` +
      (bundle.localAgents.length ? `, ${bundle.localAgents.length} local agent(s)` : "") +
      (bundle.localSkills.length ? `, ${bundle.localSkills.length} local skill(s)` : "") +
      (Object.keys(overlays).length ? `, ${Object.keys(overlays).length} skill overlay(s)` : "") +
      (extraSkillIds.length ? `, ${extraSkillIds.length} extra skill(s)` : "")
  );

  return {
    localAgents: bundle.localAgents,
    bundleAgentsRoot,
    localSkills: bundle.localSkills,
    bundleSkillsRoot,
    extraSkillIds,
    overlays,
    effectiveByAgent,
    droppable,
    pendingAdds: [...pendingAdds],
  };
}

// Seed per-role briefing overlays into .agents/memory/<role>/project_briefing.md
// (IDE-neutral — every agent reads .agents/, regardless of host). This is the
// same slot scout fills at runtime, so an existing briefing is left in place
// unless --update (scout's project-specific version wins over the bundle's
// stack defaults). Each install also ensures a MEMORY.md index line.
function installBriefings(bundle, update) {
  let installed = 0;
  let skipped = 0;
  // Resolved entries: [{ role, content, description }]. New bundles pre-resolve
  // (merged/concatenated) in applyBundle; legacy bundles read role→path here.
  let entries;
  if (bundle._resolvedBriefings) {
    entries = Object.entries(bundle._resolvedBriefings).map(([role, v]) => ({ role, ...v }));
  } else {
    entries = [];
    for (const [role, rel] of Object.entries(bundle.briefings)) {
      const src = join(bundle.dir, rel);
      if (!existsSync(src)) {
        console.log(`      ! briefing ${role} (missing in bundle: ${rel})`);
        continue;
      }
      const content = readFileSync(src, "utf8");
      const dm = content.match(/^description:\s*(.+)$/m);
      entries.push({ role, content, description: dm ? dm[1].trim() : "Project overview and this role's focus" });
    }
  }
  for (const { role, content, description } of entries) {
    const destDir = join(CWD, ".agents", "memory", role);
    const dest = join(destDir, "project_briefing.md");
    if (existsSync(dest) && !update) {
      console.log(`      — briefing ${role} (exists; use --update)`);
      skipped++;
      continue;
    }
    mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, content);
    ensureMemoryIndexLine(destDir, role, description);
    console.log(`      ✓ briefing ${role}`);
    installed++;
  }
  return { installed, skipped };
}

// Seed loose reference files/dirs a bundle ships into the project at a fixed
// path. bundle.seed maps a bundle-relative source → a project-relative dest.
// Copied once (IDE-neutral, like briefings); idempotent — an existing dest is
// left intact unless --update. On --update the dest is removed first (clean
// replace), so files deleted from the bundle don't linger. Used for reference
// docs agents read at runtime: a subagent's cwd is the project root, so a
// fixed project path is resolvable.
function installSeed(bundle, update) {
  let installed = 0;
  let skipped = 0;
  for (const [src, dest] of Object.entries(bundle.seed || {})) {
    const srcPath = join(bundle.dir, src);
    if (!existsSync(srcPath)) {
      console.log(`      ! seed ${src} (missing in bundle)`);
      continue;
    }
    const destPath = join(CWD, dest);
    if (existsSync(destPath) && !update) {
      console.log(`      — seed ${dest} (exists; use --update)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(destPath), { recursive: true });
    if (update && existsSync(destPath)) rmSync(destPath, { recursive: true, force: true });
    copyTreeDereferenced(srcPath, destPath, { force: true });
    console.log(`      ✓ seed ${dest}`);
    installed++;
  }
  return { installed, skipped };
}

// Splice a bundle's instructions.md into the project's root context files
// inside <!-- BUNDLE:<id> START/END --> markers. The block is replaced in
// place on re-run (idempotent) — no --update needed. AGENTS.md (the full
// team reference every agent reads) is created if missing; CLAUDE.md is
// auto-loaded and scout-owned, so its block is only refreshed when the file
// already exists — we never create or bloat a lean CLAUDE.md.
function installInstructions(bundle) {
  if (!bundle.instructions) return;
  const src = join(bundle.dir, bundle.instructions);
  if (!existsSync(src)) {
    console.log(`      ! instructions (missing in bundle: ${bundle.instructions})`);
    return;
  }
  const body = readFileSync(src, "utf8");
  for (const [file, createIfMissing] of [["AGENTS.md", true], ["CLAUDE.md", false]]) {
    const status = spliceBundleBlock(join(CWD, file), bundle.id, body, createIfMissing);
    if (status === "absent") console.log(`      — instructions ${file} (not present; skipped)`);
    else console.log(`      ✓ instructions ${file} (${status})`);
  }
}

function spliceBundleBlock(filePath, id, body, createIfMissing) {
  const start = `<!-- BUNDLE:${id} START -->`;
  const end = `<!-- BUNDLE:${id} END -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  if (!existsSync(filePath)) {
    if (!createIfMissing) return "absent";
    const title = basename(filePath, ".md");
    writeFileSync(filePath, `# ${title}\n\n${block}\n`);
    return "created";
  }
  const text = readFileSync(filePath, "utf8");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc(start)}[\\s\\S]*?${esc(end)}`);
  if (re.test(text)) {
    const updated = text.replace(re, block);
    if (updated !== text) writeFileSync(filePath, updated);
    return "refreshed";
  }
  writeFileSync(filePath, text.replace(/\n*$/, "\n\n") + block + "\n");
  return "appended";
}

// Merge a bundle's hooks into each Claude target's settings.json. v1 is
// Claude-only — Cursor/Windsurf/Copilot hook formats differ, so they're
// skipped with a notice. hooks.json is a Claude hooks object (event →
// matcher-groups); the installer tags each injected group with `_bundle`
// so a re-merge replaces exactly the bundle's groups (idempotent) while
// leaving the user's and other bundles' hooks untouched. Scripts under
// hooks/scripts/ are copied to <target>/hooks/<bundle-id>/ and chmod +x.
function installHooks(bundle, targets) {
  if (!bundle.hooks) return;
  const hooksPath = join(bundle.dir, bundle.hooks);
  if (!existsSync(hooksPath)) {
    console.log(`      ! hooks (missing in bundle: ${bundle.hooks})`);
    return;
  }
  let hookSpec;
  try {
    hookSpec = JSON.parse(readFileSync(hooksPath, "utf8"));
  } catch (err) {
    console.log(`      ! hooks (parse failed: ${err.message})`);
    return;
  }
  const wanted = bundle.targets && bundle.targets.length ? bundle.targets : ["claude"];
  const scriptsSrc = join(dirname(hooksPath), "scripts");
  for (const t of targets) {
    if (t.id !== "claude") {
      console.log(`      — hooks ${t.label} (only Claude supported in v1; skipped)`);
      continue;
    }
    if (!wanted.includes("claude")) continue;

    if (existsSync(scriptsSrc)) {
      const scriptsDest = join(CWD, t.dir, "hooks", bundle.id);
      mkdirSync(scriptsDest, { recursive: true });
      copyTreeDereferenced(scriptsSrc, scriptsDest, { force: true });
      for (const f of readdirSync(scriptsDest)) {
        try {
          chmodSync(join(scriptsDest, f), 0o755);
        } catch {
          /* best-effort */
        }
      }
    }

    const ok = mergeClaudeSettingsHooks(
      join(CWD, t.dir, "settings.json"),
      hookSpec,
      bundle.id
    );
    if (ok) console.log(`      ✓ hooks ${t.label} (settings.json)`);
  }
}

function mergeClaudeSettingsHooks(settingsPath, hookSpec, bundleId) {
  let settings = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8");
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      console.log(`      ! ${basename(settingsPath)} parse failed; left untouched: ${err.message}`);
      return false;
    }
    writeFileSync(settingsPath + ".bak", raw); // back up before we touch it
  }
  settings.hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  for (const [event, groups] of Object.entries(hookSpec)) {
    if (!Array.isArray(groups)) continue;
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = existing.filter((g) => !g || g._bundle !== bundleId); // drop our prior groups
    const tagged = groups.map((g) => ({ ...g, _bundle: bundleId }));
    settings.hooks[event] = [...kept, ...tagged];
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

// ---------------------------------------------------------------------------
// Core hooks — the repo-root hooks/ scripts that inject per-role memory and the
// lean .agents/*.md project context at session/subagent start (these replaced
// the old @-imports; see hooks/README.md). Installed on every CLI install, per
// target, in each runtime's native hook format:
//   Claude Code -> .claude/settings.json          (SessionStart + SubagentStart)
//   Cursor      -> .cursor/hooks.json             (sessionStart only — its
//                  subagentStart is permission-only and can't inject context)
//   Copilot CLI -> .github/hooks/sdlc-skills.json (sessionStart + subagentStart)
//   Windsurf    -> skipped (no documented hook API)
// The Claude *plugin* path needs none of this — it auto-discovers
// hooks/hooks.json at the plugin root. Codex/Kiro aren't CLI targets; we point
// at the shipped hooks/hooks-codex.json / hooks-kiro.json templates instead.
// ---------------------------------------------------------------------------

const CORE_HOOK_FILES = ["run-hook.cmd", "session-start", "agent-start", "lib.sh"];
const CORE_HOOK_EXE = ["run-hook.cmd", "session-start", "agent-start"];

// Copy the four hook files into destDir together (they reference each other by
// SCRIPT_DIR-relative path, so they must live side by side) and mark the
// executables +x. Also seed config.sh from config.sh.example — but ONCE: the
// scripts are always refreshed (force), whereas config.sh holds the project's
// tunables (SDLC_SHARED_DOCS etc.) and must survive re-installs, so we copy it
// only when it doesn't already exist. lib.sh sources it if present.
function copyHookScripts(destDir) {
  const srcDir = join(PKG_ROOT, "hooks");
  if (!existsSync(srcDir)) return false;
  mkdirSync(destDir, { recursive: true });
  for (const f of CORE_HOOK_FILES) {
    const s = join(srcDir, f);
    if (existsSync(s)) cpSync(s, join(destDir, f), { force: true });
  }
  for (const f of CORE_HOOK_EXE) {
    try {
      chmodSync(join(destDir, f), 0o755);
    } catch {
      /* best-effort (Windows) */
    }
  }
  const cfgExample = join(srcDir, "config.sh.example");
  const cfgDest = join(destDir, "config.sh");
  if (existsSync(cfgExample) && !existsSync(cfgDest)) cpSync(cfgExample, cfgDest);
  return true;
}

// Merge our entries into a version-1 hooks.json (Cursor / SDK shape),
// replacing only the entries that reference our scripts dir (idempotent) and
// leaving the user's other hooks intact. Backs up before writing.
function mergeVersionedHooks(path, spec, markerSubstr) {
  let cfg = { version: 1, hooks: {} };
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    try {
      cfg = JSON.parse(raw);
    } catch (err) {
      console.log(`      ! ${basename(path)} parse failed; left untouched: ${err.message}`);
      return false;
    }
    writeFileSync(path + ".bak", raw);
    if (!cfg.hooks || typeof cfg.hooks !== "object") cfg.hooks = {};
    if (!cfg.version) cfg.version = 1;
  }
  for (const [event, entries] of Object.entries(spec)) {
    const existing = Array.isArray(cfg.hooks[event]) ? cfg.hooks[event] : [];
    const kept = existing.filter(
      (e) => !(e && typeof e.command === "string" && e.command.includes(markerSubstr))
    );
    cfg.hooks[event] = [...kept, ...entries];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return true;
}

// Codex gates sub-agent dispatch behind [agents] in .codex/config.toml: a CLI
// orchestrator (project-manager, test-automation-lead, test-run-lead) can only
// spawn ICs when max_threads >= 1 and max_depth >= 2 (depth 2 so a main →
// orchestrator → IC chain isn't cut off at the orchestrator). Ensure both —
// create the file/section when absent, raise a value only if it's below the
// minimum, and otherwise leave the user's config untouched. Minimal section-aware
// TOML editing (stdlib only, no parser): comment-safe, preserves other tables,
// idempotent on re-run.
function ensureCodexAgentsConfig(projectDir) {
  const file = join(projectDir, ".codex", "config.toml");
  const existed = existsSync(file);
  const raw = existed ? readFileSync(file, "utf8") : "";
  const lines = raw === "" ? [] : raw.replace(/\n+$/, "").split("\n");

  const isHeader = (l) => /^\s*\[/.test(l); // any [table] / [[array-of-tables]]
  const isAgents = (l) => /^\s*\[agents\]\s*(#.*)?$/.test(l);

  const changes = [];
  let hdr = lines.findIndex(isAgents);
  if (hdr === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push(""); // blank separator
    hdr = lines.length;
    lines.push("[agents]");
    changes.push("[agents]");
  }

  // The table body spans (hdr, end), where end is the next table header or EOF.
  let end = lines.length;
  for (let i = hdr + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) { end = i; break; }
  }

  // Required minimums. max_depth = 2 (not 1) so the orchestrator can dispatch ICs
  // even when it is itself a sub-agent (main → orchestrator → IC).
  const want = { max_threads: 1, max_depth: 2 };
  const insert = [];
  for (const [key, min] of Object.entries(want)) {
    let found = false;
    for (let i = hdr + 1; i < end; i++) {
      const m = lines[i].match(new RegExp(`^\\s*${key}\\s*=\\s*(-?\\d+)`));
      if (m) {
        found = true;
        if (parseInt(m[1], 10) < min) {
          lines[i] = lines[i].replace(/=\s*-?\d+/, `= ${min}`);
          changes.push(`${key}→${min}`);
        }
        break;
      }
    }
    if (!found) { insert.push(`${key} = ${min}`); changes.push(`+${key}`); }
  }
  if (insert.length) lines.splice(hdr + 1, 0, ...insert); // new keys under the header, in order

  if (!changes.length) return { status: "ok" };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join("\n") + "\n");
  return { status: existed ? "extended" : "created" };
}

function installCoreHooks(targets) {
  const srcDir = join(PKG_ROOT, "hooks");
  if (!existsSync(srcDir)) return;

  for (const t of targets) {
    if (t.id === "claude") {
      const rel = ".claude/hooks/sdlc-skills";
      copyHookScripts(join(CWD, rel));
      const cmd = `"\${CLAUDE_PROJECT_DIR}/${rel}/run-hook.cmd"`;
      const spec = {
        SessionStart: [
          {
            matcher: "startup|clear|compact|resume",
            hooks: [{ type: "command", command: `${cmd} session-start`, async: false }],
          },
        ],
        SubagentStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: `${cmd} agent-start`, async: false }],
          },
        ],
      };
      if (mergeClaudeSettingsHooks(join(CWD, ".claude", "settings.json"), spec, "sdlc-core"))
        console.log(`      ✓ hooks Claude Code (.claude/settings.json)`);
    } else if (t.id === "cursor") {
      const rel = ".cursor/hooks/sdlc-skills";
      copyHookScripts(join(CWD, rel));
      // Cursor's subagentStart is permission-only (no context injection) — wire
      // sessionStart only; per-role memory falls back to the `memory` skill.
      const spec = { sessionStart: [{ command: `./${rel}/run-hook.cmd session-start` }] };
      if (mergeVersionedHooks(join(CWD, ".cursor", "hooks.json"), spec, rel))
        console.log(`      ✓ hooks Cursor (.cursor/hooks.json)`);
    } else if (t.id === "copilot") {
      const rel = ".github/hooks/sdlc-skills";
      copyHookScripts(join(CWD, rel));
      // Workspace event casing is event-specific in VS Code (verified live):
      //   - sessionStart fires as camelCase (both CLI and VS Code) → camelCase entry.
      //   - SubagentStart fires as PascalCase in VS Code, but camelCase in the CLI →
      //     ship BOTH. The CLI fires both but consumes only top-level additionalContext
      //     (camelCase/COPILOT_CLI) and ignores the PascalCase entry's hookSpecificOutput,
      //     so no double-injection; VS Code fires only the PascalCase one. Without the
      //     PascalCase SubagentStart, dispatched workers get NO memory in VS Code.
      // Each entry's env flag selects the emit shape in lib.sh (COPILOT_CLI → top-level
      // additionalContext; SDLC_VSCODE → hookSpecificOutput).
      const cli = (verb) => ({
        type: "command",
        bash: `"./${rel}/run-hook.cmd" ${verb}`,
        powershell: `& "./${rel}/run-hook.cmd" ${verb}`,
        env: { COPILOT_CLI: "1" },
        timeoutSec: 10,
      });
      const vscode = (verb) => ({
        type: "command",
        command: `"./${rel}/run-hook.cmd" ${verb}`,
        env: { SDLC_VSCODE: "1" },
        timeout: 10,
      });
      // .github/hooks/<name>.json is an sdlc-owned file — write it wholesale.
      const spec = {
        version: 1,
        hooks: {
          sessionStart: [cli("session-start")],
          subagentStart: [cli("agent-start")],
          SubagentStart: [vscode("agent-start")],
        },
      };
      mkdirSync(join(CWD, ".github", "hooks"), { recursive: true });
      writeFileSync(
        join(CWD, ".github", "hooks", "sdlc-skills.json"),
        JSON.stringify(spec, null, 2) + "\n"
      );
      console.log(`      ✓ hooks GitHub Copilot (.github/hooks/sdlc-skills.json)`);
      // .github/instructions/*.instructions.md is generated/refreshed per machine by
      // the session-start hook. We deliberately do NOT modify the project's .gitignore
      // — whether to track or ignore those files is the user's call. Just inform.
      console.log(`      ℹ .github/instructions/*.instructions.md is generated per session — add to .gitignore yourself if you don't want it tracked`);
    } else if (t.id === "codex") {
      const rel = ".codex/hooks/sdlc-skills";
      copyHookScripts(join(CWD, rel));
      // Codex uses Claude's nested SessionStart/SubagentStart shape. For a CLI
      // (non-plugin) project install PLUGIN_ROOT isn't set, so the command sets
      // CODEX_HOOK=1 to select the hookSpecificOutput emit shape. (Unix sh form;
      // Codex hooks run via shell.)
      const cmd = `CODEX_HOOK=1 "./${rel}/run-hook.cmd"`;
      const spec = {
        SessionStart: [
          {
            matcher: "startup|clear|compact|resume",
            hooks: [{ type: "command", command: `${cmd} session-start` }],
          },
        ],
        SubagentStart: [
          { matcher: "*", hooks: [{ type: "command", command: `${cmd} agent-start` }] },
        ],
      };
      if (mergeClaudeSettingsHooks(join(CWD, ".codex", "hooks.json"), spec, "sdlc-core"))
        console.log(`      ✓ hooks Codex (.codex/hooks.json)`);
      // Enable sub-agent dispatch so CLI orchestrators can spawn ICs (Codex
      // disables it unless [agents] has max_threads >= 1 and max_depth >= 2).
      const agentsCfg = ensureCodexAgentsConfig(CWD);
      if (agentsCfg.status !== "ok")
        console.log(`      ✓ sub-agent dispatch enabled (.codex/config.toml [agents]; ${agentsCfg.status})`);
    } else if (t.id === "windsurf") {
      console.log(`      — hooks Windsurf (no documented hook API; skipped)`);
    }
  }
}

// Ensure .agents/memory/<role>/MEMORY.md carries an index line pointing at
// project_briefing.md. Creates the index if absent; never duplicates.
function ensureMemoryIndexLine(destDir, role, description) {
  const indexPath = join(destDir, "MEMORY.md");
  const line = `- [Project briefing](project_briefing.md) — ${description || "Project overview and this role's focus"}`;
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# Memory index — ${role}\n\n${line}\n`);
    return;
  }
  const text = readFileSync(indexPath, "utf8");
  if (text.includes("project_briefing.md")) return; // already indexed
  writeFileSync(indexPath, text.replace(/\n*$/, "\n") + line + "\n");
}

// ---------------------------------------------------------------------------
// Skill registry — skills.json at the repo root describes every skill and
// where to fetch it:
//   monorepo entry: {id, monorepo: "sdlc-skills", name}  → copy from ./skills/<name>
//   external entry: {id, repo: "owner/repo", ref, subdir?} → git clone + symlink
// ---------------------------------------------------------------------------

export function loadSkillRegistry() {
  const registryPath = join(PKG_ROOT, "skills.json");
  if (!existsSync(registryPath)) return { skills: [] };
  try {
    return JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (err) {
    console.error(`  ! Failed to parse skills.json: ${err.message}`);
    return { skills: [] };
  }
}

function registryEntry(registry, skillId) {
  return (registry.skills || []).find((e) => e.id === skillId) || null;
}

function cacheRoot() {
  // XDG-ish cache dir so clones are shared across projects.
  const base =
    process.env.SDLC_SKILLS_CACHE_DIR ||
    process.env.XDG_CACHE_HOME ||
    join(homedir(), ".cache");
  const dir = join(base, "sdlc-skills", "registry");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function shallowClone(repo, ref) {
  const dest = join(cacheRoot(), repo.replace("/", "__"));
  try {
    if (existsSync(join(dest, ".git"))) {
      execSync(`git -C "${dest}" fetch --quiet --depth 1 origin ${ref}`, {
        stdio: "ignore",
      });
      execSync(`git -C "${dest}" checkout --quiet FETCH_HEAD`, {
        stdio: "ignore",
      });
    } else {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      execSync(
        `git clone --quiet --depth 1 --branch ${ref} https://github.com/${repo} "${dest}"`,
        { stdio: "ignore" }
      );
    }
    return dest;
  } catch (err) {
    console.error(`  ! git clone ${repo}@${ref} failed: ${err.message}`);
    return null;
  }
}

function installExternalSkill(entry, targetDir, useSymlink, update) {
  const ref = entry.ref || "main";
  const clone = shallowClone(entry.repo, ref);
  if (!clone) return { status: "error" };
  const src = entry.subdir ? join(clone, entry.subdir) : clone;
  if (!existsSync(src)) {
    console.error(`  ! ${entry.id}: ${entry.subdir || "."} not found in ${entry.repo}`);
    return { status: "error" };
  }
  // Skill name derives from SKILL.md `name:` (if present) else subdir basename.
  let skillName = entry.id;
  const skillMd = join(src, "SKILL.md");
  if (existsSync(skillMd)) {
    const match = readFileSync(skillMd, "utf8").match(/^name:\s*(.+)$/m);
    if (match) skillName = match[1].trim().replace(/^["']|["']$/g, "");
  } else if (entry.subdir) {
    skillName = basename(entry.subdir);
  }
  const skillsDir = join(CWD, targetDir, "skills");
  mkdirSync(skillsDir, { recursive: true });
  const dest = join(skillsDir, skillName);
  const present = existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false });
  if (present && !update) return { status: "exists", name: skillName };
  if (present && update) rmSync(dest, { recursive: true, force: true }); // clear prior symlink or copy
  try {
    if (useSymlink) {
      // Live link into the shared cache — power-user opt-in. Not portable
      // across runtimes that don't follow symlinks or that jail to the
      // project root (the target lives under ~/.cache).
      symlinkSync(src, dest);
    } else {
      // Default: a self-contained copy, so the skill is present in the
      // project tree itself (git/zip/Docker/sandbox/Windows-safe). Some
      // upstream skills (e.g. twostraws/Swift-*-Agent-Skill) ship nested
      // relative symlinks — copyTreeDereferenced materializes those into
      // real content so the install survives transport off this machine.
      copyTreeDereferenced(src, dest, { force: true });
    }
    return { status: "installed", name: skillName };
  } catch (err) {
    console.error(`  ! ${useSymlink ? "symlink" : "copy"} ${src} → ${dest} failed: ${err.message}`);
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------
// Agent → skill dependency resolution
//
// Each agent declares its required skills in the YAML frontmatter of
// `agents/<name>/AGENT.md`:
//
//   skills: [tdd, implement-feature, memory, swiftui-pro]
//
// When the user runs `init --agents X,Y` without `--skills`, we read those
// lists and auto-install the skills that live in this monorepo. Skills
// declared by the agent but *not* present in this repo (external skills
// like tdd, brainstorming, swiftui-pro) are surfaced as a warning with
// install instructions, resolved from skills.json `repo:` entries (see
// the README).
// ---------------------------------------------------------------------------

function parseAgentSkillDeps(agentName, agentsRoot = join(PKG_ROOT, "agents")) {
  const agentMd = join(agentsRoot, agentName, "AGENT.md");
  if (!existsSync(agentMd)) return [];
  let text;
  try {
    text = readFileSync(agentMd, "utf8");
  } catch {
    return [];
  }
  // Match the first `---` frontmatter block. Naive but sufficient — the
  // frontmatter is authored by humans and always single-line `skills: [...]`.
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return [];
  const line = fm[1].match(/^skills:\s*\[([^\]]*)\]/m);
  if (!line) return [];
  return line[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function partitionSkillIds(ids, availableSkills, registry, index) {
  const monorepo = [];
  const external = [];
  const unknown = [];
  for (const id of ids) {
    if (availableSkills.includes(id) || (index && itemKnown(index, "skills", id))) {
      monorepo.push(id);
      continue;
    }
    const entry = registryEntry(registry, id);
    if (entry && entry.repo) external.push(entry);
    else unknown.push(id);
  }
  return { monorepo, external, unknown };
}

export function inferSkillsFromAgents(agentNames, availableSkills, registry, index) {
  const declared = new Set();
  for (const name of agentNames) {
    const r = index ? resolveItem(index, "agents", name) : null;
    const agentsRoot = r ? join(r.dir, "agents") : undefined;
    for (const skill of parseAgentSkillDeps(r ? r.name : name, agentsRoot)) declared.add(skill);
  }
  return partitionSkillIds([...declared], availableSkills, registry, index);
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    all: false,
    update: false,
    yes: false,
    agents: null, // null = unspecified, [] = none, [..] = explicit
    skills: null,
    targets: null,
    bundle: null,
    symlink: false, // external skills: copy by default, symlink from cache if true
    interactive: false, // --interactive: pick quality-architect specialists/connectors/MCPs via a menu
    mcp: null, // --mcp <ids>: write these MCP servers non-interactively, in each target's native form
    unknown: [], // unrecognized tokens — guarded in main() so a typo/quoting slip doesn't silently install the full catalog
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--update") out.update = true;
    else if (a === "--symlink") out.symlink = true;
    else if (a === "--interactive" || a === "-i") out.interactive = true;
    else if (a === "--bundle") out.bundle = (argv[++i] || "").trim();
    else if (a === "--agents") out.agents = splitList(argv[++i]);
    else if (a === "--skills") out.skills = splitList(argv[++i]);
    else if (a === "--target") out.targets = splitList(argv[++i]);
    else if (a === "--mcp") out.mcp = splitList(argv[++i]);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    // Anything else is unrecognized. Skip the leading `init` subcommand. A
    // common cause is a flag+value passed as a single shell token — e.g. zsh
    // not word-splitting an unquoted variable: `init "--bundle feature-development"`.
    else if (!(i === 0 && a === "init")) {
      out.unknown.push(a);
    }
  }
  return out;
}

function splitList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`
  sdlc-skills installer

  Usage:
    npx github:arozumenko/sdlc-skills init [options]

  Options:
    --bundle <id>              Install a team bundle (a curated set of agents,
                               skills, briefings, instructions, and hooks)
    --all                      Install every agent and every skill (no prompts)
    --agents <a,b,c|all>       Install only these agents (or all)
    --skills  <a,b,c|all>      Install only these skills (or all)
    --target <claude,cursor,…> Limit IDE targets (default: all detected)
    --update                   Overwrite existing installs
    --interactive, -i          Menu to pick optional MCP servers (and, for
                               quality-architect, its QA specialists/connectors).
                               Applies to the quality-architect agent and the
                               test-automation / manual-qa / quality-engineering
                               bundles. Needs a terminal.
    --mcp <a,b,c>              Write these MCP servers non-interactively, each in
                               its target's native form (Claude .mcp.json; Copilot
                               .vscode/mcp.json + .copilot/mcp-config.json; Codex
                               .codex/config.toml). Merges in, never clobbers.
    --symlink                  Symlink external skills from the shared cache
                               instead of copying them (default: copy, which
                               is self-contained and portable across runtimes)
    --yes                      Skip the interactive "detected IDE" prompt
    -h, --help                 Show this help

  Examples:
    npx github:arozumenko/sdlc-skills init --bundle feature-development
    npx github:arozumenko/sdlc-skills init --bundle feature-development --target claude
    npx github:arozumenko/sdlc-skills init --all
    npx github:arozumenko/sdlc-skills init --agents ba,tech-lead --skills bugfix-workflow
    npx github:arozumenko/sdlc-skills init --agents all --target claude --update
`);
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

function copyItem(kind, name, target, update, registry, srcRoot = PKG_ROOT) {
  // kind: "agents" | "skills"; target: {id, dir, label}
  // srcRoot defaults to the monorepo; bundle-local agents pass their own dir.
  const src = join(srcRoot, kind, name);
  if (!existsSync(src)) return { status: "missing" };

  // GitHub Copilot CLI expects agents as flat `<name>.agent.md` files,
  // not directories. Flatten AGENT.md + SOUL.md into a single file.
  if (kind === "agents" && target.id === "copilot") {
    return flattenAgentForCopilot(src, name, target.dir, update, registry);
  }

  // Codex custom agents are TOML files under .codex/agents/, not directories.
  if (kind === "agents" && target.id === "codex") {
    return writeCodexAgent(src, name, target.dir, update);
  }

  const dest = join(CWD, target.dir, kind, name);
  if (existsSync(dest) && !update) return { status: "exists", dest };
  mkdirSync(dirname(dest), { recursive: true });
  if (update && existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  // Deep-dereferenced copy — bundle-local agents/skills may be symlinks back
  // into this repo's agents/ or skills/ (the symlink pattern lets a bundle
  // "own" a shared item without forking it), and the source tree may contain
  // nested symlinks too (Node's cpSync({dereference:true}) doesn't recurse).
  copyTreeDereferenced(src, dest, { force: true });

  // Inject a skills-inventory section into the installed agent body —
  // but only for hosts that don't preload the `skills:` frontmatter
  // field. Claude Code preloads each listed SKILL.md into subagent
  // context at startup, so a body list would duplicate what's already
  // in context. Cursor and Windsurf have no documented preload
  // mechanism and get the body list so agents can discover declared
  // skills. Copilot runs through flattenAgentForCopilot() above.
  if (
    kind === "agents" &&
    registry &&
    target.id !== "claude"
  ) {
    injectSkillsIntoCopiedAgent(dest, name, registry);
  }

  return { status: "installed", dest };
}

// ---------------------------------------------------------------------------
// Skills-section injection — the frontmatter `skills:` list behaves
// differently per host, and the installer compensates only where it has
// to:
//   - Claude Code:  `skills:` is a preload. Each listed SKILL.md is
//                   injected into the subagent's context at startup, so
//                   the agent already has the content before it reads a
//                   line of AGENT.md. No body injection — it would just
//                   duplicate the preloaded content. (See code.claude.com
//                   docs on subagent `skills:` frontmatter.)
//   - Copilot CLI:  `skills:` is an unknown frontmatter field and is
//                   silently discarded. Without a body mention, the
//                   agent has no way to know which skills it ships with.
//                   Injection is essential here.
//   - Cursor / Windsurf: no documented preload mechanism; treated like
//                   Copilot — inject the body list so the agent can
//                   discover declared skills and load SKILL.md by path.
// Source files in the repo stay untouched; this is install-time output
// scoped to the non-Claude targets.
// ---------------------------------------------------------------------------

const SKILLS_MARKER_START = "<!-- SKILLS-INJECTED: START -->";
const SKILLS_MARKER_END = "<!-- SKILLS-INJECTED: END -->";

function buildSkillsSection(skills, registry) {
  if (!skills || skills.length === 0) return null;

  const lookup = {};
  for (const s of registry.skills || []) lookup[s.id] = s;

  const bullets = skills.map((id) => {
    const entry = lookup[id];
    const desc = entry?.description || "(description not in skills.json)";
    return `- **\`${id}\`** — ${desc}`;
  });

  return (
    `${SKILLS_MARKER_START}\n` +
    "## Skills\n\n" +
    "_Load any of these on demand; conditional-load triggers live in § Session Start._\n\n" +
    bullets.join("\n") + "\n\n" +
    SKILLS_MARKER_END
  );
}

function parseSkillsFromFrontmatter(agentText) {
  const fm = agentText.match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return [];

  // Inline form: `skills: [a, b, c]`
  const inline = fm[1].match(/^skills:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  // Block form:
  //   skills:
  //     - a
  //     - b
  const block = fm[1].match(/^skills:\s*\n((?:[ \t]*-[ \t]*[^\n]+\n?)+)/m);
  if (block) {
    return block[1]
      .split("\n")
      .map((l) => l.replace(/^[ \t]*-[ \t]*/, "").trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return [];
}

function injectSkillsSection(agentText, name, registry) {
  if (!registry) return agentText;

  // 1. Strip any existing SKILLS-INJECTED block (idempotence on re-run).
  const stripPattern = new RegExp(
    `\\n*${SKILLS_MARKER_START}[\\s\\S]*?${SKILLS_MARKER_END}\\n*`,
    "g",
  );
  const stripped = agentText.replace(stripPattern, "\n\n");

  // 2. Parse declared skills from frontmatter.
  const skills = parseSkillsFromFrontmatter(stripped);
  const section = buildSkillsSection(skills, registry);
  if (!section) return stripped;

  // 3. Insert right after Session Start ends — that's where the
  //    conditional-load prose already lives, so reader flow is:
  //    Identity → Session Start → Skills inventory → Role / Responsibilities.
  const startMatch = stripped.match(/\n## Session Start[^\n]*\n/);
  if (startMatch) {
    const startIdx = startMatch.index + startMatch[0].length;
    const rest = stripped.slice(startIdx);
    const nextHeading = rest.match(/\n## /);
    if (nextHeading) {
      const insertIdx = startIdx + nextHeading.index + 1;
      return (
        stripped.slice(0, insertIdx) +
        section +
        "\n\n" +
        stripped.slice(insertIdx)
      );
    }
  }

  // 4. Fallback — insert before the first `## ` heading after the
  //    frontmatter.
  const fmEnd = stripped.indexOf("\n---", 4);
  if (fmEnd >= 0) {
    const fallbackMatch = stripped.slice(fmEnd + 4).match(/\n## /);
    if (fallbackMatch) {
      const insertIdx = fmEnd + 4 + fallbackMatch.index + 1;
      return (
        stripped.slice(0, insertIdx) +
        section +
        "\n\n" +
        stripped.slice(insertIdx)
      );
    }
  }

  // 5. Last resort — append at end.
  return stripped.trimEnd() + "\n\n" + section + "\n";
}

function injectSkillsIntoCopiedAgent(destDir, name, registry) {
  const agentFile = join(destDir, "AGENT.md");
  if (!existsSync(agentFile)) return;
  const text = readFileSync(agentFile, "utf8");
  const rewritten = injectSkillsSection(text, name, registry);
  if (rewritten !== text) writeFileSync(agentFile, rewritten);
}

// Apply a bundle's per-role skill overlay to an already-installed agent:
// rewrite its inline `skills: [...]` frontmatter to the effective set. On
// Claude this is the preload list; on Cursor/Windsurf we also regenerate the
// injected skills-inventory body so it matches. Returns true if rewritten.
function applySkillOverlay(target, name, effectiveSkills, registry) {
  const agentFile =
    target.id === "copilot"
      ? join(CWD, target.dir, "agents", `${name}.agent.md`)
      : join(CWD, target.dir, "agents", name, "AGENT.md");
  if (!existsSync(agentFile)) return false;
  const text = readFileSync(agentFile, "utf8");
  const re = /^skills:\s*\[[^\]]*\]/m;
  if (!re.test(text)) return false; // no inline skills line — nothing to rewrite
  writeFileSync(agentFile, text.replace(re, `skills: [${effectiveSkills.join(", ")}]`));
  if (target.id !== "claude" && target.id !== "copilot") {
    // dir-based non-Claude targets carry a body inventory — regenerate it.
    injectSkillsIntoCopiedAgent(join(CWD, target.dir, "agents", name), name, registry);
  }
  return true;
}

// Core transform used by both install-time (--target copilot) and the
// fix-copilot subcommand. Given AGENT.md (+ optional SOUL.md) content,
// returns { agent, soul } — the text to write to <name>.agent.md and
// (when soulMode requires it) to a separate soul destination.
// ANY agent can run as the *primary* (user-invoked) agent in VS Code Copilot
// Chat. In that mode Copilot fires only a session-start event — which carries NO
// agent identity — so the workspace-level session-start hook can't know to load
// THIS role's memory. The fix is an agent-scoped session-start hook baked into
// the flat frontmatter: it knows its own role (the file IS that role) and fires
// when the agent is the active primary. We bake it into EVERY installed agent so
// each one's memory loads when it's primary — the orchestrator, the interactive
// scout, and any worker a user selects directly all get parity.
//
// No double-injection: a worker dispatched as a subagent fires SubagentStart
// (served by the workspace hook) — a DIFFERENT event — so this frontmatter
// SessionStart only fires when the agent is the primary. The two paths stay
// disjoint (frontmatter session-start = primary; workspace SubagentStart = sub).
//
// VS-Code-only on purpose, and that's fine. Live testing showed the standalone
// Copilot CLI does NOT execute agent-frontmatter hooks at all — but it doesn't
// need them: the CLI primary agent IS identified to the workspace session-start
// hook (via `--agent`), so CLI primaries get their memory that way. VS Code
// Copilot Chat fires the PascalCase `SessionStart` frontmatter hook (command /
// hookSpecificOutput), so that's the only dialect we emit. SDLC_HOOK_EVENT=
// SessionStart makes agent-start skip the shared docs (the workspace session-start
// hook already injected those) and label the emitted event as SessionStart.
//
// Applied to every agent on Copilot install; the `hooks:` guard leaves any
// author-defined hooks untouched. (No longer gated on `orchestrator: true` — that
// flag has been dropped from the agent frontmatter entirely.)
function injectCopilotSessionStartHook(agentText, name) {
  const m = agentText.match(/^---\s*\n([\s\S]*?)\n---[ \t]*\n?/);
  if (!m) return agentText;
  const fmBody = m[1];
  if (/^hooks:/m.test(fmBody)) return agentText; // author already defined hooks — leave it
  const rel = ".github/hooks/sdlc-skills";
  const cmd = `"./${rel}/run-hook.cmd" agent-start ${name}`;
  const hooksYaml =
    `hooks:\n` +
    `  SessionStart:\n` +
    `    - type: command\n` +
    `      command: '${cmd}'\n` +
    `      env:\n` +
    `        SDLC_VSCODE: "1"\n` +
    `        SDLC_HOOK_EVENT: "SessionStart"\n` +
    `      timeout: 10`;
  const after = agentText.slice(m[0].length);
  return `---\n${fmBody}\n${hooksYaml}\n---\n${after}`;
}

function transformAgentForCopilot(
  agentText,
  soulText,
  name,
  { soulMode = "inline", normalizeModel = true, registry = null } = {},
) {
  const SOUL_REF = /Read `SOUL\.md` in this directory for your personality, voice, and values\. That's who you are\./;
  let agent = agentText;
  let soul = null;

  if (soulText) {
    const soulBody = soulText.replace(/^#\s+[^\n]*\n+/, "").trimStart();
    if (soulMode === "inline") {
      agent = agent.replace(/\s+$/, "") + "\n\n---\n\n## Persona\n\n" + soulBody;
    } else if (soulMode === "sibling") {
      soul = soulText;
      agent = agent.replace(
        SOUL_REF,
        `Read \`${name}.soul.md\` for your personality, voice, and values. That's who you are.`,
      );
    } else if (soulMode === "keep") {
      soul = soulText; // caller keeps it in the source dir
      agent = agent.replace(
        SOUL_REF,
        `Read \`${name}/SOUL.md\` for your personality, voice, and values. That's who you are.`,
      );
    } else if (soulMode === "memory") {
      // Relocate SOUL.md into the IDE-neutral per-role memory dir so the
      // flat agent file stays lean and the persona is discoverable at a
      // predictable path across hosts. Caller writes the file to
      // `<project>/.agents/memory/<name>/SOUL.md`.
      //
      // GitHub Copilot does NOT honor Claude's `@`-import directive, so the
      // reference is rewritten as a plain "Read `<path>`" instruction with a
      // project-root-relative path the agent can open directly.
      soul = soulText;
      agent = agent.replace(
        SOUL_REF,
        `Read \`.agents/memory/${name}/SOUL.md\` for your personality, voice, and values. That's who you are.`,
      );
    }
  }

  // Copilot can't expand `@`-imports. Any remaining `@.agents/...` import line
  // authored in the body (e.g. snapshot.md / memory.md) becomes a relative
  // "Read `<path>`" instruction so the path stays openable rather than dead.
  agent = agent.replace(
    /^[ \t]*@(\.agents\/\S+)[ \t]*$/gm,
    (_, path) => `Read \`${path}\` for context.`,
  );

  if (normalizeModel) {
    // Copilot's model picker keys off display names ("Claude Sonnet 4.6"),
    // not the dashed provider id — shipping `model: sonnet` leaves it unable
    // to resolve. Map the alias to Copilot's display name (COPILOT_MODEL_NAMES).
    agent = agent.replace(
      /^model:\s*(sonnet|opus|haiku)\s*$/m,
      (_, alias) => `model: ${COPILOT_MODEL_NAMES[alias]}`,
    );
  }

  // Body skill links are authored relative to the source `agents/<name>/`
  // dir (`../../skills/...`). The flat Copilot file lives at
  // `.github/agents/<name>.agent.md`, one level shallower than the directory
  // hosts, so the installed skills at `.github/skills/<name>/` are reached
  // via `../skills/...`. Rewrite so the links resolve on disk.
  agent = agent.replace(/\.\.\/\.\.\/skills\//g, "../skills/");

  // Inject the skills-inventory section as the final transform step so
  // it lands in Copilot's flat `.agent.md` file too (Copilot ignores
  // unknown frontmatter keys, so without this the `skills:` list is
  // invisible to the agent at runtime).
  if (registry) {
    agent = injectSkillsSection(agent, name, registry);
  }

  // Every agent gets an agent-scoped SessionStart hook so its role memory loads
  // when it runs as the primary (user-invoked) agent in VS Code Copilot Chat —
  // see injectCopilotSessionStartHook. The `hooks:` guard skips author-defined hooks.
  agent = injectCopilotSessionStartHook(agent, name);

  return { agent, soul };
}

function flattenAgentForCopilot(src, name, targetDir, update, registry) {
  const agentFile = join(src, "AGENT.md");
  if (!existsSync(agentFile)) return { status: "missing" };
  const dest = join(CWD, targetDir, "agents", `${name}.agent.md`);
  if (existsSync(dest) && !update) return { status: "exists", dest };

  const soulFile = join(src, "SOUL.md");
  const { agent, soul } = transformAgentForCopilot(
    readFileSync(agentFile, "utf8"),
    existsSync(soulFile) ? readFileSync(soulFile, "utf8") : null,
    name,
    { soulMode: "memory", normalizeModel: true, registry },
  );

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, agent);

  // With memory mode (the default), SOUL.md is relocated to the
  // IDE-neutral per-role dir under .agents/memory/<name>/SOUL.md so the
  // persona is discoverable at a predictable path across hosts. The
  // agent's in-file reference was rewritten to match.
  if (soul) {
    const soulDest = join(CWD, ".agents", "memory", name, "SOUL.md");
    mkdirSync(dirname(soulDest), { recursive: true });
    writeFileSync(soulDest, soul);
  }

  return { status: "installed", dest };
}

// ---------------------------------------------------------------------------
// Codex agent transform — Codex custom agents are TOML files under
// .codex/agents/<name>.toml, NOT markdown (see
// https://developers.openai.com/codex/subagents). Mirror the Copilot path: a
// pure text→TOML function (reusable/testable) plus a writer. The AGENT.md body
// (+ SOUL.md inlined as a persona) becomes `developer_instructions`; declared
// monorepo skills become [[skills.config]] entries pointing at the SKILL.md
// files installed under .codex/skills/.
// ---------------------------------------------------------------------------

function tomlBasicString(s) {
  return (
    '"' +
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") +
    '"'
  );
}

function tomlMultiline(s) {
  // Literal triple-quote keeps markdown intact (no escaping). Fall back to a
  // basic triple-quote with escaping only if the body itself contains '''.
  const body = s.replace(/\r/g, "");
  if (!body.includes("'''")) return "'''\n" + body + "\n'''";
  return '"""\n' + body.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"') + '\n"""';
}

function transformAgentForCodex(agentText, soulText, name) {
  const fm = agentText.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/m);
  const frontmatter = fm ? fm[1] : "";
  let body = fm ? agentText.slice(fm.index + fm[0].length) : agentText;

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const description = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, "") : `${name} agent`;
  // The authored `model:` is a Claude tier (sonnet/opus/haiku) — unusable on
  // Codex (an OpenAI host) — so it's ignored: assign the role's Codex model by
  // name, defaulting any unlisted role to the lightweight tier. Every Codex
  // agent therefore ships a concrete, valid model id.
  const model = CODEX_MODELS[name] ?? CODEX_MODEL_DEFAULT;

  // Inline SOUL.md as a persona section (Codex has no sibling-file mechanism),
  // mirroring Copilot's inline soul mode; drop the now-stale "Read SOUL.md in
  // this directory" pointer since there's no sibling file in a TOML agent.
  if (soulText) {
    const soulBody = soulText.replace(/^#\s+[^\n]*\n+/, "").trimStart();
    body = body.replace(
      /Read `SOUL\.md` in this directory for your personality, voice, and values\. That's who you are\.\s*/,
      ""
    );
    body = body.replace(/\s+$/, "") + "\n\n---\n\n## Persona\n\n" + soulBody;
  }

  const lines = [`name = ${tomlBasicString(name)}`, `description = ${tomlBasicString(description)}`];
  if (model) lines.push(`model = ${tomlBasicString(model)}`);
  lines.push("", `developer_instructions = ${tomlMultiline(body.trim())}`);

  const skills = parseSkillsFromFrontmatter(agentText).filter((id) =>
    existsSync(join(PKG_ROOT, "skills", id))
  );
  for (const id of skills) {
    lines.push("", "[[skills.config]]", `path = ${tomlBasicString(`.codex/skills/${id}/SKILL.md`)}`, "enabled = true");
  }
  return lines.join("\n") + "\n";
}

function writeCodexAgent(src, name, targetDir, update) {
  const agentFile = join(src, "AGENT.md");
  if (!existsSync(agentFile)) return { status: "missing" };
  const dest = join(CWD, targetDir, "agents", `${name}.toml`);
  if (existsSync(dest) && !update) return { status: "exists", dest };
  const soulFile = join(src, "SOUL.md");
  const toml = transformAgentForCodex(
    readFileSync(agentFile, "utf8"),
    existsSync(soulFile) ? readFileSync(soulFile, "utf8") : null,
    name
  );
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, toml);
  return { status: "installed", dest };
}


async function interactivePick(catalog, args) {
  const detected = TARGETS.filter((t) => existsSync(join(CWD, t.dir)));
  let targets;
  if (args.targets) {
    targets = TARGETS.filter((t) => args.targets.includes(t.id));
    if (args.targets.includes("kiro")) {
      console.log(
        "  Note: Kiro isn't a CLI target — its hooks attach per custom-agent config;\n  see hooks/hooks-kiro.json and hooks/README.md to wire them."
      );
    }
    if (targets.length === 0) {
      console.error(`  ! No valid --target values: ${args.targets.join(", ")}`);
      process.exit(1);
    }
  } else if (args.all || args.yes) {
    targets = detected.length > 0 ? detected : [TARGETS[0]];
  } else if (detected.length === 0) {
    // Nothing on disk to infer from — ask which runtime to set up rather than
    // silently assuming Claude. Same arrow-key picker as the role selection,
    // single choice. A trailing "All of the above" row installs every target.
    const choice = await selectOne(
      "No IDE directories detected. Install for which runtime?",
      [
        ...TARGETS.map((t) => ({ value: t.id, label: t.label, desc: t.dir + "/" })),
        { value: "__all__", label: "All of the above" },
      ],
      TARGETS[0].id,
    );
    targets = choice === "__all__" ? TARGETS.slice() : TARGETS.filter((t) => t.id === choice);
  } else {
    // One or more IDE directories already exist — pick among the detected ones.
    const choice = await selectOne(
      "Detected IDE directories. Install to which?",
      [
        ...detected.map((t) => ({ value: t.id, label: t.label, desc: t.dir + "/" })),
        { value: "__all__", label: "All of the above" },
      ],
      "__all__",
    );
    targets = choice === "__all__" ? detected : detected.filter((t) => t.id === choice);
  }

  // Resolve agents (bare ids and qualified `bundle/name`), resolver-aware.
  let agentsSelection;
  if (args.agents === null) agentsSelection = null;
  else if (args.agents.length === 0) agentsSelection = [];
  else if (args.agents.length === 1 && args.agents[0] === "all") agentsSelection = catalog.agents;
  else {
    const bad = args.agents.filter((a) => !itemKnown(catalog.index, "agents", a));
    if (bad.length) {
      console.error(`  ! Unknown agent: ${bad.join(", ")}`);
      console.error(`    Available: ${catalog.agents.join(", ") || "(none)"}`);
      process.exit(1);
    }
    agentsSelection = args.agents;
  }

  // Resolve skills with awareness of externals from skills.json. An
  // explicit --skills list may contain both monorepo ids (installed by
  // copy from this repo) and external ids (cloned from skills.json
  // `repo:` entries and symlinked into the target dir).
  let skillsSelection;          // monorepo ids to install via copyItem
  let externalFromFlag = [];    // external registry entries to install via installExternalSkill
  if (args.skills === null) {
    skillsSelection = null;
  } else if (args.skills.length === 0) {
    skillsSelection = [];
  } else if (args.skills.length === 1 && args.skills[0] === "all") {
    skillsSelection = catalog.skills;
  } else {
    const { monorepo, external, unknown } = partitionSkillIds(
      args.skills,
      catalog.skills,
      catalog.registry,
      catalog.index,
    );
    if (unknown.length) {
      const externalIds = (catalog.registry?.skills || [])
        .filter((e) => e.repo)
        .map((e) => e.id);
      console.error(`  ! Unknown skill: ${unknown.join(", ")}`);
      console.error(`    Monorepo skills: ${catalog.skills.join(", ") || "(none)"}`);
      if (externalIds.length) {
        console.error(`    External skills (from skills.json): ${externalIds.join(", ")}`);
      }
      process.exit(1);
    }
    skillsSelection = monorepo;
    externalFromFlag = external;
  }

  if (args.all) {
    if (agentsSelection === null) agentsSelection = catalog.agents;
    if (skillsSelection === null) skillsSelection = catalog.skills;
  } else if (agentsSelection === null && skillsSelection === null) {
    if (args.mcp && args.mcp.length) {
      // --mcp on its own → MCP-only run; don't fall into the full-catalog default.
      agentsSelection = [];
      skillsSelection = [];
    } else {
      // Neither specified and not --all → install everything by default,
      // but print what we're doing so users aren't surprised.
      console.log(
        "\n  No --agents / --skills specified. Installing full catalog.\n  (Use --agents or --skills to narrow.)"
      );
      agentsSelection = catalog.agents;
      skillsSelection = catalog.skills;
    }
  } else {
    if (agentsSelection === null) agentsSelection = [];
    // --agents X without --skills → auto-resolve each agent's declared
    // skill deps. Monorepo skills install from this repo; externals
    // (`repo:` entries in skills.json) clone + symlink into the target
    // dir. Unknown skill ids (not in skills.json at all) are warned
    // and skipped.
    if (skillsSelection === null) {
      if (agentsSelection.length > 0) {
        const { monorepo, external, unknown } = inferSkillsFromAgents(
          agentsSelection,
          catalog.skills,
          catalog.registry,
          catalog.index
        );
        if (monorepo.length) {
          console.log(
            `\n  Monorepo skills required by selected agents:\n    ${monorepo.join(", ")}`
          );
        }
        if (external.length) {
          console.log(
            `\n  External skills required by selected agents (will be fetched):\n    ${external.map((e) => `${e.id} (${e.repo}${e.subdir ? "/" + e.subdir : ""})`).join("\n    ")}`
          );
        }
        if (unknown.length) {
          console.log(
            `\n  ! Skills declared by agents but not in skills.json (skipped):\n    ${unknown.join(", ")}`
          );
        }
        skillsSelection = monorepo;
        return { targets, agentsSelection, skillsSelection, externalSkills: external };
      } else {
        skillsSelection = [];
      }
    }
  }

  // Announce any externals pulled in by an explicit --skills flag.
  if (externalFromFlag.length) {
    console.log(
      `\n  External skills from --skills (will be fetched):\n    ${externalFromFlag.map((e) => `${e.id} (${e.repo}${e.subdir ? "/" + e.subdir : ""})`).join("\n    ")}`
    );
  }

  return { targets, agentsSelection, skillsSelection, externalSkills: externalFromFlag };
}

// ---------------------------------------------------------------------------
// fix-copilot subcommand — repair already-installed agent directories so
// GitHub Copilot CLI can find them. Useful when a project was installed by
// an older sdlc-skills release (or by hand) and now has
// `.github/agents/<name>/AGENT.md` directories instead of flat
// `.github/agents/<name>.agent.md` files.
// ---------------------------------------------------------------------------

function parseFixCopilotArgs(argv) {
  const out = {
    dir: ".github/agents",
    dryRun: false,
    soul: "memory",        // memory | inline | keep | sibling
    normalizeModel: true,  // default-on — Copilot CLI needs a concrete model id
  };
  const VALID_SOUL = ["inline", "keep", "sibling", "memory"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--soul") {
      const v = argv[++i];
      if (!VALID_SOUL.includes(v)) {
        console.error(`  ! Invalid --soul mode: ${v} (expected: ${VALID_SOUL.join("|")})`);
        process.exit(1);
      }
      out.soul = v;
    }
    else if (a === "--no-normalize-model") out.normalizeModel = false;
    else if (a === "--normalize-model") out.normalizeModel = true;
    else if (a === "-h" || a === "--help") {
      printFixCopilotHelp();
      process.exit(0);
    } else {
      console.error(`  ! Unknown flag for fix-copilot: ${a}`);
      printFixCopilotHelp();
      process.exit(1);
    }
  }
  return out;
}

function printFixCopilotHelp() {
  console.log(`
  sdlc-skills fix-copilot — flatten .github/agents/<name>/ to <name>.agent.md

  Run in a project root that has agents installed as directories under
  .github/agents/. Each <name>/AGENT.md (plus optional SOUL.md) is
  rewritten into a flat <name>.agent.md file — the format GitHub Copilot
  CLI expects.

  Options:
    --dir <path>            Agents directory (default: .github/agents)
    --dry-run               Preview actions, don't touch disk

    --soul <mode>           How to handle the paired SOUL.md (default: memory)
        memory    relocate SOUL.md to \`.agents/memory/<name>/SOUL.md\`
                  (IDE-neutral per-role dir, co-located with the memory
                  skill's per-role content); remove the source directory;
                  rewrite the in-file reference to that path
        inline    append SOUL.md body as a ## Persona section inside the
                  flat agent file; remove the source directory
        keep      only flatten AGENT.md; leave SOUL.md where it is (source
                  dir kept with SOUL.md only) and rewrite the in-file
                  reference to \`<name>/SOUL.md\`
        sibling   move SOUL.md to a sibling flat file <name>.soul.md;
                  remove the source directory; rewrite the in-file
                  reference to \`<name>.soul.md\`

    --no-normalize-model    Keep 'model: sonnet' as-is (default: rewrite
                            to 'model: Claude Sonnet 4.6' — Copilot's
                            model-picker display name)
    -h, --help              Show this help
`);
}

function runFixCopilot(argv) {
  const opts = parseFixCopilotArgs(argv);
  const registry = loadSkillRegistry();
  const agentsDir = resolve(CWD, opts.dir);

  if (!existsSync(agentsDir)) {
    console.error(`  ! Agents directory not found: ${agentsDir}`);
    process.exit(1);
  }

  const dirs = readdirSync(agentsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  if (dirs.length === 0) {
    console.log(`  Nothing to convert in ${agentsDir} (no subdirectories).`);
    return;
  }

  console.log(`\n  sdlc-skills fix-copilot — scanning ${agentsDir}`);
  console.log(`  Mode: soul=${opts.soul}, normalize-model=${opts.normalizeModel}\n`);
  if (opts.dryRun) console.log("  DRY RUN — nothing will be written or deleted.\n");

  let converted = 0;
  let skipped = 0;
  for (const name of dirs) {
    const srcDir = join(agentsDir, name);
    const agentFile = join(srcDir, "AGENT.md");
    const destAgent = join(agentsDir, `${name}.agent.md`);
    const destSoulSibling = join(agentsDir, `${name}.soul.md`);

    if (!existsSync(agentFile)) {
      console.log(`  — ${name} skipped: no AGENT.md inside`);
      skipped++;
      continue;
    }
    if (existsSync(destAgent)) {
      console.log(`  — ${name} skipped: ${name}.agent.md already exists`);
      skipped++;
      continue;
    }

    try {
      const soulFile = join(srcDir, "SOUL.md");
      const soulText = existsSync(soulFile) ? readFileSync(soulFile, "utf8") : null;
      const { agent } = transformAgentForCopilot(
        readFileSync(agentFile, "utf8"),
        soulText,
        name,
        { soulMode: opts.soul, normalizeModel: opts.normalizeModel, registry },
      );

      // Work out what happens to SOUL.md + the source directory given the mode
      const willWriteSibling = opts.soul === "sibling" && soulText;
      const willWriteMemory = opts.soul === "memory" && soulText;
      const memoryDest = willWriteMemory
        ? join(CWD, ".agents", "memory", name, "SOUL.md")
        : null;
      const removeDir = opts.soul !== "keep"; // keep leaves dir with SOUL.md

      if (opts.dryRun) {
        console.log(
          `  → ${name} → ${name}.agent.md (${agent.length} bytes)` +
            (willWriteSibling ? `, write ${name}.soul.md` : "") +
            (willWriteMemory ? `, write .agents/memory/${name}/SOUL.md` : "") +
            (opts.soul === "keep" ? `, keep ${name}/SOUL.md` : "") +
            (removeDir ? ", remove source dir" : ""),
        );
      } else {
        writeFileSync(destAgent, agent);
        if (willWriteSibling) writeFileSync(destSoulSibling, soulText);
        if (willWriteMemory) {
          mkdirSync(dirname(memoryDest), { recursive: true });
          writeFileSync(memoryDest, soulText);
        }
        if (opts.soul === "keep") {
          // Delete only AGENT.md, leave the directory with SOUL.md intact.
          rmSync(agentFile);
        } else if (removeDir) {
          rmSync(srcDir, { recursive: true, force: true });
        }
        const tail = willWriteSibling
          ? ` + ${name}.soul.md`
          : willWriteMemory
            ? ` + .agents/memory/${name}/SOUL.md`
            : opts.soul === "keep"
              ? ` (kept ${name}/SOUL.md)`
              : "";
        console.log(`  ✓ ${name} → ${name}.agent.md${tail}`);
      }
      converted++;
    } catch (err) {
      console.error(`  ! ${name} failed: ${err.message}`);
      skipped++;
    }
  }
  console.log(
    `\n  Done: ${converted} ${opts.dryRun ? "would be converted" : "converted"}, ${skipped} skipped.\n`,
  );
}

// ---------------------------------------------------------------------------
// Optional interactive mode (`init --interactive`) for the quality-architect
// agent: pick which QA specialists/connectors to keep and which MCP servers to
// wire. Zero-dep arrow-key picker (raw-mode stdin). No targets/credentials are
// prompted; MCP selections are written as .mcp.json + .mcp.json.example with
// placeholder values (and .env.example for ELITEA), never live secrets.
// ---------------------------------------------------------------------------

async function selectMany(title, items) {
  if (!items.length) return [];
  // No TTY (CI, piped) → accept the defaults without drawing a menu.
  if (!process.stdin.isTTY) return items.filter((i) => i.default !== false).map((i) => i.value);
  console.log(`\n  ${title}`);
  console.log(`  ↑↓ move · space toggle · a all · n none · enter confirm`);
  const sel = items.map((i) => i.default !== false);
  let cur = 0;
  const rows = [];
  let lastG = null;
  items.forEach((it, i) => {
    if (it.group && it.group !== lastG) { lastG = it.group; rows.push({ g: it.group }); }
    rows.push({ i });
  });
  const render = () =>
    rows.map((r) => {
      if (r.g) return `    — ${r.g} —`;
      const it = items[r.i];
      return `  ${r.i === cur ? "❯" : " "} ${sel[r.i] ? "◉" : "○"} ${it.label}${it.desc ? `  (${it.desc})` : ""}`;
    });
  let lines = render();
  lines.forEach((l) => process.stdout.write(l + "\n"));
  const redraw = () => {
    process.stdout.write(`\x1b[${lines.length}A\x1b[0J`);
    lines = render();
    lines.forEach((l) => process.stdout.write(l + "\n"));
  };
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => { stdin.removeListener("data", onData); stdin.setRawMode(wasRaw || false); stdin.pause(); };
    function onData(buf) {
      const k = buf.toString();
      if (k === "\r" || k === "\n") { cleanup(); resolve(items.filter((_, i) => sel[i]).map((i) => i.value)); }
      else if (k === "\x03") { cleanup(); process.exit(130); }
      else if (k === " ") { sel[cur] = !sel[cur]; redraw(); }
      else if (k === "a") { sel.fill(true); redraw(); }
      else if (k === "n") { sel.fill(false); redraw(); }
      else if (k === "\x1b[A" || k === "k") { cur = (cur - 1 + items.length) % items.length; redraw(); }
      else if (k === "\x1b[B" || k === "j") { cur = (cur + 1) % items.length; redraw(); }
    }
    stdin.on("data", onData);
  });
}

// Single-choice sibling of selectMany — same arrow-key UX, but the highlighted
// row IS the selection (radio, not checkbox) and enter confirms exactly one.
// `defaultValue` pre-highlights a row; falls back to the first item.
async function selectOne(title, items, defaultValue) {
  if (!items.length) return null;
  let cur = Math.max(0, items.findIndex((i) => i.value === defaultValue));
  // No TTY (CI, piped) → take the default without drawing a menu.
  if (!process.stdin.isTTY) return items[cur].value;
  console.log(`\n  ${title}`);
  console.log(`  ↑↓ move · enter confirm`);
  const render = () =>
    items.map((it, i) =>
      `  ${i === cur ? "❯" : " "} ${i === cur ? "◉" : "○"} ${it.label}${it.desc ? `  (${it.desc})` : ""}`
    );
  let lines = render();
  lines.forEach((l) => process.stdout.write(l + "\n"));
  const redraw = () => {
    process.stdout.write(`\x1b[${lines.length}A\x1b[0J`);
    lines = render();
    lines.forEach((l) => process.stdout.write(l + "\n"));
  };
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => { stdin.removeListener("data", onData); stdin.setRawMode(wasRaw || false); stdin.pause(); };
    function onData(buf) {
      const k = buf.toString();
      if (k === "\r" || k === "\n") { cleanup(); resolve(items[cur].value); }
      else if (k === "\x03") { cleanup(); process.exit(130); }
      else if (k === "\x1b[A" || k === "k") { cur = (cur - 1 + items.length) % items.length; redraw(); }
      else if (k === "\x1b[B" || k === "j") { cur = (cur + 1) % items.length; redraw(); }
    }
    stdin.on("data", onData);
  });
}

// Optional MCP servers offered by --interactive / --mcp. Each entry's `cfg` is the
// host-neutral base; remote servers that need a token carry a `secret` descriptor so
// the four auth dialects are generated per host: Claude `headersHelper` (reads .env) /
// VS Code `${input:}` prompt / Copilot-CLI + Cursor + Windsurf literal placeholder /
// Codex `mcp-remote` stdio wrapper + a [mcp_servers.<id>.env] token.
const MCP_CATALOG = [
  { id: "playwright", group: "Browser automation", label: "Playwright", desc: "multi-browser automation", cfg: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
  { id: "chrome-devtools", group: "Browser automation", label: "Chrome DevTools", desc: "Chrome + Lighthouse", cfg: { command: "npx", args: ["-y", "chrome-devtools-mcp"] } },
  { id: "accessibility-scanner", group: "Accessibility", label: "axe-core scanner", desc: "automated WCAG scanning", cfg: { command: "npx", args: ["-y", "mcp-accessibility-scanner"] } },
  { id: "snyk", group: "Security", label: "Snyk", desc: "SAST / SCA / IaC", cfg: { command: "snyk", args: ["mcp", "-t", "stdio"] } },
  { id: "sentry", group: "Error tracking", label: "Sentry", desc: "prod error correlation", cfg: { command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_AUTH_TOKEN: "YOUR_SENTRY_TOKEN" } } },
  { id: "browserstack", group: "Cross-browser", label: "BrowserStack", desc: "real device/browser", cfg: { command: "npx", args: ["-y", "@browserstack/mcp-server"], env: { BROWSERSTACK_USERNAME: "YOUR_USERNAME", BROWSERSTACK_ACCESS_KEY: "YOUR_ACCESS_KEY" } } },
  { id: "postman", group: "API testing", label: "Postman", desc: "API collections / mocks", cfg: { command: "npx", args: ["-y", "@postman/postman-mcp-server"], env: { POSTMAN_API_KEY: "YOUR_API_KEY" } } },
  { id: "context7", group: "Research", label: "Context7", desc: "library docs lookup", cfg: { type: "http", url: "https://mcp.context7.com/mcp" }, secret: { header: "CONTEXT7_API_KEY", scheme: "", env: "CONTEXT7_API_KEY", input: "context7-key", prompt: "Context7 API Key", placeholder: "YOUR_CONTEXT7_API_KEY" } },
  { id: "tavily", group: "Research", label: "Tavily Web Search", desc: "web search / extract", cfg: { type: "http", url: "https://mcp.tavily.com/mcp/?tavilyApiKey=YOUR_TAVILY_API_KEY" } },
  { id: "github", group: "Integrations", label: "GitHub", desc: "issues, PRs, code search", cfg: { type: "http", url: "https://api.githubcopilot.com/mcp/" }, secret: { header: "Authorization", scheme: "Bearer ", env: "GITHUB_PAT", input: "github-pat", prompt: "GitHub PAT", placeholder: "YOUR_GITHUB_PAT" } },
  { id: "atlassian", group: "Integrations", label: "Atlassian Rovo", desc: "Jira / Confluence", cfg: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" } },
  { id: "onetest", group: "Integrations", label: "OneTest", desc: "test management / runs", cfg: { type: "http", url: "https://tms.onetest.ai/mcp/test-management", headers: { "X-Project-Id": "YOUR_PROJECT_ID" } }, secret: { header: "Authorization", scheme: "Bearer ", env: "OCTO_API_KEY", input: "onetest-key", prompt: "OneTest API Key", placeholder: "YOUR_OCTO_API_KEY" } },
  { id: "elitea-next", group: "Integrations", label: "ELITEA Next", desc: "EPAM ELITEA project", cfg: { type: "http", url: "https://next.elitea.ai/app/${ELITEA_PROJECT_ID:-630}/mcp" }, secret: { header: "Authorization", scheme: "Bearer ", env: "ELITEA_TOKEN", input: "elitea-token", prompt: "ELITEA API Key", placeholder: "YOUR_ELITEA_TOKEN", claudeUrl: "https://next.elitea.ai/app/${ELITEA_PROJECT_ID:-630}/sse", claudeType: "sse" } },
];

// JSON hosts: file, servers-key, auth style. Copilot is special (TWO files: VS Code
// `.vscode/mcp.json` with inputs[] prompts + Copilot CLI `.copilot/mcp-config.json`);
// Codex is special (TOML, in `.codex/config.toml`).
const MCP_JSON_HOSTS = {
  claude: { rel: ".mcp.json", key: "mcpServers", auth: "headersHelper" },
  cursor: { rel: ".cursor/mcp.json", key: "mcpServers", auth: "literal" },
  windsurf: { rel: ".windsurf/mcp.json", key: "mcpServers", auth: "literal" },
};
const MCP_COPILOT = [
  { rel: ".vscode/mcp.json", key: "servers", auth: "input", stdioType: true, inputs: true }, // VS Code Copilot
  { rel: ".copilot/mcp-config.json", key: "mcpServers", auth: "literal", stdioType: true }, // Copilot CLI
];

function tomlArray(arr) {
  return `[${arr.map(tomlBasicString).join(", ")}]`;
}

// One server's config object for a JSON host. authStyle: headersHelper (Claude reads the
// token from .env) | input (VS Code `${input:}` prompt) | literal (a YOUR_… placeholder).
// stdioType adds an explicit "type":"stdio" (Copilot wants it).
function mcpConfigFor(entry, authStyle, stdioType = false) {
  const cfg = entry.cfg;
  if (cfg.command) {
    const out = stdioType ? { type: "stdio" } : {};
    out.command = cfg.command;
    out.args = [...cfg.args];
    if (cfg.env) out.env = { ...cfg.env };
    return out;
  }
  const sec = entry.secret;
  const claude = authStyle === "headersHelper";
  const out = {
    type: claude && sec && sec.claudeType ? sec.claudeType : cfg.type || "http",
    url: claude && sec && sec.claudeUrl ? sec.claudeUrl : cfg.url,
  };
  const headers = { ...(cfg.headers || {}) };
  if (sec) {
    if (claude) {
      // Claude builds the auth header(s) at launch from a .env token — no secret on disk.
      const parts = [`${JSON.stringify(sec.header)}:${JSON.stringify(sec.scheme + "%s")}`];
      for (const [k, v] of Object.entries(cfg.headers || {})) parts.push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
      out.headersHelper = `printf '{${parts.join(",")}}' $(grep -m1 '^${sec.env}=' .env | cut -d= -f2-)`;
      return out;
    }
    headers[sec.header] = authStyle === "input" ? `${sec.scheme}\${input:${sec.input}}` : `${sec.scheme}${sec.placeholder}`;
  }
  if (Object.keys(headers).length) out.headers = headers;
  return out;
}

// One server as a Codex [mcp_servers.<id>] TOML block. Remote servers are bridged to
// stdio via `mcp-remote` (Codex MCP is command-based); the token rides a [.env] table.
function codexMcpToml(entry) {
  const { id, cfg, secret: sec } = entry;
  const lines = [`[mcp_servers.${id}]`];
  let env = cfg.env ? { ...cfg.env } : null;
  if (cfg.command) {
    lines.push(`command = ${tomlBasicString(cfg.command)}`, `args = ${tomlArray(cfg.args)}`);
  } else {
    const args = ["-y", "mcp-remote", cfg.url];
    const headers = { ...(cfg.headers || {}) };
    if (sec) {
      headers[sec.header] = `${sec.scheme}\${${sec.env}}`;
      env = { ...(env || {}), [sec.env]: sec.placeholder };
    }
    for (const [k, v] of Object.entries(headers)) args.push("--header", `${k}: ${v}`);
    args.push("--transport", "http-only", "--silent");
    lines.push(`command = "npx"`, `args = ${tomlArray(args)}`);
  }
  let out = lines.join("\n");
  if (env) out += `\n\n[mcp_servers.${id}.env]\n` + Object.entries(env).map(([k, v]) => `${k} = ${tomlBasicString(v)}`).join("\n");
  return out;
}

// VS Code secret prompts: one promptString per selected secret-bearing server.
function mcpInputs(entries) {
  return entries
    .filter((e) => e.secret)
    .map((e) => ({ type: "promptString", id: e.secret.input, description: e.secret.prompt, password: true }));
}

// Merge selected servers into one JSON host file (never clobber other servers/keys; an
// unparseable real file is left untouched). For VS Code, also merge the inputs[] prompts.
function writeJsonMcpFile(rel, key, entries, authStyle, { stdioType = false, inputs = false } = {}) {
  const path = join(CWD, rel);
  let cur = {};
  if (existsSync(path)) {
    try {
      cur = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      console.log(`      ! ${rel} exists but isn't valid JSON — left untouched`);
      return false;
    }
  }
  cur[key] = cur[key] || {};
  for (const e of entries) cur[key][e.id] = mcpConfigFor(e, authStyle, stdioType);
  if (inputs) {
    const have = new Set((cur.inputs || []).map((i) => i.id));
    const add = mcpInputs(entries).filter((i) => !have.has(i.id));
    if (add.length) cur.inputs = [...(cur.inputs || []), ...add];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
  return true;
}

// Append selected servers to .codex/config.toml as [mcp_servers.<id>] tables, skipping
// any already present (don't clobber), preserving [agents] and other config.
function writeCodexMcp(entries) {
  const file = join(CWD, ".codex", "config.toml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const blocks = entries
    .filter((e) => !new RegExp(`^\\s*\\[mcp_servers\\.${e.id.replace(/[-.]/g, "\\$&")}\\]`, "m").test(before))
    .map(codexMcpToml);
  if (!blocks.length) return false;
  let out = before.replace(/\n+$/, "");
  out = (out ? out + "\n\n" : "") + blocks.join("\n\n") + "\n";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  return true;
}

function writeMcpSelections(targets, ids) {
  const entries = ids.map((id) => MCP_CATALOG.find((m) => m.id === id)).filter(Boolean);
  if (!entries.length) return;
  const wrote = [];
  for (const t of targets) {
    if (t.id === "codex") {
      if (writeCodexMcp(entries)) wrote.push(".codex/config.toml [mcp_servers]");
    } else if (t.id === "copilot") {
      for (const h of MCP_COPILOT) if (writeJsonMcpFile(h.rel, h.key, entries, h.auth, h)) wrote.push(h.rel);
    } else {
      const h = MCP_JSON_HOSTS[t.id] || { rel: ".mcp.json", key: "mcpServers", auth: "literal" };
      if (writeJsonMcpFile(h.rel, h.key, entries, h.auth)) wrote.push(h.rel);
    }
  }
  for (const w of [...new Set(wrote)]) console.log(`      ✓ ${w} (${ids.join(", ")})`);

  // Claude reads secret tokens from .env (headersHelper); seed .env.example with each
  // selected secret server's var. Other hosts carry the secret inline (prompt/env/placeholder).
  const envVars = [...new Set(entries.filter((e) => e.secret).map((e) => e.secret.env))];
  if (envVars.length && targets.some((t) => t.id === "claude")) {
    const envEx = join(CWD, ".env.example");
    let txt = existsSync(envEx) ? readFileSync(envEx, "utf8") : "";
    let changed = false;
    for (const v of envVars) {
      if (!new RegExp(`^${v}=`, "m").test(txt)) {
        txt += (txt && !txt.endsWith("\n") ? "\n" : "") + `${v}=\n`;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(envEx, txt);
      console.log(`      ✓ .env.example (${envVars.join(", ")} — copy to .env, fill, gitignore .env)`);
    }
  }
  console.log(`      ${"ℹ"}  MCP configs use placeholder tokens / secret prompts — fill them and gitignore real secrets`);
}

// Re-write an installed agent's `skills:` line, dropping `removeSet`. Composes
// on top of any bundle overlay already applied (reads the installed copy).
function trimInstalledAgentSkills(target, name, removeSet) {
  const f = target.id === "copilot"
    ? join(CWD, target.dir, "agents", `${name}.agent.md`)
    : join(CWD, target.dir, "agents", name, "AGENT.md");
  if (!existsSync(f)) return;
  const text = readFileSync(f, "utf8");
  const m = text.match(/^skills:\s*\[([^\]]*)\]/m);
  if (!m) return;
  const kept = m[1].split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !removeSet.has(s));
  writeFileSync(f, text.replace(/^skills:\s*\[[^\]]*\]/m, `skills: [${kept.join(", ")}]`));
}

// QA/test bundles that get the interactive MCP-server picker even without the
// quality-architect agent (the specialist/connector menus stay agent-specific).
const INTERACTIVE_BUNDLES = new Set(["test-automation", "manual-qa", "quality-engineering"]);

// Interactive menus. When `qa` is true (quality-architect in the roster) the
// specialist + connector menus run and unticked items are trimmed from Quinn;
// the MCP-server menu always runs. Returns { removeSet, mcpIds }.
async function runInteractive(qa) {
  const removeSet = new Set();
  let wantsOnetest = false;
  if (qa) {
    const SPECIALISTS = [
      { value: "accessibility-audit", label: "Accessibility + WCAG", desc: "axe-core, WCAG 2.1 AA/AAA" },
      { value: "security-audit", label: "Security + OWASP", desc: "XSS, CSRF, headers, secrets" },
      { value: "privacy-audit", label: "Privacy + GDPR", desc: "cookies, trackers, consent" },
      { value: "performance-audit", label: "Performance + CWV", desc: "Core Web Vitals, console, JS" },
      { value: "responsive-audit", label: "Responsive / mobile", desc: "touch targets, viewport" },
      { value: "content-seo-audit", label: "Content + SEO", desc: "copy, meta tags, structured data" },
      { value: "ux-audit", label: "UI/UX + page types", desc: "forms, 20+ page-type checks" },
      { value: "test-generation", label: "Test generation", desc: "coverage-gap proposals" },
      { value: "requirement-traceability", label: "Requirement traceability", desc: "req↔case↔result triangulation" },
    ];
    const INTEGRATIONS = [
      { value: "quality-onboarding", label: "Project onboarding", desc: "build .agents/quality.md", default: true },
      { value: "onetest", label: "OneTest", desc: "TMS adapter + run-sync MCP", default: false },
    ];
    const picksSpec = await selectMany("Specialist skills (QA analysis domains)", SPECIALISTS.map((i) => ({ ...i, default: true })));
    const picksInt = await selectMany("Integration skills (optional connectors)", INTEGRATIONS);
    for (const s of SPECIALISTS) if (!picksSpec.includes(s.value)) removeSet.add(s.value);
    if (!picksInt.includes("quality-onboarding")) removeSet.add("quality-onboarding"); // onetest is wired as an MCP, not a skill
    wantsOnetest = picksInt.includes("onetest");
  }
  const picksMcp = await selectMany("Optional tool integrations (MCP servers)", MCP_CATALOG.map((m) => ({ value: m.id, group: m.group, label: m.label, desc: m.desc, default: false })));
  const mcpIds = [...picksMcp];
  if (wantsOnetest && !mcpIds.includes("onetest")) mcpIds.push("onetest");
  return { removeSet, mcpIds };
}

async function main() {
  const argv = process.argv.slice(2);

  // Subcommand routing — default is install.
  if (argv[0] === "fix-copilot") {
    return runFixCopilot(argv.slice(1));
  }

  const args = parseArgs(argv);

  // Guard: don't silently fall back to a full-catalog install when arguments
  // were passed but couldn't be parsed (a typo'd flag, or a flag+value smashed
  // into one shell token). A loud error beats the wrong install.
  if (args.unknown.length) {
    console.error(`\n  ! Unrecognized argument(s): ${args.unknown.map((t) => `"${t}"`).join(", ")}`);
    console.error(`    Known flags: --agents <list> | --skills <list> | --bundle <id> | --target <list> | --all | --update | --symlink | --yes`);
    console.error(`    Pass each flag and its value as SEPARATE tokens (e.g. \`--bundle feature-development\`, not \`"--bundle feature-development"\`).`);
    console.error(`    To install the entire catalog on purpose, use --all.\n`);
    process.exit(1);
  }

  const catalog = loadCatalog();

  console.log("\n  sdlc-skills — SDLC agents and skills for AI coding assistants\n");
  console.log(
    `  Catalog: ${catalog.agents.length} agent(s), ${catalog.skills.length} skill(s)`
  );

  if (catalog.agents.length === 0 && catalog.skills.length === 0) {
    console.log(
      "\n  ! This repo has no agents or skills yet. Nothing to install.\n"
    );
    return;
  }

  // A --bundle expands into the agent/skill selection before resolution, so
  // each bundle agent's declared skills auto-resolve through the normal path.
  let bundle = null;
  let bundlePlan = null;
  if (args.bundle) {
    bundle = loadBundle(args.bundle);
    bundlePlan = await applyBundle(bundle, args, catalog);
  }

  const { targets, agentsSelection, skillsSelection, externalSkills } =
    await interactivePick(catalog, args);

  // Fold in the bundle's extra skills (team-wide extras + skills declared by
  // local agents), partitioned into monorepo copies vs external clones.
  if (bundlePlan && bundlePlan.extraSkillIds.length) {
    const { monorepo, external, unknown } = partitionSkillIds(
      bundlePlan.extraSkillIds,
      catalog.skills,
      catalog.registry,
      catalog.index
    );
    for (const id of monorepo) if (!skillsSelection.includes(id)) skillsSelection.push(id);
    for (const e of external) if (!externalSkills.some((x) => x.id === e.id)) externalSkills.push(e);
    if (unknown.length) {
      console.log(
        `\n  ! Bundle skills not in skills.json (skipped):\n    ${unknown.join(", ")}`
      );
    }
  }

  // Per-role skill overlays: drop skills a `remove` orphaned (no agent needs
  // them after overlays), and surface `add` skills that aren't authored yet.
  if (bundlePlan && bundlePlan.droppable && bundlePlan.droppable.size) {
    for (let i = skillsSelection.length - 1; i >= 0; i--)
      if (bundlePlan.droppable.has(skillsSelection[i])) skillsSelection.splice(i, 1);
    for (let i = externalSkills.length - 1; i >= 0; i--)
      if (bundlePlan.droppable.has(externalSkills[i].id)) externalSkills.splice(i, 1);
  }
  if (bundlePlan && bundlePlan.pendingAdds && bundlePlan.pendingAdds.length) {
    console.log(
      `\n  ! Skill overlay adds not yet in the catalog (pending content — author + register to enable):\n    ${bundlePlan.pendingAdds.join(", ")}`
    );
  }

  console.log("");
  let installed = 0;
  let skipped = 0;

  // Interactive selection (opt-in). The MCP-server picker runs for the QA/test
  // bundles too; the specialist/connector menus only when quality-architect is in.
  const qaInRoster =
    (agentsSelection || []).includes("quality-architect") ||
    (bundlePlan && (bundlePlan.localAgents || []).includes("quality-architect"));
  const interactiveApplies = qaInRoster || (args.bundle && INTERACTIVE_BUNDLES.has(args.bundle));
  let qaPick = null;
  if (args.interactive && interactiveApplies) {
    if (!process.stdin.isTTY) {
      console.log("\n  ! --interactive needs a terminal — proceeding with defaults.");
    } else {
      qaPick = await runInteractive(qaInRoster);
    }
  } else if (args.interactive) {
    console.log("\n  ! --interactive applies to the quality-architect agent or the test-automation / manual-qa / quality-engineering bundles — ignoring.");
  }

  // Resolve where each standalone-selected agent/skill physically lives.
  const agentSrc = {};
  for (const name of agentsSelection || []) agentSrc[name] = resolveItem(catalog.index, "agents", name);
  const skillSrc = {};
  for (const name of skillsSelection || []) skillSrc[name] = resolveItem(catalog.index, "skills", name);
  for (const [name, r] of [...Object.entries(agentSrc), ...Object.entries(skillSrc)]) {
    if (r && r.ambiguousAcross.length) {
      console.log(`  • "${name}" exists in ${r.ambiguousAcross.join(", ")} — using ${r.bundle}. Qualify as <bundle>/${r.name} to pick another.`);
    }
  }

  for (const t of targets) {
    console.log(`  → ${t.label} (${t.dir}/)`);
    for (const name of agentsSelection) {
      const r = agentSrc[name];
      const res = copyItem("agents", r.name, t, args.update, catalog.registry, r.dir);
      if (res.status === "installed") { console.log(`      ✓ agent  ${r.name}`); installed++; }
      else if (res.status === "exists") { console.log(`      — agent  ${r.name} (exists; use --update)`); skipped++; }
      else { console.log(`      ! agent  ${r.name} (missing)`); }
    }
    if (bundlePlan) {
      for (const name of bundlePlan.localAgents) {
        const r = copyItem(
          "agents",
          name,
          t,
          args.update,
          catalog.registry,
          bundle.dir
        );
        if (r.status === "installed") {
          console.log(`      ✓ agent  ${name} (bundle-local)`);
          installed++;
        } else if (r.status === "exists") {
          console.log(`      — agent  ${name} (exists; use --update)`);
          skipped++;
        } else {
          console.log(`      ! agent  ${name} (missing in bundle)`);
        }
      }
      for (const name of bundlePlan.localSkills) {
        const r = copyItem(
          "skills",
          name,
          t,
          args.update,
          catalog.registry,
          bundle.dir
        );
        if (r.status === "installed") {
          console.log(`      ✓ skill  ${name} (bundle-local)`);
          installed++;
        } else if (r.status === "exists") {
          console.log(`      — skill  ${name} (exists; use --update)`);
          skipped++;
        } else {
          console.log(`      ! skill  ${name} (missing in bundle)`);
        }
      }
    }
    // Apply per-role skill overlays to the installed agents (capability tuning).
    if (bundlePlan && bundlePlan.overlays) {
      for (const role of Object.keys(bundlePlan.overlays)) {
        if (applySkillOverlay(t, role, bundlePlan.effectiveByAgent[role] || [], catalog.registry)) {
          const ov = bundlePlan.overlays[role];
          const bits = [];
          if (ov.add && ov.add.length) bits.push(`+${ov.add.join(",")}`);
          if (ov.remove && ov.remove.length) bits.push(`-${ov.remove.join(",")}`);
          console.log(`      ↻ skills  ${role} (${bits.join(" ")})`);
        }
      }
    }
    for (const name of skillsSelection) {
      const r = skillSrc[name];
      const res = copyItem("skills", r.name, t, args.update, catalog.registry, r.dir);
      if (res.status === "installed") { console.log(`      ✓ skill  ${r.name}`); installed++; }
      else if (res.status === "exists") { console.log(`      — skill  ${r.name} (exists; use --update)`); skipped++; }
      else { console.log(`      ! skill  ${r.name} (missing)`); }
    }
    for (const entry of externalSkills) {
      const r = installExternalSkill(entry, t.dir, args.symlink, args.update);
      if (r.status === "installed") {
        console.log(`      ✓ skill  ${r.name} (external: ${entry.repo}${args.symlink ? ", symlinked" : ""})`);
        installed++;
      } else if (r.status === "exists") {
        console.log(`      — skill  ${r.name} (exists; use --update)`);
        skipped++;
      } else {
        console.log(`      ! skill  ${entry.id} (external fetch failed)`);
      }
    }
  }

  // Apply interactive QA picks: trim quality-architect to the chosen
  // specialists/connectors, then write the selected MCP servers.
  if (qaPick) {
    if (qaPick.removeSet.size) {
      for (const t of targets) trimInstalledAgentSkills(t, "quality-architect", qaPick.removeSet);
      console.log(`\n  → quality-architect tuned (dropped: ${[...qaPick.removeSet].join(", ")})`);
    }
    if (qaPick.mcpIds.length) {
      console.log(`\n  → MCP servers`);
      writeMcpSelections(targets, qaPick.mcpIds);
    }
  }

  // Non-interactive MCP install (--mcp a,b,c), independent of the QA picker.
  if (args.mcp && args.mcp.length) {
    console.log(`\n  → MCP servers`);
    writeMcpSelections(targets, args.mcp);
  }

  // Core hooks (per-role memory + lean .agents/*.md context injection) land in
  // each selected runtime's native hook format. Every install, not just bundles.
  // A bare `--mcp` run is MCP-only — the user just wants the server configs, not a
  // full project wiring — so skip the per-role memory/context hooks in that case.
  const mcpOnly =
    args.mcp && args.mcp.length && args.agents === null && args.skills === null && !args.all && !args.bundle;
  if (!mcpOnly && existsSync(join(PKG_ROOT, "hooks"))) {
    console.log(`\n  → hooks (memory + project-context injection)`);
    installCoreHooks(targets);
  }

  // Briefing overlays land once in .agents/ (IDE-neutral), not per target.
  if (bundle && (Object.keys(bundle.briefings).length || (bundle._resolvedBriefings && Object.keys(bundle._resolvedBriefings).length))) {
    console.log(`\n  → .agents/memory/ (shared, all IDEs)`);
    const b = installBriefings(bundle, args.update);
    installed += b.installed;
    skipped += b.skipped;
  }

  // Team instructions splice once into root context files (idempotent).
  if (bundle && bundle.instructions) {
    console.log(`\n  → project root (team instructions)`);
    installInstructions(bundle);
  }

  // Seed reference files into the project (idempotent; IDE-neutral).
  if (bundle && bundle.seed && Object.keys(bundle.seed).length) {
    console.log(`\n  → project (seed reference files)`);
    const s = installSeed(bundle, args.update);
    installed += s.installed;
    skipped += s.skipped;
  }

  // Hooks merge into each Claude target's settings.json (idempotent).
  if (bundle && bundle.hooks) {
    console.log(`\n  → hooks (settings.json)`);
    installHooks(bundle, targets);
  }

  const launchNames = targets.map((t) => t.label).join(", ");
  console.log(
    `\n  Done: ${installed} installed, ${skipped} skipped.` +
      (installed > 0
        ? `\n  Launch ${launchNames} in this project to use them.`
        : "") +
      "\n"
  );
}

// Detect "run as the main module" robustly. npx/npm invoke the `init` bin
// through a symlink in node_modules/.bin/, so process.argv[1] is the symlink
// path while import.meta.url resolves to the realpath of this file — a direct
// string compare fails there and main() would silently never run. Resolve both
// through realpath before comparing.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Install failed:", err.message);
    process.exit(1);
  });
}
