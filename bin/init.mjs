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

function copyItem(kind, name, target, update, registry) {
  // kind: "agents" | "skills"; target: {id, dir, label}
  const src = join(PKG_ROOT, kind, name);
  if (!existsSync(src)) return { status: "missing" };

  // GitHub Copilot CLI expects agents as flat `<name>.agent.md` files,
  // not directories. Flatten AGENT.md + SOUL.md into a single file.
  if (kind === "agents" && target.id === "copilot") {
    return flattenAgentForCopilot(src, name, target.dir, update, registry);
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
    // Map agentskills.io / Claude Code's short-form model aliases to
    // Anthropic's canonical model IDs (dashed form, matching the SDK).
    // Copilot CLI requires a concrete ID — shipping `model: sonnet`
    // leaves Copilot unable to resolve a provider. Keep this map in
    // lockstep with the current Claude model family; one-line edit on
    // a family bump.
    const COPILOT_MODEL_MAP = {
      sonnet: "claude-sonnet-4-6",
      opus: "claude-opus-4-7",
      haiku: "claude-haiku-4-5",
    };
    agent = agent.replace(
      /^model:\s*(sonnet|opus|haiku)\s*$/m,
      (_, alias) => `model: ${COPILOT_MODEL_MAP[alias]}`,
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

  const { targets, agentsSelection, skillsSelection, externalSkills } =
    await interactivePick(catalog, args);

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
