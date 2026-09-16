// lib/cmd-coverage.mjs — `evidence.mjs coverage --run <id> --examined
// <payload.json> [--scanner-rows <file>]` (TASK-020; plan §4.1 row `coverage`,
// §5 TASK-020; spec D3, §6.1 `coverage.json` preimage, §6.3 derivation table,
// TL-4 drop-box, TL-15 packet naming; US-014 AC-1…AC-4).
//
// Admits the reviewer's examined declaration — a payload-only file the agent
// dropped under `<st>/receipts/<run>/` (TL-4) — as `<run>/examined.json`, and
// derives `<run>/coverage.json` from scope.json + that declaration through the
// pure core (lib/coverage-core.mjs): every admitted range of every scope file
// in exactly one accounting entry (examined | scanner-only | unexamined), one
// `skipped(<reason>)` entry per skipped file. Scripts derive, agents assert
// (G-7): the declaration carries paths and ranges only; the schema's
// `additionalProperties: false` refuses an `id`, `state` or anything else.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape), `--examined` (required), `--scanner-rows`
//      (optional); no positionals (2 USAGE);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED (G-10); `scope.json` absent ⇒ 3 INCOMPLETE(scope) (§6.1
//      order: scope precedes coverage); `examined.json` or `coverage.json`
//      present ⇒ 2 COVERAGE-EXISTS (write-once; retry = new seq); then
//      run.json and scope.json are read (5 when either is not the artifact
//      it claims to be, readArtifact);
//   3. the declaration: ctx.input() (cwd-relative, realpath'd, inside root —
//      else 2 USAGE), readFileSync (unreadable ⇒ 2 USAGE(coverage: cannot
//      read <p>)), parseStrict (2 SCHEMA-INVALID(examined: …) — the input-side
//      exit-5 rule of lib/exit.mjs: a parse error over the command's own
//      input is never left for the dispatcher), examined.schema.json (2
//      SCHEMA-INVALID(examined: <err>)); its `packet_sha256` must name
//      `<run>/packets/<sha>.json` and that packet must be `kind: scope` — the
//      packet the `review` contract was given (TL-15) — else 2
//      EXAMINED-PACKET-MISMATCH (a packet file that is not the artifact it
//      claims to be is 5, readArtifact);
//   4. `--scanner-rows <file>`: `{rows: [{import_sha256, paths?}]}`, read the
//      same way (2 SCHEMA-INVALID(scanner-rows: …) for a parse or shape
//      error). A row proves artifact presence only (plan §5 TASK-020): its
//      `import_sha256` must name `<run>/ingest/<sha>.json` and that record
//      must be a `sarif` import (else 2 SCHEMA-INVALID(scanner-rows: …));
//      `tool` and `version` come from the record (`trusted.tool` /
//      `trusted.tool_version` of its first located record, else the first
//      unlocated candidate's `tool`, else "unknown" — never blank, spec §11)
//      so the SARIF is never read again (TASK-016 note); `paths` as given,
//      or when absent the distinct paths of the record's located records;
//   5. the declaration payload is redacted in memory and its identity
//      computed ahead of the write (the same bytes writeArtifact would name,
//      G-4), so the core's result and the on-disk examined.json agree;
//      `computeCoverage` (2 SCHEMA-INVALID(examined: …) for a declaration
//      outside the packet, 4 OVERLAP(<path>:<a>-<b>), 4 GAP(<path>:<a>-<b>));
//      the coverage payload is validated against coverage.schema.json (an
//      Error — a bug — if it fails);
//   6. `<run>/examined.json` then `<run>/coverage.json`, both write-once
//      (canon.writeArtifact {exclusive}); envelope key_id is the run's.
//
// stdout: `COVERAGE examined=<n> skipped=<n> scanner=<n>` (entries by status)
// or `COVERAGE INDETERMINATE` (empty scope: `accounting: []`,
// `indeterminate: true` — the artifacts are still written so sign-off can key
// on them), then `WROTE <examined.json>` and `WROTE <coverage.json>`. Exit 0;
// 2 USAGE / RUN-COMMITTED / COVERAGE-EXISTS / SCHEMA-INVALID(examined|
// scanner-rows: …) / EXAMINED-PACKET-MISMATCH; 3 INCOMPLETE(scope); 4 OVERLAP
// / GAP; 5 when a run artifact is not what it claims to be.
//
// Imports: node:fs (existsSync, readFileSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs (redactDeep,
// for the pre-write identity), ./argv.mjs, ./coverage-core.mjs, ./exit.mjs,
// ./ledger.mjs (RUN_ID), ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs.
// No git, no network (G-14), no clock (G-1: created_at is ctx.now()). Every
// string that leaves the process goes through ctx.out / canon.writeArtifact
// (G-4); no error message of a foreign module is echoed except the parse
// error of the user's own file, which redact.mjs sees on the way out.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { computeCoverage, countByStatus } from "./coverage-core.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, COVERAGE_EXISTS, COVERAGE_INDETERMINATE, EXAMINED_PACKET_MISMATCH, RUN_COMMITTED, coverageLine, incomplete, schemaInvalid } from "./tokens.mjs";

const COMMAND = "coverage";
const EXAMINED = "examined";
const SCANNER_ROWS = "scanner-rows";
const SHA256 = /^[0-9a-f]{64}$/;
/** The value a scanner row carries when the import record names no tool or version (spec §11: never blank). */
export const UNKNOWN = "unknown";

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", examined: "value", "scanner-rows": "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  if (flags.examined === undefined) throw usageError(COMMAND, "--examined <payload.json> is required");
  return { run_id, examinedPath: flags.examined, scannerRowsPath: flags["scanner-rows"] };
}

// --- run ----------------------------------------------------------------------------

/** The run's artifacts; every refusal here is a token, nothing is written. */
function loadRun(ctx, run_id) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const scopePath = join(dir, "scope.json");
  if (!existsSync(scopePath)) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
  if (existsSync(join(dir, "examined.json")) || existsSync(join(dir, "coverage.json"))) throw new CliError(EXIT.USAGE, COVERAGE_EXISTS);
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  const scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json
  return { dir, run, scope };
}

// --- user-supplied inputs -----------------------------------------------------------

/**
 * A user-typed JSON file: ctx.input containment, then strict parse. A parse
 * error is the command's own exit-2 token (the input-side rule of lib/exit.mjs).
 */
function readUserJson(ctx, p, schemaName) {
  const abs = ctx.input(COMMAND, p);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(COMMAND, `cannot read ${p}`);
    throw err;
  }
  try {
    return parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(schemaName, err.message), { cause: err });
    throw err;
  }
}

/** The declaration, schema-checked and bound to a scope packet of this run (TL-15). */
function loadExamined(ctx, dir, p) {
  const payload = readUserJson(ctx, p, EXAMINED);
  const errors = validate(EXAMINED, payload);
  if (errors.length > 0) throw new CliError(EXIT.USAGE, schemaInvalid(EXAMINED, errors[0]));
  const packetPath = join(dir, "packets", `${payload.packet_sha256}.json`);
  if (!existsSync(packetPath)) throw new CliError(EXIT.USAGE, EXAMINED_PACKET_MISMATCH);
  const packet = readArtifact(packetPath, { kind: "packet" }); // 5 when the run's own packet is not what it claims to be
  if (packet.payload.kind !== "scope") throw new CliError(EXIT.USAGE, EXAMINED_PACKET_MISMATCH);
  return payload;
}

function rowsInvalid(message) {
  return new CliError(EXIT.USAGE, schemaInvalid(SCANNER_ROWS, message));
}

/** `tool` / `version` of a sarif import record without another read of the SARIF (TASK-016 note). */
function toolOf(record) {
  const first = record.records[0]?.trusted;
  if (first !== undefined) return { tool: first.tool ?? UNKNOWN, version: first.tool_version ?? UNKNOWN };
  const candidate = record.unlocated[0];
  return { tool: candidate?.tool ?? UNKNOWN, version: UNKNOWN };
}

/**
 * `--scanner-rows <file>` → the core's rows. Shape `{rows: [{import_sha256,
 * paths?}]}`, checked field by field (no schema exists for this input: it is
 * the lead's pointer at import records, not an artifact); every row must
 * name a sarif import record of this run.
 */
function loadScannerRows(ctx, dir, p) {
  if (p === undefined) return [];
  const parsed = readUserJson(ctx, p, SCANNER_ROWS);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw rowsInvalid("the file must be an object {rows: [...]}");
  for (const key of Object.keys(parsed)) if (key !== "rows") throw rowsInvalid(`unknown key ${key}`);
  if (!Array.isArray(parsed.rows)) throw rowsInvalid("rows must be an array");
  const seen = new Set();
  return parsed.rows.map((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw rowsInvalid(`rows[${i}] must be an object`);
    for (const key of Object.keys(row)) if (key !== "import_sha256" && key !== "paths") throw rowsInvalid(`rows[${i}]: unknown key ${key}`);
    const sha = row.import_sha256;
    if (typeof sha !== "string" || !SHA256.test(sha)) throw rowsInvalid(`rows[${i}].import_sha256 must be a sha256`);
    if (seen.has(sha)) throw rowsInvalid(`rows[${i}].import_sha256 is a duplicate`);
    seen.add(sha);
    if (row.paths !== undefined) {
      if (!Array.isArray(row.paths)) throw rowsInvalid(`rows[${i}].paths must be an array`);
      row.paths.forEach((path, j) => {
        if (typeof path !== "string" || path.length === 0) throw rowsInvalid(`rows[${i}].paths[${j}] must be a non-empty string`);
      });
    }
    const recordPath = join(dir, "ingest", `${sha}.json`);
    if (!existsSync(recordPath)) throw rowsInvalid(`rows[${i}].import_sha256 names no import of this run`);
    const record = readArtifact(recordPath, { kind: "import" }).payload; // 5 when the run's own record is not what it claims to be
    if (record.kind !== "sarif") throw rowsInvalid(`rows[${i}].import_sha256 names a ${record.kind} import, not sarif`);
    const paths = row.paths ?? record.records.map((r) => r.trusted.path);
    return { ...toolOf(record), import_sha256: sha, paths };
  });
}

// --- run() --------------------------------------------------------------------------

/**
 * @param {string[]} argv after `coverage`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const { dir, run, scope } = loadRun(ctx, args.run_id);
  const declaration = loadExamined(ctx, dir, args.examinedPath);
  const scannerRows = loadScannerRows(ctx, dir, args.scannerRowsPath);

  // Redacted before it is named (G-4): the identity the accounting cites is the on-disk one.
  const examinedPayload = redactDeep(declaration, DEFAULT_RULES);
  const examinedArtifactView = { envelope: { self_sha256: artifactId(examinedPayload) }, payload: examinedPayload };
  const coveragePayload = computeCoverage(scope, examinedArtifactView, scannerRows);
  const errors = validate("coverage", coveragePayload);
  if (errors.length > 0) throw new Error(`${COMMAND}: coverage payload is off-schema: ${errors[0]}`);

  const { schema_version, engagement_id, key_id } = run.envelope;
  const head = (kind) => ({ schema_version, kind, run_id: run.envelope.run_id, engagement_id, key_id, now: ctx.now });
  const examinedPath = join(dir, "examined.json");
  const coveragePath = join(dir, "coverage.json");
  let examinedWritten;
  let coverageWritten;
  try {
    examinedWritten = writeArtifact(examinedPath, makeEnvelope(head(EXAMINED), examinedPayload), { prered: true, exclusive: true });
    coverageWritten = writeArtifact(coveragePath, makeEnvelope(head("coverage"), coveragePayload), { exclusive: true });
  } catch (err) {
    if (err.code === "EEXIST") throw new CliError(EXIT.USAGE, COVERAGE_EXISTS, { cause: err }); // lost a race since the check above
    throw err;
  }
  if (examinedWritten.envelope.self_sha256 !== coveragePayload.examined_sha256) {
    throw new Error(`${COMMAND}: examined.json identity differs from the one the accounting cites`);
  }

  if (coveragePayload.indeterminate) {
    ctx.out(COVERAGE_INDETERMINATE);
  } else {
    const counts = countByStatus(coveragePayload.accounting);
    ctx.out(coverageLine({ examined: counts.examined, skipped: counts.skipped, scanner: counts["scanner-only"] }));
  }
  ctx.wrote(examinedPath, examinedWritten);
  ctx.wrote(coveragePath, coverageWritten);
  return EXIT.OK;
}
