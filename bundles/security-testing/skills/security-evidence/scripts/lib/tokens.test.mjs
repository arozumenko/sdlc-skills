import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import * as tokens from "./tokens.mjs";

test("constants are exactly the spec's spellings", () => {
  assert.equal(tokens.DIRTY_TREE, "DIRTY-TREE");
  assert.equal(tokens.NO_ASSESSMENT, "NO-ASSESSMENT");
  assert.equal(tokens.EDIT_ENGAGEMENT_AND_RERUN, "EDIT-ENGAGEMENT-AND-RERUN");
  assert.equal(tokens.ENGAGEMENT_MISSING, "ENGAGEMENT-MISSING");
  assert.equal(tokens.NOT_A_WORK_TREE, "NOT-A-WORK-TREE");
  assert.equal(tokens.RUN_COMMITTED, "RUN-COMMITTED");
  assert.equal(tokens.CORRUPT, "CORRUPT");
  assert.equal(tokens.COMMITTED, "COMMITTED");
  assert.equal(tokens.POLICY_INVALID_PRIVATE, "POLICY-INVALID(private)");
});

test("formatters", () => {
  assert.equal(tokens.incomplete("scope"), "INCOMPLETE(scope)");
  assert.equal(tokens.inconsistent("gate-result"), "INCONSISTENT(gate-result)");
  assert.equal(tokens.engagementInvalid("$.slug: bad"), "ENGAGEMENT-INVALID($.slug: bad)");
  assert.equal(tokens.schemaInvalid("threat-model", "$.x: bad"), "SCHEMA-INVALID(threat-model: $.x: bad)");
  assert.equal(tokens.usage("check", "--run <id> is required"), "USAGE(check: --run <id> is required)");
  assert.equal(tokens.notImplemented("M2"), "NOT-IMPLEMENTED(M2)");
  assert.equal(tokens.notImplemented("M3"), "NOT-IMPLEMENTED(M3)");
  assert.throws(() => tokens.notImplemented("M1"), /M2\|M3/);
  assert.equal(tokens.wrote(".agents/security-testing/runs/r/scope.json", "a".repeat(64)), `WROTE .agents/security-testing/runs/r/scope.json sha256=${"a".repeat(64)}`);
  assert.throws(() => tokens.wrote("/abs/path", "a".repeat(64)), /repo-relative/);
  assert.throws(() => tokens.wrote("x.json", "nope"), /sha256/);
  assert.equal(
    tokens.verdictLine({ verdict: "VERIFIED", finding: "f".repeat(64), base: "b".repeat(40), head: "c".repeat(40), tested_tree: "same-as-head", verify: "d".repeat(64) }),
    `VERDICT VERIFIED finding=${"f".repeat(64)} base=${"b".repeat(40)} head=${"c".repeat(40)} tested_tree=same-as-head verify=${"d".repeat(64)}`,
  );
  assert.throws(() => tokens.verdictLine({ verdict: "MAYBE", finding: "f".repeat(64), base: "b".repeat(40), head: "c".repeat(40), tested_tree: "same-as-head", verify: "d".repeat(64) }), /verdict/);
});

test("G-13: the forbidden strings never appear under scripts/ (fixtures and tests excluded)", () => {
  assert.deepEqual(tokens.FORBIDDEN_STRINGS, ["UNGATED", "exact checkout"]);
  const offenders = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "fixtures") continue;
        visit(p);
      } else if (!name.endsWith(".test.mjs")) {
        let src = readFileSync(p, "utf8");
        if (name === "tokens.mjs") {
          // Strip only the list literal itself; the rest of tokens.mjs is scanned like any other file.
          const before = src;
          src = src.replace(/export const FORBIDDEN_STRINGS = Object\.freeze\(\[[^\]]*\]\);/, "");
          assert.notEqual(src, before, "the FORBIDDEN_STRINGS literal was found and stripped");
        }
        for (const s of tokens.FORBIDDEN_STRINGS) {
          if (src.includes(s)) offenders.push(`${relative(SCRIPTS_DIR, p)}: ${s}`);
        }
      }
    }
  };
  visit(SCRIPTS_DIR);
  assert.deepEqual(offenders, []);
});

test("every exported token is a string constant or a function; every constant is one line", () => {
  for (const [name, value] of Object.entries(tokens)) {
    if (name === "FORBIDDEN_STRINGS" || value instanceof RegExp) continue;
    assert.ok(typeof value === "string" || typeof value === "function", `${name}: ${typeof value}`);
    if (typeof value === "string") assert.doesNotMatch(value, /\n/, name);
  }
});
