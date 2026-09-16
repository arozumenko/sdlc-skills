// TASK-026 — evaluate(): the pure verdict function of spec §6.4 step 7.
// Rule cases load the raw fixtures under scripts/fixtures/evaluate/ (one per
// rule, built by scripts/fixtures/verify/build.mjs); the incompleteness cases
// that cannot be represented as a schema-valid verify.json are built inline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, incompleteCheck, CHECKS } from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "evaluate");
const SELF = readFileSync(join(HERE, "evaluate.mjs"), "utf8");

const raw = (rule) => JSON.parse(readFileSync(join(FIXTURES, `${rule}.raw.json`), "utf8"));
const REGRESSION = { event: "regression-observed", payload: {} };

// ---------------------------------------------------------------------------
// §12 / §6.4 fixtures

test("valid refound + unavailable tests ⇒ UNVERIFIED-INDETERMINATE(tests) and regression-observed event", () => {
  const r = evaluate(raw("refound-tests-unavailable"));
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(tests)");
  assert.equal(r.refound_observed, true);
  assert.deepEqual(r.events, [REGRESSION]);
});

test("refound receipt with applied:false ⇒ refound_observed false, UNVERIFIED-INDETERMINATE(fix-review), no event", () => {
  const r = evaluate(raw("refound-not-applied"));
  assert.equal(r.refound_observed, false);
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.deepEqual(r.events, []);
});

test("two indicators with one ACK ⇒ UNVERIFIED-SUPPRESSION(1 unacked)", () => {
  const r = evaluate(raw("two-indicators-one-ack"));
  assert.equal(r.verdict, "UNVERIFIED-SUPPRESSION(1 unacked)");
  assert.equal(r.ack_refs.length, 1);
});

test("indicator + deletion-only ⇒ deletion wins", () => {
  const input = raw("deletion-only-wins");
  assert.equal(input.suppression.indicators.length, 1, "fixture carries an unacked indicator too");
  assert.equal(evaluate(input).verdict, "UNVERIFIED-SUPPRESSION(deletion-only)");
});

test("ACK for a different indicator ⇒ UNVERIFIED-SUPPRESSION", () => {
  const r = evaluate(raw("ack-different-indicator"));
  assert.equal(r.verdict, "UNVERIFIED-SUPPRESSION(1 unacked)");
  assert.deepEqual(r.ack_refs, []);
});

test("ACK on a different packet does not count", () => {
  // verify.receipts[] carries no packet_sha256 (schema is closed); the packet
  // match is what `applied` encodes, set by receipt validate / verify all.
  const input = raw("ack-different-packet");
  const ack = input.receipts.find((x) => x.type === "ack");
  assert.equal(ack.applied, false);
  assert.equal(ack.indicator_id, input.suppression.indicators[0].id, "the ack names the right indicator");
  const r = evaluate(input);
  assert.equal(r.verdict, "UNVERIFIED-SUPPRESSION(1 unacked)");
  assert.deepEqual(r.ack_refs, []);
});

test("ACK + TESTS_FAIL ⇒ UNVERIFIED-TESTS-FAILED", () => {
  const r = evaluate(raw("ack-tests-fail"));
  assert.equal(r.verdict, "UNVERIFIED-TESTS-FAILED");
});

test("missing fix-review receipt ⇒ UNVERIFIED-INDETERMINATE(fix-review)", () => {
  const input = raw("missing-fix-review");
  assert.ok(!input.receipts.some((x) => x.type === "fix-review"));
  assert.equal(evaluate(input).verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
});

test("positive tests + indeterminate fix-review ⇒ UNVERIFIED-INDETERMINATE(fix-review)", () => {
  const input = raw("indeterminate-fix-review");
  assert.equal(input.tests.result, "TESTS_PASS");
  assert.equal(evaluate(input).verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
});

test("refound with complete checks ⇒ REGRESSED when row fixed else UNVERIFIED-REFOUND", () => {
  const fixed = evaluate(raw("refound-row-fixed"));
  assert.equal(fixed.verdict, "REGRESSED");
  assert.equal(fixed.refound_observed, true);
  assert.deepEqual(fixed.events, [REGRESSION]);

  const open = evaluate(raw("refound-row-open"));
  assert.equal(open.verdict, "UNVERIFIED-REFOUND");
  assert.equal(open.refound_observed, true);
  assert.deepEqual(open.events, [], "regression-observed only when the row was fixed");
});

test("branch NOT-COMMITTED ⇒ UNVERIFIED-NOT-COMMITTED", () => {
  assert.equal(evaluate(raw("not-committed")).verdict, "UNVERIFIED-NOT-COMMITTED");
  assert.equal(evaluate({ ...raw("not-committed"), branch: "PATH-UNTOUCHED" }).verdict, "UNVERIFIED-NOT-COMMITTED");
});

test("NO_TEST_SURFACE ⇒ UNVERIFIED-NO-TEST-SURFACE", () => {
  assert.equal(evaluate(raw("no-test-surface")).verdict, "UNVERIFIED-NO-TEST-SURFACE");
});

test("both indicators acked and green ⇒ VERIFIED with two ack_refs", () => {
  const input = raw("verified-two-acks");
  const r = evaluate(input);
  assert.equal(r.verdict, "VERIFIED");
  assert.equal(r.refound_observed, false);
  assert.deepEqual(r.events, []);
  const acks = input.receipts.filter((x) => x.type === "ack").map((x) => x.sha256);
  assert.deepEqual(r.ack_refs, acks);
  assert.equal(r.ack_refs.length, 2);
});

test("no indicators and green ⇒ VERIFIED with empty ack_refs", () => {
  const r = evaluate(raw("verified-no-indicators"));
  assert.equal(r.verdict, "VERIFIED");
  assert.deepEqual(r.ack_refs, []);
});

// ---------------------------------------------------------------------------
// Precedence and completeness (inline inputs)

const green = () => raw("verified-two-acks");

test("precedence: refound_observed is recorded even when a check is missing", () => {
  const input = raw("refound-row-fixed");
  delete input.branch;
  const r = evaluate(input);
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(branch)");
  assert.equal(r.refound_observed, true);
  assert.deepEqual(r.events, [REGRESSION]);
});

test("completeness names the first missing check in order branch, tests, suppression, packet", () => {
  assert.deepEqual(CHECKS, ["branch", "tests", "suppression", "packet"]);
  const cases = [
    [{ branch: undefined }, "branch"],
    [{ branch: "MERGED" }, "branch"],
    [{ tests: undefined }, "tests"],
    [{ tests: { timed_out: false, output_redacted: "" } }, "tests"],
    [{ tests: { result: "TESTS_INDETERMINATE", reason: "install-modified-tree", timed_out: false, output_redacted: "" } }, "tests"],
    [{ suppression: undefined }, "suppression"],
    [{ suppression: { indicators: "nope", deletion_only: false } }, "suppression"],
    [{ suppression: { indicators: [], deletion_only: "false" } }, "suppression"],
    [{ suppression: { indicators: [{ kind: "test-skip", path: "a", line: 1 }], deletion_only: false } }, "suppression"],
    [{ packet_sha256: undefined }, "packet"],
    [{ packet_sha256: "abc" }, "packet"],
    [{ packet_sha256: "G".repeat(64) }, "packet"],
  ];
  for (const [patch, check] of cases) {
    const input = { ...green(), ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete input[k];
    assert.equal(incompleteCheck(input), check, JSON.stringify(patch));
    assert.equal(evaluate(input).verdict, `UNVERIFIED-INDETERMINATE(${check})`, JSON.stringify(patch));
  }
  // first in order wins when several are missing
  const input = green();
  delete input.tests;
  delete input.packet_sha256;
  assert.equal(evaluate(input).verdict, "UNVERIFIED-INDETERMINATE(tests)");
  assert.equal(incompleteCheck(green()), null);
});

test("every UNVERIFIED-INDETERMINATE(<check>) token satisfies the verify schema verdict pattern", () => {
  const pattern = /^UNVERIFIED-INDETERMINATE\([a-z-]+\)$/;
  for (const check of [...CHECKS, "fix-review"]) assert.match(`UNVERIFIED-INDETERMINATE(${check})`, pattern);
});

test("fix-review precedes branch, tests and suppression", () => {
  const input = { ...raw("not-committed"), receipts: [] };
  assert.equal(evaluate(input).verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
});

test("branch precedes tests and suppression", () => {
  const input = raw("ack-tests-fail");
  input.branch = "NOT-COMMITTED";
  assert.equal(evaluate(input).verdict, "UNVERIFIED-NOT-COMMITTED");
});

test("tests precede suppression", () => {
  const input = raw("two-indicators-one-ack");
  input.tests = { ...input.tests, result: "NO_TEST_SURFACE" };
  assert.equal(evaluate(input).verdict, "UNVERIFIED-NO-TEST-SURFACE");
});

test("two applied fix-review receipts with different assertions ⇒ UNVERIFIED-INDETERMINATE(fix-review)", () => {
  const input = green();
  const fr = input.receipts.find((x) => x.type === "fix-review");
  input.receipts.push({ ...fr, sha256: "5".repeat(64), assertion: "indeterminate" });
  assert.equal(evaluate(input).verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
});

test("an applied ack that covers no indicator is not an ack_ref", () => {
  const input = raw("verified-no-indicators");
  input.receipts.push({ sha256: "7".repeat(64), type: "ack", indicator_id: "8".repeat(64), applied: true });
  const r = evaluate(input);
  assert.equal(r.verdict, "VERIFIED");
  assert.deepEqual(r.ack_refs, []);
});

test("ack_refs are recorded on every verdict (an observation, like refound_observed)", () => {
  const input = raw("verified-two-acks");
  input.tests = { ...input.tests, result: "TESTS_FAIL", exit_code: 1 };
  const r = evaluate(input);
  assert.equal(r.verdict, "UNVERIFIED-TESTS-FAILED");
  assert.equal(r.ack_refs.length, 2);
});

test("receipts that are not an array ⇒ treated as none", () => {
  const input = { ...green(), receipts: "nope" };
  const r = evaluate(input);
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.equal(r.refound_observed, false);
});

test("a stored evaluation key on the input is ignored", () => {
  const input = { ...green(), evaluation: { verdict: "REGRESSED", refound_observed: true, ack_refs: [], events: [] } };
  assert.equal(evaluate(input).verdict, "VERIFIED");
});

test("non-object input throws a TypeError", () => {
  for (const bad of [null, undefined, "x", 1, [], true]) assert.throws(() => evaluate(bad), TypeError);
});

// ---------------------------------------------------------------------------
// Purity (US-019 AC-6, G-9)

test("pure: same input twice ⇒ deep-equal output; module imports nothing from node:fs/node:child_process", () => {
  const input = raw("two-indicators-one-ack");
  const before = JSON.stringify(input);
  const a = evaluate(input);
  const b = evaluate(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before, "input not mutated");
  assert.notEqual(a, b, "a fresh object each call");
  assert.notEqual(a.events, b.events);

  const imports = [...SELF.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports, [], "evaluate.mjs is a leaf module");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!SELF.includes(banned), `evaluate.mjs must not reference ${banned}`);
  }
});

test("output shape is exactly {verdict, refound_observed, ack_refs, events}", () => {
  const r = evaluate(green());
  assert.deepEqual(Object.keys(r), ["verdict", "refound_observed", "ack_refs", "events"]);
});
