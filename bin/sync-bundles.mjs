#!/usr/bin/env node
/**
 * Sync bundle copies from canonical agents/ and skills/.
 *
 * Canonical content lives in top-level agents/<name>/ and skills/<name>/.
 * Every bundle's `localAgents` / `localSkills` entry whose canonical home
 * exists is mirrored as a real (deep-dereferenced) copy under
 * bundles/<id>/agents/<name>/ and bundles/<id>/skills/<name>/. Entries
 * without a canonical home (e.g. manual-qa's role-specific agents) are
 * genuinely bundle-local — left untouched.
 *
 * The rule the script enforces:
 *   - Bundle copies are write-only outputs of this script.
 *     Don't hand-edit anything under bundles/<id>/agents/ or
 *     bundles/<id>/skills/ for an entry that has a canonical home;
 *     edit the canonical file and re-run.
 *   - Bundle entries with NO canonical home are real content owned by
 *     the bundle (the only place that file lives) — those are skipped
 *     so the script never clobbers them.
 *
 * Usage:
 *   node bin/sync-bundles.mjs                # write real copies into bundles/
 *   node bin/sync-bundles.mjs --check        # exit 1 if bundle copies drift from canonical (CI)
 *   node bin/sync-bundles.mjs --dry-run      # report what would change, don't write
 *
 * For mirrors that can't follow symlinks (e.g. the EPAM indexer), run this
 * before pushing so the published tree contains real files everywhere.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const DRY = args.has("--dry-run");

function listDirs(parent) {
  if (!existsSync(parent)) return [];
  return readdirSync(parent).filter((name) => {
    if (name.startsWith(".")) return false;
    try {
      return statSync(join(parent, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

// Walk a real (non-symlink) directory tree, dereferencing every internal
// symlink. Returns nothing — writes to `dest` directly.
function copyTreeDereferenced(src, dest) {
  let stat;
  try { stat = lstatSync(src); } catch { return; }
  if (stat.isSymbolicLink()) return copyTreeDereferenced(realpathSync(src), dest);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const e of readdirSync(src)) copyTreeDereferenced(join(src, e), join(dest, e));
    return;
  }
  if (stat.isFile()) copyFileSync(src, dest);
}

// Recursively list every file under root (relative paths, sorted).
function walkFiles(root) {
  const acc = [];
  function visit(rel) {
    const abs = join(root, rel);
    let st;
    try { st = lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) {
      // For comparison purposes, follow the link.
      const real = realpathSync(abs);
      let rst;
      try { rst = lstatSync(real); } catch { return; }
      if (rst.isDirectory()) {
        for (const e of readdirSync(real)) visit(join(rel, e));
      } else if (rst.isFile()) {
        acc.push({ rel, abs: real });
      }
      return;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(abs)) visit(join(rel, e));
    } else if (st.isFile()) {
      acc.push({ rel, abs });
    }
  }
  visit("");
  acc.sort((a, b) => a.rel.localeCompare(b.rel));
  return acc;
}

// True if two trees have identical file lists and byte-identical contents.
function treesMatch(a, b) {
  const aFiles = walkFiles(a);
  const bFiles = walkFiles(b);
  if (aFiles.length !== bFiles.length) return false;
  for (let i = 0; i < aFiles.length; i++) {
    if (aFiles[i].rel !== bFiles[i].rel) return false;
    const ab = readFileSync(aFiles[i].abs);
    const bb = readFileSync(bFiles[i].abs);
    if (!ab.equals(bb)) return false;
  }
  return true;
}

function listBundles() {
  const root = join(ROOT, "bundles");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, "bundle.json")))
    .sort();
}

function loadBundle(id) {
  const dir = join(ROOT, "bundles", id);
  const b = JSON.parse(readFileSync(join(dir, "bundle.json"), "utf8"));
  b.dir = dir;
  b.localAgents = b.localAgents || [];
  b.localSkills = b.localSkills || [];
  return b;
}

const summary = {
  synced: 0,         // canonical → bundle copy was already a fresh real tree (no change)
  refreshed: 0,      // canonical → bundle copy needed regeneration (symlink, drift, or missing)
  bundleLocal: 0,    // no canonical exists — bundle owns the content; left alone
  drift: [],         // --check: synced entries that don't match canonical
  symlinks: [],      // --check: remaining symlinks under bundles/
};

function syncEntry(bundleId, kind, name) {
  const canonicalKind = kind; // "agents" or "skills" matches top-level dir names
  const canonicalPath = join(ROOT, canonicalKind, name);
  const bundlePath = join(ROOT, "bundles", bundleId, kind, name);
  const canonicalExists = existsSync(join(canonicalPath, kind === "agents" ? "AGENT.md" : "SKILL.md"));

  if (!canonicalExists) {
    // Genuinely bundle-local — leave alone. Sanity-check it's not a stale symlink.
    let st;
    try { st = lstatSync(bundlePath); } catch { return; }
    if (st.isSymbolicLink()) {
      console.warn(`  ! ${bundleId}/${kind}/${name} is a symlink but has no canonical home at ${canonicalKind}/${name} — leaving as-is`);
    }
    summary.bundleLocal++;
    return;
  }

  // Synced entry — canonical is the source of truth.
  let needsRefresh = false;
  let existing;
  try { existing = lstatSync(bundlePath); } catch { existing = null; }
  if (!existing) {
    needsRefresh = true;
  } else if (existing.isSymbolicLink()) {
    needsRefresh = true;
  } else if (!treesMatch(canonicalPath, bundlePath)) {
    needsRefresh = true;
  }

  if (CHECK) {
    if (existing && existing.isSymbolicLink()) summary.symlinks.push(`${bundleId}/${kind}/${name}`);
    if (needsRefresh) summary.drift.push(`${bundleId}/${kind}/${name}`);
    if (!needsRefresh) summary.synced++;
    return;
  }

  if (!needsRefresh) {
    summary.synced++;
    return;
  }

  if (DRY) {
    console.log(`  ~ would refresh bundles/${bundleId}/${kind}/${name}  (from ${canonicalKind}/${name})`);
    summary.refreshed++;
    return;
  }

  if (existing) rmSync(bundlePath, { recursive: true, force: true });
  mkdirSync(dirname(bundlePath), { recursive: true });
  copyTreeDereferenced(canonicalPath, bundlePath);
  console.log(`  ✓ refreshed bundles/${bundleId}/${kind}/${name}`);
  summary.refreshed++;
}

const bundles = listBundles();
if (bundles.length === 0) {
  console.log("No bundles found.");
  process.exit(0);
}

for (const id of bundles) {
  const b = loadBundle(id);
  for (const a of b.localAgents) syncEntry(id, "agents", a);
  for (const s of b.localSkills) syncEntry(id, "skills", s);
}

console.log("");
if (CHECK) {
  const problems = summary.drift.length + summary.symlinks.length;
  if (problems === 0) {
    console.log(`✓ ${summary.synced} synced entries in sync with canonical, ${summary.bundleLocal} bundle-local entries left alone`);
    process.exit(0);
  }
  if (summary.symlinks.length) {
    console.error(`! ${summary.symlinks.length} symlink(s) remain under bundles/:`);
    for (const s of summary.symlinks) console.error("    " + s);
  }
  if (summary.drift.length) {
    console.error(`! ${summary.drift.length} entr(ies) drift from canonical — run \`node bin/sync-bundles.mjs\` to refresh:`);
    for (const s of summary.drift) console.error("    " + s);
  }
  process.exit(1);
}

console.log(
  `${summary.refreshed} refreshed, ${summary.synced} already in sync, ${summary.bundleLocal} bundle-local left alone.`
);
if (DRY) console.log("(dry-run — no changes written)");
