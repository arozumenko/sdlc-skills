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
 *   2. This CLI (works for Claude Code, Cursor, Windsurf, GitHub Copilot —
 *      copies agents and skills directly into the IDE dirs):
 *        npx github:arozumenko/sdlc-skills init
 *        npx github:arozumenko/sdlc-skills init --all
 *        npx github:arozumenko/sdlc-skills init --agents ba,tech-lead,pm
 *        npx github:arozumenko/sdlc-skills init --skills bugfix-workflow,code-review
 *        npx github:arozumenko/sdlc-skills init --agents all --skills all
 *        npx github:arozumenko/sdlc-skills init --update   # overwrite existing
 *        npx github:arozumenko/sdlc-skills init --target claude
 *
 *   3. agentskills.io / Vercel / any third-party tool: point directly at
 *      skills/<name>/SKILL.md — the agentskills.io spec frontmatter is
 *      authoritative at that path.
 *
 * This installer only covers modes 1 and 2. The plugin marketplace path
 * is handled natively by Claude Code and does not invoke this script.
 */

import {
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
];

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

function installExternalSkill(entry, targetDir) {
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
  const link = join(skillsDir, skillName);
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
    // Already present. Don't overwrite unless --update (handled upstream).
    return { status: "exists", name: skillName };
  }
  try {
    symlinkSync(src, link);
    return { status: "installed", name: skillName };
  } catch (err) {
    console.error(`  ! symlink ${src} → ${link} failed: ${err.message}`);
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
// install instructions. The supervisor resolves them automatically via
// skills.json `repo:` entries; stock Claude users follow the README.
// ---------------------------------------------------------------------------

function parseAgentSkillDeps(agentName) {
  const agentMd = join(PKG_ROOT, "agents", agentName, "AGENT.md");
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

function inferSkillsFromAgents(agentNames, availableSkills, registry) {
  const declared = new Set();
  for (const name of agentNames) {
    for (const skill of parseAgentSkillDeps(name)) declared.add(skill);
  }
  const monorepo = [];
  const external = [];
  const unknown = [];
  for (const id of declared) {
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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--update") out.update = true;
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
    --all                      Install every agent and every skill (no prompts)
    --agents <a,b,c|all>       Install only these agents (or all)
    --skills  <a,b,c|all>      Install only these skills (or all)
    --target <claude,cursor,…> Limit IDE targets (default: all detected)
    --update                   Overwrite existing installs
    --yes                      Skip the interactive "detected IDE" prompt
    -h, --help                 Show this help

  Examples:
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

function copyItem(kind, name, targetDir, update) {
  // kind: "agents" | "skills"
  const src = join(PKG_ROOT, kind, name);
  if (!existsSync(src)) return { status: "missing" };
  const dest = join(CWD, targetDir, kind, name);
  if (existsSync(dest) && !update) return { status: "exists", dest };
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: update });
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

  // If neither --agents nor --skills nor --all was passed, default to all.
  let agentsSelection = resolveSelection(args.agents, catalog.agents, "agent");
  let skillsSelection = resolveSelection(args.skills, catalog.skills, "skill");
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
        // Stash externals on the return so main() can install them after
        // the monorepo-skills loop.
        return { targets, agentsSelection, skillsSelection, externalSkills: external };
      } else {
        skillsSelection = [];
      }
    }
  }

  return { targets, agentsSelection, skillsSelection, externalSkills: [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

  const { targets, agentsSelection, skillsSelection, externalSkills } =
    await interactivePick(catalog, args);

  console.log("");
  let installed = 0;
  let skipped = 0;

  for (const t of targets) {
    console.log(`  → ${t.label} (${t.dir}/)`);
    for (const name of agentsSelection) {
      const r = copyItem("agents", name, t.dir, args.update);
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
    for (const name of skillsSelection) {
      const r = copyItem("skills", name, t.dir, args.update);
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
      const r = installExternalSkill(entry, t.dir);
      if (r.status === "installed") {
        console.log(`      ✓ skill  ${r.name} (external: ${entry.repo})`);
        installed++;
      } else if (r.status === "exists") {
        console.log(`      — skill  ${r.name} (exists; use --update)`);
        skipped++;
      } else {
        console.log(`      ! skill  ${entry.id} (external fetch failed)`);
      }
    }
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
