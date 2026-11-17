import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`./agents/test-run-lead/${name}`, import.meta.url), "utf8");
const agent = read("AGENT.md");
const rules = read("RULES.md");

test("Step 4 keeps runners in the foreground until completion", () => {
  const step = agent.slice(agent.indexOf("## Step 4"), agent.indexOf("## Step 5 "));
  assert.match(step, /every test-runner in the foreground/i);
  assert.match(step, /never as a background agent/i);
  assert.match(step, /run_in_background/);
  assert.match(step, /never end your turn while a runner is running/i);
  assert.match(step, /headless run stops background work/i);
});

test("rule 5 requires foreground runners and an active lead turn", () => {
  const rule = rules.split("\n").find((line) => line.startsWith("5. "));
  assert.match(rule, /foreground/i);
  assert.match(rule, /never end your turn while a runner is running/i);
});

test("Step 5c checks only FAILs against current sources before reporting", () => {
  const heading = "## Step 5c — Check FAILs for case drift";
  const start = agent.indexOf(heading);
  const end = agent.indexOf("## Step 6");
  assert.ok(start > agent.indexOf("## Step 5b"), "Step 5c follows Step 5b");
  assert.ok(start < end, "Step 5c precedes Step 6");
  const step = agent.slice(start, end);
  for (const phrase of ["Only check FAILs", "expected result", "current source of truth", "acceptance criteria", "decision records", "code", "keep the result FAIL", "failure_reason", "CASE DRIFT:", "test-author", "Step 7", "could not confirm"]) {
    assert.ok(step.includes(phrase), phrase);
  }
  assert.match(step, /prefix .*`failure_reason`/);
  assert.match(step, /unsure.*app FAIL/i);
  assert.match(step, /never change a result to PASS/i);
});

test("Step 7 lists case-drift FAILs separately from app failures", () => {
  const step = agent.slice(agent.indexOf("## Step 7"), agent.indexOf("## Input Format"));
  assert.match(step, /App failures:/);
  assert.match(step, /Case-drift FAILs:/);
});

test("rule 9 separates case drift from app bugs without granting PASS", () => {
  const rule = rules.split("\n").find((line) => line.startsWith("9. "));
  assert.ok(rule, "rule 9 exists");
  assert.match(rule, /case drift/i);
  assert.match(rule, /separately from app bugs/i);
  assert.match(rule, /never.*PASS/);
});
