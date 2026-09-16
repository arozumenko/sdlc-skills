// lib/evaluate.mjs — the verdict function of `verify.mjs` (TASK-026, US-019;
// spec §6.4 step 7, plan §3.3 row `evaluate.mjs`).
//
//   evaluate(raw) → {verdict, refound_observed, ack_refs, events}
//
// `raw` is a `verify` payload minus `evaluation` (TASK-005): the raw results
// `verify all` recorded — branch, tests, suppression, the fix-review packet
// hash, the admitted receipts with their `applied` flags, and the register
// row's status when the run started. `verify all` calls this once and stores
// the result as `evaluation`; `check` and `consume-verdict` re-run it and
// refuse an artifact whose stored evaluation differs. So this module is pure
// (G-9): no imports at all, no clock, no fs, no child process, no
// randomness; the same input always yields a deep-equal output and the input
// is never mutated.
//
// Precedence (spec §6.4 step 7, plan TASK-026), in this exact order:
//
//   1. refound_observed = an applied fix-review receipt asserts `refound`.
//      If observed and the row was `fixed`, the `regression-observed` event
//      is emitted before anything else and regardless of every other check.
//   2. completeness: branch, tests, suppression, packet — the first check
//      missing or malformed names the verdict, UNVERIFIED-INDETERMINATE(<check>);
//      tests.result TESTS_INDETERMINATE counts as tests unavailable.
//   3. refound_observed ⇒ REGRESSED (row was fixed) | UNVERIFIED-REFOUND.
//   4. no applied fix-review, or any applied fix-review not asserting
//      `not-refound` (indeterminate, or two applied receipts disagreeing)
//      ⇒ UNVERIFIED-INDETERMINATE(fix-review). VERIFIED needs an applied
//      not-refound.
//   5. branch ≠ COMMITTED ⇒ UNVERIFIED-NOT-COMMITTED.
//   6. TESTS_FAIL ⇒ UNVERIFIED-TESTS-FAILED; NO_TEST_SURFACE ⇒
//      UNVERIFIED-NO-TEST-SURFACE.
//   7. deletion_only ⇒ UNVERIFIED-SUPPRESSION(deletion-only) — never waivable.
//   8. any indicator without a covering ack ⇒ UNVERIFIED-SUPPRESSION(<n> unacked).
//   9. VERIFIED.
//
// Ack matching: an ack covers an indicator when it is `type: ack`, `applied`
// and its `indicator_id` equals the indicator's `id`. The spec also requires
// the ack's `packet_sha256` to be the fix-review packet; `verify.receipts[]`
// carries no packet hash (closed schema), because `receipt validate` already
// checked it — `applied: true` is that statement, and a receipt on another
// packet arrives here as `applied: false` with a `not_applied_reason`.
//
// `ack_refs` lists the sha256 of every applied ack that covers some indicator,
// in receipt order — an observation recorded on every verdict, the same way
// `refound_observed` is; the register only consumes it on VERIFIED.
//
// Check names must match the verify schema's verdict pattern
// `UNVERIFIED-INDETERMINATE\([a-z-]+\)`, which is why the packet_sha256 check
// is spelled `packet`.

/** Completeness checks in precedence order; the first failing one names the verdict. */
export const CHECKS = Object.freeze(["branch", "tests", "suppression", "packet"]);

const BRANCHES = new Set(["COMMITTED", "NOT-COMMITTED", "PATH-UNTOUCHED"]);
const TEST_RESULTS = new Set(["TESTS_PASS", "TESTS_FAIL", "NO_TEST_SURFACE", "TESTS_INDETERMINATE"]);
const HEX64 = /^[0-9a-f]{64}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Name the first missing or malformed check of `raw`, or null when every
 * check is present and usable. Exported so the CLI and tests can name the
 * check without re-running the verdict.
 * @param {object} raw
 * @returns {"branch" | "tests" | "suppression" | "packet" | null}
 */
export function incompleteCheck(raw) {
  if (!BRANCHES.has(raw.branch)) return "branch";
  if (!isObject(raw.tests) || !TEST_RESULTS.has(raw.tests.result) || raw.tests.result === "TESTS_INDETERMINATE") return "tests";
  const s = raw.suppression;
  if (
    !isObject(s) ||
    typeof s.deletion_only !== "boolean" ||
    !Array.isArray(s.indicators) ||
    !s.indicators.every((i) => isObject(i) && typeof i.id === "string" && HEX64.test(i.id))
  ) {
    return "suppression";
  }
  if (typeof raw.packet_sha256 !== "string" || !HEX64.test(raw.packet_sha256)) return "packet";
  return null;
}

/**
 * Evaluate the raw results of a verify run into a verdict.
 * @param {object} raw `verify` payload minus `evaluation`; extra keys (an `evaluation`) are ignored
 * @returns {{verdict: string, refound_observed: boolean, ack_refs: string[], events: {event: "regression-observed", payload: {}}[]}}
 * @throws {TypeError} when raw is not a plain object
 */
export function evaluate(raw) {
  if (!isObject(raw)) throw new TypeError("evaluate expects the raw verify payload as an object");
  const receipts = Array.isArray(raw.receipts) ? raw.receipts.filter(isObject) : [];
  const applied = receipts.filter((r) => r.applied === true);
  const fixReviews = applied.filter((r) => r.type === "fix-review");
  const acks = applied.filter((r) => r.type === "ack");

  // 1. refound is observed first and unconditionally.
  const refound_observed = fixReviews.some((r) => r.assertion === "refound");
  const events = [];
  if (refound_observed && raw.row_status_at_start === "fixed") events.push({ event: "regression-observed", payload: {} });

  const indicators = isObject(raw.suppression) && Array.isArray(raw.suppression.indicators) ? raw.suppression.indicators.filter(isObject) : [];
  const indicatorIds = new Set(indicators.map((i) => i.id));
  const ack_refs = [];
  for (const ack of acks) {
    if (indicatorIds.has(ack.indicator_id) && !ack_refs.includes(ack.sha256)) ack_refs.push(ack.sha256);
  }

  const result = (verdict) => ({ verdict, refound_observed, ack_refs, events });

  // 2. completeness.
  const missing = incompleteCheck(raw);
  if (missing !== null) return result(`UNVERIFIED-INDETERMINATE(${missing})`);

  // 3. refound.
  if (refound_observed) return result(raw.row_status_at_start === "fixed" ? "REGRESSED" : "UNVERIFIED-REFOUND");

  // 4. an applied not-refound is required, and nothing applied may disagree.
  if (fixReviews.length === 0 || !fixReviews.every((r) => r.assertion === "not-refound")) {
    return result("UNVERIFIED-INDETERMINATE(fix-review)");
  }

  // 5. branch.
  if (raw.branch !== "COMMITTED") return result("UNVERIFIED-NOT-COMMITTED");

  // 6. tests.
  if (raw.tests.result === "TESTS_FAIL") return result("UNVERIFIED-TESTS-FAILED");
  if (raw.tests.result === "NO_TEST_SURFACE") return result("UNVERIFIED-NO-TEST-SURFACE");

  // 7. deletion-only is never waivable.
  if (raw.suppression.deletion_only === true) return result("UNVERIFIED-SUPPRESSION(deletion-only)");

  // 8. every indicator needs a covering ack.
  const acked = new Set(acks.map((a) => a.indicator_id));
  const unacked = indicators.filter((i) => !acked.has(i.id)).length;
  if (unacked > 0) return result(`UNVERIFIED-SUPPRESSION(${unacked} unacked)`);

  // 9.
  return result("VERIFIED");
}
