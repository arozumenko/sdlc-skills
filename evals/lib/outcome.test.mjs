import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExecution, trialOutcome, shouldStopRun } from "./outcome.mjs";
const okProc = { code: 0, timedOut: false, stderr: "" };
const okMetrics = { isError: false, stopReason: "success", finalText: "done" };
const good = { pass: true, checks: [] };

test("weekly quota with success subtype and exit 1 is infrastructure, never a pass", () => {
  const p = { ...okProc, code: 1 };
  const m = { ...okMetrics, finalText: "You've hit your weekly limit · resets 7am (Europe/Zurich)" };
  assert.equal(classifyExecution(p,m).status, "quota-limit");
  const o = trialOutcome(p,m,good,null);
  assert.equal(o.pass, false);
  assert.equal(o.scored, false);
  assert.equal(shouldStopRun(o), true);
});
test("a healthy answer mentioning a limit is not a quota error", () => {
  assert.equal(classifyExecution(okProc,{ ...okMetrics, finalText: "You've hit your weekly limit is the quoted error under investigation." }), null);
});
test("time and cost budget exhaustion are scored failures, even with passing artifacts", () => {
  for (const [p,m,status] of [
    [{ ...okProc, code: null, timedOut: true },okMetrics,"timeout"],
    [okProc,{ ...okMetrics, isError: true, stopReason: "error_max_budget_usd" },"budget-exhausted"],
  ]) {
    const o=trialOutcome(p,m,good,null);
    assert.equal(o.status,status); assert.equal(o.scored,true); assert.equal(o.pass,false); assert.equal(shouldStopRun(o),false);
  }
});
test("authentication, missing result and process failures are unscored", () => {
  assert.equal(classifyExecution({ ...okProc,code:1,stderr:"Authentication failed: invalid API key" },okMetrics).status,"authentication-error");
  assert.equal(trialOutcome(okProc,{ ...okMetrics,isError:true,stopReason:"no_result" },good,null).status,"execution-error");
  assert.equal(trialOutcome({ ...okProc,code:1 },okMetrics,good,null).scored,false);
});
test("grader and judge failures cannot become capability failures or successes", () => {
  assert.equal(trialOutcome(okProc,okMetrics,{ pass:false,checks:[{ id:"grader-crashed" }] },null).status,"grader-error");
  const o=trialOutcome(okProc,okMetrics,good,{ pass:false,error:true });
  assert.equal(o.status,"judge-error"); assert.equal(o.scored,false); assert.equal(shouldStopRun(o),true);
});
test("valid agent outcomes require both grader and requested judge", () => {
  assert.deepEqual(trialOutcome(okProc,okMetrics,good,null),{ status:"passed",scored:true,pass:true });
  assert.equal(trialOutcome(okProc,okMetrics,good,{ pass:false }).status,"failed");
  assert.equal(trialOutcome(okProc,okMetrics,{ pass:false,checks:[] },{ pass:true }).pass,false);
});
