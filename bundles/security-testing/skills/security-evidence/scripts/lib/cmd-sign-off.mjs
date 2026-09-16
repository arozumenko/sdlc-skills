// lib/cmd-sign-off.mjs — `evidence.mjs sign-off --engagement <id> [--expect
// <anchor>]` (TASK-033; plan §4.1 row `sign-off`, §5 TASK-033; spec §7
// closed table, §2 last row, §6.8, §6.9 step 2, §6.10, §12; US-025 AC-1…AC-5,
// US-006 AC-2…AC-4, US-014 AC-3). Reads only; writes nothing of its own (the
// register's recovery rule may rebuild `projection.json`, as it does on every
// register command — §6.8). Every line leaves through ctx.out (G-4).
//
// This is the one command that walks the ledger (G-16). The inventory is
// `ledger/index.json` alone (US-025 AC-1): a run directory the ledger does
// not list is never looked at; a listed run without a COMMITTED marker is
// incomplete and only listed (spec §6.1). A COMMITTED run whose run.json
// names another engagement is not this engagement's and is skipped (noted on
// stderr) — `purge` attributes the same way.
//
// Verdict, then listings. stdout, in this order (plan §4.1):
//
//   SIGN-OFF: OK                                    or one `SIGN-OFF: FAIL(<cause>)[ run=<id>]` per cause
//   RUNS: <n>                                       each COMMITTED run: `  <id> seq=<n> kind=<k> <check line 1>[ <drift>]`
//   INCOMPLETE: <n>                                 each unbuilt run
//   CHANGES-SINCE-BASELINE: <n> | not observed      per-path `  changed|added|removed <path>` (baseline.diffBaseline)
//   EXCLUDED-COVERAGE: ignored=<n> | not observed   `  <configured path> ignored=<n>` per path
//   UNAUTHENTICATED-APPROVALS: <n> | not observed   `  <R-id> status=<s> <kinds>` per row (register-fold.summarize's rule)
//   UNADMITTED: not evaluated                       M3 (TASK-043)
//   DISPOSITIONS: not evaluated | <n> undisposed-or-planned policy=<p>   `  <T-id> <kind>` per listed threat
//
// Exit 0 with SIGN-OFF: OK; 4 whenever a FAIL line was printed (the
// listings still follow — a failed sign-off is still a report); 2 for bad
// argv, an `--engagement` that is not engagement.md's, or a malformed
// `--expect`; 5 only when `ledger/index.json` itself is not the file this
// bundle wrote (the inventory cannot be trusted, so nothing is).
//
// The fail conditions — spec §7's closed table, evaluated in this order and
// ALL reported (FAIL_CAUSES spells each cause the way the checklist names it):
//
//   NO-ASSESSMENT                 no COMMITTED assessment run in the ledger; the
//                                 other checks still run over what there is
//   INCONSISTENT(<field>) run=    cmd-check.checkRun (--integrity) on a COMMITTED
//   STRUCTURE-ONLY run=           run: status inconsistent or structure-only.
//                                 CONSISTENT-REDACTED-ONLY is accepted for a
//                                 `review` run and listed as such (spec §7, N1);
//                                 for any other kind it is a fail — check already
//                                 refuses it for assessments (INCONSISTENT(snapshot))
//   SCOPE-DRIFTED(<n> files) run= the latest COMMITTED assessment (by seq) checked
//                                 with --drift is not CURRENT at scope level
//                                 (`drift.scope_drifted > 0`; PM log after G14). Drift
//                                 is computed for that run alone; its RUNS entry
//                                 carries check's own drift line (which names
//                                 citation drift first when there is any)
//   COVERAGE-INDETERMINATE(<run>) the latest assessment's coverage.json has
//                                 `indeterminate: true` (D3 / P5; TASK-020's key)
//   CORRUPT                       register-core.openRegister's recovery rule refused
//                                 the register; anchor and approvals are then skipped
//   TRUNCATED | DIVERGED          `--expect` given and register-fold.anchorVerify is
//                                 not MATCH
//   DISPOSITIONS(<threat ids>)    `sign_off.require_dispositions: all` and the latest
//                                 assessment's `<run>/threat-model.json` has a threat
//                                 whose disposition is `undisposed` or `planned`
//   TRACKED(<path>)               ignore-block.probeManagedPaths (spec §6.9 step 2,
//                                 fail-closed as `engagement init`): git tracks a file
//                                 under an active managed path — the first such path
//
// Representation choices (spec §7 / plan §5 left them open):
//
//   --engagement   must be engagement.md's `engagement_id`: the policy, the
//                  baseline and the register all belong to the record on disk,
//                  so signing off another id against them would be incoherent
//                  ⇒ 2 USAGE. Runs attributed to another engagement are skipped.
//   dispositions   `require_dispositions` absent ⇒ `executed-or-ticketed`
//                  (spec §6.10 default, the template's wording, render.mjs's
//                  reading) — NOT `none` as plan §5 TASK-033 has it; spec wins
//                  (§20). `none` ⇒ not evaluated. `executed-or-ticketed` lists
//                  undisposed/planned threats, informational. `all` fails on
//                  them. M1 reads `disposition.kind` from the model only; the
//                  relationship validation (`tm-lint check`) is TASK-041's.
//   not-ignored    a managed pattern whose probe file git does not ignore is
//                  noted on stderr only: spec §7 fails on TRACKED files, and the
//                  listings are a closed set too.
//   baseline       absent, or keyed under a key that no longer loads ⇒ the
//                  two listings print `not observed` (reason on stderr); the
//                  spec makes the observation informational, so its absence is
//                  not a fail cause. (A missing run key fails the run's check
//                  as STRUCTURE-ONLY anyway.)
//   check throws   checkRun's own USAGE (run.json gone after the marker was
//                  seen) or INCOMPLETE(COMMITTED) (marker gone) and any other
//                  non-CliError (PM log after G15: an EISDIR under a tampered
//                  run) are reported as that run's `INCONSISTENT(runs/<id>)`,
//                  never as an internal error: a run that cannot be checked
//                  cannot be signed off.
//
// `signOff(ctx, {engagement_id, expect}) → result` is the programmatic entry
// (the E2E and TASK-035's checklist test read it); `run()` prints it.
//
// Imports: node:fs (existsSync — reads only), node:path, ../canon.mjs
// (readArtifact), ./argv.mjs, ./baseline.mjs (readBaseline, diffBaseline,
// observedPaths), ./cmd-check.mjs (checkRun), ./exit.mjs, ./ignore-block.mjs
// (probeManagedPaths), ./ledger.mjs (readIndex), ./register-core.mjs
// (openRegister), ./register-fold.mjs (anchorVerify, parseAnchor, summarize),
// ./run-index.mjs (runDir), ./tokens.mjs. No child process of its own (G-6:
// git only through the modules above), no network (G-14), no clock (G-1).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { diffBaseline, observedPaths, readBaseline } from "./baseline.mjs";
import { checkRun } from "./cmd-check.mjs";
import { CliError, EXIT, isIntegrityFailure, usageError } from "./exit.mjs";
import { probeManagedPaths } from "./ignore-block.mjs";
import { readIndex } from "./ledger.mjs";
import { openRegister } from "./register-core.mjs";
import { anchorVerify, parseAnchor, summarize } from "./register-fold.mjs";
import { runDir } from "./run-index.mjs";
import {
  ANCHOR_MATCH,
  APPROVALS_NOT_OBSERVED,
  CHANGES_NOT_OBSERVED,
  COMMITTED,
  CORRUPT,
  DISPOSITIONS_NOT_EVALUATED,
  EXCLUDED_COVERAGE_NOT_OBSERVED,
  KEY_UNAVAILABLE,
  NO_ASSESSMENT,
  SIGN_OFF_OK,
  STRUCTURE_ONLY,
  UNADMITTED_NOT_EVALUATED,
  approvalEntry,
  approvalsHeader,
  changeEntry,
  changesHeader,
  coverageIndeterminate,
  dispositionEntry,
  dispositionsBlocking,
  dispositionsHeader,
  excludedCoverageEntry,
  excludedCoverageHeader,
  incompleteEntry,
  incompleteHeader,
  inconsistent,
  runsEntry,
  runsHeader,
  scopeDrifted,
  signOffFail,
  tracked,
} from "./tokens.mjs";

const COMMAND = "sign-off";

/**
 * Every `<cause>` a `SIGN-OFF: FAIL(<cause>)` line can carry, spelled with
 * the spec's placeholders, in evaluation order (TASK-035's checklist test
 * reads this list).
 */
export const FAIL_CAUSES = Object.freeze([
  NO_ASSESSMENT,
  "INCONSISTENT(<field>)",
  STRUCTURE_ONLY,
  "SCOPE-DRIFTED(<n> files)",
  "COVERAGE-INDETERMINATE(<run>)",
  CORRUPT,
  "TRUNCATED",
  "DIVERGED",
  "DISPOSITIONS(<threat ids>)",
  "TRACKED(<path>)",
]);

/** The seven listing headers, in the order they are printed (plan §4.1). */
export const LISTING_HEADERS = Object.freeze(["RUNS:", "INCOMPLETE:", "CHANGES-SINCE-BASELINE:", "EXCLUDED-COVERAGE:", "UNAUTHENTICATED-APPROVALS:", "UNADMITTED:", "DISPOSITIONS:"]);

const DEFAULT_DISPOSITION_POLICY = "executed-or-ticketed"; // spec §6.10
const LISTED_DISPOSITIONS = Object.freeze(["undisposed", "planned"]);

// --- inventory ------------------------------------------------------------------------------

/**
 * The ledger split into this engagement's COMMITTED runs (seq order) and
 * the incomplete ones. Attribution is `runs/<id>/run.json`'s engagement_id;
 * a COMMITTED run whose run.json cannot be read stays in the committed list
 * (checkRun names what is wrong with it) — only a readable record naming
 * another engagement takes a run out.
 */
function inventory(ctx, engagement_id) {
  const committed = [];
  const incomplete = [];
  for (const entry of readIndex(ctx)) {
    const dir = runDir(ctx, entry.run_id);
    if (!existsSync(join(dir, COMMITTED))) {
      incomplete.push({ run_id: entry.run_id, seq: entry.seq, kind: entry.kind });
      continue;
    }
    let other = null;
    try {
      const run = readArtifact(join(dir, "run.json"), { kind: "run" });
      if (run.payload.engagement_id !== engagement_id) other = run.payload.engagement_id;
    } catch (err) {
      if (!isIntegrityFailure(err) && err.code !== "ENOENT") throw err;
      // unreadable or missing: left to checkRun, which reports it as inconsistent
    }
    if (other !== null) {
      ctx.log(`${COMMAND}: runs/${entry.run_id} belongs to engagement ${other} — skipped`);
      continue;
    }
    committed.push({ run_id: entry.run_id, seq: entry.seq, kind: entry.kind, dir });
  }
  return { committed, incomplete };
}

/** checkRun, with anything it throws folded into an inconsistent result for that run (header: "check throws"). */
function checkOrInconsistent(ctx, run, opts) {
  try {
    return checkRun(ctx, run.dir, opts);
  } catch (err) {
    ctx.log(`${COMMAND}: check of runs/${run.run_id} could not complete: ${err instanceof CliError ? err.token : err.name}`);
    const token = inconsistent(`runs/${run.run_id}`);
    return {
      run_id: run.run_id,
      template: null,
      dir: run.dir,
      code: EXIT.INTEGRITY,
      consistency: { token, status: "inconsistent", field: `runs/${run.run_id}`, redacted_only: 0, checked: { citations: 0, packets: 0, receipts: 0 } },
      drift: null,
      origin: null,
      key: null,
    };
  }
}

/** `coverage.json.indeterminate` of a checked (consistent) run. */
function coverageIndeterminateOf(dir) {
  return readArtifact(join(dir, "coverage.json"), { kind: "coverage" }).payload.indeterminate === true;
}

// --- dispositions --------------------------------------------------------------------------

/** The record's policy, spec §6.10's default when the key is absent. */
function dispositionPolicy(record) {
  const s = record.sign_off;
  return s !== null && typeof s === "object" && typeof s.require_dispositions === "string" ? s.require_dispositions : DEFAULT_DISPOSITION_POLICY;
}

/** The latest assessment's threats still `undisposed` or `planned`, in model order. */
function listedThreats(dir) {
  const model = readArtifact(join(dir, "threat-model.json"), { kind: "threat-model" }).payload;
  return model.threats.filter((t) => LISTED_DISPOSITIONS.includes(t.disposition.kind)).map((t) => ({ id: t.id, kind: t.disposition.kind }));
}

// --- approvals -----------------------------------------------------------------------------

/** register-fold.summarize's per-row rule, spelled per row for the listing. */
function approvalRows(projection) {
  const rows = [];
  for (const row of Object.values(projection.rows)) {
    const kinds = [];
    if (row.status === "accepted") kinds.push("acceptance");
    if (row.status === "false-positive") kinds.push("false_positive");
    if (Array.isArray(row.ack_refs) && row.ack_refs.length > 0) kinds.push("ack_refs");
    if (kinds.length > 0) rows.push({ id: row.id, status: row.status, kinds });
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// --- signOff -------------------------------------------------------------------------------

/**
 * Evaluate the sign-off (see the header). Prints nothing.
 * @param {object} ctx
 * @param {{engagement_id: string, expect?: string | null}} opts `expect` is a parsed-valid anchor string or null
 * @returns {{code: number, ok: boolean, engagement_id: string, causes: {cause: string, run_id: string | null}[], runs: {run_id: string, seq: number, kind: string, check: object}[], incomplete: {run_id: string, seq: number, kind: string}[], latest: string | null, baseline: null | {changed: string[], added: string[], removed: string[], ignored_counts: Record<string, number>}, register: {corrupt: boolean, anchor: string | null, approvals: null | {count: number, rows: {id: string, status: string, kinds: string[]}[]}}, dispositions: {policy: string, evaluated: boolean, listed: {id: string, kind: string}[]}, tracked: string[]}}
 * @throws {CliError} 2 USAGE (the id is not engagement.md's) · 2 ENGAGEMENT-MISSING · 5 INCONSISTENT(ledger/index.json)
 */
export async function signOff(ctx, { engagement_id, expect = null } = {}) {
  if (typeof engagement_id !== "string" || engagement_id === "") throw usageError(COMMAND, "--engagement is required");
  const record = ctx.engagement();
  if (record.engagement_id !== engagement_id) throw usageError(COMMAND, `--engagement ${engagement_id} is not the engagement in engagement.md (${record.engagement_id})`);
  if (expect !== null && parseAnchor(expect) === null) throw usageError(COMMAND, "--expect must be <engagement_id>:<seq>:<chain_sha256>");

  const causes = [];
  const fail = (cause, run_id = null) => causes.push({ cause, run_id });

  // 1. inventory; the latest COMMITTED assessment by seq
  const { committed, incomplete } = inventory(ctx, engagement_id);
  const assessments = committed.filter((r) => r.kind === "assessment");
  const latest = assessments.length === 0 ? null : assessments[assessments.length - 1];
  if (latest === null) fail(NO_ASSESSMENT);

  // 2. every COMMITTED run checked in-process (--integrity); drift for the latest assessment only
  const runs = [];
  for (const run of committed) {
    const isLatest = latest !== null && run.run_id === latest.run_id;
    const check = checkOrInconsistent(ctx, run, { integrity: true, drift: isLatest });
    runs.push({ run_id: run.run_id, seq: run.seq, kind: run.kind, check });
    const status = check.consistency.status;
    if (status === "inconsistent" || status === "structure-only") fail(check.consistency.token, run.run_id);
    else if (status === "redacted-only" && run.kind !== "review") fail(check.consistency.token, run.run_id);
    if (isLatest && status !== "inconsistent") {
      if (check.drift !== null && check.drift.scope_drifted > 0) fail(scopeDrifted(check.drift.scope_drifted), run.run_id);
      if (coverageIndeterminateOf(run.dir)) fail(coverageIndeterminate(run.run_id));
    }
  }

  // 3. the register: recovery rule, anchor, approvals
  const register = { corrupt: false, anchor: null, approvals: null };
  let projection = null;
  try {
    ({ projection } = await openRegister(ctx));
  } catch (err) {
    if (!(err instanceof CliError) || err.token !== CORRUPT) throw err;
    register.corrupt = true;
    fail(CORRUPT);
  }
  if (projection !== null) {
    if (expect !== null) {
      register.anchor = anchorVerify(projection, expect);
      if (register.anchor !== ANCHOR_MATCH) fail(register.anchor);
    }
    register.approvals = { count: summarize(projection).unauthenticated_approvals, rows: approvalRows(projection) };
  }

  // 4. dispositions per policy, over the latest assessment's model
  const policy = dispositionPolicy(record);
  const latestConsistent = latest !== null && runs.find((r) => r.run_id === latest.run_id).check.consistency.status !== "inconsistent";
  const dispositions = { policy, evaluated: policy !== "none" && latestConsistent, listed: [] };
  if (dispositions.evaluated) {
    dispositions.listed = listedThreats(latest.dir);
    if (policy === "all" && dispositions.listed.length > 0) fail(dispositionsBlocking(dispositions.listed.map((t) => t.id)));
  }

  // 5. tracked files under managed paths (fail-closed, spec §6.9 step 2)
  const probe = probeManagedPaths(ctx, record.artifact_policy ?? {});
  const trackedPaths = probe.tracked.map((t) => t.path);
  if (trackedPaths.length > 0) fail(tracked(trackedPaths[0]));
  for (const pattern of probe.notIgnored) ctx.log(`${COMMAND}: managed pattern ${pattern} is not ignored (engagement validate would report NOT-IGNORED)`);

  // 6. the baseline observation (informational)
  let baseline = null;
  const stored = readBaseline(ctx, engagement_id);
  if (stored === null) {
    ctx.log(`${COMMAND}: no baseline for ${engagement_id} — run engagement init`);
  } else {
    try {
      baseline = diffBaseline(ctx, stored);
    } catch (err) {
      if (!(err instanceof CliError) || err.token !== KEY_UNAVAILABLE) throw err;
      ctx.log(`${COMMAND}: the baseline's key ${stored.envelope.key_id} no longer loads — changes not observed`);
    }
  }

  return {
    code: causes.length === 0 ? EXIT.OK : EXIT.FAIL,
    ok: causes.length === 0,
    engagement_id,
    causes,
    runs,
    incomplete,
    latest: latest === null ? null : latest.run_id,
    baseline,
    register,
    dispositions,
    tracked: trackedPaths,
  };
}

// --- printing -------------------------------------------------------------------------------

function print(ctx, result) {
  if (result.ok) ctx.out(SIGN_OFF_OK);
  for (const c of result.causes) ctx.out(signOffFail(c.cause, c.run_id ?? undefined));

  ctx.out(runsHeader(result.runs.length));
  for (const r of result.runs) ctx.out(runsEntry({ run_id: r.run_id, seq: r.seq, kind: r.kind, consistency: r.check.consistency.token, drift: r.check.drift === null ? null : r.check.drift.token }));

  ctx.out(incompleteHeader(result.incomplete.length));
  for (const r of result.incomplete) ctx.out(incompleteEntry(r));

  if (result.baseline === null) {
    ctx.out(CHANGES_NOT_OBSERVED);
    ctx.out(EXCLUDED_COVERAGE_NOT_OBSERVED);
  } else {
    const b = result.baseline;
    ctx.out(changesHeader(b.changed.length + b.added.length + b.removed.length));
    for (const path of b.added) ctx.out(changeEntry("added", path));
    for (const path of b.changed) ctx.out(changeEntry("changed", path));
    for (const path of b.removed) ctx.out(changeEntry("removed", path));
    const paths = observedPaths(ctx.engagement());
    ctx.out(excludedCoverageHeader(paths.reduce((n, p) => n + (b.ignored_counts[p] ?? 0), 0)));
    for (const p of paths) ctx.out(excludedCoverageEntry(p, b.ignored_counts[p] ?? 0));
  }

  if (result.register.approvals === null) {
    ctx.out(APPROVALS_NOT_OBSERVED);
  } else {
    ctx.out(approvalsHeader(result.register.approvals.count));
    for (const row of result.register.approvals.rows) ctx.out(approvalEntry(row));
  }

  ctx.out(UNADMITTED_NOT_EVALUATED);

  if (!result.dispositions.evaluated) {
    ctx.out(DISPOSITIONS_NOT_EVALUATED);
  } else {
    ctx.out(dispositionsHeader(result.dispositions.listed.length, result.dispositions.policy));
    for (const t of result.dispositions.listed) ctx.out(dispositionEntry(t.id, t.kind));
  }
}

/**
 * @param {string[]} argv after `sign-off`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { engagement: "value", expect: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  if (flags.engagement === undefined) throw usageError(COMMAND, "--engagement is required");
  const result = await signOff(ctx, { engagement_id: flags.engagement, expect: flags.expect ?? null });
  print(ctx, result);
  return result.code;
}
