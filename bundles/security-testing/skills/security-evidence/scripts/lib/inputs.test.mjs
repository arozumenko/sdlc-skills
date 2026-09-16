// TASK-023 — lib/inputs.mjs: the closed, transitively closed input set (plan
// §3.3 row `lib/inputs.mjs`, §5 TASK-023; spec §6.3, TL-3, TL-14, G-16;
// US-016 AC-1…AC-3). Every run directory here is synthetic — written with
// the real canon.writeArtifact into a temp dir, never a committed fixture
// (G-12) — so the identities the closure follows are the writers' own.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, canonical, makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { cleanupAll, tmpDir } from "../fixtures/cli/harness.mjs";
import { CliError } from "./exit.mjs";
import { PathGuardError, REQUIRED, SETS, SINGLETONS, closeOver, pathGuard, setIdentity } from "./inputs.mjs";
import { parseTemplate } from "./render.mjs";
import { REPORT_TEMPLATES } from "./tokens.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "..", "templates");
const VERIFY_FIXTURES = join(HERE, "..", "fixtures", "verify");
const RUN_ID = "abcdef012345-0001";
const OID = "c2".repeat(20);
const head = (kind) => ({ schema_version: 1, kind, run_id: RUN_ID, engagement_id: "e", key_id: "k000000000000", now: () => "2026-09-16T00:00:00Z" });
const write = (dir, file, kind, payload) => writeArtifact(join(dir, file), makeEnvelope(head(kind), payload));
const writeMember = (dir, sub, kind, payload) => {
  const id = artifactId(payload);
  write(dir, join(sub, `${id}.json`), kind, payload);
  return id;
};

/** A minimal, internally consistent review run directory. */
function reviewRun() {
  const st = tmpDir("sec-inputs-");
  const dir = join(st, "runs", RUN_ID);
  mkdirSync(dir, { recursive: true });
  const scope = write(dir, "scope.json", "scope", { files: [{ path: "src/app.js", side: "head", oid: OID, file_hmac: "8".repeat(64), lines: 1 }], ranges: { "src/app.js": [[1, 1]] }, skipped: [] });
  write(dir, "run.json", "run", { engagement_id: "e", seq: 1, base_oid: "a0".repeat(20), head_oid: "b1".repeat(20), template: "review" });
  const scopePacket = writeMember(dir, "packets", "packet", { kind: "scope", subject_ids: [], files: [{ path: "src/app.js", side: "head", oid: OID, ranges: [[1, 1]], range_hmac: "6".repeat(64) }], policy_sha256: "9".repeat(64) });
  const examined = write(dir, "examined.json", "examined", { packet_sha256: scopePacket, declared: [{ path: "src/app.js", ranges: [[1, 1]] }] });
  const claimed = write(dir, "findings.claimed.json", "claimed", { scope_sha256: scope.envelope.self_sha256, findings: [] });
  write(dir, "gate-result.json", "gate-result", { accepted: [], unverifiable: [], rejected_counts: {}, scope_sha256: scope.envelope.self_sha256, claimed_sha256: claimed.envelope.self_sha256 });
  write(dir, "coverage.json", "coverage", { accounting: [{ path: "src/app.js", range: [1, 1], status: "examined", by: [examined.envelope.self_sha256] }], scanner_rows: [], scope_sha256: scope.envelope.self_sha256, examined_sha256: examined.envelope.self_sha256, indeterminate: false });
  write(dir, "rejects.json", "rejects", { rejected: [] });
  write(dir, "unlocated.json", "unlocated", { candidates: [] });
  const subject = writeMember(dir, "packets", "packet", { kind: "subject", subject_ids: ["f".repeat(64)], files: [{ path: "src/app.js", side: "head", oid: OID, ranges: [[1, 1]], range_hmac: "6".repeat(64) }], policy_sha256: "9".repeat(64) });
  const receipt = writeMember(dir, "receipts", "receipt", { type: "vulnerability-review", subject_id: "f".repeat(64), packet_sha256: subject, assertion: "confirmed", reviewer_run_id: RUN_ID });
  return { st, dir, scopePacket, subject, receipt };
}

test("REQUIRED: one closed list per template, review ⊂ assessment, and every template file's required-inputs block equals its list (US-016 AC-7)", () => {
  assert.deepEqual(Object.keys(REQUIRED).sort(), [...REPORT_TEMPLATES].sort());
  assert.deepEqual([...REQUIRED.review], ["run", "scope", "claimed", "gate-result", "coverage", "examined", "packets", "receipts", "rejects", "unlocated"]);
  assert.deepEqual([...REQUIRED.assessment], [...REQUIRED.review, "engagement", "threat-model", "observations", "imports", "verify-snapshots", "register-events", "proposals-index"]);
  assert.deepEqual([...REQUIRED.verify], ["run", "verify", "packets", "receipts"]);
  assert.deepEqual([...REQUIRED["threat-model"]], ["run", "threat-model", "packets", "receipts", "dispositions"]);
  for (const list of Object.values(REQUIRED)) {
    assert.ok(Object.isFrozen(list));
    for (const name of list) assert.ok(Object.hasOwn(SINGLETONS, name) || Object.hasOwn(SETS, name) || ["imports", "observations", "verify-snapshots"].includes(name), `${name} has a reader`);
  }
  const shipped = readdirSync(TEMPLATES).filter((f) => f.endsWith(".md") && f !== "README.md");
  assert.deepEqual(shipped.sort(), ["assessment.md", "review.md", "threat-model.md", "verify.md"], "TASK-023 shipped review + verify; TASK-024 ships assessment + threat-model");
  for (const file of shipped) {
    const t = parseTemplate(readFileSync(join(TEMPLATES, file), "utf8"));
    assert.equal(`${t.template}.md`, file, "template name equals the file stem");
    assert.deepEqual(t.required_inputs, [...REQUIRED[t.template]], `${file}: the block is the closed list`);
  }
});

test("pathGuard: reads inside a root pass, anything outside throws PathGuardError before I/O; dot-entries are skipped by list()", () => {
  const { st, dir } = reviewRun();
  const guard = pathGuard([dir]);
  assert.ok(guard.exists(join(dir, "run.json")));
  assert.ok(guard.allows(dir));
  assert.ok(!guard.allows(join(st, "runs")));
  for (const outside of [join(st, "register", "events.jsonl"), join(st, "runs", "abcdef012345-0002", "scope.json"), join(dir, "..", "..", "engagement.md"), "/etc/passwd"]) {
    assert.throws(() => guard.read(outside), (err) => err instanceof PathGuardError && err.name === "PathGuardError", outside);
    assert.throws(() => guard.exists(outside), PathGuardError, outside);
    assert.throws(() => guard.list(outside), PathGuardError, outside);
  }
  const sibling = `${dir}-not`; // `<run>-not` shares the prefix but is not inside
  mkdirSync(sibling, { recursive: true });
  assert.throws(() => guard.list(sibling), PathGuardError);
  writeFileSync(join(dir, "packets", ".x.json.tmp-1-1"), "{");
  mkdirSync(join(dir, "packets", ".lock"));
  assert.ok(guard.list(join(dir, "packets")).every((n) => !n.startsWith(".")), "tmp files and lock dirs never surface");
  assert.equal(guard.list(join(dir, "packets")).length, 2);
  assert.throws(() => pathGuard(["relative/dir"]), TypeError);
  assert.throws(() => pathGuard([]), TypeError);
});

test("setIdentity: sha256(canonical(sorted members)), order-independent", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  assert.equal(setIdentity([b, a]), sha256Hex(canonical([a, b])));
  assert.equal(setIdentity([]), sha256Hex(canonical([])));
  assert.throws(() => setIdentity(["x"]), TypeError);
});

test("closeOver(review): every required input loaded and verified, sets sorted by identity, hashes per the manifest rule (singleton self_sha256, set identity)", () => {
  const { dir, scopePacket, subject, receipt } = reviewRun();
  const inputs = closeOver(dir, "review");
  assert.equal(inputs.template, "review");
  assert.deepEqual(Object.keys(inputs.artifacts).sort(), [...REQUIRED.review].sort());
  assert.deepEqual(Object.keys(inputs.hashes), [...REQUIRED.review].sort(), "hashes keyed by input name, sorted");
  for (const name of Object.keys(SINGLETONS)) if (inputs.artifacts[name]) assert.equal(inputs.hashes[name], inputs.artifacts[name].envelope.self_sha256);
  assert.deepEqual(inputs.artifacts.packets.map((p) => p.envelope.self_sha256), [scopePacket, subject].sort());
  assert.deepEqual(inputs.artifacts.receipts.map((r) => r.envelope.self_sha256), [receipt]);
  assert.equal(inputs.hashes.packets, setIdentity([scopePacket, subject]));
  assert.equal(inputs.hashes.receipts, setIdentity([receipt]));
  assert.equal(inputs.artifacts.run.envelope.run_id, RUN_ID);
  // an empty receipts set is fine (spec: "may be empty")
  rmSync(join(dir, "receipts"), { recursive: true });
  const again = closeOver(dir, "review");
  assert.deepEqual(again.artifacts.receipts, []);
  assert.equal(again.hashes.receipts, setIdentity([]));
});

test("closeOver(review): each required input deleted ⇒ CliError 3 INCOMPLETE(<input>) (US-016 AC-2, table-driven)", () => {
  for (const name of REQUIRED.review) {
    if (name === "receipts") continue; // may be empty: an absent directory is the empty set
    const { dir } = reviewRun();
    const target = Object.hasOwn(SINGLETONS, name) ? join(dir, SINGLETONS[name].file) : join(dir, SETS[name].dir);
    rmSync(target, { recursive: true, force: true });
    assert.throws(
      () => closeOver(dir, "review"),
      (err) => err instanceof CliError && err.code === 3 && (name === "packets" ? /^INCOMPLETE\(packet:[0-9a-f]{64}\)$/.test(err.token) : err.token === `INCOMPLETE(${name})`),
      `${name} ⇒ ${name === "packets" ? "INCOMPLETE(packet:<sha>) (the closure notices the examined declaration's packet first)" : `INCOMPLETE(${name})`}`,
    );
  }
  assert.throws(() => closeOver(join(tmpDir("sec-inputs-none-"), "runs", "nope"), "review"), (err) => err instanceof CliError && err.token === "INCOMPLETE(run)");
});

test("closeOver: transitive closure — a receipt whose packet is missing ⇒ INCOMPLETE(packet:<sha>); an examined declaration whose scope packet is missing ⇒ the same (US-016 AC-3)", () => {
  const { dir, subject, receipt, scopePacket } = reviewRun();
  rmSync(join(dir, "packets", `${subject}.json`));
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 3 && err.token === `INCOMPLETE(packet:${subject})`);
  const other = reviewRun();
  rmSync(join(other.dir, "packets", `${other.scopePacket}.json`));
  assert.throws(() => closeOver(other.dir, "review"), (err) => err instanceof CliError && err.token === `INCOMPLETE(packet:${other.scopePacket})`);
  assert.ok(receipt && scopePacket);
});

test("closeOver: a tampered or misfiled artifact ⇒ CliError 5 INCONSISTENT(<file>); a foreign kind under the right name too", () => {
  const { dir, subject } = reviewRun();
  const p = join(dir, "packets", `${subject}.json`);
  const text = readFileSync(p, "utf8");
  writeFileSync(p, text.replace('"kind":"subject"', '"kind":"scope"'));
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === `INCONSISTENT(packets/${subject})`);
  writeFileSync(p, text);
  copyFileSync(p, join(dir, "packets", `${"1".repeat(64)}.json`)); // valid artifact, wrong name
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === `INCONSISTENT(packets/${"1".repeat(64)})`);
  rmSync(join(dir, "packets", `${"1".repeat(64)}.json`));
  writeFileSync(join(dir, "scope.json"), "{not json");
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(scope.json)");
  const { dir: d2 } = reviewRun();
  copyFileSync(join(d2, "run.json"), join(d2, "scope.json")); // a run artifact where the scope should be
  assert.throws(() => closeOver(d2, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(scope.json)");
});

test("closeOver: every artifact must name the run — run.json must name its directory, a self-consistent artifact enveloped for another run is 5 INCONSISTENT(<file>)", () => {
  const { dir } = reviewRun();
  const foreign = { ...head("scope"), run_id: "abcdef012345-0002" };
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  rmSync(join(dir, "scope.json"));
  writeArtifact(join(dir, "scope.json"), makeEnvelope(foreign, scope.payload)); // same payload, same identity, another run
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(scope.json)");
  rmSync(join(dir, "scope.json"));
  writeArtifact(join(dir, "scope.json"), makeEnvelope(head("scope"), scope.payload));
  const { subject } = reviewRun();
  assert.ok(subject);
  const ownSubject = readdirSync(join(dir, "packets")).find((n) => n.startsWith(subject)) ?? null;
  assert.equal(ownSubject, `${subject}.json`, "the same payload has the same identity in every run");
  const packet = readArtifact(join(dir, "packets", ownSubject), { kind: "packet" });
  rmSync(join(dir, "packets", ownSubject));
  writeArtifact(join(dir, "packets", ownSubject), makeEnvelope({ ...head("packet"), run_id: "abcdef012345-0002" }, packet.payload));
  assert.throws(() => closeOver(dir, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === `INCONSISTENT(packets/${subject})`);
  // run.json enveloped for another run: the directory and the envelope disagree
  const { dir: d3 } = reviewRun();
  const run = readArtifact(join(d3, "run.json"), { kind: "run" });
  rmSync(join(d3, "run.json"));
  writeArtifact(join(d3, "run.json"), makeEnvelope({ ...head("run"), run_id: "abcdef012345-0002" }, run.payload));
  assert.throws(() => closeOver(d3, "review"), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(run.json)");
});

test("closeOver never reads outside the run directory: a newer artifact planted in another run, the drop-box or the register is unused (US-016 AC-1, TL-3)", () => {
  const { st, dir } = reviewRun();
  const before = closeOver(dir, "review");
  const other = join(st, "runs", "abcdef012345-0002");
  mkdirSync(join(other, "packets"), { recursive: true });
  writeArtifact(join(other, "scope.json"), makeEnvelope({ ...head("scope"), run_id: "abcdef012345-0002" }, { files: [], ranges: {}, skipped: [] }));
  mkdirSync(join(st, "receipts", RUN_ID), { recursive: true });
  writeFileSync(join(st, "receipts", RUN_ID, "claims-9.json"), "{}");
  mkdirSync(join(st, "register"), { recursive: true });
  writeFileSync(join(st, "register", "events.jsonl"), "");
  const after = closeOver(dir, "review");
  assert.deepEqual(after.hashes, before.hashes);
  assert.deepEqual(after.artifacts.scope.payload, before.artifacts.scope.payload);
  assert.throws(() => closeOver(join(st, "runs", ".."), "review"), (err) => err instanceof CliError && err.token === "INCOMPLETE(run)", "a run dir that is not a run is incomplete, and nothing above it is opened");
  assert.throws(() => closeOver("relative", "review"), TypeError);
  assert.throws(() => closeOver(dir, "nope"), TypeError);
});

test("closeOver(verify): run + verify.json + the fix-review packet + receipts; the verify.json's packet must exist (INCOMPLETE(packet:<sha>))", () => {
  const rule = "verified-two-acks";
  const verify = readArtifact(join(VERIFY_FIXTURES, `${rule}.json`), { kind: "verify" });
  const run_id = verify.envelope.run_id;
  const st = tmpDir("sec-inputs-verify-");
  const dir = join(st, "runs", run_id);
  mkdirSync(join(dir, "packets"), { recursive: true });
  mkdirSync(join(dir, "receipts"), { recursive: true });
  copyFileSync(join(VERIFY_FIXTURES, `${rule}.json`), join(dir, "verify.json"));
  copyFileSync(join(VERIFY_FIXTURES, "packets", `${verify.payload.packet_sha256}.json`), join(dir, "packets", `${verify.payload.packet_sha256}.json`));
  for (const r of verify.payload.receipts) copyFileSync(join(VERIFY_FIXTURES, "receipts", `${r.sha256}.json`), join(dir, "receipts", `${r.sha256}.json`));
  const h = { schema_version: 1, kind: "run", run_id, engagement_id: verify.envelope.engagement_id, key_id: verify.envelope.key_id, now: () => "2026-09-16T00:00:00Z" };
  writeArtifact(join(dir, "run.json"), makeEnvelope(h, { engagement_id: verify.envelope.engagement_id, seq: 14, base_oid: verify.payload.base_oid, head_oid: verify.payload.head_oid, template: "verify" }));
  const inputs = closeOver(dir, "verify");
  assert.deepEqual(Object.keys(inputs.hashes), ["packets", "receipts", "run", "verify"]);
  assert.equal(inputs.hashes.verify, verify.envelope.self_sha256);
  assert.equal(inputs.artifacts.receipts.length, 3);
  rmSync(join(dir, "packets", `${verify.payload.packet_sha256}.json`));
  assert.throws(() => closeOver(dir, "verify"), (err) => err instanceof CliError && err.token === `INCOMPLETE(packet:${verify.payload.packet_sha256})`);
  rmSync(join(dir, "verify.json"));
  assert.throws(() => closeOver(dir, "verify"), (err) => err instanceof CliError && err.token === "INCOMPLETE(verify)");
});

test("closeOver(assessment): the run-init-shaped run (empty indexes, no threat model) is INCOMPLETE(threat-model); with a model, INCOMPLETE(register-events) until a snapshot is taken; imports/observations close over their members", () => {
  const { dir } = reviewRun();
  write(dir, "engagement.json", "engagement", { engagement_id: "e" });
  write(dir, "imports.json", "imports-index", { imports: [] });
  write(dir, "observations.json", "observations-index", { observations: [] });
  write(dir, "proposals-index.json", "proposals-index", { proposals: [] });
  assert.throws(() => closeOver(dir, "assessment"), (err) => err instanceof CliError && err.token === "INCOMPLETE(threat-model)");
  write(dir, "threat-model.json", "threat-model", { elements: [], threats: [] });
  assert.throws(() => closeOver(dir, "assessment"), (err) => err instanceof CliError && err.token === "INCOMPLETE(register-events)");
  write(dir, "register-events.json", "register-snapshot", { engagement_id: "e", seq: 0, chain_sha256: "0".repeat(64), events: [], aliases: [] });
  const inputs = closeOver(dir, "assessment");
  assert.deepEqual(Object.keys(inputs.hashes), [...REQUIRED.assessment].sort());
  assert.equal(inputs.hashes.imports, setIdentity([]));
  assert.equal(inputs.hashes.observations, setIdentity([]));
  assert.equal(inputs.hashes["verify-snapshots"], setIdentity([]));
  assert.equal(inputs.hashes["proposals-index"], inputs.artifacts["proposals-index"].envelope.self_sha256);
  // an index entry without its record is a missing transitive input
  write(dir, "imports.json", "imports-index", { imports: [{ kind: "sarif", import_sha256: "5".repeat(64), original_hmac: "6".repeat(64) }] });
  assert.throws(() => closeOver(dir, "assessment"), (err) => err instanceof CliError && err.token === `INCOMPLETE(import:${"5".repeat(64)})`);
});

test("closeOver(assessment): a verify snapshot is filed under its own run id — verify-snapshots/<id>/verify.json whose envelope names another run is 5 INCONSISTENT(verify-snapshots/<id>/verify.json) (TASK-024; PM log after G12)", () => {
  const { dir } = reviewRun();
  write(dir, "engagement.json", "engagement", { engagement_id: "e" });
  write(dir, "imports.json", "imports-index", { imports: [] });
  write(dir, "observations.json", "observations-index", { observations: [] });
  write(dir, "proposals-index.json", "proposals-index", { proposals: [] });
  write(dir, "threat-model.json", "threat-model", { elements: [], threats: [] });
  write(dir, "register-events.json", "register-snapshot", { engagement_id: "e", seq: 0, chain_sha256: "0".repeat(64), events: [], aliases: [] });
  const rule = "verified-two-acks";
  const verify = readArtifact(join(VERIFY_FIXTURES, `${rule}.json`), { kind: "verify" });
  const plant = (id) => {
    const snap = join(dir, "verify-snapshots", id);
    mkdirSync(join(snap, "packets"), { recursive: true });
    mkdirSync(join(snap, "receipts"), { recursive: true });
    copyFileSync(join(VERIFY_FIXTURES, `${rule}.json`), join(snap, "verify.json"));
    copyFileSync(join(VERIFY_FIXTURES, "packets", `${verify.payload.packet_sha256}.json`), join(snap, "packets", `${verify.payload.packet_sha256}.json`));
    for (const r of verify.payload.receipts) copyFileSync(join(VERIFY_FIXTURES, "receipts", `${r.sha256}.json`), join(snap, "receipts", `${r.sha256}.json`));
  };
  plant(verify.envelope.run_id);
  const inputs = closeOver(dir, "assessment");
  assert.equal(inputs.artifacts["verify-snapshots"].length, 1);
  assert.equal(inputs.artifacts["verify-snapshots"][0].id, verify.envelope.run_id);
  rmSync(join(dir, "verify-snapshots"), { recursive: true, force: true });
  plant("abcdef012345-0099");
  assert.throws(() => closeOver(dir, "assessment"), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(verify-snapshots/abcdef012345-0099/verify.json)");
});
