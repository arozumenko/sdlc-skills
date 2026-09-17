// normalize.test.mjs — replays every vector in ../fixtures/lib/normalize-vectors.json.
// The vectors are the contract: every consumer of normalised text (cite,
// verify) relies on exactly these rules, so a change here changes finding
// identity.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EncodingError, normalizeText } from "./normalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "lib", "normalize-vectors.json"), "utf8"));

test("every vector matches", () => {
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

test("invalid UTF-8 is an EncodingError, never a lossy decode", () => {
  assert.throws(() => normalizeText(Buffer.from([0xff])), (err) => err instanceof EncodingError && err.name === "EncodingError");
});

test("a string input is accepted as already decoded", () => {
  assert.deepEqual(normalizeText("  a \t b \r\n\r\n c "), { lines: ["a b", "c"], text: "a b\nc" });
});
