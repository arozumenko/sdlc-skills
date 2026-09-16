// lib/coverage-core.mjs — the pure coverage accounting (TASK-020; plan §5
// TASK-020 and the G7 PM-log row "TASK-020 exports a pure computeCoverage(scope,
// examined, scannerRows) core with an import-guard test"; spec D3 "every scoped
// range is accounted for exactly once; empty scope ⇒ INDETERMINATE", §6.1
// `coverage.json` preimage `{accounting[], scanner_rows[], scope_sha256,
// examined_sha256}` (+ `indeterminate`, P5), §6.3 derivation table "coverage
// accounting and counts ⇐ coverage re-run on scope + examined declaration";
// G-9 pure core). `cmd-coverage.mjs` calls it to produce coverage.json;
// `build-report` (TASK-023) and `check` (TASK-025) call it again over the
// recorded scope.json + examined.json and compare.
//
//   computeCoverage(scope, examined, scannerRows) → payload
//     scope        {envelope: {self_sha256}, payload: {files[], ranges, skipped[]}}
//                  — a scope artifact as readArtifact returns it
//     examined     {envelope: {self_sha256}, payload: {packet_sha256, declared[]}}
//                  — the examined artifact (or, in cmd-coverage, the redacted
//                  payload with its identity computed ahead of the write)
//     scannerRows  [{tool, version, import_sha256, paths[]}] — already resolved
//                  by the caller against the run's `ingest/*.json` records
//                  (a row proves that artifact's presence and nothing more;
//                  the core never checks it)
//     → {accounting[], scanner_rows[], scope_sha256, examined_sha256, indeterminate}
//
//   verifyAccounting(scopePayload, accounting)
//     the exactly-once check as an independent pass: every admitted range of
//     every scope file is tiled by the entries of its path with no hole
//     (4 GAP(<path>:<a>-<b>)) and no double cover (an Error — a bug, exit 1),
//     every skipped file has exactly one `skipped` entry, no entry names
//     anything else. computeCoverage runs it over its own output, so a GAP is
//     unreachable through it by construction; `check` runs it over a recorded
//     accounting.
//
//   countByStatus(accounting) → {examined, skipped, "scanner-only", unexamined}
//
// Interval arithmetic, per scope file, per admitted range [s, e] (NORMALISED
// line numbers, TASK-014 contract, as scope.json spells them): the declared
// ranges of that path — validated first: `[start, end]` integers with
// 1 ≤ start ≤ end, inside one admitted range of a scope file (anything else is
// a declaration outside the packet: 2 SCHEMA-INVALID(examined: …), the shape
// TASK-017 used for a doc outside scope), and pairwise disjoint (4 OVERLAP
// naming the intersection) — split [s, e] into pieces in line order:
//
//   examined      a declared range (kept as declared, adjacent ones not merged)
//                 by: [examined_sha256] — the declaration that accounts for it
//   scanner-only  a remainder on a path some scanner row lists
//                 by: the rows' import identities, sorted (the presence proof)
//   unexamined    a remainder no row lists — the declaration gap, reported, allowed
//                 by: []
//   skipped       one entry per scope.skipped[] file, by: [reason]. A skipped
//                 file has no admitted range and no measured line count, so
//                 its entry carries SKIPPED_RANGE [1, 1]: the schema requires
//                 a range and cannot say "none"; renderers key on `status`.
//
// The accounting is sorted by path (UTF-8 byte order, the order canon sorts
// keys in) then start; scanner rows by import_sha256 with their paths sorted
// and deduplicated. Empty scope (`files: []`, D3 / US-014 AC-3) ⇒ `accounting:
// []`, `indeterminate: true` (what sign-off keys on, TASK-033); the scanner
// rows are still recorded, the skipped files are not — the declaration is
// validated all the same (a path in an empty scope is not a scope file).
//
// Pure (G-9): imports ./exit.mjs and ./tokens.mjs only. No clock, no fs, no
// child process, no hashing (both identities come in on the envelopes);
// inputs are never mutated. Shape errors in the caller's own arguments
// (scannerRows, the artifacts) are TypeErrors; errors in the agent-authored
// declaration are CliErrors with the exit code the command prints.

import { CliError, EXIT } from "./exit.mjs";
import { gap, overlap, schemaInvalid } from "./tokens.mjs";

/** coverage.schema.json `accounting[].status` enum, in the plan's order. */
export const COVERAGE_STATUSES = Object.freeze(["examined", "skipped", "scanner-only", "unexamined"]);
/** The placeholder range of a `skipped` entry (the schema's minimum; a skipped file has no admitted range). */
export const SKIPPED_RANGE = Object.freeze([1, 1]);

const SHA256 = /^[0-9a-f]{64}$/;
const EXAMINED = "examined";

/** UTF-8 byte order for paths — the order canon sorts keys in, so accounting and canonical JSON agree. */
function compareBytes(a, b) {
  if (a === b) return 0;
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) if (ab[i] !== bb[i]) return ab[i] - bb[i];
  return ab.length - bb.length;
}

const isRange = (r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] >= r[0];

function examinedInvalid(message) {
  return new CliError(EXIT.USAGE, schemaInvalid(EXAMINED, message));
}

// --- input shapes ------------------------------------------------------------------

function requireArtifact(name, value) {
  if (value === null || typeof value !== "object") throw new TypeError(`computeCoverage: ${name} must be an artifact {envelope, payload}`);
  const sha = value.envelope?.self_sha256;
  if (typeof sha !== "string" || !SHA256.test(sha)) throw new TypeError(`computeCoverage: ${name}.envelope.self_sha256 must be a sha256`);
  if (value.payload === null || typeof value.payload !== "object") throw new TypeError(`computeCoverage: ${name}.payload must be an object`);
  return { sha, payload: value.payload };
}

function requireScopePayload(where, payload) {
  if (!Array.isArray(payload.files) || payload.ranges === null || typeof payload.ranges !== "object" || !Array.isArray(payload.skipped)) {
    throw new TypeError(`${where}: scope payload must carry files[], ranges{} and skipped[]`);
  }
  for (const f of payload.files) if (typeof f?.path !== "string" || f.path.length === 0) throw new TypeError(`${where}: scope.files[] entries need a path`);
  for (const s of payload.skipped) if (typeof s?.path !== "string" || s.path.length === 0 || typeof s.reason !== "string" || s.reason.length === 0) throw new TypeError(`${where}: scope.skipped[] entries need path and reason`);
  for (const [path, ranges] of Object.entries(payload.ranges)) {
    if (!Array.isArray(ranges) || !ranges.every(isRange)) throw new TypeError(`${where}: scope.ranges[${path}] must be [[start, end], …] with 1 ≤ start ≤ end`);
  }
}

/**
 * The caller's contract for scanner rows: `{tool, version, import_sha256, paths[]}`
 * each, distinct identities. Returned sorted by identity with sorted, deduplicated paths.
 */
function normaliseScannerRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("computeCoverage: scannerRows must be an array");
  const seen = new Set();
  const out = rows.map((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw new TypeError(`computeCoverage: scannerRows[${i}] must be an object`);
    const keys = Object.keys(r).sort();
    if (keys.join(",") !== "import_sha256,paths,tool,version") throw new TypeError(`computeCoverage: scannerRows[${i}] must be exactly {tool, version, import_sha256, paths}`);
    if (typeof r.tool !== "string" || r.tool.length === 0) throw new TypeError(`computeCoverage: scannerRows[${i}].tool must be a non-empty string`);
    if (typeof r.version !== "string" || r.version.length === 0) throw new TypeError(`computeCoverage: scannerRows[${i}].version must be a non-empty string`);
    if (typeof r.import_sha256 !== "string" || !SHA256.test(r.import_sha256)) throw new TypeError(`computeCoverage: scannerRows[${i}].import_sha256 must be a sha256`);
    if (!Array.isArray(r.paths) || !r.paths.every((p) => typeof p === "string" && p.length > 0)) throw new TypeError(`computeCoverage: scannerRows[${i}].paths must be non-empty strings`);
    if (seen.has(r.import_sha256)) throw new TypeError(`computeCoverage: scannerRows[${i}].import_sha256 is a duplicate`);
    seen.add(r.import_sha256);
    return { tool: r.tool, version: r.version, import_sha256: r.import_sha256, paths: [...new Set(r.paths)].sort(compareBytes) };
  });
  return out.sort((a, b) => (a.import_sha256 < b.import_sha256 ? -1 : a.import_sha256 > b.import_sha256 ? 1 : 0));
}

// --- declarations ------------------------------------------------------------------

/**
 * Validate the declaration against the scope and collect, per path, its ranges
 * sorted by start. Throws 2 SCHEMA-INVALID(examined: …) for a range outside
 * the packet and 4 OVERLAP(<path>:<a>-<b>) for two ranges sharing a line.
 * @returns {Map<string, Array<[number, number]>>}
 */
function declaredByPath(scope, declared) {
  if (!Array.isArray(declared)) throw examinedInvalid("declared must be an array");
  const scopeFiles = new Set(scope.files.map((f) => f.path));
  const byPath = new Map();
  declared.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw examinedInvalid(`declared[${i}] must be an object`);
    const { path, ranges } = entry;
    if (typeof path !== "string" || path.length === 0) throw examinedInvalid(`declared[${i}].path must be a non-empty string`);
    if (!scopeFiles.has(path)) throw examinedInvalid(`declared[${i}].path ${path} is not a scope file`);
    if (!Array.isArray(ranges)) throw examinedInvalid(`declared[${i}].ranges must be an array`);
    const admitted = Object.hasOwn(scope.ranges, path) ? scope.ranges[path] : [];
    ranges.forEach((r, j) => {
      if (!isRange(r)) throw examinedInvalid(`declared[${i}].ranges[${j}] must be [start, end] with 1 ≤ start ≤ end`);
      const [a, b] = r;
      if (!admitted.some(([s, e]) => a >= s && b <= e)) throw examinedInvalid(`declared[${i}].ranges[${j}] ${a}-${b} lies outside the admitted ranges of ${path}`);
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push([a, b]);
    });
  });
  for (const [path, ranges] of byPath) {
    ranges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (let k = 1; k < ranges.length; k++) {
      const prev = ranges[k - 1];
      const next = ranges[k];
      if (next[0] <= prev[1]) throw new CliError(EXIT.FAIL, overlap(path, next[0], Math.min(prev[1], next[1])));
    }
  }
  return byPath;
}

// --- accounting --------------------------------------------------------------------

/**
 * @param {{envelope: {self_sha256: string}, payload: object}} scope
 * @param {{envelope: {self_sha256: string}, payload: object}} examined
 * @param {Array<{tool: string, version: string, import_sha256: string, paths: string[]}>} scannerRows
 * @returns {{accounting: object[], scanner_rows: object[], scope_sha256: string, examined_sha256: string, indeterminate: boolean}}
 * @throws {CliError} 2 SCHEMA-INVALID(examined: …) · 4 OVERLAP(<path>:<a>-<b>) · 4 GAP(<path>:<a>-<b>)
 * @throws {TypeError} on a caller-side shape error
 */
export function computeCoverage(scope, examined, scannerRows) {
  const s = requireArtifact("scope", scope);
  const x = requireArtifact("examined", examined);
  requireScopePayload("computeCoverage", s.payload);
  const scanner_rows = normaliseScannerRows(scannerRows);
  const declared = declaredByPath(s.payload, x.payload.declared);

  if (s.payload.files.length === 0) {
    return { accounting: [], scanner_rows, scope_sha256: s.sha, examined_sha256: x.sha, indeterminate: true };
  }

  const scannersOf = (path) => scanner_rows.filter((r) => r.paths.includes(path)).map((r) => r.import_sha256);
  const accounting = [];
  for (const file of s.payload.files) {
    const path = file.path;
    const admitted = Object.hasOwn(s.payload.ranges, path) ? s.payload.ranges[path] : [];
    const pieces = declared.get(path) ?? [];
    const scanners = scannersOf(path);
    const remainder = (a, b) => (scanners.length > 0 ? { path, range: [a, b], status: "scanner-only", by: scanners } : { path, range: [a, b], status: "unexamined", by: [] });
    for (const [start, end] of admitted) {
      let cursor = start;
      for (const [a, b] of pieces) {
        if (b < start || a > end) continue; // validated to lie inside one admitted range: it is another one
        if (a > cursor) accounting.push(remainder(cursor, a - 1));
        accounting.push({ path, range: [a, b], status: EXAMINED, by: [x.sha] });
        cursor = b + 1;
      }
      if (cursor <= end) accounting.push(remainder(cursor, end));
    }
  }
  for (const { path, reason } of s.payload.skipped) {
    accounting.push({ path, range: [...SKIPPED_RANGE], status: "skipped", by: [reason] });
  }
  accounting.sort((a, b) => compareBytes(a.path, b.path) || a.range[0] - b.range[0]);

  verifyAccounting(s.payload, accounting); // by construction; a GAP here is a bug in the loop above
  return { accounting, scanner_rows, scope_sha256: s.sha, examined_sha256: x.sha, indeterminate: false };
}

/**
 * The exactly-once check over a (recorded or freshly built) accounting.
 * @param {object} scopePayload
 * @param {object[]} accounting
 * @throws {CliError} 4 GAP(<path>:<a>-<b>) — an admitted range with uncovered lines
 * @throws {Error} an entry covering a line twice, a stray path, or a skipped file without exactly one entry
 */
export function verifyAccounting(scopePayload, accounting) {
  const where = "verifyAccounting";
  requireScopePayload(where, scopePayload);
  if (!Array.isArray(accounting)) throw new TypeError(`${where}: accounting must be an array`);
  const scopeFiles = new Set(scopePayload.files.map((f) => f.path));
  const skippedFiles = new Map(scopePayload.skipped.map((s) => [s.path, s.reason]));
  const indeterminate = scopePayload.files.length === 0;

  const byPath = new Map();
  const skippedSeen = new Map();
  accounting.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || typeof entry.path !== "string" || !isRange(entry.range) || !COVERAGE_STATUSES.includes(entry.status) || !Array.isArray(entry.by)) {
      throw new TypeError(`${where}: accounting[${i}] is not {path, range, status, by}`);
    }
    if (entry.status === "skipped") {
      if (indeterminate || !skippedFiles.has(entry.path)) throw new Error(`${where}: accounting[${i}] is a skipped entry for ${entry.path}, which scope.skipped[] does not list`);
      if (skippedSeen.has(entry.path)) throw new Error(`${where}: ${entry.path} has a skipped entry twice`);
      skippedSeen.set(entry.path, i);
      return;
    }
    if (indeterminate || !scopeFiles.has(entry.path)) throw new Error(`${where}: accounting[${i}] names ${entry.path}, which is not a scope file`);
    if (!byPath.has(entry.path)) byPath.set(entry.path, []);
    byPath.get(entry.path).push(entry.range);
  });

  if (!indeterminate) {
    for (const path of skippedFiles.keys()) {
      if (!skippedSeen.has(path)) throw new Error(`${where}: skipped file ${path} has no skipped entry`);
    }
    for (const path of scopeFiles) {
      const admitted = [...(Object.hasOwn(scopePayload.ranges, path) ? scopePayload.ranges[path] : [])].sort((a, b) => a[0] - b[0]);
      const entries = [...(byPath.get(path) ?? [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let k = 0;
      for (const [start, end] of admitted) {
        let cursor = start;
        while (k < entries.length && entries[k][0] <= end) {
          const [a, b] = entries[k];
          if (a < cursor) throw new Error(`${where}: ${path}:${a}-${b} covers a line twice (overlapping accounting entries)`);
          if (a > cursor) throw new CliError(EXIT.FAIL, gap(path, cursor, a - 1));
          if (b > end) throw new Error(`${where}: ${path}:${a}-${b} runs past the admitted range ${start}-${end}`);
          cursor = b + 1;
          k++;
        }
        if (cursor <= end) throw new CliError(EXIT.FAIL, gap(path, cursor, end));
      }
      if (k < entries.length) throw new Error(`${where}: ${path}:${entries[k][0]}-${entries[k][1]} lies in no admitted range`);
    }
  }
}

/**
 * Entries per status — what the COVERAGE line prints.
 * @param {object[]} accounting
 * @returns {{examined: number, skipped: number, "scanner-only": number, unexamined: number}}
 */
export function countByStatus(accounting) {
  const counts = Object.fromEntries(COVERAGE_STATUSES.map((s) => [s, 0]));
  for (const entry of accounting) {
    if (!Object.hasOwn(counts, entry?.status)) throw new TypeError(`countByStatus: status ${String(entry?.status)} is outside the closed vocabulary`);
    counts[entry.status]++;
  }
  return counts;
}
