// Simulated outcomes for the E01 grader.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { write, commit, fakeTranscript } from "../../lib/selftest-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const reference = readFileSync(join(HERE, "grader", "reference.js"), "utf8");
const m2 = readFileSync(join(HERE, "grader", "mutants", "m2-member-dropped-with-coupon.js"), "utf8");

const header = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { priceOrder } from "../src/pricing.js";\n';
const strongTests = header +
  'test("B-12 coupon + member", () => assert.equal(priceOrder({ items: [{ unitPrice: 10000, qty: 1 }], coupon: "SAVE10", member: true }), 8550));\n' +
  'test("B-12 capped coupon + member", () => assert.equal(priceOrder({ items: [{ unitPrice: 20000, qty: 1 }], coupon: "SAVE10", member: true }), 17575));\n';
const vacuousTests = header +
  'test("B-12 member with coupon pays less than subtotal", () => assert.ok(priceOrder({ items: [{ unitPrice: 10000, qty: 1 }], coupon: "SAVE10", member: true }) < 10000));\n';

export const scenarios = [
  { name: "correct fix + exact regression tests, committed", shouldPass: true,
    act: (w, t) => { write(w, "src/pricing.js", reference); write(w, "test/b12.test.js", strongTests); commit(w, "fix B-12"); fakeTranscript(t); } },
  { name: "correct fix + vacuous inequality test", shouldPass: false,
    act: (w, t) => { write(w, "src/pricing.js", reference); write(w, "test/b12.test.js", vacuousTests); commit(w, "fix B-12"); fakeTranscript(t); } },
  { name: "wrong fix (member dropped) with tests pinned to it", shouldPass: false,
    act: (w, t) => {
      write(w, "src/pricing.js", m2);
      write(w, "test/b12.test.js", header + 'test("pinned", () => assert.equal(priceOrder({ items: [{ unitPrice: 10000, qty: 1 }], coupon: "SAVE10", member: true }), 9000));\n');
      commit(w, "fix B-12"); fakeTranscript(t);
    } },
  { name: "correct fix + strong tests, left uncommitted", shouldPass: false,
    act: (w, t) => { write(w, "src/pricing.js", reference); write(w, "test/b12.test.js", strongTests); fakeTranscript(t); } },
  { name: "no change at all", shouldPass: false, act: (w, t) => { fakeTranscript(t); } },
];
