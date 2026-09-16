import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import * as tokens from "./tokens.mjs";
import { RUN_KINDS, runIdOf } from "./ledger.mjs";

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
  assert.equal(tokens.ENGAGEMENT_TEMPLATE_WRITTEN, "ENGAGEMENT: template written — edit and re-run");
  assert.equal(tokens.KEY_AVAILABLE, "KEY: available");
  assert.equal(tokens.KEY_UNAVAILABLE, "KEY: unavailable");
});

test("keyLine: `KEY: <key_id> created|reused|rotated` (TASK-009)", () => {
  assert.equal(tokens.keyLine("k0123456789ab", "created"), "KEY: k0123456789ab created");
  assert.equal(tokens.keyLine("k0123456789ab", "reused"), "KEY: k0123456789ab reused");
  assert.equal(tokens.keyLine("k0123456789ab", "rotated"), "KEY: k0123456789ab rotated");
  assert.throws(() => tokens.keyLine("k0123456789ab", "renewed"), /created\|reused\|rotated/);
  assert.throws(() => tokens.keyLine("0123456789ab", "created"), /key_id/);
  assert.throws(() => tokens.keyLine("../x", "created"), /key_id/);
  // TASK-028 rows (register, plan §4.3 / spec §6.8)
  assert.equal(tokens.EQUIVALENCE_REQUIRED, "EQUIVALENCE-REQUIRED");
  assert.equal(tokens.ANCHOR_MATCH, "MATCH");
  assert.equal(tokens.ANCHOR_TRUNCATED, "TRUNCATED");
  assert.equal(tokens.ANCHOR_DIVERGED, "DIVERGED");
});

test("register formatters (TASK-028)", () => {
  assert.equal(tokens.transitionRejected("accept", "fixed"), "TRANSITION-REJECTED(accept: fixed)");
  assert.equal(tokens.row({ id: "R-0001", status: "open", priority: "p1", seq: 1 }), "ROW R-0001 status=open priority=p1 seq=1");
  assert.throws(() => tokens.row({ id: "R-1", status: "open", priority: "p1", seq: 1 }), /id/);
  assert.throws(() => tokens.row({ id: "R-0001", status: "confirmed", priority: "p1", seq: 1 }), /status/);
  assert.throws(() => tokens.row({ id: "R-0001", status: "open", priority: "p9", seq: 1 }), /priority/);
  assert.throws(() => tokens.row({ id: "R-0001", status: "open", priority: "p1", seq: -1 }), /seq/);
  assert.equal(tokens.replayed({ seq: 2, rows: 2, chain_sha256: "c".repeat(64) }), `REPLAY seq=2 rows=2 chain=${"c".repeat(64)}`);
  assert.throws(() => tokens.replayed({ seq: 2, rows: 2, chain_sha256: "zz" }), /chain/);
  assert.equal(tokens.projection(".agents/security-testing/register/projection.json"), "PROJECTION .agents/security-testing/register/projection.json");
  assert.throws(() => tokens.projection("/abs"), /repo-relative/);
  assert.equal(tokens.statusLine({ rows: 3, seq: 4 }), "STATUS rows=3 seq=4");
  assert.equal(tokens.openExposure({ p0: 1, p1: 2, p2: 0, p3: 0 }), "OPEN-EXPOSURE p0=1 p1=2 p2=0 p3=0");
  assert.throws(() => tokens.openExposure({ p0: 1 }), /p1/);
  assert.equal(tokens.approvals(2), "APPROVALS unauthenticated=2");
  assert.equal(tokens.count("open", { p0: 1, p1: 2, p2: 0, p3: 0 }), "COUNT open p0=1 p1=2 p2=0 p3=0");
  assert.throws(() => tokens.count("confirmed", { p0: 0, p1: 0, p2: 0, p3: 0 }), /status/);
  assert.deepEqual(tokens.REGISTER_STATUSES, ["open", "accepted", "fixed", "regressed", "false-positive", "superseded"]);
  assert.deepEqual(tokens.REGISTER_PRIORITIES, ["p0", "p1", "p2", "p3"]);
});

test("runLine (TASK-012): exact shape; its private id/kind vocabulary agrees with ledger.mjs", () => {
  const oid = "0123456789abcdef".repeat(3).slice(0, 40);
  const other = "f".repeat(40);
  assert.equal(tokens.runLine({ run_id: "0123456789ab-0001", seq: 1, kind: "assessment", base: oid, head: oid }), `RUN 0123456789ab-0001 seq=1 kind=assessment base=${oid} head=${oid}`);
  assert.equal(tokens.runLine({ run_id: runIdOf(other, 42), seq: 42, kind: "review", base: oid, head: other }), `RUN ffffffffffff-0042 seq=42 kind=review base=${oid} head=${other}`);
  // tokens.mjs is a leaf and carries its own copy of the run-id shape and the
  // kind list: every ledger-minted id and every ledger kind must pass, so the
  // copies cannot drift from ledger.RUN_ID / ledger.RUN_KINDS.
  for (const kind of RUN_KINDS) assert.doesNotThrow(() => tokens.runLine({ run_id: runIdOf(oid, 9999), seq: 9999, kind, base: oid, head: oid }), kind);
  assert.throws(() => tokens.runLine({ run_id: "0123456789ab-0001", seq: 1, kind: "audit", base: oid, head: oid }), /closed vocabulary/);
  assert.throws(() => tokens.runLine({ run_id: "0123456789ab-001", seq: 1, kind: "assessment", base: oid, head: oid }), /run_id/);
  assert.throws(() => tokens.runLine({ run_id: "0123456789AB-0001", seq: 1, kind: "assessment", base: oid, head: oid }), /run_id/);
  assert.throws(() => tokens.runLine({ run_id: "0123456789ab-0001", seq: 0, kind: "assessment", base: oid, head: oid }), /seq/);
  assert.throws(() => tokens.runLine({ run_id: "0123456789ab-0001", seq: 1, kind: "assessment", base: oid.slice(1), head: oid }), /oids/);
});

test("register transition formatters (TASK-029)", () => {
  assert.equal(tokens.emitterOnly("ticketed"), "EMITTER-ONLY(ticketed)");
  assert.equal(tokens.notEquivalent("R-0001", "R-0002"), "NOT-EQUIVALENT(R-0001: R-0002)");
  assert.equal(tokens.aliased({ from_id: "a".repeat(64), to_id: "b".repeat(64), seq: 3 }), `ALIAS from=${"a".repeat(64)} to=${"b".repeat(64)} seq=3`);
  assert.throws(() => tokens.aliased({ from_id: "T-001", to_id: "b".repeat(64), seq: 1 }), /finding ids/);
  assert.throws(() => tokens.aliased({ from_id: "a".repeat(64), to_id: "b".repeat(64), seq: 0 }), /seq/);
  assert.equal(tokens.checked(0), "CHECK expired=0");
  assert.equal(tokens.checked(2), "CHECK expired=2");
  assert.throws(() => tokens.checked(-1), /expired/);
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
  assert.equal(
    tokens.templatesLine({ written: ["finding-schema.md"], present: ["engagement.md.template", "report-reading-guide.md"] }),
    "TEMPLATES: engagement.md.template=present finding-schema.md=written report-reading-guide.md=present",
  );
  assert.throws(() => tokens.templatesLine({ written: [], present: [] }), /accounted/);
  assert.throws(() => tokens.templatesLine({ written: ["stray.md"], present: ["engagement.md.template", "finding-schema.md", "report-reading-guide.md"] }), /unknown/);
  assert.equal(tokens.wrote(".agents/security-testing/runs/r/scope.json", "a".repeat(64)), `WROTE .agents/security-testing/runs/r/scope.json sha256=${"a".repeat(64)}`);
  assert.throws(() => tokens.wrote("/abs/path", "a".repeat(64)), /repo-relative/);
  assert.throws(() => tokens.wrote("../outside.json", "a".repeat(64)), /inside the repo/);
  assert.throws(() => tokens.wrote("..", "a".repeat(64)), /inside the repo/);
  assert.equal(tokens.wrote("..hidden/x.json", "a".repeat(64)), `WROTE ..hidden/x.json sha256=${"a".repeat(64)}`, "a name merely starting with dots is a name");
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

test("baselineLine: `BASELINE: <n> files ignored=<n>` (TASK-010)", () => {
  assert.equal(tokens.baselineLine({ files: 12, ignored: 3 }), "BASELINE: 12 files ignored=3");
  assert.equal(tokens.baselineLine({ files: 0, ignored: 0 }), "BASELINE: 0 files ignored=0");
  assert.throws(() => tokens.baselineLine({ files: -1, ignored: 0 }), /files/);
  assert.throws(() => tokens.baselineLine({ files: 1, ignored: 1.5 }), /ignored/);
  assert.throws(() => tokens.baselineLine({ files: "1", ignored: 0 }), /files/);
});

test("rendered: `RENDER <repo-relative path> rows=<n> seq=<n>` (TASK-059)", () => {
  assert.equal(tokens.rendered({ relPath: ".agents/security-testing/risk-register.md", rows: 3, seq: 7 }), "RENDER .agents/security-testing/risk-register.md rows=3 seq=7");
  assert.equal(tokens.rendered({ relPath: "reports/security/register.md", rows: 0, seq: 0 }), "RENDER reports/security/register.md rows=0 seq=0");
  assert.throws(() => tokens.rendered({ relPath: "/abs/risk-register.md", rows: 1, seq: 1 }), /repo-relative/);
  assert.throws(() => tokens.rendered({ relPath: "../risk-register.md", rows: 1, seq: 1 }), /repo-relative/);
  assert.throws(() => tokens.rendered({ relPath: "x.md", rows: -1, seq: 1 }), /rows/);
  assert.throws(() => tokens.rendered({ relPath: "x.md", rows: 1, seq: -1 }), /seq/);
  assert.throws(() => tokens.rendered({ relPath: "x.md", rows: 1.5, seq: 1 }), /rows/);
});

test("every exported token is a string constant or a function; every constant is one line", () => {
  for (const [name, value] of Object.entries(tokens)) {
    if (name === "FORBIDDEN_STRINGS" || name === "REGISTER_STATUSES" || name === "REGISTER_PRIORITIES" || value instanceof RegExp) continue;
    assert.ok(typeof value === "string" || typeof value === "function", `${name}: ${typeof value}`);
    if (typeof value === "string") assert.doesNotMatch(value, /\n/, name);
  }
});
