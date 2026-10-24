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

test("infrastructure failures stay visible without diluting capability rate or cost medians", () => {
  const rec = (pass, scored, status, cost) => ({ case: "X", pass, scored, status, grade: { checks: [] }, metrics: { turns: 1, toolCallTotal: 0, totalTokens: 1, usage: {}, costUsd: cost, wallMs: 1000 } });
  const [row] = summarize([rec(true,true,"passed",2),rec(false,true,"failed",4),rec(false,false,"quota-limit",0)]).cases;
  assert.equal(row.trials,3); assert.equal(row.scoredTrials,2); assert.equal(row.infrastructureErrors,1);
  assert.equal(row.passAt1,0.5); assert.equal(row.costUsd.median,3);
  assert.equal(row.observedCostUsd,6);
});
test("an all-quota batch has no capability score, rather than zero percent", () => {
  const [row] = summarize([{ case:"X",pass:false,scored:false,status:"quota-limit",grade:{checks:[]},metrics:{costUsd:0,wallMs:1000} }]).cases;
  assert.equal(row.scoredTrials,0); assert.equal(row.passAt1,null); assert.equal(row.passHatN,null);
  assert.equal(row.costUsd.median,null);
});
