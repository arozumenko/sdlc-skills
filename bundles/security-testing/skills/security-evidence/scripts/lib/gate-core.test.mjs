// TASK-019 — lib/gate-core.mjs: the pure gate (plan §3.3 / §5 TASK-019; spec
// §6.1 `gate-result.json` preimage, §6.5 identity by content sensitivity,
// §6.2 range rule, §6.7 last row; G-9 pure core). `gate()` is pure given
// `resolveSide`: every byte it reads comes through that callback, so these
// tests feed it fixed buffers and never touch git or the file system. The CLI
// wiring (files, key, drop-box) is gate.test.mjs / cmd-gate.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, canonical, hmacHex, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactString } from "../redact.mjs";
import { CITATION_STATES, ClaimsPacketMismatch, findingId, gate } from "./gate-core.mjs";
import { validate } from "./schema.mjs";
import {
  GATE_AGENT_WROTE_ID,
  GATE_CLAIM_INVALID,
  GATE_DUPLICATE_ID,
  GATE_FILE_NOT_TEXT,
  GATE_PATH_NOT_AT_SIDE,
  GATE_RANGE_OUTSIDE_FILE,
  PATH_NOT_IN_SCOPE,
  RANGE_NOT_ADMITTED,
  RANGE_TOO_LONG,
  SIDE_MISMATCH,
} from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = Buffer.from("0123456789abcdef0123456789abcdef");
const OTHER_KEY = Buffer.from("fedcba9876543210fedcba9876543210");
const SHA256 = /^[0-9a-f]{64}$/;
const OID_APP = "1".repeat(40);
const OID_DB = "2".repeat(40);
const OID_DUP = "3".repeat(40);
const OID_APP_BASE = "4".repeat(40);
const SNAP_SHA = "a".repeat(64);
const SCOPE_SHA = "5".repeat(64);
const PACKET_SHA = "6".repeat(64);
const SUBJECT_PACKET_SHA = "7".repeat(64);
const IMPORT_SHA = "8".repeat(64);
const HMAC_X = "9".repeat(64);
const CLAIMS_REF = "c".repeat(64);
const SECRET = "password=1234";

// src/app.js at head: 1 normalised line; at base: 3 (the file shrank between base and head).
const APP = Buffer.from("export const a = 1;\n", "utf8");
const APP_BASE = Buffer.from("export const a = 1;\nexport const legacy = 2;\n\nexport const gone = 3;\n", "utf8");
// src/db.js: 9 raw lines, 7 normalised; normalised line 6 carries the secret.
const DB = Buffer.from(
  ['import { pool } from "./pool.js";', "", "export function find(req) {", '  const q = "SELECT * FROM users WHERE id = " + req.query.id;', "  return pool.query(q);", "}", "", `// ${SECRET}`, 'export const token = "x";', ""].join("\n"),
  "utf8",
);
// src/dup.js: repeated windows, for occurrence.
const DUP = Buffer.from("a();\nb();\na();\nb();\na();\n", "utf8");

/** A scope payload over the three head files (whole-file admitted ranges), as TASK-013 writes it. */
function scopePayload({ snapshot = false } = {}) {
  const files = [
    { path: "src/app.js", side: "head", oid: OID_APP, file_hmac: HMAC_X, lines: 1 },
    { path: "src/db.js", side: snapshot ? "snapshot" : "head", oid: snapshot ? SNAP_SHA : OID_DB, file_hmac: HMAC_X, lines: 7 },
    { path: "src/dup.js", side: "head", oid: OID_DUP, file_hmac: HMAC_X, lines: 5 },
  ];
  const payload = { files, ranges: { "src/app.js": [[1, 1]], "src/db.js": [[1, 7]], "src/dup.js": [[1, 5]] }, skipped: [] };
  if (snapshot) payload.snapshot = { "src/db.js": { original_hmac: HMAC_X, redacted_sha256: SNAP_SHA, redaction_version: 1 } };
  return payload;
}

const scopeArtifact = (opts) => ({ envelope: { schema_version: 1, kind: "scope", run_id: "0123456789ab-0001", engagement_id: "e", key_id: "k000000000000", created_at: "2026-09-16T10:00:00Z", self_sha256: SCOPE_SHA }, payload: scopePayload(opts) });

/** A resolveSide over an in-memory table keyed `side:path` → {bytes, oid}; `null` entries mean "no blob at that side"; records every call. */
function tableResolver(table) {
  const calls = [];
  const fn = ({ path, side }) => {
    calls.push({ path, side });
    const key = `${side}:${path}`;
    if (!Object.hasOwn(table, key)) throw new Error(`no fixture bytes for ${key}`);
    return table[key];
  };
  return { fn, calls };
}

const HEAD_TABLE = () => ({
  "head:src/app.js": { bytes: APP, oid: OID_APP },
  "head:src/db.js": { bytes: DB, oid: OID_DB },
  "head:src/dup.js": { bytes: DUP, oid: OID_DUP },
  "base:src/app.js": { bytes: APP_BASE, oid: OID_APP_BASE },
  "base:src/db.js": null,
});

const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });
const claimSet = (findings, over = {}) => ({ name: "claims-1.json", ref: CLAIMS_REF, set: { scope_sha256: SCOPE_SHA, packet_sha256: PACKET_SHA, findings }, ...over });

function run(over = {}) {
  const { fn, calls } = tableResolver(over.table ?? HEAD_TABLE());
  const input = {
    scope: over.scope ?? scopeArtifact(),
    scopePackets: over.scopePackets ?? [PACKET_SHA],
    claims: over.claims ?? [],
    imports: over.imports ?? [],
    resolveSide: fn,
    key: over.key ?? KEY,
    rules: DEFAULT_RULES,
  };
  return { out: gate(input), calls, input };
}

const plainId = (path, cls, snippet, occurrence) => sha256Hex(Buffer.from(`${path}\0${cls}\0${snippet}\0${occurrence}`, "utf8"));
const keyedId = (key, path, cls, snippet, occurrence) => hmacHex(key, Buffer.from(`${path}\0${cls}\0${redactString(snippet).text}\0${occurrence}`, "utf8"));

// --- import guard (G-9) --------------------------------------------------------

test("pure: gate-core.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "gate-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "cite.mjs\"", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `gate-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../canon.mjs", "../normalize.mjs", "../redact.mjs", "./cite-core.mjs", "./ingest/_sarif.mjs", "./schema.mjs", "./tokens.mjs"]);
  assert.deepEqual([...CITATION_STATES], ["CITATION_VERIFIED", "CITATION_FAILED"]);
});

// --- identity by content sensitivity (spec §6.5) ---------------------------------

test("plain identity when no rule matches: id = sha256(path\\0class\\0normalised snippet\\0occurrence), snippet stored, no sensitive flag (US-013 AC-1)", () => {
  const { out, calls } = run({ claims: [claimSet([claim()])] });
  assert.equal(out.claimed.findings.length, 1);
  const [f] = out.claimed.findings;
  assert.equal(f.id, plainId("src/app.js", "config", "export const a = 1;", 0));
  assert.equal(f.snippet, "export const a = 1;");
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.equal(f.occurrence, 0);
  assert.ok(!("sensitive" in f) && !("snippet_redacted" in f) && !("context_redacted" in f));
  assert.deepEqual(f.source, { kind: "agent", ref: CLAIMS_REF, index: 0 });
  assert.deepEqual(out.gateResult.accepted, [f.id]);
  assert.deepEqual(out.gateResult.unverifiable, []);
  assert.deepEqual(out.citationRecords, [], "a plain finding writes no private record");
  assert.deepEqual(calls, [{ path: "src/app.js", side: "head" }], "one resolve per (side, path)");
  assert.equal(findingId({ path: "src/app.js", class: "config", snippet: "export const a = 1;", occurrence: 0, sensitive: false, key: KEY, rules: DEFAULT_RULES }), f.id);
});

test("non-secret finding citing password=1234 ⇒ keyed id over the REDACTED normalised snippet, snippet_redacted stored, sensitive: true, private record before discard (US-013 AC-2/AC-3)", () => {
  const c = claim({ class: "config", path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` });
  const { out } = run({ claims: [claimSet([c])] });
  const [f] = out.claimed.findings;
  assert.equal(f.id, keyedId(KEY, "src/db.js", "config", `// ${SECRET}`, 0));
  assert.notEqual(f.id, plainId("src/db.js", "config", `// ${SECRET}`, 0), "never the plain hash of protected content (G-2)");
  assert.equal(f.snippet_redacted, "// <REDACTED:password-assign>");
  assert.equal(f.sensitive, true);
  assert.ok(!("snippet" in f) && !("context_redacted" in f));
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.deepEqual(out.gateResult.accepted, [f.id]);
  assert.equal(out.citationRecords.length, 1);
  const [{ id, record }] = out.citationRecords;
  assert.equal(id, f.id);
  assert.deepEqual(record, { claimed_hmac: hmacHex(KEY, Buffer.from(`// ${SECRET}`)), source_hmac: hmacHex(KEY, Buffer.from(`// ${SECRET}`)), match: true, side: "head", oid: OID_DB, redaction_version: DEFAULT_RULES.redaction_version });
  assert.deepEqual(validate("citation-record", record), []);
  // the claimed text is nowhere in what leaves the core
  const everything = JSON.stringify([out.claimed, out.gateResult, out.rejects, out.unlocated, out.citationRecords]);
  assert.ok(!everything.includes(SECRET));
  // a different key ⇒ a different id (keyed, not plain)
  const other = run({ claims: [claimSet([c])], key: OTHER_KEY }).out.claimed.findings[0];
  assert.notEqual(other.id, f.id);
  assert.equal(other.id, keyedId(OTHER_KEY, "src/db.js", "config", `// ${SECRET}`, 0));
  assert.equal(findingId({ path: "src/db.js", class: "config", snippet: `// ${SECRET}`, occurrence: 0, sensitive: true, key: KEY, rules: DEFAULT_RULES }), f.id);
});

test("a CITATION_FAILED sensitive claim still gets its private record (match: false) and lands in unverifiable[]; the claimed text is discarded", () => {
  const c = claim({ class: "config", path: "src/db.js", lines: [6, 6], snippet: "// password=9999" });
  const { out } = run({ claims: [claimSet([c])] });
  const [f] = out.claimed.findings;
  assert.equal(f.state, "CITATION_FAILED");
  assert.equal(f.occurrence, 0);
  assert.equal(f.sensitive, true);
  assert.equal(f.snippet_redacted, "// <REDACTED:password-assign>");
  assert.deepEqual(out.gateResult.unverifiable, [f.id]);
  assert.deepEqual(out.gateResult.accepted, []);
  const [{ record }] = out.citationRecords;
  assert.equal(record.match, false);
  assert.equal(record.claimed_hmac, hmacHex(KEY, Buffer.from("// password=9999")));
  assert.equal(record.source_hmac, hmacHex(KEY, Buffer.from(`// ${SECRET}`)));
  assert.notEqual(record.claimed_hmac, record.source_hmac);
  const everything = JSON.stringify([out.claimed, out.gateResult, out.rejects, out.unlocated, out.citationRecords]);
  assert.ok(!everything.includes("9999") && !everything.includes(SECRET));
});

test("secret class uses context_redacted and the keyed identity whether or not a rule matches (US-013 AC-4)", () => {
  const matching = claim({ class: "secret", path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` });
  const silent = claim({ class: "secret", path: "src/db.js", lines: [2, 2], snippet: "export function find(req) {" });
  const { out } = run({ claims: [claimSet([matching, silent])] });
  const byLine = Object.fromEntries(out.claimed.findings.map((f) => [f.lines[0], f]));
  assert.equal(byLine[6].context_redacted, "// <REDACTED:password-assign>");
  assert.equal(byLine[6].sensitive, true);
  assert.equal(byLine[6].id, keyedId(KEY, "src/db.js", "secret", `// ${SECRET}`, 0));
  assert.ok(!("snippet" in byLine[6]) && !("snippet_redacted" in byLine[6]));
  // a secret-class claim the rules do not catch is still the reviewer's word that the text is a secret: keyed, context_redacted
  assert.equal(byLine[2].context_redacted, "export function find(req) {");
  assert.equal(byLine[2].sensitive, true);
  assert.equal(byLine[2].id, keyedId(KEY, "src/db.js", "secret", "export function find(req) {", 0));
  assert.notEqual(byLine[2].id, plainId("src/db.js", "secret", "export function find(req) {", 0));
  assert.equal(out.citationRecords.length, 2);
  assert.deepEqual(out.gateResult.accepted, [byLine[6].id, byLine[2].id].sort());
});

test("a claim that carries snippet_redacted or context_redacted is compared against the redacted source text and takes the keyed identity", () => {
  const pre = claim({ class: "config", path: "src/db.js", lines: [6, 6], snippet: undefined, snippet_redacted: "// <REDACTED:password-assign>" });
  delete pre.snippet;
  const { out } = run({ claims: [claimSet([pre])] });
  const [f] = out.claimed.findings;
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.equal(f.sensitive, true);
  assert.equal(f.snippet_redacted, "// <REDACTED:password-assign>");
  assert.equal(f.id, keyedId(KEY, "src/db.js", "config", `// ${SECRET}`, 0), "same identity as a plain-text claim of the same line");
  const [{ record }] = out.citationRecords;
  assert.equal(record.match, true);
  assert.equal(record.claimed_hmac, hmacHex(KEY, Buffer.from("// <REDACTED:password-assign>")));
  assert.equal(record.source_hmac, hmacHex(KEY, Buffer.from(`// ${SECRET}`)));
});

test("snapshot-side scope file: the resolved bytes are already redacted, so a claim quoting the marker verifies with a PLAIN identity (no rule matches a marker)", () => {
  const snapDb = Buffer.from(DB.toString("utf8").replace(SECRET, "<REDACTED:password-assign>"), "utf8");
  const table = { ...HEAD_TABLE(), "snapshot:src/db.js": { bytes: snapDb, oid: SNAP_SHA } };
  const c = claim({ class: "config", path: "src/db.js", side: "snapshot", lines: [6, 6], snippet: "// <REDACTED:password-assign>" });
  const { out } = run({ scope: scopeArtifact({ snapshot: true }), table, claims: [claimSet([c])] });
  const [f] = out.claimed.findings;
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.equal(f.snippet, "// <REDACTED:password-assign>");
  assert.ok(!("sensitive" in f));
  assert.equal(f.id, plainId("src/db.js", "config", "// <REDACTED:password-assign>", 0));
  assert.deepEqual(out.citationRecords, []);
  // a `head` citation of a snapshot-side file is SIDE-MISMATCH
  const wrong = run({ scope: scopeArtifact({ snapshot: true }), table, claims: [claimSet([claim({ path: "src/db.js", side: "head", lines: [6, 6], snippet: "x" })])] }).out;
  assert.deepEqual(wrong.rejects.rejected, [{ reason: SIDE_MISMATCH, locator: { claims_sha256: CLAIMS_REF, index: 0 } }]);
});

// --- states and occurrence (spec v3 §6.1, TASK-014) -------------------------------

test("states and occurrence recomputed ignoring the hint; the claimed snippet is normalised before comparison; gate-result payload shape (US-013 AC-5)", () => {
  const claims = [
    claim({ path: "src/dup.js", lines: [5, 5], snippet: "a();", occurrence_hint: 0 }), // third a() ⇒ occurrence 2
    claim({ path: "src/dup.js", lines: [2, 2], snippet: "a();", occurrence_hint: 7 }), // window is b() ⇒ FAILED
    claim({ path: "src/dup.js", lines: [3, 4], snippet: "  a();  \r\n\r\nb();\n", occurrence_hint: 9 }), // normalises to a();\nb(); ⇒ occurrence 1
    claim({ path: "src/db.js", lines: [3, 4], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);' }),
    claim({ path: "src/db.js", lines: [3, 4], snippet: "return pool.query(q);" }), // one line for a two-line range ⇒ FAILED
  ];
  const { out } = run({ claims: [claimSet(claims)] });
  const by = (i) => out.claimed.findings.find((f) => f.source.index === i);
  assert.equal(by(0).state, "CITATION_VERIFIED");
  assert.equal(by(0).occurrence, 2);
  assert.equal(by(1).state, "CITATION_FAILED");
  assert.equal(by(1).occurrence, 0);
  assert.equal(by(2).state, "CITATION_VERIFIED");
  assert.equal(by(2).occurrence, 1);
  assert.equal(by(2).snippet, "a();\nb();");
  assert.equal(by(3).state, "CITATION_VERIFIED");
  assert.equal(by(3).occurrence, 0);
  assert.equal(by(4).state, "CITATION_FAILED");
  for (const f of out.claimed.findings) assert.ok(!("occurrence_hint" in f), "the hint never reaches the finding");
  assert.deepEqual(Object.keys(out.gateResult).sort(), ["accepted", "claimed_sha256", "rejected_counts", "scope_sha256", "unverifiable"]);
  assert.deepEqual(out.gateResult.accepted, [by(0).id, by(2).id, by(3).id].sort());
  assert.deepEqual(out.gateResult.unverifiable, [by(1).id, by(4).id].sort());
  assert.deepEqual(out.gateResult.rejected_counts, {});
  assert.equal(out.gateResult.scope_sha256, SCOPE_SHA);
  assert.equal(out.gateResult.claimed_sha256, artifactId(out.claimed), "claimed_sha256 = sha256(canonical(findings.claimed payload))");
  assert.deepEqual(validate("gate-result", out.gateResult), []);
  assert.deepEqual(validate("claimed", out.claimed), []);
  assert.deepEqual(validate("rejects", out.rejects), []);
  assert.deepEqual(validate("unlocated", out.unlocated), []);
  assert.deepEqual(
    out.claimed.findings.map((f) => f.id),
    [...out.claimed.findings.map((f) => f.id)].sort(),
    "findings are ordered by id",
  );
  assert.equal(out.claimed.scope_sha256, SCOPE_SHA);
});

test("deterministic: the same input twice ⇒ deep-equal output; claims listed in another order ⇒ the same ids, states and records (only source.index moves); inputs untouched (US-013 AC-6)", () => {
  const a = claim({ path: "src/dup.js", lines: [1, 1], snippet: "a();" });
  const b = claim({ path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` });
  const first = run({ claims: [claimSet([a, b])] });
  const before = { claims: structuredClone(first.input.claims), scope: structuredClone(first.input.scope) };
  const again = gate(first.input);
  assert.deepEqual(again, first.out);
  assert.deepEqual(first.input.claims, before.claims, "claims are not mutated");
  assert.deepEqual(first.input.scope, before.scope, "scope is not mutated");
  const swapped = run({ claims: [claimSet([b, a])] });
  assert.deepEqual(swapped.out.gateResult.accepted, first.out.gateResult.accepted);
  assert.deepEqual(swapped.out.gateResult.unverifiable, first.out.gateResult.unverifiable);
  assert.deepEqual(swapped.out.citationRecords, first.out.citationRecords);
  const strip = (f) => ({ ...f, source: null });
  assert.deepEqual(swapped.out.claimed.findings.map(strip), first.out.claimed.findings.map(strip));
  assert.deepEqual(swapped.out.claimed.findings.map((f) => f.source.index).sort(), [0, 1]);
  assert.equal(sha256Hex(canonical(first.out.gateResult)), artifactId(first.out.gateResult));
});

// --- admission and rejections (spec §6.2, TL-15, G-7) ----------------------------

test("a claim carrying id or state (or any forbidden key) is rejected agent-wrote-id; priority/confidence missing ⇒ claim-invalid, never defaulted; priority is never capped", () => {
  const claims = [
    claim({ id: "f".repeat(64) }),
    claim({ state: "CITATION_VERIFIED" }),
    claim({ verdict: "VERIFIED" }),
    { ...claim(), priority: undefined },
    { ...claim(), confidence: undefined },
    claim({ confidence: 11 }),
    claim({ priority: "p0", confidence: 10 }),
    claim({ snippet: "   \n  " }),
  ];
  delete claims[3].priority;
  delete claims[4].confidence;
  const { out } = run({ claims: [claimSet(claims)] });
  assert.deepEqual(
    out.rejects.rejected.map((r) => [r.locator.index, r.reason]),
    [
      [0, GATE_AGENT_WROTE_ID],
      [1, GATE_AGENT_WROTE_ID],
      [2, GATE_AGENT_WROTE_ID],
      [3, GATE_CLAIM_INVALID],
      [4, GATE_CLAIM_INVALID],
      [5, GATE_CLAIM_INVALID],
      [7, GATE_CLAIM_INVALID],
    ],
  );
  assert.deepEqual(out.gateResult.rejected_counts, { [GATE_AGENT_WROTE_ID]: 3, [GATE_CLAIM_INVALID]: 4 });
  assert.equal(out.claimed.findings.length, 1);
  assert.equal(out.claimed.findings[0].priority, "p0", "p0 stays p0");
  assert.equal(out.claimed.findings[0].confidence, 10);
  for (const r of out.rejects.rejected) assert.deepEqual(Object.keys(r.locator).sort(), ["claims_sha256", "index"]);
});

test("range rule: RANGE-TOO-LONG, PATH-NOT-IN-SCOPE, RANGE-NOT-ADMITTED are rejections counted by reason; a typed citation that fails is the claim's rejection", () => {
  const claims = [
    claim({ path: "src/db.js", lines: [1, 41], snippet: "x" }),
    claim({ path: "src/nope.js", lines: [1, 1], snippet: "x" }),
    claim({ path: "src/app.js", lines: [1, 2], snippet: "x" }),
    claim({ class: "injection", path: "src/db.js", lines: [3, 3], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;', citations_typed: [{ role: "source", path: "src/other.js", side: "head", lines: [1, 1], context: false }] }),
    claim({ class: "injection", path: "src/db.js", lines: [3, 3], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;', citations_typed: [{ role: "sink", path: "src/db.js", side: "head", lines: [4, 8], context: false }] }),
  ];
  const { out } = run({ claims: [claimSet(claims)] });
  assert.deepEqual(
    out.rejects.rejected.map((r) => [r.locator.index, r.reason]),
    [
      [0, RANGE_TOO_LONG],
      [1, PATH_NOT_IN_SCOPE],
      [2, RANGE_NOT_ADMITTED],
      [3, PATH_NOT_IN_SCOPE],
      [4, GATE_RANGE_OUTSIDE_FILE],
    ],
  );
  assert.deepEqual(out.claimed.findings, []);
});

test("typed citations: flagged context: true, kept on the finding; a data-flow class is flagged requires_typed_citations and stays accepted (spec §6.7 last row)", () => {
  const withTyped = claim({ class: "injection", path: "src/db.js", lines: [3, 3], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;', citations_typed: [{ role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: false }] });
  const without = claim({ class: "xss", path: "src/db.js", lines: [4, 4], snippet: "return pool.query(q);", requires_typed_citations: false });
  const plain = claim({ class: "config", path: "src/app.js", lines: [1, 1], requires_typed_citations: true });
  const { out } = run({ claims: [claimSet([withTyped, without, plain])] });
  const by = (i) => out.claimed.findings.find((f) => f.source.index === i);
  assert.deepEqual(by(0).citations_typed, [{ role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true }]);
  assert.equal(by(0).requires_typed_citations, true);
  assert.equal(by(0).state, "CITATION_VERIFIED");
  assert.equal(by(1).requires_typed_citations, true, "derived from the class, not from the agent's flag");
  assert.equal(by(1).state, "CITATION_VERIFIED");
  assert.equal(by(2).requires_typed_citations, false);
  assert.deepEqual(out.gateResult.accepted, [by(0).id, by(1).id, by(2).id].sort());
});

test("base-side admission is explicit: a base citation of a scope file is admitted against the BASE blob's own extent, not head's ranges; past the base extent ⇒ RANGE-OUTSIDE-FILE; no blob at base ⇒ PATH-NOT-AT-SIDE; deleted at head ⇒ PATH-NOT-IN-SCOPE", () => {
  const claims = [
    claim({ path: "src/app.js", side: "base", lines: [3, 3], snippet: "export const gone = 3;" }), // line 3 exists at base only
    claim({ path: "src/app.js", side: "base", lines: [4, 4], snippet: "x" }),
    claim({ path: "src/db.js", side: "base", lines: [1, 1], snippet: "x" }), // no blob at base (added after base)
    claim({ path: "src/deleted.js", side: "base", lines: [1, 1], snippet: "x" }), // not a scope file
    claim({ path: "src/app.js", side: "base", lines: [1, 1], snippet: "export const a = 1;" }),
  ];
  const { out, calls } = run({ claims: [claimSet(claims)] });
  const by = (i) => out.claimed.findings.find((f) => f.source.index === i);
  assert.equal(by(0).state, "CITATION_VERIFIED");
  assert.equal(by(0).side, "base");
  assert.equal(by(0).id, plainId("src/app.js", "config", "export const gone = 3;", 0));
  assert.equal(by(4).state, "CITATION_VERIFIED");
  assert.deepEqual(
    out.rejects.rejected.map((r) => [r.locator.index, r.reason]),
    [
      [1, GATE_RANGE_OUTSIDE_FILE],
      [2, GATE_PATH_NOT_AT_SIDE],
      [3, PATH_NOT_IN_SCOPE],
    ],
  );
  assert.deepEqual(calls.filter((c) => c.side === "base").map((c) => c.path).sort(), ["src/app.js", "src/db.js"], "resolved once per (side, path); the unscoped path is never resolved");
});

test("a scope file whose bytes are not UTF-8 ⇒ FILE-NOT-TEXT rejection, never a crash", () => {
  const table = { ...HEAD_TABLE(), "head:src/app.js": { bytes: Buffer.from([0xff, 0xfe, 0x0a]), oid: OID_APP } };
  const { out } = run({ table, claims: [claimSet([claim()])] });
  assert.deepEqual(out.rejects.rejected, [{ reason: GATE_FILE_NOT_TEXT, locator: { claims_sha256: CLAIMS_REF, index: 0 } }]);
});

test("duplicate identities: the same finding twice keeps one entry; a CITATION_VERIFIED candidate wins over a CITATION_FAILED one with the same id; the loser is rejected duplicate-id", () => {
  const good = claim({ path: "src/dup.js", lines: [1, 1], snippet: "a();" }); // occurrence 0
  const failed = claim({ path: "src/dup.js", lines: [2, 2], snippet: "a();" }); // FAILED, occurrence 0 ⇒ same id
  const { out } = run({ claims: [claimSet([failed, good, good])] });
  assert.equal(out.claimed.findings.length, 1);
  assert.equal(out.claimed.findings[0].state, "CITATION_VERIFIED");
  assert.equal(out.claimed.findings[0].source.index, 1);
  assert.deepEqual(
    out.rejects.rejected.map((r) => [r.locator.index, r.reason]),
    [
      [0, GATE_DUPLICATE_ID],
      [2, GATE_DUPLICATE_ID],
    ],
  );
  assert.deepEqual(out.gateResult.rejected_counts, { [GATE_DUPLICATE_ID]: 2 });
  assert.deepEqual(out.gateResult.unverifiable, []);
});

test("claims file naming a subject packet, a packet of another run, or another scope ⇒ ClaimsPacketMismatch naming the file; nothing is gated", () => {
  const sets = [
    claimSet([claim()], { name: "claims-subject.json", set: { scope_sha256: SCOPE_SHA, packet_sha256: SUBJECT_PACKET_SHA, findings: [claim()] } }),
    claimSet([claim()], { name: "claims-foreign.json", set: { scope_sha256: SCOPE_SHA, packet_sha256: "d".repeat(64), findings: [claim()] } }),
    claimSet([claim()], { name: "claims-scope.json", set: { scope_sha256: "e".repeat(64), packet_sha256: PACKET_SHA, findings: [claim()] } }),
  ];
  for (const bad of sets) {
    assert.throws(
      () => run({ claims: [claimSet([claim()]), bad], scopePackets: [PACKET_SHA] }),
      (e) => e instanceof ClaimsPacketMismatch && e.file === bad.name,
      bad.name,
    );
  }
  assert.doesNotThrow(() => run({ claims: [claimSet([claim()])], scopePackets: [SUBJECT_PACKET_SHA, PACKET_SHA] }));
});

// --- SARIF candidates (spec §6.6/§6.7, TASK-016 contract) -------------------------

const sarifImport = (records, unlocated = [], rejected = []) => ({
  kind: "sarif",
  import_sha256: IMPORT_SHA,
  original_hmac: HMAC_X,
  redaction_version: 1,
  mapping_version: "v1",
  source_path: ".agents/security-testing/imports/x.sarif",
  records,
  unlocated,
  rejected,
});
const sarifRecord = (index, trusted, inert = { snippet: "[UNTRUSTED CONTENT] x" }) => ({
  locator: { import_sha256: IMPORT_SHA, original_hmac: HMAC_X, index },
  trusted: { tool: "Semgrep OSS", tool_key: "semgrep", rule_id: "r.sqli", level: "error", priority: "p1", confidence: 6, class: "injection", class_source: "tags", path: "src/db.js", side: "head", region: [4, 5], lines: [3, 4], requires_typed_citations: true, recorded: [], ...trusted },
  inert,
});

test("source field distinguishes agent and sarif candidates; a SARIF finding's identity is over the bytes at `lines` (its snippet is the source text, match by construction)", () => {
  const imp = sarifImport([sarifRecord(0, {}), sarifRecord(2, { rule_id: "aws-access-token", tool: "gitleaks", tool_key: "gitleaks", class: "secret", region: [8, 8], lines: [6, 6], requires_typed_citations: false, cwe: "CWE-798" })]);
  const { out } = run({ imports: [imp], claims: [claimSet([claim()])] });
  assert.equal(out.claimed.findings.length, 3);
  const sarif = out.claimed.findings.filter((f) => f.source.kind === "sarif");
  const agent = out.claimed.findings.filter((f) => f.source.kind === "agent");
  assert.equal(agent.length, 1);
  assert.deepEqual(agent[0].source, { kind: "agent", ref: CLAIMS_REF, index: 0 });
  const sqli = sarif.find((f) => f.source.index === 0);
  const secret = sarif.find((f) => f.source.index === 2);
  assert.deepEqual(sqli.source, { kind: "sarif", ref: IMPORT_SHA, index: 0 });
  assert.equal(sqli.title, "Semgrep OSS: r.sqli");
  assert.equal(sqli.class, "injection");
  assert.equal(sqli.priority, "p1");
  assert.equal(sqli.confidence, 6);
  assert.deepEqual(sqli.lines, [3, 4]);
  assert.equal(sqli.snippet, 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);');
  assert.equal(sqli.state, "CITATION_VERIFIED");
  assert.equal(sqli.occurrence, 0);
  assert.equal(sqli.requires_typed_citations, true);
  assert.equal(sqli.id, plainId("src/db.js", "injection", sqli.snippet, 0));
  assert.ok(!("description" in sqli), "inert text never becomes a finding field");
  // secret class from a scanner: keyed, context_redacted, private record
  assert.equal(secret.class, "secret");
  assert.equal(secret.cwe, "CWE-798");
  assert.equal(secret.context_redacted, "// <REDACTED:password-assign>");
  assert.equal(secret.sensitive, true);
  assert.equal(secret.id, keyedId(KEY, "src/db.js", "secret", `// ${SECRET}`, 0));
  assert.equal(out.citationRecords.length, 1);
  assert.equal(out.citationRecords[0].id, secret.id);
  assert.equal(out.citationRecords[0].record.match, true);
  assert.deepEqual(validate("claimed", out.claimed), []);
});

test("SARIF unlocated candidates never reach gate: copied into unlocated.json unchanged, in import order; a located record that fails the range rule is a counted rejection", () => {
  const unlocated = [
    { locator: { import_sha256: IMPORT_SHA, index: 1 }, reason: "no-location", tool: "semgrep", rule_id: "r.no-loc" },
    { locator: { import_sha256: IMPORT_SHA, index: 3 }, reason: "out-of-scope", tool: "semgrep", rule_id: "r.x" },
  ];
  const tooLong = sarifRecord(4, { lines: [1, 45], region: [1, 50] });
  const imp = sarifImport([sarifRecord(0, {}), tooLong], unlocated, [{ reason: "rule-mismatch", locator: { import_sha256: IMPORT_SHA, index: 2 } }]);
  const other = { ...sarifImport([], [{ locator: { import_sha256: "0".repeat(64), index: 0 }, reason: "out-of-scope" }]), kind: "doc", import_sha256: "0".repeat(64) };
  const { out } = run({ imports: [imp, other] });
  assert.deepEqual(out.unlocated.candidates, [other.unlocated[0], ...unlocated], "imports ordered by import_sha256 (0… before 8…), entries verbatim");
  assert.equal(out.claimed.findings.length, 1);
  assert.deepEqual(out.rejects.rejected, [{ reason: RANGE_TOO_LONG, locator: { import_sha256: IMPORT_SHA, index: 4 } }]);
  assert.deepEqual(out.gateResult.rejected_counts, { [RANGE_TOO_LONG]: 1 }, "the adapter's own rejections stay in the import record (TASK-023 folds them)");
  assert.deepEqual(validate("unlocated", out.unlocated), []);
});

test("argument checks: scope, key, resolveSide and rules are required; a claims entry needs name/ref/set", () => {
  const base = { scope: scopeArtifact(), scopePackets: [PACKET_SHA], claims: [], imports: [], resolveSide: () => null, key: KEY, rules: DEFAULT_RULES };
  assert.throws(() => gate({ ...base, scope: null }), /scope/);
  assert.throws(() => gate({ ...base, key: Buffer.alloc(0) }), /key/);
  assert.throws(() => gate({ ...base, resolveSide: 1 }), /resolveSide/);
  assert.throws(() => gate({ ...base, rules: {} }), /rules/);
  assert.throws(() => gate({ ...base, claims: [{ set: {} }] }), /claims\[0\]/);
  assert.throws(() => gate({ ...base, scopePackets: "x" }), /scopePackets/);
  assert.throws(() => gate({ ...base, imports: [{ kind: "sarif" }] }), /imports\[0\]/);
  assert.match(gate(base).gateResult.claimed_sha256, SHA256);
});
