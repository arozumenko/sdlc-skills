// lib/cmd-run-snapshot.mjs — `evidence.mjs run snapshot register | verify |
// proposals --run <id>` (TASK-058; plan §4.1 rows `run snapshot *`, §5
// TASK-058; spec P2, §6.3, TL-3, TL-14, G-10, G-16).
//
// The only way a cross-run or cross-tree artifact enters an assessment run
// directory: build-report and check read nothing outside `<run>/` (TL-3,
// G-16), so the live register, other runs' verify.json and the proposals
// directory reach the assessment through these three copies.
//
//   register    register-core.openRegister (the §6.8 recovery rule runs; a
//               broken chain or projection ⇒ 5 CORRUPT, nothing written) and
//               the verified log — events.jsonl AND finding-alias.jsonl (PM
//               log after TASK-029: a rewritten last alias line is otherwise
//               witnessed by no projection or anchor) — become one write-once
//               artifact `<run>/register-events.json`, kind register-snapshot,
//               payload {engagement_id, seq, chain_sha256, events, aliases}.
//               Present ⇒ 2 SNAPSHOT-EXISTS.
//                 SNAPSHOT register events=<n> chain=<sha256>  +  WROTE …
//   verify      `--from <verify_run_id>` (repeatable): the source must carry
//               `runs/<id>/COMMITTED` (else 3 INCOMPLETE(verify:<id>)); its
//               verify.json is read with self_sha256 recomputed (mismatch,
//               wrong kind, malformed ⇒ 5 INCONSISTENT(verify:<id>)); then the
//               §6.3 transitive closure — the packet it names, every receipt
//               it lists and every packet a receipt names — is copied byte-
//               for-byte (COPYFILE_EXCL, write-once) into
//               `<run>/verify-snapshots/<id>/{verify.json, packets/, receipts/}`
//               and each copy is re-read and its self_sha256 compared with the
//               hash that referenced it. Every `--from` is validated before
//               the first byte is copied, so a refusal leaves nothing behind.
//                 SNAPSHOT verify from=<id> sha256=<verify self_sha256>   (per --from)
//   proposals   lists `<st>/proposals/*.proposal.md` (files only, sorted;
//               no directory ⇒ none), id = the file stem, sha256 over the
//               REDACTED text (G-2: a proposal is operator/agent prose that
//               may match a rule; TL-10 allows plain sha256 of redacted
//               bytes), path repo-relative, and REPLACES the list in
//               `<run>/proposals-index.json` through run-index.replaceIndex
//               (TL-14: the one rewrite path, under the run lock).
//                 SNAPSHOT proposals n=<n>  +  WROTE …
//
// All three refuse a run that is COMMITTED (2 RUN-COMMITTED — after the
// marker nothing under the run is written by anyone, G-10) and a run whose
// kind is not `assessment` (2 KIND(<kind>)); an unknown run id is 2 USAGE.
// The envelope of everything written here carries the run's own identity —
// schema_version, engagement_id and key_id read from `<run>/run.json`, not
// whatever key is current now — like run-index does.
//
// Imports: node:fs (copyFileSync, existsSync, mkdirSync, readFileSync,
// readdirSync), node:path, ../canon.mjs, ../redact.mjs, ./argv.mjs,
// ./exit.mjs, ./ledger.mjs (RUN_ID), ./register-core.mjs, ./run-index.mjs,
// ./schema.mjs, ./tokens.mjs. No child process (G-6), no git, no network
// (G-14), no clock (G-1: created_at is ctx.now()). Every string that leaves
// the process goes through ctx.out / ctx.log / writeArtifact (G-4).

import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, isIntegrityFailure, usageError } from "./exit.mjs";
import { RUN_ID } from "./ledger.mjs";
import { openRegister } from "./register-core.mjs";
import { INDEXES, replaceIndex, runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, RUN_COMMITTED, SNAPSHOT_EXISTS, incomplete, inconsistent, kindRefused, snapshotProposals, snapshotRegister, snapshotVerify } from "./tokens.mjs";

const COMMAND = "run snapshot";
export const REGISTER_SNAPSHOT_FILE = "register-events.json";
export const VERIFY_SNAPSHOTS_DIR = "verify-snapshots";
export const PROPOSAL_SUFFIX = ".proposal.md";

// --- the run every subcommand targets -----------------------------------------

/**
 * Resolve `--run`, read `<run>/run.json`, refuse a COMMITTED run and a run
 * that is not an assessment. Returns the run id, its directory and the
 * artifact (its envelope is the identity every snapshot written here carries).
 */
function openAssessmentRun(ctx, command, flags) {
  const run_id = flags.run;
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw usageError(command, "--run <id> is required (<12 hex>-<4 digits>)");
  const dir = runDir(ctx, run_id);
  let run;
  try {
    run = readArtifact(join(dir, "run.json"), { kind: "run" });
  } catch (err) {
    if (err.code === "ENOENT") throw usageError(command, `unknown run ${run_id}`);
    throw err; // an integrity failure over the bundle's own artifact ⇒ 5 (exit.mjs)
  }
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  if (validate("run", run.payload).length > 0) throw integrityFailure(inconsistent(`runs/${run_id}`));
  if (run.payload.template !== "assessment") throw new CliError(EXIT.USAGE, kindRefused(run.payload.template));
  return { run_id, dir, run };
}

/** The envelope head every artifact written into this run shares: the run's own identity, `kind` per file. */
function headOf(run, run_id, kind, ctx) {
  const { schema_version, engagement_id, key_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id, now: ctx.now };
}

// --- register -----------------------------------------------------------------

async function register(argv, ctx) {
  const command = `${COMMAND} register`;
  const { flags, positionals } = parseCommandArgv(command, argv, { run: "value" });
  if (positionals.length > 0) throw usageError(command, `unexpected argument ${positionals[0]}`);
  const { run_id, dir, run } = openAssessmentRun(ctx, command, flags);
  const target = join(dir, REGISTER_SNAPSHOT_FILE);
  if (existsSync(target)) throw new CliError(EXIT.USAGE, SNAPSHOT_EXISTS);

  const reg = await openRegister(ctx); // 5 CORRUPT · 2 ENGAGEMENT-MISSING; both chains verified
  if (reg.engagement_id !== run.envelope.engagement_id) {
    throw usageError(command, `run ${run_id} belongs to engagement ${run.envelope.engagement_id}, the register to ${reg.engagement_id}`);
  }
  const payload = {
    engagement_id: reg.engagement_id,
    seq: reg.projection.seq,
    chain_sha256: reg.projection.chain_sha256,
    events: reg.events,
    aliases: reg.aliases,
  };
  const errors = validate("register-snapshot", payload);
  if (errors.length > 0) throw new Error(`${command}: snapshot payload is off-schema: ${errors[0]}`); // the register's reader validated every line

  let written;
  try {
    // Write-once (G-10). The log's lines were redacted when appended and are
    // chained over those bytes; writeArtifact's redaction pass is a no-op on
    // them, so the identity on disk is over exactly what the register holds.
    written = writeArtifact(target, makeEnvelope(headOf(run, run_id, "register-snapshot", ctx), payload), { exclusive: true });
  } catch (err) {
    if (err.code === "EEXIST") throw new CliError(EXIT.USAGE, SNAPSHOT_EXISTS);
    throw err;
  }
  ctx.out(snapshotRegister({ events: reg.events.length, chain_sha256: payload.chain_sha256 }));
  ctx.wrote(target, written);
  return EXIT.OK;
}

// --- verify -------------------------------------------------------------------

/**
 * Read one member of a COMMITTED verify run. Anything that is not the
 * artifact the reference says it is — missing, malformed, wrong kind, hash
 * mismatch, a file name that does not match its self_sha256 — is
 * INCONSISTENT(verify:<id>): a COMMITTED run closed over these files.
 */
function readMember(src, from, rel, kind, expect) {
  const fail = (cause) => integrityFailure(inconsistent(`verify:${from}`), cause);
  let artifact;
  try {
    artifact = readArtifact(join(src, rel), { kind });
  } catch (err) {
    if (err.code === "ENOENT" || isIntegrityFailure(err)) throw fail(err);
    throw err;
  }
  if (expect !== undefined && artifact.envelope.self_sha256 !== expect) throw fail(new Error(`${rel}: self_sha256 ${artifact.envelope.self_sha256} is not the referenced ${expect}`));
  if (validate(kind, artifact.payload).length > 0) throw fail(new Error(`${rel}: payload is off-schema for ${kind}`));
  return artifact;
}

/**
 * The §6.3 transitive closure of one verify run: verify.json, the packet it
 * names, every receipt it lists and every packet a receipt names. Validates
 * everything; copies nothing.
 * @returns {{from: string, src: string, verify_sha256: string, members: {rel: string, kind: string, sha256: string}[]}}
 */
function closeOverVerifyRun(ctx, from) {
  const src = runDir(ctx, from);
  if (!existsSync(join(src, COMMITTED))) throw new CliError(EXIT.INDETERMINATE, incomplete(`verify:${from}`));
  const verify = readMember(src, from, "verify.json", "verify");
  if (verify.envelope.run_id !== from) throw integrityFailure(inconsistent(`verify:${from}`), new Error(`verify.json belongs to run ${verify.envelope.run_id}`));
  const packets = new Set([verify.payload.packet_sha256]);
  const receipts = new Set();
  for (const { sha256 } of verify.payload.receipts) {
    if (receipts.has(sha256)) continue;
    receipts.add(sha256);
    const receipt = readMember(src, from, join("receipts", `${sha256}.json`), "receipt", sha256);
    packets.add(receipt.payload.packet_sha256);
  }
  for (const sha256 of packets) readMember(src, from, join("packets", `${sha256}.json`), "packet", sha256);
  const members = [
    { rel: "verify.json", kind: "verify", sha256: verify.envelope.self_sha256 },
    ...[...packets].sort().map((sha256) => ({ rel: join("packets", `${sha256}.json`), kind: "packet", sha256 })),
    ...[...receipts].sort().map((sha256) => ({ rel: join("receipts", `${sha256}.json`), kind: "receipt", sha256 })),
  ];
  return { from, src, verify_sha256: verify.envelope.self_sha256, members };
}

async function verify(argv, ctx) {
  const command = `${COMMAND} verify`;
  const { flags, positionals } = parseCommandArgv(command, argv, { run: "value", from: "list" });
  if (positionals.length > 0) throw usageError(command, `unexpected argument ${positionals[0]}`);
  const { dir } = openAssessmentRun(ctx, command, flags);
  const froms = flags.from;
  if (!Array.isArray(froms) || froms.length === 0) throw usageError(command, "--from <verify_run_id> is required (repeatable)");
  for (const from of froms) {
    if (!RUN_ID.test(from)) throw usageError(command, `--from ${from} is not a run id (<12 hex>-<4 digits>)`);
  }

  // Phase 1 — validate every source and destination; nothing is copied yet.
  const plans = [];
  for (const from of [...new Set(froms)]) {
    const dst = join(dir, VERIFY_SNAPSHOTS_DIR, from);
    if (existsSync(dst)) throw new CliError(EXIT.USAGE, SNAPSHOT_EXISTS);
    plans.push({ ...closeOverVerifyRun(ctx, from), dst });
  }

  // Phase 2 — byte-for-byte, write-once copies, each re-verified after the copy.
  for (const { from, src, dst, verify_sha256, members } of plans) {
    mkdirSync(join(dst, "packets"), { recursive: true });
    mkdirSync(join(dst, "receipts"), { recursive: true });
    for (const { rel, kind, sha256 } of members) {
      copyFileSync(join(src, rel), join(dst, rel), constants.COPYFILE_EXCL);
      const copied = readArtifact(join(dst, rel), { kind }); // integrity failure ⇒ 5
      if (copied.envelope.self_sha256 !== sha256) throw integrityFailure(inconsistent(`verify:${from}`), new Error(`${rel}: the copy hashes to ${copied.envelope.self_sha256}, expected ${sha256}`));
    }
    ctx.log(`${command}: ${from}: copied ${members.length} file(s) into ${ctx.rel(dst)}`);
    ctx.out(snapshotVerify({ from, sha256: verify_sha256 }));
  }
  return EXIT.OK;
}

// --- proposals ----------------------------------------------------------------

/** `<st>/proposals/*.proposal.md` as index entries, sorted by file name; no directory ⇒ []. */
function listProposals(ctx) {
  const pdir = join(ctx.st, "proposals");
  let entries;
  try {
    entries = readdirSync(pdir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((d) => d.isFile() && d.name.endsWith(PROPOSAL_SUFFIX) && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const path = join(pdir, name);
      // G-2: the hash is over the redacted text, never over raw bytes that may match a rule.
      const redacted = redactString(readFileSync(path, "utf8")).text;
      return { id: name.slice(0, -PROPOSAL_SUFFIX.length), sha256: sha256Hex(Buffer.from(redacted, "utf8")), path: ctx.rel(path) };
    });
}

async function proposals(argv, ctx) {
  const command = `${COMMAND} proposals`;
  const { flags, positionals } = parseCommandArgv(command, argv, { run: "value" });
  if (positionals.length > 0) throw usageError(command, `unexpected argument ${positionals[0]}`);
  const { run_id, dir } = openAssessmentRun(ctx, command, flags);
  const entries = listProposals(ctx);
  const written = await replaceIndex(ctx, run_id, "proposals", entries); // 2 RUN-COMMITTED · 3 INCOMPLETE(proposals)
  ctx.out(snapshotProposals(entries.length));
  ctx.wrote(join(dir, INDEXES.proposals.file), written);
  return EXIT.OK;
}

// --- dispatch -----------------------------------------------------------------

const SUBCOMMANDS = Object.freeze({ register, verify, proposals });

/**
 * @param {string[]} argv after `run snapshot`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const sub = argv[0];
  if (sub === undefined) throw usageError(COMMAND, `a subcommand is required (${Object.keys(SUBCOMMANDS).join("|")})`);
  if (!Object.hasOwn(SUBCOMMANDS, sub)) throw usageError(COMMAND, `unknown subcommand ${sub}`);
  return SUBCOMMANDS[sub](argv.slice(1), ctx);
}
