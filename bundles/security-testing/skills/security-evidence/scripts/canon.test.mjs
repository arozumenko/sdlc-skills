import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonError,
  IntegrityError,
  artifactId,
  canonical,
  hmacHex,
  makeEnvelope,
  parseStrict,
  readArtifact,
  sha256Hex,
  writeArtifact,
} from "./canon.mjs";

const MODULE = fileURLToPath(new URL("./canon.mjs", import.meta.url));

const tmpDirs = [];
function tmp(prefix = "canon-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const NOW = () => "2026-09-16T10:00:00Z";
const HEAD = {
  schema_version: 1,
  kind: "scope",
  run_id: "0123456789ab-0001",
  engagement_id: "eng-1",
  key_id: "k0123456789ab",
  now: NOW,
};

function text(buf) {
  return Buffer.from(buf).toString("utf8");
}

// ---------------------------------------------------------------------------
// Module boundary (§5 TASK-002 contract: imports only redact.mjs and node:*)

test("imports only redact.mjs and node:*; no clock, no child process, no network", () => {
  const src = readFileSync(MODULE, "utf8");
  const specifiers = [...src.matchAll(/^\s*import\s+[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "no imports found — did the regex break?");
  for (const s of specifiers) {
    assert.ok(s.startsWith("node:") || s === "./redact.mjs", `unexpected import ${s}`);
  }
  assert.doesNotMatch(src, /\bimport\s*\(/, "no dynamic import()");
  assert.doesNotMatch(src, /\brequire\s*\(/, "no require()");
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1: no clock in canon.mjs");
  assert.doesNotMatch(src, /child_process|\bfetch\(|node:http|node:net|node:dns/, "G-6/G-14");
});

// ---------------------------------------------------------------------------
// parseStrict — the strict reader

test("duplicate key rejected on read", () => {
  assert.throws(() => parseStrict('{"a": 1, "a": 2}'), (e) => {
    assert.ok(e instanceof CanonError);
    assert.match(e.message, /duplicate key "a"/);
    return true;
  });
  // nested and with escapes that spell the same key
  assert.throws(() => parseStrict('{"x": {"k\\u0041": 1, "kA": 2}}'), (e) => e instanceof CanonError && /duplicate key "kA"/.test(e.message));
});

test("float rejected", () => {
  for (const src of ["1.5", "[1.0]", '{"a": 1e3}', '{"a": 2E-1}', "0.0", "-1.25", "9007199254740992", "-9007199254740992"]) {
    assert.throws(() => parseStrict(src), (e) => e instanceof CanonError && /float not allowed/.test(e.message), src);
  }
  for (const v of [1.5, -0.1, NaN, Infinity, 2 ** 53, -(2 ** 53), 1e300]) {
    assert.throws(() => canonical({ a: v }), (e) => e instanceof CanonError && /float not allowed/.test(e.message), String(v));
  }
});

test("parseStrict accepts the full JSON grammar for integers, strings, literals and whitespace", () => {
  const src = ' \n\t\r{"a": [1, -2, 0, true, false, null, "s\\n\\"\\\\\\/\\b\\f\\r\\t\\u00e9"], "b": {}, "c": [], "d": -0} \n';
  const v = parseStrict(src);
  assert.deepEqual(v, { a: [1, -2, 0, true, false, null, 's\n"\\/\b\f\r\té'], b: {}, c: [], d: 0 });
  assert.equal(Object.is(v.d, -0), false, "-0 normalised to 0");
  // surrogate pairs join into one code point
  assert.equal(parseStrict('"\\ud83d\\ude00"'), "😀");
  // bytes are accepted; invalid UTF-8 is not
  assert.deepEqual(parseStrict(Buffer.from('{"k": "v"}')), { k: "v" });
  assert.throws(() => parseStrict(Buffer.from([0x22, 0xff, 0x22])), (e) => e instanceof CanonError && /UTF-8/.test(e.message));
  // one leading BOM is ignored (RFC 8259 §8.1); anything else is an error
  assert.deepEqual(parseStrict("\uFEFF[1]"), [1]);
  assert.deepEqual(parseStrict(Buffer.from([0xef, 0xbb, 0xbf, 0x5b, 0x31, 0x5d])), [1]);
});

test("parseStrict rejects malformed input with a positioned CanonError", () => {
  const bad = [
    "",
    "[1,]",
    "{,}",
    '{"a" 1}',
    "01",
    "+1",
    "1 2",
    "[1] x",
    "'a'",
    '"\\x"',
    '"\\u12"',
    '"unterminated',
    "tru",
    "nul",
    "{a: 1}",
    '{"a": undefined}',
    "[1 2]",
    '"raw\ncontrol"',
    "\uFEFF\uFEFF1",
  ];
  for (const src of bad) {
    assert.throws(() => parseStrict(src), (e) => e instanceof CanonError && Number.isInteger(e.offset), JSON.stringify(src));
  }
  assert.throws(() => parseStrict(1), TypeError);
});

test("parseStrict bounds nesting depth", () => {
  const deep = "[".repeat(600) + "]".repeat(600);
  assert.throws(() => parseStrict(deep), (e) => e instanceof CanonError && /nesting/.test(e.message));
  assert.doesNotThrow(() => parseStrict("[".repeat(500) + "]".repeat(500)));
});

test("parseStrict keeps __proto__ as an own key", () => {
  const v = parseStrict('{"__proto__": {"polluted": true}, "a": 1}');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.ok(Object.hasOwn(v, "__proto__"));
  assert.equal({}.polluted, undefined);
  assert.equal(text(canonical(v)), '{"__proto__":{"polluted":true},"a":1}');
});

// ---------------------------------------------------------------------------
// canonical — the bytes behind every identity

test("non-NFC string normalised", () => {
  const nfd = "e\u0301"; // e + combining acute
  const nfc = "\u00e9";
  assert.notEqual(nfd, nfc);
  assert.equal(text(canonical(nfd)), JSON.stringify(nfc));
  assert.equal(text(canonical({ [nfd]: nfd })), `{"${nfc}":"${nfc}"}`);
  assert.equal(artifactId({ s: nfd }), artifactId({ s: nfc }));
  // two keys that meet after NFC are a duplicate, not a silent drop
  assert.throws(() => canonical({ [nfd]: 1, [nfc]: 2 }), (e) => e instanceof CanonError && /duplicate key/.test(e.message));
});

test("CRLF in input yields LF-only canonical bytes", () => {
  const src = '{\r\n  "b": "x\\r\\ny",\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}\r\n';
  const bytes = canonical(parseStrict(src));
  assert.equal(bytes.includes(0x0d), false, "no raw CR byte");
  assert.equal(bytes.includes(0x0a), false, "no raw LF byte either — newlines inside strings are escaped");
  assert.equal(text(bytes), '{"a":[1,2],"b":"x\\r\\ny"}');
  // the string content itself is untouched: CR inside a value is content, not layout
  assert.equal(parseStrict(bytes).b, "x\r\ny");
});

test("keys sorted bytewise not by locale", () => {
  // Locale (ICU) order would be: a, ä, B, z, _ ; bytewise UTF-8 order is: B, _, a, z, ä
  const v = { z: 1, ä: 2, a: 3, B: 4, _: 5 };
  assert.equal(text(canonical(v)), '{"B":4,"_":5,"a":3,"z":1,"ä":2}');
  // UTF-16 code-unit order (plain JS `<`) would put the astral key first; UTF-8 byte order puts U+FF5E first
  const astral = { "😀": 1, "～": 2 };
  assert.equal(text(canonical(astral)), '{"～":2,"😀":1}');
  assert.equal(["😀", "～"].sort()[0], "😀", "sanity: plain JS sort differs, so the test is meaningful");
  // nested objects are sorted too; arrays keep their order
  assert.equal(text(canonical({ b: { y: [3, { q: 1, p: 2 }], x: 1 }, a: [] })), '{"a":[],"b":{"x":1,"y":[3,{"p":2,"q":1}]}}');
});

test("canonical: no whitespace, \\u escapes only for control chars, non-ASCII raw", () => {
  const s = 'tab\t nl\n cr\r bs\b ff\f nul\u0000 esc\u001b del\u007f quote" back\\ \u00e9 \u{1F600} \u2028\u2029';
  const out = text(canonical(s));
  assert.equal(out, '"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 esc\\u001b del\u007f quote\\" back\\\\ \u00e9 \u{1F600} \u2028\u2029"');
  assert.equal(parseStrict(out), s);
  assert.equal(text(canonical({ a: 1, b: [true, null, "x"] })), '{"a":1,"b":[true,null,"x"]}');
  assert.equal(text(canonical(-0)), "0");
  assert.ok(Buffer.isBuffer(canonical({})));
});

test("canonical refuses undefined, functions, symbols, bigint and lone surrogates", () => {
  for (const [label, v] of [
    ["undefined value", { a: undefined }],
    ["undefined in array", [undefined]],
    ["function", { f() {} }],
    ["symbol", { s: Symbol("x") }],
    ["bigint", { n: 1n }],
    ["lone high surrogate", { s: "\ud83d" }],
    ["lone low surrogate", "\ude00x"],
  ]) {
    assert.throws(() => canonical(v), CanonError, label);
  }
  assert.throws(() => canonical({ a: { b: [undefined] } }), (e) => /\$\.a\.b\[0\]/.test(e.message));
});

test("canonical refuses non-plain objects (Buffer, Date, Map, class instance) and cycles", () => {
  class Thing {
    constructor() {
      this.x = 1;
    }
  }
  for (const [label, v] of [
    ["Buffer", { b: Buffer.from("secret") }],
    ["Uint8Array", { b: new Uint8Array(2) }],
    ["Date", { d: new Date(0) }],
    ["Map", { m: new Map() }],
    ["Set", { m: new Set() }],
    ["class instance", { t: new Thing() }],
    ["top-level Buffer", Buffer.from("x")],
  ]) {
    assert.throws(() => canonical(v), (e) => e instanceof CanonError && /non-plain/.test(e.message), label);
  }
  assert.equal(text(canonical(Object.assign(Object.create(null), { a: 1 }))), '{"a":1}', "null-prototype objects are plain");
  const cyc = { a: {} };
  cyc.a.self = cyc;
  assert.throws(() => canonical(cyc), (e) => e instanceof CanonError && /cycle/.test(e.message));
});

test("canonical output round-trips through parseStrict", () => {
  const v = { z: [1, { b: "ü", a: " " }], "": null, "k e y": true, n: -42 };
  const once = canonical(v);
  const twice = canonical(parseStrict(once));
  assert.equal(Buffer.compare(once, twice), 0);
});

// ---------------------------------------------------------------------------
// hashes

test("sha256Hex and hmacHex match node:crypto over the same bytes", () => {
  const buf = Buffer.from("payload bytes");
  assert.equal(sha256Hex(buf), createHash("sha256").update(buf).digest("hex"));
  const key = Buffer.alloc(32, 7);
  assert.equal(hmacHex(key, buf), createHmac("sha256", key).update(buf).digest("hex"));
  assert.notEqual(hmacHex(Buffer.alloc(32, 8), buf), hmacHex(key, buf));
  // bytes only: a string forces the caller to be explicit about encoding (G-2 review greps call sites)
  assert.throws(() => sha256Hex("text"), TypeError);
  assert.throws(() => hmacHex("key", buf), TypeError);
  assert.throws(() => hmacHex(Buffer.alloc(0), buf), TypeError);
  assert.throws(() => hmacHex(key, "text"), TypeError);
});

// ---------------------------------------------------------------------------
// envelopes and identity

test("scope identity independent of envelope", () => {
  const payload = { files: [{ path: "src/a.ts", side: "head", oid: "0".repeat(40), file_hmac: "1".repeat(64), lines: 10 }], ranges: { "src/a.ts": [[1, 10]] }, skipped: [] };
  const a = makeEnvelope(HEAD, payload);
  const b = makeEnvelope({ ...HEAD, run_id: "ffffffffffff-0009", now: () => "2031-01-01T00:00:00Z", key_id: "kfeedfeedfeed" }, payload);
  assert.equal(a.envelope.self_sha256, b.envelope.self_sha256);
  assert.equal(a.envelope.self_sha256, artifactId(payload));
  assert.equal(artifactId(payload), sha256Hex(canonical(payload)));
  assert.notEqual(a.envelope.created_at, b.envelope.created_at);
  assert.notEqual(a.envelope.run_id, b.envelope.run_id);
  // payload key order in memory does not matter either
  assert.equal(artifactId({ b: 1, a: 2 }), artifactId({ a: 2, b: 1 }));
  // and a payload change does
  assert.notEqual(artifactId(payload), artifactId({ ...payload, skipped: [{ path: "x", reason: "binary" }] }));
});

test("makeEnvelope without schema_version throws", () => {
  const { schema_version: _, ...noVersion } = HEAD;
  assert.throws(() => makeEnvelope(noVersion, {}), (e) => e instanceof CanonError && /schema_version/.test(e.message));
  assert.throws(() => makeEnvelope({ ...HEAD, schema_version: undefined }, {}), CanonError);
  assert.throws(() => makeEnvelope({ ...HEAD, schema_version: "1" }, {}), CanonError);
  assert.throws(() => makeEnvelope({ ...HEAD, schema_version: 1.5 }, {}), CanonError);
});

test("makeEnvelope validates every head field and the payload", () => {
  const env = makeEnvelope(HEAD, { a: 1 });
  assert.deepEqual(env, {
    envelope: {
      schema_version: 1,
      kind: "scope",
      run_id: HEAD.run_id,
      engagement_id: "eng-1",
      key_id: HEAD.key_id,
      created_at: "2026-09-16T10:00:00Z",
      self_sha256: artifactId({ a: 1 }),
    },
    payload: { a: 1 },
  });
  for (const [label, head] of [
    ["kind missing", { ...HEAD, kind: undefined }],
    ["kind empty", { ...HEAD, kind: "" }],
    ["run_id not a string", { ...HEAD, run_id: 1 }],
    ["engagement_id missing", { ...HEAD, engagement_id: undefined }],
    ["key_id not a string", { ...HEAD, key_id: null }],
    ["now not a function", { ...HEAD, now: "2026-09-16T10:00:00Z" }],
    ["now returns non-string", { ...HEAD, now: () => 1 }],
    ["unknown head key", { ...HEAD, extra: 1 }],
  ]) {
    assert.throws(() => makeEnvelope(head, { a: 1 }), CanonError, label);
  }
  assert.throws(() => makeEnvelope(HEAD, [1]), (e) => e instanceof CanonError && /payload/.test(e.message));
  assert.throws(() => makeEnvelope(HEAD, { f: 1.5 }), (e) => e instanceof CanonError && /float/.test(e.message));
});

// ---------------------------------------------------------------------------
// writeArtifact / readArtifact

test("writeArtifact redacts password=1234 in a nested payload string and self_sha256 is over the redacted payload", () => {
  const dir = tmp();
  const path = join(dir, "scope.json");
  const payload = { results: [{ message: { text: "found password=1234 in config" } }], reason: "password=1234 leaked" };
  const art = makeEnvelope(HEAD, payload);
  const before = art.envelope.self_sha256;
  const written = writeArtifact(path, art);
  const disk = readFileSync(path, "utf8");
  assert.equal(disk.includes("=1234"), false, "no original bytes on disk");
  assert.equal(disk.includes("password="), false, "no original bytes on disk");
  assert.match(disk, /<REDACTED:password-assign>/);
  assert.notEqual(written.envelope.self_sha256, before, "identity is over the redacted payload, not the input");
  assert.equal(written.envelope.self_sha256, artifactId(written.payload));
  assert.equal(written.payload.results[0].message.text, "found <REDACTED:password-assign> in config");
  assert.equal(art.payload.results[0].message.text, "found password=1234 in config", "caller's object is not mutated");
  // the file is the canonical bytes of {envelope, payload} plus one LF
  assert.equal(disk, text(canonical(written)) + "\n");
  // and it reads back verified
  const back = readArtifact(path, { kind: "scope" });
  assert.deepEqual(back, written);
  assert.deepEqual(readdirSync(dir), ["scope.json"], "no tmp file left behind");
});

test("prered:true skips redaction", () => {
  const dir = tmp();
  const path = join(dir, "import.json");
  const payload = { note: "password=1234 already handled upstream" };
  const art = makeEnvelope({ ...HEAD, kind: "import" }, payload);
  const written = writeArtifact(path, art, { prered: true });
  assert.equal(written.payload, payload, "payload passed through by reference");
  assert.equal(written.envelope.self_sha256, art.envelope.self_sha256);
  assert.match(readFileSync(path, "utf8"), /password=1234/);
  assert.deepEqual(readArtifact(path).payload, payload);
});

test("writeArtifact without prered: nothing matched ⇒ payload by reference, self_sha256 unchanged", () => {
  const dir = tmp();
  const payload = { clean: "nothing to see", n: 3 };
  const art = makeEnvelope(HEAD, payload);
  const written = writeArtifact(join(dir, "a.json"), art);
  assert.equal(written.payload, payload);
  assert.equal(written.envelope.self_sha256, art.envelope.self_sha256);
});

test("writeArtifact redacts the envelope too (G-4) and never trusts a stale self_sha256", () => {
  const dir = tmp();
  const path = join(dir, "e.json");
  const art = makeEnvelope({ ...HEAD, engagement_id: "eng password=hunter2" }, { a: 1 });
  art.envelope.self_sha256 = "0".repeat(64);
  const written = writeArtifact(path, art);
  assert.equal(written.envelope.engagement_id, "eng <REDACTED:password-assign>");
  assert.equal(written.envelope.self_sha256, artifactId({ a: 1 }));
  assert.equal(readFileSync(path, "utf8").includes("hunter2"), false);
  assert.deepEqual(readArtifact(path), written);
});

test("writeArtifact throws before persisting when redactDeep throws (Buffer / class instance)", () => {
  const dir = tmp();
  class Blob {
    constructor() {
      this.secret = "password=1234";
    }
  }
  for (const [label, bad] of [
    ["Buffer", { blob: Buffer.from("password=1234") }],
    ["class instance", { blob: new Blob() }],
    ["Date", { when: new Date(0) }],
  ]) {
    const path = join(dir, `${label}.json`);
    const art = { envelope: { ...HEAD, now: undefined, created_at: NOW(), self_sha256: "0".repeat(64) }, payload: bad };
    delete art.envelope.now;
    assert.throws(() => writeArtifact(path, art), TypeError, label);
    assert.equal(existsSync(path), false, `${label}: nothing persisted`);
  }
  assert.deepEqual(readdirSync(dir), [], "no tmp files left behind");
});

test("canonical() refuses non-plain objects even when prered:true, so writeArtifact persists nothing", () => {
  const dir = tmp();
  class Blob {
    constructor() {
      this.secret = "password=1234";
    }
  }
  for (const [label, bad] of [
    ["Buffer", { blob: Buffer.from("password=1234") }],
    ["class instance", { blob: new Blob() }],
    ["Uint8Array", { blob: new Uint8Array([1, 2]) }],
  ]) {
    const path = join(dir, `${label}.json`);
    const art = { envelope: { schema_version: 1, kind: "scope", run_id: "r", engagement_id: "e", key_id: "k", created_at: NOW(), self_sha256: "0".repeat(64) }, payload: bad };
    assert.throws(() => writeArtifact(path, art, { prered: true }), (e) => e instanceof CanonError && /non-plain/.test(e.message), label);
    assert.equal(existsSync(path), false, `${label}: nothing persisted`);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test("writeArtifact validates shape: floats, undefined, missing envelope fields, extra keys", () => {
  const dir = tmp();
  const ok = makeEnvelope(HEAD, { a: 1 });
  for (const [label, art] of [
    ["float", { ...ok, payload: { a: 1.5 } }],
    ["undefined", { ...ok, payload: { a: undefined } }],
    ["payload not an object", { ...ok, payload: [1] }],
    ["missing payload", { envelope: ok.envelope }],
    ["missing envelope", { payload: { a: 1 } }],
    ["extra top-level key", { ...ok, extra: 1 }],
    ["envelope missing kind", { ...ok, envelope: { ...ok.envelope, kind: undefined } }],
    ["envelope schema_version float", { ...ok, envelope: { ...ok.envelope, schema_version: 1.5 } }],
    ["envelope created_at not a string", { ...ok, envelope: { ...ok.envelope, created_at: 1 } }],
    ["envelope extra key", { ...ok, envelope: { ...ok.envelope, extra: true } }],
    ["not an object", "nope"],
  ]) {
    const path = join(dir, "x.json");
    assert.throws(() => writeArtifact(path, art), CanonError, label);
    assert.equal(existsSync(path), false, `${label}: nothing persisted`);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test("writeArtifact replaces an existing file atomically (tmp+rename) and creates the parent dir", () => {
  const dir = tmp();
  const path = join(dir, "nested", "deeper", "a.json");
  writeArtifact(path, makeEnvelope(HEAD, { v: 1 }));
  writeArtifact(path, makeEnvelope(HEAD, { v: 2 }));
  assert.equal(readArtifact(path).payload.v, 2);
  assert.deepEqual(readdirSync(join(dir, "nested", "deeper")), ["a.json"]);
});

test("readArtifact throws IntegrityError on tampered payload", () => {
  const dir = tmp();
  const path = join(dir, "gate-result.json");
  writeArtifact(path, makeEnvelope({ ...HEAD, kind: "gate-result" }, { accepted: ["a".repeat(64)], scope_sha256: "b".repeat(64) }));
  const original = readFileSync(path, "utf8");
  // flip one character inside the payload; the envelope (and its self_sha256) stays as written
  const tampered = original.replace('"scope_sha256":"bbbb', '"scope_sha256":"cbbb');
  assert.notEqual(tampered, original);
  writeFileSync(path, tampered);
  assert.throws(() => readArtifact(path), (e) => {
    assert.ok(e instanceof IntegrityError);
    assert.equal(e.path, path);
    assert.match(e.message, /self_sha256/);
    assert.match(e.expected, /^[0-9a-f]{64}$/);
    assert.match(e.actual, /^[0-9a-f]{64}$/);
    assert.notEqual(e.expected, e.actual);
    return true;
  });
  // a tampered envelope hash is the same failure
  writeFileSync(path, original.replace(/"self_sha256":"[0-9a-f]{64}"/, `"self_sha256":"${"0".repeat(64)}"`));
  assert.throws(() => readArtifact(path), IntegrityError);
  // reformatting (whitespace, key order) is NOT tampering: identity is over canonical bytes
  const obj = parseStrict(original);
  writeFileSync(path, JSON.stringify({ payload: obj.payload, envelope: obj.envelope }, null, 2) + "\r\n");
  assert.deepEqual(readArtifact(path), obj);
});

test("readArtifact: kind mismatch, bad shape, malformed JSON, missing file", () => {
  const dir = tmp();
  const path = join(dir, "a.json");
  writeArtifact(path, makeEnvelope(HEAD, { a: 1 }));
  assert.throws(() => readArtifact(path, { kind: "packet" }), (e) => e instanceof IntegrityError && /kind/.test(e.message) && e.path === path);
  assert.doesNotThrow(() => readArtifact(path, { kind: "scope" }));
  assert.doesNotThrow(() => readArtifact(path, {}));

  writeFileSync(path, '{"payload": {"a": 1}}');
  assert.throws(() => readArtifact(path), (e) => e instanceof IntegrityError && /envelope/.test(e.message));
  writeFileSync(path, '{"envelope": {"kind": "scope"}, "payload": {"a": 1}}');
  assert.throws(() => readArtifact(path), IntegrityError);
  const arrayEnvelope = { ...makeEnvelope(HEAD, { a: 1 }).envelope, self_sha256: sha256Hex(canonical([1])) };
  writeFileSync(path, `{"envelope": ${JSON.stringify(arrayEnvelope)}, "payload": [1]}`);
  assert.throws(() => readArtifact(path), (e) => e instanceof IntegrityError && /payload/.test(e.message));
  writeFileSync(path, '{"envelope": 1, "payload": {}, "x": 2}');
  assert.throws(() => readArtifact(path), IntegrityError);

  writeFileSync(path, '{"envelope": {"a": 1, "a": 2}, "payload": {}}');
  assert.throws(() => readArtifact(path), (e) => e instanceof CanonError && /duplicate key/.test(e.message) && e.path === path);
  writeFileSync(path, "{not json");
  assert.throws(() => readArtifact(path), (e) => e instanceof CanonError && e.path === path);
  writeFileSync(path, '{"envelope": {}, "payload": {"n": 1.5}}');
  assert.throws(() => readArtifact(path), (e) => e instanceof CanonError && /float/.test(e.message));

  assert.throws(() => readArtifact(join(dir, "missing.json")), (e) => e.code === "ENOENT");
});

test("error classes carry names and are instances of Error", () => {
  const c = new CanonError("x", { offset: 3, path: "/p" });
  assert.equal(c.name, "CanonError");
  assert.equal(c.offset, 3);
  assert.equal(c.path, "/p");
  assert.ok(c instanceof Error);
  const i = new IntegrityError("/p", "reason", { expected: "a", actual: "b" });
  assert.equal(i.name, "IntegrityError");
  assert.equal(i.path, "/p");
  assert.match(i.message, /reason/);
  assert.match(i.message, /\/p/);
  assert.equal(i.expected, "a");
  assert.equal(i.actual, "b");
  assert.ok(i instanceof Error);
});
