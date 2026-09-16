// TASK-018 — lib/ingest/case.mjs: `ingest case` over a manual-qa test case
// (spec §6.6 row `case`: structural validation = the TC frontmatter; trusted
// = ids and `requirements`; inert = steps). US-012 AC-1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redactString } from "../../redact.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { CASE_ID, MAPPING_VERSION, adapt, parseTestCase } from "./case.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: "tasks/security-my-product-admitted/TC-SEC-001.md" };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const ctx = { engagement: () => ({ targets: { tracker: [], browser: [], repo: "x/y" } }) };
const FIXTURE = readFileSync(new URL("../../fixtures/qa/TC-SEC-001.md", import.meta.url), "utf8");
/** What the adapter actually receives: the dispatcher redacts the text first (lib/imports.mjs). */
const redacted = redactString(FIXTURE).text;

test("the shipped manual-qa fixture ⇒ one record: ids and requirements trusted, steps inert (wrapped, redacted); mapping_version v1", () => {
  const out = adapt(ctx, run, null, redacted, base);
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.equal(MAPPING_VERSION, "v1");
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(r.trusted, { id: "TC-SEC-001", requirements: ["SEC-REQ-004", "SEC-REQ-011"] }, "exactly the §6.6 trusted column: ids and requirements");
  assert.deepEqual(Object.keys(r.inert).sort(), ["body", "steps", "title"]);
  for (const v of Object.values(r.inert)) assert.match(v, /^\[UNTRUSTED CONTENT/, "every inert value is wrapped");
  assert.ok(r.inert.steps.includes("Navigate to `{{base_url}}/login`"), "the steps are quoted, never acted on");
  assert.ok(!r.inert.steps.includes("| # | Action"), "steps = the table's data rows, not its header");
  assert.ok(FIXTURE.includes("password=`Test1234!`"), "the fixture carries a password assignment so the redaction path is exercised");
  assert.ok(!r.inert.body.includes("password=`Test1234!`") && r.inert.body.includes("<REDACTED:password-assign>"), "the assignment form is redacted (the bare table cell is outside the rule list — spec §2, bounded guarantee)");
  const payload = { kind: "case", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("parseTestCase: the format's keys; external_id trusted as an id when present; requirements absent ⇒ []", () => {
  const tc = parseTestCase(FIXTURE);
  assert.equal(tc.id, "TC-SEC-001");
  assert.equal(tc.title, "Verify security headers on the login page");
  assert.equal(tc.priority, "high");
  assert.equal(tc.type, "regression");
  assert.equal(tc.module, "authentication");
  assert.equal(tc.size, "S");
  assert.deepEqual(tc.requirements, ["SEC-REQ-004", "SEC-REQ-011"]);
  assert.deepEqual(tc.tags, ["security", "passive", "headers"]);
  assert.equal(tc.external_id, null);
  assert.equal(tc.steps.split("\n").length, 5, "one line per step row");

  const withExternal = "---\nid: TC-001\ntitle: Login\npriority: critical\ntype: smoke\nmodule: auth\nexternal_id: JIRA-4821\n---\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | Go | Page |\n";
  const out = adapt(ctx, run, null, withExternal, base);
  assert.deepEqual(out.records[0].trusted, { id: "TC-001", external_id: "JIRA-4821", requirements: [] });
});

test("structural failures are the adapter's own exit-2 result: no frontmatter, no id, an id that is not a TC id, requirements not a list of ids", () => {
  const schemaInvalid = (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(case: /.test(e.token);
  assert.throws(() => adapt(ctx, run, null, "# Just a heading\n\n## Steps\n", base), schemaInvalid);
  assert.throws(() => adapt(ctx, run, null, "---\ntitle: no id\n---\n", base), schemaInvalid);
  assert.throws(() => adapt(ctx, run, null, "---\nid: ../../etc/passwd\ntitle: x\n---\n", base), schemaInvalid);
  assert.throws(() => adapt(ctx, run, null, "---\nid: TC-001\nrequirements: [REQ 1 with spaces]\n---\n", base), schemaInvalid);
  assert.throws(() => adapt(ctx, run, null, "---\nid: TC-001\nid: TC-002\n---\n", base), schemaInvalid, "a duplicate id is ambiguous, never last-wins");
  assert.ok(CASE_ID.test("TC-001") && CASE_ID.test("TC-SEC-001") && !CASE_ID.test("tc-001") && !CASE_ID.test("TC-") && !CASE_ID.test("TC-001 x"));
});

test("a non-string input is a caller bug, not a result", () => {
  assert.throws(() => adapt(ctx, run, null, { not: "text" }, base), TypeError);
});

test("case.mjs is a leaf: no fs, no child process, no git, no network (G-6, G-14)", () => {
  const src = readFileSync(new URL("./case.mjs", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:http", "node:net", "node:dns", "git.mjs", "fetch("]) assert.ok(!src.includes(forbidden), forbidden);
});
