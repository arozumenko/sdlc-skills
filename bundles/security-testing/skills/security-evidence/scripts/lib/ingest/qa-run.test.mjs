// TASK-018 — lib/ingest/qa-run.mjs: `ingest qa-run` over a manual-qa run
// report in its real Markdown format (spec §6.6 row `qa-run`; §9.2 — the
// records become observations in TASK-044). US-012 AC-3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redactString } from "../../redact.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_VERSION, RUN_ID, STATUSES, adapt, parseRunReport } from "./qa-run.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: "reports/RUN-2026-09-15-001.md" };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const ctxWith = (browser) => ({ engagement: () => ({ targets: { tracker: ["github.com"], browser, repo: "x/y" } }) });
const FIXTURE = readFileSync(new URL("../../fixtures/qa/RUN-2026-09-15-001.md", import.meta.url), "utf8");
const redacted = redactString(FIXTURE).text;

test("the shipped fixture ⇒ a run record then one result per Results row; run_id, suite, case ids, PASS|FAIL|BLOCKED and the environment (host ∈ targets.browser) trusted; titles and narratives inert", () => {
  const out = adapt(ctxWith(["staging.example.com"]), run, null, redacted, base);
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 4);
  const [head, r1, r2, r3] = out.records;
  assert.deepEqual(head.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(head.trusted, {
    record: "run",
    run_id: "RUN-2026-09-15-001",
    suite: "security-my-product-admitted",
    environment: "https://staging.example.com",
    environment_host_allowed: true,
    date: "2026-09-15",
    results: 3,
  });
  assert.deepEqual(Object.keys(head.inert), ["title"]);
  assert.match(head.inert.title, /^\[UNTRUSTED CONTENT/);

  assert.deepEqual(r1.locator, { import_sha256: SHA, original_hmac: HMAC, index: 1 });
  assert.deepEqual(r1.trusted, { record: "result", run_id: "RUN-2026-09-15-001", case_id: "TC-SEC-001", status: "PASS" });
  assert.deepEqual(Object.keys(r1.inert), ["title"]);

  assert.deepEqual(r2.trusted, { record: "result", run_id: "RUN-2026-09-15-001", case_id: "TC-SEC-002", status: "FAIL", screenshot_path: "reports/screenshots/TC-SEC-002_2026-09-15.png" }, "the screenshot is referenced by path (§6.6), never copied");
  assert.deepEqual(Object.keys(r2.inert).sort(), ["narrative", "title"]);
  assert.match(r2.inert.narrative, /^\[UNTRUSTED CONTENT/);
  assert.ok(r2.inert.narrative.includes("Failed at step:** 3"), "the failure narrative is quoted");
  assert.ok(!("screenshot_path" in r2.inert), "the path is a reference in trusted, not quoted text");

  assert.deepEqual(r3.trusted, { record: "result", run_id: "RUN-2026-09-15-001", case_id: "TC-SEC-003", status: "BLOCKED" });
  assert.ok(r3.inert.narrative.includes("No outbound mail sink"), "the blocked reason is the narrative");
  const payload = { kind: "qa-run", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("environment whose host is not in targets.browser ⇒ not trusted: null in trusted, quoted inert, the results still recorded", () => {
  const out = adapt(ctxWith(["other.example.org"]), run, null, redacted, base);
  const head = out.records[0];
  assert.equal(head.trusted.environment, null);
  assert.equal(head.trusted.environment_host_allowed, false);
  assert.deepEqual(Object.keys(head.inert).sort(), ["environment", "title"]);
  assert.ok(head.inert.environment.includes("https://staging.example.com"));
  assert.equal(out.records.length, 4);
});

test("rows the format cannot vouch for are rejected, never dropped or promoted: an unknown status token, an id that is not a case id; the locator index is the source ordinal", () => {
  const text = redacted.replace("| ✅ PASS   | 5/5", "| ✅ PASSED | 5/5").replace("| TC-SEC-003 |", "| ../evil    |");
  const out = adapt(ctxWith(["staging.example.com"]), run, null, text, base);
  assert.deepEqual(out.records.map((r) => r.locator.index), [0, 2]);
  assert.deepEqual(out.rejected, [
    { reason: "unknown-status", locator: { import_sha256: SHA, index: 1 } },
    { reason: "bad-case-id", locator: { import_sha256: SHA, index: 3 } },
  ]);
  assert.equal(out.records[0].trusted.results, 3, "the header counts the table rows, rejected or not");
});

test("a screenshot path that is not a repo-relative posix path is quoted, not referenced", () => {
  const text = redacted.replace("`reports/screenshots/TC-SEC-002_2026-09-15.png`", "`/etc/passwd`");
  const out = adapt(ctxWith(["staging.example.com"]), run, null, text, base);
  const r2 = out.records[2];
  assert.equal(r2.trusted.screenshot_path, undefined);
  assert.ok(r2.inert.narrative.includes("/etc/passwd"));
});

test("parseRunReport: frontmatter + Results rows + narratives keyed by case id", () => {
  const p = parseRunReport(FIXTURE);
  assert.equal(p.run_id, "RUN-2026-09-15-001");
  assert.deepEqual(p.results.map((r) => [r.id, r.status, r.size]), [["TC-SEC-001", "PASS", "S"], ["TC-SEC-002", "FAIL", "S"], ["TC-SEC-003", "BLOCKED", "M"]]);
  assert.deepEqual(Object.keys(p.narratives).sort(), ["TC-SEC-002", "TC-SEC-003"]);
  assert.equal(p.results[1].screenshot, "reports/screenshots/TC-SEC-002_2026-09-15.png");
  assert.deepEqual(STATUSES, ["PASS", "FAIL", "BLOCKED"]);
  assert.ok(RUN_ID.test("RUN-2026-05-18-001") && !RUN_ID.test("RUN-2026-5-18-1"));
});

test("structural failures ⇒ 2 SCHEMA-INVALID(qa-run: …): no frontmatter, a run_id that is not RUN-YYYY-MM-DD-NNN, no ## Results table, a Results table without an ID or Status column", () => {
  const ctx = ctxWith(["staging.example.com"]);
  const bad = (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(qa-run: /.test(e.token);
  assert.throws(() => adapt(ctx, run, null, "# no frontmatter\n\n## Results\n| ID | Status |\n|---|---|\n", base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace("run_id: RUN-2026-09-15-001", "run_id: run-1"), base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace("## Results", "## Outcomes"), base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace("| ID         | Title", "| Case       | Title"), base), bad);
  assert.throws(() => adapt(ctx, run, null, { not: "text" }, base), TypeError);
});

test("qa-run.mjs is a leaf: no fs, no child process, no git, no network (G-6, G-14)", () => {
  const src = readFileSync(new URL("./qa-run.mjs", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:http", "node:net", "node:dns", "git.mjs", "fetch("]) assert.ok(!src.includes(forbidden), forbidden);
});
