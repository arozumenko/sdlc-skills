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
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

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
  };
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
    if (skillsSelection === null) skillsSelection = [];
  }

  return { targets, agentsSelection, skillsSelection };
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

  const { targets, agentsSelection, skillsSelection } = await interactivePick(
    catalog,
    args
  );

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
