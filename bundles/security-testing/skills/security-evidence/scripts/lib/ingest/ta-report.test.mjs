// TASK-018 — lib/ingest/ta-report.mjs: `ingest ta-report` over a
// test-automation `.agents/automation/<slug>/report.json` (spec §6.6 row
// `ta-report`; §9.3 — `delivered` without a gate receipt in the report ⇒
// `delivered-unwitnessed`). US-012 AC-4, US-037 AC-3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStrict } from "../../canon.mjs";
import { redactDeep } from "../../redact.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { CATEGORIES, DELIVERED_UNWITNESSED, FINDING_KINDS, MAPPING_VERSION, OUTCOMES, adapt } from "./ta-report.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: ".agents/automation/security-my-product-admitted/report.json" };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const ctx = { engagement: () => ({ targets: { tracker: ["github.com"], browser: ["staging.example.com"], repo: "x/y" } }) };
const FIXTURE = readFileSync(new URL("../../fixtures/ta/report.json", import.meta.url));
/** What the adapter receives for a JSON kind: the strictly parsed, redacted value (lib/imports.mjs). */
const report = () => redactDeep(parseStrict(FIXTURE));

/** The playbook's rebuilt-report example (orchestration-playbook.md § Interruption and resumption), verbatim. */
const REBUILT = {
  batch: "<slug>",
  base: "main",
  cases: [
    { id: "TC-1", outcome: "delivered", branch: "tests/TC-1-modal", pr: 41, coverage: { full: true, excluded: [] }, note: "merged to base", findings: [] },
    { id: "TC-2", outcome: "blocked", note: "dedup unverifiable", findings: [{ kind: "note", note: "covered-elsewhere cited login.spec.ts:42; no such file on base", ref: null }] },
  ],
  totals: { delivered: 1, blocked: 1 },
  remainder: ["TC-2"],
  recovery: { rebuilt_from: ["receipts", "git"], note: "no gate receipt — proof is the merge; PR state unconfirmed (no host CLI)" },
};

test("the shipped fixture (workflow-written, gate green) ⇒ a report record then one unit per case: outcome, coverage + exclusions, findings[] structure and test paths trusted; notes inert", () => {
  const out = adapt(ctx, run, null, report(), base);
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.equal(MAPPING_VERSION, "v1");
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 4);
  const [head, u1, u2, u3] = out.records;
  assert.deepEqual(head.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(head.trusted, {
    record: "report",
    batch: "security-my-product-admitted",
    base: "main",
    gate_verdict: "green",
    gate_runs: 3,
    recovery_basis: null,
    test_paths: ["tests/security/session-cookie.spec.ts"],
    units: 3,
  });
  assert.deepEqual(head.inert, {});

  assert.deepEqual(u1.locator, { import_sha256: SHA, original_hmac: HMAC, index: 1 });
  assert.deepEqual(u1.trusted, {
    record: "unit",
    case_id: "TC-SEC-001",
    outcome: "delivered",
    outcome_reported: "delivered",
    gate_witnessed: true,
    coverage: { full: true, excluded: [] },
    findings: [],
  });
  assert.deepEqual(Object.keys(u1.inert).sort(), ["branch", "note"]);
  assert.match(u1.inert.note, /^\[UNTRUSTED CONTENT/);

  assert.deepEqual(u2.trusted, {
    record: "unit",
    case_id: "TC-SEC-002",
    outcome: "delivered",
    outcome_reported: "delivered",
    gate_witnessed: true,
    coverage: { full: false, excluded: [{ step: "TC-SEC-002/3", category: "blocked-by-defect", referent: "SEC-DEF-17" }] },
    findings: [{ kind: "defect", ref: "SEC-DEF-17" }],
  });
  assert.deepEqual(Object.keys(u2.inert).sort(), ["branch", "exclusion_notes", "findings", "note"]);
  assert.ok(u2.inert.findings.includes("session cookie is issued without HttpOnly"), "finding text is quoted, never acted on");

  assert.deepEqual(u3.trusted, {
    record: "unit",
    case_id: "TC-SEC-003",
    outcome: "blocked",
    outcome_reported: "blocked",
    gate_witnessed: false,
    coverage: null,
    findings: [{ kind: "note", ref: null }],
  });
  assert.deepEqual(Object.keys(u3.inert).sort(), ["findings", "note"]);
  const payload = { kind: "ta-report", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("delivered without a gate receipt in the report ⇒ delivered-unwitnessed; recovery_basis recorded when present (US-037 AC-3)", () => {
  const out = adapt(ctx, run, null, structuredClone(REBUILT), base);
  const [head, u1, u2] = out.records;
  assert.equal(head.trusted.gate_verdict, null);
  assert.equal(head.trusted.gate_runs, null);
  assert.deepEqual(head.trusted.recovery_basis, ["receipts", "git"]);
  assert.deepEqual(Object.keys(head.inert), ["recovery_note"]);
  assert.ok(head.inert.recovery_note.includes("proof is the merge"));
  assert.equal(u1.trusted.outcome, DELIVERED_UNWITNESSED);
  assert.equal(u1.trusted.outcome_reported, "delivered");
  assert.equal(u1.trusted.gate_witnessed, false);
  assert.equal(u2.trusted.outcome, "blocked");

  // a per-case gate record witnesses that case even when the report's gate block is absent
  const perCase = structuredClone(REBUILT);
  perCase.cases[0].gate = { runs: 3, seconds: [1, 2, 3] };
  assert.equal(adapt(ctx, run, null, perCase, base).records[1].trusted.outcome, "delivered");
  // a report-level gate that is not green witnesses nothing
  const red = report();
  red.gate.verdict = "incomplete";
  delete red.cases[0].gate;
  const r = adapt(ctx, run, null, red, base);
  assert.equal(r.records[1].trusted.outcome, DELIVERED_UNWITNESSED);
  assert.equal(r.records[2].trusted.outcome, "delivered", "its own gate record still stands");
  // zero runs is not a witness either
  const zero = report();
  zero.gate.runs = 0;
  zero.cases[0].gate.runs = 0;
  assert.equal(adapt(ctx, run, null, zero, base).records[1].trusted.outcome, DELIVERED_UNWITNESSED);
});

test("units the format cannot vouch for are rejected, never dropped or promoted: an unknown outcome, a non-case id, a non-object row; malformed coverage / findings / exclusions degrade to null or are counted, never trusted", () => {
  const r = report();
  r.cases[0].outcome = "shipped";
  r.cases[1].id = "../etc";
  r.cases.push("not a row");
  r.cases[2].coverage = { full: "yes" };
  r.cases[2].findings = [{ kind: "rumour", note: "x", ref: "T-1" }, "junk", { kind: "note", note: "ok", ref: 7 }];
  const out = adapt(ctx, run, null, r, base);
  assert.deepEqual(out.records.map((x) => x.locator.index), [0, 3]);
  assert.deepEqual(out.rejected, [
    { reason: "unknown-outcome", locator: { import_sha256: SHA, index: 1 } },
    { reason: "bad-case-id", locator: { import_sha256: SHA, index: 2 } },
    { reason: "bad-unit", locator: { import_sha256: SHA, index: 4 } },
  ]);
  assert.equal(out.records[0].trusted.units, 4);
  const u3 = out.records[1].trusted;
  assert.equal(u3.coverage, null, "a coverage block that is not {full: bool, excluded: []} is not trusted");
  assert.deepEqual(u3.findings, [{ kind: "note", ref: null }], "only well-formed findings enter the structure; a bad kind / ref / row is dropped from trusted but stays quoted");
  assert.equal(u3.findings_dropped, 2);
  assert.ok(out.records[1].inert.findings.includes("rumour"));

  const ex = report();
  ex.cases[1].coverage.excluded.push({ step: "TC-SEC-002/4", category: "because", referent: "meh" }, { step: 4 }, { step: "TC-SEC-002/5", category: "covered-elsewhere", referent: "has spaces in it" });
  const o2 = adapt(ctx, run, null, ex, base);
  const cov = o2.records[2].trusted.coverage;
  assert.deepEqual(cov.excluded, [{ step: "TC-SEC-002/3", category: "blocked-by-defect", referent: "SEC-DEF-17" }, { step: "TC-SEC-002/5", category: "covered-elsewhere", referent: null }]);
  assert.equal(cov.excluded_dropped, 2);
  assert.ok(o2.records[2].inert.exclusion_notes.includes("has spaces in it"), "an unusable referent is quoted, not referenced");
});

test("test paths: only repo-relative posix paths from expected_red[].spec and gate.failures[].spec are referenced; anything else is quoted", () => {
  const r = report();
  r.gate.failures = [{ spec: "tests/security/headers.spec.ts", signature: "expected CSP header" }, { spec: "/abs/path.spec.ts", signature: "x" }, { spec: "../up.spec.ts" }];
  r.expected_red.push({ spec: "C:\\win\\x.spec.ts", ticket: "T" });
  const out = adapt(ctx, run, null, r, base);
  assert.deepEqual(out.records[0].trusted.test_paths, ["tests/security/headers.spec.ts", "tests/security/session-cookie.spec.ts"]);
  assert.ok(out.records[0].inert.untrusted_paths.includes("/abs/path.spec.ts"));
  assert.ok(out.records[0].inert.gate_failures.includes("expected CSP header"));
});

test("structural failures ⇒ 2 SCHEMA-INVALID(ta-report: …): not an object, no cases array, a gate block that is not an object; a non-object input is a caller bug", () => {
  const bad = (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(ta-report: /.test(e.token);
  assert.throws(() => adapt(ctx, run, null, [], base), bad);
  assert.throws(() => adapt(ctx, run, null, { batch: "x" }, base), bad);
  assert.throws(() => adapt(ctx, run, null, { cases: {} }, base), bad);
  assert.throws(() => adapt(ctx, run, null, { cases: [], gate: "green" }, base), bad);
  assert.throws(() => adapt(ctx, run, null, "text", base), TypeError);
});

test("closed vocabularies are the owning bundle's (orchestration-playbook § Outcomes, coverage-contract categories, finding kinds)", () => {
  assert.deepEqual(OUTCOMES, ["delivered", "defect-found", "blocked", "un-automatable", "needs-execution", "not-started", "infra-stalled", "built", "reviewed", "merged-ungated"]);
  assert.deepEqual(CATEGORIES, ["covered-elsewhere", "blocked-by-defect", "un-automatable", "by-seeded-policy"]);
  assert.deepEqual(FINDING_KINDS, ["defect", "clarification", "question", "note"]);
  assert.equal(DELIVERED_UNWITNESSED, "delivered-unwitnessed");
});

test("ta-report.mjs is a leaf: no fs, no child process, no git, no network (G-6, G-14)", () => {
  const src = readFileSync(new URL("./ta-report.mjs", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:http", "node:net", "node:dns", "git.mjs", "fetch("]) assert.ok(!src.includes(forbidden), forbidden);
});
