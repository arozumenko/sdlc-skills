// TASK-022 — lib/states.mjs: the pure state derivation `receipt apply`,
// `build-report`, `check`, `verify all`, `tm-lint` and `plan admit` share
// (plan §3.3 row `states.mjs`, §5 TASK-022 Interface Contract; spec §6.4
// "receipt apply derives states" table, §6.3 derivation table row
// `REVIEW_*, MITIGATION_*`; US-015 AC-3…AC-6; G-9 pure core). Every input is
// an in-memory artifact; nothing here touches git, the file system or a clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_APPLIED_REASONS, RECEIPT_TYPES, STATE_VOCABULARY, applyReceipts, runSeq } from "./states.mjs";
import * as tokens from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const F1 = "1".repeat(64); // accepted (CITATION_VERIFIED)
const F2 = "2".repeat(64); // accepted (CITATION_VERIFIED)
const F3 = "3".repeat(64); // unverifiable (CITATION_FAILED)
const CASE = "c".repeat(64); // a case packet subject (§9.1), never gated
const M1 = "M-001";
const RUN_A = `${"a".repeat(12)}-0003`;
const RUN_B = `${"b".repeat(12)}-0007`;
const RUN_C = `${"0".repeat(12)}-0005`; // seq between A and B, head hex sorts first
const P_F1 = "e1".repeat(32);
const P_F12 = "e2".repeat(32);
const P_M1 = "e3".repeat(32);
const P_CASE = "e4".repeat(32);
const P_SCOPE = "e5".repeat(32);
const IND = "d".repeat(64);

const gateResult = (accepted = [F1, F2], unverifiable = [F3]) => ({
  envelope: { self_sha256: "9".repeat(64), kind: "gate-result", run_id: RUN_A },
  payload: { accepted, unverifiable, rejected_counts: {}, scope_sha256: "5".repeat(64), claimed_sha256: "6".repeat(64) },
});

const packet = (sha, subject_ids, kind = "subject") => ({
  envelope: { self_sha256: sha, kind: "packet", run_id: RUN_A },
  payload: { kind, subject_ids, files: [], policy_sha256: "7".repeat(64) },
});
const PACKETS = [packet(P_F1, [F1]), packet(P_F12, [F1, F2]), packet(P_M1, [M1]), packet(P_CASE, [CASE]), packet(P_SCOPE, [], "scope")];

let receiptCounter = 0;
/** A receipt artifact; `sha` defaults to a distinct 64-hex string so the not-applied list can name it. */
function receipt({ type, subject_id, packet_sha256, assertion, reviewer_run_id = RUN_A, sha }) {
  receiptCounter += 1;
  const self_sha256 = sha ?? (receiptCounter.toString(16).padStart(4, "0") + "f".repeat(60));
  return { envelope: { self_sha256, kind: "receipt", run_id: reviewer_run_id }, payload: { type, subject_id, packet_sha256, assertion, reviewer_run_id } };
}
const vr = (subject_id, assertion, over = {}) => receipt({ type: "vulnerability-review", subject_id, packet_sha256: P_F12, assertion, ...over });
const mr = (subject_id, assertion, over = {}) => receipt({ type: "mitigation-review", subject_id, packet_sha256: P_M1, assertion, ...over });
const fr = (subject_id, assertion, over = {}) => receipt({ type: "fix-review", subject_id, packet_sha256: P_F1, assertion, ...over });
const ack = (subject_id, indicator_id, over = {}) => receipt({ type: "ack", subject_id, packet_sha256: P_F1, assertion: { indicator_id }, ...over });

const freeze = (v) => {
  if (Array.isArray(v)) v.forEach(freeze);
  else if (v !== null && typeof v === "object") Object.values(v).forEach(freeze);
  return Object.freeze(v);
};

// --- G-9 -------------------------------------------------------------------------

test("pure module: states.mjs imports only tokens.mjs — no node:fs, node:child_process, git.mjs, clock or randomness", () => {
  const src = readFileSync(join(HERE, "states.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process.", "node:crypto", "canon.mjs"]) {
    assert.ok(!src.includes(banned), `states.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./tokens.mjs"]);
});

test("vocabulary: the eight derived states and the four receipt types are tokens.mjs's; not-applied reasons are a closed list", () => {
  assert.deepEqual([...STATE_VOCABULARY], [tokens.CITATION_VERIFIED, tokens.CITATION_FAILED, tokens.REVIEW_CONFIRMED, tokens.REVIEW_REFUTED, tokens.REVIEW_INDETERMINATE, tokens.MITIGATION_CONFIRMED, tokens.MITIGATION_GAP, tokens.MITIGATION_INDETERMINATE]);
  assert.deepEqual([...RECEIPT_TYPES], ["vulnerability-review", "mitigation-review", "fix-review", "ack"]);
  assert.deepEqual([...NOT_APPLIED_REASONS], [tokens.NOT_APPLIED_PACKET_UNKNOWN, tokens.NOT_APPLIED_SUBJECT_NOT_IN_PACKET, tokens.NOT_APPLIED_CITATION_FAILED, tokens.NOT_APPLIED_SUBJECT_IS_FINDING, tokens.NOT_APPLIED_REVIEW_REFUTED]);
  assert.ok(Object.isFrozen(STATE_VOCABULARY) && Object.isFrozen(RECEIPT_TYPES) && Object.isFrozen(NOT_APPLIED_REASONS));
});

// --- AC-3 -------------------------------------------------------------------------

test("no receipts: every accepted finding is CITATION_VERIFIED, every unverifiable one CITATION_FAILED; nothing else", () => {
  const r = applyReceipts(gateResult(), [], PACKETS);
  assert.deepEqual(r, { states: { [F1]: "CITATION_VERIFIED", [F2]: "CITATION_VERIFIED", [F3]: "CITATION_FAILED" }, mitigation_states: {}, not_applied: [], conflicts: [] });
  // no gate at all (a verify or threat-model run): empty states
  assert.deepEqual(applyReceipts(null, [], PACKETS), { states: {}, mitigation_states: {}, not_applied: [], conflicts: [] });
});

test("CITATION_VERIFIED + vulnerability-review confirmed/refuted/indeterminate ⇒ REVIEW_CONFIRMED / REVIEW_REFUTED / REVIEW_INDETERMINATE (AC-3)", () => {
  for (const [assertion, state] of [
    ["confirmed", "REVIEW_CONFIRMED"],
    ["refuted", "REVIEW_REFUTED"],
    ["indeterminate", "REVIEW_INDETERMINATE"],
  ]) {
    const r = applyReceipts(gateResult(), [vr(F1, assertion)], PACKETS);
    assert.equal(r.states[F1], state, assertion);
    assert.equal(r.states[F2], "CITATION_VERIFIED", "an unreviewed sibling is untouched");
    assert.equal(r.states[F3], "CITATION_FAILED");
    assert.deepEqual(r.mitigation_states, {});
    assert.deepEqual(r.not_applied, []);
    assert.deepEqual(r.conflicts, []);
  }
  // two subjects of one packet, each with its own receipt
  const r = applyReceipts(gateResult(), [vr(F1, "confirmed"), vr(F2, "refuted")], PACKETS);
  assert.deepEqual(r.states, { [F1]: "REVIEW_CONFIRMED", [F2]: "REVIEW_REFUTED", [F3]: "CITATION_FAILED" });
});

// --- AC-4 -------------------------------------------------------------------------

test("CITATION_FAILED stays; every receipt on it is not-applied `citation-failed` (AC-4)", () => {
  const packets = [...PACKETS, packet("e6".repeat(32), [F3])];
  const a = vr(F3, "confirmed", { packet_sha256: "e6".repeat(32) });
  const b = fr(F3, "not-refound", { packet_sha256: "e6".repeat(32) });
  const c = ack(F3, IND, { packet_sha256: "e6".repeat(32) });
  const r = applyReceipts(gateResult(), [a, b, c], packets);
  assert.equal(r.states[F3], "CITATION_FAILED");
  assert.deepEqual(
    r.not_applied,
    [a, b, c].map((x) => ({ receipt_sha256: x.envelope.self_sha256, type: x.payload.type, subject_id: F3, reason: "citation-failed" })),
  );
  assert.deepEqual(r.conflicts, []);
});

// --- packet binding (re-derived, so the core is self-sufficient) ----------------------

test("a receipt naming no packet of the set ⇒ not-applied `packet-unknown`; a packet that does not list the subject (a scope packet included) ⇒ `subject-not-in-packet`; the state is untouched", () => {
  const unknown = vr(F1, "confirmed", { packet_sha256: "ab".repeat(32) });
  const wrongSubject = vr(F2, "confirmed", { packet_sha256: P_F1 }); // P_F1 lists F1 only
  const scope = vr(F1, "confirmed", { packet_sha256: P_SCOPE });
  const r = applyReceipts(gateResult(), [unknown, wrongSubject, scope], PACKETS);
  assert.deepEqual(r.states, { [F1]: "CITATION_VERIFIED", [F2]: "CITATION_VERIFIED", [F3]: "CITATION_FAILED" });
  assert.deepEqual(
    r.not_applied.map((n) => [n.receipt_sha256, n.reason]),
    [
      [unknown.envelope.self_sha256, "packet-unknown"],
      [wrongSubject.envelope.self_sha256, "subject-not-in-packet"],
      [scope.envelope.self_sha256, "subject-not-in-packet"],
    ],
  );
});

// --- AC-5 -------------------------------------------------------------------------

test("REVIEW_REFUTED sticky (AC-5): fix-review, ack and mitigation-review receipts never change it (fix-review/ack on it are not-applied `review-refuted`); a same-run vulnerability-review only conflicts it to INDETERMINATE; a vulnerability-review in a LATER run re-derives it", () => {
  const refuted = vr(F1, "refuted");
  const fix = fr(F1, "not-refound");
  const a = ack(F1, IND);
  const mit = mr(F1, "confirmed", { packet_sha256: P_F1 });
  const r = applyReceipts(gateResult(), [refuted, fix, a, mit], PACKETS);
  assert.equal(r.states[F1], "REVIEW_REFUTED");
  assert.deepEqual(r.mitigation_states, {}, "a mitigation-review on a finding never promotes it");
  assert.deepEqual(
    r.not_applied.map((n) => [n.receipt_sha256, n.reason]),
    [
      [fix.envelope.self_sha256, "review-refuted"],
      [a.envelope.self_sha256, "review-refuted"],
      [mit.envelope.self_sha256, "subject-is-finding"],
    ].sort((x, y) => (x[0] < y[0] ? -1 : 1)),
  );
  assert.deepEqual(r.conflicts, []);

  // same run, a second vulnerability-review saying confirmed: the pair conflicts ⇒ INDETERMINATE, never CONFIRMED
  const same = applyReceipts(gateResult(), [refuted, vr(F1, "confirmed")], PACKETS);
  assert.equal(same.states[F1], "REVIEW_INDETERMINATE");
  assert.equal(same.conflicts.length, 1);

  // a new vulnerability-review receipt in a later run (a re-gated finding, its own packet) is the new derivation
  const later = vr(F1, "confirmed", { reviewer_run_id: RUN_B, packet_sha256: P_F1 });
  const fresh = applyReceipts(gateResult(), [refuted, later], PACKETS);
  assert.equal(fresh.states[F1], "REVIEW_CONFIRMED");
  assert.deepEqual(fresh.conflicts, [], "different runs never conflict");
  assert.deepEqual(fresh.not_applied, []);
  // run order is ledger seq order, not the run id's string order: RUN_C (seq 5) sorts before RUN_A as a string but is later
  const mid = vr(F1, "indeterminate", { reviewer_run_id: RUN_C, packet_sha256: P_F1 });
  assert.equal(applyReceipts(gateResult(), [refuted, mid], PACKETS).states[F1], "REVIEW_INDETERMINATE");
  assert.equal(applyReceipts(gateResult(), [later, mid, refuted], PACKETS).states[F1], "REVIEW_CONFIRMED", "seq 7 wins over 5 and 3 whatever the input order");
  // an earlier run's receipt does not override a later refutation
  const earlier = vr(F1, "confirmed", { reviewer_run_id: `${"f".repeat(12)}-0001`, packet_sha256: P_F1 });
  assert.equal(applyReceipts(gateResult(), [earlier, refuted], PACKETS).states[F1], "REVIEW_REFUTED");
});

test("fix-review and ack receipts derive no state: on a CITATION_VERIFIED or REVIEW_CONFIRMED finding they are applied (absent from not_applied) and leave states untouched", () => {
  const r = applyReceipts(gateResult(), [vr(F1, "confirmed"), fr(F1, "refound"), ack(F1, IND), fr(F2, "not-refound", { packet_sha256: P_F12 })], PACKETS);
  assert.deepEqual(r.states, { [F1]: "REVIEW_CONFIRMED", [F2]: "CITATION_VERIFIED", [F3]: "CITATION_FAILED" });
  assert.deepEqual(r.not_applied, []);
  assert.deepEqual(r.conflicts, []);
});

// --- AC-6 -------------------------------------------------------------------------

test("two receipts, same subject, same run, same type, different assertions ⇒ *_INDETERMINATE and one conflict record; multiple acks are exempt (AC-6)", () => {
  const a = vr(F1, "confirmed");
  const b = vr(F1, "refuted");
  const r = applyReceipts(gateResult(), [b, a], PACKETS);
  assert.equal(r.states[F1], "REVIEW_INDETERMINATE");
  assert.deepEqual(r.not_applied, [], "conflicting receipts are applied — jointly, as indeterminate");
  assert.deepEqual(r.conflicts, [{ type: "vulnerability-review", subject_id: F1, reviewer_run_id: RUN_A, assertions: ["confirmed", "refuted"], receipts: [a.envelope.self_sha256, b.envelope.self_sha256].sort() }]);
  // three-way with a duplicate assertion is still one conflict listing the distinct assertions
  const c = vr(F1, "indeterminate");
  const three = applyReceipts(gateResult(), [a, b, c], PACKETS);
  assert.equal(three.states[F1], "REVIEW_INDETERMINATE");
  assert.deepEqual(three.conflicts[0].assertions, ["confirmed", "indeterminate", "refuted"]);
  // mitigation-review conflicts the same way
  const m = applyReceipts(null, [mr(M1, "confirmed"), mr(M1, "gap")], PACKETS);
  assert.deepEqual(m.mitigation_states, { [M1]: "MITIGATION_INDETERMINATE" });
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.conflicts[0].type, "mitigation-review");
  // acks: one per indicator, never a conflict; two different acks on one subject are both applied
  const acks = applyReceipts(gateResult(), [vr(F1, "confirmed"), ack(F1, IND), ack(F1, "e".repeat(64)), ack(F1, "f".repeat(64))], PACKETS);
  assert.deepEqual(acks.conflicts, []);
  assert.deepEqual(acks.not_applied, []);
  assert.equal(acks.states[F1], "REVIEW_CONFIRMED");
  // fix-review: two applied receipts disagreeing is a conflict record too (evaluate reads that as indeterminate)
  const fix = applyReceipts(gateResult(), [fr(F1, "refound"), fr(F1, "not-refound")], PACKETS);
  assert.equal(fix.conflicts.length, 1);
  assert.equal(fix.conflicts[0].type, "fix-review");
  assert.equal(fix.states[F1], "CITATION_VERIFIED", "a fix-review conflict derives no review state");
});

// --- mitigations -----------------------------------------------------------------

test("mitigation-review receipts derive MITIGATION_CONFIRMED / MITIGATION_GAP / MITIGATION_INDETERMINATE on threat-model mitigations only; on a gate finding they are not-applied `subject-is-finding` and never promote it", () => {
  for (const [assertion, state] of [
    ["confirmed", "MITIGATION_CONFIRMED"],
    ["gap", "MITIGATION_GAP"],
    ["indeterminate", "MITIGATION_INDETERMINATE"],
  ]) {
    const r = applyReceipts(gateResult(), [mr(M1, assertion)], PACKETS);
    assert.deepEqual(r.mitigation_states, { [M1]: state }, assertion);
    assert.deepEqual(r.states, { [F1]: "CITATION_VERIFIED", [F2]: "CITATION_VERIFIED", [F3]: "CITATION_FAILED" });
    assert.deepEqual(r.not_applied, []);
  }
  const onFinding = mr(F1, "confirmed", { packet_sha256: P_F1 });
  const r = applyReceipts(gateResult(), [onFinding], PACKETS);
  assert.deepEqual(r.mitigation_states, {});
  assert.equal(r.states[F1], "CITATION_VERIFIED");
  assert.deepEqual(r.not_applied, [{ receipt_sha256: onFinding.envelope.self_sha256, type: "mitigation-review", subject_id: F1, reason: "subject-is-finding" }]);
  // no gate-result at all (a threat-model run): mitigations still derive
  assert.deepEqual(applyReceipts(null, [mr(M1, "gap")], PACKETS).mitigation_states, { [M1]: "MITIGATION_GAP" });
});

test("a vulnerability-review receipt on a packet subject that is not a gate finding (a case packet, §9.1) derives REVIEW_* for that subject without a citation prior", () => {
  const r = applyReceipts(gateResult(), [vr(CASE, "confirmed", { packet_sha256: P_CASE })], PACKETS);
  assert.equal(r.states[CASE], "REVIEW_CONFIRMED");
  assert.equal(r.states[F1], "CITATION_VERIFIED");
  assert.deepEqual(r.not_applied, []);
  const none = applyReceipts(null, [vr(CASE, "refuted", { packet_sha256: P_CASE })], PACKETS);
  assert.deepEqual(none.states, { [CASE]: "REVIEW_REFUTED" });
});

// --- purity / determinism -------------------------------------------------------------

test("pure: inputs are never mutated (frozen inputs work); the result is deterministic and independent of input order; keys are sorted", () => {
  const g = freeze(gateResult());
  const receipts = freeze([vr(F2, "confirmed"), mr(M1, "gap"), vr(F1, "refuted"), ack(F1, IND), fr(F1, "not-refound")]);
  const packets = freeze(PACKETS.map((p) => ({ envelope: { ...p.envelope }, payload: { ...p.payload, subject_ids: [...p.payload.subject_ids] } })));
  const a = applyReceipts(g, receipts, packets);
  const b = applyReceipts(g, [...receipts].reverse(), [...packets].reverse());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(Object.keys(a.states), [...Object.keys(a.states)].sort());
  assert.deepEqual(
    a.not_applied.map((n) => n.receipt_sha256),
    [...a.not_applied.map((n) => n.receipt_sha256)].sort(),
  );
  assert.equal(JSON.stringify(g), JSON.stringify(gateResult()));
});

test("shape errors are TypeErrors: a receipt outside the four types, a malformed reviewer_run_id, a duplicate receipt identity, a bad gate-result", () => {
  assert.throws(() => applyReceipts(gateResult(), [receipt({ type: "review", subject_id: F1, packet_sha256: P_F1, assertion: "confirmed" })], PACKETS), /type/);
  assert.throws(() => applyReceipts(gateResult(), [vr(F1, "confirmed", { reviewer_run_id: "run-1" })], PACKETS), /reviewer_run_id/);
  const dup = vr(F1, "confirmed", { sha: "1a".repeat(32) });
  assert.throws(() => applyReceipts(gateResult(), [dup, { ...dup }], PACKETS), /duplicate/);
  assert.throws(() => applyReceipts({ payload: { accepted: "x" } }, [], PACKETS), /accepted/);
  assert.throws(() => applyReceipts(gateResult(), "nope", PACKETS), /receipts/);
  assert.throws(() => applyReceipts(gateResult(), [], [{ envelope: {}, payload: {} }]), /packet/);
  assert.throws(() => applyReceipts(gateResult(), [vr(F1, "maybe")], PACKETS), /assertion/);
  assert.throws(() => applyReceipts(gateResult(), [ack(F1, "not-hex")], PACKETS), /indicator_id/);
  // a finding in both accepted[] and unverifiable[] is a gate-result that cannot exist
  assert.throws(() => applyReceipts(gateResult([F1], [F1]), [], PACKETS), /both/);
});

test("runSeq: the ledger seq of a run id, the order the sticky rule reads 'a new run' by", () => {
  assert.equal(runSeq(RUN_A), 3);
  assert.equal(runSeq(RUN_B), 7);
  assert.equal(runSeq(`${"0".repeat(12)}-0000`), 0);
  assert.throws(() => runSeq("abc-1"), /run id/);
});
