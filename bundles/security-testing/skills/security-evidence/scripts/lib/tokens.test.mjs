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

test("consume-verdict tokens (TASK-030)", () => {
  assert.equal(tokens.NO_ROW, "NO-ROW");
  const verify = "a".repeat(64);
  assert.equal(tokens.consumed({ verdict: "VERIFIED", row: "R-0001", verify }), `CONSUMED VERIFIED row=R-0001 verify=${verify}`);
  assert.equal(tokens.consumed({ verdict: "UNVERIFIED-SUPPRESSION(2 unacked)", row: "R-0042", verify }), `CONSUMED UNVERIFIED-SUPPRESSION(2 unacked) row=R-0042 verify=${verify}`);
  assert.throws(() => tokens.consumed({ verdict: "CONFIRMED", row: "R-0001", verify }), /closed vocabulary/);
  assert.throws(() => tokens.consumed({ verdict: "VERIFIED", row: "R-1", verify }), /R-nnnn/);
  assert.throws(() => tokens.consumed({ verdict: "VERIFIED", row: "R-0001", verify: "abc" }), /sha256/);
});

test("run snapshot tokens (TASK-058; plan §4.1 rows `run snapshot *`)", () => {
  assert.equal(tokens.SNAPSHOT_EXISTS, "SNAPSHOT-EXISTS");
  assert.equal(tokens.kindRefused("review"), "KIND(review)");
  assert.throws(() => tokens.kindRefused("audit"), /closed vocabulary/);
  assert.equal(tokens.snapshotRegister({ events: 3, chain_sha256: "c".repeat(64) }), `SNAPSHOT register events=3 chain=${"c".repeat(64)}`);
  assert.equal(tokens.snapshotRegister({ events: 0, chain_sha256: "0".repeat(64) }), `SNAPSHOT register events=0 chain=${"0".repeat(64)}`);
  assert.throws(() => tokens.snapshotRegister({ events: -1, chain_sha256: "c".repeat(64) }), /events/);
  assert.throws(() => tokens.snapshotRegister({ events: 1, chain_sha256: "zz" }), /chain/);
  assert.equal(tokens.snapshotVerify({ from: "deadbeef0000-0001", sha256: "d".repeat(64) }), `SNAPSHOT verify from=deadbeef0000-0001 sha256=${"d".repeat(64)}`);
  assert.throws(() => tokens.snapshotVerify({ from: "nope", sha256: "d".repeat(64) }), /from/);
  assert.throws(() => tokens.snapshotVerify({ from: "deadbeef0000-0001", sha256: "d" }), /sha256/);
  assert.equal(tokens.snapshotProposals(0), "SNAPSHOT proposals n=0");
  assert.equal(tokens.snapshotProposals(2), "SNAPSHOT proposals n=2");
  assert.throws(() => tokens.snapshotProposals(-1), /n must/);
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

test("ingest sarif rows (TASK-016): rejection reasons, recorded fallbacks and the two unlocated reasons are spelled once", () => {
  const rejects = [tokens.SARIF_RULE_MISSING, tokens.SARIF_RULE_MISMATCH, tokens.SARIF_LEVEL_INVALID, tokens.SARIF_REGION_MALFORMED, tokens.SARIF_REGION_OUTSIDE_FILE, tokens.SARIF_REGION_BLANK, tokens.SARIF_FILE_NOT_TEXT];
  assert.deepEqual(rejects, ["rule-missing", "rule-mismatch", "level-invalid", "region-malformed", "region-outside-file", "region-blank", "file-not-text"]);
  const recorded = [tokens.SARIF_UNKNOWN_TOOL, tokens.SARIF_RULE_NOT_IN_METADATA, tokens.SARIF_RULE_DEFAULT_LEVEL_INVALID, tokens.SARIF_LEVEL_FROM_RULE_DEFAULT, tokens.SARIF_LEVEL_ABSENT, tokens.SARIF_ENDLINE_DEFAULTED, tokens.SARIF_SNIPPET_FROM_SIDE];
  assert.deepEqual(recorded, ["unknown-tool", "rule-not-in-metadata", "rule-default-level-invalid", "level-from-rule-default", "level-absent", "endline-defaulted", "snippet-from-side"]);
  assert.equal(tokens.UNLOCATED_NO_LOCATION, "no-location");
  assert.equal(tokens.UNLOCATED_OUT_OF_SCOPE, "out-of-scope");
  assert.equal(new Set([...rejects, ...recorded]).size, rejects.length + recorded.length, "a reason never doubles as a fallback note");
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

test("scope rows (TASK-013): SCOPE-EXISTS and `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>`", () => {
  assert.equal(tokens.SCOPE_EXISTS, "SCOPE-EXISTS");
  assert.equal(tokens.scopeLine({ files: 3, ranges: 2, skipped: 1, snapshot: 0 }), "SCOPE files=3 ranges=2 skipped=1 snapshot=0");
  assert.equal(tokens.scopeLine({ files: 0, ranges: 0, skipped: 0, snapshot: 0 }), "SCOPE files=0 ranges=0 skipped=0 snapshot=0");
  assert.throws(() => tokens.scopeLine({ files: -1, ranges: 0, skipped: 0, snapshot: 0 }), /files/);
  assert.throws(() => tokens.scopeLine({ files: 1, ranges: 0.5, skipped: 0, snapshot: 0 }), /ranges/);
  assert.throws(() => tokens.scopeLine({ files: 1, ranges: 0, skipped: "0", snapshot: 0 }), /skipped/);
  assert.throws(() => tokens.scopeLine({ files: 1, ranges: 0, skipped: 0 }), /snapshot/);
});

test("purge formatters (TASK-032)", () => {
  assert.equal(tokens.purged({ runs: 2, keys: 1, current_key: "removed" }), "PURGED runs=2 keys=1 current-key=removed");
  assert.equal(tokens.purged({ runs: 0, keys: 0, current_key: "kept" }), "PURGED runs=0 keys=0 current-key=kept");
  assert.throws(() => tokens.purged({ runs: -1, keys: 0, current_key: "kept" }), /runs/);
  assert.throws(() => tokens.purged({ runs: 0, keys: 1.5, current_key: "kept" }), /keys/);
  assert.throws(() => tokens.purged({ runs: 0, keys: 0, current_key: "deleted" }), /removed\|kept/);
  assert.equal(tokens.purgePlan(".agents/security-testing/runs/0123456789ab-0001"), "PURGE .agents/security-testing/runs/0123456789ab-0001");
  assert.throws(() => tokens.purgePlan("/abs"), /repo-relative/);
  assert.throws(() => tokens.purgePlan("../out"), /repo-relative/);
  assert.equal(tokens.tracked(".agents/security-testing/private/keys/k0123456789ab"), "TRACKED(.agents/security-testing/private/keys/k0123456789ab)");
  assert.throws(() => tokens.tracked("/abs"), /repo-relative/);
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

test("citation reasons (TASK-014): the five checkRange spellings", () => {
  assert.equal(tokens.RANGE_INVALID, "RANGE-INVALID");
  assert.equal(tokens.RANGE_TOO_LONG, "RANGE-TOO-LONG");
  assert.equal(tokens.PATH_NOT_IN_SCOPE, "PATH-NOT-IN-SCOPE");
  assert.equal(tokens.SIDE_MISMATCH, "SIDE-MISMATCH");
  assert.equal(tokens.RANGE_NOT_ADMITTED, "RANGE-NOT-ADMITTED");
});

test("ingest tracker-readback rows (TASK-017): `READBACK: ok | MISMATCH(<field>)` over the closed field list", () => {
  assert.equal(tokens.READBACK_OK, "READBACK: ok");
  assert.deepEqual(tokens.READBACK_FIELDS, ["url", "title", "body"]);
  for (const field of tokens.READBACK_FIELDS) assert.equal(tokens.readbackMismatch(field), `READBACK: MISMATCH(${field})`);
  assert.throws(() => tokens.readbackMismatch("labels"), /closed vocabulary/);
  assert.throws(() => tokens.readbackMismatch(""), /closed vocabulary/);
});

test("packet rows (TASK-057): `PACKET <path> sha256=<h> kind=<k> files=<n>`; the kind copy agrees with packet-core", async () => {
  const { PACKET_KINDS } = await import("./packet-core.mjs");
  const sha = "a".repeat(64);
  assert.equal(tokens.packetLine({ relPath: ".agents/security-testing/runs/0123456789ab-0001/packets/x.json", sha256: sha, kind: "scope", files: 2 }), `PACKET .agents/security-testing/runs/0123456789ab-0001/packets/x.json sha256=${sha} kind=scope files=2`);
  for (const kind of PACKET_KINDS) assert.doesNotThrow(() => tokens.packetLine({ relPath: "p.json", sha256: sha, kind, files: 0 }), kind);
  assert.throws(() => tokens.packetLine({ relPath: "p.json", sha256: sha, kind: "review", files: 0 }), /closed vocabulary/);
  assert.throws(() => tokens.packetLine({ relPath: "/abs/p.json", sha256: sha, kind: "scope", files: 0 }), /repo-relative/);
  assert.throws(() => tokens.packetLine({ relPath: "p.json", sha256: "zz", kind: "scope", files: 0 }), /sha256/);
  assert.throws(() => tokens.packetLine({ relPath: "p.json", sha256: sha, kind: "scope", files: -1 }), /files/);
  assert.throws(() => tokens.packetLine({ relPath: "p.json", sha256: sha, kind: "scope", files: 1.5 }), /files/);
  assert.ok(!("NOT_IMPLEMENTED_SUBJECT_PACKET" in tokens), "the TASK-057 stub row left with TASK-021");
});

test("packet --kind subject rows (TASK-021): `UNVERIFIABLE-SUBJECT(<id>)` over a finding id only", () => {
  const id = "b".repeat(64);
  assert.equal(tokens.unverifiableSubject(id), `UNVERIFIABLE-SUBJECT(${id})`);
  assert.throws(() => tokens.unverifiableSubject("M-001"), /finding id/);
  assert.throws(() => tokens.unverifiableSubject(id.toUpperCase()), /finding id/);
  assert.throws(() => tokens.unverifiableSubject(""), /finding id/);
});

test("gate rows (TASK-019): the two citation states, `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>`, CLAIMS-PACKET-MISMATCH(<file>), GATE-EXISTS and gate's own rejection reasons", () => {
  assert.equal(tokens.CITATION_VERIFIED, "CITATION_VERIFIED");
  assert.equal(tokens.CITATION_FAILED, "CITATION_FAILED");
  assert.equal(tokens.gateLine({ accepted: 3, unverifiable: 1, rejected: 2, unlocated: 8 }), "GATE accepted=3 unverifiable=1 rejected=2 unlocated=8");
  assert.equal(tokens.gateLine({ accepted: 0, unverifiable: 0, rejected: 0, unlocated: 0 }), "GATE accepted=0 unverifiable=0 rejected=0 unlocated=0");
  assert.throws(() => tokens.gateLine({ accepted: -1, unverifiable: 0, rejected: 0, unlocated: 0 }), /accepted/);
  assert.throws(() => tokens.gateLine({ accepted: 0, unverifiable: 0.5, rejected: 0, unlocated: 0 }), /unverifiable/);
  assert.throws(() => tokens.gateLine({ accepted: 0, unverifiable: 0, rejected: "0", unlocated: 0 }), /rejected/);
  assert.throws(() => tokens.gateLine({ accepted: 0, unverifiable: 0, rejected: 0 }), /unlocated/);
  assert.equal(tokens.claimsPacketMismatch(".agents/security-testing/receipts/r/claims-1.json"), "CLAIMS-PACKET-MISMATCH(.agents/security-testing/receipts/r/claims-1.json)");
  assert.throws(() => tokens.claimsPacketMismatch(""), /file/);
  assert.throws(() => tokens.claimsPacketMismatch("a\nb"), /file/);
  assert.equal(tokens.GATE_EXISTS, "GATE-EXISTS");
  const reasons = [tokens.GATE_AGENT_WROTE_ID, tokens.GATE_CLAIM_INVALID, tokens.GATE_PATH_NOT_AT_SIDE, tokens.GATE_RANGE_OUTSIDE_FILE, tokens.GATE_FILE_NOT_TEXT, tokens.GATE_DUPLICATE_ID];
  assert.deepEqual(reasons, ["agent-wrote-id", "claim-invalid", "PATH-NOT-AT-SIDE", "RANGE-OUTSIDE-FILE", "FILE-NOT-TEXT", "duplicate-id"]);
  const cite = [tokens.RANGE_INVALID, tokens.RANGE_TOO_LONG, tokens.PATH_NOT_IN_SCOPE, tokens.SIDE_MISMATCH, tokens.RANGE_NOT_ADMITTED];
  assert.equal(new Set([...reasons, ...cite]).size, reasons.length + cite.length, "gate's reasons never collide with cite's");
});

test("coverage rows (TASK-020): EXAMINED-PACKET-MISMATCH, COVERAGE-EXISTS, `COVERAGE INDETERMINATE`, OVERLAP/GAP(<path>:<a>-<b>) and the COVERAGE line", () => {
  assert.equal(tokens.EXAMINED_PACKET_MISMATCH, "EXAMINED-PACKET-MISMATCH");
  assert.equal(tokens.COVERAGE_EXISTS, "COVERAGE-EXISTS");
  assert.equal(tokens.COVERAGE_INDETERMINATE, "COVERAGE INDETERMINATE");
  assert.equal(tokens.overlap("src/db.js", 3, 4), "OVERLAP(src/db.js:3-4)");
  assert.equal(tokens.overlap("src/db.js", 3, 3), "OVERLAP(src/db.js:3-3)");
  assert.equal(tokens.gap("src/app.js", 1, 10), "GAP(src/app.js:1-10)");
  assert.throws(() => tokens.overlap("", 1, 2), /path/);
  assert.throws(() => tokens.overlap("p", 0, 2), /range/);
  assert.throws(() => tokens.gap("p", 3, 2), /range/);
  assert.throws(() => tokens.gap("p", 1.5, 2), /range/);
  assert.equal(tokens.coverageLine({ examined: 3, skipped: 1, scanner: 2 }), "COVERAGE examined=3 skipped=1 scanner=2");
  assert.equal(tokens.coverageLine({ examined: 0, skipped: 0, scanner: 0 }), "COVERAGE examined=0 skipped=0 scanner=0");
  assert.throws(() => tokens.coverageLine({ examined: -1, skipped: 0, scanner: 0 }), /examined/);
  assert.throws(() => tokens.coverageLine({ examined: 1, skipped: 0.5, scanner: 0 }), /skipped/);
  assert.throws(() => tokens.coverageLine({ examined: 1, skipped: 0 }), /scanner/);
});

test("receipt rows (TASK-022): the six derived states, the not-applied reasons, REJECTED(<reason>) and its reasons, the RECEIPT / STATE / not-applied / conflicts lines", () => {
  assert.equal(tokens.REVIEW_CONFIRMED, "REVIEW_CONFIRMED");
  assert.equal(tokens.REVIEW_REFUTED, "REVIEW_REFUTED");
  assert.equal(tokens.REVIEW_INDETERMINATE, "REVIEW_INDETERMINATE");
  assert.equal(tokens.MITIGATION_CONFIRMED, "MITIGATION_CONFIRMED");
  assert.equal(tokens.MITIGATION_GAP, "MITIGATION_GAP");
  assert.equal(tokens.MITIGATION_INDETERMINATE, "MITIGATION_INDETERMINATE");
  assert.deepEqual(
    [tokens.NOT_APPLIED_PACKET_UNKNOWN, tokens.NOT_APPLIED_SUBJECT_NOT_IN_PACKET, tokens.NOT_APPLIED_CITATION_FAILED, tokens.NOT_APPLIED_SUBJECT_IS_FINDING, tokens.NOT_APPLIED_REVIEW_REFUTED],
    ["packet-unknown", "subject-not-in-packet", "citation-failed", "subject-is-finding", "review-refuted"],
  );
  assert.equal(tokens.rejected("unknown packet"), "REJECTED(unknown packet)");
  assert.throws(() => tokens.rejected(""), /reason/);
  assert.throws(() => tokens.rejected("a\nb"), /reason/);
  assert.equal(tokens.receiptSchemaReason("x is required"), "schema: x is required");
  assert.equal(tokens.receiptForbiddenReason("state"), "forbidden field state");
  assert.equal(tokens.RECEIPT_UNKNOWN_PACKET, "unknown packet");
  assert.equal(tokens.RECEIPT_SCOPE_PACKET, "scope packet");
  assert.equal(tokens.RECEIPT_PACKET_SHA_MISMATCH, "packet_sha256 mismatch");
  assert.equal(tokens.RECEIPT_SUBJECT_NOT_IN_PACKET, "subject_id not in packet.subject_ids");
  assert.equal(tokens.RECEIPT_RUN_MISMATCH, "reviewer_run_id != run");
  assert.equal(tokens.receiptOidMismatch("src/db.js"), "oid mismatch src/db.js");
  assert.throws(() => tokens.receiptOidMismatch(""), /path/);
  const sha = "a".repeat(64);
  assert.equal(tokens.receiptLine({ sha256: sha, type: "vulnerability-review", subject: "b".repeat(64) }), `RECEIPT admitted sha256=${sha} type=vulnerability-review subject=${"b".repeat(64)}`);
  assert.equal(tokens.receiptLine({ sha256: sha, type: "mitigation-review", subject: "M-001" }), `RECEIPT admitted sha256=${sha} type=mitigation-review subject=M-001`);
  assert.throws(() => tokens.receiptLine({ sha256: "zz", type: "ack", subject: "M-001" }), /sha256/);
  assert.throws(() => tokens.receiptLine({ sha256: sha, type: "review", subject: "M-001" }), /type/);
  assert.throws(() => tokens.receiptLine({ sha256: sha, type: "ack", subject: "M 001" }), /subject/);
  assert.equal(tokens.stateLine("M-001", "MITIGATION_GAP"), "STATE M-001 MITIGATION_GAP");
  assert.equal(tokens.stateLine(sha, "CITATION_VERIFIED"), `STATE ${sha} CITATION_VERIFIED`);
  assert.throws(() => tokens.stateLine(sha, "CONFIRMED"), /state/);
  assert.throws(() => tokens.stateLine("", "REVIEW_CONFIRMED"), /subject/);
  assert.equal(tokens.notAppliedLine(0), "not-applied: 0");
  assert.equal(tokens.conflictsLine(2), "conflicts: 2");
  assert.throws(() => tokens.notAppliedLine(-1), /n/);
  assert.throws(() => tokens.conflictsLine(1.5), /n/);
});

test("build-report rows (TASK-023): REPORT_TEMPLATES, REPORT <path>, MANIFEST sha256=<h>, the report wordings and the ORIGIN line", () => {
  assert.deepEqual(tokens.REPORT_TEMPLATES, ["review", "assessment", "verify", "threat-model"]);
  assert.equal(tokens.reportLine(".agents/security-testing/runs/abcdef012345-0001/report.md"), "REPORT .agents/security-testing/runs/abcdef012345-0001/report.md");
  assert.throws(() => tokens.reportLine("/abs/report.md"), /repo-relative/);
  assert.throws(() => tokens.reportLine("../report.md"), /repo-relative/);
  const sha = "a".repeat(64);
  assert.equal(tokens.manifestLine(sha), `MANIFEST sha256=${sha}`);
  assert.throws(() => tokens.manifestLine("zz"), /sha256/);
  assert.equal(tokens.NOT_ASSESSED, "unknown / not assessed");
  assert.equal(tokens.NOT_INDEPENDENTLY_REVIEWED, "not independently reviewed");
  assert.equal(tokens.ORIGIN_UNAUTHENTICATED, "ORIGIN: unauthenticated");
  assert.equal(tokens.COMMITTED, "COMMITTED");
});

test("verify all rows (TASK-027): the refusal tokens, NEXT / REGISTER lines, the step lines, the tests vocabulary and the indicator kinds", () => {
  assert.equal(tokens.UNKNOWN_FINDING, "UNKNOWN-FINDING");
  assert.equal(tokens.UNVERIFIED_REFUTED_FINDING, "UNVERIFIED-REFUTED-FINDING");
  assert.equal(tokens.NEXT_FIX_REVIEW, "NEXT: dispatch security-reviewer fix-review");
  assert.equal(tokens.REGISTER_NO_ROW, "REGISTER: no row for finding");
  assert.equal(tokens.BRANCH_COMMITTED, "COMMITTED");
  assert.equal(tokens.BRANCH_NOT_COMMITTED, "NOT-COMMITTED");
  assert.equal(tokens.BRANCH_PATH_UNTOUCHED, "PATH-UNTOUCHED");
  assert.equal(tokens.branchLine("PATH-UNTOUCHED"), "BRANCH PATH-UNTOUCHED");
  assert.throws(() => tokens.branchLine("MERGED"), /closed vocabulary/);
  const oid = "a".repeat(40);
  assert.equal(tokens.treeBeforeLine(oid), `TREE-BEFORE ${oid}`);
  assert.throws(() => tokens.treeBeforeLine("abc"), /oid/);
  assert.equal(tokens.installLine({ ran: true, tracked_changes: 1, untracked: 412, bytes: 18324511 }), "INSTALL ran tracked_changes=1 untracked=412 bytes=18324511");
  assert.equal(tokens.installLine({ ran: false, tracked_changes: 0, untracked: 0, bytes: 0 }), "INSTALL skipped tracked_changes=0 untracked=0 bytes=0");
  assert.throws(() => tokens.installLine({ ran: "yes", tracked_changes: 0, untracked: 0, bytes: 0 }), /ran/);
  assert.equal(tokens.suppressionLine({ indicators: 2, deletion_only: false }), "SUPPRESSION indicators=2 deletion_only=false");
  assert.throws(() => tokens.suppressionLine({ indicators: 2, deletion_only: "no" }), /deletion_only/);
  for (const [name, value] of [["TESTS_PASS", "TESTS_PASS"], ["TESTS_FAIL", "TESTS_FAIL"], ["NO_TEST_SURFACE", "NO_TEST_SURFACE"], ["TESTS_INDETERMINATE", "TESTS_INDETERMINATE"]]) assert.equal(tokens[name], value);
  assert.equal(tokens.TESTS_REASON_INSTALL_MODIFIED_TREE, "install-modified-tree");
  assert.equal(tokens.TESTS_REASON_NO_SURFACE, "execute_project_tests absent from engagement.md");
  assert.equal(tokens.argvRejected("first token is not on the allowlist"), "argv-rejected(first token is not on the allowlist)");
  assert.equal(tokens.installArgvRejected("run without test"), "install-argv-rejected(run without test)");
  assert.throws(() => tokens.argvRejected("a (b)"), /parentheses/);
  const sha = "b".repeat(64);
  assert.equal(tokens.testsLine({ result: "TESTS_PASS", exe: "/usr/local/bin/node", sha256: sha }), `TESTS TESTS_PASS exe=/usr/local/bin/node sha256=${sha}`);
  assert.equal(tokens.testsLine({ result: "NO_TEST_SURFACE", reason: tokens.TESTS_REASON_NO_SURFACE }), "TESTS NO_TEST_SURFACE");
  assert.equal(tokens.testsLine({ result: "TESTS_INDETERMINATE", reason: "install-modified-tree" }), "TESTS TESTS_INDETERMINATE(install-modified-tree)");
  assert.equal(tokens.testsLine({ result: "TESTS_INDETERMINATE", reason: "timeout", exe: "/usr/local/bin/node", sha256: sha }), `TESTS TESTS_INDETERMINATE(timeout) exe=/usr/local/bin/node sha256=${sha}`);
  assert.throws(() => tokens.testsLine({ result: "TESTS_INDETERMINATE" }), /reason/);
  assert.throws(() => tokens.testsLine({ result: "TESTS_PASS", exe: "/a b", sha256: sha }), /whitespace/);
  assert.throws(() => tokens.testsLine({ result: "PASSED" }), /closed vocabulary/);
  assert.deepEqual([tokens.INDICATOR_IGNORE_FILE_EDIT, tokens.INDICATOR_INLINE_SUPPRESS, tokens.INDICATOR_TEST_SKIP], ["ignore-file-edit", "inline-suppress", "test-skip"]);
});

test("publish / check-export rows (TASK-031): PUBLISH_PROFILES, `PUBLISHED profile=<p> output=<path> sha256=<h>`, `DEDUPE finding=<id> existing=<url>`, the NEXT line, VERIFIED-DERIVATIVE, LINKED-ONLY, MISMATCH(output)", () => {
  assert.deepEqual([...tokens.PUBLISH_PROFILES], ["redacted-report", "full-report", "tracker", "handoff", "case"]);
  const h = "a".repeat(64);
  assert.equal(tokens.publishedLine({ profile: "redacted-report", relPath: "reports/security/r/report.md", sha256: h }), `PUBLISHED profile=redacted-report output=reports/security/r/report.md sha256=${h}`);
  assert.throws(() => tokens.publishedLine({ profile: "pdf", relPath: "reports/x", sha256: h }), /profile/);
  assert.throws(() => tokens.publishedLine({ profile: "tracker", relPath: "/abs", sha256: h }), /repo-relative/);
  assert.throws(() => tokens.publishedLine({ profile: "tracker", relPath: "x", sha256: "zz" }), /sha256/);
  assert.equal(tokens.dedupeLine({ finding: h, existing: "https://github.com/o/r/issues/1" }), `DEDUPE finding=${h} existing=https://github.com/o/r/issues/1`);
  assert.throws(() => tokens.dedupeLine({ finding: "R-0001", existing: "https://x" }), /finding id/);
  assert.throws(() => tokens.dedupeLine({ finding: h, existing: "" }), /existing/);
  assert.throws(() => tokens.dedupeLine({ finding: h, existing: "two\nlines" }), /existing/);
  const p = `.agents/security-testing/handoffs/${h}.ticket.json`;
  assert.equal(tokens.nextPost(p), `NEXT: post ${p} via issue-tracking, then ingest tracker-readback --sent ${p} <response.json>`);
  assert.throws(() => tokens.nextPost("../x"), /repo-relative/);
  assert.equal(tokens.VERIFIED_DERIVATIVE, "VERIFIED-DERIVATIVE");
  assert.equal(tokens.LINKED_ONLY, "LINKED-ONLY");
  assert.equal(tokens.MISMATCH_OUTPUT, "MISMATCH(output)");
});

test("every exported token is a string constant or a function; every constant is one line", () => {
  for (const [name, value] of Object.entries(tokens)) {
    if (name === "FORBIDDEN_STRINGS" || name === "REGISTER_STATUSES" || name === "REGISTER_PRIORITIES" || name === "READBACK_FIELDS" || name === "REPORT_TEMPLATES" || name === "PUBLISH_PROFILES" || name === "DISPOSITION_KINDS" || value instanceof RegExp) continue;
    assert.ok(typeof value === "string" || typeof value === "function", `${name}: ${typeof value}`);
    if (typeof value === "string") assert.doesNotMatch(value, /\n/, name);
  }
});

test("assessment / threat-model rows (TASK-024): the TL-16 sentence names sign-off; DISPOSITION_KINDS is spec §6.10's closed list in spec order", () => {
  assert.match(tokens.INCOMPLETE_RUNS_SEE_SIGN_OFF, /^see sign-off /);
  assert.ok(tokens.INCOMPLETE_RUNS_SEE_SIGN_OFF.includes("TL-3"));
  assert.deepEqual(tokens.DISPOSITION_KINDS, ["undisposed", "planned", "executed", "ticketed", "accepted", "mitigated"]);
  assert.ok(Object.isFrozen(tokens.DISPOSITION_KINDS));
});

test("check rows (TASK-025; spec §6.3, plan §4.1 row `check`): the four result lines are spelled exactly, the counted forms take a positive integer", () => {
  assert.equal(tokens.CONSISTENT, "CONSISTENT");
  assert.equal(tokens.STRUCTURE_ONLY, "STRUCTURE-ONLY");
  assert.equal(tokens.CURRENT, "CURRENT");
  assert.equal(tokens.ORIGIN_MATCHES_SUPPLIED_DIGEST, "ORIGIN: matches supplied digest");
  assert.equal(tokens.consistentRedactedOnly(1), "CONSISTENT-REDACTED-ONLY(1 citations)");
  assert.equal(tokens.consistentRedactedOnly(12), "CONSISTENT-REDACTED-ONLY(12 citations)");
  assert.equal(tokens.citationDrifted(1), "CITATION-DRIFTED(1)");
  assert.equal(tokens.scopeDrifted(3), "SCOPE-DRIFTED(3 files)");
  for (const bad of [0, -1, 1.5, "2", undefined]) {
    assert.throws(() => tokens.consistentRedactedOnly(bad), TypeError, `consistentRedactedOnly(${String(bad)})`);
    assert.throws(() => tokens.citationDrifted(bad), TypeError, `citationDrifted(${String(bad)})`);
    assert.throws(() => tokens.scopeDrifted(bad), TypeError, `scopeDrifted(${String(bad)})`);
  }
  // the INCONSISTENT fields check spells: the input-hash form, the snapshot form, the marker
  assert.equal(tokens.inconsistent("input:scope"), "INCONSISTENT(input:scope)");
  assert.equal(tokens.inconsistent("snapshot:src/app.js"), "INCONSISTENT(snapshot:src/app.js)");
  assert.equal(tokens.incomplete(tokens.COMMITTED), "INCOMPLETE(COMMITTED)");
});

test("tm-lint rows (TASK-039; plan §4.4, PM rulings R1/R2): TM-INVALID(<threat|element>: <reason>) over the closed locus shapes, the TM line, the RENDER line, RENDER-EXISTS, the R2 wording", () => {
  assert.equal(tokens.tmInvalid("E-001", 'missing required "citation"'), 'TM-INVALID(E-001: missing required "citation")');
  assert.equal(tokens.tmInvalid("T-007", "mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (not independently reviewed)"), "TM-INVALID(T-007: mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (not independently reviewed))");
  assert.equal(tokens.tmInvalid("elements[0]", "id: expected string, got integer"), "TM-INVALID(elements[0]: id: expected string, got integer)");
  assert.equal(tokens.tmInvalid("threats[2]", "x"), "TM-INVALID(threats[2]: x)");
  assert.equal(tokens.tmInvalid("model", 'unknown key "extra"'), 'TM-INVALID(model: unknown key "extra")');
  for (const bad of ["M-001", "E-1", "elements", "threat-model", "", undefined]) assert.throws(() => tokens.tmInvalid(bad, "reason"), TypeError, `locus ${String(bad)}`);
  for (const bad of ["", "two\nlines", undefined]) assert.throws(() => tokens.tmInvalid("E-001", bad), TypeError, `reason ${String(bad)}`);
  assert.equal(tokens.TM_DIRTY_CITATION, "cites a dirty file; build the model on an assessment run");
  assert.equal(tokens.tmInvalid("E-001", tokens.TM_DIRTY_CITATION), "TM-INVALID(E-001: cites a dirty file; build the model on an assessment run)");
  assert.equal(tokens.tmLine({ elements: 3, threats: 7, undisposed: 0 }), "TM elements=3 threats=7 undisposed=0");
  assert.throws(() => tokens.tmLine({ elements: 3, threats: 7 }), TypeError);
  assert.throws(() => tokens.tmLine({ elements: -1, threats: 7, undisposed: 0 }), TypeError);
  assert.equal(tokens.tmRendered({ relPath: ".agents/security-testing/runs/0123456789ab-0001/threat-model.md", elements: 1, threats: 2 }), "RENDER .agents/security-testing/runs/0123456789ab-0001/threat-model.md elements=1 threats=2");
  assert.throws(() => tokens.tmRendered({ relPath: "/abs/threat-model.md", elements: 1, threats: 2 }), TypeError);
  assert.equal(tokens.RENDER_EXISTS, "RENDER-EXISTS");
  assert.equal(tokens.SNAPSHOT_EXISTS, "SNAPSHOT-EXISTS", "check reuses TASK-058's token for a different model on a snapshotted run");
});

test("tracker read-back → ticketed rows (TASK-045; plan §4.1 row `ingest`, §5 TASK-045): `TICKETED <R-id> <url>` and the no-row variant of READBACK: ok", () => {
  assert.equal(tokens.READBACK_OK_NO_ROW, "READBACK: ok (no register row)");
  assert.ok(tokens.READBACK_OK_NO_ROW.startsWith(tokens.READBACK_OK), "the variant extends the ok line; a reader matching `READBACK: ok` still sees it");
  assert.equal(tokens.ticketedLine({ row: "R-0007", url: "https://github.com/o/r/issues/7" }), "TICKETED R-0007 https://github.com/o/r/issues/7");
  assert.throws(() => tokens.ticketedLine({ row: "R-7", url: "https://github.com/o/r/issues/7" }), /R-nnnn/);
  assert.throws(() => tokens.ticketedLine({ row: "R-0007", url: "" }), /url/);
  assert.throws(() => tokens.ticketedLine({ row: "R-0007", url: "two\nlines" }), /url/);
  assert.throws(() => tokens.ticketedLine({ row: "R-0007", url: "with space" }), /url/);
});

test("plan admit | propose rows (TASK-042; plan §4.5, §5 TASK-042; spec §9.1): the ADMISSION line over the three classifications, ADMISSION-EXISTS, RECEIPT-MISMATCH(<reason>), the PROPOSAL line, PROPOSAL-UNDER-TASKS and the NEXT line", () => {
  const sha = "a".repeat(64);
  for (const classification of ["admitted-heuristic", "admitted-reviewed", "proposal"]) {
    assert.equal(tokens.admissionLine({ case_sha256: sha, classification, hits: 2 }), `ADMISSION case=${sha} classification=${classification} hits=2`);
  }
  assert.throws(() => tokens.admissionLine({ case_sha256: sha, classification: "admitted", hits: 0 }), /classification/);
  assert.throws(() => tokens.admissionLine({ case_sha256: "abc", classification: "proposal", hits: 0 }), /case_sha256/);
  assert.throws(() => tokens.admissionLine({ case_sha256: sha, classification: "proposal", hits: -1 }), /hits/);
  assert.equal(tokens.ADMISSION_EXISTS, "ADMISSION-EXISTS");
  assert.equal(tokens.receiptMismatch("receipt subject x is not this case"), "RECEIPT-MISMATCH(receipt subject x is not this case)");
  assert.throws(() => tokens.receiptMismatch(""), /reason/);
  assert.throws(() => tokens.receiptMismatch("two\nlines"), /reason/);
  assert.equal(tokens.proposalLine({ relPath: ".agents/security-testing/proposals/P-001.proposal.md", id: "P-001", sha256: sha }), `PROPOSAL .agents/security-testing/proposals/P-001.proposal.md id=P-001 sha256=${sha}`);
  assert.throws(() => tokens.proposalLine({ relPath: ".agents/x.md", id: "P-1", sha256: sha }), /P-nnn/);
  assert.throws(() => tokens.proposalLine({ relPath: "/abs/x.md", id: "P-001", sha256: sha }), /relPath|repo-relative/);
  assert.throws(() => tokens.proposalLine({ relPath: ".agents/x.md", id: "P-001", sha256: "zz" }), /sha256/);
  assert.equal(tokens.PROPOSAL_UNDER_TASKS, "PROPOSAL-UNDER-TASKS");
  assert.equal(tokens.nextSnapshotProposals("abcdefabcdef-0001"), "NEXT: run snapshot proposals --run abcdefabcdef-0001");
  assert.throws(() => tokens.nextSnapshotProposals("abc"), /run_id|run id/i);
});
