// TASK-044 — observations from `ingest qa-run`, the test-automation hand-off
// prompt (`plan.mjs ta-prompt`) and the `ta-report` per-unit records (plan
// §4.5, §5 TASK-044; spec §9.2 observations, §9.3; US-036 AC-1…AC-3, US-037
// AC-1, AC-2, AC-4). Every run is built by the real commands in a temp repo
// (G-12): candidates are admitted by `plan admit`, joined to their case ids by
// `ingest case`, and the run report / TA report enter through `ingest`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { caseText, cleanupAll, commitAll, ENV, evidence, PASSIVE_ROWS, plan, readyRepo, runDir, scopedRun, ST, writeCase } from "../fixtures/plan/helpers.mjs";
import { runScript } from "../fixtures/cli/harness.mjs";
import { caseResolver, deriveObservations, observationId } from "./observations.mjs";
import { validate } from "./schema.mjs";
import { UNADMITTED_CASE } from "./tokens.mjs";

after(cleanupAll);

const SUITE = "tasks/security-my-product-admitted";
const PLAIN_ROWS = [["Navigate to `{{base_url}}/`", "The home page loads"], ["Inspect the footer", "No version string is shown"]];
const IMPORT_LINE = /^IMPORT ([a-z-]+) import_sha256=([0-9a-f]{64}) records=([0-9]+) unlocated=([0-9]+) rejected=([0-9]+)$/;
const OBSERVATION_LINE = /^OBSERVATION (O-[0-9a-f]{12}) case=(TC-[0-9]{3}) result=(PASS|FAIL|BLOCKED)$/;
const lines = (s) => s.split("\n").filter((l) => l !== "");
const register = (repo, args) => runScript("register", args, { cwd: repo, env: ENV });

async function ok(promise, what) {
  const r = await promise;
  assert.equal(r.code, 0, `${what}: ${r.stdout}${r.stderr}`);
  return r;
}

/** A manual-qa run report (test-run-report-format.md) over `rows` = [id, title, status]. */
function runReport(rows, { run_id = "RUN-2026-09-17-001", environment = "https://staging.example.com" } = {}) {
  const table = rows.map(([id, title, status]) => `| ${id} | ${title} | S | ${status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏸"} ${status} | 1/1 | 3s |`).join("\n");
  return `---\nrun_id: ${run_id}\nsuite: security-my-product-admitted\nenvironment: ${environment}\ndate: 2026-09-17\n---\n\n# Test Run Report\n\n## Results\n\n| ID | Title | Size | Status | Steps | Wall Clock |\n|---|---|---|---|---|---|\n${table}\n`;
}

/**
 * An assessment run with three candidates: TC-001 (admitted, no account), TC-002
 * (admitted, `account: qa-user`), TC-004 (a proposal — its Action submits a form);
 * every candidate is also `ingest case`d so the run can join case ids to identities.
 */
async function admittedAssessment() {
  const repo = readyRepo();
  const texts = {
    "TC-001_login-headers.md": caseText("TC-001", PASSIVE_ROWS),
    "TC-002_home-footer.md": caseText("TC-002", PLAIN_ROWS, { title: "Verify the footer hides versions", extra: "account: qa-user" }),
    "TC-004_submit.md": caseText("TC-004", [["Submit the login form", "Redirect"]], { title: "Submit login" }),
  };
  const paths = {};
  for (const [name, text] of Object.entries(texts)) paths[name] = writeCase(repo, name, text);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\n"); // one scope file, so coverage has something to account for
  commitAll(repo);
  const run_id = await scopedRun(repo, "assessment");
  const admitted = {};
  for (const [name, rel] of Object.entries(paths)) {
    const a = await ok(plan(repo, ["admit", "--run", run_id, rel]), `admit ${name}`);
    admitted[name] = /^ADMISSION case=([0-9a-f]{64}) classification=(\S+)/m.exec(a.stdout).slice(1, 3);
    await ok(evidence(repo, ["ingest", "case", rel, "--run", run_id]), `ingest case ${name}`);
  }
  assert.equal(admitted["TC-004_submit.md"][1], "proposal");
  return { repo, run_id, dir: runDir(repo, run_id), admitted, paths };
}

async function ingestRun(repo, run_id, rows, options) {
  mkdirSync(join(repo, "reports"), { recursive: true });
  const rel = `reports/${options?.run_id ?? "RUN-2026-09-17-001"}.md`;
  writeFileSync(join(repo, rel), runReport(rows, options));
  const r = await evidence(repo, ["ingest", "qa-run", rel, "--run", run_id]);
  return { ...r, lines: lines(r.stdout), import: IMPORT_LINE.exec(r.stdout.split("\n")[0]) };
}

test("observation shape; unknown never blank; observations.json index gains the entry (US-036 AC-1)", async () => {
  const { repo, run_id, dir, admitted } = await admittedAssessment();
  const r = await ingestRun(repo, run_id, [["TC-001", "Verify security headers on the login page", "PASS"], ["TC-002", "Verify the footer hides versions", "FAIL"]]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.import, r.stdout);
  const import_sha256 = r.import[2];
  assert.deepEqual([r.import[3], r.import[4], r.import[5]], ["3", "0", "0"], "two admitted rows: records=3 (the run + two results), nothing unlocated");
  // one OBSERVATION line + its WROTE line per admitted row, in row order; the index and the record follow
  const obs = r.lines.filter((l) => OBSERVATION_LINE.test(l)).map((l) => OBSERVATION_LINE.exec(l).slice(1));
  assert.deepEqual(obs.map((o) => [o[1], o[2]]), [["TC-001", "PASS"], ["TC-002", "FAIL"]]);
  const idOf = (case_id) => observationId(import_sha256, case_id);
  assert.deepEqual(obs.map((o) => o[0]), [idOf("TC-001"), idOf("TC-002")], "observation_id = O- + sha256(import_sha256\\0case_id)[0:12]");
  assert.match(idOf("TC-001"), /^O-[0-9a-f]{12}$/);
  for (const [id] of obs) assert.ok(r.lines.some((l) => l.startsWith(`WROTE ${ST}/runs/${run_id}/observations/${id}.json sha256=`)), `WROTE for ${id}`);
  assert.match(r.lines[r.lines.length - 2], new RegExp(`^WROTE ${ST}/runs/${run_id}/imports\\.json sha256=`));
  assert.match(r.lines[r.lines.length - 1], new RegExp(`^WROTE ${ST}/runs/${run_id}/ingest/${import_sha256}\\.json sha256=`));
  assert.ok(r.lines.some((l) => l.startsWith(`WROTE ${ST}/runs/${run_id}/observations.json sha256=`)), "the index is written after the observations");

  // the artifacts: schema-valid, every field present, unknowns spelled `unknown`
  const one = readArtifact(join(dir, "observations", `${idOf("TC-001")}.json`), { kind: "observation" });
  assert.deepEqual(validate("observation", one.payload), []);
  assert.deepEqual(one.payload, {
    observation_id: idOf("TC-001"),
    import_sha256,
    case_id: "TC-001",
    case_sha256: admitted["TC-001_login-headers.md"][0],
    result: "PASS",
    run_id: "RUN-2026-09-17-001",
    base_url: "https://staging.example.com",
    account: "unknown",
    head_oid: "unknown",
  });
  assert.equal(one.envelope.run_id, run_id, "the observation is a run artifact");
  const two = readArtifact(join(dir, "observations", `${idOf("TC-002")}.json`), { kind: "observation" });
  assert.equal(two.payload.case_sha256, admitted["TC-002_home-footer.md"][0], "case_sha256 comes from the admission");
  assert.equal(two.payload.account, "qa-user", "account is the admission's assumption (the case frontmatter)");
  assert.equal(two.payload.result, "FAIL");
  for (const p of [one.payload, two.payload]) for (const [k, v] of Object.entries(p)) assert.ok(v !== "" && v !== null, `${k} never blank`);
  // the TL-14 index lists both, in write order, with the on-disk identities
  const index = readArtifact(join(dir, "observations.json"), { kind: "observations-index" });
  assert.deepEqual(index.payload.observations, [
    { observation_id: idOf("TC-001"), sha256: one.envelope.self_sha256 },
    { observation_id: idOf("TC-002"), sha256: two.envelope.self_sha256 },
  ]);
  assert.deepEqual(readdirSync(join(dir, "observations")).sort(), [idOf("TC-001"), idOf("TC-002")].map((id) => `${id}.json`).sort());
  // an environment outside targets.browser ⇒ base_url unknown (the host is not trusted, §6.6); a second report is a second import
  const foreign = await ingestRun(repo, run_id, [["TC-001", "Verify security headers on the login page", "BLOCKED"]], { run_id: "RUN-2026-09-17-002", environment: "https://evil.example.net" });
  assert.equal(foreign.code, 0, `${foreign.stdout}${foreign.stderr}`);
  const blocked = readArtifact(join(dir, "observations", `${observationId(foreign.import[2], "TC-001")}.json`), { kind: "observation" });
  assert.deepEqual([blocked.payload.result, blocked.payload.base_url, blocked.payload.run_id], ["BLOCKED", "unknown", "RUN-2026-09-17-002"]);
  assert.equal(readArtifact(join(dir, "observations.json"), { kind: "observations-index" }).payload.observations.length, 3);
});

test("unadmitted case ⇒ unresolved candidate, not an observation (US-036 AC-2)", async () => {
  const { repo, run_id, dir } = await admittedAssessment();
  // TC-003: no candidate at all; TC-004: a candidate whose admission is a `proposal` — neither is an admitted case
  const r = await ingestRun(repo, run_id, [["TC-001", "Verify security headers on the login page", "PASS"], ["TC-003", "Never planned", "FAIL"], ["TC-004", "Submit login", "PASS"]]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual([r.import[3], r.import[4], r.import[5]], ["4", "2", "0"], "every row stays a result record; two rows are unlocated candidates");
  const record = readArtifact(join(dir, "ingest", `${r.import[2]}.json`), { kind: "import" });
  assert.deepEqual(validate("import", record.payload), []);
  assert.deepEqual(record.payload.unlocated, [
    { locator: { import_sha256: r.import[2], index: 2 }, reason: UNADMITTED_CASE },
    { locator: { import_sha256: r.import[2], index: 3 }, reason: UNADMITTED_CASE },
  ]);
  assert.equal(UNADMITTED_CASE, "unadmitted-case");
  const obs = r.lines.filter((l) => OBSERVATION_LINE.test(l));
  assert.equal(obs.length, 1);
  assert.match(obs[0], /case=TC-001 result=PASS$/);
  assert.deepEqual(readdirSync(join(dir, "observations")), [`${observationId(r.import[2], "TC-001")}.json`], "no observation file for an unadmitted row");
  assert.equal(readArtifact(join(dir, "observations.json"), { kind: "observations-index" }).payload.observations.length, 1);
  // gate folds the candidates into <run>/unlocated.json verbatim (the write-once file is gate's, G-10)
  const p = await ok(evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet");
  assert.match(p.stdout, /^PACKET /);
  const g = await ok(evidence(repo, ["gate", "--run", run_id]), "gate");
  assert.match(g.stdout, /^GATE accepted=0 unverifiable=0 rejected=0 unlocated=2$/m);
  const unlocated = readArtifact(join(dir, "unlocated.json"), { kind: "unlocated" });
  assert.deepEqual(unlocated.payload.candidates.map((c) => [c.reason, c.locator.index]), [["unadmitted-case", 2], ["unadmitted-case", 3]]);
});

/** Every other §6.3 assessment input, by the real commands, then build-report; returns the report text. */
async function commitAssessment(repo, run_id) {
  const dir = runDir(repo, run_id);
  const p = await ok(evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet");
  const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  await ok(evidence(repo, ["gate", "--run", run_id]), "gate");
  const drop = join(repo, ST, "receipts", run_id);
  mkdirSync(drop, { recursive: true });
  writeFileSync(join(drop, "examined-1.json"), JSON.stringify({ packet_sha256, declared: [{ path: "src/app.js", ranges: [[1, 1]] }] }));
  await ok(evidence(repo, ["coverage", "--run", run_id, "--examined", join(ST, "receipts", run_id, "examined-1.json")]), "coverage");
  writeFileSync(join(repo, ST, "threat-model.json"), JSON.stringify({ elements: [], threats: [] }));
  await ok(runScript("tm-lint", ["check", "--run", run_id], { cwd: repo, env: ENV }), "tm-lint check");
  await ok(register(repo, ["add", "--subject", "e".repeat(64), "--priority", "p3", "--title", "a row", "--run", run_id]), "register add");
  await ok(evidence(repo, ["run", "snapshot", "register", "--run", run_id]), "snapshot register");
  await ok(evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]), "snapshot proposals");
  await ok(evidence(repo, ["build-report", "--run", run_id, "--template", "assessment"]), "build-report");
  return readFileSync(join(dir, "report.md"), "utf8");
}

test("FAIL renders in section 9; mitigation needs a separate mitigation-review receipt (US-036 AC-3)", async () => {
  const { repo, run_id, admitted } = await admittedAssessment();
  const r = await ingestRun(repo, run_id, [["TC-001", "Verify security headers on the login page", "PASS"], ["TC-002", "Verify the footer hides versions", "FAIL"]]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const fail = observationId(r.import[2], "TC-002");
  const pass = observationId(r.import[2], "TC-001");
  const text = await commitAssessment(repo, run_id);
  const section9 = text.slice(text.indexOf("## 9. "), text.indexOf("## 10. "));
  assert.match(section9, /QA FAIL observations \(passive cases the QA bundles ran; an observation is never a finding\)/);
  assert.match(section9, new RegExp(`^\\| ${fail} \\| TC-002 \\| ${admitted["TC-002_home-footer.md"][0]} \\| FAIL \\| ${r.import[2]} \\| <!-- v:unresolved\\.qa_fail\\[0\\] -->$`, "m"), "the FAIL observation is a row of section 9 with its case identity");
  assert.doesNotMatch(section9, new RegExp(pass), "a PASS observation is not an unresolved candidate");
  assert.match(section9, /a mitigation decision needs a separate `mitigation-review` receipt citing the observation/, "the rule is printed with the table");
  // no receipt cites the observation, so nothing about it is mitigated: no state anywhere in the report names the observation as resolved
  assert.doesNotMatch(text, new RegExp(`${fail}[^\\n]*MITIGATION_`));
  const check = await ok(evidence(repo, ["check", join(ST, "runs", run_id)]), "check");
  assert.match(check.stdout, /^CONSISTENT$/m, "section 9 is derived: check recomputes it");
});

test("ta-prompt carries cases{id,title,path}, slug, base; no proposal; includes not-yet-VERIFIED cases (US-037 AC-1, AC-4)", async () => {
  const { repo, run_id, admitted } = await admittedAssessment();
  const before = await plan(repo, ["ta-prompt", "--run", run_id, "--slug", "my-product", "--base", "main"]);
  assert.equal(before.code, 2, before.stdout + before.stderr);
  assert.equal(before.stdout, `USAGE(ta-prompt: run ${run_id} has no published suite (publish --profile case first))\n`);
  await commitAssessment(repo, run_id);
  await ok(evidence(repo, ["publish", "--run", run_id, "--profile", "case", "--to", SUITE]), "publish case");
  assert.deepEqual(readdirSync(join(repo, SUITE)).sort(), ["TC-001_login-headers.md", "TC-002_home-footer.md"]);
  // no verify run exists for anything in this repo: the cases are still handed off (tests may be built before VERIFIED)
  const r = await ok(plan(repo, ["ta-prompt", "--run", run_id, "--slug", "my-product", "--base", "main"]), "ta-prompt");
  assert.equal(r.stderr, "");
  assert.deepEqual(lines(r.stdout), [
    "Run as the active agent (claude --agent test-automation-lead):",
    '"Automate the batch my-product from base main. The cases below are manual-qa test cases already in this repository (tasks/security-my-product-admitted/): pass each path as its intake snapshot (cases: [{id, path}]); do not copy them."',
    "cases:",
    "- id: TC-001 | title: Verify security headers on the login page | path: ./tasks/security-my-product-admitted/TC-001_login-headers.md",
    "- id: TC-002 | title: Verify the footer hides versions | path: ./tasks/security-my-product-admitted/TC-002_home-footer.md",
  ]);
  assert.ok(!r.stdout.includes("TC-004") && !r.stdout.includes("Submit login") && !r.stdout.includes("proposal"), "nothing from a proposal");
  assert.ok(!r.stdout.includes(admitted["TC-004_submit.md"][0]));
  assert.ok(!existsSync(join(repo, ST, "handoffs", "my-product.ta.md")), "the prompt is printed, not written");
  // the argv contract: --slug must be the published suite's; --base is a label (printed, never resolved); a hand-edited suite file is refused
  const wrongSlug = await plan(repo, ["ta-prompt", "--run", run_id, "--slug", "other", "--base", "main"]);
  assert.equal(wrongSlug.code, 2);
  assert.equal(wrongSlug.stdout, `USAGE(ta-prompt: run ${run_id} published its suite for slug my-product, not other)\n`);
  const badBase = await plan(repo, ["ta-prompt", "--run", run_id, "--slug", "my-product", "--base", "release branch"]);
  assert.equal(badBase.code, 2);
  assert.match(badBase.stdout, /^USAGE\(ta-prompt: --base must be a branch name/);
  writeFileSync(join(repo, SUITE, "TC-002_home-footer.md"), "---\nid: TC-002\ntitle: edited by hand\n---\n## Steps\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | Submit the form | ok |\n");
  const edited = await plan(repo, ["ta-prompt", "--run", run_id, "--slug", "my-product", "--base", "main"]);
  assert.equal(edited.code, 2);
  assert.equal(edited.stdout, `USAGE(ta-prompt: the suite file is not what publish recorded (republish --profile case, or remove it): ${SUITE}/TC-002_home-footer.md)\n`);
});

test("per-unit records; partial coverage per assertion (US-037 AC-2)", async () => {
  const { repo, run_id, dir, admitted } = await admittedAssessment();
  const report = {
    batch: "my-product",
    base: "main",
    gate: { verdict: "green", runs: 3, seconds: 41, failures: [] },
    cases: [
      { id: "TC-001", outcome: "delivered", note: "done", findings: [], gate: { runs: 3, seconds: 40 }, coverage: { full: true, excluded: [] } },
      { id: "TC-002", outcome: "delivered", note: "one step excluded", findings: [{ kind: "defect", ref: "SEC-DEF-17", note: "footer shows a version" }], coverage: { full: false, excluded: [{ step: "TC-002/2", category: "blocked-by-defect", referent: "SEC-DEF-17", note: "until fixed" }] } },
      { id: "TC-003", outcome: "blocked", note: "no candidate", findings: [], coverage: { full: false, excluded: [{ step: "TC-003/1", category: "un-automatable", referent: "visual" }, { step: "TC-003/2", category: "covered-elsewhere", referent: "tests/a.spec.ts" }] } },
    ],
    expected_red: [],
  };
  mkdirSync(join(repo, ".agents", "automation", "my-product"), { recursive: true });
  const rel = ".agents/automation/my-product/report.json";
  writeFileSync(join(repo, rel), `${JSON.stringify(report, null, 2)}\n`);
  const r = await ok(evidence(repo, ["ingest", "ta-report", rel, "--run", run_id]), "ingest ta-report");
  const import_sha256 = IMPORT_LINE.exec(r.stdout.split("\n")[0])[2];
  const out = lines(r.stdout);
  const path = `${ST}/runs/${run_id}/ta-units/${import_sha256}.json`;
  const ta = out.find((l) => l.startsWith("TA-UNITS "));
  assert.ok(ta, r.stdout);
  const bytes = readFileSync(join(dir, "ta-units", `${import_sha256}.json`));
  assert.equal(ta, `TA-UNITS ${path} units=3 sha256=${sha256Hex(bytes)}`);
  assert.equal(out[out.length - 1].startsWith(`WROTE ${ST}/runs/${run_id}/ingest/`), true, "the record's WROTE line stays last");
  // payload-only, canonical JSON + LF, write-once; one unit per cases[] row in report order
  const units = parseStrict(bytes);
  assert.equal(bytes.toString("utf8"), `${canonical(units).toString("utf8")}\n`);
  assert.deepEqual(Object.keys(units), ["base", "batch", "import_sha256", "recovery_basis", "units"]);
  assert.deepEqual([units.import_sha256, units.batch, units.base, units.recovery_basis], [import_sha256, "my-product", "main", "unknown"]);
  assert.deepEqual(units.units.map((u) => u.case_id), ["TC-001", "TC-002", "TC-003"]);
  assert.deepEqual(units.units[0], { case_id: "TC-001", case_sha256: admitted["TC-001_login-headers.md"][0], coverage: "full", exclusions: [], findings: [], gate_witnessed: true, outcome: "delivered", outcome_reported: "delivered", recovery_basis: "unknown" });
  // partial coverage is kept per assertion: each excluded step with its category and referent; findings with their refs
  assert.deepEqual(units.units[1].coverage, "partial");
  assert.deepEqual(units.units[1].exclusions, [{ step: "TC-002/2", category: "blocked-by-defect", referent: "SEC-DEF-17" }]);
  assert.deepEqual(units.units[1].findings, [{ kind: "defect", ref: "SEC-DEF-17" }]);
  assert.equal(units.units[1].case_sha256, admitted["TC-002_home-footer.md"][0]);
  assert.deepEqual(units.units[2].exclusions, [{ step: "TC-003/1", category: "un-automatable", referent: "visual" }, { step: "TC-003/2", category: "covered-elsewhere", referent: "tests/a.spec.ts" }]);
  assert.deepEqual([units.units[2].case_sha256, units.units[2].outcome, units.units[2].gate_witnessed], ["unknown", "blocked", false], "a unit with no admitted case keeps its record; its identity is unknown");
  for (const u of units.units) for (const [k, v] of Object.entries(u)) assert.ok(v !== "" && v !== null, `${u.case_id}.${k} never blank`);
  // a rebuilt report (no gate): delivered-unwitnessed, recovery_basis kept per unit; a second ta-report is a second per-import file
  const rebuilt = { ...report, cases: report.cases.map(({ gate: _g, ...c }) => c), recovery: { rebuilt_from: ["receipts", "git"], note: "rebuilt" } };
  delete rebuilt.gate;
  writeFileSync(join(repo, rel), `${JSON.stringify(rebuilt, null, 2)}\n`);
  const r2 = await ok(evidence(repo, ["ingest", "ta-report", rel, "--run", run_id]), "ingest rebuilt ta-report");
  const sha2 = IMPORT_LINE.exec(r2.stdout.split("\n")[0])[2];
  const units2 = parseStrict(readFileSync(join(dir, "ta-units", `${sha2}.json`)));
  assert.deepEqual(units2.units.map((u) => [u.outcome, u.recovery_basis]), [["delivered-unwitnessed", ["receipts", "git"]], ["delivered-unwitnessed", ["receipts", "git"]], ["blocked", ["receipts", "git"]]]);
  assert.deepEqual(readdirSync(join(dir, "ta-units")).sort(), [`${import_sha256}.json`, `${sha2}.json`].sort());
  // the ta-units file is not an enveloped artifact and does not enter the manifest: the assessment still builds and checks
  const text = await commitAssessment(repo, run_id);
  assert.match(text, /## 12\. /);
  assert.match((await ok(evidence(repo, ["check", join(ST, "runs", run_id)]), "check")).stdout, /^CONSISTENT$/m);
});

// --- the module's own edges (pure derivation, the join, the write-once files) ---

test("deriveObservations: a case id listed twice is the report's structural fault (2 SCHEMA-INVALID(qa-run: …)), nothing derived; base_url unknown when the environment host is not trusted; argument checks", () => {
  const rec = (index, case_id, status) => ({ locator: { import_sha256: IMPORT_SHA, original_hmac: "b".repeat(64), index }, trusted: { record: "result", run_id: "RUN-2026-09-17-001", case_id, status }, inert: {} });
  const head = (environment, allowed) => ({ locator: { import_sha256: IMPORT_SHA, original_hmac: "b".repeat(64), index: 0 }, trusted: { record: "run", run_id: "RUN-2026-09-17-001", suite: "s", environment, environment_host_allowed: allowed, date: "2026-09-17", results: 2 }, inert: {} });
  const resolve = (id) => (id === "TC-001" ? { case_sha256: "c".repeat(64), account: "qa" } : null);
  const twice = [head("https://staging.example.com", true), rec(1, "TC-001", "PASS"), rec(2, "TC-001", "FAIL")];
  assert.throws(() => deriveObservations(twice, { import_sha256: IMPORT_SHA, resolve }), (err) => err.code === 2 && err.token === "SCHEMA-INVALID(qa-run: case TC-001 appears twice in the ## Results table)");
  const foreign = deriveObservations([head(null, false), rec(1, "TC-001", "BLOCKED"), rec(2, "TC-009", "PASS")], { import_sha256: IMPORT_SHA, resolve });
  assert.deepEqual(foreign.observations, [{ observation_id: observationId(IMPORT_SHA, "TC-001"), import_sha256: IMPORT_SHA, case_id: "TC-001", case_sha256: "c".repeat(64), result: "BLOCKED", run_id: "RUN-2026-09-17-001", base_url: "unknown", account: "qa", head_oid: "unknown" }]);
  assert.deepEqual(foreign.unlocated, [{ locator: { import_sha256: IMPORT_SHA, index: 2 }, reason: "unadmitted-case" }]);
  assert.throws(() => deriveObservations([rec(1, "TC-001", "PASS")], { import_sha256: IMPORT_SHA, resolve }), /no run record at index 0/);
  assert.throws(() => deriveObservations([], { import_sha256: "x", resolve }), /import_sha256 must be 64 hex/);
  assert.throws(() => deriveObservations([], { import_sha256: IMPORT_SHA }), /resolve must be a function/);
  assert.throws(() => observationId(IMPORT_SHA, ""), /case_id must be a non-empty string/);
  assert.equal(observationId(IMPORT_SHA, "TC-001"), `O-${sha256Hex(Buffer.from(`${IMPORT_SHA}\0TC-001`, "utf8")).slice(0, 12)}`);
});

test("caseResolver: the join needs exactly one admitted identity per case id — two admitted candidates with one id resolve nothing; a case record whose identity carries no admission resolves nothing; a tampered admission is 5 INCONSISTENT(admissions/<sha>)", async () => {
  const { repo, run_id, dir, admitted, paths } = await admittedAssessment();
  const resolve = caseResolver(dir);
  assert.deepEqual(resolve("TC-001"), { case_sha256: admitted["TC-001_login-headers.md"][0], account: "unknown" });
  assert.deepEqual(resolve("TC-002"), { case_sha256: admitted["TC-002_home-footer.md"][0], account: "qa-user" });
  assert.equal(resolve("TC-004"), null, "a proposal is not an admission");
  assert.equal(resolve("TC-003"), null, "never ingested");
  // a second candidate spelling TC-001 (different text ⇒ different identity), admitted and ingested: ambiguous ⇒ null
  const twin = writeCase(repo, "TC-001_twin.md", caseText("TC-001", PASSIVE_ROWS, { title: "A twin of TC-001" }));
  await ok(plan(repo, ["admit", "--run", run_id, twin]), "admit twin");
  await ok(evidence(repo, ["ingest", "case", twin, "--run", run_id]), "ingest twin");
  assert.equal(caseResolver(dir)("TC-001"), null, "two admitted identities for one id: fail-closed");
  assert.equal(caseResolver(dir)("TC-002").case_sha256, admitted["TC-002_home-footer.md"][0]);
  // tamper: the admission's classification flipped in place ⇒ the artifact no longer verifies
  const path = join(dir, "admissions", `${admitted["TC-002_home-footer.md"][0]}.json`);
  const bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace('"classification":"admitted-heuristic"', '"classification":"proposal"'));
  assert.notEqual(readFileSync(path, "utf8"), bytes, "the fixture edit took");
  assert.throws(() => caseResolver(dir)("TC-002"), (err) => err.code === 5 && err.token === `INCONSISTENT(admissions/${admitted["TC-002_home-footer.md"][0]})`);
  assert.ok(paths["TC-001_login-headers.md"]);
});

const IMPORT_SHA = "a".repeat(64);
