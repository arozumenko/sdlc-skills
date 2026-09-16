// TASK-016 — `evidence.mjs ingest sarif` end to end (US-010 AC-1…AC-6; spec
// §6.6 row `sarif`, §6.7 fallback matrix, D6; plan §4.1 row `ingest`). The
// adapter's own contracts are lib/ingest/_sarif.test.mjs (pure core, fake
// side) and lib/ingest/sarif.test.mjs (mapping file); this file drives the
// CLI over the fixtures under scripts/fixtures/sarif/ copied into the
// consumer repo's `<st>/imports/`, with every run allocated by the real
// `run init` and every scope written by the real `scope` — so the recorded
// side a snippet is read from is TASK-013's, not this test's guess.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS, FIXTURE_NAMES, fixture } from "../fixtures/sarif/index.mjs";
import { walk } from "./fsx.mjs";
import { MAPPING_VERSION, loadMapping } from "./ingest/sarif.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const SECRET = "password=1234";
const IMPORT_LINE = /^IMPORT ([a-z-]+) import_sha256=([0-9a-f]{64}) records=([0-9]+) unlocated=([0-9]+) rejected=([0-9]+)$/;
const IMPORTS = join(ST, "imports");

/**
 * A repo with src/db.js (in scope) and docs/notes.md (tracked, outside
 * scope_paths) at HEAD, the SARIF fixtures copied into <st>/imports/, a run of
 * `kind` and its scope.json from the real `scope`. `dirty` appends a line to
 * src/db.js after the commit (review runs only: the file becomes a snapshot).
 */
async function sarifRepo({ kind = "assessment", dirty = false } = {}) {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "notes.md"), "# notes\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + notes"]);
  if (dirty) writeFileSync(join(repo, "src", "db.js"), `${DB_JS}export const dirty = 1;\n`);
  mkdirSync(join(repo, IMPORTS), { recursive: true });
  for (const name of FIXTURE_NAMES) copyFileSync(fixture(name), join(repo, IMPORTS, name));
  const run_id = await initRun(repo, kind);
  const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, `scope: ${s.stdout}${s.stderr}`);
  return { repo, run_id };
}

function parseImportLine(stdout) {
  const m = IMPORT_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the IMPORT token: ${JSON.stringify(stdout)}`);
  return { kind: m[1], import_sha256: m[2], records: Number(m[3]), unlocated: Number(m[4]), rejected: Number(m[5]) };
}

const ingest = (repo, run_id, name) => runScript("evidence", ["ingest", "sarif", join(IMPORTS, name), "--run", run_id], { cwd: repo, env: ENV });
const record = (repo, run_id, sha) => readArtifact(join(runDir(repo, run_id), "ingest", `${sha}.json`), { kind: "import" });
const blobOf = (repo, run_id, sha) => join(repo, ST, "ledger", run_id, "imports", sha);

/** Ingest one fixture, assert exit 0 and the counts on the IMPORT line, return the record payload. */
async function ingested(repo, run_id, name, counts) {
  const r = await ingest(repo, run_id, name);
  assert.equal(r.code, 0, `${name}: ${r.stdout}${r.stderr}`);
  assert.equal(r.stderr, "", name);
  const line = parseImportLine(r.stdout);
  assert.equal(line.kind, "sarif");
  assert.deepEqual([line.records, line.unlocated, line.rejected], counts, `${name}: IMPORT counts`);
  const art = record(repo, run_id, line.import_sha256);
  assert.deepEqual(validate("import", art.payload), [], name);
  assert.equal(art.payload.kind, "sarif");
  assert.equal(art.payload.import_sha256, line.import_sha256);
  assert.ok(existsSync(blobOf(repo, run_id, line.import_sha256)), `${name}: redacted bytes snapshotted (US-010 AC-5)`);
  for (const list of ["records", "unlocated", "rejected"]) {
    for (const item of art.payload[list]) assert.equal(item.locator.import_sha256, line.import_sha256, `${name}: ${list} locator names this import`);
  }
  for (const rec of art.payload.records) assert.equal(rec.locator.original_hmac, art.payload.original_hmac);
  return { payload: art.payload, stdout: r.stdout, import_sha256: line.import_sha256 };
}

test("message.text path-like instruction never selects a path (US-010 AC-1)", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload, stdout, import_sha256 } = await ingested(repo, run_id, "located.sarif", [1, 0, 0]);
  const [r] = payload.records;
  assert.equal(r.trusted.path, "src/db.js", "the path is the canonical in-repo path within scope");
  assert.equal(r.trusted.side, "head");
  assert.deepEqual(r.trusted.region, [4, 5]);
  assert.deepEqual(r.trusted.lines, [3, 4], "normalised line numbers (TASK-014 contract): raw line 2 is blank");
  assert.equal(r.trusted.rule_id, "javascript.express.sqli.tainted-sql-string");
  assert.equal(r.trusted.level, "error");
  assert.equal(r.trusted.priority, "p1");
  assert.equal(r.trusted.class, "injection");
  assert.equal(r.trusted.confidence, 6);
  assert.equal(r.trusted.requires_typed_citations, true);
  const trusted = JSON.stringify(r.trusted);
  assert.ok(!trusted.includes("other.js") && !trusted.includes("passwd") && !trusted.includes("rm -rf"), "nothing from message.text acts");
  assert.match(r.inert.message, /^\[UNTRUSTED CONTENT/);
  assert.ok(r.inert.message.includes("src/other.js:1-3"), "quoted verbatim");
  assert.ok(!r.inert.message.includes(SECRET), "redacted (G-4)");
  assert.ok(r.inert.snippet.includes("SELECT * FROM users"));
  assert.equal(payload.source_path, `${IMPORTS}/located.sarif`);
  const lines = stdout.trimEnd().split("\n");
  assert.equal(lines.length, 3, "IMPORT, WROTE imports.json, WROTE record (assessment run)");
  assert.match(lines[1], new RegExp(`^WROTE ${ST}/runs/${run_id}/imports.json sha256=[0-9a-f]{64}$`));
  assert.match(lines[2], new RegExp(`^WROTE ${ST}/runs/${run_id}/ingest/${import_sha256}\\.json sha256=[0-9a-f]{64}$`));
  const index = readArtifact(join(runDir(repo, run_id), "imports.json"), { kind: "imports-index" });
  assert.deepEqual(index.payload.imports, [{ kind: "sarif", import_sha256, original_hmac: payload.original_hmac }]);
});

// --- §6.7, one test per row (US-010 AC-2) -----------------------------------------------------------

test("§6.7 row 1: no physicalLocation or URI not canonicalisable inside the repo ⇒ unlocated candidate", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "no-location.sarif", [0, 6, 0]);
  assert.deepEqual(payload.records, []);
  for (const c of payload.unlocated) {
    assert.equal(c.reason, "no-location");
    assert.equal(c.tool, "semgrep");
    assert.equal(c.rule_id, "r.no-loc");
  }
  assert.deepEqual(payload.unlocated.map((c) => c.locator.index), [0, 1, 2, 3, 4, 5]);
});

test("§6.7 row 2: in-repo path outside scope ⇒ unlocated candidate, reason out-of-scope", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "out-of-scope.sarif", [0, 2, 0]);
  assert.deepEqual(payload.unlocated.map((c) => [c.locator.index, c.reason]), [[0, "out-of-scope"], [1, "out-of-scope"]]);
  assert.ok(existsSync(join(repo, "docs", "notes.md")), "the file exists in the repo; scope membership, not existence, is the rule");
});

test("§6.7 row 3: startLine present, endLine absent ⇒ endLine = startLine", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "endline-absent.sarif", [1, 0, 0]);
  const [r] = payload.records;
  assert.deepEqual(r.trusted.region, [4, 4]);
  assert.deepEqual(r.trusted.lines, [3, 3]);
  assert.ok(r.trusted.recorded.includes("endline-defaulted"));
});

test("§6.7 row 4: region present, snippet absent ⇒ snippet read from the recorded side (head), stored redacted; the raw bytes it was read from never land on disk", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "snippet-absent.sarif", [2, 0, 0]);
  const [a, b] = payload.records;
  assert.ok(a.trusted.recorded.includes("snippet-from-side"));
  assert.ok(a.inert.snippet.includes('const q = "SELECT * FROM users WHERE id = " + req.query.id;'), "the committed bytes at head_oid");
  assert.ok(a.inert.snippet.includes("return pool.query(q);"));
  assert.equal(b.trusted.side, "head");
  assert.deepEqual(b.trusted.region, [8, 9]);
  assert.ok(!b.inert.snippet.includes(SECRET), "raw side bytes carry the secret; the record never does");
  assert.ok(b.inert.snippet.includes("<REDACTED:"));
  // nothing the bundle wrote under <st> carries the original bytes (the side read is in memory only; G-3/G-4).
  // `<st>/imports/` is the operator's copy-in directory (plan §3.2) holding the raw fixtures this test copied there.
  const st = join(repo, ST);
  const offenders = walk(st).filter((rel) => !rel.startsWith("imports/") && statSync(join(st, rel)).isFile() && readFileSync(join(st, rel)).includes(SECRET));
  assert.deepEqual(offenders, [], "no original bytes anywhere the bundle writes under .agents/security-testing/");
  assert.ok(walk(join(st, "ledger")).length > 0 && walk(join(st, "runs")).length > 0, "the scan covered the ledger and the run");
});

test("§6.7 row 5: level absent ⇒ rule defaultConfiguration.level; absent ⇒ p3 and confidence from the tool default", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "level-absent.sarif", [2, 0, 0]);
  const [a, b] = payload.records;
  assert.equal(a.trusted.level, "warning");
  assert.equal(a.trusted.priority, "p2");
  assert.ok(a.trusted.recorded.includes("level-from-rule-default"));
  assert.ok(!Object.hasOwn(b.trusted, "level"));
  assert.equal(b.trusted.priority, "p3");
  assert.equal(b.trusted.confidence, 6, "semgrep's confidence from the mapping file");
  assert.ok(b.trusted.recorded.includes("level-absent"));
});

test("§6.7 row 6: ruleIndex and ruleId disagree ⇒ reject with reason (exit stays 0, the file is well-formed)", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "rule-mismatch.sarif", [1, 0, 1]);
  assert.deepEqual(payload.rejected, [{ locator: { import_sha256: payload.import_sha256, index: 0 }, reason: "rule-mismatch" }]);
  assert.equal(payload.records[0].locator.index, 1);
});

test("§6.7 row 7: unknown tool ⇒ class from tags only, confidence 3, recorded", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "unknown-tool.sarif", [2, 0, 0]);
  const [tagged, prefixed] = payload.records;
  assert.equal(tagged.trusted.tool_key, "unknown");
  assert.equal(tagged.trusted.tool, "MyScanner");
  assert.equal(tagged.trusted.confidence, 3);
  assert.equal(tagged.trusted.class, "xss");
  assert.equal(tagged.trusted.class_source, "tags");
  assert.ok(tagged.trusted.recorded.includes("unknown-tool"));
  assert.equal(prefixed.trusted.class, "unmapped", "no prefix table for an unknown tool");
  assert.equal(prefixed.trusted.confidence, 3);
});

test("§6.7 row 8: malformed region (end < start, non-integer) ⇒ reject with reason; a region past the end of the file is rejected too", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "region-malformed.sarif", [0, 0, 4]);
  assert.deepEqual(payload.rejected.map((x) => [x.locator.index, x.reason]), [[0, "region-malformed"], [1, "region-malformed"], [2, "region-malformed"], [3, "region-outside-file"]]);
});

test("§6.7 row 9: data-flow class ⇒ located candidate that REVIEW requires typed citations for; codeFlows/relatedLocations never read", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "dataflow.sarif", [3, 0, 0]);
  const by = Object.fromEntries(payload.records.map((r) => [r.trusted.rule_id, r.trusted]));
  assert.equal(by["js/xss"].class, "xss");
  assert.equal(by["js/xss"].requires_typed_citations, true);
  assert.equal(by["js/hardcoded-credentials"].requires_typed_citations, false);
  assert.equal(by["js/weak-cryptographic-algorithm"].requires_typed_citations, false);
  assert.ok(!JSON.stringify(payload.records).includes("src/other.js"), "codeFlows / relatedLocations are never read");
});

// --- the rest of US-010 ---------------------------------------------------------------------------

test("rejection reasons counted (US-010 AC-3): three rejections with two distinct reasons, all in the import record", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "rejections.sarif", [1, 0, 3]);
  const counts = {};
  for (const x of payload.rejected) counts[x.reason] = (counts[x.reason] ?? 0) + 1;
  assert.deepEqual(counts, { "rule-mismatch": 2, "region-malformed": 1 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(validate("rejects", { rejected: payload.rejected }), [], "shaped for rejects.json as-is");
});

test("SARIF unlocated candidates never reach gate (record level, US-010 AC-4): unlocated[] is disjoint from records[] and already shaped for unlocated.json", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "out-of-scope.sarif", [0, 2, 0]);
  const located = new Set(payload.records.map((r) => r.locator.index));
  for (const c of payload.unlocated) assert.ok(!located.has(c.locator.index));
  assert.deepEqual(validate("unlocated", { candidates: payload.unlocated }), []);
  for (const c of payload.unlocated) assert.ok(!Object.hasOwn(c, "trusted") && !Object.hasOwn(c, "inert"), "a candidate carries no path or snippet a gate could act on");
});

test("import record names mapping version v1 (US-010 AC-6)", async () => {
  const { repo, run_id } = await sarifRepo();
  const { payload } = await ingested(repo, run_id, "gitleaks.sarif", [1, 0, 0]);
  assert.equal(payload.mapping_version, "v1");
  assert.equal(payload.mapping_version, loadMapping().version);
  assert.equal(payload.mapping_version, MAPPING_VERSION);
  assert.equal(payload.records[0].trusted.class, "secret");
  assert.equal(payload.records[0].trusted.confidence, 7);
});

test("review run with a dirty in-scope file: the recorded side is snapshot, and a snippet read from it is the redacted snapshot", async () => {
  const { repo, run_id } = await sarifRepo({ kind: "review", dirty: true });
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  assert.equal(scope.payload.files.find((f) => f.path === "src/db.js").side, "snapshot");
  const { payload, stdout } = await ingested(repo, run_id, "snippet-absent.sarif", [2, 0, 0]);
  const [a, b] = payload.records;
  assert.equal(a.trusted.side, "snapshot");
  assert.deepEqual(a.trusted.lines, [3, 4]);
  assert.ok(a.inert.snippet.includes("SELECT * FROM users"));
  assert.equal(b.trusted.side, "snapshot");
  assert.ok(!b.inert.snippet.includes(SECRET));
  assert.equal(stdout.trimEnd().split("\n").length, 2, "IMPORT + WROTE record: a review run has no imports.json");
  assert.ok(!existsSync(join(runDir(repo, run_id), "imports.json")));
});

test("structural: a file without runs[] ⇒ 2 SCHEMA-INVALID(sarif: …), nothing written; before scope ⇒ 3 INCOMPLETE(scope)", async () => {
  const { repo, run_id } = await sarifRepo();
  const bad = await ingest(repo, run_id, "not-sarif.json");
  assert.equal(bad.code, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout + bad.stderr, /SCHEMA-INVALID\(sarif: runs must be an array\)/);
  assert.deepEqual(walk(join(repo, ST, "ledger", run_id, "imports")), [], "nothing snapshotted on a structural failure");

  const fresh = await initRun(repo, "assessment");
  const early = await ingest(repo, fresh, "located.sarif");
  assert.equal(early.code, 3, early.stdout + early.stderr);
  assert.match(early.stdout + early.stderr, /INCOMPLETE\(scope\)/);
  assert.deepEqual(walk(join(runDir(repo, fresh), "ingest")), [], "no record before scope");
});

test("deterministic: the same SARIF ingested into two runs yields byte-identical record payloads and the same import_sha256", async () => {
  const { repo, run_id } = await sarifRepo();
  const a = await ingested(repo, run_id, "located.sarif", [1, 0, 0]);
  const second = await initRun(repo, "assessment");
  const s = await runScript("evidence", ["scope", "--run", second], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, s.stdout + s.stderr);
  const b = await ingested(repo, second, "located.sarif", [1, 0, 0]);
  assert.equal(a.import_sha256, b.import_sha256);
  assert.deepEqual(a.payload, b.payload);
});
