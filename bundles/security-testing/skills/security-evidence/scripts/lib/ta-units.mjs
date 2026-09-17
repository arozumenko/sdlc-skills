// lib/ta-units.mjs — the `ta-report` per-unit records (TASK-044; plan §5
// TASK-044 "`ta-report` per-unit records into the run (partial coverage kept
// per assertion)"; spec §9.3 "`ingest ta-report` records per unit: outcome,
// coverage record, exclusions, findings, `recovery_basis`; `delivered` without
// a gate receipt ⇒ `delivered-unwitnessed`; partial coverage kept per
// assertion"; US-037 AC-2, AC-3). The post-step lib/cmd-ingest.mjs runs for
// the `ta-report` kind over the adapter's records (lib/ingest/ta-report.mjs).
//
//   buildTaUnits(records, {import_sha256, resolve}) → payload   (pure)
//     {import_sha256, batch, base, recovery_basis, units: [{case_id,
//      case_sha256, outcome, outcome_reported, gate_witnessed, coverage,
//      exclusions, findings, recovery_basis}]}, one unit per `unit` record in
//     source order. `batch` and `base` are the report's informational labels
//     (TASK-018 PM-log row: never a git ref, never argv — G-6). Per unit:
//     `coverage` is the record's word — `full` | `partial` | `unknown` (no
//     parsable declaration); `exclusions` keeps every excluded assertion as
//     `{step, category, referent}` (partial coverage per assertion; a
//     referent the adapter could not trust is `unknown`); `findings` are the
//     adapter's `{kind, ref}` rows (`ref` `unknown` when it was not a token);
//     `recovery_basis` is the report's `rebuilt_from` tokens, on every unit of
//     a rebuilt report, else `unknown`; `case_sha256` is the admitted identity
//     the run joins the case id to (lib/observations.mjs caseResolver) or
//     `unknown`. Every value the report does not carry is the string
//     `unknown`, never blank or null (the §9.2 rule, applied to both TASK-044
//     records).
//   writeTaUnits(ctx, run, payload) → {path, bytes, sha256}
//     `<run>/ta-units/<import_sha256>.json`: PAYLOAD-ONLY canonical JSON + LF
//     (the PM-log G13 "payload-only or enveloped" choice: envelope.schema.json
//     and its kind list are closed at TASK-005 and name no ta-units kind; the
//     tracker ticket payload is the precedent), redacted before it is hashed
//     (G-4), write-once (G-10: an existing file with these bytes is
//     idempotent — a healing re-ingest — a different one is 5
//     INCONSISTENT(ta-units/<sha>)). One file per import rather than one
//     `<run>/ta-units.json`: a run may ingest a second ta-report (a rebuilt
//     one, TASK-018's own test), and only the TL-14 index files are ever
//     rewritten. The file is outside every template's closed input list, so
//     it never enters a manifest; its identity is on the TA-UNITS line.
//
// Imports: node:fs (existsSync, readFileSync — the write is fsx.writeExclusive),
// node:path, ../canon.mjs (canonical, sha256Hex), ../redact.mjs, ./exit.mjs,
// ./fsx.mjs, ./tokens.mjs. No child process (G-6), no git, no network
// (G-14), no clock (G-1). Never prints.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { integrityFailure } from "./exit.mjs";
import { writeExclusive } from "./fsx.mjs";
import { inconsistent } from "./tokens.mjs";

const WHERE = "ta-units";
const SHA256 = /^[0-9a-f]{64}$/;
export const UNKNOWN = "unknown";
export const DIR = "ta-units";

const orUnknown = (v) => (typeof v === "string" && v !== "" ? v : UNKNOWN);

/** The adapter's `coverage` (`{full, excluded[]}` | null) as the record's word plus its per-assertion exclusions. */
function coverageOf(coverage) {
  if (coverage === null || typeof coverage !== "object" || typeof coverage.full !== "boolean" || !Array.isArray(coverage.excluded)) return { coverage: UNKNOWN, exclusions: [] };
  const exclusions = coverage.excluded.map((e) => ({ step: orUnknown(e.step), category: orUnknown(e.category), referent: orUnknown(e.referent) }));
  return { coverage: coverage.full ? "full" : "partial", exclusions };
}

/**
 * The per-unit payload of one ta-report import (see the header).
 * @param {object[]} records the adapter's `records[]` (lib/ingest/ta-report.mjs)
 * @param {{import_sha256: string, resolve: (case_id: string) => {case_sha256: string} | null}} options
 * @returns {{import_sha256: string, batch: string, base: string, recovery_basis: string[] | string, units: object[]}}
 */
export function buildTaUnits(records, { import_sha256, resolve } = {}) {
  if (!Array.isArray(records)) throw new TypeError(`${WHERE}.buildTaUnits: records must be the adapter's records[]`);
  if (typeof import_sha256 !== "string" || !SHA256.test(import_sha256)) throw new TypeError(`${WHERE}.buildTaUnits: import_sha256 must be 64 hex chars`);
  if (typeof resolve !== "function") throw new TypeError(`${WHERE}.buildTaUnits: resolve must be a function`);
  const head = records.find((r) => r?.locator?.index === 0 && r?.trusted?.record === "report");
  if (head === undefined) throw new TypeError(`${WHERE}.buildTaUnits: records[] carries no report record at index 0`);
  const recovery_basis = Array.isArray(head.trusted.recovery_basis) ? head.trusted.recovery_basis.filter((t) => typeof t === "string") : UNKNOWN;
  const units = records
    .filter((r) => r?.trusted?.record === "unit")
    .sort((a, b) => a.locator.index - b.locator.index)
    .map(({ trusted: t }) => {
      const cov = coverageOf(t.coverage);
      const found = resolve(t.case_id);
      return {
        case_id: t.case_id,
        case_sha256: found === null ? UNKNOWN : found.case_sha256,
        outcome: orUnknown(t.outcome),
        outcome_reported: orUnknown(t.outcome_reported),
        gate_witnessed: t.gate_witnessed === true,
        coverage: cov.coverage,
        exclusions: cov.exclusions,
        findings: (Array.isArray(t.findings) ? t.findings : []).map((f) => ({ kind: orUnknown(f.kind), ref: orUnknown(f.ref) })),
        recovery_basis,
      };
    });
  return { import_sha256, batch: orUnknown(head.trusted.batch), base: orUnknown(head.trusted.base), recovery_basis, units };
}

/**
 * Persist the payload write-once (see the header).
 * @param {object} ctx unused today (the file carries no clock and no actor); kept for the writer contract
 * @param {{dir: string}} run
 * @param {object} payload buildTaUnits' result
 * @returns {{path: string, bytes: Buffer, sha256: string}}
 */
export function writeTaUnits(ctx, run, payload) {
  if (payload === null || typeof payload !== "object" || !SHA256.test(payload.import_sha256 ?? "")) throw new TypeError(`${WHERE}.writeTaUnits: payload must be buildTaUnits' result`);
  const redacted = redactDeep(payload, DEFAULT_RULES);
  const bytes = Buffer.concat([canonical(redacted), Buffer.from("\n", "utf8")]);
  const name = `${DIR}/${payload.import_sha256}`;
  const path = join(run.dir, `${name}.json`);
  try {
    writeExclusive(path, bytes);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw integrityFailure(inconsistent(name));
  }
  return { path, bytes, sha256: sha256Hex(bytes) };
}
