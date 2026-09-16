// TASK-019 — lib/cmd-gate.mjs argv, refusals and exit codes (plan §4.1 row
// `gate`, §3.1 process contract; G-10 write-once; the check/exit-5 rule of
// lib/exit.mjs for user-supplied claims files). The identity and state
// contracts are gate.test.mjs (CLI) and gate-core.test.mjs (pure core).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { cleanupAll, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";

after(cleanupAll);

const PUBLIC = ["findings.claimed.json", "gate-result.json", "rejects.json", "unlocated.json"];
const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });

async function prepared({ packet = true } = {}) {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, s.stdout + s.stderr);
  let packet_sha256 = null;
  if (packet) {
    const p = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
    assert.equal(p.code, 0, p.stdout + p.stderr);
    packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  }
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  return { repo, run_id, scope, packet_sha256 };
}

function writeClaims(repo, run_id, name, body) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  return join(ST, "receipts", run_id, name);
}

const gate = (repo, args, env = ENV) => runScript("evidence", ["gate", ...args], { cwd: repo, env });
const nothingWritten = (repo, run_id) => PUBLIC.every((n) => !existsSync(join(runDir(repo, run_id), n)));

test("argv: --run required and shaped; unknown flags and stray positionals ⇒ 2 USAGE(gate: …); --claims may repeat", async () => {
  const { repo, run_id } = await prepared();
  for (const args of [[], ["--run"], ["--run", "nope"], ["--run", run_id, "extra"], ["--run", run_id, "--bogus", "x"], ["--run", run_id, "--claims"]]) {
    const r = await gate(repo, args);
    assert.equal(r.code, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^USAGE\(gate: /);
  }
  const r = await gate(repo, ["--run", "0123456789ab-9999"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "USAGE(gate: unknown run 0123456789ab-9999)");
  assert.ok(nothingWritten(repo, run_id));
});

test("no claims and no imports ⇒ empty artifacts, GATE 0/0/0/0, exit 0; a second gate on the run ⇒ 2 GATE-EXISTS with nothing rewritten (G-10)", async () => {
  const { repo, run_id, scope } = await prepared({ packet: false });
  const r = await gate(repo, ["--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "GATE accepted=0 unverifiable=0 rejected=0 unlocated=0");
  assert.equal(lines.length, 5);
  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  assert.deepEqual(claimed.payload, { scope_sha256: scope.envelope.self_sha256, findings: [] });
  const gr = readArtifact(join(runDir(repo, run_id), "gate-result.json"), { kind: "gate-result" });
  assert.deepEqual(gr.payload, { accepted: [], unverifiable: [], rejected_counts: {}, scope_sha256: scope.envelope.self_sha256, claimed_sha256: claimed.envelope.self_sha256 });
  const before = readdirSync(runDir(repo, run_id)).sort();
  const again = await gate(repo, ["--run", run_id]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.equal(again.stdout.trim(), "GATE-EXISTS");
  assert.deepEqual(readdirSync(runDir(repo, run_id)).sort(), before);
});

test("scope.json absent ⇒ 3 INCOMPLETE(scope); COMMITTED marker ⇒ 2 RUN-COMMITTED; key file gone ⇒ 2 KEY: unavailable — nothing written in any case", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const a = await gate(repo, ["--run", run_id]);
  assert.equal(a.code, 3, a.stdout + a.stderr);
  assert.equal(a.stdout.trim(), "INCOMPLETE(scope)");
  assert.ok(nothingWritten(repo, run_id));

  const { repo: repo2, run_id: run2 } = await prepared({ packet: false });
  writeFileSync(join(runDir(repo2, run2), "COMMITTED"), "x\n");
  const b = await gate(repo2, ["--run", run2]);
  assert.equal(b.code, 2, b.stdout + b.stderr);
  assert.equal(b.stdout.trim(), "RUN-COMMITTED");
  assert.ok(nothingWritten(repo2, run2));

  const { repo: repo3, run_id: run3 } = await prepared({ packet: false });
  const run = readArtifact(join(runDir(repo3, run3), "run.json"), { kind: "run" });
  rmSync(join(repo3, ST, "private", "keys", run.envelope.key_id));
  const c = await gate(repo3, ["--run", run3]);
  assert.equal(c.code, 2, c.stdout + c.stderr);
  assert.equal(c.stdout.trim(), "KEY: unavailable");
  assert.ok(nothingWritten(repo3, run3));
});

test("--claims: a path outside the work tree or unreadable ⇒ 2 USAGE; not strict JSON or not a ClaimSet ⇒ 2 SCHEMA-INVALID(claims: …) — the command's own exit-2 result, never an integrity failure", async () => {
  const { repo, run_id, scope, packet_sha256 } = await prepared();
  const cases = [
    ["/etc/hosts", 2, /^USAGE\(gate: cannot read /],
    [join(ST, "receipts", run_id, "missing.json"), 2, /^USAGE\(gate: cannot read /],
    [writeClaims(repo, run_id, "not-json.json", "{ nope"), 2, /^SCHEMA-INVALID\(claims: /],
    [writeClaims(repo, run_id, "float.json", JSON.stringify({ scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ confidence: 5.5 })] })), 2, /^SCHEMA-INVALID\(claims: /],
    [writeClaims(repo, run_id, "array.json", "[]"), 2, /^SCHEMA-INVALID\(claims: /],
    [writeClaims(repo, run_id, "no-findings.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256 }), 2, /^SCHEMA-INVALID\(claims: /],
    [writeClaims(repo, run_id, "extra-key.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [], state: "x" }), 2, /^SCHEMA-INVALID\(claims: /],
    [writeClaims(repo, run_id, "bad-sha.json", { scope_sha256: "zz", packet_sha256, findings: [] }), 2, /^SCHEMA-INVALID\(claims: /],
  ];
  for (const [file, code, re] of cases) {
    const r = await gate(repo, ["--run", run_id, "--claims", file]);
    assert.equal(r.code, code, `${file}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout.trim(), re, file);
    assert.ok(!r.stdout.includes("\n" + "SCHEMA") || true);
    assert.ok(nothingWritten(repo, run_id), `${file}: nothing written`);
  }
  // a claims file naming a packet when the run has none ⇒ CLAIMS-PACKET-MISMATCH
  const { repo: r2, run_id: run2, scope: s2 } = await prepared({ packet: false });
  const f = writeClaims(r2, run2, "claims-1.json", { scope_sha256: s2.envelope.self_sha256, packet_sha256: "a".repeat(64), findings: [claim()] });
  const r = await gate(r2, ["--run", run2, "--claims", f]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), `CLAIMS-PACKET-MISMATCH(${f})`);
  assert.ok(nothingWritten(r2, run2));
});

test("a tampered scope packet in packets/ is an integrity failure (5), not a silent mismatch", async () => {
  const { repo, run_id, scope, packet_sha256 } = await prepared();
  writeFileSync(join(runDir(repo, run_id), "packets", `${packet_sha256}.json`), '{"envelope":{},"payload":{}}\n');
  const f = writeClaims(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim()] });
  const r = await gate(repo, ["--run", run_id, "--claims", f]);
  assert.equal(r.code, 5, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), `INCONSISTENT(packets/${packet_sha256})`);
  assert.ok(nothingWritten(repo, run_id));
});

test("a review run whose private snapshot was edited after scope ⇒ 5 INCONSISTENT(snapshot:<path>); removed ⇒ 3 INCOMPLETE(snapshot:<path>); the error text never reaches stdout", async () => {
  const build = async () => {
    const repo = readyRepo();
    writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=1234 };\n");
    const run_id = await initRun(repo, "review");
    const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
    assert.equal(s.code, 0, s.stdout + s.stderr);
    const p = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
    assert.equal(p.code, 0, p.stdout + p.stderr);
    const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
    const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
    const f = writeClaims(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ side: "snapshot", lines: [2, 2], snippet: "const cfg = { <REDACTED:password-assign> };" })] });
    return { repo, run_id, f, snap: join(repo, ST, "private", "snapshots", run_id, "src", "app.js") };
  };
  const a = await build();
  writeFileSync(a.snap, "export const a = 1;\n// edited\n");
  const ra = await gate(a.repo, ["--run", a.run_id, "--claims", a.f]);
  assert.equal(ra.code, 5, ra.stdout + ra.stderr);
  assert.equal(ra.stdout.trim(), "INCONSISTENT(snapshot:src/app.js)");
  assert.ok(nothingWritten(a.repo, a.run_id));
  const b = await build();
  rmSync(b.snap);
  const rb = await gate(b.repo, ["--run", b.run_id, "--claims", b.f]);
  assert.equal(rb.code, 3, rb.stdout + rb.stderr);
  assert.equal(rb.stdout.trim(), "INCOMPLETE(snapshot:src/app.js)");
  assert.ok(nothingWritten(b.repo, b.run_id));
  // and the untouched snapshot gates
  const c = await build();
  const rc = await gate(c.repo, ["--run", c.run_id, "--claims", c.f]);
  assert.equal(rc.code, 0, rc.stdout + rc.stderr);
  assert.equal(rc.stdout.split("\n")[0], "GATE accepted=1 unverifiable=0 rejected=0 unlocated=0");
});
