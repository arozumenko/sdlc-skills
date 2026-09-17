import { test } from "node:test";
import assert from "node:assert/strict";

import { CoverageError, tileCoverage } from "./coverage.mjs";

const files = ["a", "b", "c"];
const counts = new Map([["a", 10], ["b", 10], ["c", 10]]);

const span = (ranges) => ranges.reduce((m, [s, e]) => m + (e - s + 1), 0);
const totalTiled = (rows) => rows.reduce((n, r) => n + span(r.ranges) + span(r.unexamined ?? []), 0);

test("whole, partial and untouched files tile exactly once", () => {
  const r = tileCoverage(files, [{ path: "a" }, { path: "b", lines: [1, 4] }], counts);
  assert.equal(r.examined, 1);
  assert.equal(r.partial, 1);
  assert.equal(r.unexamined, 1);
  assert.deepEqual(r.rows, [
    { path: "a", status: "examined", ranges: [[1, 10]] },
    { path: "b", status: "partial", ranges: [[1, 4]], unexamined: [[5, 10]] },
    { path: "c", status: "unexamined", ranges: [[1, 10]] },
  ]);
  assert.equal(totalTiled(r.rows), 30, "every line of every file appears in exactly one range");
});

test("overlapping and adjacent partial ranges merge; a hole stays unexamined", () => {
  const r = tileCoverage(["b"], [{ path: "b", lines: [1, 4] }, { path: "b", lines: [3, 6] }, { path: "b", lines: [9, 10] }], counts);
  assert.deepEqual(r.rows, [{ path: "b", status: "partial", ranges: [[1, 6], [9, 10]], unexamined: [[7, 8]] }]);
  assert.equal(totalTiled(r.rows), 10);
  const whole = tileCoverage(["b"], [{ path: "b", lines: [1, 5] }, { path: "b", lines: [6, 10] }], counts);
  assert.deepEqual(whole.rows, [{ path: "b", status: "examined", ranges: [[1, 10]] }]);
  assert.equal(whole.examined, 1);
});

test("a whole-file declaration beside a partial one is the whole file; a range past the end is clamped", () => {
  const r = tileCoverage(["a"], [{ path: "a", lines: [2, 3] }, { path: "a" }], counts);
  assert.deepEqual(r.rows, [{ path: "a", status: "examined", ranges: [[1, 10]] }]);
  const clamped = tileCoverage(["a"], [{ path: "a", lines: [8, 40] }], counts);
  assert.deepEqual(clamped.rows, [{ path: "a", status: "partial", ranges: [[8, 10]], unexamined: [[1, 7]] }]);
});

test("rows follow the files order; an empty examined list leaves everything unexamined", () => {
  const r = tileCoverage(["c", "a"], [], counts);
  assert.deepEqual(r.rows.map((x) => x.path), ["c", "a"]);
  assert.equal(r.unexamined, 2);
  assert.equal(r.examined + r.partial, 0);
});

test("an examined path outside the files list is a CoverageError", () => {
  assert.throws(() => tileCoverage(files, [{ path: "zz" }], counts), (e) => e instanceof CoverageError && e.message === "not in scope: zz");
  assert.throws(() => tileCoverage(files, [{ path: "./a" }], counts), /not in scope: \.\/a/, "paths must be canonical, as git ls-files prints them");
});

test("a malformed examined entry is a CoverageError naming the index", () => {
  for (const bad of [null, "a", { path: 3 }, { path: "a", lines: [0, 2] }, { path: "a", lines: [4, 2] }, { path: "a", lines: [1] }, { path: "a", lines: "1-2" }]) {
    assert.throws(() => tileCoverage(files, [{ path: "b" }, bad], counts), /examined\[1\]/, JSON.stringify(bad));
  }
  assert.throws(() => tileCoverage(files, "nope", counts), /examined must be an array/);
});

test("a zero-line file is one row with no ranges and never counts as examined", () => {
  const r = tileCoverage(["e"], [{ path: "e" }], new Map([["e", 0]]));
  assert.deepEqual(r.rows, [{ path: "e", status: "unexamined", ranges: [] }]);
  assert.equal(r.unexamined, 1);
  assert.throws(() => tileCoverage(["a"], [], new Map()), /line count/);
});
