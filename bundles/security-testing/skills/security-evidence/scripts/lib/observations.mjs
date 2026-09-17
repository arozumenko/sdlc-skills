// lib/observations.mjs — observations from `ingest qa-run` (TASK-044; plan
// §5 TASK-044; spec §9.2 "Results via `ingest qa-run` become observations
// {observation_id, import_sha256, case_id, case_sha256 (from admission.json),
// result, run_id, base_url, account?, head_oid?}; unknown fields stay
// `unknown`", §6.10 `executed(observation_id)`; US-036 AC-1, AC-2). The
// post-step lib/cmd-ingest.mjs runs for the `qa-run` kind; the adapter
// (lib/ingest/qa-run.mjs) stays a pure reader of the report.
//
//   observationId(import_sha256, case_id)
//     `"O-" + sha256(import_sha256 + "\0" + case_id)[0:12]` — plain sha256 over
//     an identity and a token (G-2). One observation per (import, case).
//   caseResolver(runDir) → resolve(case_id) → {case_sha256, account} | null
//     the case_id ↔ case_sha256 join (TASK-042 PM-log row): the run's
//     `ingest case` records (`<run>/ingest/*.json`, kind `case`) map
//     `trusted.id` to `locator.import_sha256`, which is the case identity an
//     admission is filed under (`<run>/admissions/<case_sha256>.json`). A case
//     resolves when exactly ONE of its identities carries an `admitted-*`
//     record; `account` is that record's `assumptions.account`. A `proposal`
//     record is not an admission here (US-036: a threat moves to `executed`
//     only through a run of an ADMITTED case — the same reading TASK-044 gave
//     tm-lint's `planned`), and two admitted identities for one id resolve
//     nothing (ambiguous, fail-closed). Reads are lazy and memoised; a
//     tampered record or admission is 5 INCONSISTENT(<name>).
//   deriveObservations(records, {import_sha256, resolve}) → {observations, unlocated}
//     pure over the qa-run adapter's records: the `run` record (index 0) gives
//     `run_id` (the report's `RUN-…` id) and `base_url` (the report's
//     `environment` when its host is in `targets.browser`, else `unknown`);
//     each `result` record becomes an observation when its case resolves —
//     `result` = the row's status, `account` from the admission, `head_oid`
//     `unknown` (the run report names no commit; nothing is invented, D5) —
//     or an unlocated Candidate `{locator: {import_sha256, index}, reason:
//     "unadmitted-case"}` (US-036 AC-2), which the record carries in its
//     `unlocated[]` and `gate` folds into `<run>/unlocated.json` verbatim (the
//     write-once file is gate's, G-10). A case id listed twice in one report
//     is the report's structural fault: 2 SCHEMA-INVALID(qa-run: …), nothing
//     written (one observation per (import, case) by construction).
//   writeObservations(ctx, run, observations) → {written: [{path, artifact}], index}
//     each `<run>/observations/<id>.json` (kind observation, the run's own
//     envelope, redacted before it is named — G-4 — and write-once: an
//     existing file with this identity is idempotent, a different one is 5
//     INCONSISTENT(observations/<id>)); then, on assessment runs (the only
//     kind carrying the TL-14 index), `run-index.appendIndex(…,
//     "observations", {observation_id, sha256})` unless the index already
//     lists that entry (a healing re-ingest after a crash). `index` is the
//     index artifact after the last append, or null.
//
// Imports: node:fs (existsSync, readdirSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs, ./exit.mjs,
// ./run-index.mjs (appendIndex), ./schema.mjs, ./tokens.mjs. No child process
// (G-6), no git, no network (G-14), no clock (G-1: created_at is ctx.now()).
// Never prints.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { CliError, EXIT, integrityFailure } from "./exit.mjs";
import { appendIndex } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { UNADMITTED_CASE, inconsistent, schemaInvalid } from "./tokens.mjs";

const WHERE = "observations";
const SHA256 = /^[0-9a-f]{64}$/;
/** The spelling of a value the input does not carry (spec §9.2: never blank). */
export const UNKNOWN = "unknown";
const ADMITTED = /^admitted-/;

/**
 * `O-` + sha256(import_sha256 \0 case_id)[0:12].
 * @param {string} import_sha256
 * @param {string} case_id
 * @returns {string}
 */
export function observationId(import_sha256, case_id) {
  if (typeof import_sha256 !== "string" || !SHA256.test(import_sha256)) throw new TypeError(`${WHERE}.observationId: import_sha256 must be 64 hex chars`);
  if (typeof case_id !== "string" || case_id.length === 0) throw new TypeError(`${WHERE}.observationId: case_id must be a non-empty string`);
  return `O-${sha256Hex(Buffer.from(`${import_sha256}\0${case_id}`, "utf8")).slice(0, 12)}`;
}

function readVerified(path, kind, name) {
  try {
    return readArtifact(path, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(name), err);
    throw err;
  }
}

/** The run's `ingest case` records as `Map<case_id, Set<case_sha256>>`. */
function caseIdentities(dir) {
  const where = join(dir, "ingest");
  const ids = new Map();
  if (!existsSync(where)) return ids;
  for (const name of readdirSync(where).filter((n) => n.endsWith(".json")).sort()) {
    const art = readVerified(join(where, name), "import", `ingest/${name.slice(0, -".json".length)}`);
    if (art.payload.kind !== "case") continue;
    for (const rec of art.payload.records) {
      const id = rec?.trusted?.id;
      const sha = rec?.locator?.import_sha256;
      if (typeof id !== "string" || typeof sha !== "string") continue;
      if (!ids.has(id)) ids.set(id, new Set());
      ids.get(id).add(sha);
    }
  }
  return ids;
}

/**
 * The case_id ↔ admission join for one run (see the header).
 * @param {string} dir `<st>/runs/<run_id>`
 * @returns {(case_id: string) => {case_sha256: string, account: string} | null}
 */
export function caseResolver(dir) {
  if (typeof dir !== "string" || dir === "") throw new TypeError(`${WHERE}.caseResolver: dir must be the run directory`);
  let ids;
  const admissions = new Map();
  const admission = (sha) => {
    if (admissions.has(sha)) return admissions.get(sha);
    const path = join(dir, "admissions", `${sha}.json`);
    let record = null;
    if (existsSync(path)) {
      const art = readVerified(path, "admission", `admissions/${sha}`);
      if (art.payload.case_sha256 !== sha) throw integrityFailure(inconsistent(`admissions/${sha}`));
      record = art.payload;
    }
    admissions.set(sha, record);
    return record;
  };
  return (case_id) => {
    ids ??= caseIdentities(dir);
    const admitted = [...(ids.get(case_id) ?? [])].filter((sha) => ADMITTED.test(admission(sha)?.classification ?? ""));
    if (admitted.length !== 1) return null;
    const record = admission(admitted[0]);
    const account = record.assumptions?.account;
    return { case_sha256: admitted[0], account: typeof account === "string" && account !== "" ? account : UNKNOWN };
  };
}

/**
 * Observations and unadmitted candidates from a qa-run import's records (pure).
 * @param {object[]} records the adapter's `records[]` (lib/ingest/qa-run.mjs)
 * @param {{import_sha256: string, resolve: (case_id: string) => {case_sha256: string, account: string} | null}} options
 * @returns {{observations: object[], unlocated: object[]}}
 * @throws {CliError} 2 SCHEMA-INVALID(qa-run: …) when a case id is listed twice
 */
export function deriveObservations(records, { import_sha256, resolve } = {}) {
  if (!Array.isArray(records)) throw new TypeError(`${WHERE}.deriveObservations: records must be the adapter's records[]`);
  if (typeof import_sha256 !== "string" || !SHA256.test(import_sha256)) throw new TypeError(`${WHERE}.deriveObservations: import_sha256 must be 64 hex chars`);
  if (typeof resolve !== "function") throw new TypeError(`${WHERE}.deriveObservations: resolve must be a function`);
  const head = records.find((r) => r?.locator?.index === 0 && r?.trusted?.record === "run");
  if (head === undefined) throw new TypeError(`${WHERE}.deriveObservations: records[] carries no run record at index 0`);
  const run_id = head.trusted.run_id;
  const base_url = head.trusted.environment_host_allowed === true && typeof head.trusted.environment === "string" ? head.trusted.environment : UNKNOWN;
  const observations = [];
  const unlocated = [];
  const seen = new Set();
  const rows = records.filter((r) => r?.trusted?.record === "result").sort((a, b) => a.locator.index - b.locator.index);
  for (const row of rows) {
    const { case_id, status } = row.trusted;
    if (seen.has(case_id)) throw new CliError(EXIT.USAGE, schemaInvalid("qa-run", `case ${case_id} appears twice in the ## Results table`));
    seen.add(case_id);
    const found = resolve(case_id);
    if (found === null) {
      unlocated.push({ locator: { import_sha256, index: row.locator.index }, reason: UNADMITTED_CASE });
      continue;
    }
    observations.push({
      observation_id: observationId(import_sha256, case_id),
      import_sha256,
      case_id,
      case_sha256: found.case_sha256,
      result: status,
      run_id,
      base_url,
      account: found.account,
      head_oid: UNKNOWN,
    });
  }
  return { observations, unlocated };
}

/** The index entries already on disk, so a healing re-ingest never appends a duplicate. */
function listedEntries(dir) {
  const path = join(dir, "observations.json");
  if (!existsSync(path)) return null;
  const index = readVerified(path, "observations-index", "observations.json");
  return new Set(index.payload.observations.map((e) => `${e.observation_id}:${e.sha256}`));
}

/**
 * Persist the observations (see the header).
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {object[]} observations deriveObservations' payloads
 * @returns {Promise<{written: {path: string, artifact: object}[], index: object | null}>}
 */
export async function writeObservations(ctx, run, observations) {
  const written = [];
  let index = null;
  const assessment = run.payload.template === "assessment";
  const listed = assessment ? (listedEntries(run.dir) ?? new Set()) : null; // an absent index on an assessment run is appendIndex's 3 INCOMPLETE(observations)
  const { schema_version, engagement_id, key_id } = run.envelope;
  for (const raw of observations) {
    const payload = redactDeep(raw, DEFAULT_RULES);
    const errors = validate("observation", payload);
    if (errors.length > 0) throw new Error(`${WHERE}: observation payload is off-schema: ${errors[0]}`);
    const name = `observations/${payload.observation_id}`;
    const path = join(run.dir, `${name}.json`);
    const artifact = makeEnvelope({ schema_version, kind: "observation", run_id: run.envelope.run_id, engagement_id, key_id, now: ctx.now }, payload);
    let onDisk;
    try {
      onDisk = writeArtifact(path, artifact, { prered: true, exclusive: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      onDisk = readVerified(path, "observation", name);
      if (onDisk.envelope.self_sha256 !== artifactId(payload)) throw integrityFailure(inconsistent(name));
    }
    written.push({ path, artifact: onDisk });
    if (assessment) {
      const entry = { observation_id: payload.observation_id, sha256: onDisk.envelope.self_sha256 };
      if (listed.has(`${entry.observation_id}:${entry.sha256}`)) continue;
      index = await appendIndex(ctx, run.run_id, "observations", entry);
      listed.add(`${entry.observation_id}:${entry.sha256}`);
    }
  }
  return { written, index };
}
