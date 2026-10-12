import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, MAX_LENGTH } from "../src/slugify.js";

test("strips accents and lowercases", () => {
  assert.equal(slugify("Crème Brûlée"), "creme-brulee");
});

test("collapses punctuation into single dashes", () => {
  assert.equal(slugify("Hello,   World!! -- again"), "hello-world-again");
});

test("no leading or trailing dashes", () => {
  assert.equal(slugify("  --Draft--  "), "draft");
});

test("empty and all-punctuation titles", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify("?!...--"), "");
});

test("respects the 64-character limit", () => {
  const slug = slugify("A short title");
  assert.ok(slug.length <= MAX_LENGTH);
});
