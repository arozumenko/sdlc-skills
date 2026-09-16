// TASK-016 — lib/ingest/_sarif.mjs, the pure half of `ingest sarif` (spec
// §6.6 row `sarif`, §6.7 fallback matrix, D6; US-010). The I/O wiring
// (mapping file, cite.resolveSide) is lib/ingest/sarif.mjs; the CLI over the
// fixtures is lib/ingest-sarif.test.mjs. Here `readSide` is a fake over an
// in-memory file, so every matrix branch is exercised without git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict } from "../../canon.mjs";
import { redactDeep } from "../../redact.mjs";
import { DB_JS, fixture } from "../../fixtures/sarif/index.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import * as tokens from "../tokens.mjs";
import {
  CLASS_SOURCES,
  DATA_FLOW_CLASSES,
  LEVELS,
  OPTIONAL_TRUSTED_KEYS,
  RECORDED,
  REJECT,
  TRUSTED_KEYS,
  UNKNOWN_TOOL,
  adaptSarif,
  canonicalUri,
  classify,
  priorityOf,
  rawToNormalised,
  toolKey,
} from "./_sarif.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPPING = parseStrict(readFileSync(join(HERE, "..", "..", "..", "references", "sarif-mapping.v1.json")));
const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: ".agents/security-testing/imports/x.sarif" };
const OID = "0".repeat(40);
const scopeOf = (entries) => ({
  envelope: { kind: "scope" },
  payload: {
    files: entries.map(([path, side, lines]) => ({ path, side, oid: OID, file_hmac: "0".repeat(64), lines })),
    ranges: Object.fromEntries(entries.map(([path, , lines]) => [path, [[1, lines]]])),
    skipped: [],
  },
});
const SCOPE = scopeOf([["src/db.js", "head", 7]]);
const FILES = { "src/db.js": Buffer.from(DB_JS, "utf8") };
const readSide = (path, side) => {
  if (side !== "head") throw new Error(`fake readSide: unexpected side ${side}`);
  if (!Object.hasOwn(FILES, path)) throw new Error(`fake readSide: no file ${path}`);
  return FILES[path];
};
const load = (name) => redactDeep(parseStrict(readFileSync(fixture(name))));
const run = (name, scope = SCOPE) => adaptSarif(load(name), { scope, locatorBase: base, mapping: MAPPING, readSide });
const importPayload = (out) => ({ kind: "sarif", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out });

// --- vocabularies -----------------------------------------------------------------

test("vocabularies: SARIF levels, data-flow classes, the closed trusted key set, class sources", () => {
  assert.deepEqual(LEVELS, ["error", "warning", "note", "none"]);
  assert.deepEqual(DATA_FLOW_CLASSES, ["injection", "xss", "ssrf", "path-traversal", "deserialization"]);
  assert.deepEqual(CLASS_SOURCES, ["tags", "rule-prefix", "unmapped"]);
  assert.equal(UNKNOWN_TOOL, "unknown");
  assert.deepEqual(TRUSTED_KEYS, [
    "tool", "tool_key", "tool_version", "rule_id", "level", "priority", "confidence", "class", "class_source", "cwe",
    "path", "side", "region", "lines", "requires_typed_citations", "recorded", "partial_fingerprints",
  ]);
  assert.deepEqual(OPTIONAL_TRUSTED_KEYS, ["tool_version", "level", "cwe", "partial_fingerprints"]);
  for (const k of OPTIONAL_TRUSTED_KEYS) assert.ok(TRUSTED_KEYS.includes(k));
  // the grouped vocabularies are the tokens.mjs rows, spelled once (G-13)
  assert.deepEqual(REJECT, {
    RULE_MISSING: tokens.SARIF_RULE_MISSING,
    RULE_MISMATCH: tokens.SARIF_RULE_MISMATCH,
    LEVEL_INVALID: tokens.SARIF_LEVEL_INVALID,
    REGION_MALFORMED: tokens.SARIF_REGION_MALFORMED,
    REGION_OUTSIDE_FILE: tokens.SARIF_REGION_OUTSIDE_FILE,
    REGION_BLANK: tokens.SARIF_REGION_BLANK,
    FILE_NOT_TEXT: tokens.SARIF_FILE_NOT_TEXT,
  });
  assert.deepEqual(RECORDED, {
    UNKNOWN_TOOL: tokens.SARIF_UNKNOWN_TOOL,
    RULE_NOT_IN_METADATA: tokens.SARIF_RULE_NOT_IN_METADATA,
    RULE_DEFAULT_LEVEL_INVALID: tokens.SARIF_RULE_DEFAULT_LEVEL_INVALID,
    LEVEL_FROM_RULE_DEFAULT: tokens.SARIF_LEVEL_FROM_RULE_DEFAULT,
    LEVEL_ABSENT: tokens.SARIF_LEVEL_ABSENT,
    ENDLINE_DEFAULTED: tokens.SARIF_ENDLINE_DEFAULTED,
    SNIPPET_FROM_SIDE: tokens.SARIF_SNIPPET_FROM_SIDE,
  });
  assert.ok(Object.isFrozen(REJECT) && Object.isFrozen(RECORDED));
  assert.equal(REJECT.RULE_MISMATCH, "rule-mismatch");
  assert.equal(RECORDED.SNIPPET_FROM_SIDE, "snippet-from-side");
  assert.equal(tokens.UNLOCATED_NO_LOCATION, "no-location");
  assert.equal(tokens.UNLOCATED_OUT_OF_SCOPE, "out-of-scope");
});

test("pure (G-9 shape): _sarif.mjs imports no fs, child process, git or network", () => {
  const src = readFileSync(join(HERE, "_sarif.mjs"), "utf8");
  for (const needle of ["node:fs", "node:child_process", "./git.mjs", "../git.mjs", "../cite.mjs", "node:http", "fetch("]) {
    assert.ok(!src.includes(needle), `no ${needle} in the pure core`);
  }
});

// --- canonicalUri -------------------------------------------------------------------

test("canonicalUri: relative and file:-relative URIs canonicalise; absolute, `..`, `%2e%2e`, backslash, NUL, empty and `.` segments do not", () => {
  assert.equal(canonicalUri("src/db.js"), "src/db.js");
  assert.equal(canonicalUri("./src/db.js"), "src/db.js");
  assert.equal(canonicalUri("file:src/db.js"), "src/db.js");
  assert.equal(canonicalUri("src/a%20b.js"), "src/a b.js");
  assert.equal(canonicalUri("src/%64b.js"), "src/db.js", "percent-decoded before the segment rule");
  for (const bad of [
    "/etc/passwd",
    "file:///home/me/repo/src/db.js",
    "file://host/src/db.js",
    "../secrets/key.pem",
    "src/../etc/passwd",
    "src/%2e%2e/etc/passwd",
    "src/%2E%2E/etc/passwd",
    "src/%2e/db.js",
    "src//db.js",
    "src/./db.js",
    "src\\db.js",
    "src/db.js%00",
    "https://example.com/src/db.js",
    "%zz",
    "",
    "   ",
    42,
    null,
    undefined,
  ]) {
    assert.equal(canonicalUri(bad), null, `not canonicalisable: ${String(bad)}`);
  }
});

// --- toolKey / classify / priorityOf ---------------------------------------------------

test("toolKey: exact or `<key> <suffix>` match, case-insensitive; anything else is `unknown`", () => {
  assert.equal(toolKey(MAPPING, "semgrep"), "semgrep");
  assert.equal(toolKey(MAPPING, "Semgrep OSS"), "semgrep");
  assert.equal(toolKey(MAPPING, "CodeQL"), "codeql");
  assert.equal(toolKey(MAPPING, "Trivy"), "trivy");
  assert.equal(toolKey(MAPPING, "osv-scanner"), "osv-scanner");
  assert.equal(toolKey(MAPPING, "gitleaks"), "gitleaks");
  assert.equal(toolKey(MAPPING, "MyScanner"), UNKNOWN_TOOL);
  assert.equal(toolKey(MAPPING, "semgrepx"), UNKNOWN_TOOL, "a prefix without a space boundary is another tool");
  assert.equal(toolKey(MAPPING, "unknown"), UNKNOWN_TOOL, "the reserved key never names a real tool's table");
});

test("classify: tags first (exact tag or any CWE spelling), then the tool's longest rule-id prefix, then unmapped; an unknown tool never consults the prefix table", () => {
  const cwe89 = "CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')";
  assert.deepEqual(classify(MAPPING, "semgrep", "javascript.express.sqli.tainted-sql-string", [cwe89, "security"]), { class: "injection", class_source: "tags", cwe: "CWE-89" });
  assert.deepEqual(classify(MAPPING, "codeql", "js/xss", ["security", "external/cwe/cwe-079"]), { class: "xss", class_source: "tags", cwe: "CWE-79" });
  assert.deepEqual(classify(MAPPING, "trivy", "CVE-2024-0001", ["vulnerability"]), { class: "supply-chain", class_source: "tags" });
  // tags present but unmapped ⇒ the prefix table; the first CWE seen is still recorded
  assert.deepEqual(classify(MAPPING, "codeql", "js/xss", ["security", "external/cwe/cwe-116"]), { class: "xss", class_source: "rule-prefix", cwe: "CWE-116" });
  // longest prefix wins
  assert.deepEqual(classify(MAPPING, "semgrep", "javascript.express.security.audit.xss.direct-response-write", []), { class: "xss", class_source: "rule-prefix" });
  assert.deepEqual(classify(MAPPING, "gitleaks", "aws-access-token", []), { class: "secret", class_source: "rule-prefix" });
  assert.deepEqual(classify(MAPPING, "osv-scanner", "GHSA-xxxx-yyyy-zzzz", []), { class: "supply-chain", class_source: "rule-prefix" });
  assert.deepEqual(classify(MAPPING, "semgrep", "nothing.known", ["security"]), { class: "unmapped", class_source: "unmapped" });
  assert.deepEqual(classify(MAPPING, UNKNOWN_TOOL, "javascript.express.sqli.tainted-sql-string", []), { class: "unmapped", class_source: "unmapped" });
  assert.deepEqual(classify(MAPPING, UNKNOWN_TOOL, "MS001", ["CWE-79"]), { class: "xss", class_source: "tags", cwe: "CWE-79" });
  // tags are data: a non-string entry is skipped, never a throw
  assert.deepEqual(classify(MAPPING, UNKNOWN_TOOL, "MS001", [42, null, { cwe: 79 }, "cwe-0079"]), { class: "xss", class_source: "tags", cwe: "CWE-79" });
  assert.deepEqual(classify(MAPPING, UNKNOWN_TOOL, "MS001", "not-an-array"), { class: "unmapped", class_source: "unmapped" });
});

test("priorityOf: error p1, warning p2, note p3, none p3", () => {
  assert.equal(priorityOf(MAPPING, "error"), "p1");
  assert.equal(priorityOf(MAPPING, "warning"), "p2");
  assert.equal(priorityOf(MAPPING, "note"), "p3");
  assert.equal(priorityOf(MAPPING, "none"), "p3");
  assert.throws(() => priorityOf(MAPPING, "fatal"), TypeError);
});

// --- rawToNormalised -------------------------------------------------------------------

test("rawToNormalised: scanner (raw) line numbers become the normalised numbers every citation consumer indexes (TASK-014 contract)", () => {
  const buf = Buffer.from(DB_JS, "utf8");
  assert.deepEqual(rawToNormalised(buf, 4, 5).lines, [3, 4]);
  assert.deepEqual(rawToNormalised(buf, 1, 1).lines, [1, 1]);
  assert.deepEqual(rawToNormalised(buf, 8, 9).lines, [6, 7]);
  assert.deepEqual(rawToNormalised(buf, 2, 3).lines, [2, 2], "a blank raw line at the start of the region is skipped");
  assert.deepEqual(rawToNormalised(buf, 6, 7).lines, [5, 5], "a blank raw line at the end of the region is skipped");
  assert.deepEqual(rawToNormalised(buf, 1, 9).lines, [1, 7]);
  assert.deepEqual(rawToNormalised(buf, 2, 2), { ok: false, reason: REJECT.REGION_BLANK });
  assert.deepEqual(rawToNormalised(buf, 10, 10), { ok: false, reason: REJECT.REGION_OUTSIDE_FILE }, "the trailing newline is not a tenth line");
  assert.deepEqual(rawToNormalised(buf, 4, 40), { ok: false, reason: REJECT.REGION_OUTSIDE_FILE });
  // CRLF and a CR-only terminator number like LF
  const crlf = Buffer.from("a\r\n\r\nb\rc\n", "utf8");
  assert.deepEqual(rawToNormalised(crlf, 3, 4).lines, [2, 3]);
  assert.deepEqual(rawToNormalised(crlf, 5, 5), { ok: false, reason: REJECT.REGION_OUTSIDE_FILE });
  // a file that is not UTF-8 cannot be line-numbered
  assert.deepEqual(rawToNormalised(Buffer.from([0x61, 0x0a, 0xff, 0xfe, 0x0a]), 1, 1), { ok: false, reason: REJECT.FILE_NOT_TEXT });
  // an empty file has no lines
  assert.deepEqual(rawToNormalised(Buffer.alloc(0), 1, 1), { ok: false, reason: REJECT.REGION_OUTSIDE_FILE });
});

// --- adaptSarif: structure -----------------------------------------------------------------

test("structural failures are the kind's exit-2 result (never a throw on a well-formed file's data)", () => {
  const structural = (value, re) =>
    assert.throws(() => adaptSarif(value, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide }), (err) => err instanceof CliError && err.code === 2 && re.test(err.token));
  structural(null, /^SCHEMA-INVALID\(sarif: root must be an object\)$/);
  structural([], /root must be an object/);
  structural({ version: "2.1.0" }, /runs must be an array/);
  structural({ runs: [{}] }, /runs\[0\]\.tool\.driver\.name must be a non-empty string/);
  structural({ runs: [{ tool: { driver: { name: "" } } }] }, /tool\.driver\.name/);
  structural({ runs: [{ tool: { driver: { name: "x", rules: {} } } }] }, /rules must be an array/);
  structural({ runs: [{ tool: { driver: { name: "x", rules: [{ id: 3 }] } } }] }, /rules\[0\]\.id must be a non-empty string/);
  structural({ runs: [{ tool: { driver: { name: "x", version: 1 } } }] }, /version must be a string/);
  structural({ runs: [{ tool: { driver: { name: "x" } }, results: {} }] }, /results must be an array/);
  structural({ runs: [{ tool: { driver: { name: "x" } }, results: [1] }] }, /results\[0\] must be an object/);
  structural(load("not-sarif.json"), /runs must be an array/);
  assert.throws(() => adaptSarif({ runs: [] }, { scope: null, locatorBase: base, mapping: MAPPING, readSide }), (err) => err instanceof CliError && err.code === 3 && err.token === "INCOMPLETE(scope)");
});

test("empty runs / empty results ⇒ zero of everything; mapping_version is the mapping file's", () => {
  const out = adaptSarif({ version: "2.1.0", runs: [] }, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  assert.deepEqual(out, { records: [], unlocated: [], rejected: [], mapping_version: "v1" });
  const out2 = adaptSarif({ runs: [{ tool: { driver: { name: "semgrep" } } }] }, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  assert.deepEqual(out2, { records: [], unlocated: [], rejected: [], mapping_version: "v1" });
});

// --- adaptSarif: the located record --------------------------------------------------------

test("located: the closed trusted set — path/side/lines from scope + bytes, rule id + level from the result, class/priority/confidence from the mapping; message + snippet inert", () => {
  const out = run("located.sarif");
  assert.deepEqual([out.records.length, out.unlocated.length, out.rejected.length], [1, 0, 0]);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(Object.keys(r.trusted).sort(), [...TRUSTED_KEYS].sort());
  assert.deepEqual(r.trusted, {
    tool: "Semgrep OSS",
    tool_key: "semgrep",
    tool_version: "1.90.0",
    rule_id: "javascript.express.sqli.tainted-sql-string",
    level: "error",
    priority: "p1",
    confidence: 6,
    class: "injection",
    class_source: "tags",
    cwe: "CWE-89",
    path: "src/db.js",
    side: "head",
    region: [4, 5],
    lines: [3, 4],
    requires_typed_citations: true,
    recorded: [],
    partial_fingerprints: { "matchBasedId/v1": "0f3a9c1e2b7d" },
  });
  assert.deepEqual(Object.keys(r.inert).sort(), ["message", "snippet"]);
  assert.match(r.inert.message, /^\[UNTRUSTED CONTENT/);
  assert.ok(r.inert.message.includes("src/other.js:1-3"), "quoted, never acted on");
  assert.ok(r.inert.message.includes("rm -rf /"), "argv inside a message is data (G-6)");
  assert.ok(!r.inert.message.includes("password=1234"), "redacted (G-4)");
  assert.ok(r.inert.snippet.includes("SELECT * FROM users"));
  assert.ok(!JSON.stringify(r.trusted).includes("other.js") && !JSON.stringify(r.trusted).includes("passwd"), "message text never selects a path (US-010 AC-1)");
  assert.deepEqual(validate("import", importPayload(out)), []);
});

test("locator.index is the flat source ordinal across runs and outcomes, so a reject keeps its number and records[] may skip one", () => {
  const sarif = {
    runs: [
      { tool: { driver: { name: "semgrep", rules: [{ id: "r.a" }, { id: "r.b" }] } }, results: [
        { ruleId: "r.a", ruleIndex: 1, message: { text: "mismatch" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: 4 } } }] },
        { ruleId: "r.a", message: { text: "no location" } },
        { ruleId: "r.a", level: "note", message: { text: "ok" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: 4, snippet: { text: "x" } } } }] },
      ] },
      { tool: { driver: { name: "CodeQL", rules: [{ id: "js/xss" }] } }, results: [
        { ruleId: "js/xss", level: "warning", message: { text: "second run" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: 1, snippet: { text: "x" } } } }] },
      ] },
    ],
  };
  const out = adaptSarif(sarif, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  assert.deepEqual(out.rejected.map((x) => [x.locator.index, x.reason]), [[0, "rule-mismatch"]]);
  assert.deepEqual(out.unlocated.map((x) => [x.locator.index, x.reason, x.tool, x.rule_id]), [[1, "no-location", "semgrep", "r.a"]]);
  assert.deepEqual(out.records.map((x) => [x.locator.index, x.trusted.tool_key, x.trusted.rule_id, x.trusted.priority]), [[2, "semgrep", "r.a", "p3"], [3, "codeql", "js/xss", "p2"]]);
  assert.deepEqual(validate("import", importPayload(out)), []);
});

// --- adaptSarif: the §6.7 matrix, branch by branch (the CLI test repeats each over the real store) ---

test("§6.7 row 1: no physicalLocation / non-canonicalisable URI / no region ⇒ unlocated no-location, with tool and rule id", () => {
  const out = run("no-location.sarif");
  assert.deepEqual([out.records.length, out.unlocated.length, out.rejected.length], [0, 6, 0]);
  for (const [i, c] of out.unlocated.entries()) assert.deepEqual(c, { locator: { import_sha256: SHA, index: i }, reason: "no-location", tool: "semgrep", rule_id: "r.no-loc" });
  assert.deepEqual(validate("unlocated", { candidates: out.unlocated }), [], "shaped for unlocated.json as-is");
});

test("§6.7 row 2: an in-repo path outside scope ⇒ unlocated out-of-scope (scope membership is the rule; the file system is never consulted)", () => {
  const out = run("out-of-scope.sarif");
  assert.deepEqual([out.records.length, out.unlocated.length, out.rejected.length], [0, 2, 0]);
  assert.deepEqual(out.unlocated.map((c) => c.reason), ["out-of-scope", "out-of-scope"]);
  // the same file, scoped, is located
  const scoped = scopeOf([["src/db.js", "head", 7], ["docs/notes.md", "head", 1]]);
  const read = (path, side) => (path === "docs/notes.md" ? Buffer.from("# notes\n") : readSide(path, side));
  const out2 = adaptSarif(load("out-of-scope.sarif"), { scope: scoped, locatorBase: base, mapping: MAPPING, readSide: read });
  assert.deepEqual([out2.records.length, out2.unlocated.length], [1, 1]);
  assert.equal(out2.records[0].trusted.path, "docs/notes.md");
});

test("§6.7 row 3: startLine without endLine ⇒ endLine = startLine, recorded", () => {
  const [r] = run("endline-absent.sarif").records;
  assert.deepEqual(r.trusted.region, [4, 4]);
  assert.deepEqual(r.trusted.lines, [3, 3]);
  assert.deepEqual(r.trusted.recorded, ["endline-defaulted"]);
  assert.equal(r.trusted.class, "injection", "rule-prefix table (no tags)");
  assert.equal(r.trusted.class_source, "rule-prefix");
});

test("§6.7 row 4: region without snippet ⇒ snippet read from the recorded side, redacted before it is stored", () => {
  const out = run("snippet-absent.sarif");
  assert.equal(out.records.length, 2);
  const [a, b] = out.records;
  assert.deepEqual(a.trusted.recorded, ["snippet-from-side"]);
  assert.ok(a.inert.snippet.includes('const q = "SELECT * FROM users WHERE id = " + req.query.id;'));
  assert.ok(a.inert.snippet.includes("return pool.query(q);"));
  assert.deepEqual(b.trusted.lines, [6, 7]);
  assert.ok(!b.inert.snippet.includes("password=1234"), "raw side bytes carry the secret; the inert form never does (G-4)");
  assert.ok(b.inert.snippet.includes("<REDACTED:"), "the redaction marker is what is stored");
  assert.ok(b.inert.snippet.includes("export const <REDACTED:token-assign>;"), "`token = \"x\"` is a token-assign hit in its own right");
  assert.equal(b.trusted.class, "secret", "generic.secrets prefix");
});

test("§6.7 row 5: level absent ⇒ rule defaultConfiguration.level; absent ⇒ p3 and the tool's confidence", () => {
  const [a, b] = run("level-absent.sarif").records;
  assert.equal(a.trusted.level, "warning");
  assert.equal(a.trusted.priority, "p2");
  assert.deepEqual(a.trusted.recorded, ["level-from-rule-default"]);
  assert.ok(!Object.hasOwn(b.trusted, "level"));
  assert.equal(b.trusted.priority, "p3");
  assert.equal(b.trusted.confidence, 6);
  assert.deepEqual(b.trusted.recorded, ["level-absent"]);
});

test("§6.7 row 6: ruleIndex and ruleId disagree ⇒ rejected rule-mismatch; agreement ⇒ located", () => {
  const out = run("rule-mismatch.sarif");
  assert.deepEqual(out.rejected, [{ locator: { import_sha256: SHA, index: 0 }, reason: "rule-mismatch" }]);
  assert.deepEqual(out.records.map((r) => [r.locator.index, r.trusted.rule_id]), [[1, "r.b"]]);
});

test("rule resolution: ruleIndex alone resolves the id; ruleId alone is looked up in rules[] (absent ⇒ recorded); neither, a bad index or a non-string id ⇒ rejected rule-missing", () => {
  const mk = (result) => adaptSarif({ runs: [{ tool: { driver: { name: "semgrep", rules: [{ id: "r.a", defaultConfiguration: { level: "note" } }] } }, results: [result] }] }, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  const loc = { locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: 4, endLine: 4, snippet: { text: "x" } } } }], message: { text: "m" } };
  const byIndex = mk({ ruleIndex: 0, ...loc }).records[0].trusted;
  assert.equal(byIndex.rule_id, "r.a");
  assert.equal(byIndex.level, "note");
  const byId = mk({ ruleId: "r.a", ...loc }).records[0].trusted;
  assert.equal(byId.level, "note", "ruleId alone still finds the rule's default level");
  const unknownId = mk({ ruleId: "r.elsewhere", level: "error", ...loc }).records[0].trusted;
  assert.deepEqual(unknownId.recorded, ["rule-not-in-metadata"]);
  assert.equal(unknownId.class, "unmapped");
  for (const bad of [{}, { ruleIndex: 7 }, { ruleIndex: -1 }, { ruleIndex: "0" }, { ruleId: "" }, { ruleId: 5 }, { ruleId: "r.a", ruleIndex: 7 }]) {
    const out = mk({ ...bad, ...loc });
    assert.equal(out.records.length, 0, JSON.stringify(bad));
    assert.deepEqual(out.rejected.map((x) => x.reason), ["rule-missing"], JSON.stringify(bad));
  }
});

test("level vocabulary: a level outside error|warning|note|none ⇒ rejected level-invalid; an invalid rule default is recorded and treated as absent", () => {
  const mk = (result, rule = { id: "r.a" }) => adaptSarif({ runs: [{ tool: { driver: { name: "semgrep", rules: [rule] } }, results: [result] }] }, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  const loc = { ruleId: "r.a", ruleIndex: 0, locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: 4, endLine: 4, snippet: { text: "x" } } } }], message: { text: "m" } };
  assert.deepEqual(mk({ ...loc, level: "fatal" }).rejected.map((x) => x.reason), ["level-invalid"]);
  assert.deepEqual(mk({ ...loc, level: 2 }).rejected.map((x) => x.reason), ["level-invalid"]);
  const none = mk({ ...loc, level: "none" }).records[0].trusted;
  assert.equal(none.level, "none");
  assert.equal(none.priority, "p3");
  const badDefault = mk(loc, { id: "r.a", defaultConfiguration: { level: "severe" } }).records[0].trusted;
  assert.ok(!Object.hasOwn(badDefault, "level"));
  assert.equal(badDefault.priority, "p3");
  assert.deepEqual(badDefault.recorded, ["rule-default-level-invalid", "level-absent"]);
});

test("§6.7 row 7: unknown tool ⇒ class from tags only, confidence 3 (default_confidence), recorded unknown-tool; a known tool's rule id from an unknown tool is unmapped", () => {
  const [tagged, prefixed] = run("unknown-tool.sarif").records;
  assert.equal(tagged.trusted.tool, "MyScanner");
  assert.equal(tagged.trusted.tool_key, "unknown");
  assert.equal(tagged.trusted.tool_version, "0.1");
  assert.equal(tagged.trusted.confidence, 3);
  assert.equal(tagged.trusted.class, "xss");
  assert.equal(tagged.trusted.class_source, "tags");
  assert.deepEqual(tagged.trusted.recorded, ["unknown-tool"]);
  assert.equal(prefixed.trusted.class, "unmapped");
  assert.equal(prefixed.trusted.class_source, "unmapped");
  assert.equal(prefixed.trusted.confidence, 3);
});

test("§6.7 row 8: malformed region (end < start, non-integer, < 1) ⇒ rejected region-malformed; a region past the file ⇒ rejected region-outside-file", () => {
  const out = run("region-malformed.sarif");
  assert.deepEqual(out.records, []);
  assert.deepEqual(out.rejected.map((x) => [x.locator.index, x.reason]), [[0, "region-malformed"], [1, "region-malformed"], [2, "region-malformed"], [3, "region-outside-file"]]);
  // a snippet that is not {text: string} is a malformed region too
  const mk = (region) => adaptSarif({ runs: [{ tool: { driver: { name: "semgrep", rules: [{ id: "r.a" }] } }, results: [{ ruleId: "r.a", message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region } }] }] }] }, { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide });
  assert.deepEqual(mk({ startLine: 4, snippet: { text: 5 } }).rejected.map((x) => x.reason), ["region-malformed"]);
  assert.deepEqual(mk({ startLine: 4, snippet: "x" }).rejected.map((x) => x.reason), ["region-malformed"]);
  assert.deepEqual(mk({ startLine: 4, endLine: "5" }).rejected.map((x) => x.reason), ["region-malformed"]);
  assert.ok(mk({ startLine: 4, snippet: {} }).records[0].trusted.recorded.includes("snippet-from-side"), "a snippet object without text is an absent snippet");
  assert.deepEqual(mk({ startLine: 2, endLine: 2 }).rejected.map((x) => x.reason), ["region-blank"]);
  assert.deepEqual(mk("4").unlocated.map((x) => x.reason), ["no-location"], "a non-object region locates nothing");
  assert.deepEqual(mk({ byteOffset: 10 }).unlocated.map((x) => x.reason), ["no-location"], "no startLine ⇒ nothing line-based to locate");
});

test("§6.7 row 9: a data-flow class is a located candidate flagged requires_typed_citations; secret / crypto are not", () => {
  const out = run("dataflow.sarif");
  assert.equal(out.records.length, 3);
  const by = Object.fromEntries(out.records.map((r) => [r.trusted.rule_id, r.trusted]));
  assert.equal(by["js/xss"].class, "xss");
  assert.equal(by["js/xss"].requires_typed_citations, true);
  assert.equal(by["js/xss"].cwe, "CWE-79");
  assert.equal(by["js/xss"].priority, "p1", "rule default error");
  assert.equal(by["js/hardcoded-credentials"].class, "secret");
  assert.equal(by["js/hardcoded-credentials"].requires_typed_citations, false);
  assert.equal(by["js/weak-cryptographic-algorithm"].class, "crypto");
  assert.equal(by["js/weak-cryptographic-algorithm"].requires_typed_citations, false);
  for (const t of Object.values(by)) assert.equal(t.confidence, 7);
  assert.ok(!JSON.stringify(out).includes("src/other.js"), "codeFlows / relatedLocations are never read");
});

test("gitleaks: no tags ⇒ class via the rule-id prefix table; partialFingerprints keeps string values only", () => {
  const [r] = run("gitleaks.sarif").records;
  assert.equal(r.trusted.class, "secret");
  assert.equal(r.trusted.class_source, "rule-prefix");
  assert.equal(r.trusted.confidence, 7);
  assert.equal(r.trusted.requires_typed_citations, false);
  assert.deepEqual(r.trusted.partial_fingerprints, { commitSha: "", email: "", author: "" });
  assert.ok(!r.inert.snippet.includes("password=1234"));
});

test("US-010 AC-3 (record level): three rejections with two distinct reasons are all counted", () => {
  const out = run("rejections.sarif");
  assert.equal(out.rejected.length, 3);
  const counts = {};
  for (const x of out.rejected) counts[x.reason] = (counts[x.reason] ?? 0) + 1;
  assert.deepEqual(counts, { "rule-mismatch": 2, "region-malformed": 1 });
  assert.equal(out.records.length, 1);
});

test("the recorded side is the scope file's side: a snapshot-side scope file is read as snapshot", () => {
  const scope = scopeOf([["src/db.js", "snapshot", 7]]);
  scope.payload.snapshot = { "src/db.js": { original_hmac: "1".repeat(64), redacted_sha256: "2".repeat(64), redaction_version: 1 } };
  const seen = [];
  const read = (path, side) => {
    seen.push([path, side]);
    return Buffer.from(DB_JS.replace("password=1234", "<REDACTED:password-assign>"), "utf8");
  };
  const out = adaptSarif(load("snippet-absent.sarif"), { scope, locatorBase: base, mapping: MAPPING, readSide: read });
  assert.deepEqual(seen, [["src/db.js", "snapshot"]], "one read per file, memoised across results");
  assert.equal(out.records[0].trusted.side, "snapshot");
  assert.equal(out.records[1].trusted.side, "snapshot");
});

test("readSide failures propagate untouched (the I/O layer maps them; the core never swallows an integrity error into a rejection)", () => {
  const boom = new Error("snapshot mismatch");
  assert.throws(() => adaptSarif(load("located.sarif"), { scope: SCOPE, locatorBase: base, mapping: MAPPING, readSide: () => { throw boom; } }), (err) => err === boom);
});
