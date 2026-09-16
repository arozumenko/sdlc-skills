// lib/cmd-packet.mjs — `evidence.mjs packet --run <id> --kind scope` (TASK-057;
// plan §4.1 row `packet`, §5 TASK-057; spec §6.4 P1, §6.1 `packet.json`,
// TL-15; US-015 AC-1, US-028 AC-3) and the argv shape of `--kind subject
// --subject <id>… [--type <t>]` (TASK-021 fills the body).
//
// The SCOPE packet is the `review` contract's input: built from scope.json
// before `gate`, before any finding id exists, it lists every scope file with
// its whole admitted range and binds the bytes at the recorded side with the
// engagement key. Its `packet_sha256` is what `claims-*.json` and
// `examined-*.json` must name (TL-15); `gate --claims` / `coverage
// --examined` re-verify that against `<run>/packets/`.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape), `--kind scope|subject`; scope refuses
//      `--subject` / `--type` (2 USAGE); subject requires `--subject` and
//      validates `--type` (2 USAGE);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED (G-10); `scope.json` absent ⇒ 3 INCOMPLETE(scope) (the
//      packet is derived from it); the run's key by the envelope's `key_id`
//      ⇒ 2 `KEY: unavailable` when its file is gone (no HMAC, no identity);
//   3. the policy: `references/packet-policy.v1.json` (packet-core
//      POLICY_PATH) or `--policy <file>` (a user-typed path: ctx.input keeps
//      it inside the work tree, 2 USAGE otherwise; off-schema ⇒ 2
//      SCHEMA-INVALID(packet-policy.v1: …));
//   4. `--kind subject` ⇒ 2 NOT-IMPLEMENTED(TASK-021) — TASK-021 replaces
//      this line with the subject resolution and reuses everything else;
//   5. files = every `scope.files[]` entry with `ranges = scope.ranges[path]`
//      (`[]` for an empty file); `packet-core.buildPacket` with
//      `lib/cite.mjs resolveSide` bound to the run and scope — `head`
//      bytes from `git cat-file` at head_oid, `snapshot` bytes from the
//      private redacted snapshot after its sha256 is re-verified;
//   6. `<run>/packets/<packet_sha256>.json`, write-once. The file is named
//      by its identity, so a re-run on the same scope produces the same
//      name: an existing file that verifies to that identity is the same
//      artifact and the command succeeds idempotently (nothing rewritten,
//      G-10); an existing file that does not ⇒ 5 INCONSISTENT(packets/<sha>).
//
// Resolution failures (lib/cite.mjs): a snapshot whose bytes no longer match
// `scope.snapshot[path].redacted_sha256` ⇒ 5 INCONSISTENT(snapshot:<path>);
// a snapshot the scope recorded but that is gone from disk ⇒ 3
// INCOMPLETE(snapshot:<path>); a blob missing at the recorded oid ⇒ 5
// INCONSISTENT(<side>:<path>). The error's message is never echoed (G-4).
//
// stdout: `PACKET <path> sha256=<h> kind=<k> files=<n>` then `WROTE <path>
// sha256=<h>` — the same sha, the packet's identity. Exit 0; 2 USAGE /
// RUN-COMMITTED / KEY: unavailable / SCHEMA-INVALID / NOT-IMPLEMENTED; 3
// INCOMPLETE(…); 5 INCONSISTENT(…) or when run.json / scope.json is not the
// artifact it claims to be (readArtifact).
//
// Imports: node:fs (existsSync, readFileSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs (redactDeep:
// the payload is redacted in-process before it is named, so the identity is
// over what leaves memory, G-4), ./argv.mjs, ./cite.mjs (the one resolver,
// G-6: git runs only inside git.mjs), ./exit.mjs, ./ledger.mjs (RUN_ID),
// ./packet-core.mjs, ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs.
// No network (G-14), no clock (G-1: created_at is ctx.now()).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { ObjectMissing, SnapshotMismatch, SnapshotMissing, resolveSide } from "./cite.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { RUN_ID } from "./ledger.mjs";
import { PACKET_KINDS, POLICY_PATH, buildPacket } from "./packet-core.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, KEY_UNAVAILABLE, NOT_IMPLEMENTED_SUBJECT_PACKET, RUN_COMMITTED, incomplete, inconsistent, packetLine, schemaInvalid } from "./tokens.mjs";

const COMMAND = "packet";
const POLICY_SCHEMA = "packet-policy.v1";
/** `--type` vocabulary for `--kind subject` (plan §4.1; TASK-021 assigns the defaults per subject). */
export const SUBJECT_TYPES = Object.freeze(["vulnerability-review", "mitigation-review", "fix-review", "case"]);

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", kind: "value", subject: "list", type: "value", policy: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  const kind = flags.kind;
  if (kind === undefined) throw usageError(COMMAND, `--kind ${PACKET_KINDS.join("|")} is required`);
  if (!PACKET_KINDS.includes(kind)) throw usageError(COMMAND, `--kind must be one of ${PACKET_KINDS.join("|")}, got ${kind}`);
  if (kind === "scope") {
    if (flags.subject !== undefined) throw usageError(COMMAND, "--subject is not accepted with --kind scope (a scope packet has no subjects)");
    if (flags.type !== undefined) throw usageError(COMMAND, "--type is not accepted with --kind scope");
  } else {
    if (flags.subject === undefined) throw usageError(COMMAND, "--subject <id> is required with --kind subject");
    if (flags.type !== undefined && !SUBJECT_TYPES.includes(flags.type)) throw usageError(COMMAND, `--type must be one of ${SUBJECT_TYPES.join("|")}, got ${flags.type}`);
  }
  return { run_id, kind, subjects: flags.subject ?? [], type: flags.type, policyPath: flags.policy };
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
  const scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json
  return { dir, run, key, scope };
}

/**
 * The packet policy: the shipped file, or `--policy <file>` from inside the
 * work tree. A user file that is not strict JSON or is off-schema is
 * `SCHEMA-INVALID(packet-policy.v1: …)` (exit 2); the shipped file failing
 * the same checks is an install defect (an Error, exit 1).
 */
function loadPolicy(ctx, policyPath) {
  const user = policyPath !== undefined;
  const abs = user ? ctx.input(COMMAND, policyPath) : POLICY_PATH;
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (user && (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR")) throw usageError(COMMAND, `cannot read ${policyPath}`);
    throw err;
  }
  let policy;
  try {
    policy = parseStrict(bytes);
  } catch (err) {
    if (user && err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(POLICY_SCHEMA, err.message), { cause: err });
    throw err;
  }
  const errors = validate(POLICY_SCHEMA, policy);
  if (errors.length > 0) {
    if (user) throw new CliError(EXIT.USAGE, schemaInvalid(POLICY_SCHEMA, errors[0]));
    throw new Error(`${COMMAND}: the shipped ${POLICY_SCHEMA} file is off-schema: ${errors[0]}`);
  }
  return policy;
}

// --- build + write ------------------------------------------------------------------

/** `scope.files[]` as packet-core file entries: whole admitted ranges at the recorded side. */
function scopeFiles(scope) {
  const { files, ranges } = scope.payload;
  return files.map((f) => ({ path: f.path, side: f.side, oid: f.oid, ranges: Object.hasOwn(ranges, f.path) ? ranges[f.path] : [] }));
}

/** buildPacket with lib/cite.mjs resolution; the three cite errors become tokens, their messages never printed (G-4). */
function build(ctx, { run, scope, key, policy }, { kind, subject_ids, files }) {
  try {
    return buildPacket({ kind, subject_ids, files, key: key.bytes, policy, resolveSide: ({ path, side }) => resolveSide(ctx, run, scope, { path, side }) });
  } catch (err) {
    if (err instanceof SnapshotMismatch) throw integrityFailure(inconsistent(`snapshot:${err.path}`), err);
    if (err instanceof SnapshotMissing) throw new CliError(EXIT.INDETERMINATE, incomplete(`snapshot:${err.path}`), { cause: err });
    if (err instanceof ObjectMissing) throw integrityFailure(inconsistent(`${err.side}:${err.path}`), err);
    throw err;
  }
}

/**
 * Write `<run>/packets/<packet_sha256>.json` write-once. The name is the
 * identity, so a file already there is either this packet (idempotent
 * success) or a tampered one (5 INCONSISTENT(packets/<sha>)).
 * @returns {{path: string, written: {envelope: object, payload: object}, existed: boolean}}
 */
function persist(ctx, dir, run, key, payload) {
  const packet_sha256 = artifactId(payload);
  const path = join(dir, "packets", `${packet_sha256}.json`);
  const { schema_version, engagement_id } = run.envelope;
  const artifact = makeEnvelope({ schema_version, kind: "packet", run_id: run.envelope.run_id, engagement_id, key_id: key.key_id, now: ctx.now }, payload);
  try {
    return { path, written: writeArtifact(path, artifact, { prered: true, exclusive: true }), existed: false };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind: "packet" });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(`packets/${packet_sha256}`), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== packet_sha256) throw integrityFailure(inconsistent(`packets/${packet_sha256}`));
    return { path, written: existing, existed: true };
  }
}

/**
 * @param {string[]} argv after `packet`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const inputs = loadRun(ctx, args.run_id);
  const policy = loadPolicy(ctx, args.policyPath);

  if (args.kind === "subject") {
    // TASK-021: resolve `args.subjects` (gate-result.accepted + findings.claimed.json,
    // threat-model mitigations, cases) to file entries, then fall through to build.
    ctx.out(NOT_IMPLEMENTED_SUBJECT_PACKET);
    return EXIT.USAGE;
  }

  const raw = build(ctx, { ...inputs, policy }, { kind: "scope", subject_ids: [], files: scopeFiles(inputs.scope) });
  // Redacted before it is named (G-4): the identity and the file name are over what leaves memory.
  const payload = redactDeep(raw, DEFAULT_RULES);
  const errors = validate("packet", payload);
  if (errors.length > 0) throw new Error(`${COMMAND}: packet payload is off-schema: ${errors[0]}`);

  const { path, written, existed } = persist(ctx, inputs.dir, inputs.run, inputs.key, payload);
  if (existed) ctx.log(`${COMMAND}: ${ctx.rel(path)} already present with this identity; nothing rewritten`);
  ctx.out(packetLine({ relPath: ctx.rel(path), sha256: written.envelope.self_sha256, kind: payload.kind, files: payload.files.length }));
  ctx.wrote(path, written);
  return EXIT.OK;
}
