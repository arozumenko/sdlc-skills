// TASK-042 — `plan.mjs admit | propose` (plan §4.5, §5 TASK-042; spec §9.1
// "Admission", §9.4, D7, P5; US-034 AC-1…AC-4, US-038 AC-1…AC-2). The six
// verification tests the plan names, over real runs: every repo is a temp
// dir, every run is `run init` + `scope`, every case packet is the real
// `packet --kind subject --type case`, every receipt goes through `receipt
// validate` — the ids an admission names are the bundle's own. The refusal
// matrices live in cmd-plan-admit.test.mjs / cmd-plan-propose.test.mjs;
// `ta-prompt` is TASK-044's and stays the M1 stub (pinned at the end).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { admitReceipt, caseText, casePacket, cleanupAll, commitAll, PASSIVE_ROWS, plan, readyRepo, runDir, scopedRun, ST, writeCase } from "../fixtures/plan/helpers.mjs";
import { caseSha256, targetPolicySha256 } from "./admission-core.mjs";
import { validate } from "./schema.mjs";
import { REVIEW_INDETERMINATE, REVIEW_REFUTED } from "./tokens.mjs";

after(cleanupAll);

const OK_PROPOSAL = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "schemas", "proposal.ok.json"), "utf8"));
const ADMISSION_LINE = /^ADMISSION case=([0-9a-f]{64}) classification=(admitted-heuristic|admitted-reviewed|proposal) hits=([0-9]+)$/;

function proposalMd(repo, rel, frontmatter, prose = "Steps follow.") {
  const path = join(repo, rel);
  writeFileSync(path, `# Proposal\n\n\`\`\`json proposal\n${JSON.stringify(frontmatter, null, 2)}\n\`\`\`\n\n${prose}\n`);
  return rel;
}

function admissionOf(repo, run_id, case_sha256) {
  return readArtifact(join(runDir(repo, run_id), "admissions", `${case_sha256}.json`), { kind: "admission" });
}

function parseAdmission(stdout) {
  const lines = stdout.trimEnd().split("\n");
  const m = ADMISSION_LINE.exec(lines[0]);
  assert.ok(m, `first line is the ADMISSION token: ${JSON.stringify(stdout)}`);
  return { case_sha256: m[1], classification: m[2], hits: Number(m[3]), lines };
}

/** A repo with one committed passive case, one with an unknown step and one with a payload, a scoped assessment run. */
async function seeded() {
  const repo = readyRepo();
  const passive = writeCase(repo, "TC-001_security-headers.md", caseText("TC-001", PASSIVE_ROWS));
  const unknown = writeCase(repo, "TC-002_login-headers.md", caseText("TC-002", [...PASSIVE_ROWS, ["Fill the Email field with `test@example.com`", "Email value is set"]], { title: "Headers after typing" }));
  const payload = writeCase(repo, "TC-003_search-xss.md", caseText("TC-003", [["Navigate to `{{base_url}}/search?q=<script>alert(1)</script>`", "The page shows the query escaped"]], { title: "Search echoes the query" }));
  const another = writeCase(repo, "TC-004_logout-headers.md", caseText("TC-004", [["Navigate to `{{base_url}}/logout`", "Page loads"], ["Sign in as the qa viewer", "Dashboard visible"]], { title: "Logout headers", extra: "account: qa-viewer" }));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  return { repo, run_id, passive, unknown, payload, another };
}

test("admission payload shape (US-034 AC-1): a passive case ⇒ admitted-heuristic; case_sha256 over the redacted text, assumptions from the run's engagement, target_policy_sha256, no receipt_sha256; validates against admission.schema.json; WROTE line; write-once", async () => {
  const { repo, run_id, passive } = await seeded();
  const r = await plan(repo, ["admit", "--run", run_id, passive]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { case_sha256, classification, hits, lines } = parseAdmission(r.stdout);
  assert.equal(classification, "admitted-heuristic");
  assert.equal(hits, 0);
  assert.equal(case_sha256, caseSha256(readFileSync(join(repo, passive))).case_sha256, "the identity is sha256 over the redacted case text (= ingest case's import_sha256)");
  const a = admissionOf(repo, run_id, case_sha256);
  assert.equal(lines[1], `WROTE ${ST}/runs/${run_id}/admissions/${case_sha256}.json sha256=${a.envelope.self_sha256}`);
  assert.equal(lines.length, 2);
  const engagement = readArtifact(join(runDir(repo, run_id), "engagement.json"), { kind: "engagement" });
  assert.deepEqual(a.payload, {
    case_sha256,
    classification: "admitted-heuristic",
    lint_hits: [],
    assumptions: { base_url_host: "staging.example.com", account: "unknown" },
    target_policy_sha256: targetPolicySha256(engagement.payload),
  });
  assert.deepEqual(validate("admission", a.payload), []);
  assert.equal(a.envelope.kind, "admission");
  assert.equal(a.envelope.run_id, run_id);
  // idempotent: the same case again is the same record, nothing rewritten
  const before = readFileSync(join(runDir(repo, run_id), "admissions", `${case_sha256}.json`));
  const again = await plan(repo, ["admit", "--run", run_id, passive]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(again.stdout, r.stdout);
  assert.deepEqual(readFileSync(join(runDir(repo, run_id), "admissions", `${case_sha256}.json`)), before);
});

test("unknown effect ⇒ proposal (US-034 AC-2): a step the grammar does not know is an `unknown-operation` hit and the case stays a proposal; the account assumption comes from the frontmatter", async () => {
  const { repo, run_id, unknown, another } = await seeded();
  const r = await plan(repo, ["admit", "--run", run_id, unknown]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { case_sha256, classification, hits } = parseAdmission(r.stdout);
  assert.equal(classification, "proposal");
  assert.equal(hits, 1);
  const a = admissionOf(repo, run_id, case_sha256);
  assert.deepEqual(a.payload.lint_hits, [{ rule: "unknown-operation", step: 5, text_redacted: "Fill the Email field with `test@example.com`" }]);
  assert.equal(a.payload.classification, "proposal");
  assert.equal("receipt_sha256" in a.payload, false);
  const other = await plan(repo, ["admit", "--run", run_id, another]);
  assert.equal(other.code, 0, other.stdout + other.stderr);
  const b = admissionOf(repo, run_id, parseAdmission(other.stdout).case_sha256);
  assert.equal(b.payload.assumptions.account, "qa-viewer");
  assert.deepEqual(b.payload.lint_hits.map((h) => [h.step, h.rule]), [[2, "unknown-operation"]], "signing in is an unknown effect, reviewable — not a forbidden one");
});

test("step with an injection payload ⇒ proposal with lint hit (US-034 AC-3); the payload text is on record, redacted", async () => {
  const { repo, run_id, payload } = await seeded();
  const r = await plan(repo, ["admit", "--run", run_id, payload]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { case_sha256, classification, hits } = parseAdmission(r.stdout);
  assert.equal(classification, "proposal");
  assert.equal(hits, 1);
  const a = admissionOf(repo, run_id, case_sha256);
  assert.deepEqual(a.payload.lint_hits, [{ rule: "injection-payload", step: 1, text_redacted: "Navigate to `{{base_url}}/search?q=<script>alert(1)</script>`" }]);
  assert.ok(!r.stdout.includes("<script>"), "stdout carries the classification, never the step text");
});

test("admitted-reviewed only with a confirmed vulnerability-review receipt on the case packet; refuted/indeterminate ⇒ proposal; receipt on a different packet ⇒ exit 4 (US-034 AC-4, P5)", async () => {
  const { repo, run_id, unknown, another, payload } = await seeded();
  // the reviewed route: a case packet over the committed case, a fresh reviewer's receipt, receipt validate, then admit --receipt
  const packet = await casePacket(repo, run_id, [unknown]);
  const unknownSha = caseSha256(readFileSync(join(repo, unknown))).case_sha256;
  const p = readArtifact(join(repo, packet.path), { kind: "packet" });
  assert.deepEqual(p.payload.subject_ids, [unknownSha], "the packet's subject is the case identity (the seam: the case file at head, id = case_sha256)");
  assert.equal(p.payload.files.length, 1);
  assert.equal(p.payload.files[0].path, unknown);
  assert.equal(p.payload.files[0].side, "head");
  const confirmed = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: unknownSha, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id });
  const r = await plan(repo, ["admit", "--run", run_id, unknown, "--receipt", confirmed]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { case_sha256, classification, hits } = parseAdmission(r.stdout);
  assert.equal(case_sha256, unknownSha);
  assert.equal(classification, "admitted-reviewed");
  assert.equal(hits, 1, "the unknown-operation hit stays on record; the review admitted past it");
  const a = admissionOf(repo, run_id, case_sha256);
  assert.equal(a.payload.receipt_sha256, confirmed);
  assert.equal(a.payload.classification, "admitted-reviewed");
  assert.deepEqual(validate("admission", a.payload), []);

  // refuted ⇒ proposal (reason review-not-confirmed), no receipt_sha256
  const anotherPacket = await casePacket(repo, run_id, [another]);
  const anotherSha = caseSha256(readFileSync(join(repo, another))).case_sha256;
  const refuted = await admitReceipt(repo, run_id, { type: "vulnerability-review", subject_id: anotherSha, packet_sha256: anotherPacket.sha256, assertion: "refuted", reviewer_run_id: run_id });
  const rr = await plan(repo, ["admit", "--run", run_id, another, "--receipt", refuted]);
  assert.equal(rr.code, 0, rr.stdout + rr.stderr);
  const refutedLine = parseAdmission(rr.stdout);
  assert.equal(refutedLine.classification, "proposal");
  const b = admissionOf(repo, run_id, refutedLine.case_sha256);
  assert.equal("receipt_sha256" in b.payload, false);
  assert.deepEqual(b.payload.lint_hits.at(-1), { rule: "review-not-confirmed", step: 0, text_redacted: `vulnerability-review: ${REVIEW_REFUTED}` });

  // indeterminate ⇒ proposal, in a fresh run (the record above is write-once)
  const run2 = await scopedRun(repo);
  const packet2 = await casePacket(repo, run2, [another]);
  const indeterminate = await admitReceipt(repo, run2, { type: "vulnerability-review", subject_id: anotherSha, packet_sha256: packet2.sha256, assertion: "indeterminate", reviewer_run_id: run2 });
  const ri = await plan(repo, ["admit", "--run", run2, another, "--receipt", indeterminate]);
  assert.equal(ri.code, 0, ri.stdout + ri.stderr);
  assert.equal(parseAdmission(ri.stdout).classification, "proposal");
  assert.deepEqual(admissionOf(repo, run2, anotherSha).payload.lint_hits.at(-1), { rule: "review-not-confirmed", step: 0, text_redacted: `vulnerability-review: ${REVIEW_INDETERMINATE}` });

  // a receipt on a different packet (another case's) ⇒ exit 4, nothing written
  const wrong = await plan(repo, ["admit", "--run", run2, payload, "--receipt", indeterminate]);
  assert.equal(wrong.code, 4, wrong.stdout + wrong.stderr);
  assert.match(wrong.stdout, /^RECEIPT-MISMATCH\(receipt subject [0-9a-f]{64} is not this case\)$/m);
  const payloadSha = caseSha256(readFileSync(join(repo, payload))).case_sha256;
  assert.equal(existsSync(join(runDir(repo, run2), "admissions", `${payloadSha}.json`)), false);
  // a confirmed review never admits past a forbidden hit
  const payloadPacket = await casePacket(repo, run2, [payload]);
  const confirmedPayload = await admitReceipt(repo, run2, { type: "vulnerability-review", subject_id: payloadSha, packet_sha256: payloadPacket.sha256, assertion: "confirmed", reviewer_run_id: run2 });
  const rp = await plan(repo, ["admit", "--run", run2, payload, "--receipt", confirmedPayload]);
  assert.equal(rp.code, 0, rp.stdout + rp.stderr);
  assert.equal(parseAdmission(rp.stdout).classification, "proposal");
  assert.equal("receipt_sha256" in admissionOf(repo, run2, payloadSha).payload, false);
  // an unknown receipt sha is a usage error (nothing admitted under that name)
  const missing = await plan(repo, ["admit", "--run", run2, payload, "--receipt", "f".repeat(64)]);
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /^USAGE\(admit: unknown receipt f{64} \(not admitted in run /m);
});

test("proposal under tasks/ ⇒ planner refuses (US-038 AC-2): exit 2 PROPOSAL-UNDER-TASKS, nothing written", async () => {
  const { repo, run_id } = await seeded();
  mkdirSync(join(repo, "tasks", "security-my-product-admitted"), { recursive: true });
  const rel = proposalMd(repo, join("tasks", "security-my-product-admitted", "P-001.proposal.md"), OK_PROPOSAL);
  const r = await plan(repo, ["propose", "--run", run_id, rel]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, "PROPOSAL-UNDER-TASKS\n");
  assert.equal(existsSync(join(repo, ST, "proposals")), false, "nothing written");
  // case-insensitive, fail-closed on every platform
  mkdirSync(join(repo, "Tasks"), { recursive: true });
  const upper = proposalMd(repo, join("Tasks", "P-001.proposal.md"), OK_PROPOSAL);
  const ru = await plan(repo, ["propose", "--run", run_id, upper]);
  assert.equal(ru.code, 2, ru.stdout + ru.stderr);
  assert.equal(ru.stdout, "PROPOSAL-UNDER-TASKS\n");
});

test("proposal frontmatter validated; authorization stub authenticated:false (US-038 AC-1): a valid proposal lands at <st>/proposals/<id>.proposal.md redacted, the PROPOSAL and NEXT lines; authenticated:true or a missing block ⇒ SCHEMA-INVALID(proposal: …), nothing written", async () => {
  const { repo, run_id } = await seeded();
  mkdirSync(join(repo, ST, "cases", "drafts"), { recursive: true });
  const rel = proposalMd(repo, join(ST, "cases", "drafts", "P-001.proposal.md"), OK_PROPOSAL, "Steps follow. Test account password=`Hunter2!x` is provisioned by ops.");
  const r = await plan(repo, ["propose", "--run", run_id, rel]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  const out = `${ST}/proposals/${OK_PROPOSAL.id}.proposal.md`;
  assert.match(lines[0], new RegExp(`^PROPOSAL ${out.replace(/[.]/g, "\\.")} id=${OK_PROPOSAL.id} sha256=[0-9a-f]{64}$`));
  assert.equal(lines[1], `NEXT: run snapshot proposals --run ${run_id}`);
  assert.equal(lines.length, 2);
  const written = readFileSync(join(repo, out), "utf8");
  assert.ok(!written.includes("Hunter2!x"), "the copy under <st>/proposals/ is redacted (G-4)");
  assert.ok(written.includes("<REDACTED:"));
  assert.match(written, /"authenticated": false/);
  assert.deepEqual(readdirSync(join(repo, ST, "proposals")), [`${OK_PROPOSAL.id}.proposal.md`]);
  assert.equal(OK_PROPOSAL.authorization.authenticated, false);
  assert.equal(OK_PROPOSAL.authorization.status, "proposed");

  const bad = { ...OK_PROPOSAL, id: "P-002", authorization: { ...OK_PROPOSAL.authorization, authenticated: true } };
  const rb = await plan(repo, ["propose", "--run", run_id, proposalMd(repo, join(ST, "cases", "drafts", "P-002.proposal.md"), bad)]);
  assert.equal(rb.code, 2);
  assert.equal(rb.stdout, "SCHEMA-INVALID(proposal: $.authorization.authenticated: expected const false)\n");
  writeFileSync(join(repo, ST, "cases", "drafts", "none.proposal.md"), "# no block here\n");
  const rn = await plan(repo, ["propose", "--run", run_id, join(ST, "cases", "drafts", "none.proposal.md")]);
  assert.equal(rn.code, 2);
  assert.equal(rn.stdout, "SCHEMA-INVALID(proposal: no ```json proposal block)\n");
  assert.deepEqual(readdirSync(join(repo, ST, "proposals")), [`${OK_PROPOSAL.id}.proposal.md`], "the refusals wrote nothing");
});

test("ta-prompt is TASK-044's: argv validated, then NOT-IMPLEMENTED(M3)", async () => {
  const repo = readyRepo();
  const r = await plan(repo, ["ta-prompt", "--run", "abc", "--slug", "s", "--base", "main"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-IMPLEMENTED(M3)\n");
});
