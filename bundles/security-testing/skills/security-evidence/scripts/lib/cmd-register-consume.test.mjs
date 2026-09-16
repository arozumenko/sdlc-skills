// TASK-030 — `register.mjs consume-verdict <verify.json>` (plan §4.3, spec
// §6.4 last paragraph; US-022). Inputs are the enveloped verify.json fixtures
// TASK-026 built under scripts/fixtures/verify/ — each is copied into the
// throwaway repo as <st>/runs/<run_id>/verify.json (ctx.input requires the
// file under the work tree). A row is brought to `fixed` / `regressed` only
// through consume-verdict itself (the events are emitter-only), by deriving a
// VERIFIED / REGRESSED artifact for the target finding id from a fixture.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, canonical, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { SCRIPTS_DIR, cleanupAll } from "../fixtures/cli/harness.mjs";
import { readLog, readProjection, register, repoWithEngagement, seedRows, stDir } from "../fixtures/register/seed.mjs";
import { RULES } from "../fixtures/verify/cases.mjs";
import { evaluate } from "./evaluate.mjs";

after(cleanupAll);

const APPROVE = ["--approved-by", "cto", "--approval-ref", "RISK-12"];
const FIXTURES = join(SCRIPTS_DIR, "fixtures", "verify");
const fixturePath = (rule) => join(FIXTURES, `${rule}.json`);
const fixture = (rule) => readArtifact(fixturePath(rule), { kind: "verify" });

/** Copy an artifact into the repo as <st>/runs/<run_id>/verify.json; returns the path the CLI is given (repo-relative). */
function place(repo, artifact, run_id = artifact.envelope.run_id) {
  const dir = join(stDir(repo), "runs", run_id);
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, "verify.json");
  writeFileSync(abs, `${canonical(artifact).toString("utf8")}\n`);
  return join(".agents", "security-testing", "runs", run_id, "verify.json");
}

const placeFixture = (repo, rule) => place(repo, fixture(rule));

/** A fresh verify artifact: `rule`'s payload with another finding id (and any overrides), re-enveloped under `run_id`. */
function derive(rule, { finding_id, run_id, ...overrides } = {}) {
  const { envelope, payload } = fixture(rule);
  const next = { ...payload, ...(finding_id === undefined ? {} : { finding_id }), ...overrides };
  const { evaluation: _e, ...raw } = next;
  next.evaluation = evaluate(raw);
  const head = { schema_version: envelope.schema_version, kind: "verify", run_id: run_id ?? envelope.run_id, engagement_id: envelope.engagement_id, key_id: envelope.key_id, now: () => envelope.created_at };
  return makeEnvelope(head, next);
}

const consume = (repo, path) => register(repo, ["consume-verdict", path]);

/** One open row whose subject is `finding`, then bring it to `status` through the real verbs / verdicts. */
async function rowAt(repo, finding, status) {
  await seedRows(repo, [["row", "p1", finding]]);
  if (status === "open") return;
  if (status === "accepted") {
    const r = await register(repo, ["accept", "R-0001", "--until", "2099-12-31", ...APPROVE]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    return;
  }
  const fixedRun = "0000000000aa-0001";
  const v = await consume(repo, place(repo, derive("verified-no-indicators", { finding_id: finding, run_id: fixedRun })));
  assert.equal(v.code, 0, `bring to fixed: ${v.stdout}${v.stderr}`);
  if (status === "fixed") return;
  assert.equal(status, "regressed");
  const r = await consume(repo, place(repo, derive("refound-row-fixed", { finding_id: finding, run_id: "0000000000aa-0002" })));
  assert.equal(r.code, 0, `bring to regressed: ${r.stdout}${r.stderr}`);
}

const findingOf = (rule) => fixture(rule).payload.finding_id;
const shaOf = (rule) => fixture(rule).envelope.self_sha256;

// ---------------------------------------------------------------------------

test("VERIFIED ⇒ fixed with ack_refs and last_verified_run (US-022 AC-1); CONSUMED + ROW lines; event payload and ref", async () => {
  const repo = repoWithEngagement();
  const rule = "verified-two-acks";
  const { envelope, payload } = fixture(rule);
  await rowAt(repo, payload.finding_id, "open");
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, [`CONSUMED VERIFIED row=R-0001 verify=${envelope.self_sha256}`, "ROW R-0001 status=fixed priority=p1 seq=2"].join("\n") + "\n");
  assert.equal(r.stderr, "");
  const log = readLog(repo);
  assert.equal(log.length, 2);
  assert.deepEqual(log[1], {
    seq: 2,
    prev_sha256: log[1].prev_sha256,
    ts: "2026-09-16T10:00:00Z",
    actor: "lead",
    row_id: "R-0001",
    event: "fixed",
    payload: { verify_sha256: envelope.self_sha256, ack_refs: payload.evaluation.ack_refs, last_verified_run: envelope.run_id },
    ref: envelope.run_id,
  });
  assert.equal(payload.evaluation.ack_refs.length, 2, "the fixture carries two acks");
  const row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "fixed");
  assert.deepEqual(row.ack_refs, payload.evaluation.ack_refs);
  assert.equal(row.last_verified_run, envelope.run_id);
});

test("VERIFIED on an accepted row ⇒ fixed, the acceptance record is gone, ack_refs empty when the diff had no indicators", async () => {
  const repo = repoWithEngagement();
  const rule = "verified-no-indicators";
  await rowAt(repo, findingOf(rule), "accepted");
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split("\n")[1], "ROW R-0001 status=fixed priority=p1 seq=3");
  const row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "fixed");
  assert.deepEqual(row.ack_refs, []);
  assert.ok(!("acceptance" in row), "fixed strips the acceptance (register-transitions invariant)");
});

test("REGRESSED ⇒ regressed, with the regression-observed event first (US-022 AC-2)", async () => {
  const repo = repoWithEngagement();
  const rule = "refound-row-fixed";
  await rowAt(repo, findingOf(rule), "fixed");
  const before = readLog(repo).length;
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(
    r.stdout,
    [`CONSUMED REGRESSED row=R-0001 verify=${shaOf(rule)}`, `ROW R-0001 status=fixed priority=p1 seq=${before + 1}`, `ROW R-0001 status=regressed priority=p1 seq=${before + 2}`].join("\n") + "\n",
  );
  const log = readLog(repo);
  assert.equal(log.length, before + 2);
  const [observed, regressed] = log.slice(-2);
  assert.equal(observed.event, "regression-observed");
  assert.deepEqual(observed.payload, { verify_sha256: shaOf(rule) });
  assert.equal(regressed.event, "regressed");
  assert.deepEqual(regressed.payload, { verify_sha256: shaOf(rule) });
  assert.equal(observed.seq + 1, regressed.seq, "the observation lands before the status change, as the evaluator's precedence says");
  const row = readProjection(repo).rows["R-0001"];
  assert.equal(row.status, "regressed");
  assert.equal(row.last_verified_run, "0000000000aa-0001", "regressed does not touch last_verified_run");
});

test("UNVERIFIED-* ⇒ verify-observed only, status unchanged; regression-observed still recorded when refound_observed (US-022 AC-3)", async () => {
  // §12 fixture: refound + tests unavailable ⇒ indeterminate AND the observation.
  const repo = repoWithEngagement();
  const rule = "refound-tests-unavailable";
  await rowAt(repo, findingOf(rule), "fixed");
  const before = readLog(repo).length;
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split("\n")[0], `CONSUMED UNVERIFIED-INDETERMINATE(tests) row=R-0001 verify=${shaOf(rule)}`);
  const log = readLog(repo);
  assert.equal(log.length, before + 2);
  assert.equal(log[before].event, "regression-observed");
  assert.deepEqual(log[before].payload, { verify_sha256: shaOf(rule) });
  assert.equal(log[before + 1].event, "verify-observed");
  assert.deepEqual(log[before + 1].payload, { verify_sha256: shaOf(rule), verdict: "UNVERIFIED-INDETERMINATE(tests)" });
  assert.equal(readProjection(repo).rows["R-0001"].status, "fixed", "an UNVERIFIED verdict never changes status");

  // An open row: no observation, one verify-observed, still open.
  const repo2 = repoWithEngagement();
  await rowAt(repo2, findingOf("not-committed"), "open");
  const r2 = await consume(repo2, placeFixture(repo2, "not-committed"));
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.equal(r2.stdout, [`CONSUMED UNVERIFIED-NOT-COMMITTED row=R-0001 verify=${shaOf("not-committed")}`, "ROW R-0001 status=open priority=p1 seq=2"].join("\n") + "\n");
  const log2 = readLog(repo2);
  assert.equal(log2.length, 2);
  assert.equal(log2[1].event, "verify-observed");
  assert.deepEqual(log2[1].payload, { verify_sha256: shaOf("not-committed"), verdict: "UNVERIFIED-NOT-COMMITTED" });
  assert.equal(readProjection(repo2).rows["R-0001"].status, "open");
});

test("refound-not-applied fixture ⇒ verify-observed only, no regression-observed (spec §6.4 P5)", async () => {
  const repo = repoWithEngagement();
  const rule = "refound-not-applied";
  const { payload } = fixture(rule);
  assert.equal(payload.evaluation.refound_observed, false, "the fixture's refound receipt is not applied");
  await rowAt(repo, payload.finding_id, "fixed");
  const before = readLog(repo).length;
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const log = readLog(repo);
  assert.equal(log.length, before + 1);
  assert.equal(log[before].event, "verify-observed");
  assert.deepEqual(log[before].payload, { verify_sha256: shaOf(rule), verdict: "UNVERIFIED-INDETERMINATE(fix-review)" });
  assert.ok(!log.some((e) => e.event === "regression-observed"));
  assert.equal(readProjection(repo).rows["R-0001"].status, "fixed");
});

test("every TASK-026 fixture consumes (exit 0) against a row in its row_status_at_start; the events follow the verdict class", async () => {
  for (const rule of RULES) {
    const repo = repoWithEngagement();
    const { envelope, payload } = fixture(rule);
    await rowAt(repo, payload.finding_id, payload.row_status_at_start);
    const before = readLog(repo);
    const r = await consume(repo, placeFixture(repo, rule));
    assert.equal(r.code, 0, `${rule}: ${r.stdout}${r.stderr}`);
    const added = readLog(repo).slice(before.length).map((e) => e.event);
    const { verdict, refound_observed } = payload.evaluation;
    const expected = [];
    if (refound_observed && payload.row_status_at_start === "fixed") expected.push("regression-observed");
    expected.push(verdict === "VERIFIED" ? "fixed" : verdict === "REGRESSED" ? "regressed" : "verify-observed");
    assert.deepEqual(added, expected, rule);
    assert.ok(added.every((e) => e !== "regression-observed") || payload.evaluation.events.length === 1, `${rule}: the observation agrees with evaluate().events`);
    const row = readProjection(repo).rows["R-0001"];
    const expectedStatus = verdict === "VERIFIED" ? "fixed" : verdict === "REGRESSED" ? "regressed" : payload.row_status_at_start;
    assert.equal(row.status, expectedStatus, rule);
    if (verdict === "VERIFIED") assert.equal(row.last_verified_run, envelope.run_id, rule);
  }
});

test("tampered evaluation refused: exit 5 INCONSISTENT(evaluation) when hash-consistent, exit 5 (integrity) when not; nothing appended either way", async () => {
  const repo = repoWithEngagement();
  const rule = "verified-two-acks";
  await rowAt(repo, findingOf(rule), "open");
  const { envelope, payload } = fixture(rule);

  // (a) A stored evaluation that says something else, with self_sha256 recomputed so readArtifact accepts it.
  const tamperedPayload = { ...payload, evaluation: { ...payload.evaluation, verdict: "REGRESSED" } };
  const consistent = { envelope: { ...envelope, self_sha256: artifactId(tamperedPayload) }, payload: tamperedPayload };
  const a = await consume(repo, place(repo, consistent, "deadbeef0000-1001"));
  assert.equal(a.code, 5, a.stdout + a.stderr);
  assert.equal(a.stdout, "INCONSISTENT(evaluation)\n");

  // (b) ack_refs dropped — same class.
  const noAcks = { ...payload, evaluation: { ...payload.evaluation, ack_refs: [] } };
  const b = await consume(repo, place(repo, { envelope: { ...envelope, self_sha256: artifactId(noAcks) }, payload: noAcks }, "deadbeef0000-1002"));
  assert.equal(b.code, 5);
  assert.equal(b.stdout, "INCONSISTENT(evaluation)\n");

  // (c) Edited bytes under the original envelope: self_sha256 no longer matches ⇒ integrity failure.
  const c = await consume(repo, place(repo, { envelope, payload: tamperedPayload }, "deadbeef0000-1003"));
  assert.equal(c.code, 5, c.stdout + c.stderr);
  assert.equal(c.stdout, "");
  assert.match(c.stderr, /self_sha256 mismatch/);

  // (d) Right hash, wrong kind.
  const d = await consume(repo, place(repo, { envelope: { ...envelope, kind: "packet" }, payload }, "deadbeef0000-1004"));
  assert.equal(d.code, 5, d.stdout + d.stderr);

  assert.equal(readLog(repo).length, 1, "nothing appended");
  assert.equal(readProjection(repo).rows["R-0001"].status, "open");
});

test("no row ⇒ exit 2 NO-ROW, nothing appended: an empty register, another subject, or only a superseded row", async () => {
  const rule = "verified-two-acks";
  const empty = repoWithEngagement();
  const r0 = await consume(empty, placeFixture(empty, rule));
  assert.equal(r0.code, 2, r0.stdout + r0.stderr);
  assert.equal(r0.stdout, "NO-ROW\n");
  assert.match(r0.stderr, new RegExp(findingOf(rule)));
  assert.deepEqual(readProjection(empty).rows, {});

  const other = repoWithEngagement();
  await seedRows(other, [["other", "p2", "1".repeat(64)]]);
  const r1 = await consume(other, placeFixture(other, rule));
  assert.equal(r1.code, 2);
  assert.equal(r1.stdout, "NO-ROW\n");
  assert.equal(readLog(other).length, 1);

  // A superseded row is dead: its successor carries the subject, and here there is none.
  const dead = repoWithEngagement();
  await seedRows(dead, [["dup", "p1", findingOf(rule)], ["target", "p1", "2".repeat(64)]]);
  const sup = await register(dead, ["supersede", "R-0001", "--by", "R-0002", "--transfer-exposure"]);
  assert.equal(sup.code, 0, sup.stdout + sup.stderr);
  const r2 = await consume(dead, placeFixture(dead, rule));
  assert.equal(r2.code, 2, r2.stdout + r2.stderr);
  assert.equal(r2.stdout, "NO-ROW\n");
  assert.equal(readLog(dead).length, 3);
});

test("a superseded duplicate is skipped and its live successor with the same subject takes the verdict; two live rows for one subject ⇒ exit 2 USAGE, nothing appended", async () => {
  const rule = "verified-two-acks";
  const finding = findingOf(rule);
  const repo = repoWithEngagement();
  await seedRows(repo, [["old", "p1", finding], ["new", "p0", finding]]);
  const sup = await register(repo, ["supersede", "R-0001", "--by", "R-0002", "--subject-equivalent"]);
  assert.equal(sup.code, 0, sup.stdout + sup.stderr);
  const r = await consume(repo, placeFixture(repo, rule));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split("\n")[1], "ROW R-0002 status=fixed priority=p0 seq=4");
  assert.equal(readProjection(repo).rows["R-0001"].status, "superseded");

  const dup = repoWithEngagement();
  await seedRows(dup, [["a", "p1", finding], ["b", "p1", finding]]);
  const d = await consume(dup, placeFixture(dup, rule));
  assert.equal(d.code, 2, d.stdout + d.stderr);
  assert.match(d.stdout, /^USAGE\(consume-verdict: .*R-0001.*R-0002/);
  assert.equal(readLog(dup).length, 2, "nothing appended");
});

test("a status event outside the table is refused before anything is appended: VERIFIED on a fixed row, REGRESSED on an open row (exit 4)", async () => {
  const rule = "verified-two-acks";
  const repo = repoWithEngagement();
  await rowAt(repo, findingOf(rule), "fixed");
  const before = readLog(repo).length;
  const again = await consume(repo, placeFixture(repo, rule));
  assert.equal(again.code, 4, again.stdout + again.stderr);
  assert.equal(again.stdout, "TRANSITION-REJECTED(fixed: fixed)\n");
  assert.equal(readLog(repo).length, before);

  // The verdict was evaluated against row_status_at_start=fixed; the live row is open, so `regressed` has no from-state and
  // there is no `fixed` row to observe a regression on — nothing lands.
  const open = repoWithEngagement();
  await rowAt(open, findingOf("refound-row-fixed"), "open");
  const r = await consume(open, placeFixture(open, "refound-row-fixed"));
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout, "TRANSITION-REJECTED(regressed: open)\n");
  assert.equal(readLog(open).length, 1);
  assert.equal(readProjection(open).rows["R-0001"].status, "open");
});

test("argv and input guards: missing/extra positional, flags, a file outside the tree, a missing file, a payload-only file (exit 2); the register is untouched", async () => {
  const repo = repoWithEngagement();
  await rowAt(repo, findingOf("verified-two-acks"), "open");
  const outside = fixturePath("verified-two-acks"); // real, but not under the consumer root
  mkdirSync(join(repo, "in"), { recursive: true });
  writeFileSync(join(repo, "in", "payload-only.json"), `${canonical(fixture("verified-two-acks").payload).toString("utf8")}\n`);
  writeFileSync(join(repo, "in", "not-json.json"), "{ nope\n");
  const cases = [
    [[], /^USAGE\(consume-verdict: /],
    [["a.json", "b.json"], /^USAGE\(consume-verdict: unexpected argument b\.json/],
    [["--json", "a.json"], /^USAGE\(consume-verdict: unknown flag --json/],
    [[outside], /^USAGE\(consume-verdict: cannot read .* \(outside the work tree\)\)$/],
    [["in/missing.json"], /^USAGE\(consume-verdict: cannot read in\/missing\.json \(no such file\)\)$/],
    [["in/payload-only.json"], /^USAGE\(consume-verdict: not a verify artifact: /],
    [["in/not-json.json"], /^USAGE\(consume-verdict: cannot read in\/not-json\.json \(not strict JSON: /],
    [["in"], /^USAGE\(consume-verdict: cannot read in \(EISDIR\)\)$/],
  ];
  for (const [argv, pattern] of cases) {
    const r = await register(repo, ["consume-verdict", ...argv]);
    assert.equal(r.code, 2, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout.trimEnd(), pattern, argv.join(" "));
    assert.doesNotMatch(r.stdout, /REDACTED/, `${argv.join(" ")}: the token must leave the process unredacted`);
  }
  assert.equal(readLog(repo).length, 1, "nothing appended");
});

test("without engagement.md ⇒ exit 2 ENGAGEMENT-MISSING (the register belongs to an engagement), nothing written", async () => {
  const repo = repoWithEngagement();
  const path = placeFixture(repo, "verified-two-acks");
  const { rmSync } = await import("node:fs");
  rmSync(join(stDir(repo), "engagement.md"));
  const r = await consume(repo, path);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, "ENGAGEMENT-MISSING\n");
});

test("consume-verdict is registered in register.mjs and routes to lib/cmd-register-consume.mjs; the module owns no clock and no console", () => {
  const entry = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  assert.match(entry, /^\s*"consume-verdict": \(\) => import\("\.\/lib\/cmd-register-consume\.mjs"\),/m);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cmd-register-consume.mjs"), "utf8");
  assert.doesNotMatch(src, /console\./, "G-4: ctx.out / ctx.log only");
  assert.doesNotMatch(src, /Date\.now|new Date/, "G-1: the clock is ctx.now()");
  assert.doesNotMatch(src, /child_process|node:http|fetch\(/, "G-6 / G-14");
  assert.doesNotMatch(src, /"transition"|verb\(/, "emitter-only events go through register-core.append, not the transition verb");
});

test("the artifact identity in every event is the on-disk self_sha256 (parseStrict round trip)", async () => {
  const repo = repoWithEngagement();
  const rule = "verified-tested-tree";
  await rowAt(repo, findingOf(rule), "regressed");
  const path = placeFixture(repo, rule);
  const onDisk = parseStrict(readFileSync(join(repo, path)));
  const r = await consume(repo, path);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const last = readLog(repo).at(-1);
  assert.equal(last.event, "fixed");
  assert.equal(last.payload.verify_sha256, onDisk.envelope.self_sha256);
  assert.equal(readProjection(repo).rows["R-0001"].status, "fixed");
});
