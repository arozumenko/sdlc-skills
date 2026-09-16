// lib/packet-core.mjs — the pure packet builder (TASK-057; plan §3.3 row
// `lib/packet-core.mjs`, §5 TASK-057; spec §6.1 `packet.json` preimage
// `{subject_ids[], files[{path, side, oid, ranges, range_hmac}], policy_sha256}`,
// §6.4 P1 "Packet = the exact input set given to a reviewer"; G-9 pure core).
//
// A packet names what a reviewer may read and binds the bytes behind every
// range with the engagement key, so a receipt naming `packet_sha256` is a
// statement about exactly those bytes. Two kinds (P1): a SCOPE packet
// (`subject_ids: []`, one entry per scope file, whole-file ranges — the
// `review` contract's input, built before `gate`, what claims and examined
// declarations must name, TL-15) and a SUBJECT packet (`subject_ids` ≥ 1,
// cited ranges only — TASK-021 resolves the subjects and calls the same
// builder). `cmd-packet.mjs` and `verify all` (TASK-027) are the callers;
// `check` (TASK-025) re-runs this to recompute a packet.
//
//   buildPacket({kind, subject_ids, files, resolveSide, key, policy}) → payload
//     kind         "scope" | "subject"
//     subject_ids  [] for scope; ≥ 1 unique non-empty strings for subject,
//                  kept in the caller's order (TASK-021: argv order)
//     files        [{path, side, oid, ranges: [[start, end], …]}] — path a
//                  repo-relative posix path as scope.json spells it, side
//                  base|head|snapshot, oid the 40-hex blob oid (base|head)
//                  or the 64-hex redacted_sha256 (snapshot), ranges in
//                  NORMALISED line numbers (1-based inclusive, TASK-014)
//     resolveSide  ({path, side}) → Buffer — the bytes at that side; called
//                  exactly once per file; every byte hashed here comes
//                  through it, which is what makes the builder pure
//                  (cmd-packet passes lib/cite.mjs resolveSide bound to the
//                  run and scope; tests pass a table)
//     key          the engagement key bytes (G-2: range bytes are content
//                  that can match a redaction rule ⇒ keyed identity)
//     policy       the parsed packet-policy.v1 object (validated by the
//                  caller against the schema; this module has no fs)
//
// Per file: `range_hmac = HMAC_key(concat of rangeBytes(bytes, start, end)
// for each range)` — the RAW byte span of every range in order, terminators
// and interior blank lines kept (cite-core.rangeBytes); an empty file (no
// ranges) hashes zero bytes, so the entry still binds "nothing to read".
// `policy_sha256 = sha256(canonical(policy))` — plain sha256 over a
// canonical payload, the G-2 allowance.
//
// Canonical order, so identity never depends on how the caller happened to
// list things: files sorted by (path in UTF-8 byte order, then side); ranges
// sorted by (start, end) with exact duplicates dropped — the concatenation
// order for the HMAC is that sorted order. Overlapping ranges are distinct
// and stay. `subject_ids` is not reordered (the order is the subject
// packet's argv, TASK-021's contract).
//
// Every shape check is a TypeError raised before the first resolve; a
// `resolveSide` failure (lib/cite.mjs CiteError, …) propagates untouched
// for the caller to map; a range past the file's last normalised line is
// cite-core's RangeError. Inputs are never mutated.
//
// Pure (G-9): imports ../canon.mjs (canonical, hmacHex, sha256Hex),
// ./cite-core.mjs (lineMap, rangeBytes, SIDES) and node:path / node:url
// for POLICY_PATH only. No clock (G-1), no fs, no child process, no git,
// no network (G-14); the payload carries no path outside the repo, no time
// and no pid.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, hmacHex, sha256Hex } from "../canon.mjs";
import { SIDES, lineMap, rangeBytes } from "./cite-core.mjs";

/** `references/packet-policy.v1.json` — the shipped policy (`packet --policy` overrides it). */
export const POLICY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "references", "packet-policy.v1.json");
/** packet.schema.json `kind` vocabulary (spec §6.4, P1). */
export const PACKET_KINDS = Object.freeze(["scope", "subject"]);

const OID_OR_SHA256 = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const FILE_KEYS = Object.freeze(["path", "side", "oid", "ranges"]);
const WHERE = "buildPacket";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** UTF-8 byte order, the order canon sorts keys in and scope lists files in. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** A repo-relative posix path as scope.json spells it (the same rule lib/cite.mjs enforces before joining under root). */
function requirePath(path, at) {
  if (typeof path !== "string" || path === "") throw new TypeError(`${WHERE}: ${at}.path must be a non-empty string`);
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/")) throw new TypeError(`${WHERE}: ${at}.path must be a repo-relative posix path, got ${JSON.stringify(path)}`);
  if (path.split("/").some((s) => s === "" || s === "." || s === "..")) throw new TypeError(`${WHERE}: ${at}.path must not contain empty, "." or ".." segments, got ${JSON.stringify(path)}`);
  return path;
}

function requireRange(range, at) {
  const bad = () => new TypeError(`${WHERE}: ${at} must be a range [start, end] of integers with 1 ≤ start ≤ end, got ${JSON.stringify(range)}`);
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isSafeInteger(n))) throw bad();
  const [start, end] = range;
  if (start < 1 || end < start) throw bad();
  return [start, end];
}

/** Sorted by (start, end), exact duplicates dropped; a fresh array of fresh pairs. */
function canonicalRanges(ranges, at) {
  if (!Array.isArray(ranges)) throw new TypeError(`${WHERE}: ${at}.ranges must be an array of [start, end] ranges`);
  const sorted = ranges.map((r, i) => requireRange(r, `${at}.ranges[${i}]`)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === r[0] && last[1] === r[1]) continue;
    out.push(r);
  }
  return out;
}

function requireFile(file, i) {
  const at = `files[${i}]`;
  if (!isPlainObject(file)) throw new TypeError(`${WHERE}: ${at} must be an object {path, side, oid, ranges}`);
  for (const key of Object.keys(file)) {
    if (!FILE_KEYS.includes(key)) throw new TypeError(`${WHERE}: ${at} has an unknown key ${JSON.stringify(key)} (expected ${FILE_KEYS.join(", ")})`);
  }
  const path = requirePath(file.path, at);
  if (!SIDES.includes(file.side)) throw new TypeError(`${WHERE}: ${at}.side must be one of ${SIDES.join("|")}, got ${String(file.side)}`);
  if (typeof file.oid !== "string" || !OID_OR_SHA256.test(file.oid)) throw new TypeError(`${WHERE}: ${at}.oid must be a 40-hex blob oid or a 64-hex redacted_sha256, got ${String(file.oid)}`);
  return { path, side: file.side, oid: file.oid, ranges: canonicalRanges(file.ranges, at) };
}

function requireSubjectIds(kind, subject_ids) {
  if (!Array.isArray(subject_ids)) throw new TypeError(`${WHERE}: subject_ids must be an array of strings`);
  subject_ids.forEach((id, i) => {
    if (typeof id !== "string" || id === "") throw new TypeError(`${WHERE}: subject_ids[${i}] must be a non-empty string`);
  });
  if (new Set(subject_ids).size !== subject_ids.length) throw new TypeError(`${WHERE}: subject_ids must not contain a duplicate`);
  if (kind === "scope" && subject_ids.length !== 0) throw new TypeError(`${WHERE}: a scope packet has no subject_ids (got ${subject_ids.length})`);
  if (kind === "subject" && subject_ids.length === 0) throw new TypeError(`${WHERE}: a subject packet needs at least one subject id`);
  return [...subject_ids];
}

function requireKey(key) {
  if (!(key instanceof Uint8Array) || key.length === 0) throw new TypeError(`${WHERE}: key must be the engagement key bytes (non-empty Buffer)`);
  return key;
}

/**
 * `sha256(canonical(policy))` — the packet's `policy_sha256` (spec §6.1).
 * @param {object} policy the parsed packet-policy.v1 object
 * @returns {string}
 * @throws {TypeError} when policy is not a plain object; {CanonError} when it is not canonicalisable (a float, …)
 */
export function policyId(policy) {
  if (!isPlainObject(policy)) throw new TypeError("policyId: policy must be a plain object (the parsed packet-policy.v1 file)");
  return sha256Hex(canonical(policy));
}

/**
 * `HMAC_key(concat of rangeBytes(bytes, start, end) for each range)` — the
 * raw byte spans of the ranges, in the order given, terminators kept.
 * @param {Uint8Array} key the engagement key bytes
 * @param {Uint8Array} bytes the file bytes at the recorded side
 * @param {number[][]} ranges `[[start, end], …]` in normalised line numbers
 * @returns {string} 64 lowercase hex chars
 * @throws {RangeError} when a range runs past the last normalised line (cite-core)
 */
export function rangeHmac(key, bytes, ranges) {
  requireKey(key);
  if (!(bytes instanceof Uint8Array)) throw new TypeError("rangeHmac: bytes must be a Buffer");
  const list = canonicalRanges(ranges, "rangeHmac");
  if (list.length === 0) return hmacHex(key, Buffer.alloc(0));
  const map = lineMap(bytes);
  return hmacHex(key, Buffer.concat(list.map(([start, end]) => rangeBytes(bytes, start, end, map))));
}

/**
 * Build a packet payload (spec §6.1 preimage). Pure given `resolveSide`.
 * @param {{kind: "scope"|"subject", subject_ids: string[], files: {path: string, side: string, oid: string, ranges: number[][]}[], resolveSide: (file: {path: string, side: string}) => Uint8Array, key: Uint8Array, policy: object}} input
 * @returns {{kind: string, subject_ids: string[], files: {path: string, side: string, oid: string, ranges: number[][], range_hmac: string}[], policy_sha256: string}}
 * @throws {TypeError} on a shape error, before any resolve
 */
export function buildPacket({ kind, subject_ids, files, resolveSide, key, policy } = {}) {
  if (!PACKET_KINDS.includes(kind)) throw new TypeError(`${WHERE}: kind must be one of ${PACKET_KINDS.join("|")}, got ${String(kind)}`);
  const ids = requireSubjectIds(kind, subject_ids);
  if (!Array.isArray(files)) throw new TypeError(`${WHERE}: files must be an array of {path, side, oid, ranges}`);
  const entries = files.map(requireFile).sort((a, b) => compareBytes(a.path, b.path) || SIDES.indexOf(a.side) - SIDES.indexOf(b.side));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].path === entries[i - 1].path && entries[i].side === entries[i - 1].side) {
      throw new TypeError(`${WHERE}: duplicate file ${entries[i].side} ${entries[i].path}`);
    }
  }
  if (typeof resolveSide !== "function") throw new TypeError(`${WHERE}: resolveSide must be a function ({path, side}) → Buffer`);
  requireKey(key);
  const policy_sha256 = policyId(policy);

  const out = entries.map(({ path, side, oid, ranges }) => {
    const bytes = resolveSide({ path, side });
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`${WHERE}: resolveSide must return a Buffer for ${side} ${path}`);
    return { path, side, oid, ranges, range_hmac: rangeHmac(key, bytes, ranges) };
  });
  return { kind, subject_ids: ids, files: out, policy_sha256 };
}
