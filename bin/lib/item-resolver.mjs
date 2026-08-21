// Resolve agent/skill ids across top-level "orphan" dirs and every factory.
// Factories own their content; the same id may appear in several factories with
// different content (divergence is allowed). Standalone --agents/--skills and
// the marketplace generator use this to find where an id physically lives.
// Stdlib-only, no deps. The fs reads are confined here so callers stay simple.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MARKER = { agents: "AGENT.md", skills: "SKILL.md" };

function factoryIds(root) {
  const b = join(root, "factories");
  if (!existsSync(b)) return [];
  return readdirSync(b)
    .filter((d) => existsSync(join(b, d, "factory.json")))
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

/** Index every id → ordered occurrences. Top-level (orphan) first, then factories
 *  in alphabetical id order. Each occurrence: { factory: id|null, dir }, where
 *  `dir` is the srcRoot to pass to copyItem (joins dir/<kind>/<name>). */
export function buildItemIndex(root) {
  const index = { agents: {}, skills: {} };
  for (const kind of ["agents", "skills"]) {
    for (const name of dirsWithMarker(join(root, kind), kind)) {
      (index[kind][name] ||= []).push({ factory: null, dir: root });
    }
    for (const id of factoryIds(root)) {
      const fdir = join(root, "factories", id);
      for (const name of dirsWithMarker(join(fdir, kind), kind)) {
        (index[kind][name] ||= []).push({ factory: id, dir: fdir });
      }
    }
  }
  return index;
}

/** All known ids for a kind, sorted. */
export function catalogIds(index, kind) {
  return Object.keys(index[kind]).sort();
}

/** Resolve `idOrQualified` ("name" or "factory/name") to a single occurrence.
 *  Orphan (top-level) wins; else alphabetical-first factory. ambiguousAcross
 *  lists every factory holding the id when more than one does (for a notice).
 *  Returns { name, dir, factory, ambiguousAcross } or null if not found. */
export function resolveItem(index, kind, idOrQualified) {
  let wantFactory = null;
  let name = idOrQualified;
  const slash = idOrQualified.indexOf("/");
  if (slash !== -1) {
    wantFactory = idOrQualified.slice(0, slash);
    name = idOrQualified.slice(slash + 1);
  }
  const occ = index[kind][name];
  if (!occ || occ.length === 0) return null;
  if (wantFactory !== null) {
    const m = occ.find((o) => o.factory === wantFactory);
    return m ? { name, dir: m.dir, factory: wantFactory, ambiguousAcross: [] } : null;
  }
  const top = occ.find((o) => o.factory === null);
  const factories = occ.filter((o) => o.factory !== null).map((o) => o.factory);
  if (top) return { name, dir: top.dir, factory: null, ambiguousAcross: [] };
  const chosen = occ.find((o) => o.factory !== null);
  return { name, dir: chosen.dir, factory: chosen.factory, ambiguousAcross: factories.length > 1 ? factories : [] };
}

/** True if the id (bare or qualified) resolves anywhere. */
export function itemKnown(index, kind, idOrQualified) {
  return resolveItem(index, kind, idOrQualified) !== null;
}
