// TASK-038 — installed end-to-end tests, offline, both shapes + the remaining
// §12 fixtures (spec v6.2 §12 "Installed end-to-end", plan §5 TASK-038;
// US-030 AC-1 M1 portion, AC-2…AC-5, US-028 AC-4, US-007 AC-3, US-004 AC-5).
//
// Nothing here runs the scripts of this checkout: every command is the copy
// `bin/init.mjs` INSTALLED into a consumer repository built in a temp dir,
// provisioned with no network through the TASK-056 harness (a local bare
// fixture remote for the one M1 external, `systematic-debugging`; a
// GIT_CONFIG_GLOBAL rewrite that makes every https://github.com/ URL
// unreachable). Two shapes:
//
//   (a) full bundle  `init --factory security-testing --target claude` →
//       engagement init (twice: EDIT-ENGAGEMENT-AND-RERUN, then 0) → the
//       §12 four-step dirty review over `password=1234` (steps 1–2) → run
//       init --kind assessment → scope → packet --kind scope → ingest sarif
//       + ingest qa-run → gate --claims → coverage --examined --scanner-rows
//       → packet --kind subject → receipt validate → verify all pass 1 →
//       register add → verify all --receipts pass 2 (VERIFIED, row fixed) →
//       run snapshot verify|register|proposals → the M1 empty threat model
//       → build-report --template assessment → check --integrity --drift →
//       register render → sign-off ⇒ exit 0, the review run listed as
//       CONSISTENT-REDACTED-ONLY(1 citations) (four-step step 4), the
//       changed ignored product file as excluded coverage.
//   (b) two-skill    `init --skills security-testing/secure-code-review,
//       security-testing/security-evidence` → exactly STANDALONE_SEQUENCE
//       (secure-code-review/SKILL.md § "Standalone review, human-driven";
//       the knowledge templates written by engagement init itself, D12) →
//       positive tests + an `indeterminate` fix-review ⇒
//       UNVERIFIED-INDETERMINATE(fix-review) → sign-off ⇒ 4 NO-ASSESSMENT,
//       no UNGATED; plus the G-1 proof: a byte-identical twin of the repo
//       runs the same review + verify pipeline and every artifact matches.
//
// Skip with `SDLC_E2E=0`. Every `git`/`node` child is execFile with an argv
// array, shell:false, explicit cwd and env (G-6); fixture repos are built by
// code into temp dirs (G-12); nothing reads the network (G-14).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnvelope, readArtifact, writeArtifact } from "./canon.mjs";
import { walk } from "./lib/fsx.mjs";
import { redactString } from "./redact.mjs";
import { FORBIDDEN_STRINGS } from "./lib/tokens.mjs";
import { KNOWLEDGE_FILES } from "./lib/engagement.mjs";
import { assertNoNetwork, createOfflineInstall, runInstaller } from "./fixtures/offline/harness.mjs";
import { BASE_FILES, CLAIM, DB_FIXED, FINDING_PATH } from "./fixtures/repo/build.mjs";
import { cleanupAll } from "./fixtures/cli/harness.mjs";
import {
  CONFIG_CLEAN,
  CONFIG_PATH,
  CONSUMER_GITIGNORE,
  IGNORED_PRODUCT_PATH,
  PRODUCT_EXTRA_FILES,
  PRODUCT_RECORD,
  SD_EXTERNAL,
  ST,
  STANDALONE_SEQUENCE,
  TARGET_DIRS,
  buildProductRepo,
  commitAll,
  commitIn,
  editEngagement,
  gitEnvFor,
  gitIn,
  installedScripts,
  lines,
  makeRunner,
  parsePacketLine,
  parseRunLine,
  E2E_ENV,
} from "./fixtures/e2e/helpers.mjs";

// The plan says this file exports the sequence; the definition lives in the
// e2e helpers so TASK-034's test can import it without importing a test file.
export { STANDALONE_SEQUENCE };

const SKIP = process.env.SDLC_E2E === "0" ? "SDLC_E2E=0" : false;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const PRODUCT_FILES = Object.freeze({ ...BASE_FILES, ...PRODUCT_EXTRA_FILES });
const EID = PRODUCT_RECORD.engagement_id;
const SECRET = "password=1234";
const HEX64 = /^[0-9a-f]{64}$/;

const harnesses = [];
after(() => {
  for (const h of harnesses) h.cleanup();
  cleanupAll();
});

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const ok = (r, what) => {
  assert.equal(r.code, 0, `${what}: exit ${r.code}\n${r.stdout}${r.stderr}`);
  return r;
};
const readRun = (project, run_id, name, kind) => readArtifact(join(project, ST, "runs", run_id, name), kind ? { kind } : undefined);
/** Payload-only file into the agent drop-box of `run_id` (TL-4); returns the repo-relative path. */
function drop(project, run_id, name, payload) {
  const box = join(project, ST, "receipts", run_id);
  mkdirSync(box, { recursive: true });
  writeFileSync(join(box, name), `${JSON.stringify(payload, null, 2)}\n`);
  return join(ST, "receipts", run_id, name);
}
/** Every scope range, declared examined (full coverage). */
const declareAll = (scope) => scope.payload.files.filter((f) => (scope.payload.ranges[f.path] ?? []).length > 0).map((f) => ({ path: f.path, ranges: scope.payload.ranges[f.path] }));
const appClaim = Object.freeze({ title: "app export", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;" });
/** Files under `dir` (repo-relative) whose bytes contain `needle`. */
const filesContaining = (dir, needle) => (existsSync(dir) ? walk(dir).filter((rel) => readFileSync(join(dir, rel)).includes(needle)) : []);
/** Every file under `dir` as {rel → sha256}. */
function treeDigest(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const rel of walk(dir)) out[rel] = sha256(readFileSync(join(dir, rel)));
  return out;
}
/** The run's own envelope head for an artifact the test plants (the M1 threat model). */
function headFor(project, run_id, kind) {
  const run = readRun(project, run_id, "run.json", "run");
  const { schema_version, engagement_id, key_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id, now: () => E2E_ENV.SECURITY_EVIDENCE_NOW };
}

/** A provisioned consumer: product repo at its base commit, installed (args), the install committed, a runner over the installed scripts. */
async function provision({ externals, args, target = "claude", name }) {
  const h = createOfflineInstall({ externals });
  harnesses.push(h);
  const project = h.projectDir;
  const genv = gitEnvFor(h.env);
  const base = buildProductRepo(project, genv, PRODUCT_FILES);
  const install = await runInstaller({ env: h.env, cwd: project, args });
  const out = install.stdout + install.stderr;
  assert.equal(install.code, 0, `${name}: installer exit ${install.code}\n${out}`);
  assertNoNetwork(out);
  assert.ok(!/external fetch failed/.test(out), out);
  const installOid = commitAll(project, "install security-testing", genv);
  const runner = makeRunner({ projectDir: project, scriptsDir: installedScripts(project, target), harnessEnv: h.env });
  return { h, project, genv, base, installOid, runner, installOut: out };
}

/** The two `engagement init` runs on a bare consumer: EDIT-ENGAGEMENT-AND-RERUN, the edit, then success. Returns the second run's lines. */
async function engage(fx, { seeded }) {
  const { project, runner } = fx;
  const first = await runner.run("evidence", ["engagement", "init"]);
  assert.equal(first.code, 2, `first engagement init: ${first.stdout}${first.stderr}`);
  const out1 = lines(first.stdout);
  assert.equal(out1.at(-1), "EDIT-ENGAGEMENT-AND-RERUN");
  assert.equal(out1[1], "ENGAGEMENT: template written — edit and re-run");
  // the templates: seeded by the factory install, or written by step 0 itself (D12, US-007 AC-3)
  assert.equal(out1[0], `TEMPLATES: ${KNOWLEDGE_FILES.map((n) => `${n}=${seeded ? "present" : "written"}`).join(" ")}`);
  for (const n of KNOWLEDGE_FILES) assert.ok(existsSync(join(project, ST, "knowledge", n)), `knowledge/${n} present after step 0`);
  assert.ok(existsSync(join(project, ST, "engagement.md")), "engagement.md written from the template");
  assert.ok(!existsSync(join(project, ST, "private")), "nothing else happened (P3)");
  editEngagement(project, PRODUCT_RECORD);
  const second = ok(await runner.run("evidence", ["engagement", "init"]), "second engagement init");
  const out2 = lines(second.stdout);
  assert.equal(out2[0], `TEMPLATES: ${KNOWLEDGE_FILES.map((n) => `${n}=present`).join(" ")}`);
  assert.equal(out2[1], "ENGAGEMENT: present");
  assert.equal(out2[2], "IGNORE-BLOCK: written");
  assert.match(out2[3], /^KEY: k[0-9a-f]{12} created$/);
  // scope_paths ∪ product_paths: src/{app,config,db}.js + package.json; dist/bundle.js is ignored and only counted (spec §2 last row)
  assert.equal(out2[4], "BASELINE: 4 files ignored=1");
  assert.match(out2[5], new RegExp(`^WROTE ${ST}/private/baseline\\.${EID}\\.json sha256=[0-9a-f]{64}$`));
  const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
  assert.ok(gitignore.startsWith(CONSUMER_GITIGNORE), "the consumer's own patterns lead");
  assert.ok(gitignore.includes("# security-testing:begin") && gitignore.includes(`${ST}/private/`), "the managed block follows");
  return { gitignoreSha: sha256(gitignore), key_id: /^KEY: (k[0-9a-f]{12})/.exec(out2[3])[1] };
}

/** The fix, committed on a side branch so the main work tree (the assessed tree) stays put; returns the fix oid. */
function fixOnBranch(fx) {
  const { project, genv } = fx;
  gitIn(project, ["checkout", "-q", "-b", "fix/sqli"], genv);
  const fix = commitIn(project, { [FINDING_PATH]: DB_FIXED, ".semgrepignore": "vendor/\nsrc/legacy/\n" }, "fix: parameterise the query (+ an ignore-file edit)", genv);
  gitIn(project, ["checkout", "-q", "main"], genv);
  assert.equal(gitIn(project, ["status", "--porcelain", "--", "src/", ".semgrepignore"], genv), "", "back on main: the product files are what the assessed tree had");
  return fix;
}

/**
 * scope → packet --kind scope → claims + examined → gate → coverage on `run_id`;
 * returns the scope artifact, the packet and the gated finding for
 * FINDING_PATH. `before(run)` runs between the scope packet and gate (the
 * ingest step of path (a)).
 */
async function gateRun(fx, run_id, { claims, declared, before = async () => ({}), coverageArgs = () => [] }) {
  const { project, runner } = fx;
  const s = ok(await runner.run("evidence", ["scope", "--run", run_id]), "scope");
  const scope = readRun(project, run_id, "scope.json", "scope");
  const p = ok(await runner.run("evidence", ["packet", "--run", run_id, "--kind", "scope"]), "scope packet");
  const packet = parsePacketLine(p.stdout);
  assert.equal(packet.kind, "scope");
  const extra = await before({ run_id, scope, packet });
  const claimsFile = drop(project, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet.sha256, findings: claims });
  const g = ok(await runner.run("evidence", ["gate", "--run", run_id, "--claims", claimsFile]), "gate");
  const examined = drop(project, run_id, "examined-1.json", { packet_sha256: packet.sha256, declared: declared ?? declareAll(scope) });
  const c = ok(await runner.run("evidence", ["coverage", "--run", run_id, "--examined", examined, ...coverageArgs(extra)]), "coverage");
  const claimed = readRun(project, run_id, "findings.claimed.json", "claimed");
  const gateResult = readRun(project, run_id, "gate-result.json", "gate-result");
  return { scope, packet, scopeLine: lines(s.stdout)[0], gateLine: lines(g.stdout)[0], coverageLine: lines(c.stdout)[0], claimed, gateResult, claimsFile, extra };
}

/** packet --kind subject over `finding_id` + a confirmed vulnerability-review receipt admitted through receipt validate. */
async function reviewFinding(fx, run_id, finding_id) {
  const { runner } = fx;
  const p = ok(await runner.run("evidence", ["packet", "--run", run_id, "--kind", "subject", "--subject", finding_id]), "subject packet");
  const packet = parsePacketLine(p.stdout);
  assert.equal(packet.kind, "subject");
  const receipt = drop(fx.project, run_id, `receipt-${finding_id.slice(0, 12)}.json`, { type: "vulnerability-review", subject_id: finding_id, packet_sha256: packet.sha256, assertion: "confirmed", reviewer_run_id: run_id });
  const v = ok(await runner.run("evidence", ["receipt", "validate", "--run", run_id, receipt]), "receipt validate");
  assert.match(lines(v.stdout)[0], new RegExp(`^RECEIPT admitted sha256=[0-9a-f]{64} type=vulnerability-review subject=${finding_id}$`));
  return packet;
}

/** `verify all` (pass 1 without receipts, pass 2 with) parsed: run id, lines, verdict, verify.json. */
function parseVerify(fx, r) {
  ok(r, "verify all");
  const out = lines(r.stdout);
  const run = parseRunLine(r.stdout);
  assert.equal(run.kind, "verify");
  const last = /^VERDICT (.+) finding=([0-9a-f]{64}) base=([0-9a-f]{40}) head=([0-9a-f]{40}) tested_tree=([0-9a-f]{64}|same-as-head) verify=([0-9a-f]{64})$/.exec(out.at(-1));
  assert.ok(last, `VERDICT line last: ${out.at(-1)}`);
  const artifact = readRun(fx.project, run.run_id, "verify.json", "verify");
  assert.equal(artifact.envelope.self_sha256, last[6]);
  assert.ok(existsSync(join(fx.project, ST, "runs", run.run_id, "COMMITTED")), "a verify run is COMMITTED by build-report in-process");
  const line = (prefix) => out.find((l) => l.startsWith(prefix));
  return { ...run, out, line, verdict: last[1], verify_sha256: last[6], payload: artifact.payload };
}

// ---------------------------------------------------------------------------
// US-030 AC-1 (M1 portion) — provisioning

test("offline provisioning — memory/knowledge-curation from monorepo, systematic-debugging from cache, no https fetch", { skip: SKIP }, async () => {
  const fx = await provision({ externals: [SD_EXTERNAL], args: ["init", "--factory", "security-testing", "--target", "claude", "--yes"], name: "path (a) install" });
  const skills = join(fx.project, ".claude", "skills");
  // monorepo skills: byte-identical copies of this checkout's skills/<id>/SKILL.md
  for (const id of ["memory", "knowledge-curation"]) {
    assert.ok(existsSync(join(skills, id, "SKILL.md")), `${id} installed`);
    assert.equal(readFileSync(join(skills, id, "SKILL.md"), "utf8"), readFileSync(join(REPO_ROOT, "skills", id, "SKILL.md"), "utf8"), `${id} is the monorepo copy`);
  }
  // the external: the fixture body from the cache clone, whose origin is the local bare remote
  const sd = readFileSync(join(skills, "systematic-debugging", "SKILL.md"), "utf8");
  assert.equal(sd, SD_EXTERNAL.files["SKILL.md"], "systematic-debugging is the cache clone's SKILL.md");
  const clone = join(fx.h.cacheDir, "sdlc-skills", "registry", "obra__superpowers");
  assert.equal(gitIn(clone, ["remote", "get-url", "origin"], fx.genv), fx.h.remotes["obra/superpowers"], "the cache clone's origin is the bare fixture");
  assert.ok(!/https:\/\//.test(fx.installOut), "no https fetch attempted");
  // the M1 roster + local skills + scripts
  for (const s of ["security-evidence", "secure-code-review", "security-engagement"]) assert.ok(existsSync(join(skills, s, "SKILL.md")), `local skill ${s}`);
  for (const f of ["evidence.mjs", "verify.mjs", "register.mjs", "version.json", "lib/cmd-sign-off.mjs"]) {
    assert.ok(existsSync(join(skills, "security-evidence", "scripts", f)), `installed scripts/${f}`);
  }
  for (const f of ["references/redaction-rules.json", "templates/assessment.md"]) assert.ok(existsSync(join(skills, "security-evidence", f)), `installed ${f}`);
  assert.ok(existsSync(join(fx.project, ".claude", "agents", "security-reviewer", "AGENT.md")), "the reviewer is installed");
  assert.ok(existsSync(join(fx.project, ".agents", "memory", "security-reviewer", "project_briefing.md")), "briefing seeded");
  // M1 asserts nothing about verifying-outcomes / issue-tracking: no installed item declares them (plan §4.8; TASK-048 owns the M3 assertions)
  for (const absent of ["verifying-outcomes", "issue-tracking"]) assert.ok(!existsSync(join(skills, absent)), `${absent} is not requested by the M1 roster`);
});

// ---------------------------------------------------------------------------
// path (a) — built once, asserted by two tests

let pathAPromise = null;
function pathA() {
  pathAPromise ??= buildPathA();
  return pathAPromise;
}

async function buildPathA() {
  const fx = await provision({ externals: [SD_EXTERNAL], args: ["init", "--factory", "security-testing", "--target", "claude", "--yes"], name: "path (a)" });
  const { project, runner, genv } = fx;
  const st = join(project, ST);
  const { gitignoreSha, key_id } = await engage(fx, { seeded: true });

  // --- §12 four-step, steps 1–2: a dirty review over a file carrying a secret -------------------
  const dirty = `${CONFIG_CLEAN}const secret = { ${SECRET} };\n`;
  writeFileSync(join(project, CONFIG_PATH), dirty);
  const redactedLine = redactString(Buffer.from(dirty)).text.split("\n")[1];
  assert.ok(!redactedLine.includes(SECRET) && /<REDACTED:/.test(redactedLine), redactedLine);
  const review = parseRunLine(ok(await runner.run("evidence", ["run", "init", "--kind", "review", "--base", "HEAD"]), "review run init").stdout);
  assert.equal(review.seq, 1);
  const keyed = { title: "credential in config", class: "config", priority: "p0", confidence: 7, path: CONFIG_PATH, side: "snapshot", lines: [2, 2], snippet_redacted: redactedLine };
  const rv = await gateRun(fx, review.run_id, { claims: [keyed] });
  assert.equal(rv.scopeLine, "SCOPE files=3 ranges=3 skipped=0 snapshot=1");
  const snap = join(st, "private", "snapshots", review.run_id, CONFIG_PATH);
  assert.ok(existsSync(snap), "the dirty file is snapshotted under private/");
  assert.ok(!readFileSync(snap).includes(SECRET), "snapshot bytes are redacted");
  assert.equal(readFileSync(snap, "utf8"), redactString(Buffer.from(dirty)).text, "redacted by redact.mjs byte for byte");
  assert.match(rv.scope.payload.snapshot[CONFIG_PATH].original_hmac, HEX64, "HMAC of the original present");
  assert.deepEqual(filesContaining(st, SECRET), [], "no original bytes anywhere under .agents/security-testing/");
  assert.equal(rv.gateLine, "GATE accepted=1 unverifiable=0 rejected=0 unlocated=0");
  const keyedFinding = rv.claimed.payload.findings[0];
  assert.equal(keyedFinding.sensitive, true, "identity keyed by content sensitivity");
  assert.ok(!("snippet" in keyedFinding) && keyedFinding.snippet_redacted === redactedLine);
  const rb = ok(await runner.run("evidence", ["build-report", "--run", review.run_id, "--template", "review"]), "build-report review");
  assert.deepEqual(lines(rb.stdout).map((l) => l.split(" ")[0]), ["REPORT", "MANIFEST", "COMMITTED"]);
  assert.deepEqual(filesContaining(st, SECRET), [], "still nothing under <st> after the report");
  const c1 = ok(await runner.run("evidence", ["check", join(ST, "runs", review.run_id), "--integrity", "--drift"]), "check review (before the change)");
  assert.deepEqual(lines(c1.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  // step 2: the working file changes ⇒ the original is gone; the redacted snapshot still matches its recorded hash
  writeFileSync(join(project, CONFIG_PATH), `${CONFIG_CLEAN}const secret = { password=5678 };\n`);
  const c2 = ok(await runner.run("evidence", ["check", join(ST, "runs", review.run_id), "--integrity"]), "check review (after the change)");
  assert.deepEqual(lines(c2.stdout), ["CONSISTENT-REDACTED-ONLY(1 citations)", "ORIGIN: unauthenticated", "KEY: available"]);
  // a clean tree for the assessment (the file still differs from the snapshotted original)
  gitIn(project, ["checkout", "--", CONFIG_PATH], genv);
  assert.equal(gitIn(project, ["status", "--porcelain", "--", "src/"], genv), "");
  const c3 = ok(await runner.run("evidence", ["check", join(ST, "runs", review.run_id), "--integrity"]), "check review (clean tree)");
  assert.equal(lines(c3.stdout)[0], "CONSISTENT-REDACTED-ONLY(1 citations)");

  // --- the assessment ------------------------------------------------------------------------------
  mkdirSync(join(st, "imports"), { recursive: true });
  writeFileSync(join(st, "imports", "semgrep.sarif"), readFileSync(join(HERE, "fixtures", "sarif", "located.sarif")));
  writeFileSync(join(st, "imports", "qa-run.md"), readFileSync(join(HERE, "fixtures", "qa", "RUN-2026-09-15-001.md")));
  const assessment = parseRunLine(ok(await runner.run("evidence", ["run", "init", "--kind", "assessment"]), "assessment run init").stdout);
  assert.equal(assessment.seq, 2);
  assert.equal(assessment.head_oid, fx.installOid, "the assessed tree is HEAD (D18)");
  assert.equal(readRun(project, assessment.run_id, "run.json", "run").envelope.key_id, key_id, "enveloped with the key engagement init minted (D13)");
  assert.equal(readFileSync(join(st, "private", "keys", "current"), "utf8").trim(), key_id);
  const av = await gateRun(fx, assessment.run_id, {
    claims: [CLAIM, appClaim],
    before: async ({ run_id }) => {
      const sarif = ok(await runner.run("evidence", ["ingest", "sarif", join(ST, "imports", "semgrep.sarif"), "--run", run_id]), "ingest sarif");
      const sm = /^IMPORT sarif import_sha256=([0-9a-f]{64}) records=(\d+) unlocated=(\d+) rejected=(\d+)$/.exec(lines(sarif.stdout)[0]);
      assert.ok(sm, sarif.stdout);
      assert.deepEqual(sm.slice(2).map(Number), [1, 0, 0], "the located Semgrep record");
      assert.ok(!sarif.stdout.includes(SECRET) && !sarif.stderr.includes(SECRET), "the SARIF message's secret never reaches stdout");
      // the manual-qa run report, in its real Markdown format (spec §12 additional fixture)
      const qa = ok(await runner.run("evidence", ["ingest", "qa-run", join(ST, "imports", "qa-run.md"), "--run", run_id]), "ingest qa-run");
      const qm = /^IMPORT qa-run import_sha256=([0-9a-f]{64}) records=(\d+) unlocated=(\d+) rejected=(\d+)$/.exec(lines(qa.stdout)[0]);
      assert.ok(qm, qa.stdout);
      assert.equal(Number(qm[2]), 4, "one run record + three result rows");
      const qaRecord = readRun(project, run_id, join("ingest", `${qm[1]}.json`), "import");
      assert.equal(qaRecord.payload.records[0].trusted.record, "run");
      assert.equal(qaRecord.payload.records[0].trusted.environment_host_allowed, true, "staging.example.com ∈ targets.browser");
      assert.deepEqual(qaRecord.payload.records.slice(1).map((r) => [r.trusted.case_id, r.trusted.status]), [["TC-SEC-001", "PASS"], ["TC-SEC-002", "FAIL"], ["TC-SEC-003", "BLOCKED"]]);
      return { sarifSha: sm[1], qaSha: qm[1] };
    },
    coverageArgs: ({ sarifSha }) => ["--scanner-rows", drop(project, assessment.run_id, "scanner-rows.json", { rows: [{ import_sha256: sarifSha }] })],
  });
  assert.equal(av.scopeLine, "SCOPE files=3 ranges=3 skipped=0 snapshot=0");
  // the scanner's record and the reviewer's claim on src/db.js share one identity: one finding, the duplicate counted as rejected
  assert.equal(av.gateLine, "GATE accepted=2 unverifiable=0 rejected=1 unlocated=0");
  assert.deepEqual(av.gateResult.payload.rejected_counts, { "duplicate-id": 1 });
  // every range declared examined ⇒ no scanner-only piece; the scanner row is still recorded on coverage.json
  assert.equal(av.coverageLine, "COVERAGE examined=3 skipped=0 scanner=0");
  const coverage = readRun(project, assessment.run_id, "coverage.json", "coverage");
  assert.deepEqual(coverage.payload.scanner_rows.map((r) => [r.import_sha256, r.tool]), [[av.extra.sarifSha, "Semgrep OSS"]]);
  assert.equal(coverage.payload.indeterminate, false);
  const injection = av.claimed.payload.findings.find((f) => f.path === FINDING_PATH);
  assert.ok(injection, "the injection finding on src/db.js was gated");
  assert.equal(injection.class, "injection");
  assert.ok(av.gateResult.payload.accepted.includes(injection.id));
  await reviewFinding(fx, assessment.run_id, injection.id);

  // --- the fix, verified in two passes -------------------------------------------------------------
  const fix = fixOnBranch(fx);
  const p1 = parseVerify(fx, await runner.run("verify", ["all", "--finding", injection.id, "--base", assessment.head_oid, "--head", fix]));
  assert.equal(p1.seq, 3);
  assert.equal(p1.line("BRANCH "), "BRANCH COMMITTED");
  assert.equal(p1.line("SUPPRESSION "), "SUPPRESSION indicators=1 deletion_only=false");
  assert.match(p1.line("TESTS "), /^TESTS TESTS_PASS exe=/);
  assert.equal(p1.payload.tests.output_redacted, "1 passing\n", "the fixture runner prints no clock");
  assert.ok(p1.out.includes("NEXT: dispatch security-reviewer fix-review"), "pass 1 asks for the fix-review");
  assert.equal(p1.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.equal(p1.line("REGISTER: "), undefined, "pass 1 never touches the register");
  // register add BEFORE pass 2 (PM log G19)
  const add = ok(await runner.run("register", ["add", "--subject", injection.id, "--priority", "p1", "--title", "sql built from req.query.id", "--run", assessment.run_id]), "register add");
  assert.equal(add.stdout, "ROW R-0001 status=open priority=p1 seq=1\n");
  const indicator = p1.payload.suppression.indicators[0].id;
  const box = dirname(drop(project, p1.run_id, "fix-review.json", { type: "fix-review", subject_id: injection.id, packet_sha256: p1.payload.packet_sha256, assertion: "not-refound", reviewer_run_id: p1.run_id }));
  drop(project, p1.run_id, "ack-1.json", { type: "ack", subject_id: injection.id, packet_sha256: p1.payload.packet_sha256, assertion: { indicator_id: indicator }, reviewer_run_id: p1.run_id });
  const p2 = parseVerify(fx, await runner.run("verify", ["all", "--finding", injection.id, "--base", assessment.head_oid, "--head", fix, "--receipts", box]));
  assert.equal(p2.seq, 4);
  assert.equal(p2.verdict, "VERIFIED");
  assert.equal(p2.payload.packet_sha256, p1.payload.packet_sha256, "deterministic packet identity across passes (TL-6)");
  assert.equal(p2.payload.row_status_at_start, "open");
  assert.match(p2.line("CONSUMED "), new RegExp(`^CONSUMED VERIFIED row=R-0001 verify=${p2.verify_sha256}$`));
  const projection = JSON.parse(readFileSync(join(st, "register", "projection.json"), "utf8"));
  assert.equal(projection.rows["R-0001"].status, "fixed", "consume-verdict moved the row to fixed");
  // the PM-log item: a verify run whose fix-review packet carries a real head blob and a pass-1-bound receipt passes --integrity
  const cv = ok(await runner.run("evidence", ["check", join(ST, "runs", p2.run_id), "--integrity"]), "check verify pass 2");
  assert.deepEqual(lines(cv.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);

  // --- cross-run inputs into the assessment (P2) ------------------------------------------------------
  const sv = ok(await runner.run("evidence", ["run", "snapshot", "verify", "--run", assessment.run_id, "--from", p2.run_id]), "run snapshot verify");
  assert.deepEqual(lines(sv.stdout), [`SNAPSHOT verify from=${p2.run_id} sha256=${p2.verify_sha256}`]);
  const sr = ok(await runner.run("evidence", ["run", "snapshot", "register", "--run", assessment.run_id]), "run snapshot register");
  assert.match(lines(sr.stdout)[0], /^SNAPSHOT register events=[2-9] chain=[0-9a-f]{64}$/);
  mkdirSync(join(st, "proposals"), { recursive: true });
  writeFileSync(join(st, "proposals", "active-sqli-probe.proposal.md"), "---\nid: active-sqli-probe\n---\n# probe\n");
  const sp = ok(await runner.run("evidence", ["run", "snapshot", "proposals", "--run", assessment.run_id]), "run snapshot proposals");
  assert.equal(lines(sp.stdout)[0], "SNAPSHOT proposals n=1");
  // the M1 empty threat model (tm-lint check writes it from M2; TASK-024)
  writeArtifact(join(st, "runs", assessment.run_id, "threat-model.json"), makeEnvelope(headFor(project, assessment.run_id, "threat-model"), { elements: [], threats: [] }), { exclusive: true });
  // the ignored product file changes: excluded coverage at sign-off, never a change
  writeFileSync(join(project, IGNORED_PRODUCT_PATH), "// built output v2\n");

  // --- report, check, render, sign-off ---------------------------------------------------------------
  const br = ok(await runner.run("evidence", ["build-report", "--run", assessment.run_id, "--template", "assessment"]), "build-report assessment");
  assert.deepEqual(lines(br.stdout).map((l) => l.split(" ")[0]), ["REPORT", "MANIFEST", "COMMITTED"]);
  const report = readFileSync(join(st, "runs", assessment.run_id, "report.md"), "utf8");
  assert.match(report, /^# Security assessment — run /m);
  assert.ok(report.includes(injection.id));
  assert.match(report, new RegExp(`\\| ${p2.run_id} \\| ${injection.id} \\| VERIFIED \\|`), "verify history from the snapshot");
  assert.match(report, /\| R-0001 \| [0-9a-f]{64} \| p1 \| fixed \|/, "the register snapshot carries the fixed row");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!report.includes(s), `report carries no ${s}`);
  // the only file under <st> carrying the secret is the lead's own raw SARIF drop under the reserved imports/ (not a bundle write):
  // the ledger blob, the ingest record and everything the scripts wrote are clean
  assert.deepEqual(filesContaining(st, SECRET), ["imports/semgrep.sarif"], "no bundle-written file under <st> carries the original secret bytes");
  assert.ok(readFileSync(join(st, "imports", "semgrep.sarif"), "utf8").includes(SECRET), "the raw scanner input does (it is the operator's copy)");
  const ca = ok(await runner.run("evidence", ["check", join(ST, "runs", assessment.run_id), "--integrity", "--drift"]), "check assessment");
  assert.deepEqual(lines(ca.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  const rr = ok(await runner.run("register", ["render"]), "register render");
  assert.match(rr.stdout, new RegExp(`^RENDER ${ST}/risk-register\\.md rows=1 seq=[0-9]+\\n$`));
  assert.ok(existsSync(join(st, "risk-register.md")));
  const so = ok(await runner.run("evidence", ["sign-off", "--engagement", EID]), "sign-off");
  const out = lines(so.stdout);
  assert.equal(out[0], "SIGN-OFF: OK");
  assert.equal(out[1], "RUNS: 4");
  assert.equal(out[2], `  ${review.run_id} seq=1 kind=review CONSISTENT-REDACTED-ONLY(1 citations)`, "four-step step 4: the review run listed with its result");
  assert.equal(out[3], `  ${assessment.run_id} seq=2 kind=assessment CONSISTENT CURRENT`);
  assert.equal(out[4], `  ${p1.run_id} seq=3 kind=verify CONSISTENT`);
  assert.equal(out[5], `  ${p2.run_id} seq=4 kind=verify CONSISTENT`);
  assert.ok(out.includes("INCOMPLETE: 0"));
  assert.ok(out.includes("CHANGES-SINCE-BASELINE: 0"), so.stdout);
  const ex = out.indexOf("EXCLUDED-COVERAGE: ignored=1");
  assert.ok(ex > 0, so.stdout);
  assert.ok(out.includes("  dist/ ignored=1"), "the ignored product file counts under its product path");
  assert.ok(!so.stdout.includes(IGNORED_PRODUCT_PATH), "an ignored file is counted, never named");
  // the reviewer's ACK of the suppression indicator is an approval-like record: reported, unauthenticated, never subtracted (G-8)
  assert.ok(out.includes("UNAUTHENTICATED-APPROVALS: 1") && out.includes("  R-0001 status=fixed ack_refs"), so.stdout);
  assert.ok(!so.stdout.includes("authenticated: true") && !so.stdout.includes("confirmed"));
  assert.ok(out.includes("DISPOSITIONS: not evaluated"), "require_dispositions: none");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!so.stdout.includes(s) && !so.stderr.includes(s), s);
  assert.ok(!so.stdout.includes(SECRET) && !so.stderr.includes(SECRET));
  // every step of the pipeline exited 0 except the first engagement init (2 EDIT-ENGAGEMENT-AND-RERUN)
  assert.deepEqual(runner.log.map((e) => e.code).filter((c) => c !== 0), [2]);
  return { fx, gitignoreSha, key_id, review, assessment, p1, p2, injection };
}

test("full-bundle path (a) exits 0 through sign-off", { skip: SKIP }, async () => {
  const a = await pathA();
  assert.equal(a.p2.verdict, "VERIFIED");
  assert.equal(a.review.seq, 1);
  assert.equal(a.assessment.seq, 2);
  // the scripts that ran were the installed copies, not this checkout's
  assert.ok(a.fx.runner.log.length > 20);
  assert.ok(installedScripts(a.fx.project).startsWith(a.fx.project));
});

test(".gitignore untouched by the pipeline after init", { skip: SKIP }, async () => {
  const a = await pathA();
  const { project, genv } = a.fx;
  assert.equal(sha256(readFileSync(join(project, ".gitignore"))), a.gitignoreSha, "US-004 AC-5: only engagement init touched .gitignore");
  // git status shows nothing under a managed path: the block keeps every bundle-local artifact out of git
  // gitIn trims stdout, so the first line may have lost its leading status column: strip the columns by pattern, not by width
  const status = gitIn(project, ["status", "--porcelain", "--untracked-files=all"], genv).split("\n").filter(Boolean).map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, ""));
  const managed = [`${ST}/private/`, `${ST}/ledger/`, `${ST}/runs/`, `${ST}/receipts/`, `${ST}/proposals/`, `${ST}/handoffs/`, `${ST}/imports/`, `${ST}/register/`, "reports/security/", "tasks/security-"];
  for (const p of status) assert.ok(!managed.some((m) => p.startsWith(m)), `${p} is under a managed path`);
  assert.deepEqual(status.sort(), [".gitignore", `${ST}/engagement.md`, `${ST}/risk-register.md`].sort(), "exactly the three files outside the block that the engagement writes");
  assert.equal(gitIn(project, ["ls-files", "--", ST], genv).split("\n").filter((p) => !p.startsWith(`${ST}/knowledge/`)).join(","), "", "nothing under <st> is tracked besides the seeded knowledge");
});

// ---------------------------------------------------------------------------
// path (b) — two-skill, human-driven; built once, asserted by two tests

let pathBPromise = null;
function pathB() {
  pathBPromise ??= buildPathB();
  return pathBPromise;
}

/** The review pipeline of the standalone sequence up to verify pass 1, on one consumer copy. */
async function reviewPipeline(fx, { fix }) {
  const { project, runner } = fx;
  const review = parseRunLine(ok(await runner.run("evidence", ["run", "init", "--kind", "review", "--base", "HEAD"]), "review run init").stdout);
  const rv = await gateRun(fx, review.run_id, { claims: [CLAIM, appClaim] });
  assert.equal(rv.gateLine, "GATE accepted=2 unverifiable=0 rejected=0 unlocated=0");
  const injection = rv.claimed.payload.findings.find((f) => f.path === FINDING_PATH);
  assert.ok(injection);
  await reviewFinding(fx, review.run_id, injection.id);
  const rb = ok(await runner.run("evidence", ["build-report", "--run", review.run_id, "--template", "review"]), "build-report review");
  assert.deepEqual(lines(rb.stdout).map((l) => l.split(" ")[0]), ["REPORT", "MANIFEST", "COMMITTED"]);
  const report = readFileSync(join(project, ST, "runs", review.run_id, "report.md"), "utf8");
  assert.ok(report.includes(injection.id) && report.includes("REVIEW_CONFIRMED"), "the confirmed finding is rendered");
  const c = ok(await runner.run("evidence", ["check", join(ST, "runs", review.run_id), "--integrity", "--drift"]), "check review");
  assert.deepEqual(lines(c.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  const p1 = parseVerify(fx, await runner.run("verify", ["all", "--finding", injection.id, "--base", review.head_oid, "--head", fix]));
  assert.equal(p1.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.match(p1.line("TESTS "), /^TESTS TESTS_PASS exe=/);
  return { review, injection, p1 };
}

async function buildPathB() {
  const fx = await provision({ externals: [], args: ["init", "--skills", "security-testing/secure-code-review,security-testing/security-evidence", "--target", "claude", "--yes"], name: "path (b)" });
  const { project, runner, genv, h } = fx;
  const st = join(project, ST);
  assert.ok(!existsSync(join(project, ".claude", "agents")), "no roster in the two-skill shape");
  assert.ok(!existsSync(join(st, "knowledge")), "no seed without --factory: engagement init writes the templates itself (D12)");
  await engage(fx, { seeded: false });
  const fix = fixOnBranch(fx);

  // a byte-identical twin (same key, same history, same seq) — the G-1 proof runs the same pipeline there
  const twinDir = join(h.tmpRoot, "twin");
  cpSync(project, twinDir, { recursive: true });
  const twin = { project: twinDir, genv, runner: makeRunner({ projectDir: twinDir, scriptsDir: installedScripts(twinDir), harnessEnv: h.env }) };

  const main = await reviewPipeline(fx, { fix });
  const other = await reviewPipeline(twin, { fix });
  assert.equal(other.review.run_id, main.review.run_id);
  assert.equal(other.p1.run_id, main.p1.run_id);

  // pass 2: positive tests + an `indeterminate` fix-review (with the ack) ⇒ UNVERIFIED-INDETERMINATE(fix-review)
  const { review, injection, p1 } = main;
  const indicator = p1.payload.suppression.indicators[0].id;
  const box = dirname(drop(project, p1.run_id, "fix-review.json", { type: "fix-review", subject_id: injection.id, packet_sha256: p1.payload.packet_sha256, assertion: "indeterminate", reviewer_run_id: p1.run_id }));
  drop(project, p1.run_id, "ack-1.json", { type: "ack", subject_id: injection.id, packet_sha256: p1.payload.packet_sha256, assertion: { indicator_id: indicator }, reviewer_run_id: p1.run_id });
  const p2 = parseVerify(fx, await runner.run("verify", ["all", "--finding", injection.id, "--base", review.head_oid, "--head", fix, "--receipts", box]));
  const so = await runner.run("evidence", ["sign-off", "--engagement", EID]);
  return { fx, twin, twinDir, review, injection, p1, p2, so };
}

test("two-skill path (b): sign-off exits 4 NO-ASSESSMENT, no UNGATED", { skip: SKIP }, async () => {
  const b = await pathB();
  const { fx, review, p1, p2, so } = b;
  assert.equal(so.code, 4, `${so.stdout}${so.stderr}`);
  const out = lines(so.stdout);
  assert.equal(out[0], "SIGN-OFF: FAIL(NO-ASSESSMENT)", "a review path never produces an assessment run (D12)");
  assert.equal(out[1], "RUNS: 3");
  assert.equal(out[2], `  ${review.run_id} seq=1 kind=review CONSISTENT`);
  assert.equal(out[3], `  ${p1.run_id} seq=2 kind=verify CONSISTENT`);
  assert.equal(out[4], `  ${p2.run_id} seq=3 kind=verify CONSISTENT`);
  assert.ok(!so.stdout.includes("UNGATED") && !so.stderr.includes("UNGATED"), "no UNGATED banner (G-13)");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!so.stdout.includes(s), s);
  // exactly the documented sequence, in its order (TASK-034 reads the same constant)
  assert.deepEqual(fx.runner.executedSequence(), [...STANDALONE_SEQUENCE]);
  // no step exits 2 for a missing template: the only 2 is the first engagement init, the only 4 is sign-off (US-007 AC-3)
  const codes = fx.runner.log.map((e) => [e.name, e.argv[0], e.argv[1], e.code]).filter((e) => e[3] !== 0);
  assert.deepEqual(codes, [["evidence", "engagement", "init", 2], ["evidence", "sign-off", "--engagement", 4]]);
  const report = readFileSync(join(fx.project, ST, "runs", review.run_id, "report.md"), "utf8");
  assert.ok(report.includes("Security review"), "a review report (the standalone deliverable)");
});

test("additional §12 fixtures", { skip: SKIP }, async () => {
  const b = await pathB();
  const { fx, twinDir, p1, p2, injection } = b;
  // positive tests + `indeterminate` fix-review ⇒ UNVERIFIED-INDETERMINATE(fix-review)
  assert.equal(p2.verdict, "UNVERIFIED-INDETERMINATE(fix-review)");
  assert.equal(p2.payload.tests.result, "TESTS_PASS");
  const fixReview = p2.payload.receipts.find((r) => r.type === "fix-review");
  assert.deepEqual(fixReview, { sha256: fixReview.sha256, type: "fix-review", assertion: "indeterminate", applied: true });
  assert.equal(p2.payload.receipts.find((r) => r.type === "ack").applied, true);
  assert.equal(p2.line("REGISTER: "), "REGISTER: no row for finding", "no register row in the standalone shape");
  assert.equal(p2.payload.finding_id, injection.id);
  assert.ok(!existsSync(join(fx.project, ST, "register", "events.jsonl")), "nothing appended to a register nobody opened for writing");

  // G-1: two identical runs on two byte-identical repos at different paths ⇒ byte-identical artifacts
  for (const sub of ["runs", "private", "ledger/index.json"]) {
    const here = join(fx.project, ST, sub);
    const there = join(twinDir, ST, sub);
    if (statSync(here).isDirectory()) {
      const a = treeDigest(here);
      const b2 = treeDigest(there);
      // pass 2 ran only on the main copy: compare the runs both copies made
      const shared = Object.keys(a).filter((rel) => !rel.startsWith(`${p2.run_id}/`));
      assert.ok(shared.length >= (sub === "runs" ? 10 : 1), `${sub}: ${shared.length} files compared`);
      for (const rel of shared) assert.equal(a[rel], b2[rel], `${sub}/${rel} differs between the twins`);
      assert.deepEqual(Object.keys(b2).sort(), shared.sort(), `${sub}: the twin made exactly the shared files`);
    } else {
      // the ledger: the twin lacks pass 2's entry, everything before it is identical
      const mine = readFileSync(here, "utf8");
      const theirs = readFileSync(there, "utf8");
      assert.ok(mine.includes(p1.run_id) && theirs.includes(p1.run_id));
      assert.ok(!theirs.includes(p2.run_id) && mine.includes(p2.run_id));
    }
  }
  assert.notEqual(fx.project, twinDir);
  // nothing under a payload names either path (G-1)
  for (const rel of walk(join(fx.project, ST, "runs"))) {
    const text = readFileSync(join(fx.project, ST, "runs", rel), "utf8");
    assert.ok(!text.includes(fx.project) && !text.includes(twinDir), `${rel} names a machine path`);
  }
});

// ---------------------------------------------------------------------------
// US-028 AC-4 — the reviewer in every host's native shape

test("security-reviewer appears in every host's native shape", { skip: SKIP }, async () => {
  const h = createOfflineInstall({ externals: [SD_EXTERNAL] });
  harnesses.push(h);
  const shapes = {
    claude: { file: ".claude/agents/security-reviewer/AGENT.md", soul: ".claude/agents/security-reviewer/SOUL.md", injected: false },
    cursor: { file: ".cursor/agents/security-reviewer/AGENT.md", soul: ".cursor/agents/security-reviewer/SOUL.md", injected: true },
    copilot: { file: ".github/agents/security-reviewer.agent.md", soul: null, injected: true },
    codex: { file: ".codex/agents/security-reviewer.toml", soul: null, injected: false },
  };
  for (const [target, shape] of Object.entries(shapes)) {
    const dir = join(h.tmpRoot, `target-${target}`);
    mkdirSync(dir);
    const r = await runInstaller({ env: h.env, cwd: dir, args: ["init", "--factory", "security-testing", "--target", target, "--yes"] });
    const out = r.stdout + r.stderr;
    assert.equal(r.code, 0, `${target}: ${out}`);
    assertNoNetwork(out);
    const file = join(dir, shape.file);
    assert.ok(existsSync(file), `${target}: ${shape.file}`);
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes("security-reviewer"), `${target}: names the agent`);
    if (target === "codex") {
      assert.match(text, /^name = "security-reviewer"$/m, "codex: TOML");
      assert.match(text, /^developer_instructions = '''$/m);
      assert.ok(!existsSync(join(dir, ".codex", "agents", "security-reviewer")), "codex: no directory form");
    } else {
      assert.match(text, /^name: security-reviewer$/m, `${target}: frontmatter`);
      assert.match(text, /^skills: \[memory, secure-code-review\]$/m);
      assert.match(text, /^skills-on-demand: \[security-evidence, systematic-debugging\]$/m);
    }
    assert.equal(text.includes("<!-- SKILLS-INJECTED: START -->"), shape.injected, `${target}: SKILLS-INJECTED ${shape.injected ? "present" : "absent"}`);
    if (shape.soul) assert.ok(existsSync(join(dir, shape.soul)), `${target}: SOUL.md sibling`);
    if (target === "copilot") assert.ok(!existsSync(join(dir, ".github", "agents", "security-reviewer")), "copilot: flat .agent.md, no directory");
    // every target gets the scripts and the three local skills
    const skillsDir = join(dir, TARGET_DIRS[target], "skills");
    for (const s of ["security-evidence", "secure-code-review", "security-engagement", "memory", "knowledge-curation", "systematic-debugging"]) assert.ok(existsSync(join(skillsDir, s, "SKILL.md")), `${target}: skill ${s}`);
    assert.ok(existsSync(join(skillsDir, "security-evidence", "scripts", "evidence.mjs")), `${target}: scripts`);
    assert.ok(existsSync(join(dir, ".agents", "memory", "security-reviewer", "project_briefing.md")), `${target}: briefing seeded`);
    for (const n of KNOWLEDGE_FILES) assert.ok(existsSync(join(dir, ST, "knowledge", n)), `${target}: knowledge/${n} seeded`);
  }
});

// ---------------------------------------------------------------------------
// US-030 AC-5 — every script has a sibling *.test.mjs

// M1 CLI-shape stubs whose sibling tests are owed by the task that fills them in
// (TASK-006 shipped the stubs; their behaviour is pinned by the entry-script
// tests named here). The day TASK-042 lands, the stub leaves this list and
// the sibling rule applies (TASK-039 removed lib/cmd-tm-lint.mjs's row when
// lib/cmd-tm-lint.test.mjs landed).
// TL-1 exception list, empty since TASK-042 landed cmd-plan.test.mjs (TASK-039 had removed its row): every lib module has a sibling test.
const STUB_TESTED_BY = Object.freeze({});

test("every script has a sibling *.test.mjs", () => {
  const scripts = walk(HERE).filter((rel) => rel.endsWith(".mjs") && !rel.endsWith(".test.mjs") && !rel.startsWith("fixtures/"));
  assert.ok(scripts.length > 60, `${scripts.length} scripts found`);
  const missing = [];
  for (const rel of scripts) {
    const sibling = `${rel.slice(0, -".mjs".length)}.test.mjs`;
    if (existsSync(join(HERE, sibling))) continue;
    // a stub is covered when its entry script dispatches into it AND that entry script has its own sibling test
    const owner = STUB_TESTED_BY[rel];
    if (owner) {
      const entry = join(HERE, owner.replace(/\.test\.mjs$/, ".mjs"));
      if (existsSync(join(HERE, owner)) && existsSync(entry) && readFileSync(entry, "utf8").includes(`./${rel}`)) continue;
    }
    missing.push(rel);
  }
  assert.deepEqual(missing, [], "scripts without a sibling test");
  for (const rel of Object.keys(STUB_TESTED_BY)) assert.ok(existsSync(join(HERE, rel)), `${rel} still exists (drop it from STUB_TESTED_BY otherwise)`);
  // fixtures never live in a directory named `test` (G-12); helpers under fixtures/ are not scripts
  for (const rel of walk(HERE)) assert.ok(!rel.split("/").includes("test"), `${rel} is under a directory named test`);
  const fixtureDirs = readdirSync(join(HERE, "fixtures")).filter((n) => statSync(join(HERE, "fixtures", n)).isDirectory());
  assert.ok(fixtureDirs.includes("offline") && fixtureDirs.includes("e2e") && fixtureDirs.includes("repo"));
  assert.equal(relative(HERE, join(HERE, "e2e.test.mjs")), "e2e.test.mjs");
});
