// TASK-029 — the register transition table (plan §4.3; spec §6.8, D15):
// every (event, from) pair as data, approvals always unauthenticated,
// supersession guards, the alias chain, acceptance expiry. Pure (G-9).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupAll } from "../fixtures/cli/harness.mjs";
import { FINDING, FINDING_B, FINDING_C, RUN, RUN_B, SHA256_A, readLog, readProjection, register, repoWithEngagement, seedRows } from "../fixtures/register/seed.mjs";
import { GENESIS_SHA256, eventSha256, replay, summarize } from "./register-fold.mjs";
import {
  ALIAS_KEYS,
  EMITTER_ONLY_EVENTS,
  EVENTS,
  NO_ROW,
  PRIORITIES,
  STATUSES,
  TRANSITIONS,
  TransitionError,
  aliasLinked,
  aliasSha256,
  allowedFrom,
  applyEvent,
  applyTransition,
  emptyRow,
  expiredAcceptances,
  subjectEquivalent,
  supersedeTarget,
  todayOf,
  transferExposure,
  verifyAliasChain,
} from "./register-transitions.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const SELF = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "register-transitions.mjs"), "utf8");
const EID = "eng-2026-001";
const APPROVAL = Object.freeze({ recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-12", authenticated: false });
const UNTIL = "2026-12-31";

/** One valid payload per event (the shapes of plan §4.3). */
const SAMPLE = Object.freeze({
  add: { subject: FINDING, subject_kind: "finding", title: "t", priority: "p1", owner: "", first_seen_run: RUN },
  accept: { ...APPROVAL, until: UNTIL },
  revoke: APPROVAL,
  "acceptance-expired": { until: UNTIL },
  fixed: { verify_sha256: SHA256_A, ack_refs: [], last_verified_run: RUN_B },
  regressed: { verify_sha256: SHA256_A },
  "close-false-positive": APPROVAL,
  reopen: { reason: "seen again in prod" },
  supersede: { by: "R-0002", mode: "subject-equivalent" },
  ticketed: { ticket_url: "https://github.com/acme/app/issues/17", import_sha256: SHA256_A },
  "regression-observed": { verify_sha256: SHA256_A },
  "verify-observed": { verify_sha256: SHA256_A, verdict: "UNVERIFIED-TESTS-FAILED" },
  alias: { from_id: FINDING, to_id: FINDING_B, reason: "renamed file", run_id: RUN },
});

/** A schema-valid row in the given status (with the record that status implies). */
function rowIn(status, id = "R-0001", extra = {}) {
  const row = { ...emptyRow(id), subject: FINDING, title: "t", priority: "p1", first_seen_run: RUN, status, ...extra };
  if (status === "accepted") row.acceptance = { ...APPROVAL, until: UNTIL };
  if (status === "false-positive") row.false_positive = { ...APPROVAL };
  if (status === "superseded") row.superseded_by = "R-0009";
  return row;
}

const FROMS = [NO_ROW, ...STATUSES];

// ---------------------------------------------------------------------------
// the table

test("TRANSITIONS is exactly the §4.3 table as data", () => {
  assert.deepEqual(EVENTS, ["add", "accept", "revoke", "acceptance-expired", "fixed", "regressed", "close-false-positive", "reopen", "supersede", "ticketed", "regression-observed", "verify-observed", "alias"]);
  assert.deepEqual(Object.keys(TRANSITIONS), EVENTS);
  const t = TRANSITIONS;
  assert.deepEqual(t.add, { from: [NO_ROW], to: "open", requires: ["subject", "priority", "title", "run"], emitters: ["add"] });
  assert.deepEqual(t.accept, { from: ["open", "regressed"], to: "accepted", requires: ["until", "approved-by", "approval-ref"], emitters: ["accept"] });
  assert.deepEqual(t.revoke, { from: ["accepted"], to: "open", requires: ["approved-by", "approval-ref"], emitters: ["revoke"] });
  assert.deepEqual(t["acceptance-expired"], { from: ["accepted"], to: "open", requires: [], emitters: ["check"] });
  assert.deepEqual(t.fixed, { from: ["open", "regressed", "accepted"], to: "fixed", requires: [], emitters: ["consume-verdict"] });
  assert.deepEqual(t.regressed, { from: ["fixed"], to: "regressed", requires: [], emitters: ["consume-verdict"] });
  assert.deepEqual(t["close-false-positive"], { from: ["open"], to: "false-positive", requires: ["approved-by", "approval-ref"], emitters: ["close-false-positive"] });
  assert.deepEqual(t.reopen, { from: ["false-positive"], to: "open", requires: ["reason"], emitters: ["reopen"] });
  assert.deepEqual(t.supersede, { from: ["open", "regressed", "accepted"], to: "superseded", requires: ["by"], emitters: ["supersede"] });
  assert.deepEqual(t.ticketed, { from: "any", to: "same", requires: [], emitters: ["ingest tracker-readback"] });
  assert.deepEqual(t["regression-observed"], { from: "any", to: "same", requires: [], emitters: ["consume-verdict"] });
  assert.deepEqual(t["verify-observed"], { from: "any", to: "same", requires: [], emitters: ["consume-verdict"] });
  assert.deepEqual(t.alias, { from: [], to: NO_ROW, requires: ["from", "to", "reason", "run"], emitters: ["alias"] });
  assert.ok(Object.isFrozen(TRANSITIONS));
  assert.ok(!("confirm" in TRANSITIONS), "D15: no confirm anywhere");
  assert.deepEqual(EMITTER_ONLY_EVENTS, ["acceptance-expired", "fixed", "regressed", "ticketed", "regression-observed", "verify-observed"]);
});

test("transition table — every allowed (event, from) pair succeeds and every other pair is rejected with TRANSITION-REJECTED", () => {
  let allowed = 0;
  let rejected = 0;
  for (const event of EVENTS) {
    for (const from of FROMS) {
      const row = from === NO_ROW ? undefined : rowIn(from);
      const spec = TRANSITIONS[event];
      const expectAllowed = spec.from === "any" ? from !== NO_ROW : spec.from.includes(from); // "any" = any existing row
      assert.equal(allowedFrom(event, from), expectAllowed, `${event} from ${from}`);
      if (expectAllowed) {
        allowed += 1;
        const next = applyTransition(row, event, SAMPLE[event]);
        const to = spec.to === "same" ? from : spec.to;
        assert.equal(next.status, to, `${event} from ${from} ⇒ ${to}`);
        const withId = from === NO_ROW ? { ...next, id: "R-0001" } : next; // applyEvent assigns the id of an `add`
        assert.deepEqual(validate("register", { engagement_id: EID, seq: 1, chain_sha256: SHA256_A, rows: { [withId.id]: withId } }), [], `${event} from ${from}: schema-valid row`);
        if (row !== undefined) assert.equal(row.status, from, "input row untouched");
      } else {
        rejected += 1;
        assert.throws(
          () => applyTransition(row, event, SAMPLE[event]),
          (e) => e instanceof TransitionError && e.event === event && e.from === from,
          `${event} from ${from} must be TRANSITION-REJECTED(${event}: ${from})`,
        );
      }
    }
  }
  // 5 fixed statuses + no-row = 7 froms × 13 events; the allowed set is the table's
  assert.equal(allowed + rejected, EVENTS.length * FROMS.length);
  assert.equal(allowed, 1 + 2 + 1 + 1 + 3 + 1 + 1 + 1 + 3 + 6 + 6 + 6 + 0);
  assert.throws(() => applyTransition(rowIn("open"), "confirm", {}), (e) => e instanceof TransitionError && e.event === "confirm");
});

test("ticketed on every status sets ticket_url and keeps the status", () => {
  for (const status of STATUSES) {
    const row = rowIn(status);
    const next = applyTransition(row, "ticketed", SAMPLE.ticketed);
    assert.equal(next.status, status);
    assert.equal(next.ticket_url, SAMPLE.ticketed.ticket_url);
    assert.deepEqual({ ...next, ticket_url: row.ticket_url }, row, `${status}: nothing but ticket_url changes`);
  }
  assert.throws(() => applyTransition(rowIn("open"), "ticketed", { ticket_url: "" }), TransitionError);
  assert.throws(() => applyTransition(rowIn("open"), "ticketed", { ticket_url: "https://x/1", import_sha256: "nope" }), TransitionError);
});

test("informational events change nothing; payload shapes are exact", () => {
  for (const event of ["regression-observed", "verify-observed"]) {
    for (const status of STATUSES) assert.deepEqual(applyTransition(rowIn(status), event, SAMPLE[event]), rowIn(status), `${event} on ${status}`);
    assert.throws(() => applyTransition(rowIn("open"), event, {}), TransitionError);
    assert.throws(() => applyTransition(rowIn("open"), event, { ...SAMPLE[event], extra: 1 }), TransitionError);
  }
  assert.throws(() => applyTransition(rowIn("open"), "verify-observed", { verify_sha256: SHA256_A, verdict: "CONFIRMED" }), TransitionError, "verdict is the closed vocabulary");
});

// ---------------------------------------------------------------------------
// approvals (D15, AC-3, AC-4)

test("approval record shape has authenticated:false — accept, revoke and close-false-positive refuse anything else", () => {
  const accepted = applyTransition(rowIn("open"), "accept", SAMPLE.accept);
  assert.deepEqual(accepted.acceptance, { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-12", authenticated: false, until: UNTIL });
  const fp = applyTransition(rowIn("open"), "close-false-positive", SAMPLE["close-false-positive"]);
  assert.deepEqual(fp.false_positive, APPROVAL);
  for (const event of ["accept", "revoke", "close-false-positive"]) {
    const from = event === "revoke" ? "accepted" : "open";
    const good = SAMPLE[event];
    assert.throws(() => applyTransition(rowIn(from), event, { ...good, authenticated: true }), (e) => e instanceof TransitionError && /authenticated/.test(e.message), `${event}: authenticated:true`);
    assert.throws(() => applyTransition(rowIn(from), event, { ...good, authenticated: "false" }), TransitionError);
    for (const key of ["recorded_by", "approved_by", "approval_ref", "authenticated"]) {
      const missing = { ...good };
      delete missing[key];
      assert.throws(() => applyTransition(rowIn(from), event, missing), TransitionError, `${event} without ${key}`);
    }
    assert.throws(() => applyTransition(rowIn(from), event, { ...good, approved_by: "" }), TransitionError, `${event}: empty approved_by`);
    assert.throws(() => applyTransition(rowIn(from), event, { ...good, approval_ref: "" }), TransitionError, `${event}: empty approval_ref`);
    assert.throws(() => applyTransition(rowIn(from), event, { ...good, confirmed: true }), TransitionError, `${event}: no extra keys`);
  }
  assert.throws(() => applyTransition(rowIn("open"), "accept", { ...APPROVAL }), TransitionError, "accept needs until");
  assert.throws(() => applyTransition(rowIn("open"), "accept", { ...APPROVAL, until: "31/12/2026" }), TransitionError, "until is YYYY-MM-DD");
  assert.ok(!SELF.includes("authenticated: true"), "G-8");
  assert.ok(!/confirm/i.test(SELF), "G-8: no confirm, no confirmed state");
});

test("revoke and acceptance-expired drop the acceptance; reopen drops the false-positive record and keeps the reason as rationale", () => {
  const revoked = applyTransition(rowIn("accepted"), "revoke", SAMPLE.revoke);
  assert.equal(revoked.status, "open");
  assert.ok(!("acceptance" in revoked));
  const expired = applyTransition(rowIn("accepted"), "acceptance-expired", { until: UNTIL });
  assert.equal(expired.status, "open");
  assert.ok(!("acceptance" in expired));
  assert.throws(() => applyTransition(rowIn("accepted"), "acceptance-expired", { until: "2027-01-01" }), (e) => e instanceof TransitionError && /until/.test(e.message), "the payload names the acceptance it expires");
  const reopened = applyTransition(rowIn("false-positive"), "reopen", SAMPLE.reopen);
  assert.equal(reopened.status, "open");
  assert.ok(!("false_positive" in reopened));
  assert.equal(reopened.rationale, "seen again in prod");
  assert.throws(() => applyTransition(rowIn("false-positive"), "reopen", { reason: "" }), TransitionError);
});

test("fixed records ack_refs and last_verified_run; regressed only the status", () => {
  const fixed = applyTransition(rowIn("accepted"), "fixed", { verify_sha256: SHA256_A, ack_refs: ["b".repeat(64)], last_verified_run: RUN_B });
  assert.equal(fixed.status, "fixed");
  assert.deepEqual(fixed.ack_refs, ["b".repeat(64)]);
  assert.equal(fixed.last_verified_run, RUN_B);
  assert.ok(!("acceptance" in fixed), "a verified fix ends the acceptance");
  assert.throws(() => applyTransition(rowIn("open"), "fixed", { verify_sha256: SHA256_A, ack_refs: ["x"], last_verified_run: RUN_B }), TransitionError, "ack_refs are sha256s");
  const regressed = applyTransition(fixed, "regressed", SAMPLE.regressed);
  assert.equal(regressed.status, "regressed");
  assert.deepEqual({ ...regressed, status: "fixed" }, fixed);
});

test("accepted row counts in unauthenticated bucket; open exposure unchanged", () => {
  const rows = { "R-0001": rowIn("open", "R-0001"), "R-0002": rowIn("open", "R-0002", { priority: "p0" }) };
  const before = summarize({ engagement_id: EID, seq: 2, chain_sha256: SHA256_A, rows });
  assert.deepEqual(before.open_exposure, { p0: 1, p1: 1, p2: 0, p3: 0 });
  assert.equal(before.unauthenticated_approvals, 0);

  const accepted = { ...rows, "R-0001": applyTransition(rows["R-0001"], "accept", SAMPLE.accept) };
  const after1 = summarize({ engagement_id: EID, seq: 3, chain_sha256: SHA256_A, rows: accepted });
  assert.equal(after1.unauthenticated_approvals, 1, "one bucket");
  assert.deepEqual(after1.open_exposure, before.open_exposure, "an acceptance never reduces open exposure (spec §6.8, G-8)");
  assert.deepEqual(after1.counts.accepted, { p0: 0, p1: 1, p2: 0, p3: 0 });

  const fp = { ...accepted, "R-0002": applyTransition(rows["R-0002"], "close-false-positive", SAMPLE["close-false-positive"]) };
  const after2 = summarize({ engagement_id: EID, seq: 4, chain_sha256: SHA256_A, rows: fp });
  assert.equal(after2.unauthenticated_approvals, 2);
  assert.deepEqual(after2.open_exposure, before.open_exposure, "nor does a false-positive record");

  // only a script verdict (fixed) or a supersession takes a row out of open exposure
  const fixed = { ...fp, "R-0001": applyTransition(fp["R-0001"], "fixed", SAMPLE.fixed) };
  assert.deepEqual(summarize({ engagement_id: EID, seq: 5, chain_sha256: SHA256_A, rows: fixed }).open_exposure, { p0: 1, p1: 0, p2: 0, p3: 0 });
});

// ---------------------------------------------------------------------------
// supersession (AC-5)

test("--transfer-exposure raises priority to max and sets open when source open|regressed", () => {
  const target = rowIn("fixed", "R-0002", { priority: "p2" });
  for (const status of ["open", "regressed"]) {
    const t = transferExposure(target, rowIn(status, "R-0001", { priority: "p0" }));
    assert.equal(t.priority, "p0", "max(both): p0 beats p2");
    assert.equal(t.status, "open", `source ${status} ⇒ target open`);
    assert.equal(t.id, "R-0002");
  }
  const fromAccepted = transferExposure(target, rowIn("accepted", "R-0001", { priority: "p3" }));
  assert.equal(fromAccepted.priority, "p2", "max(both): the target's own p2 stands");
  assert.equal(fromAccepted.status, "fixed", "an accepted source does not reopen the target");
  assert.equal(target.status, "fixed", "pure: input untouched");
  assert.deepEqual(PRIORITIES, ["p0", "p1", "p2", "p3"]);
  for (const [status, record] of [["accepted", "acceptance"], ["false-positive", "false_positive"]]) {
    const stale = rowIn(status, "R-0002", { priority: "p2" });
    assert.ok(record in stale, `fixture: a ${status} row carries ${record}`);
    const reopened = transferExposure(stale, rowIn("open", "R-0001", { priority: "p1" }));
    assert.equal(reopened.status, "open");
    assert.ok(!(record in reopened), `a target reopened by transfer carries no stale ${record} record`);
  }
});

test("applyEvent supersede: the target is updated first (supersedes, transfer), then the source becomes superseded — one event", () => {
  const rows = { "R-0001": rowIn("regressed", "R-0001", { priority: "p1" }), "R-0002": rowIn("accepted", "R-0002", { priority: "p3" }) };
  const ev = (payload) => ({ seq: 3, prev_sha256: SHA256_A, ts: "t", actor: "lead", row_id: "R-0001", event: "supersede", payload, ref: "R-0002" });
  const transfer = applyEvent(rows, ev({ by: "R-0002", mode: "transfer-exposure" }));
  assert.equal(transfer["R-0001"].status, "superseded");
  assert.equal(transfer["R-0001"].superseded_by, "R-0002");
  assert.equal(transfer["R-0002"].supersedes, "R-0001");
  assert.equal(transfer["R-0002"].priority, "p1");
  assert.equal(transfer["R-0002"].status, "open");
  assert.ok(!("acceptance" in transfer["R-0002"]), "a reopened target carries no stale acceptance");
  assert.equal(rows["R-0001"].status, "regressed", "pure");

  const equivalent = applyEvent(rows, ev({ by: "R-0002", mode: "subject-equivalent" }));
  assert.equal(equivalent["R-0002"].status, "accepted", "subject-equivalent changes no target status");
  assert.equal(equivalent["R-0002"].priority, "p3");
  assert.equal(equivalent["R-0002"].supersedes, "R-0001");

  assert.throws(() => applyEvent(rows, ev({ by: "R-0001", mode: "subject-equivalent" })), (e) => e instanceof TransitionError && /self/.test(e.message));
  assert.throws(() => applyEvent(rows, ev({ by: "R-0009", mode: "subject-equivalent" })), (e) => e instanceof TransitionError && /R-0009/.test(e.message));
  assert.throws(() => applyEvent(rows, ev({ by: "R-0002", mode: "merge" })), TransitionError);
  const done = { ...rows, "R-0002": rowIn("superseded", "R-0002") };
  assert.throws(() => applyEvent(done, ev({ by: "R-0002", mode: "subject-equivalent" })), (e) => e instanceof TransitionError && /superseded/.test(e.message), "a superseded target is dead");
});

test("supersede cycle rejected (supersedeTarget: self, missing, superseded/cycle)", () => {
  const a = rowIn("superseded", "R-0001");
  a.superseded_by = "R-0002";
  const b = rowIn("open", "R-0002", { supersedes: "R-0001" });
  const c = rowIn("open", "R-0003");
  const rows = { "R-0001": a, "R-0002": b, "R-0003": c };
  assert.deepEqual(supersedeTarget(rows, "R-0002", "R-0001"), { ok: false, reason: "cycle" }, "R-0001 → R-0002 → R-0001");
  assert.deepEqual(supersedeTarget(rows, "R-0002", "R-0002"), { ok: false, reason: "self" });
  assert.deepEqual(supersedeTarget(rows, "R-0002", "R-0009"), { ok: false, reason: "missing" });
  assert.deepEqual(supersedeTarget(rows, "R-0003", "R-0001"), { ok: false, reason: "superseded" }, "dead target that does not lead back");
  assert.deepEqual(supersedeTarget(rows, "R-0002", "R-0003"), { ok: true, target: c });
});

test("subjectEquivalent: same subject, or linked through the alias log (transitively, either direction); a threat subject never aliases", () => {
  const rows = {
    "R-0001": rowIn("open", "R-0001", { subject: FINDING }),
    "R-0002": rowIn("open", "R-0002", { subject: FINDING }),
    "R-0003": rowIn("open", "R-0003", { subject: FINDING_B }),
    "R-0004": rowIn("open", "R-0004", { subject: FINDING_C }),
    "R-0005": rowIn("open", "R-0005", { subject: "T-001", subject_kind: "threat" }),
  };
  assert.equal(subjectEquivalent(rows, [], "R-0001", "R-0002"), true, "same finding id");
  assert.equal(subjectEquivalent(rows, [], "R-0001", "R-0003"), false);
  const aliases = [{ from_id: FINDING_B, to_id: FINDING_C, reason: "r", run_id: RUN, seq: 1, prev_sha256: GENESIS_SHA256 }];
  assert.equal(subjectEquivalent(rows, aliases, "R-0003", "R-0004"), true);
  assert.equal(subjectEquivalent(rows, aliases, "R-0004", "R-0003"), true, "undirected");
  assert.equal(subjectEquivalent(rows, aliases, "R-0001", "R-0004"), false);
  const chained = [...aliases, { from_id: FINDING, to_id: FINDING_B, reason: "r", run_id: RUN, seq: 2, prev_sha256: SHA256_A }];
  assert.equal(subjectEquivalent(rows, chained, "R-0001", "R-0004"), true, "transitive");
  assert.equal(subjectEquivalent(rows, chained, "R-0001", "R-0005"), false);
  assert.equal(aliasLinked(chained, FINDING, FINDING_C), true);
  assert.equal(aliasLinked([], FINDING, FINDING), true, "an id is linked to itself");
});

// ---------------------------------------------------------------------------
// alias chain

test("alias lines chain like events: {from_id, to_id, reason, run_id, seq, prev_sha256}, genesis zeros, sha256 over the canonical line", () => {
  assert.deepEqual(ALIAS_KEYS, ["from_id", "to_id", "reason", "run_id", "seq", "prev_sha256"]);
  assert.deepEqual(verifyAliasChain([]), { seq: 0, chain_sha256: GENESIS_SHA256 });
  const a1 = { from_id: FINDING, to_id: FINDING_B, reason: "moved", run_id: RUN, seq: 1, prev_sha256: GENESIS_SHA256 };
  const a2 = { from_id: FINDING_B, to_id: FINDING_C, reason: "moved again", run_id: RUN_B, seq: 2, prev_sha256: aliasSha256(a1) };
  assert.deepEqual(verifyAliasChain([a1, a2]), { seq: 2, chain_sha256: aliasSha256(a2) });
  assert.deepEqual(validate("finding-alias", a1), []);
  assert.throws(() => verifyAliasChain([a1, { ...a2, prev_sha256: SHA256_A }]), /prev_sha256/);
  assert.throws(() => verifyAliasChain([a2]), /seq/);
  assert.throws(() => verifyAliasChain([{ ...a1, extra: 1 }]), /extra/);
  assert.throws(() => verifyAliasChain([{ ...a1, from_id: "nope" }]), /from_id/);
  assert.throws(() => verifyAliasChain([{ ...a1, to_id: FINDING }]), /itself/, "an id never aliases itself");
});

// ---------------------------------------------------------------------------
// expiry

test("check expires acceptance past until (UTC, exclusive)", () => {
  assert.equal(todayOf("2026-09-16T23:59:59Z"), "2026-09-16");
  assert.equal(todayOf("2026-09-16T23:30:00-02:00"), "2026-09-17", "UTC, not the offset's wall clock");
  const rows = {
    "R-0001": rowIn("accepted", "R-0001"),
    "R-0002": { ...rowIn("accepted", "R-0002"), acceptance: { ...APPROVAL, until: "2026-09-15" } },
    "R-0003": { ...rowIn("accepted", "R-0003"), acceptance: { ...APPROVAL, until: "2026-09-16" } },
    "R-0004": rowIn("open", "R-0004"),
  };
  assert.deepEqual(expiredAcceptances(rows, "2026-09-16"), [{ id: "R-0002", until: "2026-09-15" }], "until < today expires; until == today still stands; only accepted rows");
  assert.deepEqual(expiredAcceptances(rows, "2026-09-17"), [{ id: "R-0002", until: "2026-09-15" }, { id: "R-0003", until: "2026-09-16" }]);
  assert.deepEqual(expiredAcceptances(rows, "2026-01-01"), []);
  assert.throws(() => expiredAcceptances(rows, "16/09/2026"), TypeError);
});

// ---------------------------------------------------------------------------
// the fold uses the table

test("register-fold.replay folds every table event through applyEvent and validates against register.schema.json", () => {
  const mk = (seq, prev, row_id, event, payload) => ({ seq, prev_sha256: prev, ts: "2026-09-16T10:00:00Z", actor: "lead", row_id, event, payload, ref: "" });
  const events = [];
  const push = (row_id, event, payload) => {
    const e = mk(events.length + 1, events.length ? eventSha256(events[events.length - 1]) : GENESIS_SHA256, row_id, event, payload);
    events.push(e);
  };
  push("R-0001", "add", SAMPLE.add);
  push("R-0002", "add", { ...SAMPLE.add, priority: "p3" });
  push("R-0001", "accept", SAMPLE.accept);
  push("R-0001", "ticketed", SAMPLE.ticketed);
  push("R-0001", "revoke", SAMPLE.revoke);
  push("R-0001", "fixed", SAMPLE.fixed);
  push("R-0001", "regression-observed", SAMPLE["regression-observed"]);
  push("R-0001", "regressed", SAMPLE.regressed);
  push("R-0001", "supersede", { by: "R-0002", mode: "transfer-exposure" });
  const p = replay(events, EID);
  assert.deepEqual(validate("register", p), []);
  assert.equal(p.rows["R-0001"].status, "superseded");
  assert.equal(p.rows["R-0001"].ticket_url, SAMPLE.ticketed.ticket_url);
  assert.equal(p.rows["R-0002"].priority, "p1");
  assert.equal(p.rows["R-0002"].status, "open");
  assert.equal(p.rows["R-0002"].supersedes, "R-0001");

  const bad = structuredClone(events);
  bad.push(mk(10, eventSha256(bad[8]), "R-0001", "accept", SAMPLE.accept));
  assert.throws(() => replay(bad, EID), (e) => e instanceof TransitionError && e.event === "accept" && e.from === "superseded");
  const alias = structuredClone(events);
  alias.push(mk(10, eventSha256(alias[8]), "-", "alias", SAMPLE.alias));
  assert.throws(() => replay(alias, EID), (e) => e instanceof TransitionError && e.event === "alias", "alias lines live in finding-alias.jsonl, never in events.jsonl");
});

// ---------------------------------------------------------------------------
// CLI guards that belong to the table (US-021)

test("transition verb refuses emitter-only events", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p1"]]);
  for (const event of EMITTER_ONLY_EVENTS) {
    const r = await register(repo, ["transition", event, "R-0001"]);
    assert.equal(r.code, 2, event);
    assert.equal(r.stdout, `EMITTER-ONLY(${event})\n`);
  }
  assert.equal(readLog(repo).length, 1, "nothing appended");
  const unknown = await register(repo, ["transition", "confirm", "R-0001"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(transition: /);
});

test("supersede without equivalence or transfer rejected", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p1"], ["b", "p2", FINDING_B]]);
  const r = await register(repo, ["supersede", "R-0001", "--by", "R-0002"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "EQUIVALENCE-REQUIRED\n");
  const notLinked = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--subject-equivalent"]);
  assert.equal(notLinked.code, 4);
  assert.equal(notLinked.stdout, "NOT-EQUIVALENT(R-0001: R-0002)\n");
  const both = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--subject-equivalent", "--transfer-exposure"]);
  assert.equal(both.code, 2);
  assert.match(both.stdout, /^USAGE\(supersede: /);
  assert.equal(readLog(repo).length, 2, "nothing appended");
  assert.equal(readProjection(repo).rows["R-0001"].status, "open");
});

test("supersede cycle rejected (CLI): self, missing, and a target already superseded by the source", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p1"], ["b", "p2"], ["c", "p3"]]);
  const self = await register(repo, ["supersede", "R-0001", "--by", "R-0001", "--subject-equivalent"]);
  assert.equal(self.code, 2);
  assert.match(self.stdout, /^USAGE\(supersede: .*itself/);
  const missing = await register(repo, ["supersede", "R-0001", "--by", "R-0099", "--subject-equivalent"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /^USAGE\(supersede: .*R-0099/);
  const ok = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--subject-equivalent"]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const cycle = await register(repo, ["supersede", "R-0002", "--by", "R-0001", "--subject-equivalent"]);
  assert.equal(cycle.code, 2);
  assert.match(cycle.stdout, /^USAGE\(supersede: .*cycle/);
  const dead = await register(repo, ["supersede", "R-0003", "--by", "R-0001", "--subject-equivalent"]);
  assert.equal(dead.code, 2);
  assert.match(dead.stdout, /^USAGE\(supersede: .*superseded/);
  assert.equal(readLog(repo).length, 4);
});

test("--transfer-exposure (CLI): target first, then the source superseded, in one event", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p0"], ["b", "p2", FINDING_B]]);
  const r = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--transfer-exposure"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=superseded priority=p0 seq=3\nROW R-0002 status=open priority=p0 seq=3\n");
  const log = readLog(repo);
  assert.equal(log.length, 3);
  assert.deepEqual({ row_id: log[2].row_id, event: log[2].event, payload: log[2].payload, ref: log[2].ref }, { row_id: "R-0001", event: "supersede", payload: { by: "R-0002", mode: "transfer-exposure" }, ref: "R-0002" });
  const rows = readProjection(repo).rows;
  assert.equal(rows["R-0002"].supersedes, "R-0001");
  assert.equal(rows["R-0001"].superseded_by, "R-0002");
});

test("alias link satisfies --subject-equivalent and changes no status", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p1"], ["b", "p2", FINDING_B]]);
  const a = await register(repo, ["alias", "--from", FINDING, "--to", FINDING_B, "--reason", "file renamed in run 2", "--run", RUN_B]);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(a.stdout, `ALIAS from=${FINDING} to=${FINDING_B} seq=1\n`);
  const before = readProjection(repo);
  assert.equal(readLog(repo).length, 2, "an alias is not a row event");
  assert.deepEqual(readProjection(repo), before);
  for (const id of ["R-0001", "R-0002"]) assert.equal(before.rows[id].status, "open");

  const r = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--subject-equivalent"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=superseded priority=p1 seq=3\nROW R-0002 status=open priority=p2 seq=3\n");
  const rows = readProjection(repo).rows;
  assert.equal(rows["R-0002"].status, "open");
  assert.equal(rows["R-0002"].priority, "p2", "subject-equivalent transfers nothing");
  assert.equal(rows["R-0002"].supersedes, "R-0001");
});

test("check (CLI) expires every acceptance with until < today (UTC) and appends one acceptance-expired event per row", async () => {
  const repo = await seedRows(repoWithEngagement(), [["a", "p1"], ["b", "p1"], ["c", "p1"]]);
  const acceptArgs = (id, until) => ["accept", id, "--until", until, "--approved-by", "cto", "--approval-ref", "RISK-1"];
  for (const [id, until] of [["R-0001", "2026-09-15"], ["R-0002", "2026-09-16"], ["R-0003", "2027-01-01"]]) {
    const r = await register(repo, acceptArgs(id, until));
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
  const r = await register(repo, ["check"], { SECURITY_EVIDENCE_NOW: "2026-09-16T00:00:00Z" });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=open priority=p1 seq=7\nCHECK expired=1\n");
  const log = readLog(repo);
  assert.deepEqual({ event: log[6].event, row_id: log[6].row_id, payload: log[6].payload, ref: log[6].ref }, { event: "acceptance-expired", row_id: "R-0001", payload: { until: "2026-09-15" }, ref: "2026-09-15" }, "ref is the lapsed until, not today (the event's ts says when)");
  const rows = readProjection(repo).rows;
  assert.equal(rows["R-0001"].status, "open");
  assert.ok(!("acceptance" in rows["R-0001"]));
  assert.equal(rows["R-0002"].status, "accepted", "until == today still stands");
  assert.equal(rows["R-0003"].status, "accepted");

  const again = await register(repo, ["check"], { SECURITY_EVIDENCE_NOW: "2026-09-17T00:00:00Z" });
  assert.equal(again.stdout, "ROW R-0002 status=open priority=p1 seq=8\nCHECK expired=1\n");
  const none = await register(repo, ["check"], { SECURITY_EVIDENCE_NOW: "2026-09-17T00:00:00Z" });
  assert.equal(none.stdout, "CHECK expired=0\n");
  assert.equal(readLog(repo).length, 8);
});

// ---------------------------------------------------------------------------
// purity (G-9)

test("pure: register-transitions.mjs imports no fs, child process, git or clock", () => {
  const imports = [...SELF.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../canon.mjs", "./tokens.mjs"]);
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!SELF.includes(banned), `register-transitions.mjs must not reference ${banned}`);
  }
});
