// lib/ingest/sarif.mjs — `ingest sarif <file>` (TASK-016; spec §6.6 row
// `sarif`: structural validation = schema + the §6.7 matrix; trusted after
// validation = canonical in-repo path within scope, rule id, level; inert =
// `message.text`, `snippet.text`; D6; US-010). The matrix itself is
// lib/ingest/_sarif.mjs (pure); this file is its I/O:
//
//   MAPPING_PATH / loadMapping(path?)
//       `references/sarif-mapping.v1.json` (D6 "versioned mapping"; shape in
//       sarif-mapping.v1.schema.json, TASK-005): per-tool confidence and
//       rule-id prefix → class tables, tag → class, level → priority,
//       default_confidence. Read with canon.parseStrict and validated on
//       every load; a mapping that fails its schema is a bundle bug (throws
//       — never a silent fallback), and `mapping_version` in the import
//       record is the file's `version` (US-010 AC-6).
//   adapt(ctx, run, scope, redactedInput, locatorBase)
//       the adapter contract (lib/ingest/_shared.mjs header): hands the
//       redacted parsed log to adaptSarif with `readSide` bound to
//       cite.resolveSide(ctx, run, scope, {path, side}) — the one resolver
//       every citation consumer shares (plan §3.3 / TASK-014) — so a snippet
//       the scanner omitted, and the raw → normalised line mapping every
//       located result needs, come from the recorded side (head: the git
//       blob at head_oid; snapshot: the redacted private snapshot, sha256-
//       checked). The bytes stay in memory; what reaches the record is
//       wrapInert'ed (redacted) text and line numbers (G-3/G-4).
//
// This adapter is the one that reads outside its input (the plan names
// `cite.resolveSide` for it): a scope file that cannot be resolved is not a
// data outcome but the bundle's own state gone wrong, mapped to exit 5 —
// SnapshotMismatch ⇒ INCONSISTENT(snapshot:<path>), SnapshotMissing ⇒
// INCONSISTENT(snapshot:<path>), ObjectMissing ⇒ INCONSISTENT(scope:<path>) —
// with the path only, never a hash or the resolver's message (G-2/G-4).
//
// Without scope.json the adapter says 3 INCOMPLETE(scope) before any side is
// read (§6.1 order: scope precedes ingest).
//
// Imports: node:fs (readFileSync of the bundle's own reference file only),
// node:path, node:url, ../../canon.mjs (parseStrict), ../cite.mjs
// (resolveSide + the CiteError classes — the only git reads, G-6),
// ../exit.mjs, ../schema.mjs, ../tokens.mjs, ./_sarif.mjs. No writes, no
// clock (G-1), no network (G-14). Never prints.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict } from "../../canon.mjs";
import { CiteError, ObjectMissing, resolveSide } from "../cite.mjs";
import { CliError, EXIT } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { incomplete, inconsistent } from "../tokens.mjs";
import { adaptSarif } from "./_sarif.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPPING_SCHEMA = "sarif-mapping.v1";

/** `references/sarif-mapping.v1.json` — the versioned mapping `ingest sarif` applies (D6). */
export const MAPPING_PATH = join(HERE, "..", "..", "..", "references", "sarif-mapping.v1.json");

/**
 * The mapping file, parsed strictly and validated against its schema.
 * @param {string} [path]
 * @returns {object}
 * @throws {Error} when the file is missing, does not parse, or fails sarif-mapping.v1.schema.json (a bundle bug)
 */
export function loadMapping(path = MAPPING_PATH) {
  let mapping;
  try {
    mapping = parseStrict(readFileSync(path));
  } catch (err) {
    throw new Error(`ingest sarif: ${MAPPING_SCHEMA} mapping at ${path} cannot be read: ${err.message}`, { cause: err });
  }
  const errors = validate(MAPPING_SCHEMA, mapping);
  if (errors.length > 0) throw new Error(`ingest sarif: ${MAPPING_SCHEMA} mapping at ${path} fails its schema: ${errors[0]}`);
  return mapping;
}

/** The shipped mapping's version, for callers that name it without loading the file. */
export const MAPPING_VERSION = loadMapping().version;

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope the run's scope.json, or null when absent
 * @param {unknown} redactedInput the redacted parsed SARIF log
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(sarif: …) on an off-shape file · 3 INCOMPLETE(scope) without scope.json · 5 INCONSISTENT(snapshot:<path>|scope:<path>) when a scope file cannot be resolved at its recorded side
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  if (scope === null || scope === undefined) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
  const mapping = loadMapping();
  const readSide = (path, side) => {
    try {
      return resolveSide(ctx, run, scope, { path, side });
    } catch (err) {
      if (err instanceof ObjectMissing) throw new CliError(EXIT.INTEGRITY, inconsistent(`scope:${path}`), { cause: err });
      if (err instanceof CiteError) throw new CliError(EXIT.INTEGRITY, inconsistent(`snapshot:${path}`), { cause: err });
      throw err;
    }
  };
  return adaptSarif(redactedInput, { scope, locatorBase, mapping, readSide });
}
