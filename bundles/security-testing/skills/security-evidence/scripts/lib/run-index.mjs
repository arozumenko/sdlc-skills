// lib/run-index.mjs — the TL-14 index files (TASK-012; spec P2, plan TL-14,
// G-10, §3.3 row `lib/run-index.mjs`).
//
// Three files under `<run>/` are indexes that grow after `run init`:
//
//   imports.json           kind imports-index       {imports: [{kind, import_sha256, original_hmac}]}
//   observations.json      kind observations-index  {observations: [{observation_id, sha256}]}
//   proposals-index.json   kind proposals-index     {proposals: [{id, sha256, path}]}
//
// `run init --kind assessment` writes them empty (writeEmptyIndexes, write-
// once) so the assessment template's required inputs all exist inside the
// run directory from the start (P2). They are the ONLY files rewritten under
// a run (G-10): every rewrite goes through appendIndex — read the artifact
// (self_sha256 verified), push the entry, validate the new payload against
// its schema, re-envelope (created_at from ctx.now(); run_id, engagement_id
// and key_id carried from the envelope on disk — the run's, not whatever key
// is current now), and writeArtifact (tmp + rename, atomic) — under the run
// lock (ledger.withRunLock), so two processes appending to the same index
// never lose an entry. `run snapshot proposals` (TASK-058) rewrites
// proposals-index.json the same way. Their identity never enters a preimage;
// the manifest hashes the members they list.
//
// A run whose `COMMITTED` marker exists is closed: appendIndex refuses with
// exit 2 RUN-COMMITTED before reading anything. A run without the index file
// (a review run, say — only assessment runs carry them) is exit 3
// INCOMPLETE(<name>).
//
// Imports: node:fs (existsSync only — writes go through canon.writeArtifact),
// node:path, ../canon.mjs, ./ledger.mjs (withRunLock, RUN_ID), ./schema.mjs,
// ./exit.mjs, ./tokens.mjs. No child process (G-6), no git, no network (G-14),
// no clock (G-1: created_at is ctx.now()).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { CliError, EXIT } from "./exit.mjs";
import { RUN_ID, withRunLock } from "./ledger.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, RUN_COMMITTED, incomplete } from "./tokens.mjs";

/** `name → {file, kind, key}` for the three TL-14 index files, in plan §3.2 order. */
export const INDEXES = Object.freeze({
  imports: Object.freeze({ file: "imports.json", kind: "imports-index", key: "imports" }),
  observations: Object.freeze({ file: "observations.json", kind: "observations-index", key: "observations" }),
  proposals: Object.freeze({ file: "proposals-index.json", kind: "proposals-index", key: "proposals" }),
});

function indexSpec(name) {
  const spec = INDEXES[name];
  if (spec === undefined) throw new TypeError(`run-index: unknown index name ${String(name)} (imports|observations|proposals)`);
  return spec;
}

function requireRunId(run_id) {
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw new TypeError(`run-index: run_id must be <12 hex>-<4 digits>, got ${String(run_id)}`);
  return run_id;
}

/** `<st>/runs/<run_id>` */
export function runDir(ctx, run_id) {
  return join(ctx.st, "runs", requireRunId(run_id));
}

/**
 * Write the three index artifacts with empty lists, write-once (`exclusive`:
 * an existing file is an atomic EEXIST — a run is initialised exactly once).
 * `head` is the envelope head every artifact of the run shares
 * (`{schema_version, run_id, engagement_id, key_id, now}` — `kind` is set
 * here per file).
 * @param {object} ctx
 * @param {{schema_version: number, run_id: string, engagement_id: string, key_id: string, now: () => string}} head
 * @returns {{imports: object, observations: object, proposals: object}} the written artifacts, for `ctx.wrote`
 */
export function writeEmptyIndexes(ctx, head) {
  const dir = runDir(ctx, head.run_id);
  const written = {};
  for (const [name, { file, kind, key }] of Object.entries(INDEXES)) {
    written[name] = writeArtifact(join(dir, file), makeEnvelope({ ...head, kind }, { [key]: [] }), { exclusive: true });
  }
  return written;
}

/**
 * Append `entry` to the run's `<name>` index: the one rewrite path for a file
 * under `<run>/` (G-10), atomic across processes (run lock + tmp/rename).
 * @param {object} ctx
 * @param {string} run_id
 * @param {"imports" | "observations" | "proposals"} name
 * @param {object} entry one element of the index's list, per its schema
 * @returns {Promise<{envelope: object, payload: object}>} the artifact now on disk
 * @throws {CliError} 2 RUN-COMMITTED · 3 INCOMPLETE(<name>)
 * @throws {TypeError} unknown name, bad run_id, off-schema entry (nothing written)
 * @throws {IntegrityError | CanonError} when the index on disk is not the artifact it claims to be (exit-5 class)
 */
export async function appendIndex(ctx, run_id, name, entry) {
  const { file, kind, key } = indexSpec(name);
  const dir = runDir(ctx, run_id);
  const path = join(dir, file);
  return withRunLock(ctx, run_id, () => {
    if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
    if (!existsSync(path)) throw new CliError(EXIT.INDETERMINATE, incomplete(name));
    const current = readArtifact(path, { kind });
    const payload = { [key]: [...current.payload[key], entry] };
    const errors = validate(kind, payload);
    if (errors.length > 0) throw new TypeError(`appendIndex: entry is off-schema for ${kind}: ${errors[0]}`);
    const { schema_version, run_id: rid, engagement_id, key_id } = current.envelope;
    const head = { schema_version, kind, run_id: rid, engagement_id, key_id, now: ctx.now };
    return writeArtifact(path, makeEnvelope(head, payload));
  });
}
