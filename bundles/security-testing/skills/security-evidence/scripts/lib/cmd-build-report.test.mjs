// TASK-023 — `evidence.mjs build-report --run <id> --template review|verify`
// (plan §4.1 row `build-report`, §5 TASK-023; spec §6.1 "build-report …
// writes COMMITTED marker containing the manifest hash, last", §6.3, §11;
// US-016 AC-1…AC-4, AC-6, AC-7; US-010 AC-3; G-10, G-16). Every repo is
// built in a temp dir by the CLI harness; every run is allocated by the real
// `run init`, scoped, scope-packeted, gated over claims, covered and
// receipted by the real commands, so the report is built over the bundle's
// own artifacts. The renderer's arithmetic is render.test.mjs; the closure
// is inputs.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, makeEnvelope, parseStrict, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS } from "../fixtures/sarif/index.mjs";
import { VERSION_PATH } from "./ctx.mjs";
import { REQUIRED, pathGuard, PathGuardError } from "./inputs.mjs";
import { loadTemplate } from "./cmd-build-report.mjs";
import { validate } from "./schema.mjs";
import { FORBIDDEN_STRINGS, NOT_INDEPENDENTLY_REVIEWED } from "./tokens.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_FIXTURES = join(HERE, "..", "fixtures", "verify");
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
const DUP_JS = "a();\nb();\na();\nb();\na();\n";

const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });
const CLAIMS = Object.freeze({
  injection: claim({
    title: "sql built from req.query.id",
    class: "injection",
    priority: "p1",
    path: "src/db.js",
    lines: [3, 4],
    snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
    description: "User input reaches the query string.",
    impact: "Full read of the users table.",
    remediation: "Parameterise the query.",
    cwe: "CWE-89",
    citations_typed: [
      { role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true },
      { role: "source", path: "src/app.js", side: "head", lines: [1, 1], context: true },
    ],
  }),
  app: claim({ title: "app export", class: "config", path: "src/app.js", lines: [1, 1], snippet: "export const a = 1;" }),
  sensitive: claim({ title: "credential in a comment", class: "config", priority: "p0", path: "src/db.js", lines: [6, 6], snippet: "// password=1234" }),
  failed: claim({ title: "not what the file says", class: "config", priority: "p3", path: "src/dup.js", lines: [1, 1], snippet: "z();" }),
  // three rejections, three reasons (US-010 AC-3 display)
  wroteId: claim({ id: "f".repeat(64) }),
  invalid: (() => {
    const c = claim({ title: "no priority" });
    delete c.priority;
    return c;
  })(),
  tooLong: claim({ title: "too long", path: "src/db.js", lines: [1, 50], snippet: "x" }),
});

const dropbox = (repo, run_id) => join(repo, ST, "receipts", run_id);

function drop(repo, run_id, name, value) {
  mkdirSync(dropbox(repo, run_id), { recursive: true });
  writeFileSync(join(dropbox(repo, run_id), name), JSON.stringify(value, null, 2));
  return join(ST, "receipts", run_id, name);
}

async function evidence(repo, args, env = ENV) {
  return runScript("evidence", args, { cwd: repo, env });
}

const build = (repo, run_id, template = "review") => evidence(repo, ["build-report", "--run", run_id, "--template", template]);

function parsePacketLine(stdout) {
  const m = PACKET_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `PACKET line: ${JSON.stringify(stdout)}`);
  return { path: m[1], sha256: m[2] };
}

/** Copy repo A's engagement key into repo B so both repos derive identical keyed identities (determinism across repos). */
function shareKey(from, to) {
  const src = join(from, ST, "private", "keys");
  const dst = join(to, ST, "private", "keys");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) copyFileSync(join(src, name), join(dst, name));
}

/**
 * A review run over src/app.js, src/db.js, src/dup.js: scoped, scope-
 * packeted, gated over CLAIMS (three accepted — one keyed —, one
 * CITATION_FAILED, three rejected for three reasons), covered by a
 * declaration over src/db.js 1-4, with a subject packet over the two
 * plain accepted findings. `withReceipt` admits a confirmed
 * vulnerability-review on `injection`.
 */
async function gatedRepo({ withReceipt = false, repo = readyRepo() } = {}) {
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  const s = await evidence(repo, ["scope", "--run", run_id]);
  assert.equal(s.code, 0, `scope: ${s.stdout}${s.stderr}`);
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const p = await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]);
  assert.equal(p.code, 0, `scope packet: ${p.stdout}${p.stderr}`);
  const scopePacket = parsePacketLine(p.stdout).sha256;
  const claims = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: Object.values(CLAIMS) });
  const g = await evidence(repo, ["gate", "--run", run_id, "--claims", claims]);
  assert.equal(g.code, 0, `gate: ${g.stdout}${g.stderr}`);
  assert.match(g.stdout, /^GATE accepted=3 unverifiable=1 rejected=3 unlocated=0/);
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: scopePacket, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] });
  const c = await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]);
  assert.equal(c.code, 0, `coverage: ${c.stdout}${c.stderr}`);
  const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
  const finding = (title) => {
    const f = claimed.payload.findings.find((x) => x.title === title);
    assert.ok(f, `gated finding titled ${JSON.stringify(title)}`);
    return f;
  };
  const injection = finding(CLAIMS.injection.title).id;
  const app = finding(CLAIMS.app.title).id;
  const sensitive = finding(CLAIMS.sensitive.title).id;
  const failed = finding(CLAIMS.failed.title).id;
  const sp = await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", injection, "--subject", app]);
  assert.equal(sp.code, 0, `subject packet: ${sp.stdout}${sp.stderr}`);
  const subject = parsePacketLine(sp.stdout).sha256;
  let receipt = null;
  if (withReceipt) {
    const file = drop(repo, run_id, "receipt-1.json", { type: "vulnerability-review", subject_id: injection, packet_sha256: subject, assertion: "confirmed", reviewer_run_id: run_id });
    const r = await evidence(repo, ["receipt", "validate", "--run", run_id, file]);
    assert.equal(r.code, 0, `receipt validate: ${r.stdout}${r.stderr}`);
    receipt = /sha256=([0-9a-f]{64})/.exec(r.stdout)[1];
  }
  return { repo, run_id, dir, scope, scopePacket, subject, claimed, ids: { injection, app, sensitive, failed }, receipt };
}

const lines = (s) => s.split("\n").filter((l) => l !== "");
const outputs = (dir) => ({ report: join(dir, "report.md"), manifest: join(dir, "manifest.json"), committed: join(dir, "COMMITTED") });
const none = (dir) => Object.values(outputs(dir)).every((p) => !existsSync(p));

// --- the happy path ------------------------------------------------------------------

test("COMMITTED last and equal to the manifest hash; manifest payload shape; inputs are the run's own identities; tool_version equals version.json (US-016 AC-4)", async () => {
  const { repo, run_id, dir, scope, scopePacket, subject, claimed } = await gatedRepo();
  const r = await build(repo, run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out.length, 3);
  assert.equal(out[0], `REPORT ${ST}/runs/${run_id}/report.md`);
  assert.match(out[1], /^MANIFEST sha256=[0-9a-f]{64}$/);
  assert.equal(out[2], "COMMITTED", "COMMITTED is the last line");
  const { report, manifest: manifestPath, committed } = outputs(dir);
  const manifest = readArtifact(manifestPath, { kind: "manifest" });
  assert.equal(readFileSync(committed, "utf8"), `${manifest.envelope.self_sha256}\n`, "the marker is the manifest hash + LF");
  assert.equal(out[1], `MANIFEST sha256=${manifest.envelope.self_sha256}`);
  assert.deepEqual(Object.keys(manifest.payload).sort(), ["inputs", "report_sha256", "template", "template_version", "tool_version"]);
  assert.deepEqual(validate("manifest", manifest.payload), []);
  assert.equal(manifest.payload.template, "review");
  assert.equal(manifest.payload.template_version, 1);
  assert.equal(manifest.payload.tool_version, parseStrict(readFileSync(VERSION_PATH)).tool_version, "P5: tool_version comes from scripts/version.json");
  assert.equal(manifest.payload.report_sha256, sha256Hex(readFileSync(report)));
  assert.deepEqual(Object.keys(manifest.payload.inputs), [...REQUIRED.review].sort());
  assert.equal(manifest.payload.inputs.scope, scope.envelope.self_sha256);
  assert.equal(manifest.payload.inputs.claimed, claimed.envelope.self_sha256);
  for (const name of ["run", "gate-result", "coverage", "examined", "rejects", "unlocated"]) {
    const file = name === "run" ? "run.json" : `${name}.json`;
    assert.equal(manifest.payload.inputs[name], readArtifact(join(dir, file)).envelope.self_sha256, name);
  }
  assert.equal(manifest.payload.inputs.packets, sha256Hex(Buffer.from(JSON.stringify([scopePacket, subject].sort()), "utf8")), "a set input hashes the sorted member identities");
  assert.equal(manifest.payload.inputs.receipts, sha256Hex(Buffer.from("[]", "utf8")), "an empty set is the identity of []");
  assert.equal(manifest.envelope.run_id, run_id);
  assert.equal(manifest.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  assert.equal(manifest.envelope.key_id, readArtifact(join(dir, "run.json")).envelope.key_id, "enveloped with the run's key");
  // the run is closed: a second build is refused, nothing rewritten (G-10)
  const before = readFileSync(report);
  const again = await build(repo, run_id);
  assert.equal(again.code, 2);
  assert.equal(again.stdout, "RUN-COMMITTED\n");
  assert.ok(readFileSync(report).equals(before));
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith(".")), [], "no tmp file left behind");
});

test("the report: twelve sections, coverage is section 2, section 3 shows rejected counts by reason totalling three (US-010 AC-3), keyed evidence redacted, no forbidden string", async () => {
  const { repo, run_id, dir, ids } = await gatedRepo();
  const r = await build(repo, run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const text = readFileSync(outputs(dir).report, "utf8");
  const headings = [...text.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(
    headings.map((h) => h[0]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(headings[1][1], "Coverage", "D3: coverage is report section 2");
  assert.equal(headings[2][1], "Executive summary");
  const section3 = text.slice(text.indexOf("## 3. "), text.indexOf("## 4. "));
  assert.match(section3, /- rejected candidates: 3 <!-- v:summary\.rejected_total -->/);
  assert.match(section3, /\| agent-wrote-id \| 1 \| <!-- v:summary\.rejected_by_reason\.agent-wrote-id -->/);
  assert.match(section3, /\| claim-invalid \| 1 \| <!-- v:summary\.rejected_by_reason\.claim-invalid -->/);
  assert.match(section3, /\| RANGE-TOO-LONG \| 1 \| <!-- v:summary\.rejected_by_reason\.RANGE-TOO-LONG -->/);
  assert.match(section3, /\| p0 \| 1 \| 0 \| 0 \| 0 \| 0 \| <!-- v:summary\.by_priority_state\.p0 -->/, "the keyed p0 finding is CITATION_VERIFIED");
  assert.match(section3, /\| p3 \| 0 \| 1 \| 0 \| 0 \| 0 \| <!-- v:summary\.by_priority_state\.p3 -->/, "the failed p3 finding is CITATION_FAILED");
  assert.match(section3, /\| p3 \| 1 \| <!-- v:summary\.unresolved_by_priority\.p3 -->/);
  assert.match(section3, /- unauthenticated approvals: unknown \/ not assessed/);
  const section2 = text.slice(text.indexOf("## 2. "), text.indexOf("## 3. "));
  assert.match(section2, /\| src\/db\.js \| 1-4 \| examined \| [0-9a-f]{64} \| <!-- v:coverage\.accounting\[\d+\] -->/);
  assert.match(section2, /\| src\/app\.js \| 1-1 \| unexamined \| \(none\) \|/);
  for (const id of Object.values(ids)) assert.ok(text.includes(id), `finding ${id} rendered`);
  assert.ok(text.includes("<REDACTED:password-assign>"), "keyed evidence is shown redacted");
  assert.ok(!text.includes("password=1234"), "the protected bytes never reach the report");
  assert.ok(text.includes(`| sensitive | yes (keyed identity) | <!-- v:findings[`), "the keyed finding says so");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!text.includes(s), s);
  assert.ok(!/\|[ \t]*\|/.test(text), "no blank cell");
  assert.match(text, /\| class \/ CWE \| injection \/ CWE-89 \|/);
  assert.match(text, /\| class \/ CWE \| config \/ unknown \/ not assessed \|/, "an absent CWE reads unknown / not assessed");
  assert.match(text, /^Typed citations:$/m);
  assert.match(text, /\| sink \| src\/db\.js \| head \| 4-4 \| true \|/);
});

test("no receipts ⇒ every accepted finding rendered as not independently reviewed; with a confirmed vulnerability-review receipt the finding shows REVIEW_CONFIRMED and names the receipt", async () => {
  const bare = await gatedRepo();
  let r = await build(bare.repo, bare.run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  let text = readFileSync(outputs(bare.dir).report, "utf8");
  const reviewRows = text.match(/^\| review \| .* \| <!-- v:findings\[\d+\]\.review -->$/gm);
  assert.equal(reviewRows.length, 4);
  assert.equal(reviewRows.filter((l) => l.includes(NOT_INDEPENDENTLY_REVIEWED)).length, 3, "the three accepted findings");
  assert.equal(reviewRows.filter((l) => l.includes("citation failed")).length, 1);
  assert.ok(!/\| state \| REVIEW_/.test(text), "no derived review state without a receipt");

  const with_ = await gatedRepo({ withReceipt: true });
  r = await build(with_.repo, with_.run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  text = readFileSync(outputs(with_.dir).report, "utf8");
  assert.match(text, new RegExp(`\\| review \\| confirmed by receipt ${with_.receipt} \\| <!-- v:findings\\[\\d+\\]\\.review -->`));
  assert.equal(text.match(/^\| review \| .* \| <!-- v:findings\[\d+\]\.review -->$/gm).filter((l) => l.includes(NOT_INDEPENDENTLY_REVIEWED)).length, 2);
  assert.match(text, /\| p1 \| 0 \| 0 \| 1 \| 0 \| 0 \| <!-- v:summary\.by_priority_state\.p1 -->/, "p1: the confirmed injection finding");
  const manifest = readArtifact(outputs(with_.dir).manifest, { kind: "manifest" });
  assert.equal(manifest.payload.inputs.receipts, sha256Hex(Buffer.from(JSON.stringify([with_.receipt]), "utf8")));
});

test("deterministic render: byte-identical report and manifest identity across two repos built from the same inputs and the same key (US-016 AC-6, G-1)", async () => {
  const a = await gatedRepo();
  const repoB = readyRepo();
  shareKey(a.repo, repoB);
  const b = await gatedRepo({ repo: repoB });
  assert.equal(a.run_id, b.run_id, "same commits (fixed dates) and same seq ⇒ same run id");
  for (const which of [a, b]) {
    const r = await build(which.repo, which.run_id);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  }
  const ra = readFileSync(outputs(a.dir).report);
  const rb = readFileSync(outputs(b.dir).report);
  assert.ok(ra.equals(rb), "byte-identical report");
  assert.equal(readFileSync(outputs(a.dir).committed, "utf8"), readFileSync(outputs(b.dir).committed, "utf8"), "identical manifest identity");
  assert.ok(readFileSync(outputs(a.dir).manifest).equals(readFileSync(outputs(b.dir).manifest)), "byte-identical manifest (fixed clock)");
});

test("an interrupted build resumes: report.md / manifest.json already present with the same bytes are kept; a different report.md or manifest.json is 5 INCONSISTENT(<file>) and COMMITTED is never written before the manifest", async () => {
  const { repo, run_id, dir } = await gatedRepo();
  const r = await build(repo, run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const { report, manifest, committed } = outputs(dir);
  const reportBytes = readFileSync(report);
  const marker = readFileSync(committed, "utf8");
  rmSync(committed);
  rmSync(manifest);
  const resumed = await build(repo, run_id);
  assert.equal(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
  assert.equal(readFileSync(committed, "utf8"), marker);
  assert.ok(readFileSync(report).equals(reportBytes));
  // a foreign report.md: refused, nothing else written
  rmSync(committed);
  rmSync(manifest);
  writeFileSync(report, "# not the report\n");
  const bad = await build(repo, run_id);
  assert.equal(bad.code, 5);
  assert.equal(bad.stdout, "INCONSISTENT(report.md)\n");
  assert.ok(!existsSync(manifest) && !existsSync(committed));
  writeFileSync(report, reportBytes);
  // a foreign manifest.json: report accepted, manifest refused, COMMITTED absent (write order report → manifest → COMMITTED)
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  writeArtifact(manifest, makeEnvelope({ schema_version, kind: "manifest", run_id, engagement_id, key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { inputs: {}, report_sha256: "0".repeat(64), template: "review", template_version: 1, tool_version: "0.0.0" }));
  const bad2 = await build(repo, run_id);
  assert.equal(bad2.code, 5);
  assert.equal(bad2.stdout, "INCONSISTENT(manifest.json)\n");
  assert.ok(!existsSync(committed), "COMMITTED is written last, after the manifest");
});

// --- refusals ------------------------------------------------------------------------

test("review: each required input deleted ⇒ exit 3 INCOMPLETE(<input>), no report (US-016 AC-2, table-driven)", async () => {
  const { repo, run_id, dir, scopePacket } = await gatedRepo();
  const files = { run: "run.json", scope: "scope.json", claimed: "findings.claimed.json", "gate-result": "gate-result.json", coverage: "coverage.json", examined: "examined.json", rejects: "rejects.json", unlocated: "unlocated.json", packets: "packets" };
  for (const name of REQUIRED.review) {
    if (name === "receipts") continue; // may be empty (spec §6.3)
    const target = join(dir, files[name]);
    const aside = `${target}.aside`;
    renameSync(target, aside);
    const r = await build(repo, run_id);
    renameSync(aside, target);
    if (name === "run") {
      assert.equal(r.code, 2, name);
      assert.match(r.stdout, /^USAGE\(build-report: unknown run /, "no run.json is an unknown run");
    } else if (name === "packets") {
      assert.equal(r.code, 3, name);
      assert.equal(r.stdout, `INCOMPLETE(packet:${scopePacket})\n`, "the examined declaration's scope packet is the first missing reference");
    } else {
      assert.equal(r.code, 3, `${name}: ${r.stdout}${r.stderr}`);
      assert.equal(r.stdout, `INCOMPLETE(${name})\n`);
    }
    assert.ok(none(dir), `${name}: no report, manifest or marker`);
  }
  // an empty receipts set is not incomplete
  rmSync(join(dir, "receipts"), { recursive: true, force: true });
  const ok = await build(repo, run_id);
  assert.equal(ok.code, 0, `${ok.stdout}${ok.stderr}`);
});

test("transitive closure: a receipt whose packet is missing ⇒ 3 INCOMPLETE(packet:<sha>) (US-016 AC-3)", async () => {
  const { repo, run_id, dir, subject } = await gatedRepo({ withReceipt: true });
  rmSync(join(dir, "packets", `${subject}.json`));
  const r = await build(repo, run_id);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, `INCOMPLETE(packet:${subject})\n`);
  assert.ok(none(dir));
});

test("reads only the run directory: a newer artifact planted in another run, the drop-box or the register is unused; the path guard throws on anything outside (US-016 AC-1, TL-3, G-16)", async () => {
  const { repo, run_id, dir, scope } = await gatedRepo();
  const st = join(repo, ST);
  // plant: a second run with a different scope, a claims file in the drop-box, a live register
  const other = join(st, "runs", "abcdef012345-0002");
  mkdirSync(other, { recursive: true });
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  writeArtifact(join(other, "scope.json"), makeEnvelope({ schema_version: run.envelope.schema_version, kind: "scope", run_id: "abcdef012345-0002", engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { files: [], ranges: {}, skipped: [] }));
  writeFileSync(join(dropbox(repo, run_id), "claims-2.json"), JSON.stringify({ scope_sha256: "0".repeat(64), packet_sha256: "0".repeat(64), findings: [] }));
  mkdirSync(join(st, "register"), { recursive: true });
  writeFileSync(join(st, "register", "events.jsonl"), '{"seq":1}\n');
  const r = await build(repo, run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const manifest = readArtifact(outputs(dir).manifest, { kind: "manifest" });
  assert.equal(manifest.payload.inputs.scope, scope.envelope.self_sha256, "this run's scope, not the planted one");
  assert.ok(!existsSync(join(other, "COMMITTED")) && !existsSync(join(other, "report.md")), "the other run is untouched");
  const text = readFileSync(outputs(dir).report, "utf8");
  assert.ok(text.includes("unknown / not assessed — the review template carries no register snapshot"), "the live register is never consulted");
  const guard = pathGuard([dir]);
  for (const outside of [join(other, "scope.json"), join(st, "register", "events.jsonl"), join(dropbox(repo, run_id), "claims-2.json"), join(st, "ledger", "index.json"), join(st, "private", "keys", "current")]) {
    assert.throws(() => guard.read(outside), PathGuardError, outside);
  }
});

test("gate re-run refuses a gate-result that no longer follows from claimed + scope + rejects: 5 INCONSISTENT(gate-result), nothing written", async () => {
  const { repo, run_id, dir } = await gatedRepo();
  const path = join(dir, "gate-result.json");
  const gr = readArtifact(path, { kind: "gate-result" });
  const payload = { ...gr.payload, accepted: gr.payload.accepted.slice(1) };
  rmSync(path);
  writeArtifact(path, makeEnvelope({ schema_version: gr.envelope.schema_version, kind: "gate-result", run_id, engagement_id: gr.envelope.engagement_id, key_id: gr.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, payload));
  const r = await build(repo, run_id);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, "INCONSISTENT(gate-result)\n");
  assert.ok(none(dir));
  // a byte-tampered artifact is inconsistent at the read (5 INCONSISTENT(<file>))
  writeFileSync(join(dir, "coverage.json"), readFileSync(join(dir, "coverage.json"), "utf8").replace('"indeterminate":false', '"indeterminate":true'));
  const t = await build(repo, run_id);
  assert.equal(t.code, 5);
  assert.equal(t.stdout, "INCONSISTENT(coverage.json)\n");
});

test("usage: --run and --template required and shaped; unknown run; the template must be the run's kind; a template not shipped yet is refused", async () => {
  const { repo, run_id, dir } = await gatedRepo();
  const cases = [
    [["build-report", "--template", "review"], /^USAGE\(build-report: --run is required\)$/],
    [["build-report", "--run", run_id], /^USAGE\(build-report: --template is required/],
    [["build-report", "--run", run_id, "--template", "pdf"], /^USAGE\(build-report: --template must be one of review\|assessment\|verify\|threat-model/],
    [["build-report", "--run", "nope", "--template", "review"], /^USAGE\(build-report: --run must be/],
    [["build-report", "--run", "abcdef012345-0099", "--template", "review"], /^USAGE\(build-report: unknown run abcdef012345-0099\)$/],
    [["build-report", "--run", run_id, "--template", "verify"], /^USAGE\(build-report: run [0-9a-f]{12}-0001 is a review run; --template must be review\)$/],
    [["build-report", "--run", run_id, "--template", "review", "extra"], /^USAGE\(build-report: unexpected argument extra\)$/],
  ];
  for (const [argv, expected] of cases) {
    const r = await evidence(repo, argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout.trim(), expected, argv.join(" "));
  }
  assert.ok(none(dir));
  // an assessment run: the template lands in TASK-024
  const assessment = await initRun(repo, "assessment");
  const a = await build(repo, assessment, "assessment");
  assert.equal(a.code, 2);
  assert.equal(a.stdout, "USAGE(build-report: template assessment is not shipped yet)\n");
  const tm = await initRun(repo, "threat-model", ["--base", "HEAD"]);
  const t = await build(repo, tm, "threat-model");
  assert.equal(t.code, 2);
  assert.equal(t.stdout, "USAGE(build-report: template threat-model is not shipped yet)\n");
});

test("template required-inputs lists match inputs.mjs (US-016 AC-7): loadTemplate agrees with REQUIRED for every shipped template", () => {
  for (const name of ["review", "verify"]) {
    const t = loadTemplate(name);
    assert.equal(t.template, name);
    assert.deepEqual(t.required_inputs, [...REQUIRED[name]]);
    assert.equal(t.template_version, 1);
  }
  assert.throws(() => loadTemplate("assessment"), (err) => err.code === 2 && err.token === "USAGE(build-report: template assessment is not shipped yet)");
});

test("key unavailable: the report still builds, Limitations say KEY: unavailable and name the keyed finding; plain identities are still re-derived", async () => {
  const { repo, run_id, dir, ids } = await gatedRepo();
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  rmSync(join(repo, ST, "private", "keys", run.envelope.key_id));
  const r = await build(repo, run_id);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const text = readFileSync(outputs(dir).report, "utf8");
  assert.match(text, /^- key: unavailable <!-- v:key -->$/m);
  assert.match(text, new RegExp(`^- KEY: unavailable — keyed identities not re-derived for: ${ids.sensitive} <!-- v:limitations\\[0\\] -->$`, "m"));
});

// --- the verify template (PM log G12: lives here to break the 027 ↔ 024 cycle) ----------

/**
 * Re-envelope a TASK-026 fixture rule under the run's own identity (run_id,
 * engagement_id, key_id from run.json): payloads are unchanged, so every
 * self_sha256 — and every file name — stays what verify.json names, and the
 * closure's "every artifact of the run names the run" check holds.
 * `withVerify: false` plants only the packet and receipts.
 */
function plantVerify(repo, run_id, rule, { withVerify = true, evaluation } = {}) {
  const dir = runDir(repo, run_id);
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  const head = (kind) => ({ schema_version, kind, run_id, engagement_id, key_id, now: () => ENV.SECURITY_EVIDENCE_NOW });
  const verify = readArtifact(join(VERIFY_FIXTURES, `${rule}.json`), { kind: "verify" });
  const packet = readArtifact(join(VERIFY_FIXTURES, "packets", `${verify.payload.packet_sha256}.json`), { kind: "packet" });
  writeArtifact(join(dir, "packets", `${packet.envelope.self_sha256}.json`), makeEnvelope(head("packet"), packet.payload));
  for (const rc of verify.payload.receipts) {
    const receipt = readArtifact(join(VERIFY_FIXTURES, "receipts", `${rc.sha256}.json`), { kind: "receipt" });
    writeArtifact(join(dir, "receipts", `${receipt.envelope.self_sha256}.json`), makeEnvelope(head("receipt"), receipt.payload));
  }
  const payload = evaluation === undefined ? verify.payload : { ...verify.payload, evaluation: { ...verify.payload.evaluation, ...evaluation } };
  if (withVerify) writeArtifact(join(dir, "verify.json"), makeEnvelope(head("verify"), payload));
  return { verify, payload };
}

test("verify template: a verify-kind run carrying a TASK-026 verify.json + its packet + receipts builds a COMMITTED report whose section 2 is the VERDICT line", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "verify");
  const dir = runDir(repo, run_id);
  for (const rule of ["verified-two-acks"]) {
    const { verify } = plantVerify(repo, run_id, rule);
    const r = await build(repo, run_id, "verify");
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.equal(lines(r.stdout)[2], "COMMITTED");
    const text = readFileSync(outputs(dir).report, "utf8");
    const p = verify.payload;
    const verdict = `VERDICT VERIFIED finding=${p.finding_id} base=${p.base_oid} head=${p.head_oid} tested_tree=same-as-head verify=${verify.envelope.self_sha256}`;
    assert.ok(text.includes(`\n${verdict} <!-- v:verify.verdict_line -->\n`), text);
    assert.match(text, /^# Fix verification — run /m);
    assert.match(text, /\| tests\.result \| TESTS_PASS \|/);
    assert.match(text, /\| ack \| [0-9a-f]{64} \| true \| indicator [0-9a-f]{64} \| - \| <!-- v:verify\.receipts\[\d+\] -->/);
    const manifest = readArtifact(outputs(dir).manifest, { kind: "manifest" });
    assert.equal(manifest.payload.template, "verify");
    assert.deepEqual(Object.keys(manifest.payload.inputs), ["packets", "receipts", "run", "verify"]);
    assert.equal(manifest.payload.inputs.verify, verify.envelope.self_sha256);
    assert.equal(readFileSync(outputs(dir).committed, "utf8"), `${manifest.envelope.self_sha256}\n`);
  }
  // a verify run without verify.json is incomplete
  const second = await initRun(repo, "verify");
  const r = await build(repo, second, "verify");
  assert.equal(r.code, 3);
  assert.equal(r.stdout, "INCOMPLETE(verify)\n");
});

test("verify template: a tampered evaluation (hash-consistent) is 5 INCONSISTENT(verify)", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "verify");
  const dir = runDir(repo, run_id);
  const { verify, payload } = plantVerify(repo, run_id, "verified-two-acks", { evaluation: { verdict: "REGRESSED" } });
  const r = await build(repo, run_id, "verify");
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, "INCONSISTENT(verify)\n");
  assert.ok(none(dir));
  assert.ok(artifactId(payload) !== verify.envelope.self_sha256);
  // a verify.json copied verbatim from another run (self-consistent, foreign envelope) is not this run's
  rmSync(join(dir, "verify.json"));
  copyFileSync(join(VERIFY_FIXTURES, "verified-two-acks.json"), join(dir, "verify.json"));
  const foreign = await build(repo, run_id, "verify");
  assert.equal(foreign.code, 5);
  assert.equal(foreign.stdout, "INCONSISTENT(verify.json)\n");
  assert.ok(none(dir));
});
