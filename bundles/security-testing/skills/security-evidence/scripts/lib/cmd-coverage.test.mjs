// TASK-020 — `evidence.mjs coverage --run <id> --examined <payload.json>
// [--scanner-rows <file>]` (plan §4.1 row `coverage`, §5 TASK-020; spec D3,
// §6.1 `coverage.json` preimage, §6.3 derivation table, TL-4 drop-box, TL-15
// packet naming; US-014 AC-1…AC-4). Every repo is built in a temp dir by the
// CLI harness; every run is allocated by the real `run init`, scoped by the
// real `scope`, and its scope packet built by the real `packet --kind scope`,
// so the `packet_sha256` a declaration must name is TASK-057's, not this
// test's guess. The accounting arithmetic itself is coverage-core.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactId, canonical, makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript, tmpDir } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS, fixture } from "../fixtures/sarif/index.mjs";
import { defaultRecord } from "./engagement.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const COVERAGE_LINE = /^COVERAGE examined=([0-9]+) skipped=([0-9]+) scanner=([0-9]+)$/;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=scope files=([0-9]+)$/;
const IMPORT_LINE = /^IMPORT sarif import_sha256=([0-9a-f]{64}) /;
const DROPBOX = (run_id) => join(ST, "receipts", run_id);

/** A repo with src/app.js (1 line) and src/db.js (DB_JS: 7 normalised lines) committed. */
function twoFileRepo(opts) {
  const repo = readyRepo(opts);
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  return repo;
}

async function scoped(repo, run_id) {
  const r = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `scope: ${r.stdout}${r.stderr}`);
  return readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
}

async function scopePacket(repo, run_id) {
  const r = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `packet: ${r.stdout}${r.stderr}`);
  const m = PACKET_LINE.exec(r.stdout.split("\n")[0]);
  assert.ok(m, r.stdout);
  return m[2];
}

/** A run of `kind` with scope.json and its scope packet; returns everything a declaration needs. */
async function readyRun(repo, kind = "assessment") {
  const run_id = await initRun(repo, kind);
  const scope = await scoped(repo, run_id);
  const packet_sha256 = await scopePacket(repo, run_id);
  return { run_id, scope, packet_sha256 };
}

/** Write a payload-only JSON file into the agent drop-box `<st>/receipts/<run_id>/` (TL-4); returns its repo-relative path. */
function dropbox(repo, run_id, name, value) {
  const dir = join(repo, DROPBOX(run_id));
  mkdirSync(dir, { recursive: true });
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(dir, name), text);
  return join(DROPBOX(run_id), name);
}

const coverage = (repo, args, env = ENV) => runScript("evidence", ["coverage", ...args], { cwd: repo, env });
const readCoverage = (repo, run_id) => readArtifact(join(runDir(repo, run_id), "coverage.json"), { kind: "coverage" });
const readExamined = (repo, run_id) => readArtifact(join(runDir(repo, run_id), "examined.json"), { kind: "examined" });

function parseCoverageLine(stdout) {
  const m = COVERAGE_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the COVERAGE token: ${JSON.stringify(stdout)}`);
  return { examined: Number(m[1]), skipped: Number(m[2]), scanner: Number(m[3]) };
}

/** Assert a refusal: exit `code`, the token as the only stdout line, and no examined.json / coverage.json under the run. */
function assertRefused(repo, run_id, r, code, token) {
  assert.equal(r.code, code, r.stdout + r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, `one token line: ${JSON.stringify(r.stdout)}`);
  if (token instanceof RegExp) assert.match(lines[0], token);
  else assert.equal(lines[0], token);
  if (run_id !== null) {
    assert.ok(!existsSync(join(runDir(repo, run_id), "examined.json")), "examined.json not written");
    assert.ok(!existsSync(join(runDir(repo, run_id), "coverage.json")), "coverage.json not written");
  }
}

// --- AC-1 payload -----------------------------------------------------------------

test("payload shape (US-014 AC-1): examined.json is the enveloped declaration, coverage.json is {accounting, scanner_rows, scope_sha256, examined_sha256, indeterminate}; the drop-box is never written", async () => {
  const repo = twoFileRepo();
  const { run_id, scope, packet_sha256 } = await readyRun(repo);
  assert.deepEqual(
    scope.payload.files.map((f) => [f.path, f.lines]),
    [
      ["src/app.js", 1],
      ["src/db.js", 7],
    ],
  );
  const declaration = { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] };
  const file = dropbox(repo, run_id, "examined-1.json", declaration);
  const dropboxBytesBefore = readFileSync(join(repo, file));

  const r = await coverage(repo, ["--run", run_id, "--examined", file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 3, "COVERAGE + WROTE examined.json + WROTE coverage.json");
  assert.deepEqual(parseCoverageLine(r.stdout), { examined: 1, skipped: 0, scanner: 0 });

  const examined = readExamined(repo, run_id);
  assert.deepEqual(examined.payload, declaration, "the declaration is enveloped as written, ids and states never added (G-7)");
  assert.equal(examined.envelope.kind, "examined");
  assert.equal(examined.envelope.run_id, run_id);
  assert.equal(examined.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  assert.equal(lines[1], `WROTE ${ST}/runs/${run_id}/examined.json sha256=${examined.envelope.self_sha256}`);

  const cov = readCoverage(repo, run_id);
  assert.deepEqual(validate("coverage", cov.payload), []);
  assert.deepEqual(Object.keys(cov.payload).sort(), ["accounting", "examined_sha256", "indeterminate", "scanner_rows", "scope_sha256"]);
  assert.equal(cov.payload.scope_sha256, scope.envelope.self_sha256);
  assert.equal(cov.payload.examined_sha256, examined.envelope.self_sha256);
  assert.equal(cov.payload.indeterminate, false);
  assert.deepEqual(cov.payload.scanner_rows, []);
  assert.deepEqual(cov.payload.accounting, [
    { path: "src/app.js", range: [1, 1], status: "unexamined", by: [] },
    { path: "src/db.js", range: [1, 4], status: "examined", by: [examined.envelope.self_sha256] },
    { path: "src/db.js", range: [5, 7], status: "unexamined", by: [] },
  ]);
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  assert.equal(cov.envelope.key_id, run.envelope.key_id, "the run's key id, not whatever is current");
  assert.equal(cov.envelope.kind, "coverage");
  assert.equal(cov.envelope.self_sha256, artifactId(cov.payload));
  assert.equal(lines[2], `WROTE ${ST}/runs/${run_id}/coverage.json sha256=${cov.envelope.self_sha256}`);

  assert.deepEqual(readFileSync(join(repo, file)), dropboxBytesBefore, "no script writes into <st>/receipts/ (TL-4, G-7)");
  assert.deepEqual(readdirSync(join(repo, DROPBOX(run_id))), ["examined-1.json"]);
  assert.ok(!JSON.stringify(cov.payload).includes(repo), "no absolute path in the payload (G-1)");
});

// --- AC-2 exactly once ------------------------------------------------------------

test("every scoped range appears in exactly one entry; overlap fails naming the range (US-014 AC-2)", async () => {
  const repo = twoFileRepo();
  const { run_id, scope, packet_sha256 } = await readyRun(repo);
  const overlapping = dropbox(repo, run_id, "examined-1.json", {
    packet_sha256,
    declared: [
      { path: "src/db.js", ranges: [[1, 4]] },
      { path: "src/app.js", ranges: [[1, 1]] },
      { path: "src/db.js", ranges: [[3, 6]] },
    ],
  });
  const bad = await coverage(repo, ["--run", run_id, "--examined", overlapping]);
  assertRefused(repo, run_id, bad, 4, "OVERLAP(src/db.js:3-4)");

  const fine = dropbox(repo, run_id, "examined-2.json", {
    packet_sha256,
    declared: [
      { path: "src/db.js", ranges: [[1, 2], [5, 5]] },
      { path: "src/app.js", ranges: [[1, 1]] },
    ],
  });
  const r = await coverage(repo, ["--run", run_id, "--examined", fine]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseCoverageLine(r.stdout), { examined: 3, skipped: 0, scanner: 0 });
  const { accounting } = readCoverage(repo, run_id).payload;
  // every admitted range of scope.json is tiled exactly once by the entries of its path
  for (const [path, ranges] of Object.entries(scope.payload.ranges)) {
    const entries = accounting.filter((e) => e.path === path);
    for (const [s, e] of ranges) {
      let cursor = s;
      for (const entry of entries) {
        assert.equal(entry.range[0], cursor, `${path}: entry starts where the previous one ended`);
        cursor = entry.range[1] + 1;
      }
      assert.equal(cursor, e + 1, `${path}: the admitted range ${s}-${e} is covered to its end`);
    }
  }
  assert.deepEqual(
    accounting.map((e) => [e.path, e.range, e.status]),
    [
      ["src/app.js", [1, 1], "examined"],
      ["src/db.js", [1, 2], "examined"],
      ["src/db.js", [3, 4], "unexamined"],
      ["src/db.js", [5, 5], "examined"],
      ["src/db.js", [6, 7], "unexamined"],
    ],
  );
});

test("a skipped scope file is one skipped(<reason>) entry and is counted on the COVERAGE line", async () => {
  const repo = twoFileRepo();
  writeFileSync(join(repo, "src", "blob.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "binary"]);
  const { run_id, scope, packet_sha256 } = await readyRun(repo);
  assert.deepEqual(scope.payload.skipped, [{ path: "src/blob.bin", reason: "binary" }]);
  const file = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [] });
  const r = await coverage(repo, ["--run", run_id, "--examined", file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseCoverageLine(r.stdout), { examined: 0, skipped: 1, scanner: 0 });
  const { accounting } = readCoverage(repo, run_id).payload;
  assert.deepEqual(accounting.find((e) => e.status === "skipped"), { path: "src/blob.bin", range: [1, 1], status: "skipped", by: ["binary"] });
  assert.equal(accounting.filter((e) => e.status === "unexamined").length, 2, "a declaration gap is allowed and reported");
});

// --- AC-3 empty scope -------------------------------------------------------------

test("empty scope ⇒ INDETERMINATE printed and indeterminate:true in the payload (US-014 AC-3 producer half)", async () => {
  const record = defaultRecord();
  record.scope_paths = ["lib/"]; // nothing tracked there
  const repo = readyRepo({ record });
  const { run_id, scope, packet_sha256 } = await readyRun(repo);
  assert.deepEqual(scope.payload.files, []);
  const file = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [] });
  const r = await coverage(repo, ["--run", run_id, "--examined", file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "COVERAGE INDETERMINATE");
  assert.equal(lines.length, 3, "INDETERMINATE + two WROTE lines: the artifacts are written so sign-off can key on them");
  const cov = readCoverage(repo, run_id);
  assert.deepEqual(validate("coverage", cov.payload), []);
  assert.equal(cov.payload.indeterminate, true);
  assert.deepEqual(cov.payload.accounting, []);
  assert.equal(cov.payload.scope_sha256, scope.envelope.self_sha256);
  assert.equal(cov.payload.examined_sha256, readExamined(repo, run_id).envelope.self_sha256);
});

// --- AC-4 deterministic -----------------------------------------------------------

test("deterministic (US-014 AC-4): the same tree and declaration in two runs ⇒ byte-identical coverage payloads and identities; the clock never enters", async () => {
  const repo = twoFileRepo();
  const a = await readyRun(repo);
  const fileA = dropbox(repo, a.run_id, "examined-1.json", { packet_sha256: a.packet_sha256, declared: [{ path: "src/db.js", ranges: [[2, 3]] }] });
  const ra = await coverage(repo, ["--run", a.run_id, "--examined", fileA]);
  assert.equal(ra.code, 0, ra.stdout + ra.stderr);

  const b = await readyRun(repo);
  assert.notEqual(b.run_id, a.run_id);
  assert.equal(b.packet_sha256, a.packet_sha256, "same tree ⇒ same scope packet (TASK-057)");
  const fileB = dropbox(repo, b.run_id, "examined-1.json", { packet_sha256: b.packet_sha256, declared: [{ path: "src/db.js", ranges: [[2, 3]] }] });
  const rb = await coverage(repo, ["--run", b.run_id, "--examined", fileB], { ...ENV, SECURITY_EVIDENCE_NOW: "2027-01-01T00:00:00Z" });
  assert.equal(rb.code, 0, rb.stdout + rb.stderr);

  const ca = readCoverage(repo, a.run_id);
  const cb = readCoverage(repo, b.run_id);
  assert.deepEqual(canonical(ca.payload), canonical(cb.payload), "byte-identical payloads");
  assert.equal(ca.envelope.self_sha256, cb.envelope.self_sha256);
  assert.equal(ra.stdout.split("\n")[0], rb.stdout.split("\n")[0]);
  assert.notEqual(ca.envelope.created_at, cb.envelope.created_at, "only the envelope carries the clock (G-1)");
});

// --- packet binding (TL-15) -------------------------------------------------------

test("examined declaration naming a non-scope packet rejected: an unknown packet and a subject-kind packet are both 2 EXAMINED-PACKET-MISMATCH", async () => {
  const repo = twoFileRepo();
  const { run_id, packet_sha256 } = await readyRun(repo);
  const unknown = dropbox(repo, run_id, "examined-1.json", { packet_sha256: "f".repeat(64), declared: [] });
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", unknown]), 2, "EXAMINED-PACKET-MISMATCH");

  // a hash-consistent packet of another kind in this run's packets/ (what TASK-021 will write)
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const scopePacket = readArtifact(join(runDir(repo, run_id), "packets", `${packet_sha256}.json`), { kind: "packet" });
  const subjectPayload = { ...scopePacket.payload, kind: "subject", subject_ids: ["a".repeat(64)] };
  assert.deepEqual(validate("packet", subjectPayload), []);
  const head = { schema_version: run.envelope.schema_version, kind: "packet", run_id, engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW };
  const subjectSha = artifactId(subjectPayload);
  writeArtifact(join(runDir(repo, run_id), "packets", `${subjectSha}.json`), makeEnvelope(head, subjectPayload), { exclusive: true });
  const subject = dropbox(repo, run_id, "examined-2.json", { packet_sha256: subjectSha, declared: [] });
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", subject]), 2, "EXAMINED-PACKET-MISMATCH");

  // a packet of another run: same file name in a different run directory is not this run's packet
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "change"]);
  const other = await readyRun(repo);
  assert.notEqual(other.packet_sha256, packet_sha256);
  const foreign = dropbox(repo, run_id, "examined-3.json", { packet_sha256: other.packet_sha256, declared: [] });
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", foreign]), 2, "EXAMINED-PACKET-MISMATCH");

  // the right packet still admits
  const ok = dropbox(repo, run_id, "examined-4.json", { packet_sha256, declared: [] });
  const r = await coverage(repo, ["--run", run_id, "--examined", ok]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

// --- scanner rows -----------------------------------------------------------------

test("--scanner-rows: a row names a sarif import of the run; tool/version come from the record, paths default to the located paths; undeclared lines of those paths are scanner-only", async () => {
  const repo = twoFileRepo();
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  copyFileSync(fixture("located.sarif"), join(repo, ST, "imports", "located.sarif"));
  const { run_id, packet_sha256 } = await readyRun(repo);
  const ing = await runScript("evidence", ["ingest", "sarif", join(ST, "imports", "located.sarif"), "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(ing.code, 0, ing.stdout + ing.stderr);
  const import_sha256 = IMPORT_LINE.exec(ing.stdout)[1];

  const examined = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[3, 4]] }] });
  const rows = dropbox(repo, run_id, "scanner-rows.json", { rows: [{ import_sha256 }] });
  const r = await coverage(repo, ["--run", run_id, "--examined", examined, "--scanner-rows", rows]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseCoverageLine(r.stdout), { examined: 1, skipped: 0, scanner: 2 });
  const cov = readCoverage(repo, run_id);
  assert.deepEqual(validate("coverage", cov.payload), []);
  assert.deepEqual(cov.payload.scanner_rows, [{ tool: "Semgrep OSS", version: "1.90.0", import_sha256, paths: ["src/db.js"] }]);
  assert.deepEqual(
    cov.payload.accounting.map((e) => [e.path, e.range, e.status, e.by]),
    [
      ["src/app.js", [1, 1], "unexamined", []],
      ["src/db.js", [1, 2], "scanner-only", [import_sha256]],
      ["src/db.js", [3, 4], "examined", [cov.payload.examined_sha256]],
      ["src/db.js", [5, 7], "scanner-only", [import_sha256]],
    ],
  );
});

test("--scanner-rows: explicit paths are taken as given; an unknown import, a duplicate row, an off-shape file and unparseable bytes are 2 SCHEMA-INVALID(scanner-rows: …); nothing written", async () => {
  const repo = twoFileRepo();
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  copyFileSync(fixture("located.sarif"), join(repo, ST, "imports", "located.sarif"));
  const { run_id, packet_sha256 } = await readyRun(repo);
  const ing = await runScript("evidence", ["ingest", "sarif", join(ST, "imports", "located.sarif"), "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(ing.code, 0, ing.stdout + ing.stderr);
  const import_sha256 = IMPORT_LINE.exec(ing.stdout)[1];
  const examined = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [] });
  const run = (name, value) => coverage(repo, ["--run", run_id, "--examined", examined, "--scanner-rows", dropbox(repo, run_id, name, value)]);

  assertRefused(repo, run_id, await run("r1.json", { rows: [{ import_sha256: "0".repeat(64) }] }), 2, /^SCHEMA-INVALID\(scanner-rows: rows\[0\]\.import_sha256 names no import of this run\)$/);
  assertRefused(repo, run_id, await run("r2.json", { rows: [{ import_sha256 }, { import_sha256 }] }), 2, /^SCHEMA-INVALID\(scanner-rows: rows\[1\]\.import_sha256 is a duplicate\)$/);
  assertRefused(repo, run_id, await run("r3.json", { rows: [{ import_sha256, tool: "x" }] }), 2, /^SCHEMA-INVALID\(scanner-rows: rows\[0\]: unknown key tool\)$/);
  assertRefused(repo, run_id, await run("r4.json", [{ import_sha256 }]), 2, /^SCHEMA-INVALID\(scanner-rows: /);
  assertRefused(repo, run_id, await run("r5.json", { rows: [{ import_sha256, paths: ["src/db.js", ""] }] }), 2, /^SCHEMA-INVALID\(scanner-rows: rows\[0\]\.paths\[1\] must be a non-empty string\)$/);
  assertRefused(repo, run_id, await run("r6.json", "{not json"), 2, /^SCHEMA-INVALID\(scanner-rows: /);
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", examined, "--scanner-rows", join(DROPBOX(run_id), "absent.json")]), 2, /^USAGE\(coverage: cannot read /);

  const r = await run("ok.json", { rows: [{ import_sha256, paths: ["src/app.js", "src/app.js", "docs/never.md"] }] });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const cov = readCoverage(repo, run_id);
  assert.deepEqual(cov.payload.scanner_rows, [{ tool: "Semgrep OSS", version: "1.90.0", import_sha256, paths: ["docs/never.md", "src/app.js"] }]);
  assert.deepEqual(
    cov.payload.accounting.map((e) => [e.path, e.status]),
    [
      ["src/app.js", "scanner-only"],
      ["src/db.js", "unexamined"],
    ],
  );
});

// --- refusals ---------------------------------------------------------------------

test("argv and run refusals: missing flags, unknown run, missing scope, an examined file outside the tree or unreadable — one token, nothing written", async () => {
  const repo = twoFileRepo();
  const run_id = await initRun(repo, "assessment");
  const file = dropbox(repo, run_id, "examined-1.json", { packet_sha256: "0".repeat(64), declared: [] });
  assertRefused(repo, run_id, await coverage(repo, ["--examined", file]), 2, "USAGE(coverage: --run is required)");
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id]), 2, "USAGE(coverage: --examined <payload.json> is required)");
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", file, "extra"]), 2, "USAGE(coverage: unexpected argument extra)");
  assertRefused(repo, run_id, await coverage(repo, ["--run", "nope", "--examined", file]), 2, /^USAGE\(coverage: --run must be/);
  assertRefused(repo, run_id, await coverage(repo, ["--run", "0123456789ab-0099", "--examined", file]), 2, "USAGE(coverage: unknown run 0123456789ab-0099)");
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", file]), 3, "INCOMPLETE(scope)");
  await scoped(repo, run_id);
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", join(DROPBOX(run_id), "absent.json")]), 2, `USAGE(coverage: cannot read ${join(DROPBOX(run_id), "absent.json")})`);
  const outside = join(tmpDir("sec-outside-"), "examined.json");
  writeFileSync(outside, "{}\n");
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", outside]), 2, /^USAGE\(coverage: cannot read .* \(outside the work tree\)\)$/);
  assertRefused(repo, run_id, await coverage(repo, ["--run", run_id, "--examined", DROPBOX(run_id)]), 2, `USAGE(coverage: cannot read ${DROPBOX(run_id)})`);
});

test("a malformed or off-schema declaration is 2 SCHEMA-INVALID(examined: …): not JSON, a float, an unknown key, an agent-written id or state (G-7), a wrong range shape", async () => {
  const repo = twoFileRepo();
  const { run_id, packet_sha256 } = await readyRun(repo);
  const run = (name, value) => coverage(repo, ["--run", run_id, "--examined", dropbox(repo, run_id, name, value)]);
  assertRefused(repo, run_id, await run("e1.json", "{not json"), 2, /^SCHEMA-INVALID\(examined: /);
  assertRefused(repo, run_id, await run("e2.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1.5, 2]] }] }), 2, /^SCHEMA-INVALID\(examined: /);
  assertRefused(repo, run_id, await run("e3.json", { packet_sha256, declared: [], id: "f".repeat(64) }), 2, /^SCHEMA-INVALID\(examined: .*id/);
  assertRefused(repo, run_id, await run("e4.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1, 2]], state: "examined" }] }), 2, /^SCHEMA-INVALID\(examined: .*state/);
  assertRefused(repo, run_id, await run("e5.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1]] }] }), 2, /^SCHEMA-INVALID\(examined: /);
  assertRefused(repo, run_id, await run("e6.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[0, 2]] }] }), 2, /^SCHEMA-INVALID\(examined: /);
  assertRefused(repo, run_id, await run("e7.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[2, 1]] }] }), 2, "SCHEMA-INVALID(examined: declared[0].ranges[0] must be [start, end] with 1 ≤ start ≤ end)");
  assertRefused(repo, run_id, await run("e8.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1, 9]] }] }), 2, "SCHEMA-INVALID(examined: declared[0].ranges[0] 1-9 lies outside the admitted ranges of src/db.js)");
  assertRefused(repo, run_id, await run("e9.json", { packet_sha256, declared: [{ path: "README.md", ranges: [[1, 1]] }] }), 2, "SCHEMA-INVALID(examined: declared[0].path README.md is not a scope file)");
  assertRefused(repo, run_id, await run("e10.json", { declared: [] }), 2, /^SCHEMA-INVALID\(examined: /);
});

test("write-once (G-10): a second coverage on the same run is 2 COVERAGE-EXISTS and rewrites nothing; a COMMITTED run is 2 RUN-COMMITTED", async () => {
  const repo = twoFileRepo();
  const { run_id, packet_sha256 } = await readyRun(repo);
  const file = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [{ path: "src/app.js", ranges: [[1, 1]] }] });
  const first = await coverage(repo, ["--run", run_id, "--examined", file]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const examinedBytes = readFileSync(join(runDir(repo, run_id), "examined.json"));
  const coverageBytes = readFileSync(join(runDir(repo, run_id), "coverage.json"));

  const again = await coverage(repo, ["--run", run_id, "--examined", dropbox(repo, run_id, "examined-2.json", { packet_sha256, declared: [] })]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.equal(again.stdout, "COVERAGE-EXISTS\n");
  assert.deepEqual(readFileSync(join(runDir(repo, run_id), "examined.json")), examinedBytes);
  assert.deepEqual(readFileSync(join(runDir(repo, run_id), "coverage.json")), coverageBytes);

  const other = await readyRun(repo);
  writeFileSync(join(runDir(repo, other.run_id), "COMMITTED"), `${"0".repeat(64)}\n`);
  assertRefused(repo, other.run_id, await coverage(repo, ["--run", other.run_id, "--examined", dropbox(repo, other.run_id, "examined-1.json", { packet_sha256: other.packet_sha256, declared: [] })]), 2, "RUN-COMMITTED");
});

test("review run: a declaration over a snapshot-side scope file admits like any other; the working file's bytes never enter the payload", async () => {
  const repo = twoFileRepo();
  writeFileSync(join(repo, "src", "db.js"), `${DB_JS}// password=1234 again\n`);
  const { run_id, scope, packet_sha256 } = await readyRun(repo, "review");
  const db = scope.payload.files.find((f) => f.path === "src/db.js");
  assert.equal(db.side, "snapshot");
  const file = dropbox(repo, run_id, "examined-1.json", { packet_sha256, declared: [{ path: "src/db.js", ranges: [[1, db.lines]] }] });
  const r = await coverage(repo, ["--run", run_id, "--examined", file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const cov = readCoverage(repo, run_id);
  assert.deepEqual(
    cov.payload.accounting.map((e) => [e.path, e.range, e.status]),
    [
      ["src/app.js", [1, 1], "unexamined"],
      ["src/db.js", [1, db.lines], "examined"],
    ],
  );
  const onDisk = readFileSync(join(runDir(repo, run_id), "coverage.json"), "utf8") + readFileSync(join(runDir(repo, run_id), "examined.json"), "utf8");
  assert.ok(!onDisk.includes("password=1234"), "no content bytes reach the coverage artifacts");
});
