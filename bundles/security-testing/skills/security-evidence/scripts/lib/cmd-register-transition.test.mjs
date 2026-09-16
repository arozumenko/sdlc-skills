// TASK-029 — `register.mjs accept|revoke|check|close-false-positive|reopen|
// supersede|alias|transition` (plan §4.3; US-021). The table itself is
// register-transitions.test.mjs; this file is the command layer: argv,
// tokens, what lands on disk.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll } from "../fixtures/cli/harness.mjs";
import { FINDING, FINDING_B, RUN, RUN_B, readAliases, readLog, readProjection, register, registerDir, repoWithEngagement, seedRows } from "../fixtures/register/seed.mjs";
import { GENESIS_SHA256 } from "./register-fold.mjs";
import { aliasSha256 } from "./register-transitions.mjs";

after(cleanupAll);

const APPROVE = ["--approved-by", "cto", "--approval-ref", "RISK-12"];
const seeded = (rows = [["a", "p1"]]) => seedRows(repoWithEngagement(), rows);

test("accept: open ⇒ accepted with the unauthenticated acceptance record; ROW line; event payload = the record", async () => {
  const repo = await seeded();
  const r = await register(repo, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=accepted priority=p1 seq=2\n");
  assert.equal(r.stderr, "");
  const [, event] = readLog(repo);
  assert.deepEqual(event, {
    seq: 2,
    prev_sha256: event.prev_sha256,
    ts: "2026-09-16T10:00:00Z",
    actor: "lead",
    row_id: "R-0001",
    event: "accept",
    payload: { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-12", authenticated: false, until: "2026-12-31" },
    ref: "RISK-12",
  });
  const row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "accepted");
  assert.deepEqual(row.acceptance, event.payload);
  assert.equal(row.acceptance.authenticated, false);
  assert.ok(!readFileSync(join(registerDir(repo), "projection.json"), "utf8").includes("true"), "nothing in the projection is authenticated");
});

test("accept without both flags rejected: --approved-by and --approval-ref are each mandatory (exit 2, nothing written); so for revoke and close-false-positive", async () => {
  const repo = await seeded();
  const cases = [
    ["accept", "R-0001", "--until", "2026-12-31"],
    ["accept", "R-0001", "--until", "2026-12-31", "--approved-by", "cto"],
    ["accept", "R-0001", "--until", "2026-12-31", "--approval-ref", "RISK-12"],
    ["accept", "R-0001", ...APPROVE],
    ["accept", "R-0001", "--until", "12/31/2026", ...APPROVE],
    ["accept", "R-0001", "--until", "2026-02-30", ...APPROVE],
    ["accept", ...APPROVE, "--until", "2026-12-31"],
    ["accept", "R-1", "--until", "2026-12-31", ...APPROVE],
    ["revoke", "R-0001"],
    ["revoke", "R-0001", "--approved-by", "cto"],
    ["close-false-positive", "R-0001"],
    ["close-false-positive", "R-0001", "--approval-ref", "x"],
    ["reopen", "R-0001"],
    ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE, "--nope"],
    ["accept", "R-0001", "extra", "--until", "2026-12-31", ...APPROVE],
  ];
  for (const argv of cases) {
    const r = await register(repo, argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, new RegExp(`^USAGE\\(${argv[0]}: `), argv.join(" "));
  }
  assert.equal(readLog(repo).length, 1, "nothing written");
  assert.equal(readProjection(repo).rows["R-0001"].status, "open");
});

test("a pair outside the table ⇒ exit 4 TRANSITION-REJECTED(<event>: <from>), including a row that does not exist (from -)", async () => {
  const repo = await seeded();
  const revoke = await register(repo, ["revoke", "R-0001", ...APPROVE]);
  assert.equal(revoke.code, 4);
  assert.equal(revoke.stdout, "TRANSITION-REJECTED(revoke: open)\n");
  const reopen = await register(repo, ["reopen", "R-0001", "--reason", "r"]);
  assert.equal(reopen.stdout, "TRANSITION-REJECTED(reopen: open)\n");
  const missing = await register(repo, ["accept", "R-0002", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(missing.code, 4);
  assert.equal(missing.stdout, "TRANSITION-REJECTED(accept: -)\n");
  await register(repo, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  const twice = await register(repo, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(twice.code, 4);
  assert.equal(twice.stdout, "TRANSITION-REJECTED(accept: accepted)\n");
  const fp = await register(repo, ["close-false-positive", "R-0001", ...APPROVE]);
  assert.equal(fp.stdout, "TRANSITION-REJECTED(close-false-positive: accepted)\n");
  assert.equal(readLog(repo).length, 2);
});

test("revoke: accepted ⇒ open, the acceptance is gone, the revoke approval is in the log only", async () => {
  const repo = await seeded();
  await register(repo, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  const r = await register(repo, ["revoke", "R-0001", "--approved-by", "ciso", "--approval-ref", "RISK-12-rev"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=open priority=p1 seq=3\n");
  const [, , event] = readLog(repo);
  assert.deepEqual(event.payload, { recorded_by: "lead", approved_by: "ciso", approval_ref: "RISK-12-rev", authenticated: false });
  const row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "open");
  assert.ok(!("acceptance" in row));
});

test("close-false-positive then reopen: the false_positive record is unauthenticated and reopen keeps the reason as rationale", async () => {
  const repo = await seeded();
  const fp = await register(repo, ["close-false-positive", "R-0001", ...APPROVE]);
  assert.equal(fp.code, 0, fp.stdout + fp.stderr);
  assert.equal(fp.stdout, "ROW R-0001 status=false-positive priority=p1 seq=2\n");
  let row = readProjection(repo).rows["R-0001"];
  assert.deepEqual(row.false_positive, { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-12", authenticated: false });
  const re = await register(repo, ["reopen", "R-0001", "--reason", "reproduced on staging"]);
  assert.equal(re.code, 0, re.stdout + re.stderr);
  assert.equal(re.stdout, "ROW R-0001 status=open priority=p1 seq=3\n");
  row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "open");
  assert.ok(!("false_positive" in row));
  assert.equal(row.rationale, "reproduced on staging");
  assert.deepEqual(readLog(repo)[2].payload, { reason: "reproduced on staging" });
});

test("operator text is redacted before it is chained or stored (G-4): approval refs, reasons, alias reasons", async () => {
  const repo = await seeded();
  await register(repo, ["close-false-positive", "R-0001", "--approved-by", "cto", "--approval-ref", "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"]);
  await register(repo, ["reopen", "R-0001", "--reason", "password=hunter2 was real"]);
  await register(repo, ["alias", "--from", FINDING, "--to", FINDING_B, "--reason", "password=hunter2 moved", "--run", RUN]);
  for (const name of ["events.jsonl", "projection.json", "finding-alias.jsonl"]) {
    const text = readFileSync(join(registerDir(repo), name), "utf8");
    assert.ok(!text.includes("hunter2"), name);
    assert.ok(!text.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), name);
  }
});

test("alias: appends a chained line to finding-alias.jsonl, no row event; usage guards; a broken alias chain is CORRUPT", async () => {
  const repo = await seeded();
  const bad = [
    ["alias"],
    ["alias", "--from", FINDING, "--to", FINDING_B, "--reason", "r"],
    ["alias", "--from", "T-001", "--to", FINDING_B, "--reason", "r", "--run", RUN],
    ["alias", "--from", FINDING, "--to", "nope", "--reason", "r", "--run", RUN],
    ["alias", "--from", FINDING, "--to", FINDING, "--reason", "r", "--run", RUN],
    ["alias", "--from", FINDING, "--to", FINDING_B, "--reason", "r", "--run", "nope"],
    ["alias", "R-0001", "--from", FINDING, "--to", FINDING_B, "--reason", "r", "--run", RUN],
  ];
  for (const argv of bad) {
    const r = await register(repo, argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(alias: /, argv.join(" "));
  }
  assert.ok(!existsSync(join(registerDir(repo), "finding-alias.jsonl")), "no alias file until the first alias");

  const a = await register(repo, ["alias", "--from", FINDING, "--to", FINDING_B, "--reason", "moved", "--run", RUN]);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  const b = await register(repo, ["alias", "--from", FINDING_B, "--to", "c".repeat(64), "--reason", "moved again", "--run", RUN_B]);
  assert.equal(b.stdout, `ALIAS from=${FINDING_B} to=${"c".repeat(64)} seq=2\n`);
  const aliases = readAliases(repo);
  assert.deepEqual(aliases[0], { from_id: FINDING, to_id: FINDING_B, reason: "moved", run_id: RUN, seq: 1, prev_sha256: GENESIS_SHA256 });
  assert.deepEqual(aliases[1], { from_id: FINDING_B, to_id: "c".repeat(64), reason: "moved again", run_id: RUN_B, seq: 2, prev_sha256: aliasSha256(aliases[0]) });
  assert.equal(readLog(repo).length, 1, "the row log is untouched");

  const { writeFileSync } = await import("node:fs");
  const path = join(registerDir(repo), "finding-alias.jsonl");
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace('"reason":"moved"', '"reason":"MOVED"')); // line 1 rewritten ⇒ line 2's prev_sha256 no longer matches
  const corrupt = await register(repo, ["alias", "--from", FINDING, "--to", "d".repeat(64), "--reason", "x", "--run", RUN]);
  assert.equal(corrupt.code, 5);
  assert.equal(corrupt.stdout, "CORRUPT\n");
  assert.equal(readAliases(repo).length, 2, "nothing appended");
  const status = await register(repo, ["status"]);
  assert.equal(status.code, 5, "every command runs the recovery rule over both chains");
});

test("transition <event> <R-id> [flags] is the generic form of the verbs; ticketed is refused; add is not a row transition", async () => {
  const repo = await seeded();
  const r = await register(repo, ["transition", "accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=accepted priority=p1 seq=2\n");
  const rv = await register(repo, ["transition", "revoke", "R-0001", ...APPROVE]);
  assert.equal(rv.stdout, "ROW R-0001 status=open priority=p1 seq=3\n");
  const ticketed = await register(repo, ["transition", "ticketed", "R-0001", "--ticket-url", "https://github.com/acme/app/issues/1"]);
  assert.equal(ticketed.code, 2);
  assert.equal(ticketed.stdout, "EMITTER-ONLY(ticketed)\n");
  for (const argv of [["transition"], ["transition", "accept"], ["transition", "add", "--subject", FINDING], ["transition", "alias", "--from", FINDING], ["transition", "check"], ["transition", "supersede", "R-0001"]]) {
    const bad = await register(repo, argv);
    assert.equal(bad.code, 2, argv.join(" "));
    assert.match(bad.stdout, /^USAGE\(transition: /, argv.join(" "));
  }
  assert.equal(readLog(repo).length, 3);
});

test("without engagement.md ⇒ ENGAGEMENT-MISSING; a corrupt register ⇒ CORRUPT before any verb runs", async () => {
  const { initRepo } = await import("../fixtures/cli/harness.mjs");
  const bare = initRepo();
  const r = await register(bare, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "ENGAGEMENT-MISSING\n");

  const repo = await seeded([["a", "p1"], ["b", "p1"]]);
  const { writeFileSync } = await import("node:fs");
  const log = join(registerDir(repo), "events.jsonl");
  const [first] = readFileSync(log, "utf8").split("\n");
  writeFileSync(log, `${first}\n`);
  const c = await register(repo, ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE]);
  assert.equal(c.code, 5);
  assert.equal(c.stdout, "CORRUPT\n");
});
