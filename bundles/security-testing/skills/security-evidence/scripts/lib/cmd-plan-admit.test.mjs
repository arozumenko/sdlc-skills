// TASK-042 — lib/cmd-plan-admit.mjs: the refusal matrix and the guardrails
// of `plan.mjs admit` (spec §9.1, D7, P5; plan §5 TASK-042; G-4, G-7, G-10).
// The six named verification tests are in cmd-plan.test.mjs; this file pins
// the order of refusals (nothing written before every check passes), the
// candidate-location rule (PM ruling: `<st>/cases/<slug>/`, never `tasks/`),
// the write-once record, the stderr notes on non-canonical ids, the
// receipt binding failures and that a credential in a step never reaches
// stdout or the record in the clear.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { admitReceipt, caseText, casePacket, cleanupAll, commitAll, PASSIVE_ROWS, plan, readyRepo, runDir, scopedRun, ST, writeCase } from "../fixtures/plan/helpers.mjs";
import { caseSha256 } from "./admission-core.mjs";

after(cleanupAll);

const admissionsOf = (repo, run_id) => (existsSync(join(runDir(repo, run_id), "admissions")) ? readdirSync(join(runDir(repo, run_id), "admissions")) : []);

test("argv and run refusals, in order, nothing written: --run shape, one positional, --receipt shape, unknown run, RUN-COMMITTED, INCOMPLETE(engagement)", async () => {
  const repo = readyRepo();
  const rel = writeCase(repo, "TC-001_headers.md", caseText("TC-001", PASSIVE_ROWS));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  for (const [args, code, re] of [
    [["admit", rel], 2, /^USAGE\(admit: --run <id> is required\)$/m],
    [["admit", "--run", "nope", rel], 2, /^USAGE\(admit: --run must be <12 hex>-<4 digits>, got nope\)$/m],
    [["admit", "--run", run_id], 2, /^USAGE\(admit: <case\.md> is required\)$/m],
    [["admit", "--run", run_id, rel, "extra.md"], 2, /^USAGE\(admit: unexpected argument extra\.md\)$/m],
    [["admit", "--run", run_id, rel, "--receipt", "xyz"], 2, /^USAGE\(admit: --receipt must be a sha256\)$/m],
    [["admit", "--run", "abcdefabcdef-0099", rel], 2, /^USAGE\(admit: unknown run abcdefabcdef-0099\)$/m],
  ]) {
    const r = await plan(repo, args);
    assert.equal(r.code, code, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
  }
  assert.deepEqual(admissionsOf(repo, run_id), []);
  // a run without its engagement snapshot is incomplete for admission (the authority policy is the run's)
  const { renameSync } = await import("node:fs");
  renameSync(join(runDir(repo, run_id), "engagement.json"), join(runDir(repo, run_id), "engagement.json.away"));
  const incomplete = await plan(repo, ["admit", "--run", run_id, rel]);
  assert.equal(incomplete.code, 3);
  assert.equal(incomplete.stdout, "INCOMPLETE(engagement)\n");
  renameSync(join(runDir(repo, run_id), "engagement.json.away"), join(runDir(repo, run_id), "engagement.json"));
  writeFileSync(join(runDir(repo, run_id), "COMMITTED"), "sha256=0\n");
  const committed = await plan(repo, ["admit", "--run", run_id, rel]);
  assert.equal(committed.code, 2);
  assert.equal(committed.stdout, "RUN-COMMITTED\n");
  assert.deepEqual(admissionsOf(repo, run_id), []);
});

test("the case path: outside the work tree ⇒ USAGE; unreadable ⇒ USAGE; under tasks/ or anywhere but <st>/cases/ ⇒ USAGE naming the candidate location; a directory ⇒ USAGE", async () => {
  const repo = readyRepo();
  writeCase(repo, "TC-001_headers.md", caseText("TC-001", PASSIVE_ROWS));
  mkdirSync(join(repo, "tasks", "security-my-product-admitted"), { recursive: true });
  writeFileSync(join(repo, "tasks", "security-my-product-admitted", "TC-001_headers.md"), caseText("TC-001", PASSIVE_ROWS));
  writeFileSync(join(repo, "src", "TC-001_headers.md"), caseText("TC-001", PASSIVE_ROWS));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const outside = await plan(repo, ["admit", "--run", run_id, "../case.md"]);
  assert.equal(outside.code, 2);
  assert.equal(outside.stdout, "USAGE(admit: cannot read ../case.md (outside the work tree))\n");
  const underTasks = await plan(repo, ["admit", "--run", run_id, "tasks/security-my-product-admitted/TC-001_headers.md"]);
  assert.equal(underTasks.code, 2);
  assert.equal(underTasks.stdout, `USAGE(admit: candidate cases live under ${ST}/cases/<slug>/ as TC-NNN_<slug>.md, never under tasks/; got tasks/security-my-product-admitted/TC-001_headers.md)\n`);
  const elsewhere = await plan(repo, ["admit", "--run", run_id, "src/TC-001_headers.md"]);
  assert.equal(elsewhere.code, 2);
  assert.match(elsewhere.stdout, /^USAGE\(admit: candidate cases live under .*; got src\/TC-001_headers\.md\)$/m);
  const absent = await plan(repo, ["admit", "--run", run_id, join(ST, "cases", "my-product", "nope.md")]);
  assert.equal(absent.code, 2);
  assert.equal(absent.stdout, `USAGE(admit: cannot read ${ST}/cases/my-product/nope.md)\n`);
  const dir = await plan(repo, ["admit", "--run", run_id, join(ST, "cases", "my-product")]);
  assert.equal(dir.code, 2);
  assert.match(dir.stdout, /^USAGE\(admit: cannot read /);
  assert.deepEqual(admissionsOf(repo, run_id), []);
});

test("structure: a case without a Steps table, without frontmatter or with a bad id is SCHEMA-INVALID(case: …), exit 2, nothing written; a non-canonical id / file name is admitted with a stderr note", async () => {
  const repo = readyRepo();
  const noSteps = writeCase(repo, "TC-001_no-steps.md", "---\nid: TC-001\ntitle: x\n---\n\n# TC-001: x\n\n## Preconditions\n- none\n");
  const noFm = writeCase(repo, "TC-002_no-frontmatter.md", "# TC-002\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | Open `{{base_url}}` | ok |\n");
  const badId = writeCase(repo, "TC-003_bad-id.md", caseText("case-3", PASSIVE_ROWS));
  const secShape = writeCase(repo, "TC-SEC-004.md", caseText("TC-SEC-004", PASSIVE_ROWS));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  for (const [rel, re] of [
    [noSteps, /^SCHEMA-INVALID\(case: ## Steps table is missing or empty \(nothing to admit\)\)$/m],
    [noFm, /^SCHEMA-INVALID\(case: no frontmatter block/m],
    [badId, /^SCHEMA-INVALID\(case: id is missing or is not a TC id\)$/m],
  ]) {
    const r = await plan(repo, ["admit", "--run", run_id, rel]);
    assert.equal(r.code, 2, `${rel}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
  }
  assert.deepEqual(admissionsOf(repo, run_id), []);
  const r = await plan(repo, ["admit", "--run", run_id, secShape]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /classification=admitted-heuristic hits=0$/m);
  assert.match(r.stderr, /case id TC-SEC-004 is not TC-NNN; manual-qa's run-metrics readers match TC-<3 digits> only/);
  assert.match(r.stderr, /file name TC-SEC-004\.md is not TC-NNN_<slug>\.md/);
});

test("--dry-run (TASK-043, the G22 follow-up): prints the ADMISSION line and persists nothing — no admissions/ entry, no WROTE line, the hits named on stderr — so the route can be chosen before the write-once record; the same argv without it then writes the record", async () => {
  const repo = readyRepo();
  const rel = writeCase(repo, "TC-001_typing.md", caseText("TC-001", [...PASSIVE_ROWS, ["Type the email address into the Email field", "Value set"]]));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const dry = await plan(repo, ["admit", "--run", run_id, rel, "--dry-run"]);
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  const sha = caseSha256(readFileSync(join(repo, rel))).case_sha256;
  assert.equal(dry.stdout, `ADMISSION case=${sha} classification=proposal hits=1\n`, "the ADMISSION line only");
  assert.match(dry.stderr, /--dry-run — nothing persisted \(hits: unknown-operation@5\)/);
  assert.deepEqual(admissionsOf(repo, run_id), [], "nothing written");
  // the dry run left no record, so the reviewed route is still open in this run
  const packet = await casePacket(repo, run_id, [rel]);
  const receipt = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: sha, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id });
  const dryReviewed = await plan(repo, ["admit", "--run", run_id, rel, "--receipt", receipt, "--dry-run"]);
  assert.equal(dryReviewed.stdout, `ADMISSION case=${sha} classification=admitted-reviewed hits=1\n`);
  assert.deepEqual(admissionsOf(repo, run_id), []);
  const real = await plan(repo, ["admit", "--run", run_id, rel, "--receipt", receipt]);
  assert.equal(real.code, 0, real.stdout + real.stderr);
  assert.match(real.stdout, /^ADMISSION case=[0-9a-f]{64} classification=admitted-reviewed hits=1\nWROTE /);
  assert.deepEqual(admissionsOf(repo, run_id), [`${sha}.json`]);
  const withValue = await plan(repo, ["admit", "--run", run_id, rel, "--dry-run=yes"]);
  assert.equal(withValue.code, 2);
  assert.match(withValue.stdout, /^USAGE\(admit: --dry-run takes no value\)$/m);
});

test("write-once (G-10): the same case admitted twice is one record; the same case with a different route (a receipt) ⇒ 2 ADMISSION-EXISTS, the first record untouched", async () => {
  const repo = readyRepo();
  const rel = writeCase(repo, "TC-001_typing.md", caseText("TC-001", [...PASSIVE_ROWS, ["Type the email address into the Email field", "Value set"]]));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const first = await plan(repo, ["admit", "--run", run_id, rel]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /classification=proposal hits=1$/m);
  const sha = caseSha256(readFileSync(join(repo, rel))).case_sha256;
  const before = readFileSync(join(runDir(repo, run_id), "admissions", `${sha}.json`));
  const packet = await casePacket(repo, run_id, [rel]);
  const receipt = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: sha, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id });
  const again = await plan(repo, ["admit", "--run", run_id, rel, "--receipt", receipt]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.equal(again.stdout, "ADMISSION-EXISTS\n");
  assert.deepEqual(readFileSync(join(runDir(repo, run_id), "admissions", `${sha}.json`)), before, "nothing rewritten");
  // the reviewed route works in a fresh run (retry = new seq)
  const run2 = await scopedRun(repo);
  const packet2 = await casePacket(repo, run2, [rel]);
  const receipt2 = await admitReceipt(repo, run2, { type: "vulnerability-review", subject_id: sha, packet_sha256: packet2.sha256, assertion: "confirmed", reviewer_run_id: run2 });
  const reviewed = await plan(repo, ["admit", "--run", run2, rel, "--receipt", receipt2]);
  assert.equal(reviewed.code, 0, reviewed.stdout + reviewed.stderr);
  assert.match(reviewed.stdout, /classification=admitted-reviewed hits=1$/m);
  // a tampered record under the name ⇒ 5 INCONSISTENT(admissions/<sha>)
  const path = join(runDir(repo, run2), "admissions", `${sha}.json`);
  writeFileSync(path, readFileSync(path, "utf8").replace("admitted-reviewed", "admitted-heuristic"));
  const tampered = await plan(repo, ["admit", "--run", run2, rel, "--receipt", receipt2]);
  assert.equal(tampered.code, 5, tampered.stdout + tampered.stderr);
  assert.equal(tampered.stdout, `INCONSISTENT(admissions/${sha})\n`);
});

test("receipt binding: a mitigation-review on the case packet ⇒ 4 (type); two same-run vulnerability-reviews that disagree ⇒ REVIEW_INDETERMINATE ⇒ proposal; a receipt whose packet is gone ⇒ 5 INCONSISTENT(packets/<sha>)", async () => {
  const repo = readyRepo();
  const rel = writeCase(repo, "TC-001_typing.md", caseText("TC-001", [["Type the email address into the Email field", "Value set"]]));
  const other = writeCase(repo, "TC-002_other.md", caseText("TC-002", [["Press the Tab key", "Focus moves"]]));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const sha = caseSha256(readFileSync(join(repo, rel))).case_sha256;
  const packet = await casePacket(repo, run_id, [rel]);
  const mitigation = await admitReceipt(repo, run_id, { type: "mitigation-review", subject_id: sha, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id }, "m.json");
  const wrongType = await plan(repo, ["admit", "--run", run_id, rel, "--receipt", mitigation]);
  assert.equal(wrongType.code, 4, wrongType.stdout + wrongType.stderr);
  assert.equal(wrongType.stdout, "RECEIPT-MISMATCH(receipt type mitigation-review is not vulnerability-review)\n");
  const confirmed = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: sha, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id }, "c.json");
  await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: sha, packet_sha256: packet.sha256, assertion: "refuted", reviewer_run_id: run_id }, "r.json");
  const conflict = await plan(repo, ["admit", "--run", run_id, rel, "--receipt", confirmed]);
  assert.equal(conflict.code, 0, conflict.stdout + conflict.stderr);
  assert.match(conflict.stdout, /classification=proposal hits=2$/m, "the unknown step plus the review-not-confirmed hit");
  const record = readArtifact(join(runDir(repo, run_id), "admissions", `${sha}.json`), { kind: "admission" });
  assert.deepEqual(record.payload.lint_hits.at(-1), { rule: "review-not-confirmed", step: 0, text_redacted: "vulnerability-review: REVIEW_INDETERMINATE" });
  assert.deepEqual(admissionsOf(repo, run_id), [`${sha}.json`]);
  // the other case: its packet removed after the receipt was admitted ⇒ the run's own state is wrong
  const otherSha = caseSha256(readFileSync(join(repo, other))).case_sha256;
  const otherPacket = await casePacket(repo, run_id, [other]);
  const otherReceipt = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: otherSha, packet_sha256: otherPacket.sha256, assertion: "confirmed", reviewer_run_id: run_id }, "o.json");
  const { rmSync } = await import("node:fs");
  rmSync(join(repo, otherPacket.path));
  const gone = await plan(repo, ["admit", "--run", run_id, other, "--receipt", otherReceipt]);
  assert.equal(gone.code, 5, gone.stdout + gone.stderr);
  assert.equal(gone.stdout, `INCONSISTENT(packets/${otherPacket.sha256})\n`);
});

test("G-4: a credential inside a step is redacted in the record and never printed; a foreign host is a host-not-allowed hit; base_url_host comes from the run's engagement", async () => {
  const repo = readyRepo();
  const rel = writeCase(repo, "TC-001_secret.md", caseText("TC-001", [["Open https://evil.example.net/login?password=Hunter2Secret9", "Login page loads"], ...PASSIVE_ROWS]));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const r = await plan(repo, ["admit", "--run", run_id, rel]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /classification=proposal hits=1$/m);
  assert.ok(!(r.stdout + r.stderr).includes("Hunter2Secret9"));
  const sha = caseSha256(readFileSync(join(repo, rel))).case_sha256;
  const raw = readFileSync(join(runDir(repo, run_id), "admissions", `${sha}.json`), "utf8");
  assert.ok(!raw.includes("Hunter2Secret9"), "the record carries the redacted step text");
  const record = readArtifact(join(runDir(repo, run_id), "admissions", `${sha}.json`), { kind: "admission" });
  assert.deepEqual(record.payload.lint_hits.map((h) => [h.step, h.rule]), [[1, "host-not-allowed"]]);
  assert.match(record.payload.lint_hits[0].text_redacted, /<REDACTED:/);
  assert.equal(record.payload.assumptions.base_url_host, "staging.example.com");
});
