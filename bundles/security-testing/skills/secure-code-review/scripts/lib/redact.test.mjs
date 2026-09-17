import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_RULES, RulesError, loadRules, redactString } from "./redact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "lib");

test("each rule class fires once on its sample and nothing else changes", () => {
  const samples = {
    "aws-key": "id=AKIAIOSFODNN7EXAMPLE end",
    jwt: "h eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl x",
    "pem-block": "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    bearer: "Authorization: Bearer abcdefghijklmnop.qrs",
    "key-value": "password = hunter22x",
    "high-entropy": "sha=QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5",
  };
  for (const [cls, s] of Object.entries(samples)) {
    const r = redactString(s);
    assert.equal(r.hits, 1, cls);
    assert.match(r.text, new RegExp(`<REDACTED:${cls}>`), cls);
  }
  assert.equal(redactString(samples["aws-key"]).text, "id=<REDACTED:aws-key> end");
  assert.equal(redactString(samples.bearer).text, "Authorization: Bearer <REDACTED:bearer>");
  assert.equal(redactString(samples["key-value"]).text, "password = <REDACTED:key-value>");
});

test("plain code is untouched", () => {
  const s = "const x = require('fs'); // path=/usr/bin";
  assert.deepEqual(redactString(s), { text: s, hits: 0 });
});

test("the secrets fixture leaves no raw secret behind and keeps plain lines", () => {
  const raw = readFileSync(join(FIXTURES, "secrets.txt"), "utf8");
  const r = redactString(raw);
  assert.ok(r.hits >= 6, `expected at least one hit per class, got ${r.hits}`);
  for (const secret of ["AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJIUzI1NiJ9", "MIIBOgIBAAJBAKj34", "abcdefghijklmnop.qrs", "hunter22x", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5"]) {
    assert.ok(!r.text.includes(secret), `${secret} survived redaction`);
  }
  assert.ok(r.text.includes("const x = require('fs'); // path=/usr/bin"));
  assert.ok(r.text.includes("db.query('SELECT * FROM t WHERE id = ?', [id])"));
});

test("the default rules load from the sibling json and are compiled", () => {
  assert.equal(DEFAULT_RULES.length, 6);
  for (const rule of DEFAULT_RULES) {
    assert.ok(rule.re instanceof RegExp, rule.class);
    assert.ok(rule.re.global, `${rule.class} must be global`);
  }
  assert.deepEqual(loadRules().map((r) => r.class), DEFAULT_RULES.map((r) => r.class));
});

test("an unknown flag in the rules file is a RulesError", () => {
  assert.throws(() => loadRules(join(FIXTURES, "bad-rules.json")), (err) => err instanceof RulesError && /flags/.test(err.message));
});

test("a rules file without a rules array is a RulesError", () => {
  assert.throws(() => loadRules(join(FIXTURES, "normalize-vectors.json")), RulesError);
});

test("redactString requires a string", () => {
  assert.throws(() => redactString(Buffer.from("x")), TypeError);
});
