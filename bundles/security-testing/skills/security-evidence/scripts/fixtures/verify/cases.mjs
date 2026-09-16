// TASK-026 — the hand-authored source of every evaluate/verify fixture: one
// case per §6.4 step 7 rule. build.mjs turns each case into
//   scripts/fixtures/evaluate/<rule>.raw.json        raw evaluate() input
//   scripts/fixtures/verify/<rule>.json              enveloped verify.json
//   scripts/fixtures/verify/packets/<sha>.json       the fix-review packet(s)
//   scripts/fixtures/verify/receipts/<sha>.json      every receipt the row lists
// computing the packet/receipt hashes so the verify payload is hash-consistent
// with the pool. Edit here, then run `node scripts/fixtures/verify/build.mjs`.
//
// Each case: {rule, verdict (documentation, asserted by the builder),
// row_status_at_start, branch, tests, deletion_only, indicators[{kind, path,
// line, content}] (id = sha256(kind\0path\0content), plan §4.2), receipts[]
// where a receipt is {fix: assertion} | {ack: <indicator index>} plus optional
// applied:false + not_applied_reason, and `other_packet: true` to make the
// receipt name a second packet of the run (it is then not applied, reason
// packet-mismatch)}. Everything else (finding id, oids, packet files, install
// record) is filled with the defaults below; a case may override `install`
// and `tested_tree`.

export const RUN_ID_PREFIX = "deadbeef0000";
export const CREATED_AT = "2026-09-16T00:00:00Z";
export const ENGAGEMENT_ID = "fixture-engagement";
export const KEY_ID = "k000000000000";
export const SCHEMA_VERSION = 1;

const PASS = { result: "TESTS_PASS", argv_sha256: "c".repeat(64), executable_path: "/usr/local/bin/npm", executable_sha256: "d".repeat(64), exit_code: 0, timed_out: false, output_redacted: "> test\n\n12 passing\n" };
const FAIL = { ...PASS, result: "TESTS_FAIL", exit_code: 1, output_redacted: "> test\n\n11 passing\n1 failing\n" };
const NO_SURFACE = { result: "NO_TEST_SURFACE", reason: "execute_project_tests absent from engagement.md", timed_out: false, output_redacted: "" };
const INDETERMINATE = { result: "TESTS_INDETERMINATE", reason: "install-modified-tree", argv_sha256: "c".repeat(64), timed_out: false, output_redacted: "" };

const NOSEC = { kind: "inline-suppress", path: "src/db.js", line: 12, content: "  const q = build(input); // nosemgrep: sql-injection" };
const SKIP = { kind: "test-skip", path: "src/db.test.js", line: 40, content: "  it.skip('rejects unparameterised input', () => {" };
const IGNORE = { kind: "ignore-file-edit", path: ".semgrepignore", line: 3, content: "src/db.js" };

export const CASES = [
  {
    rule: "refound-tests-unavailable",
    verdict: "UNVERIFIED-INDETERMINATE(tests)",
    note: "§12: a valid refound with unavailable tests is indeterminate AND records regression-observed",
    row_status_at_start: "fixed",
    branch: "COMMITTED",
    install: { ran: true, argv_sha256: "a".repeat(64), allow_tracked_changes: false, tracked_changes: ["package-lock.json"], untracked_count: 412, untracked_bytes: 18324511 },
    tests: INDETERMINATE,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "refound" }],
  },
  {
    rule: "refound-not-applied",
    verdict: "UNVERIFIED-INDETERMINATE(fix-review)",
    note: "§6.4 P5: a refound receipt that failed validation is not-applied, not an observation",
    row_status_at_start: "fixed",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "refound", applied: false, not_applied_reason: "oid-mismatch" }],
  },
  {
    rule: "two-indicators-one-ack",
    verdict: "UNVERIFIED-SUPPRESSION(1 unacked)",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [NOSEC, SKIP],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }, { ack: 0 }],
  },
  {
    rule: "deletion-only-wins",
    verdict: "UNVERIFIED-SUPPRESSION(deletion-only)",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [IGNORE],
    deletion_only: true,
    receipts: [{ fix: "not-refound" }],
  },
  {
    rule: "ack-different-indicator",
    verdict: "UNVERIFIED-SUPPRESSION(1 unacked)",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [NOSEC],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }, { ack: SKIP }],
  },
  {
    rule: "ack-different-packet",
    verdict: "UNVERIFIED-SUPPRESSION(1 unacked)",
    note: "the ack names the right indicator but another packet of the run; receipt validate left it not-applied",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [NOSEC],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }, { ack: 0, other_packet: true }],
  },
  {
    rule: "ack-tests-fail",
    verdict: "UNVERIFIED-TESTS-FAILED",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: FAIL,
    indicators: [NOSEC],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }, { ack: 0 }],
  },
  {
    rule: "missing-fix-review",
    verdict: "UNVERIFIED-INDETERMINATE(fix-review)",
    note: "pass 1 of verify all: the packet is written, no reviewer has answered yet",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [NOSEC],
    deletion_only: false,
    receipts: [{ ack: 0 }],
  },
  {
    rule: "indeterminate-fix-review",
    verdict: "UNVERIFIED-INDETERMINATE(fix-review)",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "indeterminate" }],
  },
  {
    rule: "refound-row-fixed",
    verdict: "REGRESSED",
    row_status_at_start: "fixed",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "refound" }],
  },
  {
    rule: "refound-row-open",
    verdict: "UNVERIFIED-REFOUND",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "refound" }],
  },
  {
    rule: "not-committed",
    verdict: "UNVERIFIED-NOT-COMMITTED",
    row_status_at_start: "open",
    branch: "NOT-COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }],
  },
  {
    rule: "no-test-surface",
    verdict: "UNVERIFIED-NO-TEST-SURFACE",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: NO_SURFACE,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }],
  },
  {
    rule: "verified-two-acks",
    verdict: "VERIFIED",
    row_status_at_start: "open",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [NOSEC, SKIP],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }, { ack: 0 }, { ack: 1 }],
  },
  {
    rule: "verified-no-indicators",
    verdict: "VERIFIED",
    note: "row accepted → fixed is a legal register transition (plan §4.3)",
    row_status_at_start: "accepted",
    branch: "COMMITTED",
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }],
  },
  {
    rule: "verified-tested-tree",
    verdict: "VERIFIED",
    note: "install allowed to modify tracked files: the verdict names the derived tree, not head",
    row_status_at_start: "regressed",
    branch: "COMMITTED",
    install: { ran: true, argv_sha256: "a".repeat(64), allow_tracked_changes: true, tracked_changes: ["package-lock.json"], untracked_count: 412, untracked_bytes: 18324511 },
    tested_tree: "e".repeat(64),
    tests: PASS,
    indicators: [],
    deletion_only: false,
    receipts: [{ fix: "not-refound" }],
  },
];

export const RULES = Object.freeze(CASES.map((c) => c.rule));
