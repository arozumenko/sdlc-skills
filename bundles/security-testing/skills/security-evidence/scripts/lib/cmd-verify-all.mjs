// lib/cmd-verify-all.mjs — `verify.mjs all --finding <id> --base <oid> --head
// <oid> [--receipts <dir>] [--timeout-s <n>]` (TASK-027; plan §4.2 row `all`,
// §5 TASK-027, TL-6; spec §6.4 steps 1–8, D17 "public verdicts only from
// verify.mjs all"; US-018, US-015 AC-5, US-019).
//
// The one command that emits a public verdict. It allocates a `verify`-kind
// run, executes the six I/O steps of lib/verify-steps.mjs in a detached
// worktree of head, builds the fix-review packet, admits the reviewer's
// receipts, evaluates through the pure lib/evaluate.mjs, writes
// `<run>/verify.json`, builds the verify report in-process (so the run is
// COMMITTED and snapshot-able, TASK-058) and, on pass 2, consumes the verdict
// into the register. The last stdout line is exactly the VERDICT line.
//
// Two-pass (TL-6):
//   pass 1  no `--receipts`: steps 1–6, the packet, evaluate with no receipt
//           (⇒ UNVERIFIED-INDETERMINATE(fix-review) at best), `PACKET …` and
//           `NEXT: dispatch security-reviewer fix-review`; the lead dispatches
//           a fresh security-reviewer with the packet path and this run id.
//   pass 2  `--receipts <dir>` (the drop-box the reviewer wrote to, TL-4):
//           a FRESH run (new seq) re-executes everything, admits the receipts
//           into ITS run directory, evaluates, and calls consume-verdict.
//           Packet identity is deterministic — `{kind, subject_ids, files
//           [{path, side, oid, ranges, range_hmac}], policy_sha256}` over the
//           blobs at head — so the receipt written against the pass-1 packet
//           names the pass-2 packet too.
//
// Order (so a refusal leaves nothing behind):
//   1. argv: `--finding` (64 hex), `--base` / `--head` (resolved to commit
//      oids: unknown ⇒ 2 USAGE), `--receipts` (ctx.input: inside the work
//      tree and a directory, else 2 USAGE), `--timeout-s` (positive integer);
//      engagement.md (2 ENGAGEMENT-MISSING); the current key (2 KEY:
//      unavailable);
//   2. finding lookup: ledger runs newest-first, the first `gate-result.json`
//      whose `accepted[]` carries the id (an `unverifiable[]` id, or none ⇒
//      2 UNKNOWN-FINDING); its finding from findings.claimed.json; its
//      derived state from states.applyReceipts over that run's receipts and
//      packets — REVIEW_REFUTED ⇒ 4 UNVERIFIED-REFUTED-FINDING (spec §6.4
//      row 3). Nothing is allocated before this point;
//   3. `row_status_at_start` from the register's live row for the finding
//      (register-core.openRegister — the recovery rule applies, CORRUPT ⇒ 5;
//      no live row ⇒ "none");
//   4. `run init --kind verify --base <oid> --head <oid>` in-process (cmd-run:
//      the ledger entry, run.json, engagement.json — its RUN and WROTE lines
//      are printed as they come);
//   5. steps 1–5 (lib/verify-steps.mjs) with the worktree removed in a
//      finally whatever happens; step 6: the fix-review packet — the
//      finding's cited files (cmd-packet.citedFiles: primary + typed ranges)
//      at side `head`, `oid` = the blob at head_oid (a file gone at head is
//      omitted — a deleted vulnerable file is what the reviewer must see as
//      absence), ranges clamped to the file's normalised line count at head,
//      bytes = the blob at head (what the worktree is a checkout of and what
//      `git show <head>:<path>` gives the reviewer; identical across passes
//      and untouched by install), packet-core.buildPacket, written write-once
//      as `<run>/packets/<packet_sha256>.json`;
//   6. receipts (pass 2 only): every regular file in `--receipts`, sorted by
//      name. A file that is not strict JSON, not an object, or whose `type`
//      is not `fix-review` | `ack` is not a receipt of this contract and is
//      named on stderr and skipped. Every other file is RECORDED in
//      verify.json's `receipts[]` — `{sha256, type, assertion | indicator_id,
//      applied, not_applied_reason?}` where `sha256` is the identity the
//      receipt would have as an artifact (over the redacted payload) — and
//      admitted into `<run>/receipts/<sha256>.json` only when it passes
//      `receipt validate`'s checks in `receipt validate`'s order (forbidden
//      field, schema, run binding, packet, subject, oids; the reason
//      spellings are TASK-022's). A receipt that fails is recorded `applied:
//      false` with the reason, never dropped, and never filed under the run
//      (build-report closes receipts over packets; an unknown packet would
//      make the run INCOMPLETE). Run binding: `reviewer_run_id` is this run
//      OR a verify-kind run of this engagement with the same base and head —
//      the pass-1 dispatch the reviewer answered (TL-6). A second drop-box
//      copy of the same receipt is one row;
//   7. evaluate (lib/evaluate.mjs, pure) over the raw results; `verify.json`
//      = raw results + `evaluation` (verify.schema.json, TASK-005), written
//      write-once and enveloped with the run's schema_version / engagement_id
//      / key_id; `WROTE`;
//   8. cmd-build-report.buildReport(template verify): REPORT, MANIFEST,
//      COMMITTED; pass 2 only: cmd-register-consume over the artifact —
//      `CONSUMED …` + ROW lines, or `REGISTER: no row for finding` (2 NO-ROW
//      is not a failure of the verification: the lead adds rows); a
//      TRANSITION-REJECTED there is printed and the command continues (the
//      verdict is emitted; the register is the lead's to reconcile); an
//      integrity failure (CORRUPT) propagates;
//   9. `VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|
//      same-as-head> verify=<verify.json self_sha256>` — the last line.
//
// stdout, in order: `RUN …` (+ 2 WROTE), `BRANCH <t>`, `TREE-BEFORE <oid>`,
// `INSTALL …`, `SUPPRESSION …`, `TESTS …`, `PACKET …` + WROTE, pass 1
// `NEXT: …`, pass 2 `RECEIPT admitted …` + WROTE per admitted receipt, `WROTE
// …/verify.json`, `REPORT`, `MANIFEST`, `COMMITTED`, pass 2 `CONSUMED`/`ROW`
// or `REGISTER: …`, `VERDICT …`. Exit 0 whenever a verdict is emitted (every
// UNVERIFIED-* included); 2 USAGE / UNKNOWN-FINDING / ENGAGEMENT-MISSING /
// KEY: unavailable; 4 UNVERIFIED-REFUTED-FINDING; 5 when one of the bundle's
// own artifacts is not what it claims to be.
//
// Imports: node:fs (reads, readdirSync — every write is canon.writeArtifact
// or another command's), node:path, ../canon.mjs, ../redact.mjs, ./argv.mjs,
// ./cite-core.mjs (lineMap), ./cmd-build-report.mjs (buildReport),
// ./cmd-packet.mjs (citedFiles — the TASK-021 seam), ./cmd-register-consume
// .mjs (run, liveRowsFor), ./cmd-run.mjs (run — the allocator), ./evaluate
// .mjs, ./exit.mjs, ./git.mjs (blobOid, revParse, showBytes: git runs only
// inside git.mjs, G-6), ./ledger.mjs, ./packet-core.mjs, ./register-core.mjs,
// ./run-index.mjs, ./schema.mjs, ./states.mjs, ./tokens.mjs, ./verify-steps
// .mjs (the one spawn outside git.mjs). No child process here, no clock
// (G-1: created_at is ctx.now()), no network (G-14); every line leaves
// through ctx.out / ctx.log / ctx.wrote (G-4).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { lineMap } from "./cite-core.mjs";
import { buildReport } from "./cmd-build-report.mjs";
import { citedFiles } from "./cmd-packet.mjs";
import { liveRowsFor, run as consumeVerdict } from "./cmd-register-consume.mjs";
import { run as runCommand } from "./cmd-run.mjs";
import { evaluate } from "./evaluate.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { GitError, blobOid, revParse, showBytes } from "./git.mjs";
import { RUN_ID, readIndex } from "./ledger.mjs";
import { POLICY_PATH, buildPacket } from "./packet-core.mjs";
import { openRegister } from "./register-core.mjs";
import { runDir } from "./run-index.mjs";
import { forbiddenKeys, validate } from "./schema.mjs";
import { applyReceipts } from "./states.mjs";
import {
  CITATION_VERIFIED,
  COMMITTED,
  KEY_UNAVAILABLE,
  NEXT_FIX_REVIEW,
  NO_ROW,
  NO_TEST_SURFACE,
  RECEIPT_PACKET_SHA_MISMATCH,
  RECEIPT_RUN_MISMATCH,
  RECEIPT_SCOPE_PACKET,
  RECEIPT_SUBJECT_NOT_IN_PACKET,
  RECEIPT_UNKNOWN_PACKET,
  REGISTER_NO_ROW,
  REVIEW_REFUTED,
  TESTS_REASON_NO_SURFACE,
  UNKNOWN_FINDING,
  UNVERIFIED_REFUTED_FINDING,
  branchLine,
  inconsistent,
  installLine,
  manifestLine,
  packetLine,
  receiptForbiddenReason,
  receiptLine,
  receiptOidMismatch,
  receiptSchemaReason,
  reportLine,
  suppressionLine,
  testsLine,
  treeBeforeLine,
  verdictLine,
} from "./tokens.mjs";
import { DEFAULT_TIMEOUT_S, SAME_AS_HEAD, branchStep, installStep, removeWorktree, suppressionStep, testsStep, worktreeStep } from "./verify-steps.mjs";

const COMMAND = "verify all";
const TEMPLATE = "verify";
/** The receipt types a verify run admits (verify.schema.json `receipts[].type`). */
const ADMITTED_TYPES = Object.freeze(["fix-review", "ack"]);
const FINDING_ID = /^[0-9a-f]{64}$/;
const HEX64 = FINDING_ID;
const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) /;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// --- argv ---------------------------------------------------------------------------

function resolveRef(ctx, flag, ref) {
  try {
    return revParse(ctx.root, ref);
  } catch (err) {
    if (err instanceof GitError) throw usageError(COMMAND, `${flag} ${ref} is not a commit`);
    throw err;
  }
}

function parseArgs(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { finding: "value", base: "value", head: "value", receipts: "value", "timeout-s": "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const finding_id = flags.finding;
  if (finding_id === undefined) throw usageError(COMMAND, "--finding <id> is required");
  if (!FINDING_ID.test(finding_id)) throw usageError(COMMAND, "--finding must be a finding id (64 lowercase hex chars)");
  if (flags.base === undefined) throw usageError(COMMAND, "--base <oid> is required");
  if (flags.head === undefined) throw usageError(COMMAND, "--head <oid> is required");
  const base_oid = resolveRef(ctx, "--base", flags.base);
  const head_oid = resolveRef(ctx, "--head", flags.head);
  let timeout_s;
  if (flags["timeout-s"] !== undefined) {
    if (!/^[1-9][0-9]*$/.test(flags["timeout-s"])) throw usageError(COMMAND, "--timeout-s must be a positive integer");
    timeout_s = Number(flags["timeout-s"]);
  }
  let receiptsDir;
  if (flags.receipts !== undefined) {
    receiptsDir = ctx.input(COMMAND, flags.receipts);
    let st;
    try {
      st = statSync(receiptsDir);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") throw usageError(COMMAND, `--receipts ${flags.receipts} is not a directory`);
      throw err;
    }
    if (!st.isDirectory()) throw usageError(COMMAND, `--receipts ${flags.receipts} is not a directory`);
  }
  return { finding_id, base_oid, head_oid, timeout_s, receiptsDir };
}

// --- the finding --------------------------------------------------------------------

/** Every artifact of `kind` under `<run>/<sub>/` (sorted; 5 when one is not what it claims to be). */
function readAll(dir, sub, kind) {
  const where = join(dir, sub);
  if (!existsSync(where)) return [];
  return readdirSync(where)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readArtifact(join(where, name), { kind }));
}

/**
 * Ledger runs newest-first: the first gate that accepted the id, the finding
 * itself and its derived state (plan §4.2 "Finding lookup").
 * @returns {{run_id: string, finding: object, state: string} | null}
 */
export function findFinding(ctx, finding_id) {
  const entries = readIndex(ctx).slice().reverse();
  for (const entry of entries) {
    const dir = runDir(ctx, entry.run_id);
    const gatePath = join(dir, "gate-result.json");
    if (!existsSync(gatePath)) continue;
    const gateResult = readArtifact(gatePath, { kind: "gate-result" }); // 5 on tamper
    if (!gateResult.payload.accepted.includes(finding_id)) {
      if (gateResult.payload.unverifiable.includes(finding_id)) ctx.log(`${COMMAND}: finding ${finding_id} is CITATION_FAILED in run ${entry.run_id}; nothing to verify`);
      continue;
    }
    const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
    if (gateResult.payload.claimed_sha256 !== claimed.envelope.self_sha256) throw integrityFailure(inconsistent("gate-result"));
    const finding = claimed.payload.findings.find((f) => f.id === finding_id);
    if (finding === undefined) throw integrityFailure(inconsistent("gate-result"));
    const derived = applyReceipts(gateResult, readAll(dir, "receipts", "receipt"), readAll(dir, "packets", "packet"));
    return { run_id: entry.run_id, finding, state: derived.states[finding_id] ?? CITATION_VERIFIED };
  }
  return null;
}

// --- the fix-review packet ----------------------------------------------------------

function loadPolicy() {
  const policy = parseStrict(readFileSync(POLICY_PATH));
  const errors = validate("packet-policy.v1", policy);
  if (errors.length > 0) throw new Error(`${COMMAND}: the shipped packet-policy.v1 file is off-schema: ${errors[0]}`);
  return policy;
}

/**
 * The files of the fix-review packet: the finding's cited files at head —
 * blob oids and bytes at head_oid, ranges clamped to the file there; a path
 * gone at head is omitted (logged).
 * @returns {{files: object[], bytes: Map<string, Buffer>}}
 */
export function fixReviewFiles(ctx, { finding, head_oid, log }) {
  const byPath = new Map();
  for (const f of citedFiles([finding])) {
    if (!byPath.has(f.path)) byPath.set(f.path, []);
    byPath.get(f.path).push(...f.ranges);
  }
  const files = [];
  const bytes = new Map();
  for (const [path, ranges] of byPath) {
    const oid = blobOid(ctx.root, head_oid, path);
    if (oid === null) {
      log(`${COMMAND}: ${path} is absent at head; the fix-review packet omits it`);
      continue;
    }
    const buf = showBytes(ctx.root, head_oid, path);
    const count = lineMap(buf).lines.length;
    const clamped = [];
    for (const [start, end] of ranges) {
      if (start > count) continue;
      clamped.push([start, Math.min(end, count)]);
    }
    if (clamped.length < ranges.length) log(`${COMMAND}: ${path} is shorter at head than the cited ranges; ranges clamped`);
    bytes.set(path, buf);
    files.push({ path, side: "head", oid, ranges: clamped });
  }
  return { files, bytes };
}

/** Write-once; an existing file with the same identity is the same artifact (idempotent), a different one is 5 INCONSISTENT(<label>). */
function writeOnceArtifact(path, artifact, label, kind) {
  try {
    return writeArtifact(path, artifact, { prered: true, exclusive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(label), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== artifactId(artifact.payload)) throw integrityFailure(inconsistent(label));
    return existing;
  }
}

// --- receipts (pass 2) --------------------------------------------------------------

/** Is `reviewer_run_id` this run, or a verify run of this engagement over the same base and head (the pass-1 dispatch)? */
function acceptsReviewerRun(ctx, run, reviewer_run_id) {
  if (reviewer_run_id === run.envelope.run_id) return true;
  if (typeof reviewer_run_id !== "string" || !RUN_ID.test(reviewer_run_id)) return false;
  const path = join(runDir(ctx, reviewer_run_id), "run.json");
  if (!existsSync(path)) return false;
  let other;
  try {
    other = readArtifact(path, { kind: "run" });
  } catch {
    return false;
  }
  return other.payload.template === TEMPLATE && other.envelope.engagement_id === run.envelope.engagement_id && other.payload.base_oid === run.payload.base_oid && other.payload.head_oid === run.payload.head_oid;
}

/** `receipt validate`'s checks in its order; null when admissible, else the REJECTED reason. */
function receiptRefusal(ctx, { dir, run, value }) {
  const forbidden = forbiddenKeys(value);
  if (forbidden.length > 0) return receiptForbiddenReason(forbidden[0]);
  const errors = validate("receipt", value);
  if (errors.length > 0) return receiptSchemaReason(errors[0]);
  if (!acceptsReviewerRun(ctx, run, value.reviewer_run_id)) return RECEIPT_RUN_MISMATCH;
  const packetPath = join(dir, "packets", `${value.packet_sha256}.json`);
  if (!existsSync(packetPath)) return RECEIPT_UNKNOWN_PACKET;
  const packet = readArtifact(packetPath, { kind: "packet" }); // 5 when the run's own packet is not what it claims to be
  if (packet.envelope.self_sha256 !== value.packet_sha256) return RECEIPT_PACKET_SHA_MISMATCH;
  if (packet.payload.kind !== "subject") return RECEIPT_SCOPE_PACKET;
  if (!packet.payload.subject_ids.includes(value.subject_id)) return RECEIPT_SUBJECT_NOT_IN_PACKET;
  for (const file of packet.payload.files) {
    const expected = file.side === "snapshot" ? null : blobOid(ctx.root, file.side === "base" ? run.payload.base_oid : run.payload.head_oid, file.path);
    if (expected !== file.oid) return receiptOidMismatch(file.path);
  }
  return null;
}

/**
 * Admit the drop-box receipts into the run (step 6 of the header) and return
 * the verify.json `receipts[]` rows.
 */
function admitReceipts(ctx, { dir, run, receiptsDir }) {
  const names = readdirSync(receiptsDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  const rows = [];
  const seen = new Set();
  for (const name of names) {
    const file = join(receiptsDir, name);
    let value;
    try {
      value = parseStrict(readFileSync(file));
    } catch (err) {
      if (err instanceof CanonError) {
        ctx.log(`${COMMAND}: ${ctx.rel(file)} is not strict JSON; not a receipt, ignored`);
        continue;
      }
      throw err;
    }
    if (!isObject(value) || !ADMITTED_TYPES.includes(value.type)) {
      ctx.log(`${COMMAND}: ${ctx.rel(file)} is not a fix-review or ack receipt; ignored`);
      continue;
    }
    // Redacted before it is named (G-4): the identity is over what would leave memory.
    const redacted = redactDeep(value, DEFAULT_RULES);
    const sha256 = artifactId(redacted);
    if (seen.has(sha256)) {
      ctx.log(`${COMMAND}: ${ctx.rel(file)} is a second copy of receipt ${sha256}; one row`);
      continue;
    }
    seen.add(sha256);
    const row = { sha256, type: value.type };
    if (typeof value.assertion === "string") row.assertion = value.assertion;
    if (value.type === "ack" && isObject(value.assertion) && typeof value.assertion.indicator_id === "string" && HEX64.test(value.assertion.indicator_id)) row.indicator_id = value.assertion.indicator_id;
    const reason = receiptRefusal(ctx, { dir, run, value });
    if (reason === null) {
      const { schema_version, engagement_id, key_id } = run.envelope;
      const artifact = makeEnvelope({ schema_version, kind: "receipt", run_id: run.envelope.run_id, engagement_id, key_id, now: ctx.now }, redacted);
      const path = join(dir, "receipts", `${sha256}.json`);
      const written = writeOnceArtifact(path, artifact, `receipts/${sha256}`, "receipt");
      row.applied = true;
      ctx.out(receiptLine({ sha256: written.envelope.self_sha256, type: redacted.type, subject: redacted.subject_id }));
      ctx.wrote(path, written);
    } else {
      row.applied = false;
      row.not_applied_reason = reason;
      ctx.log(`${COMMAND}: ${ctx.rel(file)} not applied (${reason})`);
    }
    rows.push(row);
  }
  return rows;
}

// --- the run ------------------------------------------------------------------------

/** `run init --kind verify` in-process; the RUN line is captured for the id and printed like every other line. */
async function allocate(ctx, { base_oid, head_oid }) {
  const captured = [];
  const sub = {
    ...ctx,
    out: (line) => {
      captured.push(line);
      ctx.out(line);
    },
  };
  const code = await runCommand(["init", "--kind", TEMPLATE, "--base", base_oid, "--head", head_oid], sub);
  if (code !== EXIT.OK) throw new Error(`${COMMAND}: run init returned ${code}`);
  const m = captured.map((l) => RUN_LINE.exec(l)).find((x) => x !== null);
  if (!m) throw new Error(`${COMMAND}: run init printed no RUN line`);
  return m[1];
}

async function rowStatus(ctx, finding_id) {
  const { projection } = await openRegister(ctx);
  const rows = liveRowsFor(projection.rows, finding_id);
  return rows.length === 0 ? "none" : rows[0].status;
}

/**
 * @param {string[]} argv after `all`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv, ctx);
  const record = ctx.engagement(); // 2 ENGAGEMENT-MISSING / ENGAGEMENT-INVALID
  const key = ctx.key();
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);

  // 2. the finding, before anything is allocated
  const found = findFinding(ctx, args.finding_id);
  if (found === null) throw new CliError(EXIT.USAGE, UNKNOWN_FINDING);
  if (found.state === REVIEW_REFUTED) throw new CliError(EXIT.FAIL, UNVERIFIED_REFUTED_FINDING);
  const { finding } = found;

  // 3. the register row as it stands now
  const row_status_at_start = await rowStatus(ctx, args.finding_id);

  // 4. the run
  const run_id = await allocate(ctx, args);
  const dir = runDir(ctx, run_id);
  const runArtifact = readArtifact(join(dir, "run.json"), { kind: "run" });
  const tests_record = record.execute_project_tests;
  const timeout_s = args.timeout_s ?? (Number.isInteger(tests_record?.timeout_s) && tests_record.timeout_s > 0 ? tests_record.timeout_s : DEFAULT_TIMEOUT_S);
  const env = process.env;

  // 5. steps 1–6
  const branch = branchStep(ctx.root, { base_oid: args.base_oid, head_oid: args.head_oid, path: finding.path });
  ctx.out(branchLine(branch));
  let install;
  let tested_tree = SAME_AS_HEAD;
  let tests;
  let tree_before;
  let suppression;
  const wt = worktreeStep(ctx.root, args.head_oid);
  try {
    tree_before = wt.tree_before;
    ctx.out(treeBeforeLine(tree_before));
    const installed = await installStep({ wt: wt.dir, root: ctx.root, head_oid: args.head_oid, key: key.bytes, install: tests_record?.install, timeout_s, env, log: ctx.log });
    install = installed.install;
    tested_tree = installed.tested_tree;
    ctx.out(installLine({ ran: install.ran, tracked_changes: install.tracked_changes.length, untracked: install.untracked_count, bytes: install.untracked_bytes }));
    suppression = suppressionStep(ctx.root, { base_oid: args.base_oid, head_oid: args.head_oid, path: finding.path, ranges: [finding.lines], key: key.bytes });
    ctx.out(suppressionLine({ indicators: suppression.indicators.length, deletion_only: suppression.deletion_only }));
    if (installed.tests !== undefined) tests = installed.tests;
    else if (tests_record === undefined) tests = { result: NO_TEST_SURFACE, reason: TESTS_REASON_NO_SURFACE, timed_out: false, output_redacted: "" };
    else tests = await testsStep({ wt: wt.dir, argv: tests_record.argv, timeout_s, key: key.bytes, env, log: ctx.log });
    ctx.out(testsLine({ result: tests.result, reason: tests.reason, exe: tests.executable_path, sha256: tests.executable_sha256 }));
  } finally {
    removeWorktree(ctx.root, wt, ctx.log);
  }

  // 6. the fix-review packet (blob bytes at head: what the worktree was checked out from)
  const { files, bytes } = fixReviewFiles(ctx, { finding, head_oid: args.head_oid, log: ctx.log });
  const rawPacket = buildPacket({ kind: "subject", subject_ids: [args.finding_id], files, key: key.bytes, policy: loadPolicy(), resolveSide: ({ path }) => bytes.get(path) });
  const packetPayload = redactDeep(rawPacket, DEFAULT_RULES);
  const packetErrors = validate("packet", packetPayload);
  if (packetErrors.length > 0) throw new Error(`${COMMAND}: packet payload is off-schema: ${packetErrors[0]}`);
  const packet_sha256 = artifactId(packetPayload);
  const head = { schema_version: runArtifact.envelope.schema_version, run_id, engagement_id: runArtifact.envelope.engagement_id, key_id: runArtifact.envelope.key_id, now: ctx.now };
  const packetPath = join(dir, "packets", `${packet_sha256}.json`);
  const packet = writeOnceArtifact(packetPath, makeEnvelope({ ...head, kind: "packet" }, packetPayload), `packets/${packet_sha256}`, "packet");
  ctx.out(packetLine({ relPath: ctx.rel(packetPath), sha256: packet.envelope.self_sha256, kind: "subject", files: packetPayload.files.length }));
  ctx.wrote(packetPath, packet);
  if (args.receiptsDir === undefined) ctx.out(NEXT_FIX_REVIEW);

  // 6b. receipts (pass 2)
  const receipts = args.receiptsDir === undefined ? [] : admitReceipts(ctx, { dir, run: runArtifact, receiptsDir: args.receiptsDir });

  // 7. evaluate + verify.json
  const raw = {
    finding_id: args.finding_id,
    base_oid: args.base_oid,
    head_oid: args.head_oid,
    branch,
    tree_before,
    install,
    tested_tree,
    suppression,
    tests,
    packet_sha256: packet.envelope.self_sha256,
    receipts,
    row_status_at_start,
  };
  const evaluation = evaluate(raw);
  const payload = { ...raw, evaluation };
  const errors = validate(TEMPLATE, payload);
  if (errors.length > 0) throw new Error(`${COMMAND}: verify.json payload is off-schema: ${errors[0]}`);
  const verifyPath = join(dir, "verify.json");
  const verifyArtifact = writeOnceArtifact(verifyPath, makeEnvelope({ ...head, kind: TEMPLATE }, redactDeep(payload, DEFAULT_RULES)), "verify.json", TEMPLATE);
  ctx.wrote(verifyPath, verifyArtifact);

  // 8. the report (COMMITTED) and, on pass 2, the register
  const report = await buildReport(ctx, { run_id, template: TEMPLATE });
  ctx.out(reportLine(ctx.rel(report.report_path)));
  ctx.out(manifestLine(report.manifest.envelope.self_sha256));
  ctx.out(COMMITTED);
  if (args.receiptsDir !== undefined) {
    try {
      await consumeVerdict([verifyPath], ctx);
    } catch (err) {
      if (!(err instanceof CliError) || err.code === EXIT.INTEGRITY) throw err;
      if (err.token === NO_ROW) ctx.out(REGISTER_NO_ROW);
      else ctx.out(err.token);
      ctx.log(`${COMMAND}: consume-verdict did not append (${err.token}); the verdict stands`);
    }
  }

  // 9. the verdict
  const stored = readArtifact(verifyPath, { kind: TEMPLATE });
  ctx.out(verdictLine({ verdict: stored.payload.evaluation.verdict, finding: args.finding_id, base: args.base_oid, head: args.head_oid, tested_tree: stored.payload.tested_tree, verify: stored.envelope.self_sha256 }));
  return EXIT.OK;
}
