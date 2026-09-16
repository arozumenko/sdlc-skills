// Tests for normalize.mjs (TASK-003, US-002 AC-5).
//
// The published vectors in ../references/normalize-vectors.json are the
// contract: every consumer of normalised text (gate, cite, coverage) relies on
// exactly these rules, so a change here is a change of finding identity.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EncodingError, normalizeText } from "./normalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(HERE, "..", "references", "normalize-vectors.json");
const VECTORS = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

test("every published vector matches", () => {
  assert.ok(Array.isArray(VECTORS) && VECTORS.length > 0, "vectors file is a non-empty array");
  for (const v of VECTORS) {
    const input = Buffer.from(v.input_base64, "base64");
    if (v.expected_error !== undefined) {
      assert.equal(v.expected_error, "EncodingError", `${v.name}: only EncodingError is a published rejection`);
      assert.throws(() => normalizeText(input), EncodingError, `${v.name}: expected EncodingError`);
      continue;
    }
    const out = normalizeText(input);
    assert.deepEqual(out.lines, v.expected_lines, `${v.name}: lines`);
    assert.equal(out.text, v.expected_lines.join("\n"), `${v.name}: text is lines joined by LF`);
  }
});

test("published vectors are well-formed and cover the required cases", () => {
  const names = VECTORS.map((v) => v.name);
  assert.equal(new Set(names).size, names.length, "vector names are unique");
  for (const v of VECTORS) {
    assert.equal(typeof v.name, "string");
    assert.equal(typeof v.input_base64, "string");
    const hasLines = Array.isArray(v.expected_lines);
    const hasError = typeof v.expected_error === "string";
    assert.ok(hasLines !== hasError, `${v.name}: exactly one of expected_lines / expected_error`);
    if (hasLines) for (const l of v.expected_lines) assert.equal(typeof l, "string", `${v.name}: lines are strings`);
  }
  // US-002 AC-5 names these cases explicitly; the task adds NFC and invalid UTF-8.
  for (const required of ["bom", "cr-newlines", "crlf", "tab", "nbsp", "empty-lines", "nfc", "invalid-utf8"]) {
    assert.ok(names.some((n) => n.includes(required)), `a vector covers "${required}"`);
  }
});

test("invalid UTF-8 rejected", () => {
  const bad = Buffer.from([0x61, 0x0a, 0xc3, 0x28, 0x0a, 0x62]); // "a\n" + invalid 2-byte sequence + "\nb"
  assert.throws(
    () => normalizeText(bad),
    (err) => {
      assert.ok(err instanceof EncodingError);
      assert.ok(err instanceof Error);
      assert.equal(err.name, "EncodingError");
      assert.match(err.message, /UTF-8/);
      return true;
    },
  );
  // Nothing is decoded leniently: the same bytes as latin1 would be "aÃ(" — never returned.
  assert.throws(() => normalizeText(Buffer.from([0xe9])), EncodingError);
});

test("newlines preserved; only empty lines removed", () => {
  const src = "first\n\n  second  \r\n\r\n\t\r third\n\n\n fourth \n";
  const out = normalizeText(Buffer.from(src, "utf8"));
  // Four non-empty source lines ⇒ exactly four output lines, in source order,
  // each trimmed; no line is merged, split or reordered.
  assert.deepEqual(out.lines, ["first", "second", "third", "fourth"]);
  assert.equal(out.text, "first\nsecond\nthird\nfourth");
  // No newline survives inside a line, and no output line is empty.
  for (const line of out.lines) {
    assert.doesNotMatch(line, /[\r\n]/);
    assert.notEqual(line, "");
  }
  // A file with no empty lines keeps its line count exactly.
  const dense = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(normalizeText(Buffer.from(dense)).lines.length, 50);
});

test("horizontal whitespace class is exactly [\\p{Zs}\\t]; trim never uses String.prototype.trim", () => {
  // U+FEFF mid-file and U+2028 are stripped by String.prototype.trim but are
  // not [\p{Zs}\t]; they must survive at line ends.
  assert.deepEqual(normalizeText(Buffer.from("x\n\ufeffy\u2028")).lines, ["x", "\ufeffy\u2028"]);
  // \v and \f are not horizontal whitespace either.
  assert.deepEqual(normalizeText(Buffer.from("\va\f")).lines, ["\va\f"]);
  // Every Zs character collapses; U+1680 (OGHAM SPACE MARK) and U+202F are Zs.
  assert.deepEqual(normalizeText(Buffer.from("\u1680a\u202f\u2009b\u3000")).lines, ["a b"]);
});

test("accepts Uint8Array and already-decoded strings; rejects other types", () => {
  const bytes = new TextEncoder().encode("a\r\nb");
  assert.deepEqual(normalizeText(bytes).lines, ["a", "b"]);
  assert.deepEqual(normalizeText("a\r\n\tb  ").lines, ["a", "b"]);
  assert.deepEqual(normalizeText("\ufeffcafe\u0301").lines, ["caf\u00e9"]);
  assert.throws(() => normalizeText(42), TypeError);
  assert.throws(() => normalizeText(null), TypeError);
  assert.throws(() => normalizeText({}), TypeError);
});

test("idempotent: normalising the normalised text is a fixed point", () => {
  for (const v of VECTORS) {
    if (v.expected_error !== undefined) continue;
    const once = normalizeText(Buffer.from(v.input_base64, "base64"));
    const twice = normalizeText(Buffer.from(once.text, "utf8"));
    assert.deepEqual(twice.lines, once.lines, `${v.name}: fixed point`);
  }
});

test("leaf module: imports nothing from scripts/ and no fs, child_process or network module", () => {
  const src = readFileSync(join(HERE, "normalize.mjs"), "utf8");
  const imports = [...src.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.doesNotMatch(spec, /^\.{1,2}\//, `no local import: ${spec}`);
    assert.doesNotMatch(spec, /fs|child_process|http|https|net|dns/, `forbidden module: ${spec}`);
  }
  assert.doesNotMatch(src, /\brequire\(/, "no require()");
  assert.doesNotMatch(src, /\bDate\b|process\.hrtime|performance\.now/, "no clock (G-1)");
});
