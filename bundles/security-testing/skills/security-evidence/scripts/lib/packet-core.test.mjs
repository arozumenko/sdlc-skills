// TASK-057 — lib/packet-core.mjs: the pure packet builder (plan §3.3 row
// `lib/packet-core.mjs`, §5 TASK-057; spec §6.1 `packet.json` preimage, §6.4
// P1; G-9 pure core). `buildPacket` is pure given `resolveSide`: every byte
// it hashes comes through that callback, so these tests feed it fixed
// buffers and never touch git or the file system.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, hmacHex, parseStrict, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES } from "../redact.mjs";
import { rangeBytes } from "./cite-core.mjs";
import { PACKET_KINDS, POLICY_PATH, buildPacket, policyId, rangeHmac } from "./packet-core.mjs";
import { validate } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = Buffer.from("0123456789abcdef0123456789abcdef");
const OTHER_KEY = Buffer.from("fedcba9876543210fedcba9876543210");
const OID = "1".repeat(40);
const OID2 = "2".repeat(40);
const SNAP = "a".repeat(64);
const POLICY = Object.freeze({ version: 1, max_range: 40, sides: ["base", "head", "snapshot"], typed_citation_rule: "context-allowed-outside-admitted", redaction_version: 1 });

/** A CRLF file with a blank line and a BOM-free UTF-8 body: raw bytes ≠ normalised text. */
const APP = Buffer.from("const a = 1;\r\n\r\n  \r\nconst b = 2;\r\nconst c = 3;\n", "utf8"); // 3 normalised lines
const DB = Buffer.from("select 1;\nselect 2;\nselect 3;\nselect 4;\n", "utf8"); // 4 normalised lines

/** A resolveSide over an in-memory table keyed `side:path`, recording every call. */
function tableResolver(table) {
  const calls = [];
  const fn = ({ path, side }) => {
    calls.push({ path, side });
    const bytes = table[`${side}:${path}`];
    if (bytes === undefined) throw new Error(`no fixture bytes for ${side}:${path}`);
    return bytes;
  };
  return { fn, calls };
}

const scopeFiles = () => [
  { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 3]] },
  { path: "src/db.js", side: "head", oid: OID2, ranges: [[1, 4]] },
];

// --- import guard (G-9) --------------------------------------------------------

test("pure: packet-core.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "packet-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `packet-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../canon.mjs", "./cite-core.mjs", "node:path", "node:url"]);
});

test("constants: the two packet kinds; POLICY_PATH names references/packet-policy.v1.json, which validates and carries the live redaction_version", () => {
  assert.deepEqual([...PACKET_KINDS], ["scope", "subject"]);
  assert.ok(Object.isFrozen(PACKET_KINDS));
  assert.equal(POLICY_PATH, resolve(HERE, "..", "..", "references", "packet-policy.v1.json"));
  const policy = parseStrict(readFileSync(POLICY_PATH));
  assert.deepEqual(validate("packet-policy.v1", policy), []);
  assert.equal(policy.redaction_version, DEFAULT_RULES.redaction_version, "the shipped policy names the redaction rules version in force");
  assert.deepEqual(policy.sides, ["base", "head", "snapshot"]);
});

// --- buildPacket ----------------------------------------------------------------

test("pure given resolveSide: deterministic output, one resolve per file, inputs untouched, no clock or path in the payload", () => {
  const { fn, calls } = tableResolver({ "head:src/app.js": APP, "head:src/db.js": DB });
  const files = scopeFiles();
  const filesBefore = structuredClone(files);
  const input = { kind: "scope", subject_ids: [], files, resolveSide: fn, key: KEY, policy: POLICY };
  const a = buildPacket(input);
  const b = buildPacket(input);
  assert.deepEqual(a, b, "same input twice ⇒ deep-equal payload");
  assert.equal(sha256Hex(canonical(a)), sha256Hex(canonical(b)));
  assert.deepEqual(files, filesBefore, "files[] is not mutated");
  assert.deepEqual(calls.slice(0, 2), [
    { path: "src/app.js", side: "head" },
    { path: "src/db.js", side: "head" },
  ]);
  assert.equal(calls.length, 4, "one resolve per file per build");
  assert.deepEqual(Object.keys(a).sort(), ["files", "kind", "policy_sha256", "subject_ids"]);
  assert.deepEqual(validate("packet", a), []);
  assert.equal(a.kind, "scope");
  assert.deepEqual(a.subject_ids, []);
  assert.deepEqual(
    a.files.map((f) => Object.keys(f).sort()),
    [
      ["oid", "path", "range_hmac", "ranges", "side"],
      ["oid", "path", "range_hmac", "ranges", "side"],
    ],
  );
  assert.ok(Object.isFrozen(a) === false, "a plain payload the caller may envelope");
});

test("range_hmac = HMAC_key(concat of rangeBytes for each range) over RAW bytes: CRLF and blank lines are in the preimage; a different key ⇒ different hmac", () => {
  const { fn } = tableResolver({ "head:src/app.js": APP, "head:src/db.js": DB });
  const out = buildPacket({ kind: "scope", subject_ids: [], files: scopeFiles(), resolveSide: fn, key: KEY, policy: POLICY });
  const app = out.files.find((f) => f.path === "src/app.js");
  const db = out.files.find((f) => f.path === "src/db.js");
  assert.equal(app.range_hmac, hmacHex(KEY, rangeBytes(APP, 1, 3)));
  assert.equal(app.range_hmac, hmacHex(KEY, APP), "the whole-file range of a CRLF file hashes every raw byte, blank lines included");
  assert.equal(db.range_hmac, hmacHex(KEY, DB));
  assert.notEqual(app.range_hmac, hmacHex(KEY, Buffer.from("const a = 1;\nconst b = 2;\nconst c = 3;\n")), "not the normalised text");
  assert.equal(rangeHmac(KEY, APP, [[1, 3]]), app.range_hmac);

  // multi-range: the preimage is the concatenation in (sorted) range order
  const multi = buildPacket({ kind: "subject", subject_ids: ["f".repeat(64)], files: [{ path: "src/db.js", side: "head", oid: OID2, ranges: [[3, 4], [1, 1]] }], resolveSide: fn, key: KEY, policy: POLICY });
  assert.deepEqual(multi.files[0].ranges, [[1, 1], [3, 4]], "ranges are sorted by start");
  assert.equal(multi.files[0].range_hmac, hmacHex(KEY, Buffer.concat([rangeBytes(DB, 1, 1), rangeBytes(DB, 3, 4)])));
  assert.equal(multi.files[0].range_hmac, hmacHex(KEY, Buffer.from("select 1;\nselect 3;\nselect 4;\n")));

  const other = buildPacket({ kind: "scope", subject_ids: [], files: scopeFiles(), resolveSide: fn, key: OTHER_KEY, policy: POLICY });
  assert.notEqual(other.files[0].range_hmac, app.range_hmac);
  // G-2: nothing in the payload is a plain sha256 over content bytes
  for (const f of out.files) {
    assert.notEqual(f.range_hmac, sha256Hex(APP));
    assert.notEqual(f.range_hmac, sha256Hex(DB));
  }
});

test("empty ranges (an empty file) ⇒ range_hmac over zero bytes; the file still needs to resolve", () => {
  const { fn, calls } = tableResolver({ "head:src/empty.js": Buffer.alloc(0) });
  const out = buildPacket({ kind: "scope", subject_ids: [], files: [{ path: "src/empty.js", side: "head", oid: OID, ranges: [] }], resolveSide: fn, key: KEY, policy: POLICY });
  assert.deepEqual(out.files, [{ path: "src/empty.js", side: "head", oid: OID, ranges: [], range_hmac: hmacHex(KEY, Buffer.alloc(0)) }]);
  assert.equal(calls.length, 1);
});

test("policy_sha256 = sha256(canonical(policy)): key order is not identity; a different policy is a different packet", () => {
  const { fn } = tableResolver({ "head:src/app.js": APP, "head:src/db.js": DB });
  const reordered = { redaction_version: 1, typed_citation_rule: "context-allowed-outside-admitted", sides: ["base", "head", "snapshot"], max_range: 40, version: 1 };
  const a = buildPacket({ kind: "scope", subject_ids: [], files: scopeFiles(), resolveSide: fn, key: KEY, policy: POLICY });
  const b = buildPacket({ kind: "scope", subject_ids: [], files: scopeFiles(), resolveSide: fn, key: KEY, policy: reordered });
  assert.equal(a.policy_sha256, sha256Hex(canonical(POLICY)));
  assert.equal(a.policy_sha256, policyId(POLICY));
  assert.deepEqual(a, b);
  const c = buildPacket({ kind: "scope", subject_ids: [], files: scopeFiles(), resolveSide: fn, key: KEY, policy: { ...POLICY, redaction_version: 2 } });
  assert.notEqual(c.policy_sha256, a.policy_sha256);
  assert.throws(() => policyId(null), /policy/);
  assert.throws(() => policyId({ version: 1.5 }), /float|integer|1\.5/);
});

test("canonical order: files sorted by (path bytes, side), ranges sorted and exact duplicates dropped — identity independent of caller order", () => {
  const { fn } = tableResolver({ "head:src/app.js": APP, "head:src/db.js": DB, "base:src/db.js": DB, "snapshot:src/z.js": APP });
  const forward = buildPacket({
    kind: "subject",
    subject_ids: ["s1"],
    files: [
      { path: "src/z.js", side: "snapshot", oid: SNAP, ranges: [[1, 2]] },
      { path: "src/db.js", side: "head", oid: OID2, ranges: [[2, 3], [1, 1], [2, 3]] },
      { path: "src/db.js", side: "base", oid: OID2, ranges: [[1, 4]] },
      { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 1]] },
    ],
    resolveSide: fn,
    key: KEY,
    policy: POLICY,
  });
  const reversed = buildPacket({
    kind: "subject",
    subject_ids: ["s1"],
    files: [
      { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 1]] },
      { path: "src/db.js", side: "base", oid: OID2, ranges: [[1, 4]] },
      { path: "src/db.js", side: "head", oid: OID2, ranges: [[1, 1], [2, 3]] },
      { path: "src/z.js", side: "snapshot", oid: SNAP, ranges: [[1, 2]] },
    ],
    resolveSide: fn,
    key: KEY,
    policy: POLICY,
  });
  assert.deepEqual(forward, reversed);
  assert.deepEqual(
    forward.files.map((f) => [f.path, f.side, f.ranges]),
    [
      ["src/app.js", "head", [[1, 1]]],
      ["src/db.js", "base", [[1, 4]]],
      ["src/db.js", "head", [[1, 1], [2, 3]]],
      ["src/z.js", "snapshot", [[1, 2]]],
    ],
  );
  assert.deepEqual(validate("packet", forward), []);
});

test("subject_ids: scope ⇒ exactly empty; subject ⇒ at least one unique non-empty string, argv order kept", () => {
  const { fn } = tableResolver({ "head:src/app.js": APP });
  const file = { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 3]] };
  const base = { files: [file], resolveSide: fn, key: KEY, policy: POLICY };
  assert.throws(() => buildPacket({ ...base, kind: "scope", subject_ids: ["x"] }), /scope.*subject_ids|subject_ids.*scope/);
  assert.throws(() => buildPacket({ ...base, kind: "subject", subject_ids: [] }), /subject.*at least one|at least one/);
  assert.throws(() => buildPacket({ ...base, kind: "subject", subject_ids: ["a", "a"] }), /duplicate/);
  assert.throws(() => buildPacket({ ...base, kind: "subject", subject_ids: [""] }), /non-empty/);
  assert.throws(() => buildPacket({ ...base, kind: "subject", subject_ids: "a" }), /array/);
  assert.throws(() => buildPacket({ ...base, kind: "review", subject_ids: [] }), /kind/);
  const out = buildPacket({ ...base, kind: "subject", subject_ids: ["zeta", "alpha"] });
  assert.deepEqual(out.subject_ids, ["zeta", "alpha"], "argv order, not sorted (TASK-021 owns the order)");
  assert.deepEqual(validate("packet", out), []);
});

test("shape checks are TypeErrors before any resolve: files, path, side, oid, ranges, key, resolveSide, policy", () => {
  const { fn, calls } = tableResolver({ "head:src/app.js": APP });
  const ok = { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 3]] };
  const base = { kind: "scope", subject_ids: [], files: [ok], resolveSide: fn, key: KEY, policy: POLICY };
  const bad = (patch, re) => {
    const before = calls.length;
    assert.throws(() => buildPacket({ ...base, ...patch }), re);
    assert.equal(calls.length, before, "no resolve happened");
  };
  bad({ files: "nope" }, /files/);
  bad({ files: [{ ...ok, path: "" }] }, /path/);
  bad({ files: [{ ...ok, path: "../x" }] }, /path/);
  bad({ files: [{ ...ok, side: "working" }] }, /side/);
  bad({ files: [{ ...ok, oid: "abc" }] }, /oid/);
  bad({ files: [{ ...ok, oid: "A".repeat(40) }] }, /oid/);
  bad({ files: [{ ...ok, ranges: [[0, 1]] }] }, /range/);
  bad({ files: [{ ...ok, ranges: [[2, 1]] }] }, /range/);
  bad({ files: [{ ...ok, ranges: [[1, 1.5]] }] }, /range/);
  bad({ files: [{ ...ok, ranges: [[1]] }] }, /range/);
  bad({ files: [{ ...ok, ranges: "1-3" }] }, /ranges/);
  bad({ files: [ok, { ...ok }] }, /duplicate/);
  bad({ files: [{ ...ok, extra: 1 }] }, /unknown|extra/);
  bad({ key: Buffer.alloc(0) }, /key/);
  bad({ key: "secret" }, /key/);
  bad({ resolveSide: null }, /resolveSide/);
  bad({ policy: null }, /policy/);
  bad({ policy: [] }, /policy/);
  // a resolver that hands back something other than bytes, or a range past the end, is refused after the resolve
  assert.throws(() => buildPacket({ ...base, resolveSide: () => "text" }), /resolveSide.*Buffer|bytes/);
  assert.throws(() => buildPacket({ ...base, files: [{ ...ok, ranges: [[1, 4]] }] }), RangeError);
  // a resolver failure propagates untouched, so cmd-packet can map the cite errors
  class Boom extends Error {}
  assert.throws(
    () =>
      buildPacket({
        ...base,
        resolveSide: () => {
          throw new Boom("x");
        },
      }),
    Boom,
  );
});
