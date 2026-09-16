// lib/cmd-gate.mjs — `evidence.mjs gate --run <id> [--claims <payload.json>]…`
// (TASK-019; plan §4.1 row `gate`, §5 TASK-019, TL-4, TL-15; spec §6.1
// order "run init → scope → ingest/agent findings → gate", §6.5, §12).
//
// The identity-critical step: every candidate finding — a `sarif` import's
// located records, an agent's claims over the scope packet — gets its id and
// its citation state HERE, from the bytes at the cited side, never from the
// file that proposed it (G-7). All derivation is lib/gate-core.mjs (pure,
// re-run by build-report / check); this module reads the run, resolves
// bytes through lib/cite.mjs, and writes.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape), `--claims` repeatable (2 USAGE otherwise);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` ⇒ 2 RUN-COMMITTED
//      (G-10); `scope.json` absent ⇒ 3 INCOMPLETE(scope); the run's key by
//      the envelope's key_id ⇒ 2 `KEY: unavailable` (no key, no keyed
//      identity, no private record); an output already present ⇒ 2
//      GATE-EXISTS (write-once; retry = new seq);
//   3. `<run>/packets/*.json`: every file re-verified by readArtifact (a
//      tampered one ⇒ 5 INCONSISTENT(packets/<sha>)); the `kind: scope`
//      identities are what a claims file may name;
//   4. `<run>/ingest/*.json`: every import record, re-verified (5 on tamper);
//   5. `--claims` files: user-typed paths (ctx.input: inside the work tree,
//      2 USAGE otherwise; unreadable ⇒ 2 USAGE), parsed strictly — not JSON,
//      a float, not a ClaimSet object {scope_sha256, packet_sha256,
//      findings[]} ⇒ 2 SCHEMA-INVALID(claims: <file>: …), the command's own
//      exit-2 result (lib/exit.mjs input side; per-claim shape is gate-core's
//      `claim-invalid`, a counted rejection, not a refusal). The file's
//      `ref` is sha256 of its REDACTED canonical form (G-2: a claim may
//      quote protected content, so the raw bytes are never plain-hashed);
//   6. gate-core.gate — a claims file naming a packet that is not a scope
//      packet of this run, or a scope that is not this run's ⇒ 2
//      CLAIMS-PACKET-MISMATCH(<file as typed>), nothing evaluated;
//      resolution goes through lib/cite.mjs: `head`/`snapshot` bytes as the
//      scope recorded them (a snapshot that no longer matches its recorded
//      sha ⇒ 5 INCONSISTENT(snapshot:<path>), one gone from disk ⇒ 3
//      INCOMPLETE(snapshot:<path>), a blob missing at head ⇒ 5
//      INCONSISTENT(head:<path>)); `base` bytes from `git cat-file` at
//      base_oid, with a missing blob handed to the core as "not at side"
//      (a counted rejection, not a failure: deleted-at-base is a fact about
//      the diff). The oid the citation record names is the scope file's for
//      head|snapshot and the base blob's oid for base;
//   7. writes, in this order: `private/citations/<run>/<id>.json` for every
//      sensitive finding (kind `citation-record`, write-once; an identical
//      file already there is the same record, a different one ⇒ 5
//      INCONSISTENT(citations/<id>)) — the private record lands BEFORE the
//      public artifacts are named (spec §6.5 "before the claimed text is
//      discarded"; the text itself never left the core); then
//      `findings.claimed.json` (`prered: true` — gate-core already redacted
//      it, so `gate-result.claimed_sha256` is the identity on disk),
//      `gate-result.json`, `rejects.json`, `unlocated.json`, each write-once.
//
// stdout: `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>`,
// then `WROTE` ×4 in write order (the private records are not announced).
// Exit 0; 2 USAGE / RUN-COMMITTED / KEY: unavailable / GATE-EXISTS /
// SCHEMA-INVALID / CLAIMS-PACKET-MISMATCH; 3 INCOMPLETE(…); 5
// INCONSISTENT(…). No error message from a resolver is ever echoed (G-4).
//
// Imports: node:fs (existsSync, readFileSync, readdirSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs, ./argv.mjs,
// ./cite.mjs (the one resolver; git runs only inside git.mjs, G-6),
// ./exit.mjs, ./gate-core.mjs, ./git.mjs (blobOid, for the base oid),
// ./ledger.mjs (RUN_ID), ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs.
// No network (G-14), no clock (G-1: created_at is ctx.now()).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, canonical, makeEnvelope, parseStrict, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { ObjectMissing, SnapshotMismatch, SnapshotMissing, resolveSide } from "./cite.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { ClaimsPacketMismatch, gate } from "./gate-core.mjs";
import { blobOid } from "./git.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, GATE_EXISTS, KEY_UNAVAILABLE, RUN_COMMITTED, claimsPacketMismatch, gateLine, incomplete, inconsistent, schemaInvalid } from "./tokens.mjs";

const COMMAND = "gate";
const CLAIMS = "claims";
const SHA256 = /^[0-9a-f]{64}$/;
const CLAIMSET_KEYS = Object.freeze(["scope_sha256", "packet_sha256", "findings"]);
/** The four public outputs, in write order (plan §3.2). */
export const OUTPUTS = Object.freeze([
  { name: "findings.claimed.json", kind: "claimed", schema: "claimed" },
  { name: "gate-result.json", kind: "gate-result", schema: "gate-result" },
  { name: "rejects.json", kind: "rejects", schema: "rejects" },
  { name: "unlocated.json", kind: "unlocated", schema: "unlocated" },
]);

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", claims: "list" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  return { run_id, claimsPaths: flags.claims ?? [] };
}

// --- inputs -------------------------------------------------------------------------

/** The run's artifacts and key; every refusal here is a token, nothing is written. */
function loadRun(ctx, run_id) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const scopePath = join(dir, "scope.json");
  if (!existsSync(scopePath)) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  const key = ctx.keyById(run.envelope.key_id);
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);
  if (OUTPUTS.some((o) => existsSync(join(dir, o.name)))) throw new CliError(EXIT.USAGE, GATE_EXISTS);
  const scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json
  return { dir, run, key, scope };
}

/**
 * Every artifact under `<run>/<sub>/`, verified, in name order; a tampered
 * one is 5 INCONSISTENT(<sub>/<stem>). `named(art)` says what the file stem
 * must equal — the artifact identity for packets/, the import_sha256 for
 * ingest/ — so a file filed under the wrong name is inconsistent too.
 */
function readArtifacts(dir, sub, kind, named) {
  const base = join(dir, sub);
  if (!existsSync(base)) return [];
  const out = [];
  for (const name of readdirSync(base).filter((n) => n.endsWith(".json")).sort()) {
    const stem = name.slice(0, -".json".length);
    let art;
    try {
      art = readArtifact(join(base, name), { kind });
    } catch (err) {
      if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(`${sub}/${stem}`), err);
      throw err;
    }
    if (named(art) !== stem) throw integrityFailure(inconsistent(`${sub}/${stem}`));
    out.push(art);
  }
  return out;
}

/** The `kind: scope` packets of this run — what a claims file may name (TL-15). */
function scopePacketIds(dir, run_id) {
  return readArtifacts(dir, "packets", "packet", (p) => p.envelope.self_sha256)
    .filter((p) => p.payload.kind === "scope" && p.envelope.run_id === run_id)
    .map((p) => p.envelope.self_sha256);
}

/**
 * One `--claims` file: read, parsed strictly, checked to be a ClaimSet
 * object. Per-claim shape is the core's business (a counted rejection).
 * @returns {{name: string, ref: string, set: object}}
 */
function readClaims(ctx, typed) {
  const abs = ctx.input(COMMAND, typed);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(COMMAND, `cannot read ${typed}`);
    throw err;
  }
  let set;
  try {
    set = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(CLAIMS, `${typed}: ${err.message}`), { cause: err });
    throw err;
  }
  const invalid = (why) => new CliError(EXIT.USAGE, schemaInvalid(CLAIMS, `${typed}: ${why}`));
  if (set === null || typeof set !== "object" || Array.isArray(set)) throw invalid("a ClaimSet is an object {scope_sha256, packet_sha256, findings}");
  for (const k of Object.keys(set)) if (!CLAIMSET_KEYS.includes(k)) throw invalid(`unknown key ${JSON.stringify(k)}`);
  for (const k of CLAIMSET_KEYS) if (!Object.hasOwn(set, k)) throw invalid(`missing ${k}`);
  if (typeof set.scope_sha256 !== "string" || !SHA256.test(set.scope_sha256)) throw invalid("scope_sha256 must be a sha256");
  if (typeof set.packet_sha256 !== "string" || !SHA256.test(set.packet_sha256)) throw invalid("packet_sha256 must be a sha256");
  if (!Array.isArray(set.findings)) throw invalid("findings must be an array");
  // The file's identity is over its redacted canonical form (G-2), never its raw bytes.
  const ref = sha256Hex(canonical(redactDeep(set, DEFAULT_RULES)));
  return { name: typed, ref, set };
}

// --- resolution ---------------------------------------------------------------------

/** gate-core's resolver over lib/cite.mjs: {bytes, oid} at the side, null when base has no blob; head/snapshot failures become tokens. */
function makeResolver(ctx, { run, scope }) {
  const { base_oid } = run.payload;
  return ({ path, side }) => {
    let bytes;
    try {
      bytes = resolveSide(ctx, run, scope, { path, side });
    } catch (err) {
      if (err instanceof ObjectMissing && side === "base") return null;
      if (err instanceof SnapshotMismatch) throw integrityFailure(inconsistent(`snapshot:${err.path}`), err);
      if (err instanceof SnapshotMissing) throw new CliError(EXIT.INDETERMINATE, incomplete(`snapshot:${err.path}`), { cause: err });
      if (err instanceof ObjectMissing) throw integrityFailure(inconsistent(`${err.side}:${err.path}`), err);
      throw err;
    }
    if (side === "base") return { bytes, oid: blobOid(ctx.root, base_oid, path) };
    const file = scope.payload.files.find((f) => f.path === path);
    if (file === undefined) throw new Error(`${COMMAND}: resolved ${side} ${path}, which is not a scope file`);
    return { bytes, oid: file.oid };
  };
}

// --- writes -------------------------------------------------------------------------

function envelopeHead(run, key, kind, now) {
  const { schema_version, engagement_id, run_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id: key.key_id, now };
}

/** Write-once; an existing file with the same identity is the same record (idempotent), a different one is an integrity failure. */
function writeOnce(path, artifact, options, field) {
  try {
    return writeArtifact(path, artifact, { ...options, exclusive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind: artifact.envelope.kind });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(field), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== artifactId(artifact.payload)) throw integrityFailure(inconsistent(field));
    return existing;
  }
}

/** The private citation records (spec §6.5), before any public artifact is named. */
function writeCitationRecords(ctx, { run, key }, citationRecords) {
  const dir = join(ctx.st, "private", "citations", run.envelope.run_id);
  for (const { id, record } of citationRecords) {
    const errors = validate("citation-record", record);
    if (errors.length > 0) throw new Error(`${COMMAND}: citation record is off-schema: ${errors[0]}`);
    writeOnce(join(dir, `${id}.json`), makeEnvelope(envelopeHead(run, key, "citation-record", ctx.now), record), {}, `citations/${id}`);
  }
}

/**
 * @param {string[]} argv after `gate`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const inputs = loadRun(ctx, args.run_id);
  const scopePackets = scopePacketIds(inputs.dir, args.run_id);
  const imports = readArtifacts(inputs.dir, "ingest", "import", (a) => a.payload.import_sha256).map((a) => a.payload);
  const claims = args.claimsPaths.map((p) => readClaims(ctx, p));

  let result;
  try {
    result = gate({ scope: inputs.scope, scopePackets, claims, imports, resolveSide: makeResolver(ctx, inputs), key: inputs.key.bytes, rules: DEFAULT_RULES });
  } catch (err) {
    if (err instanceof ClaimsPacketMismatch) throw new CliError(EXIT.USAGE, claimsPacketMismatch(err.file), { cause: err });
    throw err;
  }
  const payloads = { claimed: result.claimed, "gate-result": result.gateResult, rejects: result.rejects, unlocated: result.unlocated };
  for (const o of OUTPUTS) {
    const errors = validate(o.schema, payloads[o.kind]);
    if (errors.length > 0) throw new Error(`${COMMAND}: ${o.name} payload is off-schema: ${errors[0]}`);
  }

  // 7. private records first, then the four public artifacts in write order.
  writeCitationRecords(ctx, inputs, result.citationRecords);
  const written = [];
  for (const o of OUTPUTS) {
    const path = join(inputs.dir, o.name);
    const artifact = makeEnvelope(envelopeHead(inputs.run, inputs.key, o.kind, ctx.now), payloads[o.kind]);
    let art;
    try {
      art = writeArtifact(path, artifact, { prered: o.kind === "claimed", exclusive: true });
    } catch (err) {
      if (err.code === "EEXIST") throw new CliError(EXIT.USAGE, GATE_EXISTS, { cause: err });
      throw err;
    }
    if (o.kind === "claimed" && art.envelope.self_sha256 !== result.gateResult.claimed_sha256) throw new Error(`${COMMAND}: findings.claimed.json identity drifted between the core and the disk`);
    written.push([path, art]);
  }

  const { gateResult, rejects, unlocated } = result;
  ctx.out(gateLine({ accepted: gateResult.accepted.length, unverifiable: gateResult.unverifiable.length, rejected: rejects.rejected.length, unlocated: unlocated.candidates.length }));
  for (const [path, art] of written) ctx.wrote(path, art);
  return EXIT.OK;
}
