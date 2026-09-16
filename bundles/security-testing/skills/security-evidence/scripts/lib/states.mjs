// lib/states.mjs — the pure state derivation behind `receipt apply` (TASK-022;
// plan §3.3 row `states.mjs`, §5 TASK-022 Interface Contract; spec §6.4
// "receipt apply derives states" table, §6.3 derivation row `REVIEW_*,
// MITIGATION_*`; US-015 AC-3…AC-6; G-9 pure core).
//
//   applyReceipts(gateResult, receipts, packets)
//     → {states, mitigation_states, not_applied, conflicts}
//
// The one function `receipt apply`, `build-report`, `check`, `verify all`
// (finding lookup: REVIEW_REFUTED ⇒ UNVERIFIED-REFUTED-FINDING), `tm-lint`
// (`mitigated(<id>)` needs MITIGATION_CONFIRMED) and `plan admit` read a
// derived state through — so a state is spelled by one algorithm and `check`
// recomputes exactly what the report displayed. Pure: imports tokens.mjs
// only; no fs, no git, no clock, no randomness; inputs are never mutated; the
// result is deterministic and independent of input order (every list is
// sorted, every map's keys are sorted).
//
// Inputs (in-memory artifacts, `{envelope, payload}`):
//   gateResult  the run's gate-result artifact, or null when the run has no
//               gate (verify / threat-model runs). `accepted[]` are the
//               CITATION_VERIFIED findings, `unverifiable[]` the
//               CITATION_FAILED ones (spec §6.5 — gate's two states).
//   receipts    the run's admitted receipts (`<run>/receipts/*.json`, kind
//               receipt). `receipt validate` already bound each to a packet;
//               the binding is re-derived here so the core is self-sufficient
//               and `check` can see a set that no longer holds together.
//   packets     the run's packets (`<run>/packets/*.json`, kind packet).
//
// The §6.4 table, as applied:
//
//   prior CITATION_VERIFIED + vulnerability-review confirmed | refuted |
//     indeterminate ⇒ REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE.
//   prior CITATION_FAILED + any receipt ⇒ unchanged; the receipt is
//     not-applied `citation-failed`.
//   REVIEW_REFUTED is sticky: fix-review and ack receipts on it are
//     not-applied `review-refuted`; a mitigation-review on a finding is
//     `subject-is-finding` whatever the state; only a vulnerability-review
//     receipt in a NEW run re-derives it. Receipts of one run are a set —
//     files named by identity, no clock in any payload (G-1) — so "new"
//     cannot mean "later in arrival order": it means a later run. Groups of
//     (type, subject, reviewer_run_id) are applied in ledger seq order
//     (run_id = <head 12 hex>-<seq 4 digits>, TL-9; runSeq() below) and the
//     last group's assertion is the state. A same-run vulnerability-review
//     with a different assertion therefore never confirms a refuted finding:
//     it conflicts it (next row).
//   two receipts, same subject, same run, same type, different assertions
//     ⇒ *_INDETERMINATE and one `conflicts[]` record. Acks are exempt: one
//     per indicator is expected. Fix-review pairs that disagree are recorded
//     as a conflict too (evaluate.mjs reads that as indeterminate) but derive
//     no state here.
//   mitigation-review confirmed | gap | indeterminate ⇒ MITIGATION_CONFIRMED
//     | MITIGATION_GAP | MITIGATION_INDETERMINATE in `mitigation_states`, on
//     threat-model mitigations only: a mitigation-review whose subject is a
//     gate finding is not-applied `subject-is-finding` and never promotes it.
//
// Which subjects exist: every gate finding, plus every subject some packet of
// the set lists (packets are script-built from gate-result, the threat-model
// snapshot or a case file — the script's word on what may be reviewed, P1).
// A vulnerability-review receipt on a packet subject that is not a gate
// finding (a case packet's case_sha256, spec §9.1 `admitted-reviewed`)
// derives REVIEW_* with no citation prior. A receipt naming no packet of the
// set is `packet-unknown`; one whose packet does not list its subject (a
// scope packet included) is `subject-not-in-packet`.
//
// Result shape:
//   states            {subject_id → CITATION_* | REVIEW_*}; every gate finding
//                     is a key even without a receipt (shown by the report as
//                     "not independently reviewed"); keys sorted.
//   mitigation_states {mitigation_id → MITIGATION_*}; keys sorted.
//   not_applied       [{receipt_sha256, type, subject_id, reason}] sorted by
//                     receipt_sha256; reasons are tokens.NOT_APPLIED_* (closed).
//   conflicts         [{type, subject_id, reviewer_run_id, assertions[],
//                     receipts[]}] sorted by (subject_id, type, run);
//                     `assertions` distinct and sorted, `receipts` the shas.
//
// Shape errors are TypeErrors (a caller bug: the inputs are the bundle's own
// artifacts, read through canon.readArtifact). A duplicate receipt identity
// is one too — on disk a receipt is named by its identity.

import { CITATION_FAILED, CITATION_VERIFIED, MITIGATION_CONFIRMED, MITIGATION_GAP, MITIGATION_INDETERMINATE, NOT_APPLIED_CITATION_FAILED, NOT_APPLIED_PACKET_UNKNOWN, NOT_APPLIED_REVIEW_REFUTED, NOT_APPLIED_SUBJECT_IS_FINDING, NOT_APPLIED_SUBJECT_NOT_IN_PACKET, REVIEW_CONFIRMED, REVIEW_INDETERMINATE, REVIEW_REFUTED } from "./tokens.mjs";

/** receipt.schema.json `type` enum, in the spec's order. */
export const RECEIPT_TYPES = Object.freeze(["vulnerability-review", "mitigation-review", "fix-review", "ack"]);
/** Every state this module can derive or pass through (gate's two first). */
export const STATE_VOCABULARY = Object.freeze([CITATION_VERIFIED, CITATION_FAILED, REVIEW_CONFIRMED, REVIEW_REFUTED, REVIEW_INDETERMINATE, MITIGATION_CONFIRMED, MITIGATION_GAP, MITIGATION_INDETERMINATE]);
/** `not_applied[].reason` vocabulary, in check order. */
export const NOT_APPLIED_REASONS = Object.freeze([NOT_APPLIED_PACKET_UNKNOWN, NOT_APPLIED_SUBJECT_NOT_IN_PACKET, NOT_APPLIED_CITATION_FAILED, NOT_APPLIED_SUBJECT_IS_FINDING, NOT_APPLIED_REVIEW_REFUTED]);

/** Closed assertion enum per type (receipt.schema.json) and the state each derives. */
const ASSERTION_STATES = Object.freeze({
  "vulnerability-review": Object.freeze({ confirmed: REVIEW_CONFIRMED, refuted: REVIEW_REFUTED, indeterminate: REVIEW_INDETERMINATE }),
  "mitigation-review": Object.freeze({ confirmed: MITIGATION_CONFIRMED, gap: MITIGATION_GAP, indeterminate: MITIGATION_INDETERMINATE }),
  "fix-review": Object.freeze({ "not-refound": null, refound: null, indeterminate: null }),
});
const CONFLICT_STATE = Object.freeze({ "vulnerability-review": REVIEW_INDETERMINATE, "mitigation-review": MITIGATION_INDETERMINATE });

const HEX64 = /^[0-9a-f]{64}$/;
// TL-9 run id; a private copy — this leaf cannot import ledger.mjs (fs). ledger.RUN_ID is the module's own.
const RUN_ID = /^[0-9a-f]{12}-([0-9]{4})$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The ledger seq of a run id (`<head 12 hex>-<seq>`): the order "a new run"
 * is read by. Head hex is not chronological; seq is (one ledger per <st>).
 * @param {string} run_id
 * @returns {number}
 */
export function runSeq(run_id) {
  const m = typeof run_id === "string" ? RUN_ID.exec(run_id) : null;
  if (m === null) throw new TypeError(`runSeq: not a run id (<12 hex>-<4 digits>), got ${String(run_id)}`);
  return Number(m[1]);
}

// --- input checks -------------------------------------------------------------------

function requireIdList(v, where) {
  if (!Array.isArray(v) || !v.every((id) => typeof id === "string" && HEX64.test(id))) throw new TypeError(`applyReceipts: ${where} must be an array of finding ids`);
  return v;
}

/** `{accepted → CITATION_VERIFIED, unverifiable → CITATION_FAILED}`, or an empty map without a gate. */
function priorStates(gateResult) {
  const prior = new Map();
  if (gateResult === null || gateResult === undefined) return prior;
  if (!isObject(gateResult) || !isObject(gateResult.payload)) throw new TypeError("applyReceipts: gateResult must be null or a gate-result artifact {envelope, payload}");
  const accepted = requireIdList(gateResult.payload.accepted, "gateResult.payload.accepted");
  const unverifiable = requireIdList(gateResult.payload.unverifiable, "gateResult.payload.unverifiable");
  for (const id of accepted) prior.set(id, CITATION_VERIFIED);
  for (const id of unverifiable) {
    if (prior.has(id)) throw new TypeError(`applyReceipts: finding ${id} is in both accepted[] and unverifiable[]`);
    prior.set(id, CITATION_FAILED);
  }
  return prior;
}

/** `{packet_sha256 → Set(subject_ids)}` over the packet artifacts. */
function packetSubjects(packets) {
  if (!Array.isArray(packets)) throw new TypeError("applyReceipts: packets must be an array of packet artifacts");
  const map = new Map();
  packets.forEach((p, i) => {
    const sha = p?.envelope?.self_sha256;
    if (!isObject(p) || !isObject(p.payload) || typeof sha !== "string" || !HEX64.test(sha)) throw new TypeError(`applyReceipts: packets[${i}] must be a packet artifact with envelope.self_sha256`);
    if (!Array.isArray(p.payload.subject_ids) || !p.payload.subject_ids.every((s) => typeof s === "string")) throw new TypeError(`applyReceipts: packets[${i}].payload.subject_ids must be an array of strings`);
    map.set(sha, new Set(p.payload.subject_ids));
  });
  return map;
}

/** The receipt's fields, shape-checked; the closed enums are the schema's. */
function readReceipt(r, i) {
  const sha = r?.envelope?.self_sha256;
  if (!isObject(r) || !isObject(r.payload) || typeof sha !== "string" || !HEX64.test(sha)) throw new TypeError(`applyReceipts: receipts[${i}] must be a receipt artifact with envelope.self_sha256`);
  const { type, subject_id, packet_sha256, assertion, reviewer_run_id } = r.payload;
  if (!RECEIPT_TYPES.includes(type)) throw new TypeError(`applyReceipts: receipts[${i}].type must be one of ${RECEIPT_TYPES.join("|")}, got ${String(type)}`);
  if (typeof subject_id !== "string" || subject_id.length === 0) throw new TypeError(`applyReceipts: receipts[${i}].subject_id must be a non-empty string`);
  if (typeof packet_sha256 !== "string" || !HEX64.test(packet_sha256)) throw new TypeError(`applyReceipts: receipts[${i}].packet_sha256 must be a sha256`);
  if (typeof reviewer_run_id !== "string" || !RUN_ID.test(reviewer_run_id)) throw new TypeError(`applyReceipts: receipts[${i}].reviewer_run_id must be a run id (<12 hex>-<4 digits>), got ${String(reviewer_run_id)}`);
  if (type === "ack") {
    if (!isObject(assertion) || typeof assertion.indicator_id !== "string" || !HEX64.test(assertion.indicator_id) || Object.keys(assertion).length !== 1) {
      throw new TypeError(`applyReceipts: receipts[${i}].assertion must be {indicator_id: <sha256>} for an ack`);
    }
  } else if (typeof assertion !== "string" || !Object.hasOwn(ASSERTION_STATES[type], assertion)) {
    throw new TypeError(`applyReceipts: receipts[${i}].assertion must be one of ${Object.keys(ASSERTION_STATES[type]).join("|")} for ${type}, got ${String(assertion)}`);
  }
  return { sha, type, subject_id, packet_sha256, assertion, reviewer_run_id, seq: runSeq(reviewer_run_id) };
}

// --- derivation ---------------------------------------------------------------------

const sortedObject = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => compare(a, b)));

/**
 * @param {{envelope: object, payload: {accepted: string[], unverifiable: string[]}} | null} gateResult
 * @param {{envelope: {self_sha256: string}, payload: object}[]} receipts
 * @param {{envelope: {self_sha256: string}, payload: {subject_ids: string[]}}[]} packets
 * @returns {{states: Record<string, string>, mitigation_states: Record<string, string>, not_applied: {receipt_sha256: string, type: string, subject_id: string, reason: string}[], conflicts: {type: string, subject_id: string, reviewer_run_id: string, assertions: string[], receipts: string[]}[]}}
 */
export function applyReceipts(gateResult, receipts, packets) {
  if (!Array.isArray(receipts)) throw new TypeError("applyReceipts: receipts must be an array of receipt artifacts");
  const prior = priorStates(gateResult);
  const subjectsOf = packetSubjects(packets);

  // 1. per-receipt admissibility, in NOT_APPLIED_REASONS order; the rest are grouped
  const notApplied = [];
  const groups = new Map(); // `${type}\0${subject}\0${run}` → {type, subject_id, reviewer_run_id, seq, receipts: [{sha, assertion}]}
  const seen = new Set();
  const refuse = (r, reason) => notApplied.push({ receipt_sha256: r.sha, type: r.type, subject_id: r.subject_id, reason });
  receipts.forEach((raw, i) => {
    const r = readReceipt(raw, i);
    if (seen.has(r.sha)) throw new TypeError(`applyReceipts: duplicate receipt identity ${r.sha}`);
    seen.add(r.sha);
    const listed = subjectsOf.get(r.packet_sha256);
    if (listed === undefined) return refuse(r, NOT_APPLIED_PACKET_UNKNOWN);
    if (!listed.has(r.subject_id)) return refuse(r, NOT_APPLIED_SUBJECT_NOT_IN_PACKET);
    const citation = prior.get(r.subject_id);
    if (citation === CITATION_FAILED) return refuse(r, NOT_APPLIED_CITATION_FAILED);
    if (r.type === "mitigation-review" && citation !== undefined) return refuse(r, NOT_APPLIED_SUBJECT_IS_FINDING);
    const key = `${r.type}\0${r.subject_id}\0${r.reviewer_run_id}`;
    if (!groups.has(key)) groups.set(key, { type: r.type, subject_id: r.subject_id, reviewer_run_id: r.reviewer_run_id, seq: r.seq, receipts: [] });
    groups.get(key).receipts.push(r);
    return undefined;
  });

  // 2. conflicts: a non-ack group whose receipts do not all assert the same thing
  const conflicts = [];
  const effective = new Map(); // group key → assertion string, or null for a conflict
  for (const [key, g] of groups) {
    if (g.type === "ack") continue;
    const assertions = [...new Set(g.receipts.map((r) => r.assertion))].sort(compare);
    if (assertions.length > 1) {
      conflicts.push({ type: g.type, subject_id: g.subject_id, reviewer_run_id: g.reviewer_run_id, assertions, receipts: g.receipts.map((r) => r.sha).sort(compare) });
      effective.set(key, null);
    } else {
      effective.set(key, assertions[0]);
    }
  }

  // 3. states: the prior, then each state-deriving group in run (seq) order — the last one is the state
  const states = new Map(prior);
  const mitigations = new Map();
  const deriving = [...groups.entries()].filter(([, g]) => g.type === "vulnerability-review" || g.type === "mitigation-review").sort(([, a], [, b]) => a.seq - b.seq || compare(a.reviewer_run_id, b.reviewer_run_id));
  for (const [key, g] of deriving) {
    const assertion = effective.get(key);
    const state = assertion === null ? CONFLICT_STATE[g.type] : ASSERTION_STATES[g.type][assertion];
    (g.type === "vulnerability-review" ? states : mitigations).set(g.subject_id, state);
  }

  // 4. sticky REVIEW_REFUTED: a fix-review or ack on a refuted finding changes nothing and is recorded as such
  for (const g of groups.values()) {
    if (g.type !== "fix-review" && g.type !== "ack") continue;
    if (prior.has(g.subject_id) && states.get(g.subject_id) === REVIEW_REFUTED) g.receipts.forEach((r) => refuse(r, NOT_APPLIED_REVIEW_REFUTED));
  }

  notApplied.sort((a, b) => compare(a.receipt_sha256, b.receipt_sha256));
  conflicts.sort((a, b) => compare(a.subject_id, b.subject_id) || compare(a.type, b.type) || compare(a.reviewer_run_id, b.reviewer_run_id));
  return { states: sortedObject(states), mitigation_states: sortedObject(mitigations), not_applied: notApplied, conflicts };
}
