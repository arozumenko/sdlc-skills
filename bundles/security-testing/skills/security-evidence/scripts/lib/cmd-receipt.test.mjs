// TASK-022 — `evidence.mjs receipt validate --run <id> <file>` and `receipt
// apply --run <id> [--json]` (plan §4.1 rows `receipt validate|apply`, §5
// TASK-022; spec §6.4 "Receipt … receipt validate checks schema, that the
// packet exists and matches, and that packet.files[].oid equals the run's
// oids", TL-4 drop-box; US-015 AC-2, AC-7; G-7). Every repo is built in a temp
// dir by the CLI harness; every run is allocated by the real `run init`,
// scoped by `scope`, gated by `gate` and packeted by `packet --kind subject`,
// so the ids and packet hashes a receipt must name are the bundle's own. The
// state arithmetic itself is states.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript, tmpDir } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS } from "../fixtures/sarif/index.mjs";
import { validate } from "./schema.mjs";
import { applyReceipts } from "./states.mjs";

after(cleanupAll);

const RECEIPT_LINE = /^RECEIPT admitted sha256=([0-9a-f]{64}) type=([a-z-]+) subject=(\S+)$/;
const WROTE_LINE = /^WROTE (\S+) sha256=([0-9a-f]{64})$/;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
const DUP_JS = "a();\nb();\na();\nb();\na();\n";
const IND = "d".repeat(64);

const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });
const CLAIMS = Object.freeze({
  injection: claim({
    title: "sql built from req.query.id",
    class: "injection",
    path: "src/db.js",
    lines: [3, 4],
    snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
    citations_typed: [
      { role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true },
      { role: "source", path: "src/app.js", side: "head", lines: [1, 1], context: true },
    ],
  }),
  app: claim({ title: "app export", class: "config", path: "src/app.js", lines: [1, 1], snippet: "export const a = 1;" }),
  failed: claim({ title: "not what the file says", class: "config", path: "src/dup.js", lines: [1, 1], snippet: "z();" }),
});

const dropbox = (repo, run_id) => join(repo, ST, "receipts", run_id);
const receiptsDir = (repo, run_id) => join(runDir(repo, run_id), "receipts");
const packetsDir = (repo, run_id) => join(runDir(repo, run_id), "packets");

/** Write a payload-only file into the agent drop-box (TL-4); returns its repo-relative path. */
function drop(repo, run_id, name, value) {
  mkdirSync(dropbox(repo, run_id), { recursive: true });
  const bytes = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  writeFileSync(join(dropbox(repo, run_id), name), bytes);
  return join(ST, "receipts", run_id, name);
}

function parsePacketLine(stdout) {
  const m = PACKET_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `PACKET line: ${JSON.stringify(stdout)}`);
  return { path: m[1], sha256: m[2], kind: m[3], files: Number(m[4]) };
}

async function evidence(repo, args, env = ENV) {
  return runScript("evidence", args, { cwd: repo, env });
}

async function subjectPacket(repo, run_id, subjects, extra = []) {
  const r = await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", ...subjects.flatMap((s) => ["--subject", s]), ...extra]);
  assert.equal(r.code, 0, `subject packet: ${r.stdout}${r.stderr}`);
  return parsePacketLine(r.stdout).sha256;
}

/**
 * An assessment run over src/app.js, src/db.js, src/dup.js: scoped, scope-
 * packeted, gated over CLAIMS (two accepted, one CITATION_FAILED) and with a
 * subject packet over the two accepted findings plus one over `injection`
 * alone. Returns everything a receipt must name.
 */
async function gatedRepo() {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const run_id = await initRun(repo, "assessment");
  const s = await evidence(repo, ["scope", "--run", run_id]);
  assert.equal(s.code, 0, `scope: ${s.stdout}${s.stderr}`);
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  const p = await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]);
  assert.equal(p.code, 0, `scope packet: ${p.stdout}${p.stderr}`);
  const scopePacket = parsePacketLine(p.stdout).sha256;
  const file = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: Object.values(CLAIMS) });
  const g = await evidence(repo, ["gate", "--run", run_id, "--claims", file]);
  assert.equal(g.code, 0, `gate: ${g.stdout}${g.stderr}`);
  assert.match(g.stdout, /^GATE accepted=2 unverifiable=1/);
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  const gateResult = readArtifact(join(runDir(repo, run_id), "gate-result.json"), { kind: "gate-result" });
  const finding = (title) => {
    const f = claimed.payload.findings.find((x) => x.title === title);
    assert.ok(f, `gated finding titled ${JSON.stringify(title)}`);
    return f;
  };
  const injection = finding(CLAIMS.injection.title).id;
  const app = finding(CLAIMS.app.title).id;
  const failed = finding(CLAIMS.failed.title).id;
  const pair = await subjectPacket(repo, run_id, [injection, app]);
  const single = await subjectPacket(repo, run_id, [injection]);
  return { repo, run_id, run, scope, scopePacket, gateResult, claimed, injection, app, failed, pair, single };
}

const receipt = (over) => ({ type: "vulnerability-review", assertion: "confirmed", ...over });

/** `<run>/threat-model.json` as tm-lint check (M2) will write it. */
function writeThreatModel(repo, run_id, payload) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  const now = () => ENV.SECURITY_EVIDENCE_NOW;
  return writeArtifact(join(runDir(repo, run_id), "threat-model.json"), makeEnvelope({ schema_version, kind: "threat-model", run_id, engagement_id, key_id, now }, payload), { exclusive: true });
}

/** A hand-made subject packet artifact under <run>/packets/ (hash-consistent, so readArtifact accepts it). */
function writePacket(repo, run_id, payload) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  const now = () => ENV.SECURITY_EVIDENCE_NOW;
  const art = makeEnvelope({ schema_version, kind: "packet", run_id, engagement_id, key_id, now }, payload);
  const written = writeArtifact(join(packetsDir(repo, run_id), `${art.envelope.self_sha256}.json`), art, { exclusive: true });
  return written.envelope.self_sha256;
}

function receiptFiles(repo, run_id) {
  return existsSync(receiptsDir(repo, run_id)) ? readdirSync(receiptsDir(repo, run_id)).sort() : [];
}

async function admit(repo, run_id, name, payload) {
  const file = drop(repo, run_id, name, payload);
  const r = await evidence(repo, ["receipt", "validate", "--run", run_id, file]);
  return { ...r, file };
}

async function rejected(repo, run_id, name, payload, reason) {
  const before = receiptFiles(repo, run_id);
  const r = await admit(repo, run_id, name, payload);
  assert.equal(r.code, 4, `${name}: ${r.stdout}${r.stderr}`);
  if (reason instanceof RegExp) assert.match(r.stdout.trim(), reason, name);
  else assert.equal(r.stdout.trim(), `REJECTED(${reason})`, name);
  assert.deepEqual(receiptFiles(repo, run_id), before, `${name}: nothing written`);
  return r;
}

// --- validate: admission --------------------------------------------------------------

test("closed enums per type; other values rejected; packet binding and oid check; scope packet refused as a receipt target (US-015 AC-2)", async () => {
  const { repo, run_id, run, scopePacket, injection, app, pair, single } = await gatedRepo();

  // a well-formed vulnerability-review receipt over the pair packet: admitted, enveloped, write-once under <run>/receipts/
  const ok = await admit(repo, run_id, "vr-1.json", receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id }));
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(ok.stderr, "");
  const [line1, line2, ...rest] = ok.stdout.trim().split("\n");
  assert.deepEqual(rest, []);
  const m = RECEIPT_LINE.exec(line1);
  assert.ok(m, line1);
  assert.equal(m[2], "vulnerability-review");
  assert.equal(m[3], injection);
  const w = WROTE_LINE.exec(line2);
  assert.ok(w, line2);
  assert.equal(w[2], m[1]);
  assert.equal(w[1], `${ST}/runs/${run_id}/receipts/${m[1]}.json`);
  const art = readArtifact(join(receiptsDir(repo, run_id), `${m[1]}.json`), { kind: "receipt" });
  assert.deepEqual(validate("receipt", art.payload), []);
  assert.deepEqual(art.payload, { type: "vulnerability-review", subject_id: injection, packet_sha256: pair, assertion: "confirmed", reviewer_run_id: run_id });
  assert.equal(art.envelope.run_id, run_id);
  assert.equal(art.envelope.key_id, run.envelope.key_id);
  assert.equal(art.envelope.engagement_id, run.envelope.engagement_id);
  assert.equal(art.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  // TL-4: the drop-box file is the agent's; untouched, and still payload-only
  assert.deepEqual(JSON.parse(readFileSync(join(repo, ok.file), "utf8")), receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id }));
  assert.deepEqual(receiptFiles(repo, run_id), [`${m[1]}.json`]);

  // the same receipt again: idempotent (same identity, one file), exit 0
  const again = await evidence(repo, ["receipt", "validate", "--run", run_id, ok.file]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(again.stdout, ok.stdout);
  assert.deepEqual(receiptFiles(repo, run_id), [`${m[1]}.json`]);

  // every closed enum, per type (fix-review and ack over the single-subject packet, as verify all would name its fix-review packet)
  const enums = [
    ["vulnerability-review", "refuted", pair],
    ["vulnerability-review", "indeterminate", pair],
    ["fix-review", "not-refound", single],
    ["fix-review", "refound", single],
    ["fix-review", "indeterminate", single],
    ["ack", { indicator_id: IND }, single],
    ["ack", { indicator_id: "e".repeat(64) }, single],
  ];
  for (const [type, assertion, packet_sha256] of enums) {
    const r = await admit(repo, run_id, `${type}-${JSON.stringify(assertion).replace(/\W/g, "").slice(0, 12)}.json`, { type, subject_id: injection, packet_sha256, assertion, reviewer_run_id: run_id });
    assert.equal(r.code, 0, `${type} ${JSON.stringify(assertion)}: ${r.stdout}${r.stderr}`);
    assert.equal(RECEIPT_LINE.exec(r.stdout.split("\n")[0])[2], type);
  }
  assert.equal(receiptFiles(repo, run_id).length, 1 + enums.length);

  // mitigation-review over a mitigation packet (M2 shape: the threat-model snapshot)
  writeThreatModel(repo, run_id, {
    elements: [{ id: "E-001", kind: "process", name: "find", citation: { path: "src/db.js", side: "head", lines: [2, 5] } }],
    threats: [{ id: "T-001", element_id: "E-001", stride: "T", title: "query built from input", mitigations: [{ id: "M-001", claim: "parameterised", citation: { path: "src/db.js", side: "head", lines: [4, 4] } }], disposition: { kind: "undisposed" } }],
  });
  const mPacket = await subjectPacket(repo, run_id, ["M-001"]);
  for (const assertion of ["confirmed", "gap", "indeterminate"]) {
    const r = await admit(repo, run_id, `mr-${assertion}.json`, { type: "mitigation-review", subject_id: "M-001", packet_sha256: mPacket, assertion, reviewer_run_id: run_id });
    assert.equal(r.code, 0, `mitigation-review ${assertion}: ${r.stdout}${r.stderr}`);
    assert.equal(RECEIPT_LINE.exec(r.stdout.split("\n")[0])[3], "M-001");
  }

  // other values: an assertion of another type, an unknown type, a string ack, a missing field, a float, an extra field
  const base = { subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id };
  await rejected(repo, run_id, "bad-1.json", { ...base, type: "vulnerability-review", assertion: "gap" }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-2.json", { ...base, type: "mitigation-review", assertion: "refuted" }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-3.json", { ...base, type: "fix-review", assertion: "confirmed" }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-4.json", { ...base, type: "ack", assertion: IND }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-5.json", { ...base, type: "review", assertion: "confirmed" }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-6.json", { type: "vulnerability-review", assertion: "confirmed", subject_id: injection, packet_sha256: pair }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-7.json", { ...base, type: "vulnerability-review", assertion: "confirmed", note: "x" }, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-8.json", `{"type": "ack", "assertion": {"indicator_id": "${IND}"}, "subject_id": "${injection}", "packet_sha256": "${pair}", "reviewer_run_id": "${run_id}", "n": 1.5}`, /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-9.json", "not json", /^REJECTED\(schema: /);
  await rejected(repo, run_id, "bad-10.json", "[]", /^REJECTED\(schema: /);

  // packet binding
  await rejected(repo, run_id, "pkt-1.json", receipt({ ...base, packet_sha256: "ab".repeat(32) }), "unknown packet");
  await rejected(repo, run_id, "pkt-2.json", receipt({ ...base, packet_sha256: scopePacket }), "scope packet");
  await rejected(repo, run_id, "pkt-3.json", receipt({ ...base, subject_id: app, packet_sha256: single }), "subject_id not in packet.subject_ids");
  await rejected(repo, run_id, "pkt-4.json", receipt({ ...base, subject_id: "M-001", packet_sha256: pair }), "subject_id not in packet.subject_ids");
  // a packet file whose name is not its identity (a copy under another name): the named packet does not match
  copyFileSync(join(packetsDir(repo, run_id), `${single}.json`), join(packetsDir(repo, run_id), `${"7".repeat(64)}.json`));
  await rejected(repo, run_id, "pkt-5.json", receipt({ ...base, packet_sha256: "7".repeat(64) }), "packet_sha256 mismatch");

  // oid check: a packet whose recorded oid is not the blob at the run's head_oid
  const real = readArtifact(join(packetsDir(repo, run_id), `${single}.json`), { kind: "packet" }).payload;
  const stale = writePacket(repo, run_id, { ...real, files: real.files.map((f, i) => (i === 0 ? { ...f, oid: "9".repeat(40) } : f)) });
  await rejected(repo, run_id, "oid-1.json", receipt({ ...base, packet_sha256: stale }), `oid mismatch ${real.files[0].path}`);
  // a packet naming a path that has no blob at head at all
  const gone = writePacket(repo, run_id, { ...real, files: [{ ...real.files[0], path: "src/nope.js" }] });
  await rejected(repo, run_id, "oid-2.json", receipt({ ...base, packet_sha256: gone }), "oid mismatch src/nope.js");
});

test("receipt carrying state/verdict/id/gate stamp rejected naming the key (US-015 AC-7, G-7); a forbidden key is named before any schema error, nested included", async () => {
  const { repo, run_id, injection, pair } = await gatedRepo();
  const base = receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id });
  await rejected(repo, run_id, "f-state.json", { ...base, state: "REVIEW_CONFIRMED" }, "forbidden field state");
  await rejected(repo, run_id, "f-verdict.json", { ...base, verdict: "VERIFIED" }, "forbidden field verdict");
  await rejected(repo, run_id, "f-id.json", { ...base, id: injection }, "forbidden field id");
  await rejected(repo, run_id, "f-gate.json", { ...base, gate: { accepted: true } }, "forbidden field gate");
  await rejected(repo, run_id, "f-gate-stamp.json", { ...base, gate_stamp: "ok" }, "forbidden field gate_stamp");
  await rejected(repo, run_id, "f-states.json", { ...base, states: {} }, "forbidden field states");
  // nested (an ack's assertion object) and an otherwise-invalid receipt: the key is still what is named
  await rejected(repo, run_id, "f-nested.json", { ...base, type: "ack", assertion: { indicator_id: "d".repeat(64), state: "acked" } }, "forbidden field state");
  await rejected(repo, run_id, "f-broken.json", { type: "nope", verdict: "x" }, "forbidden field verdict");
  assert.deepEqual(receiptFiles(repo, run_id), []);
});

test("reviewer_run_id mismatch rejected: another run's id, a malformed id, and a receipt admitted into the run it names only", async () => {
  const { repo, run_id, injection, pair } = await gatedRepo();
  const other = await initRun(repo, "assessment");
  const base = receipt({ subject_id: injection, packet_sha256: pair });
  await rejected(repo, run_id, "run-1.json", { ...base, reviewer_run_id: other }, "reviewer_run_id != run");
  await rejected(repo, run_id, "run-2.json", { ...base, reviewer_run_id: "run-1" }, "reviewer_run_id != run");
  await rejected(repo, run_id, "run-3.json", { ...base, reviewer_run_id: "" }, "reviewer_run_id != run");
  // the packet lives in `run_id`; validating against `other` fails on the run id before the packet is looked for
  const f = drop(repo, other, "run-4.json", { ...base, reviewer_run_id: run_id });
  const r = await evidence(repo, ["receipt", "validate", "--run", other, f]);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "REJECTED(reviewer_run_id != run)");
  assert.deepEqual(receiptFiles(repo, other), []);
  assert.deepEqual(receiptFiles(repo, run_id), []);
});

test("review run: base, head and snapshot sides are each checked against the run's own oid (base blob, head blob, scope.snapshot redacted_sha256)", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const baseRef = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "src", "dup.js"), "a();\nb();\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "dup shrinks"]);
  writeFileSync(join(repo, "src", "db.js"), `${DB_JS}export const dirty = 1;\n`); // dirty ⇒ snapshot side
  const init = await evidence(repo, ["run", "init", "--kind", "review", "--base", baseRef]);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const run_id = /^RUN (\S+)/.exec(init.stdout)[1];
  const s = await evidence(repo, ["scope", "--run", run_id]);
  assert.equal(s.code, 0, s.stdout + s.stderr);
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  const p = await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]);
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const claims = [
    claim({ title: "base only", path: "src/dup.js", side: "base", lines: [5, 5], snippet: "a();", citations_typed: [{ role: "control", path: "src/dup.js", side: "head", lines: [2, 2], context: true }] }),
    claim({ title: "snapshot", path: "src/db.js", side: "snapshot", lines: [6, 6], snippet: "// <REDACTED:password-assign>" }),
  ];
  const file = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: parsePacketLine(p.stdout).sha256, findings: claims });
  const g = await evidence(repo, ["gate", "--run", run_id, "--claims", file]);
  assert.equal(g.code, 0, g.stdout + g.stderr);
  assert.match(g.stdout, /^GATE accepted=2 unverifiable=0/);
  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  const baseF = claimed.payload.findings.find((f) => f.title === "base only").id;
  const snapF = claimed.payload.findings.find((f) => f.title === "snapshot").id;
  const three = await subjectPacket(repo, run_id, [baseF, snapF]);
  const real = readArtifact(join(packetsDir(repo, run_id), `${three}.json`), { kind: "packet" }).payload;
  assert.deepEqual(real.files.map((f) => f.side), ["snapshot", "base", "head"]);

  const ok = await admit(repo, run_id, "ok.json", receipt({ subject_id: snapF, packet_sha256: three, reviewer_run_id: run_id }));
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const okBase = await admit(repo, run_id, "ok-base.json", receipt({ subject_id: baseF, packet_sha256: three, reviewer_run_id: run_id, assertion: "refuted" }));
  assert.equal(okBase.code, 0, okBase.stdout + okBase.stderr);

  // one wrong oid per side, each named by its path
  for (const [i, side] of real.files.map((f, j) => [j, f.side])) {
    const wrong = writePacket(repo, run_id, { ...real, files: real.files.map((f, j) => (j === i ? { ...f, oid: side === "snapshot" ? "8".repeat(64) : "8".repeat(40) } : f)) });
    await rejected(repo, run_id, `oid-${side}.json`, receipt({ subject_id: snapF, packet_sha256: wrong, reviewer_run_id: run_id }), `oid mismatch ${real.files[i].path}`);
  }
  // a snapshot-side file the scope never snapshotted
  const noSnap = writePacket(repo, run_id, { ...real, files: [{ ...real.files[0], path: "src/app.js" }] });
  await rejected(repo, run_id, "oid-nosnap.json", receipt({ subject_id: snapF, packet_sha256: noSnap, reviewer_run_id: run_id }), "oid mismatch src/app.js");
});

// --- validate: argv and run refusals ------------------------------------------------------

test("argv: a subcommand is required; validate needs exactly one file; unknown run ⇒ 2; a COMMITTED run ⇒ 2 RUN-COMMITTED; a file outside the tree or unreadable ⇒ 2 USAGE; nothing written", async () => {
  const { repo, run_id, injection, pair } = await gatedRepo();
  const none = await evidence(repo, ["receipt"]);
  assert.equal(none.code, 2, none.stdout);
  assert.match(none.stdout.trim(), /^USAGE\(receipt: a subcommand is required \(validate\|apply\)\)$/);
  const unknown = await evidence(repo, ["receipt", "confirm", "--run", run_id]);
  assert.equal(unknown.code, 2, unknown.stdout);
  assert.equal(unknown.stdout.trim(), "USAGE(receipt: unknown subcommand confirm)");
  const noFile = await evidence(repo, ["receipt", "validate", "--run", run_id]);
  assert.equal(noFile.code, 2, noFile.stdout);
  assert.match(noFile.stdout.trim(), /^USAGE\(receipt validate: /);
  const two = await evidence(repo, ["receipt", "validate", "--run", run_id, "a.json", "b.json"]);
  assert.equal(two.code, 2, two.stdout);
  const noRun = await evidence(repo, ["receipt", "validate", "x.json"]);
  assert.equal(noRun.code, 2, noRun.stdout);
  assert.equal(noRun.stdout.trim(), "USAGE(receipt validate: --run is required)");
  const badRun = await evidence(repo, ["receipt", "validate", "--run", "nope", "x.json"]);
  assert.equal(badRun.code, 2, badRun.stdout);
  const ghost = await evidence(repo, ["receipt", "validate", "--run", `${"0".repeat(12)}-9999`, "x.json"]);
  assert.equal(ghost.code, 2, ghost.stdout);
  assert.equal(ghost.stdout.trim(), `USAGE(receipt validate: unknown run ${"0".repeat(12)}-9999)`);

  const payload = receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id });
  const outside = tmpDir("sec-outside-");
  writeFileSync(join(outside, "r.json"), JSON.stringify(payload));
  const out = await evidence(repo, ["receipt", "validate", "--run", run_id, join(outside, "r.json")]);
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stdout.trim(), /^USAGE\(receipt validate: cannot read .* \(outside the work tree\)\)$/);
  const missing = await evidence(repo, ["receipt", "validate", "--run", run_id, join(ST, "receipts", run_id, "absent.json")]);
  assert.equal(missing.code, 2, missing.stdout + missing.stderr);
  assert.equal(missing.stdout.trim(), `USAGE(receipt validate: cannot read ${ST}/receipts/${run_id}/absent.json)`);
  const dir = await evidence(repo, ["receipt", "validate", "--run", run_id, "src"]);
  assert.equal(dir.code, 2, dir.stdout + dir.stderr);
  assert.deepEqual(receiptFiles(repo, run_id), []);

  // a COMMITTED run admits nothing more (G-10)
  writeFileSync(join(runDir(repo, run_id), "COMMITTED"), `${"0".repeat(64)}\n`);
  const f = drop(repo, run_id, "late.json", payload);
  const late = await evidence(repo, ["receipt", "validate", "--run", run_id, f]);
  assert.equal(late.code, 2, late.stdout + late.stderr);
  assert.equal(late.stdout.trim(), "RUN-COMMITTED");
  assert.deepEqual(receiptFiles(repo, run_id), []);
});

test("a tampered packet under <run>/packets/ is the run's own state gone wrong: 5, not a rejection; nothing written", async () => {
  const { repo, run_id, injection, single } = await gatedRepo();
  const path = join(packetsDir(repo, run_id), `${single}.json`);
  const art = JSON.parse(readFileSync(path, "utf8"));
  art.payload.subject_ids = [injection, "M-999"];
  writeFileSync(path, JSON.stringify(art));
  const r = await admit(repo, run_id, "t.json", receipt({ subject_id: injection, packet_sha256: single, reviewer_run_id: run_id }));
  assert.equal(r.code, 5, r.stdout + r.stderr);
  assert.deepEqual(receiptFiles(repo, run_id), []);
});

// --- apply -------------------------------------------------------------------------------

test("apply: the derived states of the run's findings from its admitted receipts and packets; --json is the states.mjs result; a receipt admitted twice is one receipt", async () => {
  const { repo, run_id, gateResult, injection, app, failed, pair, single } = await gatedRepo();
  // before any receipt: every accepted finding is CITATION_VERIFIED, the failed one CITATION_FAILED
  const empty = await evidence(repo, ["receipt", "apply", "--run", run_id]);
  assert.equal(empty.code, 0, empty.stdout + empty.stderr);
  const expectedEmpty = [injection, app].sort().map((id) => `STATE ${id} CITATION_VERIFIED`);
  assert.deepEqual(empty.stdout.trim().split("\n"), [...[...expectedEmpty, `STATE ${failed} CITATION_FAILED`].sort(), "not-applied: 0", "conflicts: 0"]);

  const admitted = [];
  for (const [name, payload] of [
    ["vr-confirm.json", receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id })],
    ["vr-refute-app.json", receipt({ subject_id: app, packet_sha256: pair, reviewer_run_id: run_id, assertion: "refuted" })],
    ["fix.json", { type: "fix-review", subject_id: app, packet_sha256: pair, assertion: "not-refound", reviewer_run_id: run_id }],
    ["ack.json", { type: "ack", subject_id: injection, packet_sha256: single, assertion: { indicator_id: IND }, reviewer_run_id: run_id }],
  ]) {
    const r = await admit(repo, run_id, name, payload);
    assert.equal(r.code, 0, `${name}: ${r.stdout}${r.stderr}`);
    admitted.push(RECEIPT_LINE.exec(r.stdout.split("\n")[0])[1]);
  }
  // the same receipt from a second drop-box copy: still one file, still one receipt
  const dupe = await admit(repo, run_id, "vr-confirm-copy.json", receipt({ subject_id: injection, packet_sha256: pair, reviewer_run_id: run_id }));
  assert.equal(dupe.code, 0, dupe.stdout + dupe.stderr);
  assert.equal(receiptFiles(repo, run_id).length, 4);

  const r = await evidence(repo, ["receipt", "apply", "--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines.slice(-2), ["not-applied: 1", "conflicts: 0"]);
  const states = Object.fromEntries(lines.slice(0, -2).map((l) => l.split(" ").slice(1)));
  assert.deepEqual(states, { [injection]: "REVIEW_CONFIRMED", [app]: "REVIEW_REFUTED", [failed]: "CITATION_FAILED" });

  const j = await evidence(repo, ["receipt", "apply", "--run", run_id, "--json"]);
  assert.equal(j.code, 0, j.stdout + j.stderr);
  const parsed = JSON.parse(j.stdout);
  const receipts = receiptFiles(repo, run_id).map((f) => readArtifact(join(receiptsDir(repo, run_id), f), { kind: "receipt" }));
  const packets = readdirSync(packetsDir(repo, run_id)).map((f) => readArtifact(join(packetsDir(repo, run_id), f), { kind: "packet" }));
  assert.deepEqual(parsed, applyReceipts(gateResult, receipts, packets));
  assert.deepEqual(parsed.states, states);
  assert.deepEqual(parsed.mitigation_states, {});
  assert.equal(parsed.not_applied.length, 1);
  assert.equal(parsed.not_applied[0].reason, "review-refuted", "the fix-review on the refuted finding");
  assert.equal(parsed.not_applied[0].type, "fix-review");
  assert.ok(admitted.includes(parsed.not_applied[0].receipt_sha256));
  assert.deepEqual(parsed.conflicts, []);

  // a conflicting second vulnerability-review on `injection` (same subject, same run) ⇒ REVIEW_INDETERMINATE
  const c = await admit(repo, run_id, "vr-refute.json", receipt({ subject_id: injection, packet_sha256: single, reviewer_run_id: run_id, assertion: "refuted" }));
  assert.equal(c.code, 0, c.stdout + c.stderr);
  const after = await evidence(repo, ["receipt", "apply", "--run", run_id, "--json"]);
  assert.equal(after.code, 0, after.stdout + after.stderr);
  const p2 = JSON.parse(after.stdout);
  assert.equal(p2.states[injection], "REVIEW_INDETERMINATE");
  assert.equal(p2.conflicts.length, 1);
  assert.deepEqual(p2.conflicts[0].assertions, ["confirmed", "refuted"]);
  const table = await evidence(repo, ["receipt", "apply", "--run", run_id]);
  assert.deepEqual(table.stdout.trim().split("\n").slice(-2), ["not-applied: 1", "conflicts: 1"]);

  // apply writes nothing (a COMMITTED run may still be applied: build-report and check re-derive it the same way)
  writeFileSync(join(runDir(repo, run_id), "COMMITTED"), `${"0".repeat(64)}\n`);
  const committed = await evidence(repo, ["receipt", "apply", "--run", run_id, "--json"]);
  assert.equal(committed.code, 0, committed.stdout + committed.stderr);
  assert.deepEqual(JSON.parse(committed.stdout), p2);
  assert.equal(receiptFiles(repo, run_id).length, 5);
});

test("apply: mitigation states come from mitigation-review receipts on mitigation packets and never promote a finding", async () => {
  const { repo, run_id, injection, single } = await gatedRepo();
  writeThreatModel(repo, run_id, {
    elements: [{ id: "E-001", kind: "process", name: "find", citation: { path: "src/db.js", side: "head", lines: [2, 5] } }],
    threats: [{ id: "T-001", element_id: "E-001", stride: "T", title: "t", mitigations: [{ id: "M-001", claim: "c", citation: { path: "src/db.js", side: "head", lines: [4, 4] } }], disposition: { kind: "undisposed" } }],
  });
  const mPacket = await subjectPacket(repo, run_id, ["M-001"]);
  const a = await admit(repo, run_id, "m.json", { type: "mitigation-review", subject_id: "M-001", packet_sha256: mPacket, assertion: "confirmed", reviewer_run_id: run_id });
  assert.equal(a.code, 0, a.stdout + a.stderr);
  const b = await admit(repo, run_id, "m-on-finding.json", { type: "mitigation-review", subject_id: injection, packet_sha256: single, assertion: "confirmed", reviewer_run_id: run_id });
  assert.equal(b.code, 0, b.stdout + b.stderr, "validate admits it: the packet lists the subject; apply is where it is refused");
  const r = await evidence(repo, ["receipt", "apply", "--run", run_id, "--json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.mitigation_states, { "M-001": "MITIGATION_CONFIRMED" });
  assert.equal(parsed.states[injection], "CITATION_VERIFIED");
  assert.deepEqual(parsed.not_applied.map((n) => [n.subject_id, n.reason]), [[injection, "subject-is-finding"]]);
  const t = await evidence(repo, ["receipt", "apply", "--run", run_id]);
  assert.ok(t.stdout.includes("STATE M-001 MITIGATION_CONFIRMED"), t.stdout);
  assert.deepEqual(t.stdout.trim().split("\n").slice(-2), ["not-applied: 1", "conflicts: 0"]);
});

test("apply before gate: a review/assessment run without gate-result.json ⇒ 3 INCOMPLETE(gate-result); a verify run has no gate and applies over its receipts alone; --json accepts no positionals", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const r = await evidence(repo, ["receipt", "apply", "--run", run_id]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "INCOMPLETE(gate-result)");
  const verify = await initRun(repo, "verify");
  const v = await evidence(repo, ["receipt", "apply", "--run", verify, "--json"]);
  assert.equal(v.code, 0, v.stdout + v.stderr);
  assert.deepEqual(JSON.parse(v.stdout), { states: {}, mitigation_states: {}, not_applied: [], conflicts: [] });
  const extra = await evidence(repo, ["receipt", "apply", "--run", verify, "x"]);
  assert.equal(extra.code, 2, extra.stdout);
  const ghost = await evidence(repo, ["receipt", "apply", "--run", `${"0".repeat(12)}-9999`]);
  assert.equal(ghost.code, 2, ghost.stdout);
  assert.equal(ghost.stdout.trim(), `USAGE(receipt apply: unknown run ${"0".repeat(12)}-9999)`);
});
