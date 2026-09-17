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
//   6a. `tracker-readback` only (TASK-045): first the read-back `url` is
//      held to the rule the TICKETED line enforces (tokens.ticketedLine: no
//      whitespace) — a url that carries any is 2 USAGE here, BEFORE any
//      persist (final-review I-6: the earlier order wrote the record and the
//      `ticketed` event, then threw a TypeError from the line; `new URL`
//      percent-encodes a space, so hostAllowed lets it through). Then, when
//      the record's `mismatch` is empty (the PM's gate — a foreign host is already a `url` mismatch on
//      a kept record, so "host ∈ targets.tracker and mismatch empty" is
//      exactly `mismatch.length === 0`) the register is READ — readEvents +
//      replay, chain-verified, no lock, no directory created, no projection
//      written (5 CORRUPT on a break, before anything is persisted) — for
//      the live row whose subject is the sent `finding_id` (subject_kind
//      finding, status not superseded). None ⇒ nothing to ticket (step 8
//      says so). More than one ⇒ 2 USAGE naming them, nothing written: a
//      read-back whose event has no single row to land on is not
//      half-ingested — the lead supersedes the duplicates and re-runs.
//      A mismatch consults nothing: the record is the evidence, no event.
//   6b. `qa-run` only (TASK-044, spec §9.2): the run's case_id ↔ case_sha256
//      join (lib/observations.mjs caseResolver — the run's `ingest case`
//      records and `<run>/admissions/`) derives, in memory, one observation
//      per result row whose case has an `admitted-*` record and one
//      unlocated Candidate (reason `unadmitted-case`) per row that has none;
//      the candidates join the record's `unlocated[]` (gate folds them into
//      `<run>/unlocated.json`, G-10). `ta-report` only: the per-unit payload
//      (lib/ta-units.mjs buildTaUnits) over the same join. Both run BEFORE
//      the first byte is written, so a structural refusal (a case id listed
//      twice) leaves nothing behind;
//   7. imports.snapshotImport with `index: false` — the redacted bytes land
//      under ledger/<run>/imports/<sha> (G-3) — then the derived files:
//      `<run>/observations/<id>.json` (each write-once + its index entry on
//      assessment runs, lib/observations.mjs writeObservations) or
//      `<run>/ta-units/<import_sha256>.json` (write-once, payload-only,
//      lib/ta-units.mjs writeTaUnits) — then the record is written
//      write-once to <run>/ingest/<sha>.json (kind `import`; EEXIST from a
//      concurrent ingest ⇒ 2 IMPORT-EXISTS), then the index entry is
//      appended (assessment runs only, TL-14). An index entry always has its
//      record; a record may at worst lack its entry after a crash between
//      the two writes, which a re-ingest reports as IMPORT-EXISTS. The
//      derived files precede the record so that a crash between them heals
//      on re-ingest (their writes are idempotent by identity) instead of
//      leaving a record whose observations can never be derived.
//   8. `tracker-readback` with an empty `mismatch` and one live row: the
//      `ticketed` event — `{ticket_url: trusted.url, import_sha256}`, `ref`
//      = the run id — is appended through register-core.append (under the
//      register lock, recovery rule re-run, folded in memory first; the
//      only emitter of `ticketed`, spec §6.8 / P4; `register.mjs transition
//      ticketed` is EMITTER-ONLY). The status never changes; the row gains
//      the url. The event names the import that is its evidence, so a
//      record always precedes its event; a crash between the two leaves a
//      record without an event, which the lead sees as a row without a
//      `ticket_url` and re-reads back (a fresh response is new bytes).
//
// stdout: `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n>
// rejected=<n>`, then — `tracker-readback` only — one of: `READBACK: ok`
// followed by `TICKETED <R-id> <url>` (the event landed), or `READBACK: ok
// (no register row)` (matched, nothing to land on), or one `READBACK:
// MISMATCH(<field>)` per mismatched field of the record (TASK-017; no
// event); then — `qa-run` only — `OBSERVATION <id> case=<c> result=<r>` +
// `WROTE <run>/observations/<id>.json …` per observation and `WROTE
// <run>/observations.json …` when the index grew; — `ta-report` only —
// `TA-UNITS <run>/ta-units/<sha>.json units=<n> sha256=<h>`; then `WROTE
// <run>/imports.json …` (assessment only), then `WROTE
// <run>/ingest/<sha>.json …` last. Exit 0; 2 as above; 3
// INCOMPLETE(scope); 5 CORRUPT (read-back with an empty mismatch over a
// broken register, nothing written); rejections inside a well-formed file
// never change the exit code (§4.1).
//
// Imports: node:fs (existsSync, readFileSync), node:path, ../canon.mjs,
// ../redact.mjs (redactDeep for --sent), ./argv.mjs, ./exit.mjs,
// ./imports.mjs, ./observations.mjs, ./register-core.mjs (append,
// readEvents, replay), ./register-transitions.mjs (TransitionError),
// ./run-index.mjs (runDir), ./schema.mjs, ./ta-units.mjs, ./tokens.mjs.
// Every string that leaves the process goes through ctx.out / ctx.wrote
// (G-4).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { IMPORT_KINDS, appendImportIndex, loadRun, prepareImport, snapshotImport } from "./imports.mjs";
import { caseResolver, deriveObservations, writeObservations } from "./observations.mjs";
import { append as appendEvent, readEvents, replay } from "./register-core.mjs";
import { TransitionError } from "./register-transitions.mjs";
import { validate } from "./schema.mjs";
import { buildTaUnits, writeTaUnits } from "./ta-units.mjs";
import { COMMITTED, CORRUPT, KEY_UNAVAILABLE, READBACK_OK, READBACK_OK_NO_ROW, RUN_COMMITTED, importExists, importLine, observationLine, readbackMismatch, schemaInvalid, taUnitsLine, ticketedLine, transitionRejected } from "./tokens.mjs";

const COMMAND = "ingest";
// TASK-002/005 follow-up (plan §6): one exported constant is owed; until then every enveloped-artifact writer carries the same literal.
const SCHEMA_VERSION = 1;
const READBACK = "tracker-readback";
const QA_RUN = "qa-run";
const TA_REPORT = "ta-report";

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

// --- tracker-readback → ticketed (TASK-045) ---------------------------------------

/** The register projection, read without a lock and without writing (chain-verified; 5 CORRUPT) — the same read cmd-publish does for its dedupe. */
function readProjection(ctx) {
  const engagement_id = ctx.engagement().engagement_id;
  const events = readEvents(ctx);
  try {
    return replay(events, engagement_id);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err.name === "ChainError" || err.name === "TransitionError") throw integrityFailure(CORRUPT, err);
    throw err;
  }
}

/** The live rows whose subject is `finding_id`: subject_kind finding, not superseded (a superseded row is dead; its successor carries the subject), in row-id order. */
function liveRowsFor(rows, finding_id) {
  return Object.keys(rows)
    .sort()
    .map((id) => rows[id])
    .filter((r) => r.subject === finding_id && r.subject_kind === "finding" && r.status !== "superseded");
}

/**
 * Step 6a: the row a matched read-back will land on, or null when there is
 * none. Runs before anything is persisted, so a CORRUPT register or an
 * ambiguous subject refuses the whole ingest with nothing written.
 * @returns {{row_id: string} | null}
 */
function resolveTicketRow(ctx, record) {
  // the url the TICKETED line and the `ticketed` event would carry; refused before the mismatch gate so a whitespace url
  // never persists as a record either (it could not print, and a `ticketed(<url>)` disposition could never spell it)
  if (/\s/.test(record.trusted.url)) throw usageError(COMMAND, "read-back url carries whitespace; a tracker url has none — fix the response and re-run; nothing written");
  if (record.trusted.mismatch.length !== 0) return null;
  const projection = readProjection(ctx);
  const rows = liveRowsFor(projection.rows, record.trusted.finding_id);
  if (rows.length === 0) return null;
  if (rows.length > 1) throw usageError(COMMAND, `finding has ${rows.length} live register rows (${rows.map((r) => r.id).join(", ")}); supersede the duplicates first`);
  return { row_id: rows[0].id };
}

/** Step 8: append `ticketed` for one matched record and return the TICKETED line. */
async function ticket(ctx, { row_id, run_id, record, import_sha256 }) {
  try {
    await appendEvent(ctx, { row_id, event: "ticketed", payload: { ticket_url: record.trusted.url, import_sha256 }, ref: run_id });
  } catch (err) {
    if (err instanceof TransitionError) throw new CliError(EXIT.FAIL, transitionRejected(err.event, err.from), { cause: err });
    throw err;
  }
  return ticketedLine({ row: row_id, url: record.trusted.url });
}

// --- qa-run → observations, ta-report → ta-units (TASK-044) --------------------------

/**
 * Step 6b: the hand-off intake records derived from the adapter's result,
 * in memory. `unlocated` are the unadmitted-case candidates the record
 * carries; `observations` / `taUnits` are written in step 7.
 * @returns {{observations: object[], unlocated: object[], taUnits: object | null}}
 */
function deriveHandoff(kind, run, adapted, import_sha256) {
  const none = { observations: [], unlocated: [], taUnits: null };
  if (kind !== QA_RUN && kind !== TA_REPORT) return none;
  const resolve = caseResolver(run.dir);
  if (kind === QA_RUN) return { ...none, ...deriveObservations(adapted.records, { import_sha256, resolve }) };
  return { ...none, taUnits: buildTaUnits(adapted.records, { import_sha256, resolve }) };
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
  // 6b. the hand-off intake records (TASK-044), derived in memory before anything is persisted
  const derived = deriveHandoff(kind, loaded, adapted, prepared.import_sha256);
  const payload = {
    kind,
    import_sha256: prepared.import_sha256,
    original_hmac: prepared.original_hmac,
    redaction_version: prepared.redaction_version,
    mapping_version: adapted.mapping_version,
    source_path,
    records: adapted.records,
    unlocated: [...adapted.unlocated, ...derived.unlocated],
    rejected: adapted.rejected,
  };
  const errors = validate("import", payload);
  if (errors.length > 0) throw new Error(`ingest ${kind}: record payload is off-schema: ${errors[0]}`);
  // 6a. the row a matched read-back lands on — resolved before the first byte is written (the adapter yields exactly one record)
  const ticketRows = kind === READBACK ? payload.records.map((rec) => resolveTicketRow(ctx, rec)) : [];

  // Persist: bytes (G-3), the derived files (step 7), then the record (write-once), then the index entry (TL-14).
  await snapshotImport(ctx, loaded.run_id, bytes, { kind, source_path, index: false, run: loaded });
  const observations = derived.observations.length === 0 ? null : await writeObservations(ctx, loaded, derived.observations);
  const taUnits = derived.taUnits === null ? null : writeTaUnits(ctx, loaded, derived.taUnits);
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
    // One READBACK line per record (the adapter yields exactly one): `ok` + TICKETED (the event lands here, step 8),
    // `ok (no register row)`, or one MISMATCH(<field>) per mismatched field in READBACK_FIELDS order (TASK-017) — no event.
    for (const [i, rec] of payload.records.entries()) {
      if (rec.trusted.mismatch.length !== 0) {
        for (const field of rec.trusted.mismatch) ctx.out(readbackMismatch(field));
      } else if (ticketRows[i] === null) {
        ctx.out(READBACK_OK_NO_ROW);
      } else {
        ctx.out(READBACK_OK);
        ctx.out(await ticket(ctx, { row_id: ticketRows[i].row_id, run_id: loaded.run_id, record: rec, import_sha256: prepared.import_sha256 }));
      }
    }
  }
  if (observations !== null) {
    for (const { path, artifact } of observations.written) {
      ctx.out(observationLine({ observation_id: artifact.payload.observation_id, case_id: artifact.payload.case_id, result: artifact.payload.result }));
      ctx.wrote(path, artifact);
    }
    if (observations.index !== null) ctx.wrote(join(loaded.dir, "observations.json"), observations.index);
  }
  if (taUnits !== null) ctx.out(taUnitsLine({ relPath: ctx.rel(taUnits.path), units: derived.taUnits.units.length, sha256: taUnits.sha256 }));
  if (index !== null) ctx.wrote(join(loaded.dir, "imports.json"), index);
  ctx.wrote(recordPath, record);
  return EXIT.OK;
}
