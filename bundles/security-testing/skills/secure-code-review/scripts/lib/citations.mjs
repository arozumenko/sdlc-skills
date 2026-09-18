// lib/citations.mjs — one citation against the bytes at its commit (spec §6
// `cite.mjs check`), and finding identity (D5).
//
// `checkCitation` takes `{path, oid?, lines: [s, e], snippet}` and answers
// `VERIFIED` or `FAILED` with one `why` from a fixed vocabulary:
//   bad-shape          not a citation: path/lines/snippet/oid malformed, or a
//                      path with `..`, empty or absolute segments
//   path-not-in-scope  the (canonical) path is under none of `scopePaths`
//   range-over-40      `e - s + 1 > maxRangeLines` (cite.mjs passes its own
//                      MAX_RANGE_LINES; 40 is the default)
//   not-in-tree        the oid does not resolve, or the path is absent there
//   snippet-not-found  the normalised snippet is not a contiguous run of
//                      the window's normalised lines
// Lines are raw, as `git show` prints them (D3): the window is raw lines
// `s..e` of the blob (clamped to the file), and both sides are then run
// through `normalizeText` (whitespace collapsed, blank lines dropped) and
// `redactString`, so a snippet `check` already wrote back redacted still
// verifies on the next run (D2) — the compare is on redacted forms, which
// is exactly what a citation attests (never the secret bytes).
//
// Identity: `sha256(path \0 class \0 redact(normalise(snippet)) \0 first
// line)` where "first line" is the first REDACTED normalised line, so no
// published hash has a secret in its preimage (spec §2, D5).
//
// Imports only sibling lib modules; no clock, no network.

import { createHash } from "node:crypto";

import { GitError, revParse, showBytes } from "./git.mjs";
import { EncodingError, normalizeText } from "./normalize.mjs";
import { redactString } from "./redact.mjs";

/** The `why` vocabulary, as printed after `FAILED <i>.<j>`. */
export const WHY = Object.freeze({
  BAD_SHAPE: "bad-shape",
  PATH_NOT_IN_SCOPE: "path-not-in-scope",
  RANGE_OVER: "range-over-40",
  NOT_IN_TREE: "not-in-tree",
  SNIPPET_NOT_FOUND: "snippet-not-found",
});

const OID = /^[0-9a-f]{40}$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Canonical repo-relative posix form of a citation path: leading `./` and
 * `.` segments dropped; null when the path is absolute, has `..`, an empty
 * segment or a backslash.
 * @param {unknown} path
 * @returns {string | null}
 */
export function canonicalPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  const segments = path.split("/");
  if (segments.includes("..") || segments.includes("")) return null;
  const clean = segments.filter((s) => s !== ".");
  return clean.length === 0 ? null : clean.join("/");
}

/**
 * True when canonical `path` sits under one of `scopePaths` (posix prefix on
 * whole segments; `.` or `` means the whole tree).
 * @param {string} path canonical
 * @param {string[]} scopePaths
 */
function underScope(path, scopePaths) {
  return scopePaths.some((scope) => {
    const s = scope.replace(/\/+$/, "").replace(/^(\.\/)+/, "");
    if (s === "" || s === ".") return true;
    return path === s || path.startsWith(`${s}/`);
  });
}

/**
 * Occurrence: the 0-based index of the cited window among every window of
 * the file whose normalised lines equal the snippet, ordered by start line —
 * i.e. how many equal windows start before `start`. The caller's hint is not
 * a parameter: the bytes decide. `null` when the window at `start` is not
 * the snippet (the citation does not locate it). Copied from the reference
 * implementation's `cite-core.mjs`.
 * @param {string[]} lines the file's normalised lines
 * @param {string[]|string} snippet the claim's normalised lines (a string is split on `\n`)
 * @param {number} start 1-based normalised line the citation starts at
 * @returns {number|null}
 */
export function occurrenceOf(lines, snippet, start) {
  if (!Array.isArray(lines) || lines.some((l) => typeof l !== "string")) throw new TypeError("occurrenceOf: lines must be an array of strings");
  const want = typeof snippet === "string" ? snippet.split("\n") : snippet;
  if (!Array.isArray(want) || want.length === 0 || want.some((l) => typeof l !== "string")) throw new TypeError("occurrenceOf: snippet must be a non-empty array of strings (or a string)");
  if (want.length === 1 && want[0] === "") throw new TypeError("occurrenceOf: snippet must not be empty");
  if (!Number.isSafeInteger(start) || start < 1) throw new TypeError("occurrenceOf: start must be a positive integer");
  const k = want.length;
  const cited = start - 1;
  if (cited + k > lines.length) return null;
  const matchesAt = (i) => {
    for (let j = 0; j < k; j++) if (lines[i + j] !== want[j]) return false;
    return true;
  };
  if (!matchesAt(cited)) return null;
  let before = 0;
  for (let i = 0; i < cited; i++) if (matchesAt(i)) before++;
  return before;
}

/** True when `want` is a contiguous run somewhere in `lines`. */
function containsRun(lines, want) {
  for (let start = 1; start + want.length - 1 <= lines.length; start++) {
    if (occurrenceOf(lines, want, start) !== null) return true;
  }
  return false;
}

/** Normalise then redact, as lines (the redaction may merge lines, e.g. a PEM block). */
function normalisedRedactedLines(text) {
  const { text: joined } = normalizeText(text);
  return redactString(joined).text.split("\n").filter((l) => l.length > 0);
}

const isLineNumber = (n) => Number.isSafeInteger(n) && n >= 1;

/**
 * Check one citation against the bytes at its oid.
 * @param {string} root repo root
 * @param {string[]} scopePaths from `engagement.md`
 * @param {unknown} c the citation `{path, oid?, lines: [s, e], snippet}`
 * @param {{maxRangeLines?: number, defaultOid?: string}} [options] `defaultOid` (default `HEAD`) applies when `c.oid` is absent
 * @returns {{state: "VERIFIED"|"FAILED", why?: string, path?: string, oid?: string, snippet_redacted?: string, normalised?: string[]}}
 *   `path` is canonical; `oid` is present once resolved; `normalised` (the
 *   snippet's normalised, un-redacted lines) and `snippet_redacted` only on VERIFIED.
 */
export function checkCitation(root, scopePaths, c, { maxRangeLines = 40, defaultOid = "HEAD" } = {}) {
  const fail = (why, extra = {}) => ({ state: "FAILED", why, ...extra });
  if (c === null || typeof c !== "object" || Array.isArray(c)) return fail(WHY.BAD_SHAPE);
  const path = canonicalPath(c.path);
  if (path === null) return fail(WHY.BAD_SHAPE);
  const { lines, snippet } = c;
  if (!Array.isArray(lines) || lines.length !== 2 || !isLineNumber(lines[0]) || !isLineNumber(lines[1]) || lines[1] < lines[0]) return fail(WHY.BAD_SHAPE, { path });
  if (typeof snippet !== "string" || snippet.length === 0) return fail(WHY.BAD_SHAPE, { path });
  if (c.oid !== undefined && typeof c.oid !== "string") return fail(WHY.BAD_SHAPE, { path });
  const want = normalisedRedactedLines(snippet);
  if (want.length === 0) return fail(WHY.BAD_SHAPE, { path });
  if (!underScope(path, scopePaths)) return fail(WHY.PATH_NOT_IN_SCOPE, { path });
  const [start, end] = lines;
  if (end - start + 1 > maxRangeLines) return fail(WHY.RANGE_OVER, { path });
  let oid;
  try {
    oid = revParse(root, c.oid ?? defaultOid);
  } catch (e) {
    if (e instanceof GitError) return fail(WHY.NOT_IN_TREE, { path });
    throw e;
  }
  let bytes;
  try {
    bytes = showBytes(root, oid, path);
  } catch (e) {
    if (e instanceof GitError) return fail(WHY.NOT_IN_TREE, { path, oid });
    throw e;
  }
  // Raw lines as `git show` prints them (D3): strict UTF-8, split on LF,
  // the empty entry a trailing LF leaves behind dropped. A blob that is not
  // UTF-8 cannot contain the snippet as text.
  let raw;
  try {
    raw = decoder.decode(bytes).split("\n");
  } catch {
    return fail(WHY.SNIPPET_NOT_FOUND, { path, oid });
  }
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  if (start > raw.length) return fail(WHY.SNIPPET_NOT_FOUND, { path, oid });
  let windowLines;
  try {
    windowLines = normalisedRedactedLines(raw.slice(start - 1, Math.min(end, raw.length)).join("\n"));
  } catch (e) {
    if (e instanceof EncodingError) return fail(WHY.SNIPPET_NOT_FOUND, { path, oid });
    throw e;
  }
  if (!containsRun(windowLines, want)) return fail(WHY.SNIPPET_NOT_FOUND, { path, oid });
  const normalised = normalizeText(snippet).lines;
  return { state: "VERIFIED", path, oid, normalised, snippet_redacted: want.join("\n") };
}

/**
 * Finding identity (D5): hex sha256 over the REDACTED normalised snippet.
 * @param {{path: string, cls: string, normalisedSnippet: string[]}} finding canonical path, class id, `checkCitation().normalised` of the first citation
 * @returns {string} 64 hex
 */
export function findingId({ path, cls, normalisedSnippet }) {
  if (typeof path !== "string" || typeof cls !== "string") throw new TypeError("findingId: path and cls must be strings");
  if (!Array.isArray(normalisedSnippet) || normalisedSnippet.length === 0 || normalisedSnippet.some((l) => typeof l !== "string")) {
    throw new TypeError("findingId: normalisedSnippet must be a non-empty array of strings");
  }
  const redacted = redactString(normalisedSnippet.join("\n")).text;
  const firstLine = redacted.split("\n")[0];
  return createHash("sha256").update(Buffer.from(`${path}\0${cls}\0${redacted}\0${firstLine}`, "utf8")).digest("hex");
}

/** True for a full 40-hex commit oid. */
export const isOid = (s) => typeof s === "string" && OID.test(s);
