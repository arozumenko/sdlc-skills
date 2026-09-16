// TASK-039 — `tm-lint.mjs check --run <id> [--model <path>]` and `render
// --run <id>` (plan §4.4, §5 TASK-039; spec §6.10, D14; US-031 AC-2…AC-4;
// PM rulings R1 — the snapshot is write-once and dispositions.json is
// script-derived — and R2 — a citation on a dirty file is TM-INVALID).
// Every command is spawned through the CLI harness against a repo built by
// code in a temp dir (G-12); the pure rules are lib/tm-lint-core.test.mjs's.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { fixtureRecord } from "../fixtures/repo/build.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const ORDERS = "src/orders.js";
const ORDERS_TEXT = Array.from({ length: 12 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n") + "\n";
const CASE = "1".repeat(64); // fixtures/schemas/admission.ok.json's case_sha256
const OBS = "O-0123456789ab"; // fixtures/schemas/observation.ok.json's observation_id
const TICKET_URL = "https://github.com/my-org/my-product/issues/9";
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
const WROTE = (repo, run_id, file) => new RegExp(`^WROTE ${ST}/runs/${run_id}/${file} sha256=([0-9a-f]{64})$`, "m");

const cite = (path = ORDERS, lines = [1, 4], side = "head") => ({ path, side, lines });
const element = (over = {}) => ({ id: "E-001", kind: "process", name: "Checkout API", citation: cite(), ...over });
const mitigation = (over = {}) => ({ id: "M-001", claim: "Server recomputes the total", citation: cite(ORDERS, [5, 8]), ...over });
const threat = (over = {}) => ({ id: "T-001", element_id: "E-001", stride: "T", title: "Order total tampered", mitigations: [], disposition: { kind: "undisposed" }, ...over });
const model = (over = {}) => ({ elements: [element()], threats: [threat()], ...over });

const tmLint = (repo, args, env = ENV) => runScript("tm-lint", args, { cwd: repo, env });
const evidence = (repo, args) => runScript("evidence", args, { cwd: repo, env: ENV });
const register = (repo, args) => runScript("register", args, { cwd: repo, env: ENV });
async function ok(promise) {
  const r = await promise;
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  return r;
}

/** Write the model at `<st>/threat-model.json` (the default `--model`), or at `name` under the repo; returns the repo-relative path. */
function writeModel(repo, value, name = join(ST, "threat-model.json")) {
  mkdirSync(join(repo, name, ".."), { recursive: true });
  writeFileSync(join(repo, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return name;
}

/** A repo with src/orders.js (12 lines) committed under scope_paths ["src/"], plus a run of `kind` with its scope taken. */
async function scopedRepo(kind = "assessment") {
  const repo = readyRepo({ record: fixtureRecord() });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, ORDERS), ORDERS_TEXT);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "orders"]);
  const run_id = await initRun(repo, kind);
  await ok(evidence(repo, ["scope", "--run", run_id]));
  return { repo, run_id };
}

/** An enveloped artifact under the run, written the way the owning command will (M3 for admissions and observations). */
function writeRunArtifact(repo, run_id, rel, kind, payload) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  return writeArtifact(join(runDir(repo, run_id), rel), makeEnvelope({ schema_version, kind, run_id, engagement_id, key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, payload), { exclusive: true });
}

const runFiles = (repo, run_id) => readdirSync(runDir(repo, run_id)).filter((n) => !n.startsWith(".")).sort();

test("element without citation fails naming it (US-031 AC-2); nothing is written to the run", async () => {
  const { repo, run_id } = await scopedRepo();
  const { citation: _c, ...bare } = element();
  writeModel(repo, model({ elements: [bare] }));
  const before = runFiles(repo, run_id);
  const r = await tmLint(repo, ["check", "--run", run_id]);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout, 'TM-INVALID(E-001: missing required "citation")\n');
  assert.deepEqual(runFiles(repo, run_id), before, "a structural refusal leaves nothing behind");
  // the other structural refusals reach stdout in the same spelling; --model reads a user path (cwd-relative)
  writeModel(repo, model({ elements: [element({ name: "" })] }), "tm.json");
  assert.equal((await tmLint(repo, ["check", "--run", run_id, "--model", "tm.json"])).stdout, "TM-INVALID(E-001: name is empty)\n");
  writeModel(repo, model({ threats: [threat({ element_id: "E-009" })] }), "tm.json");
  assert.equal((await tmLint(repo, ["check", "--run", run_id, "--model", "tm.json"])).stdout, "TM-INVALID(T-001: element E-009 is not in the model)\n");
  writeModel(repo, model({ elements: [element({ citation: cite("src/nope.js", [1, 1]) })] }), "tm.json");
  assert.equal((await tmLint(repo, ["check", "--run", run_id, "--model", "tm.json"])).stdout, "TM-INVALID(E-001: citation src/nope.js:1-1 @ head: PATH-NOT-IN-SCOPE)\n");
  // a mitigation citation is checked before the snapshot too (PM log after G10)
  writeModel(repo, model({ threats: [threat({ mitigations: [mitigation({ citation: cite(ORDERS, [8, 5]) })] })] }), "tm.json");
  assert.equal((await tmLint(repo, ["check", "--run", run_id, "--model", "tm.json"])).stdout, "TM-INVALID(T-001: mitigation M-001 citation src/orders.js:8-5 @ head: RANGE-INVALID)\n");
  // not strict JSON ⇒ the same token at the model level (the M1 SCHEMA-INVALID spelling is gone)
  writeModel(repo, '{"elements": [], "threats": [], "elements": []}', "tm.json");
  const dup = await tmLint(repo, ["check", "--run", run_id, "--model", "tm.json"]);
  assert.equal(dup.code, 4);
  assert.match(dup.stdout, /^TM-INVALID\(model: duplicate key "elements"/);
  assert.deepEqual(runFiles(repo, run_id), before);
});

test("one threat per disposition value validates; dangling reference fails with threat id and relationship (US-031 AC-3); R1: snapshot write-once, dispositions.json script-derived", async () => {
  const { repo, run_id } = await scopedRepo();
  const dir = runDir(repo, run_id);
  // planned(proposal): a proposal file + run snapshot proposals
  mkdirSync(join(repo, ST, "proposals"), { recursive: true });
  writeFileSync(join(repo, ST, "proposals", "P-001.proposal.md"), "---\nid: P-001\n---\n# Probe the export\n");
  await ok(evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]));
  // planned(case): an admission record (plan admit, M3); executed: an observation (M4)
  writeRunArtifact(repo, run_id, join("admissions", `${CASE}.json`), "admission", admissionPayload());
  writeRunArtifact(repo, run_id, join("observations", `${OBS}.json`), "observation", observationPayload());
  // ticketed: a tracker read-back whose body carries the threat id
  mkdirSync(join(repo, ST, "handoffs"), { recursive: true });
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  writeFileSync(join(repo, ST, "handoffs", "T-005.ticket.json"), JSON.stringify({ finding_id: "T-005", title: "Order export leaks PII" }));
  writeFileSync(join(repo, ST, "imports", "readback.json"), JSON.stringify({ id: 9, url: TICKET_URL, state: "open", labels: ["security"], title: "Order export leaks PII", body: "Threat T-005 — export endpoint returns every column\n" }));
  await ok(evidence(repo, ["ingest", "tracker-readback", join(ST, "imports", "readback.json"), "--run", run_id, "--sent", join(ST, "handoffs", "T-005.ticket.json")]));
  // accepted: a register row on the threat, accepted, snapshotted into the run
  await ok(register(repo, ["add", "--subject", "T-006", "--priority", "p2", "--title", "Replay of the callback", "--run", run_id]));
  await ok(register(repo, ["accept", "R-0001", "--until", "2026-12-31", "--approved-by", "cto", "--approval-ref", "RISK-6"]));
  await ok(evidence(repo, ["run", "snapshot", "register", "--run", run_id]));

  const seven = model({
    threats: [
      threat({ id: "T-001" }),
      threat({ id: "T-002", title: "Probe left open", disposition: { kind: "planned", ref: "P-001" } }),
      threat({ id: "T-003", title: "Case admitted", disposition: { kind: "planned", ref: CASE } }),
      threat({ id: "T-004", title: "Case executed", disposition: { kind: "executed", ref: OBS } }),
      threat({ id: "T-005", stride: "I", title: "Order export leaks PII", disposition: { kind: "ticketed", ref: TICKET_URL } }),
      threat({ id: "T-006", stride: "R", title: "Replay of the callback", disposition: { kind: "accepted", ref: "R-0001" } }),
      threat({ id: "T-007", mitigations: [mitigation()], disposition: { kind: "mitigated", ref: "M-001" } }),
    ],
  });
  writeModel(repo, seven);

  // check 1: structure passes, the snapshot is written, `mitigated` has no receipt yet ⇒ 4, no index
  const first = await tmLint(repo, ["check", "--run", run_id]);
  assert.equal(first.code, 4, first.stdout + first.stderr);
  const firstLines = first.stdout.trimEnd().split("\n");
  assert.equal(firstLines[0], "TM-INVALID(T-007: mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (not independently reviewed))");
  assert.match(firstLines[1], WROTE(repo, run_id, "threat-model.json"));
  assert.equal(firstLines.length, 2);
  const snapshot = readArtifact(join(dir, "threat-model.json"), { kind: "threat-model" });
  assert.deepEqual(snapshot.payload, seven, "the snapshot is the model as checked");
  assert.equal(existsSync(join(dir, "dispositions.json")), false);

  // the mitigation-review contract over the snapshot: subject packet, reviewer receipt, receipt validate
  const packet = await ok(evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", "M-001"]));
  const packet_sha256 = PACKET_LINE.exec(packet.stdout.split("\n")[0])[2];
  mkdirSync(join(repo, ST, "receipts", run_id), { recursive: true });
  writeFileSync(join(repo, ST, "receipts", run_id, "receipt-M-001.json"), JSON.stringify({ type: "mitigation-review", subject_id: "M-001", packet_sha256, assertion: "confirmed", reviewer_run_id: run_id }));
  await ok(evidence(repo, ["receipt", "validate", "--run", run_id, join(ST, "receipts", run_id, "receipt-M-001.json")]));

  // check 2: every relationship holds ⇒ TM line, the same snapshot, the index
  const second = await ok(tmLint(repo, ["check", "--run", run_id]));
  const lines = second.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "TM elements=1 threats=7 undisposed=1");
  assert.match(lines[1], WROTE(repo, run_id, "threat-model.json"));
  assert.equal(WROTE(repo, run_id, "threat-model.json").exec(lines[1])[1], snapshot.envelope.self_sha256, "the snapshot was not rewritten (G-10)");
  assert.match(lines[2], WROTE(repo, run_id, "dispositions.json"));
  assert.equal(lines.length, 3);
  assert.equal(second.stderr, "");
  const index = readArtifact(join(dir, "dispositions.json"), { kind: "dispositions" });
  assert.deepEqual(validate("dispositions", index.payload), []);
  assert.deepEqual(index.payload.dispositions, [
    { threat_id: "T-001", kind: "undisposed", ref: "", resolved_via: "none" },
    { threat_id: "T-002", kind: "planned", ref: "P-001", resolved_via: "proposal" },
    { threat_id: "T-003", kind: "planned", ref: CASE, resolved_via: "admission" },
    { threat_id: "T-004", kind: "executed", ref: OBS, resolved_via: "observation" },
    { threat_id: "T-005", kind: "ticketed", ref: TICKET_URL, resolved_via: "tracker-readback" },
    { threat_id: "T-006", kind: "accepted", ref: "R-0001", resolved_via: "register-row" },
    { threat_id: "T-007", kind: "mitigated", ref: "M-001", resolved_via: "receipt" },
  ]);
  assert.deepEqual(readArtifact(join(dir, "threat-model.json"), { kind: "threat-model" }), snapshot);

  // check 3: the same model again is idempotent (same artifacts, same lines)
  const third = await ok(tmLint(repo, ["check", "--run", run_id]));
  assert.equal(third.stdout, second.stdout);
  assert.deepEqual(readArtifact(join(dir, "dispositions.json"), { kind: "dispositions" }), index);

  // a different model against a run that already holds a snapshot ⇒ 2 SNAPSHOT-EXISTS; nothing changes (retry = new seq)
  writeModel(repo, { ...seven, threats: [...seven.threats.slice(0, 6), { ...seven.threats[6], title: "Order total tampered (edited)" }] });
  const changed = await tmLint(repo, ["check", "--run", run_id]);
  assert.equal(changed.code, 2, changed.stdout + changed.stderr);
  assert.equal(changed.stdout, "SNAPSHOT-EXISTS\n");
  assert.deepEqual(readArtifact(join(dir, "threat-model.json"), { kind: "threat-model" }), snapshot);
  assert.deepEqual(readArtifact(join(dir, "dispositions.json"), { kind: "dispositions" }), index);

  // dangling references, each in a fresh run (the snapshot is frozen per run): threat id + the missing relationship
  const dangling = async (threats, expected) => {
    const id = await initRun(repo, "assessment");
    await ok(evidence(repo, ["scope", "--run", id]));
    writeModel(repo, model({ threats }), "dangling.json");
    const r = await tmLint(repo, ["check", "--run", id, "--model", "dangling.json"]);
    assert.equal(r.code, 4, r.stdout + r.stderr);
    assert.equal(r.stdout.split("\n")[0], expected);
    assert.equal(existsSync(join(runDir(repo, id), "dispositions.json")), false);
  };
  await dangling([threat({ disposition: { kind: "planned", ref: "P-999" } })], "TM-INVALID(T-001: planned(P-999): proposal P-999 is not in proposals-index.json)");
  await dangling([threat({ disposition: { kind: "executed", ref: "O-000000000000" } })], "TM-INVALID(T-001: executed(O-000000000000): no observation observations/O-000000000000.json)");
  await dangling([threat({ disposition: { kind: "accepted", ref: "R-0001" } })], "TM-INVALID(T-001: accepted(R-0001): register-events.json is not in the run (run snapshot register))");
  await dangling([threat({ id: "T-005", disposition: { kind: "ticketed", ref: TICKET_URL } })], `TM-INVALID(T-005: ticketed(${TICKET_URL}): no tracker-readback record shows a ticket body at that url carrying T-005)`);
});

test("render produces Markdown from JSON; threat-model template inputs (US-031 AC-4, D14): check → render → build-report --template threat-model", async () => {
  const { repo, run_id } = await scopedRepo("threat-model");
  const dir = runDir(repo, run_id);
  // render before check: the snapshot is the input
  const early = await tmLint(repo, ["render", "--run", run_id]);
  assert.equal(early.code, 3);
  assert.equal(early.stdout, "INCOMPLETE(threat-model)\n");
  writeModel(repo, model({ threats: [threat({ mitigations: [mitigation()] })] }));
  const c = await ok(tmLint(repo, ["check", "--run", run_id]));
  assert.equal(c.stdout.split("\n")[0], "TM elements=1 threats=1 undisposed=1");
  const r = await ok(tmLint(repo, ["render", "--run", run_id]));
  assert.equal(r.stdout, `RENDER ${ST}/runs/${run_id}/threat-model.md elements=1 threats=1\n`);
  assert.equal(r.stderr, "");
  const md = readFileSync(join(dir, "threat-model.md"), "utf8");
  assert.match(md, new RegExp(`^# Threat model — run ${run_id}$`, "m"));
  assert.match(md, /^\| E-001 \| process \| Checkout API \| src\/orders\.js:1-4 @ head \|$/m);
  assert.match(md, /^\| M-001 \| T-001 \| Server recomputes the total \| src\/orders\.js:5-8 @ head \| not independently reviewed \|$/m);
  assert.match(md, /^\| T-001 \| undisposed \| unknown \/ not assessed \| none \|$/m);
  // rendering again is idempotent (write-once, G-10)
  const again = await ok(tmLint(repo, ["render", "--run", run_id]));
  assert.equal(again.stdout, r.stdout);
  assert.equal(readFileSync(join(dir, "threat-model.md"), "utf8"), md);
  // the threat-model template's required inputs are all there: run, threat-model, packets, receipts, dispositions
  const report = await ok(evidence(repo, ["build-report", "--run", run_id, "--template", "threat-model"]));
  assert.match(report.stdout, /^COMMITTED$/m);
  assert.ok(existsSync(join(dir, "COMMITTED")));
  // after COMMITTED nothing under the run is written (G-10)
  for (const args of [["check", "--run", run_id], ["render", "--run", run_id]]) {
    const late = await tmLint(repo, args);
    assert.equal(late.code, 2, late.stdout);
    assert.equal(late.stdout, "RUN-COMMITTED\n");
  }
});

test("render: a mitigation state that moved after the view was written ⇒ 2 RENDER-EXISTS (the view is write-once; the report is build-report's)", async () => {
  const { repo, run_id } = await scopedRepo("threat-model");
  writeModel(repo, model({ threats: [threat({ mitigations: [mitigation()] })] }));
  await ok(tmLint(repo, ["check", "--run", run_id]));
  await ok(tmLint(repo, ["render", "--run", run_id]));
  const packet = await ok(evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", "M-001"]));
  const packet_sha256 = PACKET_LINE.exec(packet.stdout.split("\n")[0])[2];
  mkdirSync(join(repo, ST, "receipts", run_id), { recursive: true });
  writeFileSync(join(repo, ST, "receipts", run_id, "receipt-M-001.json"), JSON.stringify({ type: "mitigation-review", subject_id: "M-001", packet_sha256, assertion: "gap", reviewer_run_id: run_id }));
  await ok(evidence(repo, ["receipt", "validate", "--run", run_id, join(ST, "receipts", run_id, "receipt-M-001.json")]));
  const r = await tmLint(repo, ["render", "--run", run_id]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, "RENDER-EXISTS\n");
  assert.match(readFileSync(join(runDir(repo, run_id), "threat-model.md"), "utf8"), /not independently reviewed/);
});

test("PM ruling R2: a citation on a file the review run recorded at `snapshot` (dirty) ⇒ TM-INVALID naming the element, verbatim", async () => {
  const repo = readyRepo({ record: fixtureRecord() });
  writeFileSync(join(repo, ORDERS), ORDERS_TEXT);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "orders"]);
  writeFileSync(join(repo, ORDERS), `${ORDERS_TEXT}// dirty\n`);
  const run_id = await initRun(repo, "review");
  const s = await ok(evidence(repo, ["scope", "--run", run_id]));
  assert.match(s.stdout, /snapshot=1/);
  writeModel(repo, model());
  const r = await tmLint(repo, ["check", "--run", run_id]);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout, "TM-INVALID(E-001: cites a dirty file; build the model on an assessment run)\n");
  assert.equal(existsSync(join(runDir(repo, run_id), "threat-model.json")), false);
  // a clean scope file in the same review run is fine
  writeModel(repo, model({ elements: [element({ citation: cite("src/app.js", [1, 1]) })] }));
  assert.equal((await ok(tmLint(repo, ["check", "--run", run_id]))).stdout.split("\n")[0], "TM elements=1 threats=1 undisposed=1");
});

test("run refusals: --run shape and unknown run ⇒ 2 USAGE; no scope ⇒ 3 INCOMPLETE(scope); the default model absent ⇒ 2 USAGE(check: cannot read …)", async () => {
  const repo = readyRepo({ record: fixtureRecord() });
  const bad = await tmLint(repo, ["check", "--run", "abc"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^USAGE\(check: --run must be <12 hex>-<4 digits>, got abc\)$/m);
  const unknown = await tmLint(repo, ["check", "--run", `${"0".repeat(12)}-0009`]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(check: unknown run 000000000000-0009\)$/m);
  const run_id = await initRun(repo, "threat-model");
  writeModel(repo, model());
  const noScope = await tmLint(repo, ["check", "--run", run_id]);
  assert.equal(noScope.code, 3);
  assert.equal(noScope.stdout, "INCOMPLETE(scope)\n");
  const noScopeRender = await tmLint(repo, ["render", "--run", run_id]);
  assert.equal(noScopeRender.code, 3, "render needs the snapshot, which needs the scope first");
  assert.equal(noScopeRender.stdout, "INCOMPLETE(threat-model)\n");
  await ok(evidence(repo, ["scope", "--run", run_id]));
  const { repo: other, run_id: otherRun } = await scopedRepo("threat-model");
  const absent = await tmLint(other, ["check", "--run", otherRun]);
  assert.equal(absent.code, 2);
  assert.match(absent.stdout, /^USAGE\(check: cannot read .*threat-model\.json\)$/m);
});

test("G-4: the snapshot and the view carry the redacted model; a secret in a claim never reaches disk or stdout", async () => {
  const { repo, run_id } = await scopedRepo("threat-model");
  const secret = "password=1234";
  writeModel(repo, model({ threats: [threat({ mitigations: [mitigation({ claim: `Token check (${secret})` })] })] }));
  const c = await ok(tmLint(repo, ["check", "--run", run_id]));
  assert.ok(!c.stdout.includes(secret) && !c.stderr.includes(secret));
  const snapshot = readFileSync(join(runDir(repo, run_id), "threat-model.json"), "utf8");
  assert.ok(!snapshot.includes(secret));
  assert.match(snapshot, /REDACTED/);
  await ok(tmLint(repo, ["render", "--run", run_id]));
  assert.ok(!readFileSync(join(runDir(repo, run_id), "threat-model.md"), "utf8").includes(secret));
});

test("--model is a user path: cwd-relative from a nested cwd, never root-relative; an outside-tree path is refused", async () => {
  const { repo, run_id } = await scopedRepo("threat-model");
  mkdirSync(join(repo, "sub"));
  writeModel(repo, model(), join("sub", "tm.json"));
  writeFileSync(join(repo, "tm.json"), "{not json", "utf8"); // a root-relative resolution would read this one
  const nested = await tmLint(join(repo, "sub"), ["check", "--run", run_id, "--model", "tm.json"]);
  assert.equal(nested.code, 0, `${nested.stdout}${nested.stderr}`);
  assert.equal(nested.stdout.split("\n")[0], "TM elements=1 threats=1 undisposed=1", "the valid model under sub/ was read");
  const climb = await tmLint(repo, ["check", "--run", run_id, "--model", "../tm.json"]);
  assert.equal(climb.code, 2);
  assert.equal(climb.stdout, "USAGE(check: cannot read ../tm.json (outside the work tree))\n");
});

function admissionPayload() {
  return JSON.parse(readFileSync(new URL("../fixtures/schemas/admission.ok.json", import.meta.url), "utf8"));
}
function observationPayload() {
  return JSON.parse(readFileSync(new URL("../fixtures/schemas/observation.ok.json", import.meta.url), "utf8"));
}
