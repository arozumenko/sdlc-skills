// lib/imports.mjs — the import store: the one persistence path for every
// ingest adapter (TASK-015; spec §6.6, plan §3.3 row `lib/imports.mjs`,
// G-2, G-3, TL-3, TL-14).
//
// Spec §6.6: "Every import is snapshotted as redacted canonical bytes: the
// artifact is read, HMAC'd (original_hmac), redacted, then written to
// ledger/<run>/imports/<sha256 of the redacted bytes>; every derived record
// carries import_sha256 (redacted identity) + original_hmac + record index
// as its locator. Original bytes are never persisted by this bundle."
//
//   prepareImport(key, buf, {kind})
//       the in-memory half, in the G-3 order: original_hmac = HMAC_key(buf)
//       first, then the redacted form — text kinds (doc, case, audit,
//       qa-run): redactString(buf) as UTF-8; JSON kinds (sarif, ticket, pr,
//       ta-report, tracker-readback): parseStrict → redactDeep → canonical +
//       LF, so two spellings of the same JSON are one import — then
//       import_sha256 = sha256(redacted bytes) (plain sha256 over *redacted*
//       bytes is what G-2 allows). A JSON kind whose bytes do not parse is
//       the command's own exit-2 result, CliError(2, SCHEMA-INVALID(<kind>:
//       <reason>)), never a CanonError left for the dispatcher (which would
//       read it as an integrity failure, exit 5 — lib/exit.mjs header).
//       Returns {import_sha256, original_hmac, redaction_version,
//       redactedBytes, redacted} where `redacted` is what an adapter
//       receives: the string (text kinds) or the redacted parsed value (JSON
//       kinds). Pure over its arguments: no fs, no clock.
//
//   snapshotImport(ctx, run_id, buf, {kind, source_path, index = true})
//       the persistence path (G-3, one function): loadRun (unknown run ⇒ 2
//       USAGE; a COMMITTED run ⇒ 2 RUN-COMMITTED, G-10; the run's key
//       missing ⇒ 2 KEY: unavailable — the key is the one run.json names,
//       TL-9 "every artifact records the key_id it used", not whatever
//       keys/current says now) → prepareImport → fsx.writeAtomic the redacted
//       bytes to ledger/<run_id>/imports/<import_sha256> (content-addressed:
//       the same redacted bytes are the same file, so a re-ingest is a no-op
//       here) → when the run is an assessment and `index` is not false,
//       run-index.appendIndex(ctx, run_id, "imports", {kind, import_sha256,
//       original_hmac}) under the run lock (TL-14; review / verify /
//       threat-model runs carry no imports.json — `build-report --template
//       review` lists ingest/ directly). Returns the locator base plus
//       `path` (absolute blob path), `redaction_version`, `redacted` and
//       `index` (the index artifact now on disk, or null).
//       `index: false` is for cmd-ingest, which appends the index entry only
//       after the derived record exists (an index entry whose record is
//       missing would make the run INCOMPLETE at build-report; a record
//       whose index entry is missing is at worst re-ingested).
//
//   appendImportIndex(ctx, run_id, {kind, import_sha256, original_hmac})
//       the index half on its own (assessment runs; a no-op that returns null
//       for every other kind).
//
//   loadRun(ctx, run_id) → {run_id, dir, envelope, payload}   run.json, verified
//   importsDir(ctx, run_id)                                    <st>/ledger/<run_id>/imports
//   IMPORT_KINDS, TEXT_KINDS, JSON_KINDS
//
// Imports: node:fs (existsSync only — writes go through fsx / canon),
// node:path, ../canon.mjs, ../redact.mjs, ./exit.mjs, ./fsx.mjs,
// ./ledger.mjs (RUN_ID), ./run-index.mjs, ./tokens.mjs. No child process
// (G-6), no git, no network (G-14), no clock (G-1).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CanonError, canonical, hmacHex, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep, redactString } from "../redact.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { RUN_ID, ledgerPaths } from "./ledger.mjs";
import { appendIndex, runDir } from "./run-index.mjs";
import { COMMITTED, KEY_UNAVAILABLE, RUN_COMMITTED, schemaInvalid } from "./tokens.mjs";

const COMMAND = "ingest";

/** Kinds whose bytes are text: redacted as one string (spec §6.6 rows doc, case, audit, qa-run). */
export const TEXT_KINDS = Object.freeze(["doc", "case", "audit", "qa-run"]);
/** Kinds whose bytes are JSON: parsed strictly, redacted recursively, re-canonicalised (spec §6.6 rows sarif, ticket, pr, ta-report, tracker-readback). */
export const JSON_KINDS = Object.freeze(["sarif", "ticket", "pr", "ta-report", "tracker-readback"]);
/** The `ingest <kind>` vocabulary, in import.schema.json enum order (imports.test.mjs pins the equality). */
export const IMPORT_KINDS = Object.freeze(["sarif", "ticket", "pr", "doc", "case", "audit", "qa-run", "ta-report", "tracker-readback"]);

function requireKind(kind, where) {
  if (!IMPORT_KINDS.includes(kind)) throw new TypeError(`${where}: kind must be one of ${IMPORT_KINDS.join("|")}, got ${String(kind)}`);
  return kind;
}

function requireBuf(buf, where) {
  if (!(buf instanceof Uint8Array)) throw new TypeError(`${where}: buf must be a Buffer (the original bytes)`);
  return buf;
}

/** `<st>/ledger/<run_id>/imports` — the redacted import bytes of one run (TL-3, plan §3.2). */
export function importsDir(ctx, run_id) {
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw new TypeError(`imports: run_id must be <12 hex>-<4 digits>, got ${String(run_id)}`);
  return join(ledgerPaths(ctx).dir, run_id, "imports");
}

/**
 * The run's run.json, verified, plus where the run lives.
 * @param {object} ctx
 * @param {string} run_id
 * @returns {{run_id: string, dir: string, envelope: object, payload: object}}
 * @throws {CliError} 2 USAGE(ingest: --run must be …) · 2 USAGE(ingest: unknown run <id>)
 * @throws {IntegrityError | CanonError} when run.json is not the artifact it claims to be (exit-5 class)
 */
export function loadRun(ctx, run_id) {
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw usageError(COMMAND, "--run must be a run id (<12 hex>-<4 digits>)");
  const dir = runDir(ctx, run_id);
  const path = join(dir, "run.json");
  if (!existsSync(path)) throw usageError(COMMAND, `unknown run ${run_id}`);
  const { envelope, payload } = readArtifact(path, { kind: "run" });
  return { run_id, dir, envelope, payload };
}

/**
 * The in-memory half of the import store, in the G-3 order.
 * @param {Uint8Array} key the engagement key bytes (the run's key)
 * @param {Uint8Array} buf the original bytes, exactly as read
 * @param {{kind: string}} options
 * @returns {{import_sha256: string, original_hmac: string, redaction_version: number, redactedBytes: Buffer, redacted: string | unknown}}
 * @throws {CliError} 2 SCHEMA-INVALID(<kind>: <reason>) — a JSON kind whose bytes do not parse strictly
 * @throws {TypeError} bad kind, bad buf, empty key
 */
export function prepareImport(key, buf, { kind } = {}) {
  const where = "prepareImport";
  requireKind(kind, where);
  requireBuf(buf, where);
  const original_hmac = hmacHex(key, buf); // 1. HMAC the original …
  let redacted;
  let redactedBytes;
  if (TEXT_KINDS.includes(kind)) {
    redacted = redactString(buf, DEFAULT_RULES).text; // 2. … then redact …
    redactedBytes = Buffer.from(redacted, "utf8");
  } else {
    let parsed;
    try {
      parsed = parseStrict(buf);
    } catch (err) {
      if (err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(kind, err.message), { cause: err });
      throw err;
    }
    redacted = redactDeep(parsed, DEFAULT_RULES);
    redactedBytes = Buffer.concat([canonical(redacted), Buffer.from("\n")]);
  }
  const import_sha256 = sha256Hex(redactedBytes); // 3. … and identify the redacted form (G-2)
  return { import_sha256, original_hmac, redaction_version: DEFAULT_RULES.redaction_version, redactedBytes, redacted };
}

/**
 * The index half: `<run>/imports.json` +1 for assessment runs (TL-14); null for every other kind.
 * @param {object} ctx
 * @param {string} run_id
 * @param {{kind: string, import_sha256: string, original_hmac: string}} entry
 * @param {{run?: {payload: {template: string}}}} [options] the loaded run, to spare a second read
 * @returns {Promise<{envelope: object, payload: object} | null>} the index artifact now on disk, or null
 */
export async function appendImportIndex(ctx, run_id, { kind, import_sha256, original_hmac }, { run } = {}) {
  const loaded = run ?? loadRun(ctx, run_id);
  if (loaded.payload.template !== "assessment") return null;
  return appendIndex(ctx, run_id, "imports", { kind: requireKind(kind, "appendImportIndex"), import_sha256, original_hmac });
}

/**
 * Read → HMAC → redact → persist, in that order, in one function (G-3).
 * @param {object} ctx
 * @param {string} run_id
 * @param {Uint8Array} buf the original bytes
 * @param {{kind: string, source_path: string, index?: boolean, run?: object}} options
 * @returns {Promise<{import_sha256: string, original_hmac: string, redaction_version: number, path: string, redacted: string | unknown, index: object | null}>}
 * @throws {CliError} 2 USAGE (unknown run) · 2 RUN-COMMITTED · 2 KEY: unavailable · 2 SCHEMA-INVALID(<kind>: …)
 */
export async function snapshotImport(ctx, run_id, buf, { kind, source_path, index = true, run } = {}) {
  const where = "snapshotImport";
  requireKind(kind, where);
  requireBuf(buf, where);
  if (typeof source_path !== "string" || source_path === "") throw new TypeError(`${where}: source_path (repo-relative) is required`);
  const loaded = run ?? loadRun(ctx, run_id);
  if (existsSync(join(loaded.dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const key = ctx.keyById(loaded.envelope.key_id);
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);

  const prepared = prepareImport(key.bytes, buf, { kind });
  const path = join(importsDir(ctx, run_id), prepared.import_sha256);
  writeAtomic(path, prepared.redactedBytes); // 4. persist — redacted bytes only, content-addressed

  const entry = { kind, import_sha256: prepared.import_sha256, original_hmac: prepared.original_hmac };
  const written = index === false ? null : await appendImportIndex(ctx, run_id, entry, { run: loaded });
  return { ...entry, redaction_version: prepared.redaction_version, path, redacted: prepared.redacted, index: written };
}
