// lib/cite-core.mjs — the pure half of citation handling (TASK-014; plan §3.3
// `lib/cite.mjs` row, §5 TASK-014; spec §6.2 range rule, v3 §6.1 normalisation
// and occurrence; US-002 AC-6). `lib/cite.mjs` re-exports everything here and
// adds the two resolvers that touch git and the file system.
//
// Line numbers are NORMALISED line numbers. `scope` records `lines` as the
// normalised line count of a file and admits `[[1, lines]]` (TASK-013), so a
// citation's `[start, end]` indexes `normalizeText(bytes).lines`, 1-based
// inclusive — a blank line is not a line, a CRLF file numbers like an LF one.
// The raw bytes of a cited range are the contiguous byte span from the raw
// line that became normalised line `start` through the raw line that became
// normalised line `end`, terminators kept (interior blank lines included):
// that is what `range_hmac` is computed over and what a reviewer reads.
//
//   lineMap(buf)                     {lines, spans}: the normalised lines and,
//                                    per line, the [start, end) byte span of
//                                    the raw line it came from
//   rangeBytes(buf, start, end)      raw bytes of normalised lines start..end
//   checkRange(scope, citation)      {ok} | {ok, context: true} | {ok: false, reason}
//   occurrenceOf(lines, snippet, s)  0-based index of the window at s among
//                                    every window equal to the snippet, or null
//
// The per-line "empty after normalisation" test in lineMap is the one piece
// of normalize.mjs re-spelled here (its rule 5 whitespace class), because
// normalizeText returns lines without offsets. lineMap asserts its count
// against normalizeText's on every call, so the two cannot drift silently.
//
// Pure (G-9): imports ../normalize.mjs and ./tokens.mjs only. No clock, no
// fs, no child process; inputs are never mutated; no hashing happens here
// (HMAC over rangeBytes is the caller's, with the engagement key — G-2).

import { normalizeText } from "../normalize.mjs";
import { PATH_NOT_IN_SCOPE, RANGE_INVALID, RANGE_NOT_ADMITTED, RANGE_TOO_LONG, SIDE_MISMATCH } from "./tokens.mjs";

/** `end - start + 1 ≤ MAX_RANGE_LINES` (spec §6.2). */
export const MAX_RANGE_LINES = 40;
/** Citation sides, spec §6.2. */
export const SIDES = Object.freeze(["base", "head", "snapshot"]);
/** Typed-citation roles, spec v3 §6.1 / finding.schema.json TypedCitation. */
export const TYPED_ROLES = Object.freeze(["source", "sink", "control"]);

const LF = 0x0a;
const CR = 0x0d;
/** normalize.mjs rule 5: a line that collapses to nothing is dropped by rule 6. */
const BLANK_LINE = /^[\p{Zs}\t]*$/u;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function requireBuffer(where, buf) {
  if (!(buf instanceof Uint8Array)) throw new TypeError(`${where}: expected a Buffer`);
  return buf;
}

function isRangeShape(lines) {
  return Array.isArray(lines) && lines.length === 2 && lines.every((n) => Number.isSafeInteger(n));
}

/**
 * Split raw bytes into normalised lines with the byte span of each one's raw
 * line. Terminators follow normalize.mjs rule 3 (`\r\n`, `\r`, `\n`); a raw
 * line whose text is only horizontal whitespace (rule 5) — or a leading BOM
 * alone (rule 2) — has no normalised line and belongs to no span.
 * @param {Buffer|Uint8Array} buf
 * @returns {{lines: string[], spans: {start: number, end: number}[]}} `end` exclusive, terminator included
 * @throws {EncodingError} when the bytes are not valid UTF-8 (from normalizeText)
 */
export function lineMap(buf) {
  requireBuffer("lineMap", buf);
  const { lines } = normalizeText(buf); // the authority on what a line is; throws on bad UTF-8
  const spans = [];
  let first = true;
  let start = 0;
  const n = buf.length;
  for (let i = 0; i <= n; i++) {
    const atEnd = i === n;
    const byte = atEnd ? -1 : buf[i];
    if (!atEnd && byte !== LF && byte !== CR) continue;
    if (atEnd && i === start) break; // the buffer ended with a terminator: no trailing line
    const textEnd = i;
    let end = i;
    if (!atEnd) end = byte === CR && buf[i + 1] === LF ? i + 2 : i + 1;
    // Line terminators are ASCII, so a cut at them never splits a UTF-8 sequence.
    let text = decoder.decode(buf.subarray(start, textEnd));
    if (first && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    first = false;
    if (!BLANK_LINE.test(text)) spans.push({ start, end });
    start = end;
    if (!atEnd && end === i + 2) i++; // consumed the LF of a CRLF pair
  }
  if (spans.length !== lines.length) {
    throw new Error(`lineMap: ${spans.length} raw lines with content but normalize.mjs produced ${lines.length} lines — the two line rules have drifted`);
  }
  return { lines, spans };
}

/**
 * Raw bytes of normalised lines `start..end` (1-based, inclusive): the
 * contiguous span from the first raw line to the last, terminators kept.
 * @param {Buffer|Uint8Array} buf the file bytes at the citation's side
 * @param {number} start
 * @param {number} end
 * @param {{lines: string[], spans: {start: number, end: number}[]}} [map] `lineMap(buf)`, when the caller already has it
 * @returns {Buffer} a copy
 * @throws {RangeError} when the range is not 1 ≤ start ≤ end ≤ line count
 */
export function rangeBytes(buf, start, end, map) {
  requireBuffer("rangeBytes", buf);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new TypeError("rangeBytes: start and end must be integers");
  if (start < 1 || end < start) throw new RangeError(`rangeBytes: need 1 ≤ start ≤ end, got [${start}, ${end}]`);
  const { spans } = map ?? lineMap(buf);
  if (end > spans.length) throw new RangeError(`rangeBytes: [${start}, ${end}] runs past the last normalised line (${spans.length})`);
  return Buffer.from(buf.subarray(spans[start - 1].start, spans[end - 1].end));
}

/** The scope payload from either the artifact or the bare payload. */
function scopePayload(scope) {
  const p = scope !== null && typeof scope === "object" && scope.payload !== undefined && scope.envelope !== undefined ? scope.payload : scope;
  if (p === null || typeof p !== "object" || !Array.isArray(p.files) || p.ranges === null || typeof p.ranges !== "object") {
    throw new TypeError("checkRange: scope must be a scope payload ({files, ranges, …}) or its artifact");
  }
  return p;
}

/**
 * The range rule (spec §6.2 / v3 §6.1): `lines` is `[start, end]` with
 * 1 ≤ start ≤ end and `end - start + 1 ≤ 40`; the path is a scope file; a
 * `head`/`snapshot` citation names the side the scope recorded for that
 * file (`base` is exempt — deleted code has no scope entry); a primary
 * citation lies inside ONE admitted range of its file; a typed citation
 * (`role: source|sink|control`) may lie anywhere in the file and is flagged
 * `context: true`. Rules apply in that order; the first failure is the
 * reason (a tokens.mjs constant, recorded by `gate`).
 * @param {object} scope scope payload or artifact
 * @param {{path: string, side: string, lines: unknown, role?: string}} citation
 * @returns {{ok: true, context?: true} | {ok: false, reason: string}}
 */
export function checkRange(scope, citation) {
  const p = scopePayload(scope);
  if (citation === null || typeof citation !== "object") throw new TypeError("checkRange: citation must be an object");
  const { path, side, lines, role } = citation;
  if (typeof path !== "string" || path === "") throw new TypeError("checkRange: citation.path must be a non-empty string");
  if (!SIDES.includes(side)) throw new TypeError(`checkRange: citation.side must be one of ${SIDES.join("|")}, got ${String(side)}`);
  if (role !== undefined && !TYPED_ROLES.includes(role)) throw new TypeError(`checkRange: citation.role must be one of ${TYPED_ROLES.join("|")}, got ${String(role)}`);

  if (!isRangeShape(lines)) return { ok: false, reason: RANGE_INVALID };
  const [start, end] = lines;
  if (start < 1 || end < start) return { ok: false, reason: RANGE_INVALID };
  if (end - start + 1 > MAX_RANGE_LINES) return { ok: false, reason: RANGE_TOO_LONG };

  const file = p.files.find((f) => f !== null && typeof f === "object" && f.path === path);
  if (file === undefined) return { ok: false, reason: PATH_NOT_IN_SCOPE };
  if (side !== "base" && file.side !== side) return { ok: false, reason: SIDE_MISMATCH };

  if (role !== undefined) return { ok: true, context: true };
  const admitted = Object.hasOwn(p.ranges, path) ? p.ranges[path] : [];
  const inside = Array.isArray(admitted) && admitted.some((r) => isRangeShape(r) && r[0] <= start && end <= r[1]);
  return inside ? { ok: true } : { ok: false, reason: RANGE_NOT_ADMITTED };
}

/**
 * Occurrence (spec v3 §6.1): the 0-based index of the cited window among
 * every window of the file whose normalised lines equal the snippet, ordered
 * by start line — i.e. how many equal windows start before `start`. The
 * caller's hint is not a parameter: the bytes decide. `null` when the window
 * at `start` is not the snippet (the citation does not locate it).
 * @param {string[]} lines the file's normalised lines (`lineMap(bytes).lines`)
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
