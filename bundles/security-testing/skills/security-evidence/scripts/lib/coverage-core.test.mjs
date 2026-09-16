// TASK-020 — lib/coverage-core.mjs: the pure coverage accounting (plan §5
// TASK-020 + the G7 PM-log row "TASK-020 exports a pure computeCoverage(scope,
// examined, scannerRows) core with an import-guard test"; spec D3 "every
// scoped range is accounted for exactly once", §6.1 `coverage.json` preimage,
// §6.3 derivation table "coverage re-run on scope + examined declaration";
// G-9 pure core). Every input here is an in-memory artifact; nothing touches
// git or the file system.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE_STATUSES, SKIPPED_RANGE, computeCoverage, countByStatus, verifyAccounting } from "./coverage-core.mjs";
import { CliError } from "./exit.mjs";
import { validate } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCOPE_SHA = "5".repeat(64);
const EXAMINED_SHA = "e".repeat(64);
const PACKET_SHA = "9".repeat(64);
const IMPORT_A = "a".repeat(64);
const IMPORT_B = "b".repeat(64);
const OID = "1".repeat(40);
const HMAC = "c".repeat(64);

/** A scope artifact over app.js (10 lines), db.js (6 lines), empty.js (0 lines) with one binary skipped. */
function scopeArtifact({ files, ranges, skipped } = {}) {
  return {
    envelope: { self_sha256: SCOPE_SHA },
    payload: {
      files: files ?? [
        { path: "src/app.js", side: "head", oid: OID, file_hmac: HMAC, lines: 10 },
        { path: "src/db.js", side: "head", oid: OID, file_hmac: HMAC, lines: 6 },
        { path: "src/empty.js", side: "head", oid: OID, file_hmac: HMAC, lines: 0 },
      ],
      ranges: ranges ?? { "src/app.js": [[1, 10]], "src/db.js": [[1, 6]], "src/empty.js": [] },
      skipped: skipped ?? [{ path: "src/logo.png", reason: "binary" }],
    },
  };
}

function examinedArtifact(declared) {
  return { envelope: { self_sha256: EXAMINED_SHA }, payload: { packet_sha256: PACKET_SHA, declared } };
}

const row = (import_sha256, paths, tool = "Semgrep OSS", version = "1.90.0") => ({ tool, version, import_sha256, paths });

// --- import guard (G-9) --------------------------------------------------------

test("pure: coverage-core.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "coverage-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process.", "node:crypto"]) {
    assert.ok(!src.includes(banned), `coverage-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./exit.mjs", "./tokens.mjs"]);
});

test("constants: the four accounting statuses are coverage.schema.json's enum; SKIPPED_RANGE is the schema's minimum range", () => {
  assert.deepEqual([...COVERAGE_STATUSES], ["examined", "skipped", "scanner-only", "unexamined"]);
  assert.ok(Object.isFrozen(COVERAGE_STATUSES));
  assert.deepEqual([...SKIPPED_RANGE], [1, 1]);
  assert.ok(Object.isFrozen(SKIPPED_RANGE));
});

// --- computeCoverage -------------------------------------------------------------

test("payload shape (US-014 AC-1): {accounting, scanner_rows, scope_sha256, examined_sha256, indeterminate}; validates against coverage.schema.json", () => {
  const out = computeCoverage(scopeArtifact(), examinedArtifact([{ path: "src/app.js", ranges: [[1, 10]] }]), []);
  assert.deepEqual(Object.keys(out).sort(), ["accounting", "examined_sha256", "indeterminate", "scanner_rows", "scope_sha256"]);
  assert.equal(out.scope_sha256, SCOPE_SHA);
  assert.equal(out.examined_sha256, EXAMINED_SHA);
  assert.equal(out.indeterminate, false);
  assert.deepEqual(out.scanner_rows, []);
  assert.deepEqual(validate("coverage", out), []);
  for (const entry of out.accounting) assert.ok(COVERAGE_STATUSES.includes(entry.status), entry.status);
});

test("every scoped range appears in exactly one entry (AC-2): declared pieces examined, the rest unexamined, a skipped file one skipped(<reason>) entry; sorted by path then start", () => {
  const out = computeCoverage(
    scopeArtifact(),
    examinedArtifact([
      { path: "src/db.js", ranges: [[2, 3]] },
      { path: "src/app.js", ranges: [[4, 6], [1, 2]] },
    ]),
    [],
  );
  assert.deepEqual(out.accounting, [
    { path: "src/app.js", range: [1, 2], status: "examined", by: [EXAMINED_SHA] },
    { path: "src/app.js", range: [3, 3], status: "unexamined", by: [] },
    { path: "src/app.js", range: [4, 6], status: "examined", by: [EXAMINED_SHA] },
    { path: "src/app.js", range: [7, 10], status: "unexamined", by: [] },
    { path: "src/db.js", range: [1, 1], status: "unexamined", by: [] },
    { path: "src/db.js", range: [2, 3], status: "examined", by: [EXAMINED_SHA] },
    { path: "src/db.js", range: [4, 6], status: "unexamined", by: [] },
    { path: "src/logo.png", range: [1, 1], status: "skipped", by: ["binary"] },
  ]);
  assert.doesNotThrow(() => verifyAccounting(scopeArtifact().payload, out.accounting));
  assert.deepEqual(countByStatus(out.accounting), { examined: 3, skipped: 1, "scanner-only": 0, unexamined: 4 });
});

test("a declaration gap is allowed and reported as unexamined; an empty declared list leaves every range unexamined", () => {
  const out = computeCoverage(scopeArtifact(), examinedArtifact([]), []);
  assert.deepEqual(
    out.accounting.filter((e) => e.status !== "skipped"),
    [
      { path: "src/app.js", range: [1, 10], status: "unexamined", by: [] },
      { path: "src/db.js", range: [1, 6], status: "unexamined", by: [] },
    ],
  );
  assert.equal(out.indeterminate, false);
});

test("overlap fails naming the range (AC-2): 4 OVERLAP(<path>:<a>-<b>) is the intersection, across entries and within one entry", () => {
  const across = () =>
    computeCoverage(
      scopeArtifact(),
      examinedArtifact([
        { path: "src/app.js", ranges: [[1, 5]] },
        { path: "src/app.js", ranges: [[4, 8]] },
      ]),
      [],
    );
  assert.throws(across, (err) => err instanceof CliError && err.code === 4 && err.token === "OVERLAP(src/app.js:4-5)");
  const within = () => computeCoverage(scopeArtifact(), examinedArtifact([{ path: "src/db.js", ranges: [[1, 6], [3, 3]] }]), []);
  assert.throws(within, (err) => err instanceof CliError && err.code === 4 && err.token === "OVERLAP(src/db.js:3-3)");
  // touching ranges do not overlap
  assert.doesNotThrow(() => computeCoverage(scopeArtifact(), examinedArtifact([{ path: "src/db.js", ranges: [[1, 3], [4, 6]] }]), []));
});

test("a declaration outside the packet is off-contract (exit 2 SCHEMA-INVALID(examined: …)): unknown path, skipped path, range past the admitted range, inverted range", () => {
  const cases = [
    [[{ path: "src/other.js", ranges: [[1, 1]] }], /declared\[0\]\.path src\/other\.js is not a scope file/],
    [[{ path: "src/logo.png", ranges: [[1, 1]] }], /declared\[0\]\.path src\/logo\.png is not a scope file/],
    [[{ path: "src/db.js", ranges: [[5, 7]] }], /declared\[0\]\.ranges\[0\] 5-7 lies outside the admitted ranges of src\/db\.js/],
    [[{ path: "src/empty.js", ranges: [[1, 1]] }], /declared\[0\]\.ranges\[0\] 1-1 lies outside the admitted ranges of src\/empty\.js/],
    [[{ path: "src/app.js", ranges: [[1, 2]] }, { path: "src/db.js", ranges: [[4, 2]] }], /declared\[1\]\.ranges\[0\] must be \[start, end\] with 1 ≤ start ≤ end/],
  ];
  for (const [declared, re] of cases) {
    assert.throws(
      () => computeCoverage(scopeArtifact(), examinedArtifact(declared), []),
      (err) => err instanceof CliError && err.code === 2 && err.token.startsWith("SCHEMA-INVALID(examined: ") && re.test(err.token),
      JSON.stringify(declared),
    );
  }
});

test("scanner rows: undeclared ranges of a row's paths are scanner-only by import identity; rows are sorted, paths sorted and deduplicated; a row proves artifact presence only", () => {
  const out = computeCoverage(
    scopeArtifact(),
    examinedArtifact([{ path: "src/app.js", ranges: [[3, 4]] }]),
    [row(IMPORT_B, ["src/db.js", "src/app.js", "src/db.js"], "CodeQL", "2.19.0"), row(IMPORT_A, ["src/app.js", "docs/notes.md"])],
  );
  assert.deepEqual(out.scanner_rows, [
    { tool: "Semgrep OSS", version: "1.90.0", import_sha256: IMPORT_A, paths: ["docs/notes.md", "src/app.js"] },
    { tool: "CodeQL", version: "2.19.0", import_sha256: IMPORT_B, paths: ["src/app.js", "src/db.js"] },
  ]);
  assert.deepEqual(
    out.accounting.filter((e) => e.status !== "skipped"),
    [
      { path: "src/app.js", range: [1, 2], status: "scanner-only", by: [IMPORT_A, IMPORT_B] },
      { path: "src/app.js", range: [3, 4], status: "examined", by: [EXAMINED_SHA] },
      { path: "src/app.js", range: [5, 10], status: "scanner-only", by: [IMPORT_A, IMPORT_B] },
      { path: "src/db.js", range: [1, 6], status: "scanner-only", by: [IMPORT_B] },
    ],
  );
  assert.deepEqual(countByStatus(out.accounting), { examined: 1, skipped: 1, "scanner-only": 3, unexamined: 0 });
  assert.deepEqual(validate("coverage", out), []);
  // a path outside the scope (docs/notes.md) is kept on the row and accounts for nothing
  assert.ok(!out.accounting.some((e) => e.path === "docs/notes.md"));
});

test("empty scope ⇒ indeterminate: true and accounting [] (AC-3 producer half); scanner rows are still recorded, skipped files are not", () => {
  const scope = scopeArtifact({ files: [], ranges: {}, skipped: [{ path: "src/blob.bin", reason: "binary" }] });
  const out = computeCoverage(scope, examinedArtifact([]), [row(IMPORT_A, ["src/app.js"])]);
  assert.deepEqual(out, { accounting: [], scanner_rows: [row(IMPORT_A, ["src/app.js"])], scope_sha256: SCOPE_SHA, examined_sha256: EXAMINED_SHA, indeterminate: true });
  assert.deepEqual(validate("coverage", out), []);
  // a declaration against an empty scope names no scope file
  assert.throws(() => computeCoverage(scope, examinedArtifact([{ path: "src/app.js", ranges: [[1, 1]] }]), []), (err) => err instanceof CliError && err.code === 2);
});

test("deterministic (AC-4): same inputs ⇒ deep-equal output; inputs never mutated; declaration order does not matter", () => {
  const scope = scopeArtifact();
  const declaredA = [
    { path: "src/db.js", ranges: [[4, 6], [1, 1]] },
    { path: "src/app.js", ranges: [[2, 9]] },
  ];
  const declaredB = [
    { path: "src/app.js", ranges: [[2, 9]] },
    { path: "src/db.js", ranges: [[1, 1], [4, 6]] },
  ];
  const rows = [row(IMPORT_B, ["src/db.js"]), row(IMPORT_A, ["src/app.js"])];
  const before = structuredClone({ scope, declaredA, rows });
  const a = computeCoverage(scope, examinedArtifact(declaredA), rows);
  const b = computeCoverage(scope, examinedArtifact(declaredA), rows);
  const c = computeCoverage(scope, examinedArtifact(declaredB), [rows[1], rows[0]]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.accounting, c.accounting, "accounting is a function of the ranges, not of their order");
  assert.deepEqual(a.scanner_rows, c.scanner_rows);
  assert.deepEqual({ scope, declaredA, rows }, before, "inputs untouched");
  assert.equal(JSON.stringify(a).includes("2026"), false, "no clock anywhere in the payload (G-1)");
});

test("multiple admitted ranges per file are each accounted; a declared range must lie inside one admitted range", () => {
  const scope = scopeArtifact({
    files: [{ path: "src/app.js", side: "head", oid: OID, file_hmac: HMAC, lines: 20 }],
    ranges: { "src/app.js": [[1, 5], [11, 20]] },
    skipped: [],
  });
  const out = computeCoverage(scope, examinedArtifact([{ path: "src/app.js", ranges: [[12, 15]] }]), []);
  assert.deepEqual(out.accounting, [
    { path: "src/app.js", range: [1, 5], status: "unexamined", by: [] },
    { path: "src/app.js", range: [11, 11], status: "unexamined", by: [] },
    { path: "src/app.js", range: [12, 15], status: "examined", by: [EXAMINED_SHA] },
    { path: "src/app.js", range: [16, 20], status: "unexamined", by: [] },
  ]);
  assert.throws(() => computeCoverage(scope, examinedArtifact([{ path: "src/app.js", ranges: [[4, 12]] }]), []), (err) => err instanceof CliError && err.code === 2 && /4-12 lies outside/.test(err.token));
});

test("scanner rows are validated as the caller's contract: shape errors are TypeErrors, a duplicate import identity too", () => {
  const scope = scopeArtifact();
  const ex = examinedArtifact([]);
  assert.throws(() => computeCoverage(scope, ex, [{ tool: "t", version: "v", import_sha256: "nope", paths: [] }]), TypeError);
  assert.throws(() => computeCoverage(scope, ex, [{ tool: "t", version: "v", import_sha256: IMPORT_A }]), TypeError);
  assert.throws(() => computeCoverage(scope, ex, [{ tool: "", version: "v", import_sha256: IMPORT_A, paths: [] }]), TypeError);
  assert.throws(() => computeCoverage(scope, ex, [row(IMPORT_A, []), row(IMPORT_A, [])]), /duplicate/);
  assert.throws(() => computeCoverage(scope, ex, "rows"), TypeError);
  assert.throws(() => computeCoverage({ payload: scope.payload }, ex, []), TypeError, "scope needs its identity");
});

// --- verifyAccounting (what `check` re-runs over a recorded accounting) ---------------

test("verifyAccounting: an accounting hole is 4 GAP(<path>:<a>-<b>); a double-covered or stray entry is an internal error, never a token", () => {
  const scope = scopeArtifact().payload;
  const good = computeCoverage(scopeArtifact(), examinedArtifact([{ path: "src/app.js", ranges: [[3, 4]] }]), []).accounting;
  assert.doesNotThrow(() => verifyAccounting(scope, good));

  const holed = good.filter((e) => !(e.path === "src/app.js" && e.range[0] === 3));
  assert.throws(() => verifyAccounting(scope, holed), (err) => err instanceof CliError && err.code === 4 && err.token === "GAP(src/app.js:3-4)");

  const tailHole = good.map((e) => (e.path === "src/db.js" ? { ...e, range: [1, 4] } : e));
  assert.throws(() => verifyAccounting(scope, tailHole), (err) => err instanceof CliError && err.token === "GAP(src/db.js:5-6)");

  const missingFile = good.filter((e) => e.path !== "src/db.js");
  assert.throws(() => verifyAccounting(scope, missingFile), (err) => err instanceof CliError && err.token === "GAP(src/db.js:1-6)");

  const doubled = [...good, { path: "src/app.js", range: [3, 4], status: "unexamined", by: [] }];
  assert.throws(() => verifyAccounting(scope, doubled), (err) => !(err instanceof CliError) && /twice|overlap/i.test(err.message));

  const stray = [...good, { path: "src/nowhere.js", range: [1, 1], status: "unexamined", by: [] }];
  assert.throws(() => verifyAccounting(scope, stray), (err) => !(err instanceof CliError) && /not a scope file/.test(err.message));

  const missingSkipped = good.filter((e) => e.status !== "skipped");
  assert.throws(() => verifyAccounting(scope, missingSkipped), (err) => !(err instanceof CliError) && /skipped/.test(err.message));

  // an empty scope verifies an empty accounting and nothing else
  assert.doesNotThrow(() => verifyAccounting({ files: [], ranges: {}, skipped: [] }, []));
  assert.throws(() => verifyAccounting({ files: [], ranges: {}, skipped: [] }, [{ path: "src/app.js", range: [1, 1], status: "unexamined", by: [] }]), (err) => !(err instanceof CliError));
});
