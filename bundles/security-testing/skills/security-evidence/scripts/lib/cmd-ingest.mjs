// lib/cmd-ingest.mjs — `evidence.mjs ingest <kind> <file> --run <id>
// [--sent <ticket.json>]` (TASK-015; plan §4.1 row `ingest`; spec §6.6).
//
// The dispatcher: one persistence path for every adapter (lib/imports.mjs),
// one adapter per kind (lib/ingest/<kind>.mjs, contract in
// lib/ingest/_shared.mjs), one enveloped record per import.
//
// Order, so a refusal leaves nothing behind and nothing is half-indexed:
//
//   1. argv: <kind> ∈ IMPORT_KINDS, one <file>, --run <id>; --sent only with
//      tracker-readback, and required by it (2 USAGE otherwise);
//   2. the adapter module — a kind whose adapter is not shipped yet is
//      2 USAGE(ingest: adapter <kind> is not available), before the file is
//      touched;
//   3. the file: ctx.input() (cwd-relative, realpath'd, inside root — else
//      2 USAGE) and read (ENOENT / EISDIR ⇒ 2 USAGE(ingest: cannot read …));
//      --sent the same way, then parseStrict (2 SCHEMA-INVALID(tracker-
//      readback: --sent does not parse …)) and redactDeep — it reaches the
//      adapter as extra.sent_payload and is not itself an import (TASK-017);
//   4. run.json (2 USAGE unknown run), COMMITTED ⇒ 2 RUN-COMMITTED (G-10),
//      the run's key (2 KEY: unavailable), scope.json when present (null
//      otherwise — an adapter that needs it says 3 INCOMPLETE(scope));
//   5. imports.prepareImport — HMAC → redact → identify, in memory (a JSON
//      kind that does not parse ⇒ 2 SCHEMA-INVALID(<kind>: …), nothing
//      written); a record for these redacted bytes already in the run ⇒
//      2 IMPORT-EXISTS(<sha>) (the record is write-once);
//   6. the adapter over the redacted input ⇒ {records, unlocated, rejected,
//      mapping_version}; the record payload is assembled and validated
//      against import.schema.json (an off-schema adapter result is an
//      internal error, exit 1 — never written);
//   7. imports.snapshotImport with `index: false` — the redacted bytes land
//      under ledger/<run>/imports/<sha> (G-3) — then the record is written
//      write-once to <run>/ingest/<sha>.json (kind `import`; EEXIST from a
//      concurrent ingest ⇒ 2 IMPORT-EXISTS), then the index entry is
//      appended (assessment runs only, TL-14). An index entry always has its
//      record; a record may at worst lack its entry after a crash between
//      the two writes, which a re-ingest reports as IMPORT-EXISTS.
//
// stdout: `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n>
// rejected=<n>`, then — `tracker-readback` only — `READBACK: ok` or one
// `READBACK: MISMATCH(<field>)` per mismatched field of the record (TASK-017;
// TASK-045 adds `TICKETED <R-id> <url>` and the register event after them),
// then `WROTE <run>/imports.json …` (assessment only), then
// `WROTE <run>/ingest/<sha>.json …` last. Exit 0; 2 as above; 3
// INCOMPLETE(scope); rejections inside a well-formed file never change the
// exit code (§4.1).
//
// Imports: node:fs (existsSync, readFileSync), node:path, ../canon.mjs,
// ../redact.mjs (redactDeep for --sent), ./argv.mjs, ./exit.mjs,
// ./imports.mjs, ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs. Every
// string that leaves the process goes through ctx.out / ctx.wrote (G-4).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { IMPORT_KINDS, appendImportIndex, loadRun, prepareImport, snapshotImport } from "./imports.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, KEY_UNAVAILABLE, READBACK_OK, RUN_COMMITTED, importExists, importLine, readbackMismatch, schemaInvalid } from "./tokens.mjs";

const COMMAND = "ingest";
// TASK-002/005 follow-up (plan §6): one exported constant is owed; until then every enveloped-artifact writer carries the same literal.
const SCHEMA_VERSION = 1;
const READBACK = "tracker-readback";

/** The adapter for `kind`, or 2 USAGE when it is not shipped (TASK-016/017/018 add theirs). */
async function loadAdapter(kind) {
  let mod;
  try {
    mod = await import(`./ingest/${kind}.mjs`);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" && typeof err.message === "string" && err.message.includes(`/ingest/${kind}.mjs`)) {
      throw usageError(COMMAND, `adapter ${kind} is not available`);
    }
    throw err;
  }
  if (typeof mod.adapt !== "function") throw new Error(`ingest: lib/ingest/${kind}.mjs has no adapt()`);
  return mod.adapt;
}

function readInput(ctx, p) {
  const abs = ctx.input(COMMAND, p);
  try {
    return { abs, bytes: readFileSync(abs) };
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(COMMAND, `cannot read ${p}`);
    throw err;
  }
}

/**
 * `--sent <ticket.json>` (tracker-readback only, TASK-017): the payload
 * `publish --profile tracker` wrote, read through ctx.input() like every
 * user-typed path, parsed strictly (an unparseable file is this command's
 * own exit-2 result — never a CanonError left for the dispatcher, lib/exit.mjs
 * header) and redacted before the adapter compares it with the read-back.
 * It is not an import: publish already persisted it, redacted, under
 * handoffs/; only `extra.sent_payload` (and the resolved path as `extra.sent`)
 * reach the adapter, which validates the fields it needs.
 */
function readSent(ctx, p) {
  const { abs, bytes } = readInput(ctx, p);
  let parsed;
  try {
    parsed = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(READBACK, `--sent does not parse: ${err.message}`), { cause: err });
    throw err;
  }
  return { sent: abs, sent_payload: redactDeep(parsed) };
}

function loadScope(run) {
  const path = join(run.dir, "scope.json");
  if (!existsSync(path)) return null;
  return readArtifact(path, { kind: "scope" });
}

const LIST_KEYS = Object.freeze(["records", "unlocated", "rejected"]);

/** The adapter's result, checked before it is trusted with a locator base (an adapter bug is an internal error, never a written artifact). */
function checkAdapted(kind, adapted, base) {
  if (adapted === null || typeof adapted !== "object") throw new Error(`ingest ${kind}: adapter returned ${String(adapted)}`);
  for (const key of LIST_KEYS) {
    if (!Array.isArray(adapted[key])) throw new Error(`ingest ${kind}: adapter result.${key} must be an array`);
  }
  if (typeof adapted.mapping_version !== "string" || adapted.mapping_version === "") throw new Error(`ingest ${kind}: adapter result.mapping_version must be a non-empty string`);
  for (const key of LIST_KEYS) {
    adapted[key].forEach((item, i) => {
      const loc = item?.locator;
      if (loc === null || typeof loc !== "object" || loc.import_sha256 !== base.import_sha256) throw new Error(`ingest ${kind}: ${key}[${i}].locator does not name this import`);
      if (key === "records" && loc.original_hmac !== base.original_hmac) throw new Error(`ingest ${kind}: records[${i}].locator.original_hmac is not this import's`);
    });
  }
  return adapted;
}

/**
 * @param {string[]} argv after `ingest`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", sent: "value" });
  const [kind, file, ...stray] = positionals;
  if (kind === undefined) throw usageError(COMMAND, `a kind is required (${IMPORT_KINDS.join("|")})`);
  if (!IMPORT_KINDS.includes(kind)) throw usageError(COMMAND, `kind must be one of ${IMPORT_KINDS.join("|")}`);
  if (file === undefined) throw usageError(COMMAND, "a file is required");
  if (stray.length > 0) throw usageError(COMMAND, `unexpected argument ${stray[0]}`);
  if (typeof flags.run !== "string") throw usageError(COMMAND, "--run <id> is required");
  if (flags.sent !== undefined && kind !== READBACK) throw usageError(COMMAND, `--sent is for ${READBACK} only`);
  if (kind === READBACK && flags.sent === undefined) throw usageError(COMMAND, `--sent <ticket.json> is required for ${READBACK}`);

  const adapt = await loadAdapter(kind);
  const { abs, bytes } = readInput(ctx, file);
  const source_path = ctx.rel(abs);
  const extra = flags.sent === undefined ? {} : readSent(ctx, flags.sent);

  const loaded = loadRun(ctx, flags.run);
  if (existsSync(join(loaded.dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const key = ctx.keyById(loaded.envelope.key_id);
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);
  const scope = loadScope(loaded);

  const prepared = prepareImport(key.bytes, bytes, { kind }); // 2 SCHEMA-INVALID(<kind>: …) on a JSON kind that does not parse
  const recordPath = join(loaded.dir, "ingest", `${prepared.import_sha256}.json`);
  if (existsSync(recordPath)) throw new CliError(EXIT.USAGE, importExists(prepared.import_sha256));

  const base = { import_sha256: prepared.import_sha256, original_hmac: prepared.original_hmac, source_path };
  const adapted = checkAdapted(kind, await adapt(ctx, loaded, scope, prepared.redacted, base, extra), base);
  const payload = {
    kind,
    import_sha256: prepared.import_sha256,
    original_hmac: prepared.original_hmac,
    redaction_version: prepared.redaction_version,
    mapping_version: adapted.mapping_version,
    source_path,
    records: adapted.records,
    unlocated: adapted.unlocated,
    rejected: adapted.rejected,
  };
  const errors = validate("import", payload);
  if (errors.length > 0) throw new Error(`ingest ${kind}: record payload is off-schema: ${errors[0]}`);

  // Persist: bytes (G-3), then the record (write-once), then the index entry (TL-14).
  await snapshotImport(ctx, loaded.run_id, bytes, { kind, source_path, index: false, run: loaded });
  const { engagement_id, key_id } = loaded.envelope;
  const head = { schema_version: SCHEMA_VERSION, kind: "import", run_id: loaded.run_id, engagement_id, key_id, now: ctx.now };
  let record;
  try {
    record = writeArtifact(recordPath, makeEnvelope(head, payload), { exclusive: true });
  } catch (err) {
    if (err.code === "EEXIST") throw new CliError(EXIT.USAGE, importExists(prepared.import_sha256), { cause: err });
    throw err;
  }
  const index = await appendImportIndex(ctx, loaded.run_id, { kind, import_sha256: prepared.import_sha256, original_hmac: prepared.original_hmac }, { run: loaded });

  ctx.out(importLine({ kind, import_sha256: prepared.import_sha256, records: payload.records.length, unlocated: payload.unlocated.length, rejected: payload.rejected.length }));
  if (kind === READBACK) {
    // One READBACK line per record (the adapter yields exactly one): `ok`, or one MISMATCH(<field>) per mismatched field, in READBACK_FIELDS order (TASK-017).
    // TASK-045 appends the `ticketed` event and prints TICKETED here, after these lines and only when mismatch is empty.
    for (const rec of payload.records) {
      if (rec.trusted.mismatch.length === 0) ctx.out(READBACK_OK);
      else for (const field of rec.trusted.mismatch) ctx.out(readbackMismatch(field));
    }
  }
  if (index !== null) ctx.wrote(join(loaded.dir, "imports.json"), index);
  ctx.wrote(recordPath, record);
  return EXIT.OK;
}
