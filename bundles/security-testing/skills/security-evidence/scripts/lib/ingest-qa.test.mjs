// TASK-018 — `evidence.mjs ingest case | audit | qa-run | ta-report` end to
// end (plan §4.1 row `ingest`; spec §6.6 rows case/audit/qa-run/ta-report;
// US-012 AC-1…AC-4, US-037 AC-3). The inputs are the verbatim manual-qa /
// test-automation format fixtures kept in sync by bin/check-skill-dupes.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir, writeScope } from "../fixtures/ingest/setup.mjs";
import { defaultRecord } from "./engagement.mjs";
import { walk } from "./fsx.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const FIXTURES = new URL("../fixtures/", import.meta.url);
const IMPORT_LINE = /^IMPORT ([a-z-]+) import_sha256=([0-9a-f]{64}) records=([0-9]+) unlocated=([0-9]+) rejected=([0-9]+)$/;

function parseImportLine(stdout) {
  const m = IMPORT_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the IMPORT token: ${JSON.stringify(stdout)}`);
  return { kind: m[1], import_sha256: m[2], records: Number(m[3]), unlocated: Number(m[4]), rejected: Number(m[5]) };
}

/** A repo carrying the four fixtures at the paths their owning formats prescribe, with an assessment run and a scope. */
async function qaRepo({ browser } = {}) {
  const record = defaultRecord();
  if (browser) record.targets.browser = browser;
  const repo = readyRepo({ record });
  const files = {
    "tasks/security-my-product-admitted/TC-SEC-001.md": "qa/TC-SEC-001.md",
    "reports/RUN-2026-09-15-001.md": "qa/RUN-2026-09-15-001.md",
    "reports/audit-staging.example.com-2026-09-15.md": "qa/audit-report.md",
    ".agents/automation/security-my-product-admitted/report.json": "ta/report.json",
  };
  for (const [dest, src] of Object.entries(files)) {
    mkdirSync(join(repo, dest, ".."), { recursive: true });
    copyFileSync(new URL(src, FIXTURES), join(repo, dest));
  }
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "qa inputs"]);
  const run_id = await initRun(repo, "assessment");
  writeScope(repo, run_id, ["src/app.js"]);
  return { repo, run_id };
}

async function ingest(repo, run_id, kind, file) {
  const r = await runScript("evidence", ["ingest", kind, file, "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const line = parseImportLine(r.stdout);
  assert.equal(line.kind, kind);
  const record = readArtifact(join(runDir(repo, run_id), "ingest", `${line.import_sha256}.json`), { kind: "import" });
  assert.deepEqual(validate("import", record.payload), []);
  assert.equal(record.payload.kind, kind);
  assert.equal(record.payload.source_path, file);
  assert.equal(record.payload.records.length, line.records);
  assert.equal(record.payload.rejected.length, line.rejected);
  return { line, payload: record.payload, stdout: r.stdout };
}

test("manual-qa run report in its real Markdown format through ingest qa-run", async () => {
  const { repo, run_id } = await qaRepo();
  const before = walk(join(repo, ST)).length;
  const { line, payload } = await ingest(repo, run_id, "qa-run", "reports/RUN-2026-09-15-001.md");
  assert.deepEqual([line.records, line.unlocated, line.rejected], [4, 0, 0]);
  const [head, ...rows] = payload.records;
  assert.deepEqual(head.trusted, { record: "run", run_id: "RUN-2026-09-15-001", suite: "security-my-product-admitted", environment: "https://staging.example.com", environment_host_allowed: true, date: "2026-09-15", results: 3 });
  assert.deepEqual(rows.map((r) => [r.trusted.case_id, r.trusted.status]), [["TC-SEC-001", "PASS"], ["TC-SEC-002", "FAIL"], ["TC-SEC-003", "BLOCKED"]]);
  assert.equal(rows[1].trusted.screenshot_path, undefined, "a screenshot path is inert (§6.6), never a trusted reference");
  assert.ok(rows[1].inert.screenshot.includes("reports/screenshots/TC-SEC-002_2026-09-15.png"));
  assert.match(rows[1].inert.narrative, /^\[UNTRUSTED CONTENT/);
  assert.ok(rows[1].inert.narrative.includes("Expected the `session` cookie to carry `HttpOnly`"));
  // the screenshot is referenced by path and never copied: nothing new under <st> but the blob, the record and the index
  const after_ = walk(join(repo, ST)).filter((p) => !p.includes(".lock"));
  const added = after_.length - before;
  assert.ok(added <= 3, `blob + record + index only, got ${added} new entries`);
  assert.ok(!after_.some((p) => p.endsWith(".png")), "no screenshot bytes under the security state");
  // the import blob is the redacted report bytes
  const blob = readFileSync(join(repo, ST, "ledger", run_id, "imports", line.import_sha256), "utf8");
  assert.ok(blob.startsWith("---\nrun_id: RUN-2026-09-15-001\n"));
});

test("case trusts ids and requirements; steps inert", async () => {
  const { repo, run_id } = await qaRepo();
  const { line, payload } = await ingest(repo, run_id, "case", "tasks/security-my-product-admitted/TC-SEC-001.md");
  assert.deepEqual([line.records, line.unlocated, line.rejected], [1, 0, 0]);
  const [r] = payload.records;
  assert.deepEqual(r.trusted, { id: "TC-SEC-001", requirements: ["SEC-REQ-004", "SEC-REQ-011"] });
  assert.deepEqual(Object.keys(r.inert).sort(), ["body", "steps", "title"]);
  assert.match(r.inert.steps, /^\[UNTRUSTED CONTENT/);
  assert.ok(r.inert.steps.includes("Navigate to `{{base_url}}/login`"));
  assert.ok(!JSON.stringify(payload).includes("password=`Test1234!`") && r.inert.body.includes("<REDACTED:password-assign>"), "the fixture's password assignment never reaches an artifact");
  const blob = readFileSync(join(repo, ST, "ledger", run_id, "imports", line.import_sha256), "utf8");
  assert.ok(!blob.includes("password=`Test1234!`") && blob.includes("<REDACTED:password-assign>"), "the blob is the redacted form (G-3)");
});

test("audit URL outside targets.browser untrusted", async () => {
  const allowed = await qaRepo();
  const a = await ingest(allowed.repo, allowed.run_id, "audit", "reports/audit-staging.example.com-2026-09-15.md");
  assert.deepEqual([a.line.records, a.line.rejected], [4, 0]);
  assert.deepEqual(a.payload.records[1].trusted, { record: "finding", title: "Session cookie is set without HttpOnly", priority: "p0", confidence: 9, urls: ["https://staging.example.com/login"] });
  assert.deepEqual(a.payload.records[0].trusted.pages_audited, ["https://staging.example.com/", "https://staging.example.com/login"]);

  const other = await qaRepo({ browser: ["prod.example.com"] });
  const u = await ingest(other.repo, other.run_id, "audit", "reports/audit-staging.example.com-2026-09-15.md");
  assert.deepEqual([u.line.records, u.line.rejected], [4, 0], "the report is still well-formed; only the trust changes");
  assert.deepEqual(u.payload.records[0].trusted.pages_audited, []);
  assert.equal(u.payload.records[0].trusted.target, null);
  for (const f of u.payload.records.slice(1)) {
    assert.deepEqual(f.trusted.urls, []);
    assert.match(f.inert.untrusted_urls, /^\[UNTRUSTED CONTENT/);
    assert.ok(f.inert.untrusted_urls.includes("staging.example.com"));
  }
  assert.equal(u.payload.import_sha256, a.payload.import_sha256, "same redacted bytes ⇒ same import identity whatever the targets say");
});

test("ta-report per-unit fields; delivered without gate receipt ⇒ delivered-unwitnessed", async () => {
  const { repo, run_id } = await qaRepo();
  const w = await ingest(repo, run_id, "ta-report", ".agents/automation/security-my-product-admitted/report.json");
  assert.deepEqual([w.line.records, w.line.rejected], [4, 0]);
  const units = w.payload.records.slice(1).map((r) => r.trusted);
  assert.deepEqual(units.map((u) => [u.case_id, u.outcome, u.gate_witnessed]), [["TC-SEC-001", "delivered", true], ["TC-SEC-002", "delivered", true], ["TC-SEC-003", "blocked", false]]);
  assert.deepEqual(units[1].coverage, { full: false, excluded: [{ step: "TC-SEC-002/3", category: "blocked-by-defect", referent: "SEC-DEF-17" }] });
  assert.deepEqual(units[1].findings, [{ kind: "defect", ref: "SEC-DEF-17" }]);
  assert.deepEqual(w.payload.records[0].trusted.test_paths, ["tests/security/session-cookie.spec.ts"]);

  // a rebuilt report (the playbook's shape): delivered rows carry no gate record and the report has no gate verdict
  const rebuilt = JSON.parse(readFileSync(new URL("ta/report.json", FIXTURES), "utf8"));
  delete rebuilt.gate;
  for (const c of rebuilt.cases) delete c.gate;
  rebuilt.recovery = { rebuilt_from: ["receipts", "git"], note: "no gate receipt — proof is the merge" };
  const path = ".agents/automation/security-my-product-admitted/report.rebuilt.json";
  writeFileSync(join(repo, path), `${JSON.stringify(rebuilt, null, 2)}\n`);
  const u = await ingest(repo, run_id, "ta-report", path);
  assert.deepEqual(u.payload.records.slice(1).map((r) => r.trusted.outcome), ["delivered-unwitnessed", "delivered-unwitnessed", "blocked"]);
  assert.deepEqual(u.payload.records.slice(1).map((r) => r.trusted.outcome_reported), ["delivered", "delivered", "blocked"]);
  assert.deepEqual(u.payload.records[0].trusted.recovery_basis, ["receipts", "git"]);
  assert.equal(u.payload.records[0].trusted.gate_verdict, null);
  assert.match(u.payload.records[0].inert.recovery_note, /^\[UNTRUSTED CONTENT/);
  assert.ok(existsSync(join(runDir(repo, run_id), "ingest", `${u.line.import_sha256}.json`)));
});

test("every adapter persists via the import store: blob + write-once record + index entry; a malformed input is 2 SCHEMA-INVALID(<kind>: …) with nothing written", async () => {
  const { repo, run_id } = await qaRepo();
  const inputs = [
    ["case", "tasks/security-my-product-admitted/TC-SEC-001.md"],
    ["qa-run", "reports/RUN-2026-09-15-001.md"],
    ["audit", "reports/audit-staging.example.com-2026-09-15.md"],
    ["ta-report", ".agents/automation/security-my-product-admitted/report.json"],
  ];
  const shas = [];
  for (const [kind, file] of inputs) shas.push((await ingest(repo, run_id, kind, file)).line.import_sha256);
  const index = readArtifact(join(runDir(repo, run_id), "imports.json"), { kind: "imports-index" });
  assert.deepEqual(index.payload.imports.map((e) => e.kind), inputs.map(([k]) => k));
  assert.deepEqual(index.payload.imports.map((e) => e.import_sha256), shas);
  for (const sha of shas) assert.ok(existsSync(join(repo, ST, "ledger", run_id, "imports", sha)));

  writeFileSync(join(repo, "reports", "bad.md"), "# not a run report\n");
  const bad = await runScript("evidence", ["ingest", "qa-run", "reports/bad.md", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(bad.code, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^SCHEMA-INVALID\(qa-run: /);
  assert.equal(readArtifact(join(runDir(repo, run_id), "imports.json")).payload.imports.length, 4, "nothing indexed");
  const badCase = await runScript("evidence", ["ingest", "case", "reports/bad.md", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(badCase.code, 2);
  assert.match(badCase.stdout, /^SCHEMA-INVALID\(case: /);
  const badTa = await runScript("evidence", ["ingest", "ta-report", "reports/RUN-2026-09-15-001.md", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(badTa.code, 2);
  assert.match(badTa.stdout, /^SCHEMA-INVALID\(ta-report: /);
});
