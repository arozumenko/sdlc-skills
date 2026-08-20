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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildItemIndex, resolveItem, catalogIds } from "./lib/item-resolver.mjs";

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

/**
 * Read one top-level `field:` from a YAML frontmatter block (a string, no `---`
 * fences). Handles inline scalars (quoted or not) AND block scalars — a folded
 * `field: >` or literal `field: |` (with optional `-`/`+` chomping) whose value
 * spans several indented continuation lines. Folded joins with spaces, literal
 * with newlines. Without this, a `>`-folded value collapses to the literal ">".
 * Returns the trimmed value, or null if the field is absent.
 */
export function parseFrontmatterField(fmText, field) {
  const lines = fmText.split(/\r?\n/);
  // Top-level fields only (column 0), matching the frontmatter fields callers
  // read — never a same-named key nested under e.g. `metadata:`.
  const keyRe = new RegExp(`^${field}:\\s*(.*)$`);
  const keyIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(keyRe);
    if (!m) continue;
    const rest = m[1].trim();
    const block = rest.match(/^([>|])([+-]?)$/);
    if (!block) {
      // Inline scalar — strip one layer of surrounding quotes.
      return rest.replace(/^["']|["']$/g, "");
    }
    // Block scalar: gather subsequent lines indented deeper than the key. The
    // block's content indentation is set by its first non-empty line; strip it.
    const folded = block[1] === ">";
    const body = [];
    let blockIndent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") { body.push(""); continue; }
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= keyIndent) break; // dedent → block ended
      if (blockIndent === null) blockIndent = indent;
      body.push(line.slice(blockIndent));
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    const joined = folded
      ? body.map((l) => l.trim()).join(" ").replace(/\s+/g, " ")
      : body.join("\n");
    return joined.trim();
  }
  return null;
}

/**
 * Read a scalar `field:` nested exactly one level under a top-level `metadata:`
 * mapping. Needed because the agentskills.io spec (enforced by `skills-ref` in
 * CI) forbids unknown top-level frontmatter keys, so opt-outs like
 * `discoverable: false` and `user-invocable: false` live under `metadata:`.
 * Returns the trimmed value, or null if there is no metadata block or field.
 */
export function parseMetaField(fmText, field) {
  const lines = fmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^metadata:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\S/.test(lines[j])) break; // back to a top-level key → block ended
      const m = lines[j].match(new RegExp(`^\\s+${field}:\\s*(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    return null;
  }
  return null;
}

function frontmatterField(file, field) {
  if (!existsSync(file)) return null;
  const fm = readFileSync(file, "utf8").match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return null;
  return parseFrontmatterField(fm[1], field);
}

/**
 * The `discoverable` opt-out, read from a top-level key if present, else from
 * `metadata.discoverable` (where CI-valid skills/agents must place it).
 */
function discoverableField(file) {
  if (!existsSync(file)) return null;
  const fm = readFileSync(file, "utf8").match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fm) return null;
  return parseFrontmatterField(fm[1], "discoverable") ?? parseMetaField(fm[1], "discoverable");
}

/** True unless frontmatter explicitly opts out with `discoverable: false`
 *  (boolean or the string form, since our regex-based frontmatter reader
 *  yields strings). Items without the field default to discoverable. */
export function isDiscoverable(fm) {
  return !(fm && (fm.discoverable === false || fm.discoverable === "false"));
}

/** Source path string for an agent/skill that was resolved via item-resolver. */
function resolvedSource(resolved, kind) {
  if (resolved.factory === null) {
    return `./${kind}/${resolved.name}`;
  }
  return `./factories/${resolved.factory}/${kind}/${resolved.name}`;
}

/** External (repo:) skill entries from skills.json, keyed by id. */
function externalSkills() {
  const out = {};
  const reg = join(PKG_ROOT, "skills.json");
  if (existsSync(reg)) {
    try {
      for (const s of JSON.parse(readFileSync(reg, "utf8")).skills || []) {
        if (s.id && s.repo) out[s.id] = s;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function buildPlugins(rt, index, externals) {
  const plugins = [UMBRELLA];

  if (rt.agents) {
    for (const id of catalogIds(index, "agents")) {
      const resolved = resolveItem(index, "agents", id);
      if (!resolved) continue;
      const agentFile = join(resolved.dir, "agents", id, "AGENT.md");
      if (!isDiscoverable({ discoverable: discoverableField(agentFile) })) continue;
      plugins.push({
        name: id,
        source: resolvedSource(resolved, "agents"),
        description: frontmatterField(agentFile, "description") || `${id} agent`,
        version: VERSION,
      });
    }
  }

  if (rt.skills) {
    // Collect dir-backed skill ids (orphans + factory-owned).
    const dirIds = new Set(catalogIds(index, "skills"));

    // Dir-backed skills first (sorted).
    for (const id of [...dirIds].sort()) {
      const resolved = resolveItem(index, "skills", id);
      if (!resolved) continue;
      const skillFile = join(resolved.dir, "skills", id, "SKILL.md");
      if (!isDiscoverable({ discoverable: discoverableField(skillFile) })) continue;
      plugins.push({
        name: id,
        source: resolvedSource(resolved, "skills"),
        description: frontmatterField(skillFile, "description") || `${id} skill`,
        version: VERSION,
      });
    }

    // External (repo:) skills — only those NOT already covered by a dir-backed entry.
    for (const id of Object.keys(externals).sort()) {
      if (dirIds.has(id)) continue; // dir-backed takes precedence
      const s = externals[id];
      plugins.push({
        name: id,
        source: `./skills/${id}`,
        description: s.description || `${id} skill`,
        version: VERSION,
      });
    }
  }

  return plugins;
}

function main() {
  const check = process.argv.includes("--check");
  const index = buildItemIndex(PKG_ROOT);
  const externals = externalSkills();

  let stale = 0;
  for (const rt of RUNTIMES) {
    const manifest = { name: "sdlc-skills", owner: OWNER, plugins: buildPlugins(rt, index, externals) };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
