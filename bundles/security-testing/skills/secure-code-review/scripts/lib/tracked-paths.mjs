// lib/tracked-paths.mjs — the paths git tracks, as an exemption from the
// `high-entropy` redaction rule. That rule's character class contains `/`, so
// a package path (`…/kotlin/com/example/widgets/…`) reads as a 40+ character
// secret; a citation path is identity — `check` re-reads its own output by it
// — so redacting one breaks the next run. The exemption is narrow: only the
// `high-entropy` rule, and only a match that lies wholly inside an occurrence
// of a path git itself reports (a file, or a directory above one). A longer run, or a path git does not know, is
// redacted as before.
//
// Imports only sibling lib modules; no clock, no network.

import { GitError, lsFiles, revParse, treePaths } from "./git.mjs";
import { redactString } from "./redact.mjs";

/**
 * Every path in the index and in the trees of `refs` (a ref that does not
 * resolve contributes nothing).
 * @param {string} root
 * @param {Iterable<string>} [refs]
 * @returns {Set<string>}
 */
export function trackedPaths(root, refs = []) {
  const paths = new Set(lsFiles(root));
  const seen = new Set();
  for (const ref of new Set(refs)) {
    let oid;
    try {
      oid = revParse(root, ref);
    } catch (e) {
      if (e instanceof GitError) continue;
      throw e;
    }
    if (seen.has(oid)) continue;
    seen.add(oid);
    for (const p of treePaths(root, oid)) paths.add(p);
  }
  return paths;
}

/**
 * The `exempt` callback `redactString` takes, for `paths`.
 * @param {Iterable<string>} paths as git reports them
 * @returns {((hit: {class: string, match: string, offset: number, text: string}) => boolean)}
 */
export function exemptPaths(paths) {
  const eaten = new Set();
  for (const p of paths) {
    if (redactString(p).hits === 0) continue; // then its directories are not eaten either
    eaten.add(p);
    for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) eaten.add(p.slice(0, i)).add(p.slice(0, i + 1));
  }
  return (hit) => hit.class === "high-entropy" && [...eaten].some((p) => insideOccurrence(p, hit));
}

/** True when the match at `offset` lies wholly inside an occurrence of `path` in `text`. */
function insideOccurrence(path, { match, offset, text }) {
  for (let i = path.indexOf(match); i !== -1; i = path.indexOf(match, i + 1)) {
    if (offset >= i && text.startsWith(path, offset - i)) return true;
  }
  return false;
}

/**
 * The longest whole-segment directory prefix of `path` that git tracks (a
 * directory above some tracked path), ending in `/`; `""` when there is none.
 * It is taken from `path` itself and printed only when a tracked path starts
 * with it, so it never carries a character git does not know. A path with an
 * empty, `.` or `..` segment, a backslash, a control character or a leading
 * `/` has none.
 * @param {string} path
 * @param {Set<string>} tracked as `trackedPaths` returns it
 * @returns {string}
 */
export function nearestTrackedDir(path, tracked) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return "";
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return "";
  for (let k = segments.length - 1; k >= 1; k--) {
    const dir = `${segments.slice(0, k).join("/")}/`;
    for (const t of tracked) if (t.startsWith(dir)) return dir;
  }
  return "";
}
