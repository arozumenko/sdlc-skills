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
 *      To re-apply deployment-mode marker stripping after an update
 *      (the installer re-introduces OCTOBOTS-ONLY / STANDALONE-ONLY
 *      blocks every time it copies fresh source files; this subcommand
 *      strips the inactive mode's blocks from installed agent files):
 *        npx github:arozumenko/sdlc-skills init strip
 *        npx github:arozumenko/sdlc-skills init strip --mode standalone
 *        npx github:arozumenko/sdlc-skills init strip --dry-run
 *        npx github:arozumenko/sdlc-skills init strip --help
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
//   external entry: {id, repo: "owner/repo", ref, subdir?} → git clone to
//                   ~/.cache/sdlc-skills/registry/<repo>/, then copy the
//                   subdir into the project's skills/ directory. The
//                   project tree stays self-contained (committable,
//                   portable, CI-safe). Older releases symlinked instead;
//                   legacy installs auto-migrate to real copies.
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

function installExternalSkill(entry, targetDir, update) {
  // External skills are git-cloned to a shared cache under
  // ~/.cache/sdlc-skills/registry/, then COPIED into the project's skills
  // directory so the project tree is self-contained (committable, portable
  // across machines, surviveable on CI without the cache populated).
  //
  // Older sdlc-skills releases symlinked from cache into the project — that
  // saved disk but produced dangling links the moment the repo was cloned
  // by anyone else. Legacy symlink installs are auto-migrated to copies
  // here regardless of --update, because keeping a broken symlink is never
  // the user's intent.
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

  // Three states for `dest`:
  //   1. absent          → install fresh
  //   2. symlink         → legacy install; always replace with a real copy
  //                        (regardless of --update — symlinks are never the
  //                        intended target shape)
  //   3. real directory  → respect --update: replace if true, skip if false
  const destStat = lstatSync(dest, { throwIfNoEntry: false });
  let migratedFromSymlink = false;
  if (destStat) {
    if (destStat.isSymbolicLink()) {
      unlinkSync(dest);
      migratedFromSymlink = true;
    } else if (!update) {
      return { status: "exists", name: skillName };
    } else {
      rmSync(dest, { recursive: true, force: true });
    }
  }

  try {
    cpSync(src, dest, { recursive: true, dereference: true, force: true });
    return {
      status: migratedFromSymlink ? "migrated" : "installed",
      name: skillName,
    };
  } catch (err) {
    console.error(`  ! copy ${src} → ${dest} failed: ${err.message}`);
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
  const unknown = [];
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
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length) {
    // Catch the two failure modes that used to fail silently:
    //   1. Typo'd flags (`--moe standalone` instead of `--mode`)
    //   2. Shell-split list args (`--skills a,b,c, d,e` becomes `--skills a,b,c,`
    //      plus positional `d,e` — only the first chunk made it through).
    // Both are silent under-installs in the old parser. Now they're loud.
    console.error(
      `\n  ! Unrecognised argument(s) for 'init': ${unknown.join(", ")}\n`,
    );
    const looksCommaSplit = unknown.some(
      (a) => a.includes(",") && !a.startsWith("-"),
    );
    if (looksCommaSplit) {
      console.error(
        "  Looks like a comma-separated list was split by the shell. Common cause:",
      );
      console.error(
        "    --skills a,b,c, d,e   ← space after a comma → shell splits at the space.",
      );
      console.error("  Fix: remove the spaces, or quote the whole list:");
      console.error('    --skills "a,b,c,d,e"   (or just --skills a,b,c,d,e)');
    }
    const looksLikeStripFlag = unknown.some((a) =>
      ["--mode", "--dir", "--dry-run"].includes(a),
    );
    if (looksLikeStripFlag) {
      console.error(
        "\n  '--mode', '--dir', and '--dry-run' belong to the 'init strip' subcommand,",
      );
      console.error(
        "  not 'init' itself. Run them separately:",
      );
      console.error(
        "    npx ... init --update --agents X,Y --skills A,B,C",
      );
      console.error(
        "    npx ... init strip          # re-applies deployment-mode marker stripping",
      );
    }
    console.error("\n  Re-run with --help to see supported flags.\n");
    process.exit(1);
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

  Subcommands:
    init fix-copilot           Flatten .github/agents/<name>/ → <name>.agent.md
    init strip                 Re-apply deployment-mode marker stripping
                               (run after --update to remove the re-introduced
                               OCTOBOTS-ONLY / STANDALONE-ONLY blocks)
    init <subcommand> --help   Subcommand-specific help
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

  // `workspace:` is preserved verbatim — it's an octobots-supervisor
  // hint with no Copilot runtime today, but harmless to keep, and
  // octobots may read the flat Copilot file in coexistence scenarios.

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
  // `repo:` entries, then copied into the target dir — see
  // installExternalSkill for details on cache + copy semantics).
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
    // (`repo:` entries in skills.json) are cloned to the shared cache
    // and copied into the target dir. Unknown skill ids (not in
    // skills.json at all) are warned and skipped.
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

// ---------------------------------------------------------------------------
// strip subcommand — re-apply deployment-mode marker stripping after the
// installer copied fresh source files on top of a previously-stripped
// install. Mirrors what scout's project-seeder Step 6.95 does, but
// callable standalone so the operator doesn't have to launch scout just
// to re-strip.
//
// Mode resolution order:
//   1. --mode flag (explicit override)
//   2. `.agents/profile.md § Deployment mode` (what scout wrote on first seed)
//   3. Default: `octobots` — because the Octobots supervisor's install.sh
//      delegates to this installer, and a no-flag call from there should
//      keep OCTOBOTS-ONLY content. Standalone users either let the
//      profile.md auto-detect kick in (set once by scout) or pass
//      `--mode standalone` explicitly.
// ---------------------------------------------------------------------------

const STRIP_VALID_MODES = ["octobots", "standalone", "taskbox"];
const STRIP_AGENT_DIRS = [
  ".claude/agents",
  ".cursor/agents",
  ".windsurf/agents",
  ".github/agents",
];

function parseStripArgs(argv) {
  const out = { mode: null, dirs: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      const v = argv[++i];
      if (!STRIP_VALID_MODES.includes(v)) {
        console.error(
          `  ! Invalid --mode: ${v} (expected: ${STRIP_VALID_MODES.join("|")})`,
        );
        process.exit(1);
      }
      out.mode = v;
    } else if (a === "--dir") {
      out.dirs.push(argv[++i]);
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "-h" || a === "--help") {
      printStripHelp();
      process.exit(0);
    } else {
      console.error(`  ! Unknown flag for strip: ${a}`);
      printStripHelp();
      process.exit(1);
    }
  }
  return out;
}

function printStripHelp() {
  console.log(`
  sdlc-skills strip — re-apply deployment-mode marker stripping

  Removes the inactive mode's marker-bracketed regions from every
  installed agent file (AGENT.md / SOUL.md / RULES.md for directory
  layouts, <name>.agent.md for Copilot's flat layout).

  Mode targets:
    octobots   → strip STANDALONE-ONLY blocks; keep OCTOBOTS-ONLY (default)
    standalone → strip OCTOBOTS-ONLY blocks; keep STANDALONE-ONLY
    taskbox    → same as octobots

  Mode resolution:
    1. --mode flag (explicit override)
    2. .agents/profile.md § Deployment mode (set by scout on first seed)
    3. Default: octobots (Octobots install.sh delegates to this installer)

  Both block markers and inline markers are removed:
    <!-- TARGET: START -->...<!-- TARGET: END -->
    <!-- TARGET: inline START -->...<!-- TARGET: inline END -->

  Options:
    --mode <m>       octobots | standalone | taskbox
    --dir <path>     Agents directory to scan; repeatable. Default:
                     every detected install dir from
                       .claude/agents, .cursor/agents,
                       .windsurf/agents, .github/agents
    --dry-run        Preview; don't write
    -h, --help       Show this help

  Examples:
    npx github:arozumenko/sdlc-skills init strip
    npx github:arozumenko/sdlc-skills init strip --mode standalone
    npx github:arozumenko/sdlc-skills init strip --dir .claude/agents --dry-run
`);
}

function readProfileDeploymentMode() {
  const profile = join(CWD, ".agents", "profile.md");
  if (!existsSync(profile)) return null;
  let text;
  try {
    text = readFileSync(profile, "utf8");
  } catch {
    return null;
  }
  // Find the `## Deployment mode` section (stop at the next `## ` or EOF).
  const section = text.match(/##\s+Deployment mode[\s\S]*?(?=\n##\s+|$)/i);
  if (!section) return null;
  // Pull `Mode: <value>` (tolerate `**Mode**:`, `- **Mode:**`, etc.).
  const m = section[0].match(/[-*]?\s*\*{0,2}Mode\*{0,2}\s*:\s*([A-Za-z]+)/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return STRIP_VALID_MODES.includes(v) ? v : null;
}

function stripDeploymentMarkers(text, target) {
  // target is the marker prefix to remove (e.g. "OCTOBOTS-ONLY").
  // Block form — match the whole region including a trailing newline so
  // we don't leave a stranded blank line on every strip.
  const blockPat = new RegExp(
    `[ \\t]*<!--\\s*${target}:\\s*START\\s*-->[\\s\\S]*?<!--\\s*${target}:\\s*END\\s*-->[ \\t]*\\n?`,
    "g",
  );
  // Inline form — leave surrounding text in place, only excise the
  // marker pair and what sits between them on the same logical paragraph.
  const inlinePat = new RegExp(
    `<!--\\s*${target}:\\s*inline\\s+START\\s*-->[\\s\\S]*?<!--\\s*${target}:\\s*inline\\s+END\\s*-->`,
    "g",
  );
  let stripped = text.replace(blockPat, "").replace(inlinePat, "");
  // Collapse 3+ blank lines (often left behind by adjacent block strips)
  // down to 2 — preserves intentional paragraph breaks, removes noise.
  stripped = stripped.replace(/\n{3,}/g, "\n\n");
  return stripped;
}

function countDeploymentMarkers(text, target) {
  const block = (text.match(
    new RegExp(`<!--\\s*${target}:\\s*START\\s*-->`, "g"),
  ) || []).length;
  const inline = (text.match(
    new RegExp(`<!--\\s*${target}:\\s*inline\\s+START\\s*-->`, "g"),
  ) || []).length;
  return block + inline;
}

function findInstalledAgentFiles(rootRelDir) {
  const abs = resolve(CWD, rootRelDir);
  if (!existsSync(abs)) return [];
  const files = [];
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const p = join(abs, entry.name);
    if (entry.isDirectory()) {
      // Directory layout (Claude / Cursor / Windsurf, or pre-fix-copilot
      // Copilot installs): pick up AGENT.md, SOUL.md, RULES.md when
      // present. Anything else in the dir (references/, etc.) is left
      // alone — those don't carry deployment markers.
      for (const fname of ["AGENT.md", "SOUL.md", "RULES.md"]) {
        const fpath = join(p, fname);
        if (existsSync(fpath)) files.push(fpath);
      }
    } else if (entry.isFile() && entry.name.endsWith(".agent.md")) {
      // Flat layout (Copilot CLI after install --target copilot or
      // fix-copilot): one file per agent.
      files.push(p);
    }
  }
  return files;
}

function runStrip(argv) {
  const opts = parseStripArgs(argv);

  // Resolve mode: flag → profile → default.
  let mode = opts.mode;
  let modeSource = mode ? "--mode flag" : null;
  if (!mode) {
    const profileMode = readProfileDeploymentMode();
    if (profileMode) {
      mode = profileMode;
      modeSource = ".agents/profile.md § Deployment mode";
    }
  }
  if (!mode) {
    mode = "octobots";
    modeSource = "default (no --mode, no profile.md)";
  }

  const target = mode === "standalone" ? "OCTOBOTS-ONLY" : "STANDALONE-ONLY";

  // Resolve target directories.
  const dirs = opts.dirs.length > 0
    ? opts.dirs
    : STRIP_AGENT_DIRS.filter((d) => existsSync(join(CWD, d)));

  if (dirs.length === 0) {
    console.error(
      "  ! No agent directories found. Run from a project root with agents installed,",
    );
    console.error(
      "    or pass --dir <path> to point at a specific install location.",
    );
    process.exit(1);
  }

  console.log(`\n  sdlc-skills strip — mode=${mode} (${modeSource})`);
  console.log(`  Removing: <!-- ${target}: ... --> blocks (paired + inline)`);
  if (opts.dryRun) console.log("  DRY RUN — nothing will be written.\n");
  else console.log("");

  let touched = 0;
  let clean = 0;
  let totalRegions = 0;

  for (const dir of dirs) {
    const files = findInstalledAgentFiles(dir);
    if (files.length === 0) continue;
    console.log(`  → ${dir}/`);
    for (const fpath of files) {
      const text = readFileSync(fpath, "utf8");
      const count = countDeploymentMarkers(text, target);
      const rel = fpath.replace(CWD + "/", "");
      if (count === 0) {
        clean++;
        continue;
      }
      const stripped = stripDeploymentMarkers(text, target);
      console.log(`      ✓ ${rel} — stripped ${count} region(s)`);
      totalRegions += count;
      touched++;
      if (!opts.dryRun) writeFileSync(fpath, stripped);
    }
  }

  console.log(
    `\n  Done: ${touched} file(s) ${opts.dryRun ? "would be" : ""} touched (${totalRegions} regions), ${clean} already clean.\n`,
  );
}

async function main() {
  const argv = process.argv.slice(2);

  // Subcommand routing — default is install.
  if (argv[0] === "fix-copilot") {
    return runFixCopilot(argv.slice(1));
  }
  if (argv[0] === "strip") {
    return runStrip(argv.slice(1));
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
      const r = installExternalSkill(entry, t.dir, args.update);
      if (r.status === "installed") {
        console.log(`      ✓ skill  ${r.name} (external: ${entry.repo})`);
        installed++;
      } else if (r.status === "migrated") {
        console.log(
          `      ✓ skill  ${r.name} (external: ${entry.repo}) — migrated from symlink to real copy`,
        );
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
