import { test } from "node:test";
import assert from "node:assert/strict";

import { APP_LINES, buildRepo } from "../fixtures/cite/build-repo.mjs";
import { checkCitation, findingId, occurrenceOf } from "./citations.mjs";

const SCOPE = ["src/"];
// Lines 4–7 of src/app.js at c2: PORT, password, blank, handler.
const SNIPPET_4_7 = APP_LINES.slice(3, 7).join("\n");
const HEX64 = /^[0-9a-f]{64}$/;

test("a snippet with extra spaces and a blank line verifies against the window at HEAD", () => {
  const { root, oid2 } = buildRepo();
  const messy = `  const PORT   = Number(process.env.PORT ?? 8080);\n\n\n\tconst password = "hunter22x";  \n\nexport function handler(req,  res) {\n`;
  const r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [4, 7], snippet: messy });
  assert.equal(r.state, "VERIFIED", r.why);
  assert.equal(r.oid, oid2);
  assert.equal(r.path, "src/app.js");
  assert.equal(r.normalised.length, 3, "blank lines dropped, three content lines remain");
  assert.match(r.snippet_redacted, /<REDACTED:key-value>/);
  assert.ok(!r.snippet_redacted.includes("hunter22x"), "the redacted snippet never carries the secret");
  assert.equal(r.snippet_redacted.split("\n").length, 3);
});

test("a snippet that is not in the window is FAILED snippet-not-found", () => {
  const { root, oid2 } = buildRepo();
  const r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [7, 10], snippet: "const password = \"hunter22x\";" });
  assert.equal(r.state, "FAILED");
  assert.equal(r.why, "snippet-not-found");
  assert.equal(r.oid, oid2, "the oid is still resolved so it can be stamped");
  assert.equal(r.snippet_redacted, undefined);
});

test("a range over 40 lines is FAILED range-over-40; a path outside scope is FAILED path-not-in-scope", () => {
  const { root } = buildRepo();
  let r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [1, 80], snippet: "x" });
  assert.equal(r.state, "FAILED");
  assert.equal(r.why, "range-over-40");
  r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [1, 41], snippet: "x" });
  assert.equal(r.why, "range-over-40");
  r = checkCitation(root, SCOPE, { path: "README.md", lines: [1, 2], snippet: "# fixture" });
  assert.equal(r.state, "FAILED");
  assert.equal(r.why, "path-not-in-scope");
  r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [1, 45], snippet: "x" }, { maxRangeLines: 50 });
  assert.notEqual(r.why, "range-over-40", "cite.mjs passes its own MAX_RANGE_LINES");
});

test("an explicit oid verifies against the OLD bytes; the same snippet fails at HEAD", () => {
  const { root, oid1 } = buildRepo();
  let r = checkCitation(root, SCOPE, { path: "src/app.js", oid: oid1, lines: [4, 4], snippet: "const PORT = 8080;" });
  assert.equal(r.state, "VERIFIED", r.why);
  assert.equal(r.oid, oid1);
  r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [4, 4], snippet: "const PORT = 8080;" });
  assert.equal(r.state, "FAILED");
  assert.equal(r.why, "snippet-not-found");
  r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [4, 4], snippet: "const PORT = 8080;" }, { defaultOid: oid1 });
  assert.equal(r.state, "VERIFIED", "the caller's default oid (the review head) applies when the citation carries none");
  assert.equal(r.oid, oid1);
});

test("a malformed citation is FAILED bad-shape", () => {
  const { root } = buildRepo();
  const cases = [
    null,
    "src/app.js",
    { lines: [1, 2], snippet: "x" },
    { path: 7, lines: [1, 2], snippet: "x" },
    { path: "src/app.js", snippet: "x" },
    { path: "src/app.js", lines: [0, 2], snippet: "x" },
    { path: "src/app.js", lines: [5, 3], snippet: "x" },
    { path: "src/app.js", lines: [1.5, 3], snippet: "x" },
    { path: "src/app.js", lines: ["1", "3"], snippet: "x" },
    { path: "src/app.js", lines: [1, 2] },
    { path: "src/app.js", lines: [1, 2], snippet: "" },
    { path: "src/app.js", lines: [1, 2], snippet: " \n\t\n" },
    { path: "src/../src/app.js", lines: [1, 2], snippet: "x" },
    { path: "src//app.js", lines: [1, 2], snippet: "x" },
    { path: "/src/app.js", lines: [1, 2], snippet: "x" },
    { path: "src/app.js", oid: 12, lines: [1, 2], snippet: "x" },
  ];
  for (const c of cases) {
    const r = checkCitation(root, SCOPE, c);
    assert.equal(r.state, "FAILED", JSON.stringify(c));
    assert.equal(r.why, "bad-shape", JSON.stringify(c));
  }
});

test("a path missing at the oid, or an unknown oid, is FAILED not-in-tree", () => {
  const { root } = buildRepo();
  let r = checkCitation(root, SCOPE, { path: "src/nope.js", lines: [1, 2], snippet: "x" });
  assert.equal(r.state, "FAILED");
  assert.equal(r.why, "not-in-tree");
  r = checkCitation(root, SCOPE, { path: "src/app.js", oid: "0123456789abcdef0123456789abcdef01234567", lines: [1, 2], snippet: "x" });
  assert.equal(r.why, "not-in-tree");
  assert.equal(r.oid, undefined);
});

test("a ./-prefixed path is canonicalised before the scope test and the compare", () => {
  const { root } = buildRepo();
  const r = checkCitation(root, SCOPE, { path: "././src/./app.js", lines: [4, 4], snippet: APP_LINES[3] });
  assert.equal(r.state, "VERIFIED", r.why);
  assert.equal(r.path, "src/app.js");
});

test("a window past the last line is clamped; a start past the end is snippet-not-found", () => {
  const { root } = buildRepo();
  let r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [11, 14], snippet: APP_LINES.slice(10).join("\n") });
  assert.equal(r.state, "VERIFIED", r.why);
  r = checkCitation(root, SCOPE, { path: "src/app.js", lines: [20, 22], snippet: "x" });
  assert.equal(r.why, "snippet-not-found");
});

test("findingId is 64 hex, stable, class-sensitive, and hashes the REDACTED snippet", () => {
  const norm = ["const PORT = Number(process.env.PORT ?? 8080);", "const password = \"hunter22x\";"];
  const a = findingId({ path: "src/app.js", cls: "hardcoded-secret", normalisedSnippet: norm });
  assert.match(a, HEX64);
  assert.equal(a, findingId({ path: "src/app.js", cls: "hardcoded-secret", normalisedSnippet: [...norm] }));
  assert.notEqual(a, findingId({ path: "src/app.js", cls: "path-traversal", normalisedSnippet: norm }));
  assert.notEqual(a, findingId({ path: "src/other.js", cls: "hardcoded-secret", normalisedSnippet: norm }));
  const redacted = [norm[0], "const password = \"<REDACTED:key-value>\";"];
  assert.equal(a, findingId({ path: "src/app.js", cls: "hardcoded-secret", normalisedSnippet: redacted }), "the preimage uses the redacted snippet");
  // The secret on the FIRST line is redacted too — no published hash has a secret in its preimage.
  const firstLineSecret = ["const password = \"hunter22x\";", "export {};"];
  const firstLineRedacted = ["const password = \"<REDACTED:key-value>\";", "export {};"];
  assert.equal(findingId({ path: "p", cls: "c", normalisedSnippet: firstLineSecret }), findingId({ path: "p", cls: "c", normalisedSnippet: firstLineRedacted }));
});

test("occurrenceOf: the copied matcher counts equal windows before the cited start", () => {
  const lines = ["a", "b", "a", "b", "c"];
  assert.equal(occurrenceOf(lines, ["a", "b"], 1), 0);
  assert.equal(occurrenceOf(lines, ["a", "b"], 3), 1);
  assert.equal(occurrenceOf(lines, ["a", "b"], 2), null);
  assert.equal(occurrenceOf(lines, "b\nc", 4), 0);
  assert.equal(occurrenceOf(lines, ["c", "d"], 5), null, "past the end");
  assert.throws(() => occurrenceOf(lines, [], 1), TypeError);
  assert.throws(() => occurrenceOf(lines, "", 1), TypeError);
  assert.throws(() => occurrenceOf(lines, ["a"], 0), TypeError);
});
