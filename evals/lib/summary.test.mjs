import { test } from "node:test";
import assert from "node:assert/strict";
import { passHatK, summarize } from "./summary.mjs";

test("pass^k is C(c,k)/C(n,k)", () => {
  assert.equal(passHatK(3, 3, 3), 1);
  assert.equal(passHatK(2, 3, 3), 0);
  assert.equal(passHatK(2, 3, 1), 2 / 3);
  assert.equal(passHatK(3, 4, 2), 3 / 6);
  assert.equal(passHatK(5, 10, 2), 10 / 45);
  assert.equal(passHatK(1, 2, 3), null, "k larger than the trial count is undefined");
});

test("summary reports pass@1 and pass^n per case", () => {
  const rec = (pass) => ({ case: "X", pass, grade: { checks: [] }, metrics: { turns: 1, toolCallTotal: 0, totalTokens: 1, usage: {}, costUsd: 0, wallMs: 0 } });
  const [row] = summarize([rec(true), rec(true), rec(false)]).cases;
  assert.equal(row.passAt1, 2 / 3);
  assert.equal(row.passHatN, 0);
});
