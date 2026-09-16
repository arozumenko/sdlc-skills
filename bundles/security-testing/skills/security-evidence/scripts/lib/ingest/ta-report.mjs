// lib/ingest/ta-report.mjs — `ingest ta-report <.agents/automation/<slug>/report.json>`
// (TASK-018; spec §6.6 row `ta-report`: trusted = unit outcomes, `coverage`,
// exclusions, `findings[]`, `recovery_basis` if present, test paths; inert =
// free text; §9.3: `delivered` without a gate receipt in the report ⇒
// `delivered-unwitnessed`). US-012 AC-4, US-037 AC-3.
//
// The format is the test-automation batch report
// (bundles/test-automation/skills/test-automation-workflow/references/
// orchestration-playbook.md § Outcomes, § Interruption and resumption, and
// the `report` object batch-build.workflow.mjs writes): `{batch, base,
// integration_branch, gate: {verdict, runs, seconds, failures[]} | null,
// cases: [{id, outcome, note, findings: [{kind, note, ref}], branch?, pr?,
// coverage?: {full, excluded: [{step, category, referent, note}]}, gate?:
// {runs, seconds}}], totals, quality_flags[], expected_red[{spec, …}],
// parked[], recovery?: {rebuilt_from[], note}}`. The fixture
// scripts/fixtures/ta/report.json is a verbatim copy of the bundle's
// documented example (kept identical by bin/check-skill-dupes.mjs). The
// adapter receives the strictly parsed, redacted value (lib/imports.mjs).
//
// Records (locator.index = the source ordinal: 0 the report, k the k-th
// `cases[]` row; a rejected row keeps its ordinal):
//   0        trusted {record: "report", batch, base, gate_verdict, gate_runs,
//                     recovery_basis, test_paths[], units}
//            `gate_verdict` ∈ green | red | not-run | incomplete (else null);
//            `recovery_basis` = `recovery.rebuilt_from` as a list of tokens
//            when the report carries the playbook's rebuilt-report block
//            (its `note` is quoted in inert.recovery_note), else null;
//            `test_paths` = the repo-relative posix paths named by
//            `expected_red[].spec` and `gate.failures[].spec`, sorted and
//            deduplicated — referenced, never opened. Anything else in those
//            fields is quoted (inert.untrusted_paths, inert.gate_failures,
//            inert.quality_flags).
//   k ≥ 1    trusted {record: "unit", case_id, outcome, outcome_reported,
//                     gate_witnessed, coverage, findings[], findings_dropped?}
//            `outcome_reported` is the report's token (∈ OUTCOMES);
//            `outcome` is what this bundle records: the same token, except a
//            `delivered` that no gate receipt witnesses ⇒ DELIVERED_UNWITNESSED.
//            A gate receipt = the case's own `gate: {runs ≥ 1}` record (the
//            workflow writes it exactly when its gate went green) or the
//            report's `gate.verdict: "green"` with `runs ≥ 1` (for a `delivered` row) — a rebuilt
//            report proves delivery by the merge, which is not a receipt.
//            `coverage` = {full: bool, excluded: [{step, category ∈
//            CATEGORIES, referent}], excluded_dropped?} or null when the
//            block is not that shape; an exclusion's `referent` is kept when
//            it is a token (a ticket id, a test path, a taxonomy category),
//            else null with the text quoted in inert.exclusion_notes.
//            `findings` = [{kind ∈ FINDING_KINDS, ref: token | null}] — the
//            structure the spec trusts; every note is quoted in
//            inert.findings; rows that are not that shape are counted in
//            `findings_dropped` and still quoted. inert {note?, branch?,
//            findings?, exclusion_notes?}.
//            A row that is not an object ⇒ rejected `bad-unit`; an `id` that
//            is not a case id ⇒ `bad-case-id`; an outcome outside OUTCOMES ⇒
//            `unknown-outcome` (§4.1: rejections never change the exit code).
//
// Structural failures — the report is not an object, `cases` is not an
// array, `gate` present but not an object/null — are the adapter's own
// exit-2 result: CliError(2, SCHEMA-INVALID(ta-report: <reason>)). Scope and
// targets are not consulted: nothing in a report is a URL or a scope path.
//
// Leaf over ./_shared.mjs, ./case.mjs (CASE_ID, ID_TOKEN), ../exit.mjs,
// ../tokens.mjs: no fs, no child process, no git, no network (G-6, G-14),
// no clock (G-1) — `gate.seconds` and every duration stay in the blob.

import { wrapInert } from "./_shared.mjs";
import { CASE_ID, ID_TOKEN } from "./case.mjs";
import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";

export const MAPPING_VERSION = "v1";
const KIND = "ta-report";

/** orchestration-playbook.md § Outcomes: the seven terminal outcomes, then the in-flight markers the report may also carry. */
export const OUTCOMES = Object.freeze(["delivered", "defect-found", "blocked", "un-automatable", "needs-execution", "not-started", "infra-stalled", "built", "reviewed", "merged-ungated"]);
/** What this bundle records for a `delivered` no gate receipt witnesses (spec §9.3). */
export const DELIVERED_UNWITNESSED = "delivered-unwitnessed";
/** coverage-contract.md: the closed exclusion categories. */
export const CATEGORIES = Object.freeze(["covered-elsewhere", "blocked-by-defect", "un-automatable", "by-seeded-policy"]);
/** orchestration-playbook.md § Outcomes: the four finding kinds. */
export const FINDING_KINDS = Object.freeze(["defect", "clarification", "question", "note"]);
const GATE_VERDICTS = Object.freeze(["green", "red", "not-run", "incomplete"]);
export const REJECT_BAD_UNIT = "bad-unit";
export const REJECT_BAD_CASE_ID = "bad-case-id";
export const REJECT_UNKNOWN_OUTCOME = "unknown-outcome";

/** A repo-relative posix path: not absolute, no backslash, no `.` / `..` segment, no whitespace, no drive letter. */
const REPO_RELATIVE = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\s]+$/;
/** A referent: an id token or a repo-relative path (a test path, `login.spec.ts:42`). */
const REFERENT = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/:#@-]{0,199}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function invalid(reason) {
  return new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : null);
const positiveInt = (v) => Number.isInteger(v) && v >= 1;

/** `{ok: string[], bad: string[]}` of the `spec` values in a list of `{spec}` rows. */
function specPaths(rows) {
  const ok = [];
  const bad = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const spec = isObject(r) ? str(r.spec) : null;
    if (spec === null) continue;
    (REPO_RELATIVE.test(spec) ? ok : bad).push(spec);
  }
  return { ok, bad };
}

function coverageOf(raw) {
  if (!isObject(raw) || typeof raw.full !== "boolean" || !Array.isArray(raw.excluded)) return { coverage: null, notes: [] };
  const excluded = [];
  const notes = [];
  let dropped = 0;
  for (const e of raw.excluded) {
    if (!isObject(e) || typeof e.step !== "string" || !CATEGORIES.includes(e.category)) {
      dropped += 1;
      notes.push(JSON.stringify(e));
      continue;
    }
    const referent = typeof e.referent === "string" && REFERENT.test(e.referent) ? e.referent : null;
    if (referent === null && typeof e.referent === "string") notes.push(`${e.step} (${e.category}): ${e.referent}`);
    if (typeof e.note === "string" && e.note !== "") notes.push(`${e.step}: ${e.note}`);
    excluded.push({ step: e.step, category: e.category, referent });
  }
  const coverage = { full: raw.full, excluded };
  if (dropped > 0) coverage.excluded_dropped = dropped;
  return { coverage, notes };
}

function findingsOf(raw) {
  const findings = [];
  const quoted = [];
  let dropped = 0;
  for (const f of Array.isArray(raw) ? raw : []) {
    quoted.push(isObject(f) ? `${str(f.kind) ?? "?"}${typeof f.ref === "string" ? ` [${f.ref}]` : ""}: ${str(f.note) ?? ""}` : JSON.stringify(f));
    if (!isObject(f) || !FINDING_KINDS.includes(f.kind)) {
      dropped += 1;
      continue;
    }
    findings.push({ kind: f.kind, ref: typeof f.ref === "string" && ID_TOKEN.test(f.ref) ? f.ref : null });
  }
  return { findings, quoted, dropped };
}

/**
 * @param {object} ctx unused
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused
 * @param {unknown} report the redacted parsed report.json
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(ta-report: …)
 * @throws {TypeError} when `report` is not a parsed JSON value (the dispatcher parses JSON kinds)
 */
export function adapt(ctx, run, scope, report, locatorBase) {
  if (typeof report === "string" || report === undefined) throw new TypeError("ingest ta-report: the input must be the parsed report");
  if (!isObject(report)) throw invalid("the report must be a JSON object");
  if (!Array.isArray(report.cases)) throw invalid("cases must be an array (only cases[] is load-bearing — orchestration-playbook.md)");
  if (report.gate !== undefined && report.gate !== null && !isObject(report.gate)) throw invalid("gate must be an object or null");
  const { import_sha256, original_hmac } = locatorBase;

  const gate = isObject(report.gate) ? report.gate : null;
  const gate_verdict = gate !== null && GATE_VERDICTS.includes(gate.verdict) ? gate.verdict : null;
  const gate_runs = gate !== null && Number.isInteger(gate.runs) && gate.runs >= 0 ? gate.runs : null;
  const reportGreen = gate_verdict === "green" && positiveInt(gate_runs);
  const recovery = isObject(report.recovery) ? report.recovery : null;
  const recovery_basis = recovery !== null && Array.isArray(recovery.rebuilt_from) ? recovery.rebuilt_from.filter((t) => typeof t === "string" && TOKEN.test(t)) : null;
  const red = specPaths(report.expected_red);
  const failures = specPaths(gate !== null ? gate.failures : []);

  const head = {
    locator: { import_sha256, original_hmac, index: 0 },
    trusted: {
      record: "report",
      batch: typeof report.batch === "string" && TOKEN.test(report.batch) ? report.batch : null,
      base: typeof report.base === "string" && REFERENT.test(report.base) ? report.base : null,
      gate_verdict,
      gate_runs,
      recovery_basis,
      test_paths: [...new Set([...red.ok, ...failures.ok])].sort(),
      units: report.cases.length,
    },
    inert: {},
  };
  const untrusted = [...new Set([...red.bad, ...failures.bad])];
  if (untrusted.length > 0) head.inert.untrusted_paths = wrapInert(untrusted.join("\n"));
  if (gate !== null && Array.isArray(gate.failures) && gate.failures.length > 0) head.inert.gate_failures = wrapInert(gate.failures.map((f) => JSON.stringify(f)).join("\n"));
  if (Array.isArray(report.quality_flags) && report.quality_flags.length > 0) head.inert.quality_flags = wrapInert(report.quality_flags.map((q) => String(q)).join("\n"));
  if (recovery !== null && typeof recovery.note === "string" && recovery.note !== "") head.inert.recovery_note = wrapInert(recovery.note);

  const records = [head];
  const rejected = [];
  report.cases.forEach((c, i) => {
    const index = i + 1;
    if (!isObject(c)) {
      rejected.push({ reason: REJECT_BAD_UNIT, locator: { import_sha256, index } });
      return;
    }
    if (typeof c.id !== "string" || !CASE_ID.test(c.id)) {
      rejected.push({ reason: REJECT_BAD_CASE_ID, locator: { import_sha256, index } });
      return;
    }
    if (!OUTCOMES.includes(c.outcome)) {
      rejected.push({ reason: REJECT_UNKNOWN_OUTCOME, locator: { import_sha256, index } });
      return;
    }
    // The gate proves the units on the trunk: a case's own receipt, or the report's green for a row it says was delivered.
    const witnessed = (isObject(c.gate) && positiveInt(c.gate.runs)) || (reportGreen && c.outcome === "delivered");
    const outcome = c.outcome === "delivered" && !witnessed ? DELIVERED_UNWITNESSED : c.outcome;
    const cov = coverageOf(c.coverage);
    const fin = findingsOf(c.findings);
    const trusted = {
      record: "unit",
      case_id: c.id,
      outcome,
      outcome_reported: c.outcome,
      gate_witnessed: witnessed,
      coverage: cov.coverage,
      findings: fin.findings,
    };
    if (fin.dropped > 0) trusted.findings_dropped = fin.dropped;
    const inert = {};
    if (typeof c.note === "string" && c.note !== "") inert.note = wrapInert(c.note);
    if (typeof c.branch === "string" && c.branch !== "") inert.branch = wrapInert(c.branch);
    if (fin.quoted.length > 0) inert.findings = wrapInert(fin.quoted.join("\n"));
    if (cov.notes.length > 0) inert.exclusion_notes = wrapInert(cov.notes.join("\n"));
    records.push({ locator: { import_sha256, original_hmac, index }, trusted, inert });
  });

  return { records, unlocated: [], rejected, mapping_version: MAPPING_VERSION };
}
