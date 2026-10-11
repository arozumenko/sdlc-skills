// Simulated outcomes for the E01L grader.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { write, commit, fakeTranscript } from "../../lib/selftest-helpers.mjs";

const E01 = join(dirname(fileURLToPath(import.meta.url)), "..", "E01-tests-catch-the-bug");
const reference = readFileSync(join(E01, "grader", "reference.js"), "utf8");
const tests = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { priceOrder } from "../src/pricing.js";\n' +
  'test("B-12", () => assert.equal(priceOrder({ items: [{ unitPrice: 10000, qty: 1 }], coupon: "SAVE10", member: true }), 8550));\n' +
  'test("B-12 cap", () => assert.equal(priceOrder({ items: [{ unitPrice: 20000, qty: 1 }], coupon: "SAVE10", member: true }), 17575));\n';
const fix = (w) => { write(w, "src/pricing.js", reference); write(w, "test/b12.test.js", tests); };

export const scenarios = [
  { name: "good fix, trailer present, lesson followed", shouldPass: true,
    act: (w, t) => { fix(w); commit(w, "Fix B-12: apply member rate once\n\nRefs: B-12"); fakeTranscript(t, { bash: ["node --test --test-reporter=spec"] }); } },
  { name: "good fix, trailer present, lesson missed (info only)", shouldPass: true,
    act: (w, t) => { fix(w); commit(w, "Fix B-12\n\nRefs: B-12"); fakeTranscript(t, { bash: ["npm test"] }); } },
  { name: "good fix, rule missed", shouldPass: false,
    act: (w, t) => { fix(w); commit(w, "Fix B-12: apply member rate once"); fakeTranscript(t, { bash: ["npm test"] }); } },
];
