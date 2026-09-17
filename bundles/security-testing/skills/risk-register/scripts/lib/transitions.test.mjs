import { test } from "node:test";
import assert from "node:assert/strict";

import { APPROVAL_KEYS, LIVE_STATUSES, NO_ROW, PRIORITIES, STATUSES, TRANSITIONS, TransitionError, applyTransition, isCalendarDay } from "./transitions.mjs";

const FINDING = "a".repeat(64);
const approval = (extra = {}) => ({ recorded_by: "lead", approved_by: "CISO", approval_ref: "JIRA-1", authenticated: false, ...extra });

/** A valid payload per event. */
const PAYLOADS = {
  add: { finding_id: FINDING, title: "Hard-coded credential", priority: "p2", owner: "" },
  accept: approval({ until: "2026-01-01" }),
  revoke: approval(),
  "acceptance-expired": { until: "2026-01-01" },
  fixed: { verify: ".agents/security-testing/verify/aaaaaaaa-deadbee/verify.json", verdict: "VERIFIED", head: "deadbeef" },
  regressed: { verify: ".agents/security-testing/verify/aaaaaaaa-deadbee/verify.json", verdict: "UNVERIFIED-REFOUND", head: "deadbeef" },
  "close-false-positive": approval(),
  reopen: { reason: "refound in prod" },
  supersede: { by: "R-0002" },
  ticket: { ticket_url: "https://tracker/1" },
};

/** A row in the given status. */
const rowIn = (status) => {
  const row = applyTransition(undefined, "add", PAYLOADS.add);
  row.id = "R-0001";
  row.status = status;
  if (status === "accepted") row.accepted_until = "2026-01-01";
  return row;
};

test("the closed vocabularies", () => {
  assert.deepEqual([...STATUSES], ["open", "fixed", "regressed", "accepted", "false-positive", "superseded"]);
  assert.deepEqual([...PRIORITIES], ["p0", "p1", "p2", "p3"]);
  assert.deepEqual([...APPROVAL_KEYS], ["recorded_by", "approved_by", "approval_ref", "authenticated"]);
  assert.deepEqual([...LIVE_STATUSES], ["open", "fixed", "regressed", "accepted"]);
  assert.deepEqual(Object.keys(TRANSITIONS), ["add", "accept", "revoke", "acceptance-expired", "fixed", "regressed", "close-false-positive", "reopen", "supersede", "ticket"]);
});

test("every (event, from) pair in the table applies and lands on the table's `to`", () => {
  for (const [event, spec] of Object.entries(TRANSITIONS)) {
    for (const from of spec.from) {
      const row = from === NO_ROW ? undefined : rowIn(from);
      const next = applyTransition(row, event, PAYLOADS[event]);
      const want = spec.to === "same" ? from : spec.to;
      assert.equal(next.status, want, `${event} from ${from}`);
      if (row !== undefined) assert.notEqual(next, row, "applyTransition returns a new row");
    }
  }
});

test("every (event, from) pair NOT in the table throws `<event> not allowed from <status>`", () => {
  for (const [event, spec] of Object.entries(TRANSITIONS)) {
    for (const from of [NO_ROW, ...STATUSES]) {
      if (spec.from.includes(from)) continue;
      const row = from === NO_ROW ? undefined : rowIn(from);
      assert.throws(() => applyTransition(row, event, PAYLOADS[event]), (e) => e instanceof TransitionError && e.message === `${event} not allowed from ${from}`, `${event} from ${from}`);
    }
  }
  assert.throws(() => applyTransition(undefined, "confirm", {}), (e) => e instanceof TransitionError && e.message === "confirm not allowed from -");
});

test("add builds the full row shape", () => {
  const row = applyTransition(undefined, "add", PAYLOADS.add);
  assert.deepEqual(row, { id: "", finding_id: FINDING, title: "Hard-coded credential", priority: "p2", status: "open", owner: "", ticket_url: "", accepted_until: "", approvals: [], superseded_by: "" });
  assert.throws(() => applyTransition(undefined, "add", { ...PAYLOADS.add, priority: "p9" }), /priority/);
  assert.throws(() => applyTransition(undefined, "add", { ...PAYLOADS.add, finding_id: "abc" }), /finding_id/);
  assert.throws(() => applyTransition(undefined, "add", { ...PAYLOADS.add, title: "" }), /title/);
});

test("accept requires a calendar day and an approval whose authenticated === false", () => {
  const open = rowIn("open");
  const accepted = applyTransition(open, "accept", PAYLOADS.accept);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.accepted_until, "2026-01-01");
  assert.deepEqual(accepted.approvals, [{ event: "accept", ...PAYLOADS.accept }]);
  assert.throws(() => applyTransition(open, "accept", approval({ until: "2026-02-30" })), /until/);
  assert.throws(() => applyTransition(open, "accept", approval({})), /until/);
  assert.throws(() => applyTransition(open, "accept", approval({ until: "2026-01-01", authenticated: true })), (e) => e instanceof TransitionError && e.message === "approvals are never authenticated");
  assert.throws(() => applyTransition(open, "accept", approval({ until: "2026-01-01", authenticated: undefined })), /authenticated/);
  assert.throws(() => applyTransition(open, "accept", approval({ until: "2026-01-01", approved_by: "" })), /approved_by/);
  assert.throws(() => applyTransition(accepted, "revoke", { ...approval(), authenticated: true }), /never authenticated/);
  assert.throws(() => applyTransition(open, "close-false-positive", { ...approval(), authenticated: "no" }), /never authenticated/);
});

test("leaving accepted clears accepted_until; approvals accumulate", () => {
  const accepted = applyTransition(rowIn("open"), "accept", PAYLOADS.accept);
  for (const event of ["revoke", "acceptance-expired", "fixed"]) {
    const next = applyTransition(accepted, event, PAYLOADS[event]);
    assert.equal(next.accepted_until, "", event);
  }
  const revoked = applyTransition(accepted, "revoke", PAYLOADS.revoke);
  assert.equal(revoked.approvals.length, 2);
  assert.equal(revoked.approvals[1].event, "revoke");
  const fp = applyTransition(revoked, "close-false-positive", PAYLOADS["close-false-positive"]);
  assert.equal(fp.approvals.length, 3);
  assert.equal(fp.approvals[2].authenticated, false);
});

test("supersede sets superseded_by; ticket sets ticket_url and keeps the status", () => {
  const sup = applyTransition(rowIn("fixed"), "supersede", { by: "R-0002" });
  assert.equal(sup.status, "superseded");
  assert.equal(sup.superseded_by, "R-0002");
  assert.throws(() => applyTransition(rowIn("open"), "supersede", { by: "R-1" }), /by/);
  const t = applyTransition(rowIn("accepted"), "ticket", { ticket_url: "https://x/1" });
  assert.equal(t.status, "accepted");
  assert.equal(t.ticket_url, "https://x/1");
  assert.throws(() => applyTransition(rowIn("open"), "ticket", { ticket_url: "" }), /ticket_url/);
  assert.throws(() => applyTransition(rowIn("fixed"), "reopen", { reason: "" }), /reason/);
  assert.throws(() => applyTransition(rowIn("open"), "fixed", { verdict: "VERIFIED", head: "x" }), /verify/);
});

test("payloads take exactly the keys the event sets", () => {
  assert.throws(() => applyTransition(rowIn("open"), "ticket", { ticket_url: "https://x/1", extra: 1 }), /extra/);
  assert.throws(() => applyTransition(rowIn("open"), "accept", "nope"), /object/);
});

test("isCalendarDay", () => {
  assert.ok(isCalendarDay("2024-02-29"));
  assert.ok(!isCalendarDay("2023-02-29"));
  assert.ok(!isCalendarDay("2026-13-01"));
  assert.ok(!isCalendarDay("2026-1-1"));
  assert.ok(!isCalendarDay(20260101));
});
