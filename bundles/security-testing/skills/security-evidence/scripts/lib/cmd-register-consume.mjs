// lib/cmd-register-consume.mjs — `register.mjs consume-verdict <verify.json>`
// (TASK-030; plan §4.3, spec §6.4 last paragraph, US-022). Verdict → register,
// through the emitter-only events of register-transitions (`fixed`,
// `regressed`, `regression-observed`, `verify-observed`), appended with
// register-core.append — never through the `transition` verb, which refuses
// them.
//
// Steps, in order:
//   1. `ctx.input()` the path (cwd-relative, must lie under root), then
//      canon.readArtifact(kind verify): a self_sha256 or kind mismatch is
//      exit 5 (the file is not the artifact it claims to be); a payload-only,
//      unparseable, missing or unreadable file is exit 2 USAGE — the input
//      side of the check/exit-5 rule (lib/exit.mjs). A hash-consistent
//      artifact that fails verify.schema.json is 5 INCONSISTENT(verify).
//   2. Recompute `evaluate(payload minus evaluation)` and refuse the artifact
//      when it differs from the stored `evaluation`: 5 INCONSISTENT(evaluation).
//      Scripts derive; a verdict is never taken from a file as truth (G-7).
//   3. Open the register (recovery rule; CORRUPT ⇒ 5) and locate the row:
//      `subject == finding_id`, `subject_kind == finding`, status not
//      `superseded` (a superseded row is dead; its successor carries the
//      subject). None ⇒ 2 NO-ROW — the lead adds rows. More than one live
//      row for the subject ⇒ 2 USAGE naming them: supersede the duplicates.
//   4. Decide the events from the verdict and the LIVE row status:
//        `regression-observed` {verify_sha256}            when evaluation.refound_observed && row.status == fixed
//        then exactly one of
//        `fixed`     {verify_sha256, ack_refs, last_verified_run: envelope.run_id}   VERIFIED
//        `regressed` {verify_sha256}                                                 REGRESSED
//        `verify-observed` {verify_sha256, verdict}                                  every UNVERIFIED-*
//      The observation lands BEFORE the status event so the log's order is the
//      evaluator's precedence (§6.4 step 7: refound_observed is recorded first).
//      The status event's (event, from) pair is checked against the table
//      before anything is appended, so a VERIFIED on a row already `fixed`
//      or a REGRESSED on a row that is not `fixed` (the verdict was evaluated
//      against a stale row_status_at_start) is 4 TRANSITION-REJECTED with an
//      untouched log. `ref` is the verify run id.
//
// The live row status, not `row_status_at_start`, drives the observation:
// the register is the model of record and the verdict is consumed against
// what it says now. `verify_sha256` is the artifact's on-disk identity
// (envelope.self_sha256, verified on read).
//
// stdout: `CONSUMED <verdict> row=<R-id> verify=<sha256>`, then one
// `ROW <R-id> status=<s> priority=<p> seq=<n>` per appended event.
// Exit 0; 2 USAGE / NO-ROW / ENGAGEMENT-MISSING; 4 TRANSITION-REJECTED;
// 5 INCONSISTENT(verify) / INCONSISTENT(evaluation) / CORRUPT / integrity.

import { CanonError, IntegrityError, canonical, readArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { evaluate } from "./evaluate.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { append, openRegister } from "./register-core.mjs";
import { TransitionError, allowedFrom } from "./register-transitions.mjs";
import { validate } from "./schema.mjs";
import { NO_ROW, consumed, inconsistent, row as rowLine, transitionRejected } from "./tokens.mjs";

const COMMAND = "consume-verdict";

/**
 * Read the verify artifact named on the command line (step 1). Messages
 * carry the path as the user typed it, after the prose and in parentheses —
 * `<word>: <absolute path>` reads as a high-entropy assignment to redact.mjs
 * (the ctx.input rule) and would leave the process redacted.
 */
function readVerify(file, typed) {
  try {
    return readArtifact(file, { kind: "verify" });
  } catch (err) {
    // Input-side classification, the same as cmd-evaluate: an artifact that
    // claims an identity it does not have is integrity (5); a file that is
    // not an artifact at all is malformed input (2).
    if (err instanceof IntegrityError) {
      if (err.expected === undefined) throw usageError(COMMAND, `not a verify artifact: ${err.reason}`);
      throw err;
    }
    if (err instanceof CanonError) throw usageError(COMMAND, `cannot read ${typed} (not strict JSON: ${err.message})`);
    if (err && err.code === "ENOENT") throw usageError(COMMAND, `cannot read ${typed} (no such file)`);
    if (err && (err.code === "EISDIR" || err.code === "EACCES")) throw usageError(COMMAND, `cannot read ${typed} (${err.code})`);
    throw err;
  }
}

/**
 * The events to append for `verdict` on a row currently at `status`
 * (step 4). Pure; exported for the test of the decision alone.
 * @param {{verdict: string, refound_observed: boolean, ack_refs: string[]}} evaluation
 * @param {{status: string}} row the live row
 * @param {{verify_sha256: string, run_id: string}} ids
 * @returns {Array<{event: string, payload: object}>}
 */
export function eventsFor(evaluation, row, { verify_sha256, run_id }) {
  const events = [];
  if (evaluation.refound_observed === true && row.status === "fixed") events.push({ event: "regression-observed", payload: { verify_sha256 } });
  if (evaluation.verdict === "VERIFIED") {
    events.push({ event: "fixed", payload: { verify_sha256, ack_refs: [...evaluation.ack_refs], last_verified_run: run_id } });
  } else if (evaluation.verdict === "REGRESSED") {
    events.push({ event: "regressed", payload: { verify_sha256 } });
  } else {
    events.push({ event: "verify-observed", payload: { verify_sha256, verdict: evaluation.verdict } });
  }
  return events;
}

/**
 * The live row for a finding id: not superseded, subject_kind finding.
 * @param {Record<string, object>} rows
 * @param {string} finding_id
 * @returns {object[]} in row-id order
 */
export function liveRowsFor(rows, finding_id) {
  return Object.keys(rows)
    .sort()
    .map((id) => rows[id])
    .filter((r) => r.subject === finding_id && r.subject_kind === "finding" && r.status !== "superseded");
}

/**
 * @param {string[]} argv after `consume-verdict`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { positionals } = parseCommandArgv(COMMAND, argv, {});
  if (positionals.length === 0) throw usageError(COMMAND, "<verify.json> is required");
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);
  const file = ctx.input(COMMAND, positionals[0]);

  // 1. the artifact
  const { envelope, payload } = readVerify(file, positionals[0]);
  const schemaErrors = validate("verify", payload);
  if (schemaErrors.length > 0) {
    ctx.log(`${COMMAND}: ${positionals[0]}: ${schemaErrors[0]}`);
    throw integrityFailure(inconsistent("verify"));
  }

  // 2. the verdict is re-derived, never trusted
  const { evaluation: stored, ...raw } = payload;
  const fresh = evaluate(raw);
  if (!canonical(fresh).equals(canonical(stored))) {
    ctx.log(`${COMMAND}: stored evaluation ${JSON.stringify(stored.verdict)} differs from evaluate() ${JSON.stringify(fresh.verdict)}`);
    throw integrityFailure(inconsistent("evaluation"));
  }
  const verify_sha256 = envelope.self_sha256;

  // 3. the row
  const { projection } = await openRegister(ctx);
  const candidates = liveRowsFor(projection.rows, payload.finding_id);
  if (candidates.length === 0) {
    ctx.log(`${COMMAND}: no live row whose subject is finding ${payload.finding_id}; add one with register.mjs add`);
    throw new CliError(EXIT.USAGE, NO_ROW);
  }
  if (candidates.length > 1) {
    throw usageError(COMMAND, `finding has ${candidates.length} live rows (${candidates.map((r) => r.id).join(", ")}); supersede the duplicates first`);
  }
  const row = candidates[0];

  // 4. the events — checked against the table before the first append
  const events = eventsFor(fresh, row, { verify_sha256, run_id: envelope.run_id });
  const status = events.at(-1);
  if (!allowedFrom(status.event, row.status)) throw new CliError(EXIT.FAIL, transitionRejected(status.event, row.status));

  ctx.out(consumed({ verdict: fresh.verdict, row: row.id, verify: verify_sha256 }));
  for (const { event, payload: eventPayload } of events) {
    let result;
    try {
      result = await append(ctx, { row_id: row.id, event, payload: eventPayload, ref: envelope.run_id });
    } catch (err) {
      if (err instanceof TransitionError) throw new CliError(EXIT.FAIL, transitionRejected(err.event, err.from));
      throw err;
    }
    const r = result.projection.rows[row.id];
    ctx.out(rowLine({ id: r.id, status: r.status, priority: r.priority, seq: result.event.seq }));
  }
  return EXIT.OK;
}
