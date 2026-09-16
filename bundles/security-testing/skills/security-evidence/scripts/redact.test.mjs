import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSES,
  DEFAULT_RULES,
  RULES_PATH,
  RulesError,
  loadRules,
  matches,
  redactDeep,
  redactString,
} from "./redact.mjs";

const MODULE = fileURLToPath(new URL("./redact.mjs", import.meta.url));

const TEN_CLASSES = [
  "aws-key",
  "gcp-key",
  "azure-key",
  "jwt",
  "pem-block",
  "password-assign",
  "token-assign",
  "secret-assign",
  "bearer",
  "high-entropy-assign",
];

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AAAAAAAAAAAAAAAAAAAA",
  "-----END RSA PRIVATE KEY-----",
].join("\n");
const AWS = "AKIAIOSFODNN7EXAMPLE";

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const tmpDirs = [];
function writeRulesFixture(obj) {
  const dir = mkdtempSync(join(tmpdir(), "redact-rules-"));
  tmpDirs.push(dir);
  const p = join(dir, "rules.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Rules file

test("rules file carries redaction_version", () => {
  const raw = JSON.parse(readFileSync(RULES_PATH, "utf8"));
  assert.equal(raw.redaction_version, 1);
  assert.ok(Number.isSafeInteger(raw.redaction_version));
  assert.equal(DEFAULT_RULES.redaction_version, raw.redaction_version);
  assert.ok(Array.isArray(raw.rules));
  assert.deepEqual(Object.keys(raw).sort(), ["redaction_version", "rules"]);
  for (const rule of raw.rules) {
    assert.deepEqual(Object.keys(rule).sort(), ["class", "flags", "pattern", "replacement"]);
    assert.equal(typeof rule.pattern, "string");
    assert.equal(typeof rule.flags, "string");
    assert.equal(rule.replacement, `<REDACTED:${rule.class}>`);
  }
});

test("every one of the ten classes has at least one rule and no other class appears", () => {
  assert.deepEqual([...CLASSES], TEN_CLASSES);
  const present = new Set(DEFAULT_RULES.rules.map((r) => r.class));
  for (const c of TEN_CLASSES) assert.ok(present.has(c), `missing rule for ${c}`);
  for (const c of present) assert.ok(TEN_CLASSES.includes(c), `unknown class ${c}`);
});

test("loadRules(path) returns the same shape as DEFAULT_RULES and compiles every pattern", () => {
  const rules = loadRules(RULES_PATH);
  assert.equal(rules.redaction_version, DEFAULT_RULES.redaction_version);
  assert.equal(rules.rules.length, DEFAULT_RULES.rules.length);
  for (const r of rules.rules) {
    assert.ok(r.re instanceof RegExp);
    assert.ok(r.re.global, `rule ${r.class} must be global`);
  }
  assert.equal(loadRules().redaction_version, DEFAULT_RULES.redaction_version);
});

test("loadRules rejects an unknown class, a bad pattern, a bad replacement and a bad version", () => {
  const ok = { class: "jwt", pattern: "x", flags: "g", replacement: "<REDACTED:jwt>" };
  const bad = [
    { redaction_version: 1, rules: [{ ...ok, class: "ssn" }] },
    { redaction_version: 1, rules: [{ ...ok, pattern: "(" }] },
    { redaction_version: 1, rules: [{ ...ok, replacement: "password=1234" }] },
    { redaction_version: 1, rules: [{ ...ok, flags: 7 }] },
    { redaction_version: 0, rules: [ok] },
    { redaction_version: 1.5, rules: [ok] },
    { redaction_version: "1", rules: [ok] },
    { redaction_version: 1, rules: [] },
    { redaction_version: 1 },
    [],
  ];
  for (const fixture of bad) {
    const p = writeRulesFixture(fixture);
    assert.throws(() => loadRules(p), RulesError, JSON.stringify(fixture));
  }
  // A well-formed file with a non-global flag string still loads; `g` is added.
  const p = writeRulesFixture({ redaction_version: 3, rules: [{ ...ok, flags: "i" }] });
  const r = loadRules(p);
  assert.equal(r.redaction_version, 3);
  assert.ok(r.rules[0].re.global);
  assert.ok(r.rules[0].re.ignoreCase);
});

// ---------------------------------------------------------------------------
// redactString / matches

test("matches() true for password=1234 and false for benign text", () => {
  assert.equal(matches("password=1234", DEFAULT_RULES), true);
  assert.equal(matches("the config sets password=1234 on boot", DEFAULT_RULES), true);
  assert.equal(matches("benign text about passwords and tokens", DEFAULT_RULES), false);
  assert.equal(matches("", DEFAULT_RULES), false);
  assert.equal(matches("src/auth/login.ts:42 uses bcrypt", DEFAULT_RULES), false);
});

test("matches() is stable across repeated calls (no lastIndex leakage from global regexes)", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(matches("password=1234", DEFAULT_RULES), true, `call ${i}`);
    assert.equal(redactString("password=1234", DEFAULT_RULES).text, "<REDACTED:password-assign>", `call ${i}`);
  }
});

test("matches() scans a Buffer as UTF-8 with latin1 fallback", () => {
  assert.equal(matches(Buffer.from("x\npassword=1234\n", "utf8"), DEFAULT_RULES), true);
  assert.equal(matches(Buffer.from("nothing here", "utf8"), DEFAULT_RULES), false);
  // Invalid UTF-8 bytes followed by a secret: must fall back to latin1, not throw.
  const bad = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("password=1234")]);
  assert.equal(matches(bad, DEFAULT_RULES), true);
  assert.equal(matches(new Uint8Array(Buffer.from("secret=abc")), DEFAULT_RULES), true);
});

test("password=1234 matches the password-assign class and is replaced whole", () => {
  const { text, hits } = redactString("password=1234", DEFAULT_RULES);
  assert.equal(text, "<REDACTED:password-assign>");
  assert.deepEqual(hits, [{ class: "password-assign", count: 1 }]);
});

test("redactString reports hits per class in rule order and leaves benign text alone", () => {
  const benign = "no secrets here";
  const r = redactString(benign, DEFAULT_RULES);
  assert.equal(r.text, benign);
  assert.deepEqual(r.hits, []);
  const multi = redactString(`a ${AWS} b password=x c PASSWORD: "y" d`, DEFAULT_RULES);
  assert.equal(multi.text, "a <REDACTED:aws-key> b <REDACTED:password-assign> c <REDACTED:password-assign> d");
  assert.deepEqual(multi.hits, [
    { class: "aws-key", count: 1 },
    { class: "password-assign", count: 2 },
  ]);
});

test("redactString accepts a Buffer and rejects non-text input", () => {
  assert.equal(redactString(Buffer.from("password=1234"), DEFAULT_RULES).text, "<REDACTED:password-assign>");
  assert.throws(() => redactString(42, DEFAULT_RULES), TypeError);
  assert.throws(() => redactString(null, DEFAULT_RULES), TypeError);
});

test("JWT, PEM block, bearer header, AWS key shape redacted", () => {
  const cases = [
    [`token ${JWT} here`, "jwt", JWT],
    [`cert:\n${PEM}\nend`, "pem-block", PEM],
    ["Authorization: Bearer AbCdEf0123456789GhIjKlMnOpQrStUv", "bearer", "AbCdEf0123456789GhIjKlMnOpQrStUv"],
    [`aws_key ${AWS} in env`, "aws-key", AWS],
  ];
  for (const [input, cls, secret] of cases) {
    const { text, hits } = redactString(input, DEFAULT_RULES);
    assert.equal(countOccurrences(text, secret), 0, `${cls}: original bytes survived: ${text}`);
    assert.ok(text.includes(`<REDACTED:${cls}>`), `${cls}: expected marker in ${text}`);
    assert.ok(hits.some((h) => h.class === cls), `${cls}: expected hit`);
  }
  // A truncated PEM block (no END line) is redacted to the end of the text.
  const truncated = redactString("x\n-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIBkA\nMHQCAQEEIBkA", DEFAULT_RULES);
  assert.equal(truncated.text, "x\n<REDACTED:pem-block>");
});

test("GCP key, Azure key, token/secret assignments and high-entropy assignments redacted", () => {
  const gcp = "AIzaSyA-1234567890abcdefghijklmnopqrstu"; // 39 chars: AIza + 35
  const azure = "AccountKey=" + "Q".repeat(40) + "abc123XYZ+/" + "R".repeat(35) + "==";
  const entropy = "sK9v2Lq8mZ1xR4tY7wB0nC3jH6pF5dG2aE8uV1iO";
  const cases = [
    [`key=${gcp}`, "gcp-key", gcp],
    [`DefaultEndpointsProtocol=https;${azure};`, "azure-key", azure],
    ["GITHUB_TOKEN=ghp_abc123", "token-assign", "ghp_abc123"],
    ['"api_key": "abc-123"', "token-assign", "abc-123"],
    ["client_secret: s3cr3t", "secret-assign", "s3cr3t"],
    ["AWS_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "secret-assign", "wJalrXUtnFEMI"],
    [`signing_key = "${entropy}"`, "high-entropy-assign", entropy],
  ];
  for (const [input, cls, secret] of cases) {
    const { text, hits } = redactString(input, DEFAULT_RULES);
    assert.equal(countOccurrences(text, secret), 0, `${cls}: original bytes survived: ${text}`);
    assert.ok(hits.some((h) => h.class === cls), `${cls}: expected hit, got ${JSON.stringify(hits)} for ${text}`);
  }
});

test("hex digests, oids and result tokens are not redacted (stdout survives redaction)", () => {
  const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const oid = "9fceb02d0ae598e95dc970b74767f19372d61af8";
  const lines = [
    `WROTE .agents/security-testing/runs/${oid.slice(0, 12)}-0001/scope.json sha256=${sha}`,
    `RUN ${oid.slice(0, 12)}-0001 seq=1 kind=assessment base=${oid} head=${oid}`,
    `VERDICT FIXED finding=F-1 base=${oid} head=${oid} tested_tree=${sha} verify=${sha}`,
    `IMPORT sarif import_sha256=${sha} records=3 unlocated=0 rejected=0`,
    "COVERAGE examined=12 skipped=0 scanner=3",
    "SIGN-OFF: FAIL(COVERAGE-INDETERMINATE(abc123def456-0002))",
    "https://github.com/example/repo/blob/main/src/app.ts#L10-L20",
    `"self_sha256": "${sha}"`,
    // key=value chains, lowercase identifiers, docker tags, uuids: not high entropy.
    "env: NODE_OPTIONS=--max-old-space-size=4096 CI=true",
    "header=content-security-policy-v2-report-only-with-a-long-name",
    `image=ghcr.io/example/app:sha-${oid}`,
    "uuid=550e8400-e29b-41d4-a716-446655440000",
    "path=/usr/local/lib/node_modules/some-very-long-package-name/dist/index.js",
    "image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ];
  for (const line of lines) {
    assert.equal(matches(line, DEFAULT_RULES), false, `false positive on: ${line}`);
    assert.equal(redactString(line, DEFAULT_RULES).text, line);
  }
});

test("a placed marker is never absorbed by a later rule as its value", () => {
  // jwt runs before password-assign; its marker stays as the value and the key is kept as context.
  assert.equal(redactString(`password=${JWT}`, DEFAULT_RULES).text, "password=<REDACTED:jwt>");
  // A key that is not itself a rule keeps the marker as-is: no rule swallows `<REDACTED:…>`.
  const r = redactString("Hardcoded credential: password=1234 in config.ts", DEFAULT_RULES);
  assert.equal(r.text, "Hardcoded credential: <REDACTED:password-assign> in config.ts");
  assert.equal(redactString("key=<REDACTED:gcp-key>", DEFAULT_RULES).text, "key=<REDACTED:gcp-key>");
});

test("prose mentioning the words password/token/secret without an assignment is left alone", () => {
  const prose = [
    "Password reset tokens are stored in the session table",
    "bypass=true max_tokens=4096 secrets.md",
    "The secret sauce is in the tokenizer",
    "Bearer token",
    "Authorization: bearer authentication_required",
  ];
  for (const p of prose) assert.equal(redactString(p, DEFAULT_RULES).text, p, p);
});

test("prefixed key names are redacted whole (no dangling x- / openai_ stubs)", () => {
  assert.equal(redactString("x-api-key: 5f4dcc3b5aa765d61d8327deb882cf99", DEFAULT_RULES).text, "<REDACTED:token-assign>");
  assert.equal(redactString("OPENAI_API_KEY=sk-abc", DEFAULT_RULES).text, "<REDACTED:token-assign>");
  assert.equal(redactString("db_password: hunter2", DEFAULT_RULES).text, "<REDACTED:password-assign>");
  assert.equal(redactString("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", DEFAULT_RULES).text, "AWS_ACCESS_KEY_ID=<REDACTED:aws-key>");
});

test("assignment operators := => == === and escaped quotes redact the value whole", () => {
  // Review finding (round 3): `[:=]` consumed one character of a two-character operator and the
  // unquoted alternative then took the rest of the operator as the value, leaving the real quoted
  // value in the clear — with a marker placed, so matches() on the output said "clean".
  const cases = [
    ["'password' => 'hunter2',", "hunter2", "password-assign"],
    ['password := "hunter2"', "hunter2", "password-assign"],
    ['if (password == "admin123")', "admin123", "password-assign"],
    ['api_token => "ghp_16C7e42F292c6912E7710c838347Ae178B4a"', "ghp_16C7e42F292c6912E7710c838347Ae178B4a", "token-assign"],
    ['client_secret := "s3cr3t"', "s3cr3t", "secret-assign"],
    ['"password": "a\\"b1234"', "b1234", "password-assign"],
    ['password === "admin123"', "admin123", "password-assign"],
    ['password !== "admin123"', "admin123", "password-assign"],
  ];
  for (const [input, secret, cls] of cases) {
    const { text, hits } = redactString(input, DEFAULT_RULES);
    assert.equal(countOccurrences(text, secret), 0, `secret survived: ${JSON.stringify(input)} -> ${JSON.stringify(text)}`);
    assert.ok(hits.some((h) => h.class === cls), `${cls}: expected hit for ${JSON.stringify(input)}`);
    assert.equal(matches(text, DEFAULT_RULES), false, `output still matches: ${JSON.stringify(text)}`);
  }
  assert.equal(redactString("'password' => 'hunter2',", DEFAULT_RULES).text, "'<REDACTED:password-assign>,");
  assert.equal(redactString('if (password == "admin123")', DEFAULT_RULES).text, "if (<REDACTED:password-assign>)");
});

const SHAPES = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/redaction/shapes.json", import.meta.url)), "utf8"));

test("adversarial shapes fixture: every secret-bearing line redacts whole and every benign near-miss survives", () => {
  assert.ok(SHAPES.secrets.length >= 40, `fixture has ${SHAPES.secrets.length} secret shapes, want >= 40`);
  assert.ok(SHAPES.benign.length >= 15, `fixture has ${SHAPES.benign.length} benign shapes, want >= 15`);
  const failures = [];
  for (const { shape, input, secret } of SHAPES.secrets) {
    assert.equal(typeof secret, "string");
    assert.ok(input.includes(secret), `fixture bug: ${shape} does not contain its own secret`);
    const { text, hits } = redactString(input, DEFAULT_RULES);
    if (text.includes(secret)) failures.push(`LEAK    [${shape}] ${JSON.stringify(input)} -> ${JSON.stringify(text)}`);
    else if (hits.length === 0) failures.push(`NO-HIT  [${shape}] ${JSON.stringify(input)}`);
    if (matches(text, DEFAULT_RULES)) failures.push(`RESIDUE [${shape}] output still matches: ${JSON.stringify(text)}`);
    // Buffer entry point sees the same bytes.
    assert.equal(redactString(Buffer.from(input, "utf8"), DEFAULT_RULES).text, text, shape);
  }
  for (const { shape, input } of SHAPES.benign) {
    if (matches(input, DEFAULT_RULES)) failures.push(`OVER    [${shape}] ${JSON.stringify(input)} -> ${JSON.stringify(redactString(input, DEFAULT_RULES).text)}`);
    else assert.equal(redactString(input, DEFAULT_RULES).text, input, shape);
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}`);
});

test("known over-redactions stay on the safe side (references, expressions, custom types are redacted)", () => {
  // Documented in the module header; pinned so a change that flips one is visible in review.
  const lines = [
    "password: process.env.DB_PASSWORD",
    "token: $TOKEN",
    "password: ${{ secrets.DB_PASSWORD }}",
    "secret_name: db-creds",
    "password: SecureString;",
  ];
  for (const line of lines) assert.equal(matches(line, DEFAULT_RULES), true, `expected safe-side redaction: ${line}`);
});

test("the three *-assign rules share one suffix after their key group", () => {
  const byClass = Object.fromEntries(DEFAULT_RULES.rules.map((r) => [r.class, r.pattern]));
  const patterns = ["password-assign", "secret-assign", "token-assign"].map((c) => byClass[c]);
  let n = 0;
  while (patterns.every((p) => n < p.length && p.at(-1 - n) === patterns[0].at(-1 - n))) n++;
  // Every key group ends in `)`, so the common suffix picks that up; the shared part must then
  // start at the whitespace/closing-quote group, i.e. cover every operator, annotation and value
  // alternative — a fix applied to one rule and not the others fails here.
  const suffix = patterns[0].slice(patterns[0].length - n).replace(/^\)/, "");
  assert.ok(suffix.startsWith('\\s*(?:["\']\\s*(?:\\]\\s*)?)?(?:'), `shared suffix starts at: ${suffix.slice(0, 60)}`);
  for (const p of patterns) assert.ok(p.includes("(?<!<REDACTED:)"), "every key group refuses to start inside a marker");
  assert.ok(byClass["high-entropy-assign"].includes("(?<!<REDACTED:)"));
});

test("a placed marker is never a key, whatever follows it", () => {
  const tails = [">", "}", ",", ' value="x"', "\n  value: x", '("x")', ', "x"', ' = "x"', ": x", " hunter2", "#2", "</password>", " := 'x'", " => 'x'"];
  for (const c of TEN_CLASSES) {
    for (const t of tails) {
      const s = `<REDACTED:${c}>${t}`;
      assert.equal(matches(s, DEFAULT_RULES), false, `marker absorbed: ${JSON.stringify(s)} -> ${JSON.stringify(redactString(s, DEFAULT_RULES).text)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// redactDeep

test("redaction inside nested SARIF strings and rejection reasons", () => {
  const input = {
    runs: [
      {
        results: [
          { message: { text: "Hardcoded credential: password=1234 in config.ts" }, level: "error" },
        ],
      },
    ],
    rejects: [{ reason: "citation text 'password=1234' not found at head", path: "config.ts" }],
    log: ["[gate] claim 3 rejected: password=1234 outside range", "[gate] done"],
    count: 2,
    ok: true,
    nothing: null,
  };
  const out = redactDeep(input, DEFAULT_RULES);
  const bytes = JSON.stringify(out);
  assert.equal(countOccurrences(bytes, "password=1234"), 0, bytes);
  assert.equal(countOccurrences(bytes, "<REDACTED:password-assign>"), 3);
  assert.equal(out.runs[0].results[0].level, "error");
  assert.equal(out.rejects[0].path, "config.ts");
  assert.equal(out.log[1], "[gate] done");
  assert.equal(out.count, 2);
  assert.equal(out.ok, true);
  assert.equal(out.nothing, null);
  // The input is never mutated.
  assert.equal(input.rejects[0].reason, "citation text 'password=1234' not found at head");
});

test("redactDeep redacts object keys too", () => {
  const out = redactDeep({ "password=1234": "v", plain: "password=1234" }, DEFAULT_RULES);
  assert.deepEqual(out, { "<REDACTED:password-assign>": "v", plain: "<REDACTED:password-assign>" });
});

test("redactDeep keeps every entry when two keys redact to the same marker", () => {
  const out = redactDeep({ "password=1": "a", "password=2": "b", "password=3": "c" }, DEFAULT_RULES);
  assert.deepEqual(out, {
    "<REDACTED:password-assign>": "a",
    "<REDACTED:password-assign>#2": "b",
    "<REDACTED:password-assign>#3": "c",
  });
  // A literal key that already spells the marker is never renamed; the redacted one steps aside.
  const literal = redactDeep({ "password=1": "a", "<REDACTED:password-assign>": "b" }, DEFAULT_RULES);
  assert.deepEqual(literal, { "<REDACTED:password-assign>#2": "a", "<REDACTED:password-assign>": "b" });
  // Suffixed keys are stable under a second pass.
  assert.equal(redactDeep(out, DEFAULT_RULES), out);
});

test("redactDeep keeps a key spelled __proto__ as an own property and stays idempotent", () => {
  // JSON.parse yields `__proto__` as an own property; the output must too, or the entry is lost
  // (string value: the Object.prototype setter ignores it; object value: it becomes the prototype
  // and the result is no longer a plain object).
  const str = JSON.parse('{"__proto__": "password=1234", "x": "password=1"}');
  const out = redactDeep(str, DEFAULT_RULES);
  assert.ok(Object.hasOwn(out, "__proto__"));
  assert.equal(out["__proto__"], "<REDACTED:password-assign>");
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out), ["__proto__", "x"]);
  assert.equal(JSON.stringify(out), '{"__proto__":"<REDACTED:password-assign>","x":"<REDACTED:password-assign>"}');
  assert.equal(redactDeep(out, DEFAULT_RULES), out);

  const obj = JSON.parse('{"__proto__": {"reason": "password=1234"}, "x": "password=1"}');
  const out2 = redactDeep(obj, DEFAULT_RULES);
  assert.ok(Object.hasOwn(out2, "__proto__"));
  assert.equal(Object.getPrototypeOf(out2), Object.prototype);
  assert.equal(out2["__proto__"].reason, "<REDACTED:password-assign>");
  assert.equal(redactDeep(out2, DEFAULT_RULES), out2);

  // Unchanged input is still returned by reference, own __proto__ and all.
  const clean = JSON.parse('{"__proto__": {"a": "b"}, "x": "fine"}');
  assert.equal(redactDeep(clean, DEFAULT_RULES), clean);
});

test("redactDeep returns the input untouched by reference when nothing matched", () => {
  const obj = { a: "clean", b: [1, "two", { c: null, d: false }], e: 3 };
  const out = redactDeep(obj, DEFAULT_RULES);
  assert.equal(out, obj);
  assert.equal(out.b, obj.b);
  assert.equal(out.b[2], obj.b[2]);
  const arr = ["x", "y"];
  assert.equal(redactDeep(arr, DEFAULT_RULES), arr);
  const s = "plain string";
  assert.equal(redactDeep(s, DEFAULT_RULES), s);
});

test("redactDeep shares untouched subtrees and copies only the changed path", () => {
  const clean = { k: "fine" };
  const obj = { clean, dirty: { reason: "password=1234" } };
  const out = redactDeep(obj, DEFAULT_RULES);
  assert.notEqual(out, obj);
  assert.equal(out.clean, clean);
  assert.notEqual(out.dirty, obj.dirty);
  assert.equal(out.dirty.reason, "<REDACTED:password-assign>");
  assert.deepEqual(Object.keys(out), Object.keys(obj));
});

test("redactDeep leaves numbers, booleans, null and undefined alone", () => {
  for (const v of [0, 42, -1, true, false, null, undefined]) {
    assert.equal(redactDeep(v, DEFAULT_RULES), v);
  }
});

test("redactDeep throws a TypeError naming the path for a Buffer nested in an object", () => {
  const input = { a: "clean", b: Buffer.from("password=1234") };
  assert.throws(
    () => redactDeep(input, DEFAULT_RULES),
    (e) => e instanceof TypeError && /redactDeep: unsupported value at \$\.b \(Buffer\)/.test(e.message) && /redactString/.test(e.message),
  );
  // Same for a bare Uint8Array, and deeper in the tree the path follows keys and indexes.
  assert.throws(
    () => redactDeep({ runs: [{ blob: new Uint8Array([1, 2]) }] }, DEFAULT_RULES),
    (e) => e instanceof TypeError && e.message.includes("at $.runs[0].blob (Uint8Array)"),
  );
  // A key that is not a plain identifier is bracket-quoted so the path stays unambiguous.
  assert.throws(
    () => redactDeep({ "odd key": [Buffer.alloc(1)] }, DEFAULT_RULES),
    (e) => e instanceof TypeError && e.message.includes('at $["odd key"][0] (Buffer)'),
  );
});

test("redactDeep throws a TypeError for a class instance holding a string field", () => {
  class Finding {
    constructor() {
      this.reason = "password=1234";
    }
  }
  assert.throws(
    () => redactDeep({ f: new Finding() }, DEFAULT_RULES),
    (e) => e instanceof TypeError && e.message.includes("at $.f (Finding)"),
  );
  // Anonymous prototype chains carry no constructor name; the tag falls back to "object".
  const anon = Object.create(Object.create(null));
  anon.reason = "password=1234";
  assert.throws(
    () => redactDeep([anon], DEFAULT_RULES),
    (e) => e instanceof TypeError && e.message.includes("at $[0] (object)"),
  );
});

test("redactDeep throws a TypeError for Map, Set and Date values", () => {
  const cases = [
    ["$.m", "Map", new Map([["password", "1234"]])],
    ["$.s", "Set", new Set(["password=1234"])],
    ["$.d", "Date", new Date(0)],
  ];
  for (const [path, tag, v] of cases) {
    const key = path.slice(2);
    assert.throws(
      () => redactDeep({ [key]: v }, DEFAULT_RULES),
      (e) => e instanceof TypeError && e.message.includes(`at ${path} (${tag})`),
      tag,
    );
  }
});

test("redactDeep throws for a top-level Buffer; redactString remains the Buffer entry point", () => {
  const buf = Buffer.from("password=1234");
  assert.throws(
    () => redactDeep(buf, DEFAULT_RULES),
    (e) => e instanceof TypeError && e.message.includes("at $ (Buffer)"),
  );
  assert.equal(redactString(buf, DEFAULT_RULES).text, "<REDACTED:password-assign>");
});

test("redactDeep still accepts plain objects, null-prototype objects and arrays", () => {
  const nullProto = Object.create(null);
  nullProto.reason = "password=1234";
  const out = redactDeep({ list: [nullProto, { k: "v" }], n: 1 }, DEFAULT_RULES);
  assert.equal(out.list[0].reason, "<REDACTED:password-assign>");
  assert.deepEqual(out.list[1], { k: "v" });
  assert.equal(out.n, 1);
  const clean = { a: [{ b: "c" }], d: Object.create(null) };
  assert.equal(redactDeep(clean, DEFAULT_RULES), clean);
});

test("redactDeep uses DEFAULT_RULES when rules are omitted", () => {
  assert.equal(redactDeep("password=1234"), "<REDACTED:password-assign>");
  assert.equal(matches("password=1234"), true);
  assert.equal(redactString("password=1234").text, "<REDACTED:password-assign>");
});

test("idempotent", () => {
  const once = redactDeep(
    {
      a: "password=1234",
      b: [`Bearer ${JWT}`, PEM, AWS, "secret=abc", `x = "sK9v2Lq8mZ1xR4tY7wB0nC3jH6pF5dG2aE8uV1iO"`],
      "token=abc": { c: "AccountKey=" + "A1b2C3d4".repeat(11) + "==" },
    },
    DEFAULT_RULES,
  );
  const twice = redactDeep(once, DEFAULT_RULES);
  assert.deepEqual(twice, once);
  // Strong form: the second pass finds nothing, so it returns the same reference.
  assert.equal(twice, once);
  // And no replacement marker (nor a collision-suffixed key form of it) itself matches any rule.
  for (const c of TEN_CLASSES) {
    assert.equal(matches(`<REDACTED:${c}>`, DEFAULT_RULES), false, c);
    assert.equal(matches(`<REDACTED:${c}>#2`, DEFAULT_RULES), false, c);
  }
});

// ---------------------------------------------------------------------------
// Bounded cost (untrusted input, D5: dirty-file snapshots, SARIF ingest, scope subjects)

test("bounded cost: 256 KB of dash-joined identifiers, whitespace-free base64url, whitespace / newline / operator runs after `password`, repeated keys, a minified bundle and repeated PEM headers each redact in < 1 s", () => {
  const KB = 256 * 1024;
  const rep = (s) => s.repeat(Math.ceil(KB / s.length)).slice(0, KB);
  const inputs = {
    "dash-joined identifiers": "a-".repeat(KB / 2),
    "whitespace-free base64url": rep("aB3_-"),
    "password + whitespace run": "password" + " ".repeat(KB),
    "password + newline/space run": "password" + "\n ".repeat(KB / 2),
    "password + tab run then quote": "password" + "\t".repeat(KB) + '"',
    "password repeated (no separator)": rep("password"),
    "--password repeated": rep("--password "),
    "ENV password repeated": rep("ENV password "),
    "password, + whitespace": "password," + " ".repeat(KB),
    "password.equals( + whitespace": "password.equals(" + " ".repeat(KB),
    "password: + newline + spaces": "password:\n" + " ".repeat(KB),
    "password: | block of indented lines": "password: |\n" + rep("  line of text\n"),
    "password? + spaces": "password?" + " ".repeat(KB),
    "password: Type< no close": "password: Map<" + "a".repeat(KB),
    "password: union chain": "password: " + rep("a | "),
    "password= chain": rep("password="),
    '"password" quoted repeated': rep('"password" '),
    'password" + spaces + ]': 'password"' + " ".repeat(KB) + "]",
    "a-…-password + spaces": "a-".repeat(KB / 2) + "password" + " ".repeat(KB),
    "secret: + name: lines": rep("secret:\n  name: db\n"),
    "unclosed backtick": "token = `" + "a".repeat(KB),
    "unclosed quote": 'token = "' + "a".repeat(KB),
    "escaped quotes run": 'token = "' + rep('\\"'),
    "minified bundle": rep("var a=1;function f(x){return x+1}"),
    "repeated PEM headers": rep("-----BEGIN X-----\n"),
  };
  for (const [name, text] of Object.entries(inputs)) {
    const t0 = performance.now();
    matches(text, DEFAULT_RULES);
    redactString(Buffer.from(text), DEFAULT_RULES);
    const elapsed = performance.now() - t0;
    // Linear rules finish in tens of milliseconds at this size; a quadratic rule takes > 10 s.
    // The bound is generous so the test never flakes, and still catches a return to quadratic.
    assert.ok(elapsed < 1000, `${name}: ${elapsed.toFixed(0)} ms (rule cost is no longer linear)`);
  }
});

// ---------------------------------------------------------------------------
// Guardrails

test("leaf module: imports only node:fs/node:path/node:url", () => {
  const src = readFileSync(MODULE, "utf8");
  const specifiers = [...src.matchAll(/^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const bare = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const dynamic = [...src.matchAll(/\bimport\s*\(/g)];
  const all = [...specifiers, ...bare];
  assert.ok(all.length > 0, "module should import from node: builtins");
  for (const s of all) {
    assert.ok(["node:fs", "node:path", "node:url"].includes(s), `unexpected import ${s}`);
  }
  assert.equal(dynamic.length, 0, "no dynamic imports");
  assert.doesNotMatch(src, /\bchild_process\b|\bfetch\s*\(|node:http|node:net|node:dns/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/);
});
