#!/usr/bin/env node
/**
 * Generate per-runtime plugin marketplace manifests from the catalog so they
 * never drift from the agents/, skills/, and skills.json sources.
 *
 * Each marketplace lists an umbrella "full toolkit" entry plus individual
 * agent/skill entries, filtered by what that runtime's plugin system can ship:
 *
 *   Cursor  -> agents (dir-structured, kept as-is) + skills + hooks
 *   Codex   -> skills + hooks            (no documented plugin `agents` field)
 *   Copilot -> skills + hooks            (plugin agents must be flat .agent.md;
 *                                         our agents install via the npx CLI)
 *
 * Claude Code's .claude-plugin/marketplace.json is hand-curated and left alone.
 *
 *   node bin/gen-marketplaces.mjs            # write the files
 *   node bin/gen-marketplaces.mjs --check    # fail if any file is stale (CI)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version || "0.0.0";
const OWNER = { name: "Artem Rozumenko", url: "https://github.com/arozumenko" };

const UMBRELLA = {
  name: "sdlc-skills",
  source: "./",
  description:
    "Full SDLC toolkit — role-based agents, workflow skills, and session/subagent hooks (per-role memory + lean .agents/*.md project-context injection).",
  version: VERSION,
};

const RUNTIMES = [
  { id: "cursor", out: ".cursor-plugin/marketplace.json", agents: true, skills: true },
  { id: "codex", out: ".codex-plugin/marketplace.json", agents: false, skills: true },
  { id: "copilot", out: ".github/plugin/marketplace.json", agents: false, skills: true },
];

function listDirs(parent) {
  const root = join(PKG_ROOT, parent);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => !n.startsWith(".") && n !== "README.md")
    .filter((n) => {
      try {
        return statSync(join(root, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function frontmatterField(file, field) {
  if (!existsSync(file)) return null;
  const fm = readFileSync(file, "utf8").match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function skillDescriptions() {
  const out = {};
  const reg = join(PKG_ROOT, "skills.json");
  if (existsSync(reg)) {
    try {
      for (const s of JSON.parse(readFileSync(reg, "utf8")).skills || [])
        if (s.id && s.description) out[s.id] = s.description;
    } catch {
      /* ignore */
    }
  }
  return out;
}

function buildPlugins(rt, agents, skills, skillDescs) {
  const plugins = [UMBRELLA];
  if (rt.agents) {
    for (const a of agents) {
      plugins.push({
        name: a,
        source: `./agents/${a}`,
        description: frontmatterField(join(PKG_ROOT, "agents", a, "AGENT.md"), "description") || `${a} agent`,
        version: VERSION,
      });
    }
  }
  if (rt.skills) {
    for (const s of skills) {
      plugins.push({
        name: s,
        source: `./skills/${s}`,
        description:
          skillDescs[s] || frontmatterField(join(PKG_ROOT, "skills", s, "SKILL.md"), "description") || `${s} skill`,
        version: VERSION,
      });
    }
  }
  return plugins;
}

function main() {
  const check = process.argv.includes("--check");
  const agents = listDirs("agents");
  const skills = listDirs("skills");
  const skillDescs = skillDescriptions();

  let stale = 0;
  for (const rt of RUNTIMES) {
    const manifest = { name: "sdlc-skills", owner: OWNER, plugins: buildPlugins(rt, agents, skills, skillDescs) };
    const text = JSON.stringify(manifest, null, 2) + "\n";
    const path = join(PKG_ROOT, rt.out);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === text) {
      console.log(`  = ${rt.out} (${manifest.plugins.length} entries, up to date)`);
      continue;
    }
    if (check) {
      console.error(`  ! ${rt.out} is stale — run: node bin/gen-marketplaces.mjs`);
      stale++;
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`  ✓ ${rt.out} (${manifest.plugins.length} entries)`);
  }
  if (check && stale) process.exit(1);
}

main();
