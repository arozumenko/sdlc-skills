// lib/cmd-receipt.mjs — `evidence.mjs receipt validate --run <id> <file>` and
// `receipt apply --run <id> [--json]` (TASK-022; plan §4.1 rows `receipt
// validate|apply`, §5 TASK-022; spec §6.4 "Receipt", TL-4 drop-box, TL-6
// (verify all admits receipts through this), G-7; US-015 AC-2, AC-7).
//
// A receipt is the reviewer's word about ONE subject of ONE packet: `{type,
// subject_id, packet_sha256, assertion, reviewer_run_id}`, dropped payload-only
// under `<st>/receipts/<run_id>/` by the agent (TL-4). `validate` admits it
// into the run — envelopes it and writes `<run>/receipts/<self_sha256>.json`
// — or rejects it with the first reason found. `apply` derives the run's
// states through the pure core (lib/states.mjs) and prints them; it writes
// nothing. Scripts derive, agents assert (G-7): a receipt carrying an id, a
// state, a verdict or a gate stamp is rejected naming the key, before any
// other check, so the agent learns what it may not write.
//
// validate — order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape), exactly one `<file>` (2 USAGE);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED (G-10); run.json read (5 when tampered);
//   3. the file: ctx.input() (cwd-relative, realpath'd, inside root — else 2
//      USAGE), readFileSync (unreadable ⇒ 2 USAGE(receipt validate: cannot
//      read <p>)); from here every refusal is the receipt's, exit 4
//      `REJECTED(<reason>)`, in this order:
//        schema: <err>                       not strict JSON (the input-side
//                                            exit-5 rule of lib/exit.mjs: a
//                                            parse error over the command's
//                                            own input is never left for the
//                                            dispatcher), or not an object;
//        forbidden field <name>              schema.forbiddenKeys over the
//                                            whole value, nested included —
//                                            named BEFORE the schema check so
//                                            an off-shape receipt that also
//                                            carries `state` is told about
//                                            `state`;
//        schema: <err>                       receipt.schema.json (oneOf per
//                                            type: the closed assertion enums);
//        reviewer_run_id != run              the receipt names another run;
//        unknown packet                      no `<run>/packets/<sha>.json`;
//        packet_sha256 mismatch              the file exists but its
//                                            self_sha256 is not its name (a
//                                            copy under another name);
//        scope packet                        `kind: scope` — only a subject
//                                            packet is a receipt target (P1);
//        subject_id not in packet.subject_ids
//        oid mismatch <path>                 a `packet.files[]` oid is not the
//                                            blob at the run's `head_oid`
//                                            (side head), `base_oid` (side
//                                            base) or the scope's
//                                            `snapshot[path].redacted_sha256`
//                                            (side snapshot; scope.json absent
//                                            ⇒ 3 INCOMPLETE(scope)) — spec
//                                            §6.4 "packet.files[].oid equals
//                                            the run's oids"; a packet file
//                                            that is not the artifact it
//                                            claims to be is 5 (readArtifact).
//   4. envelope `{kind: receipt, run_id, engagement_id, key_id}` = the run's
//      (the payload is redacted in memory first, so the identity is over what
//      leaves memory, G-4); `<run>/receipts/<self_sha256>.json` write-once.
//      The file is named by its identity, so the same receipt admitted twice
//      (a second drop-box copy) finds its own file: an existing file that
//      verifies to that identity is the same artifact and the command
//      succeeds idempotently (nothing rewritten, G-10); one that does not ⇒
//      5 INCONSISTENT(receipts/<sha>).
//
// stdout: `RECEIPT admitted sha256=<h> type=<t> subject=<id>` then `WROTE
// <path> sha256=<h>` — the same sha. Exit 0; 2 USAGE / RUN-COMMITTED; 3
// INCOMPLETE(scope); 4 REJECTED(<reason>); 5 when run.json or a packet is not
// the artifact it claims to be. The drop-box file is never written (TL-4).
//
// apply — `--run <id> [--json]`: run.json (unknown ⇒ 2 USAGE); a COMMITTED
// run is fine (nothing is written; build-report and check re-derive the same
// way); `gate-result.json` — required for review/assessment runs (absent ⇒ 3
// INCOMPLETE(gate-result)), absent by design for verify/threat-model runs
// (`null` to the core); every `<run>/receipts/*.json` and `<run>/packets/
// *.json` (5 when one is not what it claims to be); `states.applyReceipts`.
// stdout: `STATE <subject> <state>` per finding (sorted by id), then per
// mitigation, then `not-applied: <n>`, `conflicts: <n>`; with `--json` the
// core's result on one line, exactly (the same object build-report renders).
//
// Imports: node:fs (existsSync, readFileSync, readdirSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs (redactDeep,
// for the pre-write identity), ./argv.mjs, ./exit.mjs, ./git.mjs (blobOid:
// the one place git runs, G-6), ./ledger.mjs (RUN_ID), ./run-index.mjs
// (runDir), ./schema.mjs, ./states.mjs, ./tokens.mjs. No network (G-14), no
// clock (G-1: created_at is ctx.now()). Every string that leaves the process
// goes through ctx.out / canon.writeArtifact (G-4); the only foreign message
// echoed is the parse or schema error over the user's own file, which
// redact.mjs sees on the way out.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { blobOid } from "./git.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { forbiddenKeys, validate } from "./schema.mjs";
import { applyReceipts } from "./states.mjs";
import {
  COMMITTED,
  RECEIPT_PACKET_SHA_MISMATCH,
  RECEIPT_RUN_MISMATCH,
  RECEIPT_SCOPE_PACKET,
  RECEIPT_SUBJECT_NOT_IN_PACKET,
  RECEIPT_UNKNOWN_PACKET,
  RUN_COMMITTED,
  conflictsLine,
  incomplete,
  inconsistent,
  notAppliedLine,
  receiptForbiddenReason,
  receiptLine,
  receiptOidMismatch,
  receiptSchemaReason,
  rejected,
  stateLine,
} from "./tokens.mjs";

const COMMAND = "receipt";
const VALIDATE = "receipt validate";
const APPLY = "receipt apply";
const RECEIPT = "receipt";
/** Run templates that gate: `apply` requires gate-result.json for these (§6.1 order); the others never have one. */
const GATED_TEMPLATES = Object.freeze(["assessment", "review"]);

// --- shared --------------------------------------------------------------------------

function requireRun(command, flags) {
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(command, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(command, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  return run_id;
}

/** The run's run.json; every refusal here is a token, nothing is written. */
function loadRun(ctx, command, run_id, { refuseCommitted }) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(command, `unknown run ${run_id}`);
  if (refuseCommitted && existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  return { dir, run };
}

/** Every artifact of `kind` under `<run>/<sub>/` (sorted by name; 5 when one is not what it claims to be). */
function readAll(dir, sub, kind) {
  const where = join(dir, sub);
  if (!existsSync(where)) return [];
  return readdirSync(where)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readArtifact(join(where, name), { kind }));
}

// --- validate -------------------------------------------------------------------------

const reject = (reason) => new CliError(EXIT.FAIL, rejected(reason));

/** The drop-box file as a value: containment, readability (2 USAGE), then strict JSON (4 REJECTED(schema: …)). */
function readDropBox(ctx, p) {
  const abs = ctx.input(VALIDATE, p);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(VALIDATE, `cannot read ${p}`);
    throw err;
  }
  let value;
  try {
    value = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.FAIL, rejected(receiptSchemaReason(err.message)), { cause: err });
    throw err;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw reject(receiptSchemaReason("a receipt is a JSON object"));
  return value;
}

/** Forbidden keys first (named), then the schema, then the run binding. */
function checkShape(value, run_id) {
  const forbidden = forbiddenKeys(value);
  if (forbidden.length > 0) throw reject(receiptForbiddenReason(forbidden[0]));
  const errors = validate(RECEIPT, value);
  if (errors.length > 0) throw reject(receiptSchemaReason(errors[0]));
  if (value.reviewer_run_id !== run_id) throw reject(RECEIPT_RUN_MISMATCH);
  return value;
}

/** The packet the receipt names: present, its own identity, a subject packet, listing the subject. */
function loadPacket(dir, payload) {
  const path = join(dir, "packets", `${payload.packet_sha256}.json`);
  if (!existsSync(path)) throw reject(RECEIPT_UNKNOWN_PACKET);
  const packet = readArtifact(path, { kind: "packet" }); // 5 when the run's own packet is not what it claims to be
  if (packet.envelope.self_sha256 !== payload.packet_sha256) throw reject(RECEIPT_PACKET_SHA_MISMATCH);
  if (packet.payload.kind !== "subject") throw reject(RECEIPT_SCOPE_PACKET);
  if (!packet.payload.subject_ids.includes(payload.subject_id)) throw reject(RECEIPT_SUBJECT_NOT_IN_PACKET);
  return packet;
}

/**
 * Spec §6.4: every `packet.files[].oid` equals the run's oid for that path at
 * its side — the blob at `head_oid` / `base_oid`, or the scope's snapshot
 * `redacted_sha256`. The scope is read only when a snapshot side is present.
 */
function checkOids(ctx, dir, run, packet) {
  let scope;
  const expected = ({ path, side }) => {
    if (side === "snapshot") {
      if (scope === undefined) {
        const scopePath = join(dir, "scope.json");
        if (!existsSync(scopePath)) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
        scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json
      }
      const entry = scope.payload.snapshot?.[path];
      return entry === undefined ? null : entry.redacted_sha256;
    }
    return blobOid(ctx.root, side === "base" ? run.payload.base_oid : run.payload.head_oid, path);
  };
  for (const file of packet.payload.files) {
    if (expected(file) !== file.oid) throw reject(receiptOidMismatch(file.path));
  }
}

/**
 * `<run>/receipts/<self_sha256>.json`, write-once; the name is the identity,
 * so a file already there is either this receipt (idempotent success) or a
 * tampered one (5 INCONSISTENT(receipts/<sha>)).
 */
function persist(ctx, dir, run, payload) {
  const sha256 = artifactId(payload);
  const path = join(dir, "receipts", `${sha256}.json`);
  const { schema_version, engagement_id, key_id } = run.envelope;
  const artifact = makeEnvelope({ schema_version, kind: RECEIPT, run_id: run.envelope.run_id, engagement_id, key_id, now: ctx.now }, payload);
  try {
    return { path, written: writeArtifact(path, artifact, { prered: true, exclusive: true }), existed: false };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind: RECEIPT });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(`receipts/${sha256}`), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== sha256) throw integrityFailure(inconsistent(`receipts/${sha256}`));
    return { path, written: existing, existed: true };
  }
}

async function validateCommand(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(VALIDATE, argv, { run: "value" });
  const run_id = requireRun(VALIDATE, flags);
  if (positionals.length === 0) throw usageError(VALIDATE, "a receipt file is required");
  if (positionals.length > 1) throw usageError(VALIDATE, `unexpected argument ${positionals[1]}`);
  const { dir, run } = loadRun(ctx, VALIDATE, run_id, { refuseCommitted: true });

  const value = readDropBox(ctx, positionals[0]);
  const payload = checkShape(value, run_id);
  const packet = loadPacket(dir, payload);
  checkOids(ctx, dir, run, packet);

  // Redacted before it is named (G-4): the identity and the file name are over what leaves memory.
  const redacted = redactDeep(payload, DEFAULT_RULES);
  const { path, written, existed } = persist(ctx, dir, run, redacted);
  if (existed) ctx.log(`${VALIDATE}: ${ctx.rel(path)} already present with this identity; nothing rewritten`);
  ctx.out(receiptLine({ sha256: written.envelope.self_sha256, type: redacted.type, subject: redacted.subject_id }));
  ctx.wrote(path, written);
  return EXIT.OK;
}

// --- apply ----------------------------------------------------------------------------

async function applyCommand(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(APPLY, argv, { run: "value", json: "boolean" });
  const run_id = requireRun(APPLY, flags);
  if (positionals.length > 0) throw usageError(APPLY, `unexpected argument ${positionals[0]}`);
  const { dir, run } = loadRun(ctx, APPLY, run_id, { refuseCommitted: false });

  const gatePath = join(dir, "gate-result.json");
  let gateResult = null;
  if (existsSync(gatePath)) gateResult = readArtifact(gatePath, { kind: "gate-result" }); // 5 on a tampered gate-result.json
  else if (GATED_TEMPLATES.includes(run.payload.template)) throw new CliError(EXIT.INDETERMINATE, incomplete("gate-result"));
  const receipts = readAll(dir, "receipts", RECEIPT);
  const packets = readAll(dir, "packets", "packet");

  const result = applyReceipts(gateResult, receipts, packets);
  if (flags.json === true) {
    ctx.out(JSON.stringify(result));
    return EXIT.OK;
  }
  for (const [subject, state] of Object.entries(result.states)) ctx.out(stateLine(subject, state));
  for (const [subject, state] of Object.entries(result.mitigation_states)) ctx.out(stateLine(subject, state));
  ctx.out(notAppliedLine(result.not_applied.length));
  ctx.out(conflictsLine(result.conflicts.length));
  return EXIT.OK;
}

const SUBCOMMANDS = Object.freeze({ validate: validateCommand, apply: applyCommand });

/**
 * @param {string[]} argv after `receipt`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const sub = argv[0];
  if (sub === undefined) throw usageError(COMMAND, `a subcommand is required (${Object.keys(SUBCOMMANDS).join("|")})`);
  if (!Object.hasOwn(SUBCOMMANDS, sub)) throw usageError(COMMAND, `unknown subcommand ${sub}`);
  return SUBCOMMANDS[sub](argv.slice(1), ctx);
}
