// lib/cmd-plan-admit.mjs — `plan.mjs admit --run <id> <case.md> [--receipt
// <sha256>] [--dry-run]` (TASK-042, `--dry-run` TASK-043; plan §4.5, §5 TASK-042; spec §9.1 "Admission", D7
// "passive admission by effect with an admission record", P5
// "`admitted-reviewed` needs assertion `confirmed`"; US-034 AC-1…AC-4). The
// heuristic itself is lib/admission-core.mjs (pure); this file is its I/O.
//
// The admission record decides whether a candidate case may enter the
// hand-off suite (`publish --profile case`, TASK-043) or stays a proposal.
// The claim it makes is "admitted by lint or by review" — never "safe": the
// lint is a heuristic over step text, the review is a reviewer's word.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run <id>` (RUN_ID shape), exactly one `<case.md>`, optional
//      `--receipt <64 hex>`, optional `--dry-run` (2 USAGE);
//   2. the run: `<run>/run.json` (unknown ⇒ 2 USAGE); `COMMITTED` present ⇒
//      2 RUN-COMMITTED (G-10); `<run>/engagement.json` (the record the run
//      was started with — the authority policy the hosts are checked
//      against) absent ⇒ 3 INCOMPLETE(engagement);
//   3. the case file: a user-typed path — ctx.input keeps it inside the work
//      tree (2 USAGE(admit: cannot read <p> (outside the work tree))),
//      unreadable ⇒ 2 USAGE(admit: cannot read <p>); it must lie under
//      `<st>/cases/` (PM ruling: candidates live at
//      `<st>/cases/<slug>/TC-NNN_<slug>.md`, never under `tasks/` — the
//      admitted suite is written only by `publish`) ⇒ 2 USAGE otherwise. The
//      bytes are read once, redacted once (admission-core.caseSha256, G-3
//      order: nothing of the raw text is kept past this point), and the
//      identity is `case_sha256` = sha256 over the redacted text — the same
//      number `ingest case` records as import_sha256 and `packet --type case`
//      names as the subject id;
//   4. the structure: the manual-qa TC format via ingest/case.mjs
//      (parseTestCase) plus a non-empty `## Steps` table with an Action
//      column ⇒ 2 SCHEMA-INVALID(case: <reason>) otherwise. An id that is
//      not `TC-NNN` (three digits) or a file name that is not
//      `TC-NNN_<slug>.md` is accepted with a stderr note: manual-qa's
//      run-metrics readers match `TC-\d+` only (TASK-018 follow-up), so the
//      planning skill mandates the canonical shape;
//   5. the lint: admission-core.lintSteps over the Action cells with
//      `targets.browser` from the run's engagement record;
//   6. `--receipt`: `<run>/receipts/<sha>.json` must be an admitted receipt
//      of this run (absent ⇒ 2 USAGE(admit: unknown receipt <sha> (not
//      admitted in run <id>; run receipt validate first))); it must be a
//      `vulnerability-review` (4 RECEIPT-MISMATCH(receipt type <t> is not
//      vulnerability-review)) whose subject is this case's identity (4
//      RECEIPT-MISMATCH(receipt subject <sha> is not this case) — a receipt
//      on another case's packet, or on a finding, fails here) and whose
//      packet is a subject packet of this run listing that subject (the
//      packet file gone or not a packet ⇒ 5 INCONSISTENT(packets/<sha>); a
//      packet not listing the case ⇒ 4 RECEIPT-MISMATCH(receipt packet <sha>
//      does not list this case)). The review STATE then comes from
//      states.applyReceipts over every admitted receipt and packet of the
//      run (gate-result when the run has one) — one algorithm for every
//      consumer, so two same-run vulnerability-reviews that disagree read as
//      REVIEW_INDETERMINATE here too;
//   7. the classification (admission-core.classify): `admitted-heuristic`
//      with zero hits, `admitted-reviewed` with REVIEW_CONFIRMED and no
//      forbidden hit, else `proposal` (a `review-not-confirmed` hit records
//      a refuted / indeterminate review; a forbidden hit is never reviewed
//      away). `receipt_sha256` is present exactly when the classification is
//      `admitted-reviewed` (admission.schema.json oneOf);
//   8. `<run>/admissions/<case_sha256>.json` (kind admission, write-once).
//      The name is the case identity, so an existing file that verifies and
//      carries the same payload is this admission (idempotent success,
//      nothing rewritten); one carrying a different payload ⇒ 2
//      ADMISSION-EXISTS (the route changed — retry = new seq, G-10); one that
//      is not the artifact it claims to be ⇒ 5 INCONSISTENT(admissions/<sha>).
//      With `--dry-run` (TASK-043, the G22 follow-up) steps 1–7 run as
//      above and step 8 does not: the ADMISSION line is printed, nothing is
//      persisted, no WROTE line — so the lead can read the hits and choose
//      the route (heuristic, review, proposal) before the write-once record
//      pins it (a changed route would otherwise cost a new run).
//
// stdout: `ADMISSION case=<case_sha256> classification=<c> hits=<n>` then
// `WROTE <path> sha256=<h>` (the WROTE line only without `--dry-run`).
// Every classification exits 0: the record is the result. 2 USAGE / RUN-COMMITTED / SCHEMA-INVALID(case: …) /
// ADMISSION-EXISTS; 3 INCOMPLETE(engagement); 4 RECEIPT-MISMATCH(<reason>);
// 5 INCONSISTENT(…) or when run.json / engagement.json / a receipt / a
// packet is not the artifact it claims to be (readArtifact). Nothing of the
// case text reaches stdout; the hits' `text_redacted` lives in the record.
//
// Imports: node:fs (existsSync, readFileSync, readdirSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../redact.mjs (redactDeep
// on the payload before it is named, G-4), ./admission-core.mjs,
// ./argv.mjs, ./exit.mjs, ./ledger.mjs (RUN_ID), ./run-index.mjs (runDir),
// ./schema.mjs, ./states.mjs (applyReceipts), ./tokens.mjs. No git, no child
// process (G-6), no network (G-14), no clock (G-1: created_at is ctx.now()).
// Exports `admit = {run(argv, ctx)}`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { caseSha256, classify, hostOf, lintSteps, parseSteps, targetPolicySha256 } from "./admission-core.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { applyReceipts } from "./states.mjs";
import { ADMISSION_EXISTS, COMMITTED, RUN_COMMITTED, admissionLine, incomplete, inconsistent, receiptMismatch } from "./tokens.mjs";

const COMMAND = "admit";
const SHA256 = /^[0-9a-f]{64}$/;
/** The canonical shapes the planning skill mandates (manual-qa readers match `TC-\d+`). */
const CANONICAL_ID = /^TC-[0-9]{3}$/;
const CANONICAL_FILE = /^TC-[0-9]{3}_[a-z0-9-]+\.md$/;
const CASES_SEGMENT = "cases";

// --- argv + inputs ------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", receipt: "value", "dry-run": "boolean" });
  if (typeof flags.run !== "string") throw usageError(COMMAND, "--run <id> is required");
  if (!RUN_ID.test(flags.run)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${flags.run}`);
  if (positionals.length === 0) throw usageError(COMMAND, "<case.md> is required");
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);
  if (flags.receipt !== undefined && !SHA256.test(flags.receipt)) throw usageError(COMMAND, "--receipt must be a sha256");
  return { run_id: flags.run, path: positionals[0], receipt: flags.receipt, dryRun: flags["dry-run"] === true };
}

/** The run's artifacts; every refusal here is a token, nothing is written. */
function loadRun(ctx, run_id) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const engagementPath = join(dir, "engagement.json");
  if (!existsSync(engagementPath)) throw new CliError(EXIT.INDETERMINATE, incomplete("engagement"));
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  const engagement = readArtifact(engagementPath, { kind: "engagement" }); // 5 on a tampered snapshot
  return { dir, run, engagement };
}

/** The case bytes from a path under `<st>/cases/`, read once; the raw bytes never leave this function. */
function readCase(ctx, path) {
  const abs = ctx.input(COMMAND, path);
  const casesDir = join(ctx.st, CASES_SEGMENT) + sep;
  // Prose first, path last (G-4: a value that starts with a path reads as high-entropy to redact.mjs).
  if (!abs.startsWith(casesDir)) throw usageError(COMMAND, `candidate cases live under ${ctx.rel(join(ctx.st, CASES_SEGMENT))}/<slug>/ as TC-NNN_<slug>.md, never under tasks/; got ${path}`);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(COMMAND, `cannot read ${path}`);
    throw err;
  }
  return { abs, ...caseSha256(bytes) };
}

/** Every `<run>/<sub>/*.json` as verified artifacts (a tampered one is 5 INCONSISTENT(<sub>/<name>)). */
function readAll(dir, sub, kind) {
  const where = join(dir, sub);
  if (!existsSync(where)) return [];
  return readdirSync(where)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readVerified(join(where, name), kind, `${sub}/${name.slice(0, -".json".length)}`));
}

function readVerified(path, kind, name) {
  try {
    return readArtifact(path, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(name), err);
    throw err;
  }
}

// --- the review state -------------------------------------------------------------

/**
 * `--receipt`: the named admitted receipt must be a vulnerability-review on
 * a case packet of this run over this case; the state is then derived by
 * states.applyReceipts over the whole run (one algorithm, spec §6.4).
 * @returns {string} REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE
 */
function reviewState({ dir, run_id }, case_sha256, receipt_sha256) {
  const receiptPath = join(dir, "receipts", `${receipt_sha256}.json`);
  if (!existsSync(receiptPath)) throw usageError(COMMAND, `unknown receipt ${receipt_sha256} (not admitted in run ${run_id}; run receipt validate first)`);
  const receipt = readVerified(receiptPath, "receipt", `receipts/${receipt_sha256}`);
  const { type, subject_id, packet_sha256 } = receipt.payload;
  if (type !== "vulnerability-review") throw new CliError(EXIT.FAIL, receiptMismatch(`receipt type ${type} is not vulnerability-review`));
  if (subject_id !== case_sha256) throw new CliError(EXIT.FAIL, receiptMismatch(`receipt subject ${subject_id} is not this case`));
  const packetPath = join(dir, "packets", `${packet_sha256}.json`);
  if (!existsSync(packetPath)) throw integrityFailure(inconsistent(`packets/${packet_sha256}`));
  const packet = readVerified(packetPath, "packet", `packets/${packet_sha256}`);
  if (packet.payload.kind !== "subject" || !packet.payload.subject_ids.includes(case_sha256)) throw new CliError(EXIT.FAIL, receiptMismatch(`receipt packet ${packet_sha256} does not list this case`));

  const gatePath = join(dir, "gate-result.json");
  const gateResult = existsSync(gatePath) ? readVerified(gatePath, "gate-result", "gate-result") : null;
  const { states } = applyReceipts(gateResult, readAll(dir, "receipts", "receipt"), readAll(dir, "packets", "packet"));
  const state = states[case_sha256];
  if (state === undefined) throw integrityFailure(inconsistent(`receipts/${receipt_sha256}`)); // the packet lists the subject, so a state must derive
  return state;
}

// --- persist ----------------------------------------------------------------------

/**
 * `<run>/admissions/<case_sha256>.json`, write-once: an existing file with
 * this payload is this admission (idempotent), a different payload under
 * the name is ADMISSION-EXISTS, a non-artifact is INCONSISTENT.
 */
function persist(ctx, { dir, run }, payload) {
  const path = join(dir, "admissions", `${payload.case_sha256}.json`);
  const { schema_version, engagement_id, key_id } = run.envelope;
  const artifact = makeEnvelope({ schema_version, kind: "admission", run_id: run.envelope.run_id, engagement_id, key_id, now: ctx.now }, payload);
  try {
    return { path, written: writeArtifact(path, artifact, { prered: true, exclusive: true }), existed: false };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = readVerified(path, "admission", `admissions/${payload.case_sha256}`);
    if (existing.envelope.self_sha256 !== artifactId(payload)) throw new CliError(EXIT.USAGE, ADMISSION_EXISTS);
    return { path, written: existing, existed: true };
  }
}

// --- the command --------------------------------------------------------------------

export const admit = {
  /**
   * @param {string[]} argv after `admit`
   * @param {object} ctx
   * @returns {Promise<number>}
   */
  async run(argv, ctx) {
    const args = parseArgs(argv);
    const inputs = loadRun(ctx, args.run_id);
    const { abs, case_sha256, redacted } = readCase(ctx, args.path);
    const parsed = parseSteps(redacted); // 2 SCHEMA-INVALID(case: …)
    if (!CANONICAL_ID.test(parsed.case.id)) ctx.log(`${COMMAND}: case id ${parsed.case.id} is not TC-NNN; manual-qa's run-metrics readers match TC-<3 digits> only`);
    if (!CANONICAL_FILE.test(basename(abs))) ctx.log(`${COMMAND}: file name ${basename(abs)} is not TC-NNN_<slug>.md (the manual-qa suite layout)`);

    const record = inputs.engagement.payload;
    const hits = lintSteps(parsed.steps, { browser: record.targets.browser });
    const review = args.receipt === undefined ? null : reviewState({ dir: inputs.dir, run_id: args.run_id }, case_sha256, args.receipt);
    const { classification, lint_hits } = classify(hits, review);

    const raw = {
      case_sha256,
      classification,
      lint_hits,
      assumptions: { base_url_host: hostOf(record.base_url) ?? "unknown", account: parsed.account },
      target_policy_sha256: targetPolicySha256(record),
    };
    if (classification === "admitted-reviewed") raw.receipt_sha256 = args.receipt;
    // Redacted before it is named (G-4): the identity and the file name are over what leaves memory.
    const payload = redactDeep(raw, DEFAULT_RULES);
    const errors = validate("admission", payload);
    if (errors.length > 0) throw new Error(`${COMMAND}: admission payload is off-schema: ${errors[0]}`);

    if (args.dryRun) {
      ctx.out(admissionLine({ case_sha256, classification, hits: lint_hits.length }));
      ctx.log(`${COMMAND}: --dry-run — nothing persisted (hits: ${lint_hits.map((h) => `${h.rule}@${h.step}`).join(", ") || "none"})`);
      return EXIT.OK;
    }
    const { path, written, existed } = persist(ctx, inputs, payload);
    if (existed) ctx.log(`${COMMAND}: ${ctx.rel(path)} already present with this record; nothing rewritten`);
    ctx.out(admissionLine({ case_sha256, classification, hits: lint_hits.length }));
    ctx.wrote(path, written);
    return EXIT.OK;
  },
};
