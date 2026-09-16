// TASK-027 — `verify.mjs all --finding <id> --base <oid> --head <oid>
// [--receipts <dir>] [--timeout-s <n>]` (plan §4.2 row `all`, §5 TASK-027,
// TL-6 two-pass; spec §6.4 steps 1–8, §12 fixtures; US-018 AC-1…AC-7, US-015
// AC-5). Every repo is the fixture product (fixtures/repo/build.mjs) with the
// finding gated by the real pipeline; every `verify all` is spawned through
// the CLI harness so the exit code, the stdout grammar and the artifacts are
// what a lead sees.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { walk } from "./fsx.mjs";
import { join } from "node:path";
import { artifactId, readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_FIXED, DB_STILL_VULNERABLE, FINDING_PATH, HELPER_SKIP, buildRepo, commit, fixtureRecord, gateFinding, setRecord } from "../fixtures/repo/build.mjs";
import { evaluate } from "./evaluate.mjs";
import { validate } from "./schema.mjs";
import { VERDICT_PATTERN } from "./tokens.mjs";

after(cleanupAll);

const HEX64 = /^[0-9a-f]{64}$/;
const OID = /^[0-9a-f]{40}$/;
const VERDICT_LINE = /^VERDICT (.+) finding=([0-9a-f]{64}) base=([0-9a-f]{40}) head=([0-9a-f]{40}) tested_tree=([0-9a-f]{64}|same-as-head) verify=([0-9a-f]{64})$/;
const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) seq=([0-9]+) kind=verify base=([0-9a-f]{40}) head=([0-9a-f]{40})$/;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=subject files=([0-9]+)$/;

const verify = (repo, args, env = ENV) => runScript("verify", args, { cwd: repo, env, timeoutMs: 120_000 });
const evidence = (repo, args) => runScript("evidence", args, { cwd: repo, env: ENV });
const register = (repo, args) => runScript("register", args, { cwd: repo, env: ENV });

/** Parse a successful `verify all` run: the run id, the lines, the VERDICT and the verify.json artifact. */
function parseAll(repo, r) {
  assert.equal(r.code, 0, `verify all: ${r.stdout}${r.stderr}`);
  const lines = r.stdout.trimEnd().split("\n");
  const run = RUN_LINE.exec(lines[0]);
  assert.ok(run, `RUN line first: ${lines[0]}`);
  const last = VERDICT_LINE.exec(lines.at(-1));
  assert.ok(last, `VERDICT line last: ${lines.at(-1)}`);
  const run_id = run[1];
  const dir = runDir(repo, run_id);
  const artifact = readArtifact(join(dir, "verify.json"), { kind: "verify" });
  assert.equal(artifact.envelope.self_sha256, last[6], "verify=<sha256> is verify.json's identity");
  const line = (prefix) => lines.find((l) => l.startsWith(prefix));
  return { run_id, seq: Number(run[2]), dir, lines, line, verdict: last[1], tested_tree: last[5], verify_sha256: last[6], artifact, payload: artifact.payload };
}

/** A fixture repo with the finding gated at base, ready for a head commit. */
async function gatedFixture(over) {
  const { repo, base } = buildRepo(over === undefined ? {} : { record: fixtureRecord(over) });
  const gated = await gateFinding(repo);
  return { repo, base, ...gated };
}

/** Drop a payload-only receipt into the agent drop-box of `run_id` (TL-4). */
function drop(repo, run_id, name, payload) {
  const box = join(repo, ST, "receipts", run_id);
  mkdirSync(box, { recursive: true });
  writeFileSync(join(box, name), `${JSON.stringify(payload, null, 2)}\n`);
  return join(ST, "receipts", run_id);
}

const listTree = (dir) => (existsSync(dir) ? walk(dir) : []);

// --- AC-1 ---------------------------------------------------------------------------

test("branch COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const untouched = commit(repo, { "README.md": "# docs only\n" }, "docs");
  const a = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", untouched]));
  assert.equal(a.line("BRANCH "), "BRANCH PATH-UNTOUCHED");
  assert.equal(a.payload.branch, "PATH-UNTOUCHED");
  assert.equal(a.verdict, "UNVERIFIED-INDETERMINATE(fix-review)", "pass 1 has no receipt; branch is recorded, not yet the verdict");

  const fixed = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const b = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", fixed]));
  assert.equal(b.line("BRANCH "), "BRANCH COMMITTED");
  assert.equal(b.payload.branch, "COMMITTED");

  // head on a line of history that does not descend from base
  const { git } = await import("../fixtures/cli/harness.mjs");
  git(repo, ["checkout", "-q", "-b", "sibling", base]);
  const sibling = commit(repo, { [FINDING_PATH]: DB_FIXED, "README.md": "sibling\n" }, "sibling fix");
  git(repo, ["checkout", "-q", "main"]);
  const c = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", fixed, "--head", sibling]));
  assert.equal(c.line("BRANCH "), "BRANCH NOT-COMMITTED");
  assert.equal(c.payload.branch, "NOT-COMMITTED");
  assert.equal(c.payload.base_oid, fixed);
  assert.equal(c.payload.head_oid, sibling);
});

// --- AC-2 ---------------------------------------------------------------------------

test("wrong-head worktree: dirty test helper in the main tree has no effect; tests fail in the clean worktree", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_STILL_VULNERABLE }, "touches the file, keeps the bug");
  writeFileSync(join(repo, "test-helper.mjs"), HELPER_SKIP); // in the main tree the runner would exit 0
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(r.payload.tests.result, "TESTS_FAIL");
  assert.equal(r.payload.tests.exit_code, 1);
  assert.equal(r.payload.tests.output_redacted, "1 failing: sql is string-built\n");
  assert.match(r.payload.tree_before, OID);
  assert.equal(r.line("TREE-BEFORE "), `TREE-BEFORE ${r.payload.tree_before}`);
  assert.equal(r.payload.tested_tree, "same-as-head");
  assert.equal(readFileSync(join(repo, "test-helper.mjs"), "utf8"), HELPER_SKIP, "the main tree is never touched");
  assert.equal(readFileSync(join(repo, FINDING_PATH), "utf8"), DB_STILL_VULNERABLE);
  // the worktree is gone
  const { git } = await import("../fixtures/cli/harness.mjs");
  assert.equal(git(repo, ["worktree", "list"]).split("\n").length, 1, "only the main work tree remains");
});

// --- AC-3 ---------------------------------------------------------------------------

test("install modifying a tracked helper ⇒ install-modified-tree", async () => {
  const { repo, base, finding_id } = await gatedFixture({ execute_project_tests: { argv: ["node", "test-runner.mjs"], timeout_s: 60, install: { argv: ["node", "install-edit.mjs"] } } });
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(r.line("INSTALL "), "INSTALL ran tracked_changes=1 untracked=2 bytes=" + r.payload.install.untracked_bytes);
  assert.deepEqual(r.payload.install.tracked_changes, ["test-helper.mjs"]);
  assert.equal(r.payload.install.allow_tracked_changes, false);
  assert.equal(r.payload.tests.result, "TESTS_INDETERMINATE");
  assert.equal(r.payload.tests.reason, "install-modified-tree");
  assert.equal(r.line("TESTS "), "TESTS TESTS_INDETERMINATE(install-modified-tree)");
  assert.equal(r.tested_tree, "same-as-head");
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(tests)", "an unavailable tests check names the verdict (§6.4 step 7 completeness)");
});

test("allow_tracked_changes:true ⇒ tested_tree recorded and named in VERDICT", async () => {
  const { repo, base, finding_id } = await gatedFixture({ execute_project_tests: { argv: ["node", "test-runner.mjs"], timeout_s: 60, install: { argv: ["node", "install-edit.mjs"], allow_tracked_changes: true } } });
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.deepEqual(r.payload.install.tracked_changes, ["test-helper.mjs"]);
  assert.equal(r.payload.install.allow_tracked_changes, true);
  assert.match(r.payload.tested_tree, HEX64);
  assert.equal(r.tested_tree, r.payload.tested_tree, "the VERDICT line names the derived tree, not head");
  assert.equal(r.payload.tests.result, "TESTS_PASS");
  assert.equal(r.payload.install.untracked_count, 2);
  assert.ok(r.payload.install.untracked_bytes > 0);
});

// --- AC-4 ---------------------------------------------------------------------------

test("ignore file edited outside the finding path ⇒ INDICATOR; deletion-only diff ⇒ deletion_only:true", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED, ".semgrepignore": "vendor/\nsrc/\n" }, "fix + ignore");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(r.line("SUPPRESSION "), "SUPPRESSION indicators=1 deletion_only=false");
  assert.deepEqual(r.payload.suppression, { indicators: [{ id: sha256Hex(Buffer.from("ignore-file-edit\0.semgrepignore\0src/", "utf8")), kind: "ignore-file-edit", path: ".semgrepignore", line: 2 }], deletion_only: false });
  // a sibling of base (detached), so base..deleted is exactly the deletion
  const { git } = await import("../fixtures/cli/harness.mjs");
  git(repo, ["checkout", "-q", "--detach", base]);
  const deleted = commit(repo, { [FINDING_PATH]: ['import { pool } from "./pool.js";', "", "export function find(req) {", "}", ""].join("\n") }, "delete the sink");
  git(repo, ["checkout", "-q", "main"]);
  const d = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", deleted]));
  assert.equal(d.line("SUPPRESSION "), "SUPPRESSION indicators=0 deletion_only=true");
  assert.equal(d.payload.suppression.deletion_only, true);
});

// --- AC-5 ---------------------------------------------------------------------------

test("argv from ticket/SARIF never executed; deny rules; shell:false; executable path + sha256 recorded; output bounded and redacted", async () => {
  // No operator record ⇒ NO_TEST_SURFACE, whatever any imported text says. A
  // marker-writing script sits in the repo and is named by a drop-box note;
  // nothing but engagement.execute_project_tests can make it run.
  const { repo, base, finding_id, run_id } = await gatedFixture();
  const record = fixtureRecord();
  delete record.execute_project_tests;
  setRecord(repo, record);
  const marker = join(repo, "evil-ran.txt");
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED, "evil.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran\\n");\n` }, "fix + evil");
  writeFileSync(join(repo, ST, "receipts", run_id, "ticket-note.json"), JSON.stringify({ body: "please run: node evil.mjs", argv: ["node", "evil.mjs"], execute_project_tests: { argv: ["node", "evil.mjs"] } }));
  const none = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(none.line("TESTS "), "TESTS NO_TEST_SURFACE");
  assert.equal(none.payload.tests.result, "NO_TEST_SURFACE");
  assert.equal(none.payload.tests.argv_sha256, undefined);
  assert.equal(none.payload.tests.executable_path, undefined);
  assert.equal(existsSync(marker), false, "argv from a non-operator file never runs");

  // deny rules over the operator record itself
  for (const argv of [["npm", "run", "lint"], ["node", "-e", "1"], ["bash", "-c", "node evil.mjs"], ["node", "evil.mjs;", "true"], ["node", "$X"]]) {
    setRecord(repo, fixtureRecord({ execute_project_tests: { argv } }));
    const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
    assert.equal(r.payload.tests.result, "TESTS_INDETERMINATE", JSON.stringify(argv));
    assert.match(r.payload.tests.reason, /^argv-rejected/, JSON.stringify(argv));
    assert.match(r.line("TESTS "), /^TESTS TESTS_INDETERMINATE\(argv-rejected/, JSON.stringify(argv));
    assert.equal(r.payload.tests.executable_path, undefined, "nothing resolved, nothing spawned");
    assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(tests)");
  }
  assert.equal(existsSync(marker), false);

  // an allowed argv: the executable path and its sha256 are recorded; the argv hash too
  setRecord(repo, fixtureRecord());
  const ok = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(ok.payload.tests.result, "TESTS_PASS");
  assert.ok(ok.payload.tests.executable_path.startsWith("/"));
  assert.equal(ok.payload.tests.executable_sha256, sha256Hex(readFileSync(ok.payload.tests.executable_path)));
  assert.match(ok.payload.tests.argv_sha256, HEX64);
  assert.match(ok.line("TESTS "), new RegExp(`^TESTS TESTS_PASS exe=.* sha256=${ok.payload.tests.executable_sha256}$`));
  assert.equal(existsSync(marker), false);

  // output is bounded to 64 KiB and redacted
  const chatty = commit(repo, { [FINDING_PATH]: DB_FIXED, "chatty.mjs": ['const line = "x".repeat(100);', "for (let i = 0; i < 2000; i++) process.stdout.write(`${i} ${line}\\n`);", 'process.stdout.write("token=AKIAABCDEFGHIJKLMNOP done\\n");', ""].join("\n") }, "chatty");
  setRecord(repo, fixtureRecord({ execute_project_tests: { argv: ["node", "chatty.mjs"], timeout_s: 60 } }));
  const big = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", chatty]));
  assert.equal(big.payload.tests.result, "TESTS_PASS");
  assert.ok(Buffer.byteLength(big.payload.tests.output_redacted) <= 64 * 1024 + 64, `bounded: ${Buffer.byteLength(big.payload.tests.output_redacted)}`);
  assert.match(big.payload.tests.output_redacted, /<REDACTED:aws-key> done\n$/);
  assert.doesNotMatch(readFileSync(join(big.dir, "verify.json"), "utf8"), /AKIAABCDEFGHIJKLMNOP/);
  assert.doesNotMatch(readFileSync(join(big.dir, "report.md"), "utf8"), /AKIAABCDEFGHIJKLMNOP/);
});

// --- AC-6 / TL-6 --------------------------------------------------------------------

test("pass 1: fix-review packet built from the worktree, prints PACKET and NEXT, verdict UNVERIFIED-INDETERMINATE(fix-review), run COMMITTED", async () => {
  const { repo, base, finding_id, finding } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  const packetLine = PACKET_LINE.exec(r.line("PACKET "));
  assert.ok(packetLine, r.line("PACKET "));
  assert.ok(r.lines.indexOf("NEXT: dispatch security-reviewer fix-review") > r.lines.indexOf(r.line("PACKET ")), "NEXT follows PACKET");
  const packetPath = join(repo, packetLine[1]);
  const packet = readArtifact(packetPath, { kind: "packet" });
  assert.equal(packet.envelope.self_sha256, packetLine[2]);
  assert.equal(packet.envelope.run_id, r.run_id);
  assert.equal(r.payload.packet_sha256, packetLine[2]);
  assert.equal(packet.payload.kind, "subject");
  assert.deepEqual(packet.payload.subject_ids, [finding_id]);
  // the finding's file at head: side head, the blob oid at head, the cited ranges (clamped to the file at head)
  const { git } = await import("../fixtures/cli/harness.mjs");
  assert.equal(packet.payload.files.length, 1);
  const file = packet.payload.files[0];
  assert.equal(file.path, FINDING_PATH);
  assert.equal(file.side, "head");
  assert.equal(file.oid, git(repo, ["rev-parse", `${head}:${FINDING_PATH}`]));
  assert.deepEqual(finding.lines, [3, 4]);
  assert.deepEqual(file.ranges, [[3, 4], [4, 4]], "the finding's primary + typed ranges, at head (DB_FIXED has 4 normalised lines)");
  assert.match(file.range_hmac, HEX64);
  assert.equal(validate("packet", packet.payload).length, 0);
  // the verdict and the run's state
  assert.equal(r.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.deepEqual(r.payload.receipts, []);
  assert.deepEqual(r.payload.evaluation, evaluate((({ evaluation, ...raw }) => raw)(r.payload)));
  assert.equal(existsSync(join(r.dir, "COMMITTED")), true, "the run is COMMITTED (build-report ran in-process)");
  assert.equal(existsSync(join(r.dir, "report.md")), true);
  assert.equal(readFileSync(join(r.dir, "COMMITTED"), "utf8"), `${readArtifact(join(r.dir, "manifest.json"), { kind: "manifest" }).envelope.self_sha256}\n`);
  assert.equal(r.line("REGISTER: "), undefined, "no --receipts ⇒ consume-verdict is not called");
  // a second pass 1 is a new seq with the same packet identity (TL-6)
  const again = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  assert.equal(again.seq, r.seq + 1);
  assert.equal(again.payload.packet_sha256, r.payload.packet_sha256, "packet identity is deterministic across passes");
});

// --- pass 2 --------------------------------------------------------------------------

async function pass1(over) {
  const f = await gatedFixture(over);
  const head = commit(f.repo, { [FINDING_PATH]: DB_FIXED, ".semgrepignore": "vendor/\nsrc/legacy/\n" }, "fix + ignore edit");
  const p1 = parseAll(f.repo, await verify(f.repo, ["all", "--finding", f.finding_id, "--base", f.base, "--head", head]));
  assert.equal(p1.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.equal(p1.payload.suppression.indicators.length, 1);
  return { ...f, head, p1 };
}

test("pass 2 with an authored not-refound receipt + acks ⇒ VERIFIED; new seq; pass-1 run untouched", async () => {
  const { repo, base, head, finding_id, p1 } = await pass1();
  const add = await register(repo, ["add", "--subject", finding_id, "--priority", "p1", "--title", "sql built from req.query.id", "--run", p1.run_id]);
  assert.equal(add.code, 0, add.stdout + add.stderr);
  const packet_sha256 = p1.payload.packet_sha256;
  const indicator = p1.payload.suppression.indicators[0].id;
  const box = drop(repo, p1.run_id, "fix-review.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id });
  drop(repo, p1.run_id, "ack-1.json", { type: "ack", subject_id: finding_id, packet_sha256, assertion: { indicator_id: indicator }, reviewer_run_id: p1.run_id });
  const before = { files: listTree(p1.dir), verify: readFileSync(join(p1.dir, "verify.json")) };

  const p2 = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", box]));
  assert.equal(p2.verdict, "VERIFIED");
  assert.equal(p2.seq, p1.seq + 1, "a fresh run");
  assert.notEqual(p2.run_id, p1.run_id);
  assert.equal(p2.payload.packet_sha256, packet_sha256, "the pass-1 receipt names the pass-2 packet");
  assert.equal(p2.payload.row_status_at_start, "open");
  assert.equal(p2.payload.receipts.length, 2);
  const fix = p2.payload.receipts.find((x) => x.type === "fix-review");
  const ack = p2.payload.receipts.find((x) => x.type === "ack");
  assert.deepEqual(fix, { sha256: fix.sha256, type: "fix-review", assertion: "not-refound", applied: true });
  assert.deepEqual(ack, { sha256: ack.sha256, type: "ack", indicator_id: indicator, applied: true });
  assert.deepEqual(p2.payload.evaluation, { verdict: "VERIFIED", refound_observed: false, ack_refs: [ack.sha256], events: [] });
  // the receipts were admitted into the pass-2 run under their identities (closed over by build-report)
  for (const x of p2.payload.receipts) {
    const art = readArtifact(join(p2.dir, "receipts", `${x.sha256}.json`), { kind: "receipt" });
    assert.equal(art.envelope.run_id, p2.run_id);
    assert.equal(art.payload.reviewer_run_id, p1.run_id, "the reviewer's word is kept verbatim");
  }
  assert.ok(p2.lines.some((l) => l.startsWith("RECEIPT admitted sha256=")), "admission lines are printed");
  assert.equal(existsSync(join(p2.dir, "COMMITTED")), true);
  assert.equal(p2.lines.at(-1).startsWith("VERDICT VERIFIED "), true);
  // consume-verdict ran: the row is fixed with the ack ref
  assert.match(p2.line("CONSUMED "), new RegExp(`^CONSUMED VERIFIED row=R-0001 verify=${p2.verify_sha256}$`));
  const projection = JSON.parse(readFileSync(join(repo, ST, "register", "projection.json"), "utf8"));
  assert.equal(projection.rows["R-0001"].status, "fixed");
  const events = readFileSync(join(repo, ST, "register", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const fixedEvent = events.find((e) => e.event === "fixed");
  assert.ok(fixedEvent, "fixed event appended");
  assert.deepEqual(fixedEvent.payload.ack_refs, [ack.sha256]);
  assert.equal(fixedEvent.payload.verify_sha256, p2.verify_sha256);
  assert.equal(fixedEvent.payload.last_verified_run, p2.run_id);
  // pass 1 untouched
  assert.deepEqual(listTree(p1.dir), before.files);
  assert.ok(readFileSync(join(p1.dir, "verify.json")).equals(before.verify));
  assert.equal(existsSync(join(repo, ST, "receipts", p1.run_id, "fix-review.json")), true, "the drop-box is never written by a script (TL-4)");
});

test("pass 2 with a refound receipt whose packet_sha256 is wrong ⇒ recorded applied:false, verdict UNVERIFIED-INDETERMINATE(fix-review), no regression-observed event", async () => {
  const { repo, base, head, finding_id, p1 } = await pass1();
  const add = await register(repo, ["add", "--subject", finding_id, "--priority", "p1", "--title", "t", "--run", p1.run_id]);
  assert.equal(add.code, 0, add.stdout + add.stderr);
  // first make the row `fixed` through a real VERIFIED pass, so a refound observation would be a regression
  const packet_sha256 = p1.payload.packet_sha256;
  const indicator = p1.payload.suppression.indicators[0].id;
  const box = drop(repo, p1.run_id, "fix-review.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id });
  drop(repo, p1.run_id, "ack-1.json", { type: "ack", subject_id: finding_id, packet_sha256, assertion: { indicator_id: indicator }, reviewer_run_id: p1.run_id });
  const p2 = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", box]));
  assert.equal(p2.verdict, "VERIFIED");

  // a later dispatch: a refound receipt that names a packet this run never built
  const wrongBox = drop(repo, p2.run_id, "fix-review.json", { type: "fix-review", subject_id: finding_id, packet_sha256: "e".repeat(64), assertion: "refound", reviewer_run_id: p2.run_id });
  const p3 = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", wrongBox]));
  assert.equal(p3.payload.row_status_at_start, "fixed");
  assert.equal(p3.payload.receipts.length, 1);
  const bad = p3.payload.receipts[0];
  assert.equal(bad.type, "fix-review");
  assert.equal(bad.assertion, "refound");
  assert.equal(bad.applied, false);
  assert.equal(bad.not_applied_reason, "unknown packet");
  assert.match(bad.sha256, HEX64);
  assert.equal(existsSync(join(p3.dir, "receipts", `${bad.sha256}.json`)), false, "a receipt that fails validation is recorded, never admitted into the run");
  assert.equal(p3.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.deepEqual(p3.payload.evaluation, { verdict: "UNVERIFIED-INDETERMINATE(fix-review)", refound_observed: false, ack_refs: [], events: [] });
  assert.equal(existsSync(join(p3.dir, "COMMITTED")), true, "still a COMMITTED run: the verdict is a result");
  assert.match(p3.line("CONSUMED "), /^CONSUMED UNVERIFIED-INDETERMINATE\(fix-review\) row=R-0001 /);
  const events = readFileSync(join(repo, ST, "register", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.some((e) => e.event === "regression-observed"), false, "no observation from a not-applied refound (§6.4 P5)");
  assert.equal(events.at(-1).event, "verify-observed");
  const projection = JSON.parse(readFileSync(join(repo, ST, "register", "projection.json"), "utf8"));
  assert.equal(projection.rows["R-0001"].status, "fixed", "the row stays fixed: verify-observed only");
});

test("pass 2: a receipt from another finding's dispatch, a scope-kind target, a malformed file and a duplicate copy are each recorded or skipped, never dropped silently; REGISTER: no row when the register has none", async () => {
  const { repo, base, head, finding_id, p1 } = await pass1();
  const packet_sha256 = p1.payload.packet_sha256;
  const box = drop(repo, p1.run_id, "fix-review.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id });
  drop(repo, p1.run_id, "fix-review-copy.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id });
  drop(repo, p1.run_id, "other-subject.json", { type: "fix-review", subject_id: "f".repeat(64), packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id });
  drop(repo, p1.run_id, "foreign-run.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "refound", reviewer_run_id: "0123456789ab-0099" });
  drop(repo, p1.run_id, "with-state.json", { type: "fix-review", subject_id: finding_id, packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id, state: "VERIFIED" });
  drop(repo, p1.run_id, "vuln-review.json", { type: "vulnerability-review", subject_id: finding_id, packet_sha256, assertion: "confirmed", reviewer_run_id: p1.run_id });
  writeFileSync(join(repo, box, "notes.txt"), "not a receipt\n");
  const r = await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", box]);
  const p2 = parseAll(repo, r);
  const rows = p2.payload.receipts;
  const applied = rows.filter((x) => x.applied);
  assert.equal(applied.length, 1, JSON.stringify(rows));
  assert.equal(applied[0].assertion, "not-refound");
  const reasons = rows.filter((x) => !x.applied).map((x) => x.not_applied_reason).sort();
  assert.deepEqual(reasons, ["forbidden field state", "reviewer_run_id != run", "subject_id not in packet.subject_ids"]);
  assert.equal(rows.length, 4, "the duplicate copy is the same receipt (one row); notes.txt and the vulnerability-review are not fix-review/ack receipts");
  assert.match(r.stderr, /notes\.txt/);
  assert.match(r.stderr, /vuln-review\.json/);
  // one indicator, no ack ⇒ suppression
  assert.equal(p2.verdict, "UNVERIFIED-SUPPRESSION(1 unacked)");
  assert.equal(p2.line("REGISTER: "), "REGISTER: no row for finding");
  assert.equal(p2.payload.row_status_at_start, "none");
  assert.equal(existsSync(join(repo, ST, "register", "events.jsonl")), false, "nothing appended");
});

// --- AC-7 ---------------------------------------------------------------------------

test("verify.json payload complete; last stdout line matches the VERDICT grammar", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head, "--timeout-s", "30"]));
  assert.deepEqual(validate("verify", r.payload), []);
  assert.deepEqual(Object.keys(r.payload).sort(), ["finding_id", "base_oid", "head_oid", "branch", "tree_before", "install", "tested_tree", "suppression", "tests", "packet_sha256", "receipts", "row_status_at_start", "evaluation"].sort(), "exactly the verify.schema.json keys (canonical order on disk)");
  assert.equal(r.payload.finding_id, finding_id);
  assert.equal(r.payload.base_oid, base);
  assert.equal(r.payload.head_oid, head);
  assert.equal(r.payload.tests.result, "TESTS_PASS");
  assert.match(r.payload.tests.argv_sha256, HEX64);
  assert.match(r.payload.tests.executable_sha256, HEX64);
  assert.match(r.payload.tree_before, OID);
  assert.equal(r.payload.tested_tree, "same-as-head");
  assert.deepEqual(r.payload.install, { ran: false, allow_tracked_changes: false, tracked_changes: [], untracked_count: 0, untracked_bytes: 0 });
  assert.equal(r.artifact.envelope.self_sha256, artifactId(r.payload));
  assert.equal(r.artifact.envelope.kind, "verify");
  const last = r.lines.at(-1);
  assert.match(last, VERDICT_LINE);
  assert.match(r.verdict, VERDICT_PATTERN);
  assert.equal(last, `VERDICT ${r.verdict} finding=${finding_id} base=${base} head=${head} tested_tree=same-as-head verify=${r.verify_sha256}`);
  // the stdout order of the step lines follows the spec's step order
  const order = ["RUN ", "BRANCH ", "TREE-BEFORE ", "INSTALL ", "SUPPRESSION ", "TESTS ", "PACKET ", "NEXT: ", `WROTE ${ST}/runs/${r.run_id}/verify.json`, "REPORT ", "MANIFEST ", "COMMITTED", "VERDICT "].map((p) => r.lines.findIndex((l) => l.startsWith(p)));
  assert.deepEqual([...order].sort((a, b) => a - b), order, r.lines.join("\n"));
  assert.ok(order.every((i) => i >= 0), r.lines.join("\n"));
  // G-1: nothing under payload carries a timestamp, a temp path or a pid
  const text = JSON.stringify(r.payload);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(text, /security-verify-|\/tmp\/|\/var\/folders\//);
});

// --- US-015 AC-5 ---------------------------------------------------------------------

test("REVIEW_REFUTED finding ⇒ exit 4 UNVERIFIED-REFUTED-FINDING, no run allocated", async () => {
  const { repo, base, finding_id, run_id } = await gatedFixture();
  const p = await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", finding_id]);
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  const file = join(drop(repo, run_id, "refuted.json", { type: "vulnerability-review", subject_id: finding_id, packet_sha256, assertion: "refuted", reviewer_run_id: run_id }), "refuted.json");
  const v = await evidence(repo, ["receipt", "validate", "--run", run_id, file]);
  assert.equal(v.code, 0, v.stdout + v.stderr);
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const ledgerBefore = readFileSync(join(repo, ST, "ledger", "index.json"), "utf8");
  const r = await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "UNVERIFIED-REFUTED-FINDING");
  assert.equal(readFileSync(join(repo, ST, "ledger", "index.json"), "utf8"), ledgerBefore, "no run allocated");
  assert.deepEqual(readdirSync(join(repo, ST, "runs")), [run_id]);
});

test("unknown finding ⇒ exit 2 UNKNOWN-FINDING before any allocation; argv guards", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const ledgerBefore = readFileSync(join(repo, ST, "ledger", "index.json"), "utf8");
  const unknown = await verify(repo, ["all", "--finding", "a".repeat(64), "--base", base, "--head", head]);
  assert.equal(unknown.code, 2, unknown.stdout + unknown.stderr);
  assert.equal(unknown.stdout.trim(), "UNKNOWN-FINDING");
  for (const [argv, why] of [
    [["all"], /--finding/],
    [["all", "--finding", finding_id], /--base/],
    [["all", "--finding", finding_id, "--base", base], /--head/],
    [["all", "--finding", "nope", "--base", base, "--head", head], /--finding/],
    [["all", "--finding", finding_id, "--base", "nope", "--head", head], /--base/],
    [["all", "--finding", finding_id, "--base", base, "--head", "nope"], /--head/],
    [["all", "--finding", finding_id, "--base", base, "--head", head, "--timeout-s", "0"], /--timeout-s/],
    [["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", "../outside"], /outside the work tree/],
    [["all", "--finding", finding_id, "--base", base, "--head", head, "--receipts", "no-such-dir"], /--receipts/],
    [["all", "--finding", finding_id, "--base", base, "--head", head, "extra"], /unexpected argument/],
  ]) {
    const r = await verify(repo, argv);
    assert.equal(r.code, 2, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^USAGE\(verify all: /, argv.join(" "));
    assert.match(r.stdout, why, argv.join(" "));
  }
  assert.equal(readFileSync(join(repo, ST, "ledger", "index.json"), "utf8"), ledgerBefore, "no run allocated by any refusal");
});

// --- PM-log items -------------------------------------------------------------------

test("evaluate is wired into verify.mjs and reads its file through ctx.input(): a verify.json outside the work tree is USAGE, one inside evaluates", async () => {
  const { repo, base, finding_id } = await gatedFixture();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  const r = parseAll(repo, await verify(repo, ["all", "--finding", finding_id, "--base", base, "--head", head]));
  const inside = await verify(repo, ["evaluate", join(ST, "runs", r.run_id, "verify.json")]);
  assert.equal(inside.code, 0, inside.stdout + inside.stderr);
  assert.deepEqual(JSON.parse(inside.stdout), r.payload.evaluation);
  const outside = await verify(repo, ["evaluate", join("..", "verify.json")]);
  assert.equal(outside.code, 2);
  assert.match(outside.stdout, /^USAGE\(evaluate: cannot read \.\.\/verify\.json \(outside the work tree\)\)/);
  const raw = await verify(repo, ["evaluate", "--raw", JSON.stringify((({ evaluation, ...rest }) => rest)(r.payload))]);
  assert.equal(raw.code, 0);
  assert.deepEqual(JSON.parse(raw.stdout), r.payload.evaluation);
});

test("guardrails: verify all spawns nothing but git (through git.mjs) and the operator's argv (verify-steps); no clock, no network, no console; tokens come from tokens.mjs", () => {
  const here = new URL(".", import.meta.url).pathname;
  const cmd = readFileSync(join(here, "cmd-verify-all.mjs"), "utf8");
  const steps = readFileSync(join(here, "verify-steps.mjs"), "utf8");
  for (const src of [cmd, steps]) {
    assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1");
    assert.doesNotMatch(src, /node:http|node:net|node:dns|fetch\(/, "G-14");
    assert.doesNotMatch(src, /console\./, "G-4");
    assert.doesNotMatch(src, /shell\s*:\s*true|execSync|(?<![A-Za-z0-9_.])exec\s*\(/, "G-6");
  }
  assert.doesNotMatch(cmd, /node:child_process|spawn\(/, "the command itself spawns nothing");
  assert.match(steps, /spawn\(/, "the test step is the one spawn outside git.mjs");
  assert.match(steps, /detached:\s*true/, "process-group kill");
  assert.match(cmd, /from "\.\/tokens\.mjs"/);
  assert.doesNotMatch(cmd, /"NEXT: dispatch|"VERDICT |"UNKNOWN-FINDING"|"UNVERIFIED-REFUTED-FINDING"/, "G-13: spellings live in tokens.mjs");
  const entry = readFileSync(join(here, "..", "verify.mjs"), "utf8");
  assert.match(entry, /^\s*all: \(\) => import\("\.\/lib\/cmd-verify-all\.mjs"\)/m);
  assert.match(entry, /^\s*evaluate: \(\) => import\("\.\/lib\/cmd-evaluate\.mjs"\)/m);
});
