// TASK-014 — lib/cite-core.mjs: the pure half of citation handling (plan §3.3
// `lib/cite.mjs` row, §5 TASK-014; spec §6.2 range rule, v3 §6.1 occurrence).
// No git, no fs: every input is bytes or a scope payload already in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "../normalize.mjs";
import { MAX_RANGE_LINES, SIDES, TYPED_ROLES, checkRange, lineMap, occurrenceOf, rangeBytes } from "./cite-core.mjs";
import { PATH_NOT_IN_SCOPE, RANGE_INVALID, RANGE_NOT_ADMITTED, RANGE_TOO_LONG, SIDE_MISMATCH } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A scope payload with one head file admitting [1, lines] (what cmd-scope writes). */
function scopeWith(files, extra = {}) {
  const payload = { files: [], ranges: {}, skipped: [], ...extra };
  for (const [path, lines, side = "head"] of files) {
    payload.files.push({ path, side, oid: "a".repeat(40), file_hmac: "b".repeat(64), lines });
    payload.ranges[path] = lines === 0 ? [] : [[1, lines]];
  }
  return payload;
}

// --- import guard -------------------------------------------------------------

test("pure: cite-core.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "cite-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `cite-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../normalize.mjs", "./tokens.mjs"]);
});

test("constants: the 40-line cap, the three sides, the three typed roles", () => {
  assert.equal(MAX_RANGE_LINES, 40);
  assert.deepEqual([...SIDES], ["base", "head", "snapshot"]);
  assert.deepEqual([...TYPED_ROLES], ["source", "sink", "control"]);
  assert.ok(Object.isFrozen(SIDES) && Object.isFrozen(TYPED_ROLES));
});

// --- lineMap / rangeBytes -------------------------------------------------------

test("lineMap: one span per normalised line; blank raw lines belong to no span; count agrees with normalize.mjs", () => {
  const buf = Buffer.from("﻿a\r\n\r\n  b  \n\t\n c\r", "utf8");
  const { lines, spans } = lineMap(buf);
  assert.deepEqual(lines, normalizeText(buf).lines);
  assert.deepEqual(lines, ["a", "b", "c"]);
  assert.equal(spans.length, 3);
  const raw = spans.map(({ start, end }) => buf.subarray(start, end).toString("utf8"));
  assert.deepEqual(raw, ["﻿a\r\n", "  b  \n", " c\r"]);
});

test("lineMap: a line made only of U+FEFF after the first line is content (normalize.mjs rule 2), whitespace-only lines are not", () => {
  const buf = Buffer.from("x\n﻿\n  \t\n　y\n", "utf8");
  const { lines, spans } = lineMap(buf);
  assert.deepEqual(lines, normalizeText(buf).lines);
  assert.deepEqual(lines, ["x", "﻿", "y"]);
  assert.equal(spans.length, 3);
});

test("lineMap: empty buffer and whitespace-only buffer map to zero lines; invalid UTF-8 throws EncodingError", () => {
  assert.deepEqual(lineMap(Buffer.alloc(0)), { lines: [], spans: [] });
  assert.deepEqual(lineMap(Buffer.from("\n \n\t\r\n")), { lines: [], spans: [] });
  assert.throws(() => lineMap(Buffer.from([0x61, 0xff, 0x0a])), { name: "EncodingError" });
  assert.throws(() => lineMap("a\n"), TypeError);
});

test("rangeBytes: raw bytes of the cited normalised lines, contiguous and newline-preserving (CRLF kept, interior blank lines kept, last terminator kept)", () => {
  const buf = Buffer.from("one\r\n\r\ntwo\r\n\n  three  \nfour", "utf8"); // normalised: one two three four
  assert.equal(rangeBytes(buf, 1, 1).toString(), "one\r\n");
  assert.equal(rangeBytes(buf, 2, 3).toString(), "two\r\n\n  three  \n");
  assert.equal(rangeBytes(buf, 4, 4).toString(), "four"); // no terminator at EOF ⇒ none included
  assert.equal(rangeBytes(buf, 1, 4).toString(), buf.toString());
  // a leading blank line is not part of line 1
  assert.equal(rangeBytes(Buffer.from("\n\nx\n"), 1, 1).toString(), "x\n");
});

test("rangeBytes: returns a copy (mutating it leaves the source intact) and accepts a precomputed lineMap", () => {
  const buf = Buffer.from("a\nb\n");
  const out = rangeBytes(buf, 1, 1);
  out[0] = 0x7a;
  assert.equal(buf.toString(), "a\nb\n");
  const map = lineMap(buf);
  assert.equal(rangeBytes(buf, 2, 2, map).toString(), "b\n");
});

test("rangeBytes: 1-based inclusive; start < 1, end < start, non-integers and a range past the last line are refused", () => {
  const buf = Buffer.from("a\nb\nc\n");
  assert.throws(() => rangeBytes(buf, 0, 1), RangeError);
  assert.throws(() => rangeBytes(buf, 2, 1), RangeError);
  assert.throws(() => rangeBytes(buf, 1, 4), RangeError);
  assert.throws(() => rangeBytes(buf, 4, 4), RangeError);
  assert.throws(() => rangeBytes(buf, 1.5, 2), TypeError);
  assert.throws(() => rangeBytes(buf, "1", 2), TypeError);
  assert.throws(() => rangeBytes("a\n", 1, 1), TypeError);
});

// --- checkRange -----------------------------------------------------------------

test("checkRange: shape — lines must be [int, int] with 1 ≤ start ≤ end, else RANGE-INVALID", () => {
  const scope = scopeWith([["src/app.js", 50]]);
  for (const lines of [[0, 1], [2, 1], [1], [1, 2, 3], [1, "2"], [1.5, 2], "1-2", undefined, [-1, 5], [1, Number.MAX_SAFE_INTEGER + 2]]) {
    assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines }), { ok: false, reason: RANGE_INVALID }, JSON.stringify(lines));
  }
  assert.equal(RANGE_INVALID, "RANGE-INVALID");
});

test("checkRange: end-start+1 = 41 rejected (RANGE-TOO-LONG)", () => {
  const scope = scopeWith([["src/app.js", 100]]);
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [10, 50] }), { ok: false, reason: RANGE_TOO_LONG });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [1, 41] }), { ok: false, reason: RANGE_TOO_LONG });
  // the cap applies to typed citations too — the range rule is about `lines`, whatever the role
  assert.deepEqual(checkRange(scope, { role: "sink", path: "src/app.js", side: "head", lines: [1, 41] }), { ok: false, reason: RANGE_TOO_LONG });
  assert.equal(RANGE_TOO_LONG, "RANGE-TOO-LONG");
});

test("checkRange: 40 lines inside an admitted range accepted", () => {
  const scope = scopeWith([["src/app.js", 100]]);
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [1, 40] }), { ok: true });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [61, 100] }), { ok: true });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [7, 7] }), { ok: true });
});

test("checkRange: primary range outside admitted ranges rejected (RANGE-NOT-ADMITTED) — partial overlap is outside", () => {
  const scope = scopeWith([["src/app.js", 100]]);
  scope.ranges["src/app.js"] = [
    [1, 10],
    [20, 30],
  ];
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [11, 12] }), { ok: false, reason: RANGE_NOT_ADMITTED });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [5, 25] }), { ok: false, reason: RANGE_NOT_ADMITTED }, "a range must lie inside ONE admitted range");
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [8, 10] }), { ok: true });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [20, 30] }), { ok: true });
  // an empty file admits no range at all
  const empty = scopeWith([["src/empty.js", 0]]);
  assert.deepEqual(checkRange(empty, { path: "src/empty.js", side: "head", lines: [1, 1] }), { ok: false, reason: RANGE_NOT_ADMITTED });
  assert.equal(RANGE_NOT_ADMITTED, "RANGE-NOT-ADMITTED");
});

test("checkRange: typed citation outside admitted ranges accepted with context:true", () => {
  const scope = scopeWith([["src/app.js", 100]]);
  scope.ranges["src/app.js"] = [[1, 10]];
  for (const role of TYPED_ROLES) {
    assert.deepEqual(checkRange(scope, { role, path: "src/app.js", side: "head", lines: [50, 60] }), { ok: true, context: true }, role);
  }
  // inside an admitted range it is still flagged: typed citations are context, never the primary claim (spec v3 §6.1)
  assert.deepEqual(checkRange(scope, { role: "source", path: "src/app.js", side: "head", lines: [2, 3] }), { ok: true, context: true });
  // an unknown role is a caller bug, not a rejection reason
  assert.throws(() => checkRange(scope, { role: "witness", path: "src/app.js", side: "head", lines: [1, 1] }), TypeError);
});

test("checkRange: a path that is not a scope file (skipped, or never listed) is PATH-NOT-IN-SCOPE for primary and typed citations alike", () => {
  const scope = scopeWith([["src/app.js", 10]], { skipped: [{ path: "src/logo.png", reason: "binary" }] });
  assert.deepEqual(checkRange(scope, { path: "src/logo.png", side: "head", lines: [1, 1] }), { ok: false, reason: PATH_NOT_IN_SCOPE });
  assert.deepEqual(checkRange(scope, { path: "src/other.js", side: "head", lines: [1, 1] }), { ok: false, reason: PATH_NOT_IN_SCOPE });
  assert.deepEqual(checkRange(scope, { role: "sink", path: "src/other.js", side: "head", lines: [1, 1] }), { ok: false, reason: PATH_NOT_IN_SCOPE });
  assert.equal(PATH_NOT_IN_SCOPE, "PATH-NOT-IN-SCOPE");
});

test("checkRange: side must match the scope file's recorded side for head|snapshot; base is exempt (its bytes are never in scope.files)", () => {
  const scope = scopeWith([
    ["src/clean.js", 10, "head"],
    ["src/dirty.js", 10, "snapshot"],
  ]);
  assert.deepEqual(checkRange(scope, { path: "src/dirty.js", side: "head", lines: [1, 1] }), { ok: false, reason: SIDE_MISMATCH });
  assert.deepEqual(checkRange(scope, { path: "src/clean.js", side: "snapshot", lines: [1, 1] }), { ok: false, reason: SIDE_MISMATCH });
  assert.deepEqual(checkRange(scope, { path: "src/dirty.js", side: "snapshot", lines: [1, 10] }), { ok: true });
  assert.deepEqual(checkRange(scope, { path: "src/clean.js", side: "base", lines: [1, 10] }), { ok: true });
  assert.deepEqual(checkRange(scope, { path: "src/dirty.js", side: "base", lines: [1, 10] }), { ok: true });
  assert.equal(SIDE_MISMATCH, "SIDE-MISMATCH");
});

test("checkRange: order of the rules — shape, then length, then scope membership, then side, then admission", () => {
  const scope = scopeWith([["src/dirty.js", 10, "snapshot"]]);
  // too long AND wrong side AND not admitted ⇒ the length rule speaks first
  assert.deepEqual(checkRange(scope, { path: "src/dirty.js", side: "head", lines: [1, 41] }), { ok: false, reason: RANGE_TOO_LONG });
  // wrong side AND not admitted ⇒ side first
  assert.deepEqual(checkRange(scope, { path: "src/dirty.js", side: "head", lines: [11, 12] }), { ok: false, reason: SIDE_MISMATCH });
  // unknown path AND wrong side ⇒ membership first
  assert.deepEqual(checkRange(scope, { path: "nope.js", side: "head", lines: [11, 12] }), { ok: false, reason: PATH_NOT_IN_SCOPE });
});

test("checkRange: accepts the scope artifact ({envelope, payload}) as well as the bare payload; refuses malformed scopes and citations", () => {
  const payload = scopeWith([["src/app.js", 10]]);
  const artifact = { envelope: { kind: "scope" }, payload };
  assert.deepEqual(checkRange(artifact, { path: "src/app.js", side: "head", lines: [1, 10] }), { ok: true });
  assert.throws(() => checkRange({ files: "x", ranges: {} }, { path: "src/app.js", side: "head", lines: [1, 1] }), TypeError);
  assert.throws(() => checkRange(null, { path: "src/app.js", side: "head", lines: [1, 1] }), TypeError);
  assert.throws(() => checkRange(payload, { path: "", side: "head", lines: [1, 1] }), TypeError);
  assert.throws(() => checkRange(payload, { path: "src/app.js", side: "working", lines: [1, 1] }), TypeError);
  assert.throws(() => checkRange(payload, null), TypeError);
});

test("checkRange: pure — the scope and the citation are not mutated", () => {
  const scope = scopeWith([["src/app.js", 10]]);
  const before = JSON.stringify(scope);
  const citation = { path: "src/app.js", side: "head", lines: [1, 10] };
  checkRange(scope, citation);
  assert.equal(JSON.stringify(scope), before);
  assert.deepEqual(citation, { path: "src/app.js", side: "head", lines: [1, 10] });
});

// --- occurrenceOf ---------------------------------------------------------------

const FILE = ["a", "b", "a", "b", "c", "a", "b"]; // "a b" occurs at starts 1, 3, 6 (1-based)

test("occurrenceOf: 0-based index of the cited window among equal windows, ordered by start line", () => {
  assert.equal(occurrenceOf(FILE, ["a", "b"], 1), 0);
  assert.equal(occurrenceOf(FILE, ["a", "b"], 3), 1);
  assert.equal(occurrenceOf(FILE, ["a", "b"], 6), 2);
  assert.equal(occurrenceOf(FILE, ["c"], 5), 0);
  assert.equal(occurrenceOf(FILE, "a\nb", 3), 1, "a normalised snippet string is split on \\n");
});

test("occurrenceOf: the window at `start` must equal the snippet, else null (the citation does not locate the snippet)", () => {
  assert.equal(occurrenceOf(FILE, ["a", "b"], 2), null);
  assert.equal(occurrenceOf(FILE, ["a", "b"], 7), null, "window runs past the end");
  assert.equal(occurrenceOf(FILE, ["z"], 1), null);
  assert.equal(occurrenceOf([], ["a"], 1), null);
});

test("occurrenceOf: overlapping windows count (they are distinct ranges with equal text)", () => {
  assert.equal(occurrenceOf(["a", "a", "a"], ["a", "a"], 2), 1);
  assert.equal(occurrenceOf(["a", "a", "a"], ["a"], 3), 2);
});

test("occurrenceOf: compares normalised lines exactly — whitespace-different lines are not equal (normalisation is the caller's job, and the same on both sides)", () => {
  assert.equal(occurrenceOf(["x = 1", "x  = 1"], ["x = 1"], 2), null);
  assert.equal(occurrenceOf(["x = 1", "x = 1"], ["x = 1"], 2), 1);
});

test("occurrenceOf: argument checks", () => {
  assert.throws(() => occurrenceOf(FILE, [], 1), TypeError);
  assert.throws(() => occurrenceOf(FILE, "", 1), TypeError);
  assert.throws(() => occurrenceOf(FILE, ["a"], 0), TypeError);
  assert.throws(() => occurrenceOf(FILE, ["a"], 1.5), TypeError);
  assert.throws(() => occurrenceOf("abc", ["a"], 1), TypeError);
  assert.throws(() => occurrenceOf(FILE, [1], 1), TypeError);
});
