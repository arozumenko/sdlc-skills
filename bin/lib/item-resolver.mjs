// Resolve agent/skill ids across top-level "orphan" dirs and every bundle.
// Bundles own their content; the same id may appear in several bundles with
// different content (divergence is allowed). Standalone --agents/--skills and
// the marketplace generator use this to find where an id physically lives.
// Stdlib-only, no deps. The fs reads are confined here so callers stay simple.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MARKER = { agents: "AGENT.md", skills: "SKILL.md" };

function bundleIds(root) {
  const b = join(root, "bundles");
  if (!existsSync(b)) return [];
  return readdirSync(b)
    .filter((d) => existsSync(join(b, d, "bundle.json")))
    .sort();
}

function dirsWithMarker(parent, kind) {
  if (!existsSync(parent)) return [];
  const out = [];
  for (const name of readdirSync(parent)) {
    if (existsSync(join(parent, name, MARKER[kind]))) out.push(name);
  }
  return out;
}

/** Index every id → ordered occurrences. Top-level (orphan) first, then bundles
 *  in alphabetical id order. Each occurrence: { bundle: id|null, dir }, where
 *  `dir` is the srcRoot to pass to copyItem (joins dir/<kind>/<name>). */
export function buildItemIndex(root) {
  const index = { agents: {}, skills: {} };
  for (const kind of ["agents", "skills"]) {
    for (const name of dirsWithMarker(join(root, kind), kind)) {
      (index[kind][name] ||= []).push({ bundle: null, dir: root });
    }
    for (const id of bundleIds(root)) {
      const bdir = join(root, "bundles", id);
      for (const name of dirsWithMarker(join(bdir, kind), kind)) {
        (index[kind][name] ||= []).push({ bundle: id, dir: bdir });
      }
    }
  }
  return index;
}

/** All known ids for a kind, sorted. */
export function catalogIds(index, kind) {
  return Object.keys(index[kind]).sort();
}

/** Resolve `idOrQualified` ("name" or "bundle/name") to a single occurrence.
 *  Orphan (top-level) wins; else alphabetical-first bundle. ambiguousAcross
 *  lists every bundle holding the id when more than one does (for a notice).
 *  Returns { name, dir, bundle, ambiguousAcross } or null if not found. */
export function resolveItem(index, kind, idOrQualified) {
  let wantBundle = null;
  let name = idOrQualified;
  const slash = idOrQualified.indexOf("/");
  if (slash !== -1) {
    wantBundle = idOrQualified.slice(0, slash);
    name = idOrQualified.slice(slash + 1);
  }
  const occ = index[kind][name];
  if (!occ || occ.length === 0) return null;
  if (wantBundle !== null) {
    const m = occ.find((o) => o.bundle === wantBundle);
    return m ? { name, dir: m.dir, bundle: wantBundle, ambiguousAcross: [] } : null;
  }
  const top = occ.find((o) => o.bundle === null);
  const bundles = occ.filter((o) => o.bundle !== null).map((o) => o.bundle);
  if (top) return { name, dir: top.dir, bundle: null, ambiguousAcross: [] };
  const chosen = occ.find((o) => o.bundle !== null);
  return { name, dir: chosen.dir, bundle: chosen.bundle, ambiguousAcross: bundles.length > 1 ? bundles : [] };
}

/** True if the id (bare or qualified) resolves anywhere. */
export function itemKnown(index, kind, idOrQualified) {
  return resolveItem(index, kind, idOrQualified) !== null;
}
