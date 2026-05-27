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
 *      → `model: claude-sonnet-4.6`. Other targets keep the directory
 *      layout.
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
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, dirname, basename, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
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

// Claude Code / agentskills.io short-form model aliases → Anthropic's canonical
// dashed model IDs. Hosts that need a concrete provider id (Copilot CLI, Codex)
// can't resolve a bare `sonnet`. Keep in lockstep with the current model family.
const MODEL_ALIASES = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
};

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

function loadCatalog() {
  return {
    agents: listDirs("agents"),
    skills: listDirs("skills"),
    registry: loadSkillRegistry(),
  };
}

// ---------------------------------------------------------------------------
// Bundles — bundles/<id>/bundle.json describes a curated team: which shared
// agents to install, any team-wide extra skills, per-role briefing overlays,
// team instructions, and hooks. See bundles/SPEC.md. A bundle expands into
// the normal agent/skill install path: its `agents` populate the agent
// selection (so each agent's declared skills auto-resolve as usual) and its
// `skills` are appended as extras. `localAgents` live in bundles/<id>/agents/
// and install like shared agents but from the bundle dir.
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
  b.briefings = b.briefings || {};
  b.skillOverlays = b.skillOverlays || {}; // role -> { add: [], remove: [] }
  b.seed = b.seed || {}; // bundle-relative source → project-relative dest (reference files)
  return b;
}

// Validate a bundle against the catalog and resolve the skills its local
// agents declare. Returns { localAgents, extraSkillIds } and mutates
// args.agents to include the bundle's shared agents.
function applyBundle(bundle, args, catalog) {
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
  for (const role of Object.keys(overlays)) {
    if (!args.agents.includes(role)) {
      console.error(`  ! Bundle ${bundle.id} skillOverlay targets "${role}", not in the team`);
      process.exit(1);
    }
  }
  const declaredOf = (a) =>
    catalog.agents.includes(a)
      ? parseAgentSkillDeps(a)
      : parseAgentSkillDeps(a, bundleAgentsRoot);
  const isResolvable = (id) => {
    const e = registryEntry(catalog.registry, id);
    return catalog.skills.includes(id) || !!(e && e.repo);
  };
  const effectiveByAgent = {};
  const neededByAny = new Set();
  const allDeclared = new Set();
  const resolvableAdds = new Set();
  const pendingAdds = new Set();
  for (const a of args.agents) {
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

  const extraSkillIds = [...new Set([...bundle.skills, ...localDeclared, ...resolvableAdds])];

  console.log(
    `  Bundle: ${bundle.title || bundle.id} — ${bundle.agents.length} shared agent(s)` +
      (bundle.localAgents.length ? `, ${bundle.localAgents.length} local agent(s)` : "") +
      (Object.keys(overlays).length ? `, ${Object.keys(overlays).length} skill overlay(s)` : "") +
      (extraSkillIds.length ? `, ${extraSkillIds.length} extra skill(s)` : "")
  );

  return {
    localAgents: bundle.localAgents,
    bundleAgentsRoot,
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
  for (const [role, rel] of Object.entries(bundle.briefings)) {
    const src = join(bundle.dir, rel);
    if (!existsSync(src)) {
      console.log(`      ! briefing ${role} (missing in bundle: ${rel})`);
      continue;
    }
    const destDir = join(CWD, ".agents", "memory", role);
    const dest = join(destDir, "project_briefing.md");
    if (existsSync(dest) && !update) {
      console.log(`      — briefing ${role} (exists; use --update)`);
      skipped++;
      continue;
    }
    mkdirSync(destDir, { recursive: true });
    const content = readFileSync(src, "utf8");
    writeFileSync(dest, content);
    // Per the memory skill spec, the index line carries the entry's own
    // description. Pull it from the briefing's frontmatter.
    const dm = content.match(/^description:\s*(.+)$/m);
    ensureMemoryIndexLine(destDir, role, dm ? dm[1].trim() : "Project overview and this role's focus");
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
    cpSync(srcPath, destPath, { recursive: true, force: true });
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
      cpSync(scriptsSrc, scriptsDest, { recursive: true, force: true });
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
// executables +x.
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
      const entry = (verb) => ({
        type: "command",
        bash: `"./${rel}/run-hook.cmd" ${verb}`,
        powershell: `& "./${rel}/run-hook.cmd" ${verb}`,
        env: { COPILOT_CLI: "1" },
        timeoutSec: 10,
      });
      // .github/hooks/<name>.json is an sdlc-owned file — write it wholesale.
      const spec = {
        version: 1,
        hooks: {
          sessionStart: [entry("session-start")],
          subagentStart: [entry("agent-start")],
        },
      };
      mkdirSync(join(CWD, ".github", "hooks"), { recursive: true });
      writeFileSync(
        join(CWD, ".github", "hooks", "sdlc-skills.json"),
        JSON.stringify(spec, null, 2) + "\n"
      );
      console.log(`      ✓ hooks GitHub Copilot (.github/hooks/sdlc-skills.json)`);
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

function loadSkillRegistry() {
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
      // project tree itself (git/zip/Docker/sandbox/Windows-safe).
      cpSync(src, dest, { recursive: true, dereference: true });
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

function partitionSkillIds(ids, availableSkills, registry) {
  const monorepo = [];
  const external = [];
  const unknown = [];
  for (const id of ids) {
    if (availableSkills.includes(id)) {
      monorepo.push(id);
      continue;
    }
    const entry = registryEntry(registry, id);
    if (entry && entry.repo) external.push(entry);
    else unknown.push(id);
  }
  return { monorepo, external, unknown };
}

function inferSkillsFromAgents(agentNames, availableSkills, registry) {
  const declared = new Set();
  for (const name of agentNames) {
    for (const skill of parseAgentSkillDeps(name)) declared.add(skill);
  }
  return partitionSkillIds([...declared], availableSkills, registry);
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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--update") out.update = true;
    else if (a === "--symlink") out.symlink = true;
    else if (a === "--bundle") out.bundle = (argv[++i] || "").trim();
    else if (a === "--agents") out.agents = splitList(argv[++i]);
    else if (a === "--skills") out.skills = splitList(argv[++i]);
    else if (a === "--target") out.targets = splitList(argv[++i]);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
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
    --symlink                  Symlink external skills from the shared cache
                               instead of copying them (default: copy, which
                               is self-contained and portable across runtimes)
    --yes                      Skip the interactive "detected IDE" prompt
    -h, --help                 Show this help

  Examples:
    npx github:arozumenko/sdlc-skills init --bundle team-web
    npx github:arozumenko/sdlc-skills init --bundle team-ios --target claude
    npx github:arozumenko/sdlc-skills init --all
    npx github:arozumenko/sdlc-skills init --agents ba,tech-lead --skills bugfix-workflow
    npx github:arozumenko/sdlc-skills init --agents all --target claude --update
`);
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

function resolveSelection(requested, available, kind) {
  if (requested === null) return null; // not specified — ask later
  if (requested.length === 0) return [];
  if (requested.length === 1 && requested[0] === "all") return available;
  const unknown = requested.filter((r) => !available.includes(r));
  if (unknown.length) {
    console.error(`  ! Unknown ${kind}: ${unknown.join(", ")}`);
    console.error(`    Available: ${available.join(", ") || "(none)"}`);
    process.exit(1);
  }
  return requested;
}

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
  cpSync(src, dest, { recursive: true, force: update });

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
      // The in-file reference is rewritten as an `@`-prefixed auto-import
      // directive (same convention as the existing
      // `@.agents/memory/<name>/snapshot.md` line): Claude Code loads
      // the file into context automatically, and on hosts that don't
      // honor `@`-imports the agent still sees the path and can read it.
      soul = soulText;
      agent = agent.replace(
        SOUL_REF,
        `@.agents/memory/${name}/SOUL.md`,
      );
    }
  }

  if (normalizeModel) {
    // Copilot CLI requires a concrete provider id — shipping `model: sonnet`
    // leaves it unable to resolve. Map to the canonical dashed id (MODEL_ALIASES).
    agent = agent.replace(
      /^model:\s*(sonnet|opus|haiku)\s*$/m,
      (_, alias) => `model: ${MODEL_ALIASES[alias]}`,
    );
  }

  // Inject the skills-inventory section as the final transform step so
  // it lands in Copilot's flat `.agent.md` file too (Copilot ignores
  // unknown frontmatter keys, so without this the `skills:` list is
  // invisible to the agent at runtime).
  if (registry) {
    agent = injectSkillsSection(agent, name, registry);
  }

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

function transformAgentForCodex(agentText, soulText, name, { normalizeModel = true } = {}) {
  const fm = agentText.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/m);
  const frontmatter = fm ? fm[1] : "";
  let body = fm ? agentText.slice(fm.index + fm[0].length) : agentText;

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const description = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, "") : `${name} agent`;
  const modelMatch = frontmatter.match(/^model:\s*(.+)$/m);
  let model = modelMatch ? modelMatch[1].trim() : null;
  if (model && normalizeModel && MODEL_ALIASES[model]) model = MODEL_ALIASES[model];

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
    name,
    { normalizeModel: true }
  );
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, toml);
  return { status: "installed", dest };
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
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
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (detected.length === 0) {
        console.log("  No IDE directories detected. Installing to .claude/");
        targets = [TARGETS[0]];
      } else {
        console.log("  Detected IDE directories:");
        detected.forEach((t, i) =>
          console.log(`    ${i + 1}. ${t.label} (${t.dir}/)`)
        );
        console.log("    a. All of the above\n");
        const choice =
          (await ask(rl, "  Install to which? [a]: ")).trim().toLowerCase() ||
          "a";
        targets =
          choice === "a"
            ? detected
            : [detected[parseInt(choice) - 1] || detected[0]];
      }
    } finally {
      rl.close();
    }
  }

  // Resolve agents via strict monorepo-only check.
  let agentsSelection = resolveSelection(args.agents, catalog.agents, "agent");

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
    // Neither specified and not --all → install everything by default,
    // but print what we're doing so users aren't surprised.
    console.log(
      "\n  No --agents / --skills specified. Installing full catalog.\n  (Use --agents or --skills to narrow.)"
    );
    agentsSelection = catalog.agents;
    skillsSelection = catalog.skills;
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
          catalog.registry
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
                            to 'model: claude-sonnet-4.6' for Copilot CLI)
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

async function main() {
  const argv = process.argv.slice(2);

  // Subcommand routing — default is install.
  if (argv[0] === "fix-copilot") {
    return runFixCopilot(argv.slice(1));
  }

  const args = parseArgs(argv);
  const catalog = loadCatalog();

  console.log("\n  sdlc-skills — SDLC agents and skills for Claude Code\n");
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
    bundlePlan = applyBundle(bundle, args, catalog);
  }

  const { targets, agentsSelection, skillsSelection, externalSkills } =
    await interactivePick(catalog, args);

  // Fold in the bundle's extra skills (team-wide extras + skills declared by
  // local agents), partitioned into monorepo copies vs external clones.
  if (bundlePlan && bundlePlan.extraSkillIds.length) {
    const { monorepo, external, unknown } = partitionSkillIds(
      bundlePlan.extraSkillIds,
      catalog.skills,
      catalog.registry
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

  for (const t of targets) {
    console.log(`  → ${t.label} (${t.dir}/)`);
    for (const name of agentsSelection) {
      const r = copyItem("agents", name, t, args.update, catalog.registry);
      if (r.status === "installed") {
        console.log(`      ✓ agent  ${name}`);
        installed++;
      } else if (r.status === "exists") {
        console.log(`      — agent  ${name} (exists; use --update)`);
        skipped++;
      } else {
        console.log(`      ! agent  ${name} (missing in repo)`);
      }
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
      const r = copyItem("skills", name, t, args.update, catalog.registry);
      if (r.status === "installed") {
        console.log(`      ✓ skill  ${name}`);
        installed++;
      } else if (r.status === "exists") {
        console.log(`      — skill  ${name} (exists; use --update)`);
        skipped++;
      } else {
        console.log(`      ! skill  ${name} (missing in repo)`);
      }
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

  // Core hooks (per-role memory + lean .agents/*.md context injection) land in
  // each selected runtime's native hook format. Every install, not just bundles.
  if (existsSync(join(PKG_ROOT, "hooks"))) {
    console.log(`\n  → hooks (memory + project-context injection)`);
    installCoreHooks(targets);
  }

  // Briefing overlays land once in .agents/ (IDE-neutral), not per target.
  if (bundle && Object.keys(bundle.briefings).length) {
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

  console.log(
    `\n  Done: ${installed} installed, ${skipped} skipped.` +
      (installed > 0
        ? "\n  Launch Claude Code in this project to use them."
        : "") +
      "\n"
  );
}

main().catch((err) => {
  console.error("Install failed:", err.message);
  process.exit(1);
});
