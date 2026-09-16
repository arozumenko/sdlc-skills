// TASK-019 — `evidence.mjs gate` end to end (US-013 AC-1…AC-6, US-010 AC-4;
// spec §6.5 identity by content sensitivity, §6.1 `gate-result.json`, §6.2,
// §12 "non-secret finding citing password=1234 ⇒ keyed id, no plain hash
// anywhere in publishable artifacts"; plan §4.1 row `gate`, TL-4, TL-15).
// Every repo is built in a temp dir by the CLI harness; every run is
// allocated by the real `run init`, scoped by the real `scope`, packeted by
// the real `packet --kind scope` and fed by the real `ingest sarif`, so the
// bytes gate compares against are the bundle's own, never this test's guess.
// The pure core's contracts are gate-core.test.mjs; argv and refusals are
// cmd-gate.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactId, canonical, hmacHex, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll, git, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS, fixture } from "../fixtures/sarif/index.mjs";
import { DEFAULT_RULES, redactDeep, redactString } from "../redact.mjs";
import { walk } from "./fsx.mjs";
import { validate } from "./schema.mjs";
import { GATE_AGENT_WROTE_ID } from "./tokens.mjs";

after(cleanupAll);

const SECRET = "password=1234";
const GATE_LINE = /^GATE accepted=([0-9]+) unverifiable=([0-9]+) rejected=([0-9]+) unlocated=([0-9]+)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DUP_JS = "a();\nb();\na();\nb();\na();\n";
const PUBLIC = ["findings.claimed.json", "gate-result.json", "rejects.json", "unlocated.json"];

/** A repo with src/app.js, src/db.js (the secret on normalised line 6) and src/dup.js committed; a run, its scope and its scope packet. */
async function gateRepo({ kind = "assessment", dirty = false } = {}) {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  if (dirty) writeFileSync(join(repo, "src", "db.js"), `${DB_JS}export const dirty = 1;\n`);
  const run_id = await initRun(repo, kind);
  const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, `scope: ${s.stdout}${s.stderr}`);
  const p = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(p.code, 0, `packet: ${p.stdout}${p.stderr}`);
  const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  return { repo, run_id, scope, packet_sha256 };
}

/** Write a payload-only claims file into the agent drop-box (TL-4) and return its repo-relative path. */
function writeClaims(repo, run_id, name, set) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(set, null, 2));
  return join(ST, "receipts", run_id, name);
}

const claimsRef = (set) => sha256Hex(canonical(redactDeep(set, DEFAULT_RULES)));
const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });

async function gate(repo, run_id, claimsPaths = [], env = ENV) {
  const args = ["gate", "--run", run_id];
  for (const p of claimsPaths) args.push("--claims", p);
  return runScript("evidence", args, { cwd: repo, env });
}

function parseGateLine(stdout) {
  const m = GATE_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the GATE token: ${JSON.stringify(stdout)}`);
  return { accepted: Number(m[1]), unverifiable: Number(m[2]), rejected: Number(m[3]), unlocated: Number(m[4]) };
}

const readRun = (repo, run_id, name, kind) => readArtifact(join(runDir(repo, run_id), name), { kind });
const outputs = (repo, run_id) => ({
  claimed: readRun(repo, run_id, "findings.claimed.json", "claimed"),
  gateResult: readRun(repo, run_id, "gate-result.json", "gate-result"),
  rejects: readRun(repo, run_id, "rejects.json", "rejects"),
  unlocated: readRun(repo, run_id, "unlocated.json", "unlocated"),
});

function keyBytes(repo) {
  const current = readFileSync(join(repo, ST, "private", "keys", "current"), "utf8").trim();
  return readFileSync(join(repo, ST, "private", "keys", current));
}

/**
 * Every file the SCRIPTS wrote under <st> that contains `needle`: the agent
 * drop-box `receipts/` (TL-4) and the lead's ingest inputs under `imports/`
 * (plan §3.2: the raw files copied in for `ingest`) are not script output
 * and are skipped; `publicOnly` also skips private/.
 */
function filesContaining(repo, needle, { publicOnly = false } = {}) {
  const st = join(repo, ST);
  return walk(st).filter((rel) => {
    if (rel.startsWith("receipts/") || rel.startsWith("imports/")) return false;
    if (publicOnly && rel.startsWith("private/")) return false;
    const abs = join(st, rel);
    if (lstatSync(abs).isSymbolicLink()) return false;
    return readFileSync(abs).includes(needle);
  });
}

const citationRecordPath = (repo, run_id, id) => join(repo, ST, "private", "citations", run_id, `${id}.json`);
const plainId = (path, cls, snippet, occurrence) => sha256Hex(Buffer.from(`${path}\0${cls}\0${snippet}\0${occurrence}`, "utf8"));
const keyedId = (key, path, cls, snippet, occurrence) => hmacHex(key, Buffer.from(`${path}\0${cls}\0${redactString(snippet).text}\0${occurrence}`, "utf8"));

// --- §12 fixture ---------------------------------------------------------------------

test("non-secret finding citing password=1234 ⇒ keyed id, no plain hash anywhere in publishable artifacts (US-013 AC-2)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ class: "config", path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` })] };
  const file = writeClaims(repo, run_id, "claims-1.json", set);
  const r = await gate(repo, run_id, [file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 1, unverifiable: 0, rejected: 0, unlocated: 0 });
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 5, "GATE + WROTE ×4");
  for (let i = 0; i < PUBLIC.length; i++) assert.match(lines[i + 1], new RegExp(`^WROTE ${ST}/runs/${run_id}/${PUBLIC[i].replace(".", "\\.")} sha256=[0-9a-f]{64}$`));

  const key = keyBytes(repo);
  const { claimed, gateResult } = outputs(repo, run_id);
  const [f] = claimed.payload.findings;
  const keyed = keyedId(key, "src/db.js", "config", `// ${SECRET}`, 0);
  const plain = plainId("src/db.js", "config", `// ${SECRET}`, 0);
  assert.equal(f.id, keyed);
  assert.equal(f.sensitive, true);
  assert.equal(f.snippet_redacted, "// <REDACTED:password-assign>");
  assert.ok(!("snippet" in f));
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.deepEqual(gateResult.payload.accepted, [keyed]);
  assert.deepEqual(filesContaining(repo, plain, { publicOnly: true }), [], "the plain sha256 of protected content is in no publishable artifact");
  assert.deepEqual(filesContaining(repo, plain), [], "…nor under private/");
  assert.deepEqual(filesContaining(repo, SECRET), [], "the claimed text is nowhere under <st>, the drop-box excepted");
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
});

test("plain identity when no rule matches: snippet stored, id = sha256(path\\0class\\0snippet\\0occurrence), gate-result names it accepted (US-013 AC-1)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim()] };
  const r = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { claimed, gateResult } = outputs(repo, run_id);
  const [f] = claimed.payload.findings;
  assert.equal(f.id, plainId("src/app.js", "config", "export const a = 1;", 0));
  assert.equal(f.snippet, "export const a = 1;");
  assert.ok(!("sensitive" in f) && !("snippet_redacted" in f));
  assert.deepEqual(gateResult.payload.accepted, [f.id]);
  assert.ok(!existsSync(join(repo, ST, "private", "citations", run_id)), "a plain finding writes no private record");
  assert.equal(claimed.envelope.kind, "claimed");
  assert.equal(claimed.envelope.run_id, run_id);
  assert.equal(claimed.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  const run = readRun(repo, run_id, "run.json", "run");
  assert.equal(claimed.envelope.key_id, run.envelope.key_id);
});

test("private citation record written before discard; claimed text absent from every file (US-013 AC-3)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const set = {
    scope_sha256: scope.envelope.self_sha256,
    packet_sha256,
    findings: [
      claim({ class: "config", path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` }),
      // wrong text: FAILED, still sensitive. Another class, because the keyed preimage is over the REDACTED
      // snippet: two claims of the same line and class that differ only in the secret value are one identity.
      claim({ class: "auth", path: "src/db.js", lines: [6, 6], snippet: "// password=9999" }),
    ],
  };
  const r = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const key = keyBytes(repo);
  const { claimed, gateResult } = outputs(repo, run_id);
  const verified = claimed.payload.findings.find((f) => f.state === "CITATION_VERIFIED");
  const failed = claimed.payload.findings.find((f) => f.state === "CITATION_FAILED");
  assert.ok(verified && failed);
  assert.deepEqual(gateResult.payload.accepted, [verified.id]);
  assert.deepEqual(gateResult.payload.unverifiable, [failed.id]);
  const sf = scope.payload.files.find((f) => f.path === "src/db.js");
  for (const [f, claimedText, match] of [
    [verified, `// ${SECRET}`, true],
    [failed, "// password=9999", false],
  ]) {
    const rec = readArtifact(citationRecordPath(repo, run_id, f.id), { kind: "citation-record" });
    assert.deepEqual(validate("citation-record", rec.payload), []);
    assert.deepEqual(rec.payload, {
      claimed_hmac: hmacHex(key, Buffer.from(claimedText)),
      source_hmac: hmacHex(key, Buffer.from(`// ${SECRET}`)),
      match,
      side: "head",
      oid: sf.oid,
      redaction_version: DEFAULT_RULES.redaction_version,
    });
    assert.equal(rec.envelope.run_id, run_id);
    assert.equal(rec.envelope.kind, "citation-record");
  }
  assert.deepEqual(readdirSync(join(repo, ST, "private", "citations", run_id)).sort(), [verified.id, failed.id].map((id) => `${id}.json`).sort());
  // the private records exist before the public artifacts were named: a record is never younger than findings.claimed.json
  const recordTime = Math.max(...[verified, failed].map((f) => lstatSync(citationRecordPath(repo, run_id, f.id)).mtimeMs));
  assert.ok(recordTime <= lstatSync(join(runDir(repo, run_id), "findings.claimed.json")).mtimeMs);
  for (const needle of [SECRET, "password=9999"]) assert.deepEqual(filesContaining(repo, needle), [], `${needle} is in no file under <st>`);
});

test("secret class uses context_redacted (US-013 AC-4) — from an agent claim and from a gitleaks SARIF record alike", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  copyFileSync(fixture("gitleaks.sarif"), join(repo, ST, "imports", "gitleaks.sarif"));
  const ing = await runScript("evidence", ["ingest", "sarif", join(ST, "imports", "gitleaks.sarif"), "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(ing.code, 0, ing.stdout + ing.stderr);
  const import_sha256 = /import_sha256=([0-9a-f]{64})/.exec(ing.stdout)[1];
  // an agent secret-class claim on a line NO rule catches (line 2): keyed all the same
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ class: "secret", path: "src/db.js", lines: [2, 2], snippet: "export function find(req) {" })] };
  const r = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 2, unverifiable: 0, rejected: 0, unlocated: 0 });
  const key = keyBytes(repo);
  const { claimed } = outputs(repo, run_id);
  const fromSarif = claimed.payload.findings.find((f) => f.source.kind === "sarif");
  const fromAgent = claimed.payload.findings.find((f) => f.source.kind === "agent");
  assert.deepEqual(fromSarif.source, { kind: "sarif", ref: import_sha256, index: 0 });
  assert.equal(fromSarif.class, "secret");
  assert.equal(fromSarif.context_redacted, "// <REDACTED:password-assign>");
  assert.equal(fromSarif.sensitive, true);
  assert.equal(fromSarif.id, keyedId(key, "src/db.js", "secret", `// ${SECRET}`, 0));
  assert.ok(!("snippet" in fromSarif) && !("snippet_redacted" in fromSarif));
  assert.equal(fromAgent.context_redacted, "export function find(req) {");
  assert.equal(fromAgent.sensitive, true);
  assert.equal(fromAgent.id, keyedId(key, "src/db.js", "secret", "export function find(req) {", 0));
  assert.notEqual(fromAgent.id, plainId("src/db.js", "secret", "export function find(req) {", 0));
  for (const f of [fromSarif, fromAgent]) assert.ok(existsSync(citationRecordPath(repo, run_id, f.id)), "secret-class findings always carry a private record");
  assert.deepEqual(filesContaining(repo, SECRET), []);
});

test("states and occurrence recomputed ignoring the hint; gate-result payload shape (US-013 AC-5)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const set = {
    scope_sha256: scope.envelope.self_sha256,
    packet_sha256,
    findings: [
      claim({ path: "src/dup.js", lines: [5, 5], snippet: "a();", occurrence_hint: 0 }),
      claim({ path: "src/dup.js", lines: [2, 2], snippet: "a();", occurrence_hint: 4 }),
      claim({ path: "src/dup.js", lines: [3, 4], snippet: "a();\r\nb();", occurrence_hint: 9 }),
    ],
  };
  const r = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 2, unverifiable: 1, rejected: 0, unlocated: 0 });
  const { claimed, gateResult, rejects, unlocated } = outputs(repo, run_id);
  const by = (i) => claimed.payload.findings.find((f) => f.source.index === i);
  assert.equal(by(0).occurrence, 2);
  assert.equal(by(0).state, "CITATION_VERIFIED");
  assert.equal(by(1).occurrence, 0);
  assert.equal(by(1).state, "CITATION_FAILED");
  assert.equal(by(2).occurrence, 1);
  assert.equal(by(2).state, "CITATION_VERIFIED");
  assert.equal(by(2).snippet, "a();\nb();");
  assert.deepEqual(Object.keys(gateResult.payload).sort(), ["accepted", "claimed_sha256", "rejected_counts", "scope_sha256", "unverifiable"]);
  assert.deepEqual(gateResult.payload.accepted, [by(0).id, by(2).id].sort());
  assert.deepEqual(gateResult.payload.unverifiable, [by(1).id]);
  assert.deepEqual(gateResult.payload.rejected_counts, {});
  assert.equal(gateResult.payload.scope_sha256, scope.envelope.self_sha256);
  assert.equal(gateResult.payload.claimed_sha256, claimed.envelope.self_sha256, "claimed_sha256 is the on-disk identity of findings.claimed.json");
  assert.equal(claimed.payload.scope_sha256, scope.envelope.self_sha256);
  assert.deepEqual(rejects.payload, { rejected: [] });
  assert.deepEqual(unlocated.payload, { candidates: [] });
  for (const [name, kind] of [["findings.claimed.json", "claimed"], ["gate-result.json", "gate-result"], ["rejects.json", "rejects"], ["unlocated.json", "unlocated"]]) {
    const art = readRun(repo, run_id, name, kind);
    assert.deepEqual(validate(kind, art.payload), [], name);
    assert.equal(art.envelope.self_sha256, artifactId(art.payload));
  }
});

test("deterministic re-run byte-identical: a fresh run over the same tree and the same claims yields the same payloads, identities and ids (US-013 AC-6)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const findings = [claim({ path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` }), claim({ path: "src/dup.js", lines: [3, 3], snippet: "a();" })];
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings };
  const a = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(a.code, 0, a.stdout + a.stderr);

  const run2 = await initRun(repo, "assessment");
  const s = await runScript("evidence", ["scope", "--run", run2], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, s.stdout + s.stderr);
  const p = await runScript("evidence", ["packet", "--run", run2, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const scope2 = readRun(repo, run2, "scope.json", "scope");
  assert.equal(scope2.envelope.self_sha256, scope.envelope.self_sha256, "scope identity is independent of the run (G-1)");
  const b = await gate(repo, run2, [writeClaims(repo, run2, "claims-1.json", set)], { ...ENV, SECURITY_EVIDENCE_NOW: "2027-01-01T00:00:00Z" });
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.equal(a.stdout.split("\n")[0], b.stdout.split("\n")[0]);
  for (const name of PUBLIC) {
    const x = parseStrict(readFileSync(join(runDir(repo, run_id), name)));
    const y = parseStrict(readFileSync(join(runDir(repo, run2), name)));
    assert.deepEqual(y.payload, x.payload, `${name}: payload`);
    assert.equal(y.envelope.self_sha256, x.envelope.self_sha256, `${name}: identity`);
    const strip = (o) => ({ ...o, run_id: null, created_at: null });
    assert.deepEqual(strip(y.envelope), strip(x.envelope), `${name}: the envelope differs only by run_id and created_at`);
    // byte-identical up to the envelope's run_id / created_at: same canonical bytes once those two are replaced
    const bytes = (dir) => readFileSync(join(dir, name), "utf8").replace(run_id, "RUN").replace(run2, "RUN").replace(/"created_at":"[^"]+"/, '"created_at":"T"');
    assert.equal(bytes(runDir(repo, run2)), bytes(runDir(repo, run_id)), `${name}: bytes`);
  }
  const recs = (id) => readdirSync(join(repo, ST, "private", "citations", id)).sort();
  assert.deepEqual(recs(run2), recs(run_id));
  for (const name of recs(run_id)) {
    assert.deepEqual(readArtifact(join(repo, ST, "private", "citations", run2, name)).payload, readArtifact(join(repo, ST, "private", "citations", run_id, name)).payload);
  }
});

test("SARIF unlocated candidates never reach gate: copied into unlocated.json unchanged, counted on the GATE line, never a finding (US-010 AC-4)", async () => {
  const { repo, run_id } = await gateRepo();
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  const expected = [];
  for (const name of ["no-location.sarif", "out-of-scope.sarif", "located.sarif"]) {
    copyFileSync(fixture(name), join(repo, ST, "imports", name));
    const ing = await runScript("evidence", ["ingest", "sarif", join(ST, "imports", name), "--run", run_id], { cwd: repo, env: ENV });
    assert.equal(ing.code, 0, `${name}: ${ing.stdout}${ing.stderr}`);
    const sha = /import_sha256=([0-9a-f]{64})/.exec(ing.stdout)[1];
    expected.push({ sha, unlocated: readRun(repo, run_id, join("ingest", `${sha}.json`), "import").payload.unlocated });
  }
  const r = await gate(repo, run_id);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 1, unverifiable: 0, rejected: 0, unlocated: 8 });
  const { claimed, unlocated } = outputs(repo, run_id);
  expected.sort((x, y) => (x.sha < y.sha ? -1 : 1));
  assert.deepEqual(unlocated.payload.candidates, expected.flatMap((e) => e.unlocated), "import order is by import_sha256, entries verbatim");
  assert.equal(unlocated.payload.candidates.length, 8);
  assert.equal(claimed.payload.findings.length, 1);
  assert.equal(claimed.payload.findings[0].source.kind, "sarif");
  assert.deepEqual(claimed.payload.findings[0].lines, [3, 4]);
  for (const f of claimed.payload.findings) assert.ok(!f.path.includes("notes.md") && !f.path.includes("missing.js") && !f.path.includes("other.js"));
});

test("claim carrying id/state rejected: agent-wrote-id, counted, located by claims_sha256 + index, never a finding (G-7)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ id: "f".repeat(64) }), claim({ state: "CITATION_VERIFIED" }), claim({ path: "src/dup.js", lines: [1, 1], snippet: "a();" })] };
  const file = writeClaims(repo, run_id, "claims-1.json", set);
  const r = await gate(repo, run_id, [file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 1, unverifiable: 0, rejected: 2, unlocated: 0 });
  const { claimed, gateResult, rejects } = outputs(repo, run_id);
  const ref = claimsRef(set);
  assert.deepEqual(rejects.payload.rejected, [
    { reason: GATE_AGENT_WROTE_ID, locator: { claims_sha256: ref, index: 0 } },
    { reason: GATE_AGENT_WROTE_ID, locator: { claims_sha256: ref, index: 1 } },
  ]);
  assert.deepEqual(gateResult.payload.rejected_counts, { [GATE_AGENT_WROTE_ID]: 2 });
  assert.equal(claimed.payload.findings.length, 1);
  assert.notEqual(claimed.payload.findings[0].id, "f".repeat(64));
  assert.equal(claimed.payload.findings[0].source.index, 2);
});

test("claims file naming a subject packet or a foreign run's packet ⇒ CLAIMS-PACKET-MISMATCH(<file>), exit 2, nothing written (TL-15)", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  // a foreign run: a different tree ⇒ a different scope packet
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "app changed"]);
  const foreign = await initRun(repo, "assessment");
  const fs_ = await runScript("evidence", ["scope", "--run", foreign], { cwd: repo, env: ENV });
  assert.equal(fs_.code, 0, fs_.stdout + fs_.stderr);
  const fp = await runScript("evidence", ["packet", "--run", foreign, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(fp.code, 0, fp.stdout + fp.stderr);
  const foreignPacket = /sha256=([0-9a-f]{64})/.exec(fp.stdout)[1];
  assert.notEqual(foreignPacket, packet_sha256);
  // a hand-made subject packet artifact of this run (TASK-021's shape), written like packet does
  const scopePacket = readArtifact(join(runDir(repo, run_id), "packets", `${packet_sha256}.json`), { kind: "packet" });
  const subjectPayload = { ...scopePacket.payload, kind: "subject", subject_ids: ["a".repeat(64)] };
  const subjectSha = artifactId(subjectPayload);
  writeFileSync(join(runDir(repo, run_id), "packets", `${subjectSha}.json`), `${canonical({ envelope: { ...scopePacket.envelope, self_sha256: subjectSha }, payload: subjectPayload }).toString()}\n`);

  const ok = writeClaims(repo, run_id, "claims-ok.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim()] });
  for (const [name, sha] of [
    ["claims-subject.json", subjectSha],
    ["claims-foreign.json", foreignPacket],
  ]) {
    const bad = writeClaims(repo, run_id, name, { scope_sha256: scope.envelope.self_sha256, packet_sha256: sha, findings: [claim()] });
    const r = await gate(repo, run_id, [ok, bad]);
    assert.equal(r.code, 2, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), `CLAIMS-PACKET-MISMATCH(${bad})`);
    for (const out of PUBLIC) assert.ok(!existsSync(join(runDir(repo, run_id), out)), `${out} not written`);
    assert.ok(!existsSync(join(repo, ST, "private", "citations", run_id)));
  }
  // the good file alone gates
  const r = await gate(repo, run_id, [ok]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("source field distinguishes agent and sarif candidates: {kind: agent, ref: sha256 of the redacted canonical claims, index} vs {kind: sarif, ref: import_sha256, index}", async () => {
  const { repo, run_id, scope, packet_sha256 } = await gateRepo();
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  copyFileSync(fixture("located.sarif"), join(repo, ST, "imports", "located.sarif"));
  const ing = await runScript("evidence", ["ingest", "sarif", join(ST, "imports", "located.sarif"), "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(ing.code, 0, ing.stdout + ing.stderr);
  const import_sha256 = /import_sha256=([0-9a-f]{64})/.exec(ing.stdout)[1];
  const set = { scope_sha256: scope.envelope.self_sha256, packet_sha256, findings: [claim({ path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` }), claim()] };
  const file = writeClaims(repo, run_id, "claims-1.json", set);
  const r = await gate(repo, run_id, [file]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 3, unverifiable: 0, rejected: 0, unlocated: 0 });
  const { claimed } = outputs(repo, run_id);
  const sarif = claimed.payload.findings.filter((f) => f.source.kind === "sarif");
  const agent = claimed.payload.findings.filter((f) => f.source.kind === "agent").sort((x, y) => x.source.index - y.source.index);
  assert.equal(sarif.length, 1);
  assert.deepEqual(sarif[0].source, { kind: "sarif", ref: import_sha256, index: 0 });
  assert.equal(sarif[0].title, "Semgrep OSS: javascript.express.sqli.tainted-sql-string");
  assert.equal(sarif[0].snippet, 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);');
  assert.equal(sarif[0].requires_typed_citations, true);
  assert.equal(sarif[0].state, "CITATION_VERIFIED");
  const ref = claimsRef(set);
  assert.match(ref, SHA256);
  assert.notEqual(ref, sha256Hex(readFileSync(join(repo, file))), "never the plain sha256 of the claims file bytes: they can carry protected content (G-2)");
  assert.deepEqual(
    agent.map((f) => f.source),
    [
      { kind: "agent", ref, index: 0 },
      { kind: "agent", ref, index: 1 },
    ],
  );
  assert.equal(agent[0].sensitive, true);
  assert.deepEqual(filesContaining(repo, SECRET), [], "the drop-box is the agent's; nothing the script wrote carries the text");
});

test("review run: a base citation is checked against the base blob, not head's admitted ranges; a snapshot-side dirty file verifies against the redacted bytes", async () => {
  // src/dup.js shrinks between base (5 lines) and head (2 lines): a base citation of line 5 is inside the base blob and outside head's admitted range
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const baseRef = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "src", "dup.js"), "a();\nb();\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "dup shrinks"]);
  writeFileSync(join(repo, "src", "db.js"), `${DB_JS}export const dirty = 1;\n`); // dirty ⇒ snapshot side in a review run
  const init = await runScript("evidence", ["run", "init", "--kind", "review", "--base", baseRef], { cwd: repo, env: ENV });
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const run_id = /^RUN (\S+)/.exec(init.stdout)[1];
  const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, s.stdout + s.stderr);
  const p = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  const scope = readRun(repo, run_id, "scope.json", "scope");
  assert.deepEqual(scope.payload.ranges["src/dup.js"], [[1, 2]], "head admits two lines");
  assert.equal(scope.payload.files.find((f) => f.path === "src/db.js").side, "snapshot");
  const set = {
    scope_sha256: scope.envelope.self_sha256,
    packet_sha256,
    findings: [
      claim({ path: "src/dup.js", side: "base", lines: [5, 5], snippet: "a();" }), // beyond head's range, inside the base blob ⇒ admitted at base
      claim({ path: "src/dup.js", side: "base", lines: [6, 6], snippet: "a();" }), // beyond the base blob ⇒ RANGE-OUTSIDE-FILE
      claim({ path: "src/dup.js", side: "head", lines: [5, 5], snippet: "a();" }), // head: not admitted
      claim({ path: "src/db.js", side: "snapshot", lines: [6, 6], snippet: "// <REDACTED:password-assign>" }), // the reviewer read redacted bytes
    ],
  };
  const r = await gate(repo, run_id, [writeClaims(repo, run_id, "claims-1.json", set)]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseGateLine(r.stdout), { accepted: 2, unverifiable: 0, rejected: 2, unlocated: 0 });
  const key = keyBytes(repo);
  const { claimed, rejects } = outputs(repo, run_id);
  const by = (i) => claimed.payload.findings.find((f) => f.source.index === i);
  assert.equal(by(0).state, "CITATION_VERIFIED");
  assert.equal(by(0).occurrence, 2);
  assert.equal(by(0).side, "base");
  assert.deepEqual(rejects.payload.rejected.map((x) => [x.locator.index, x.reason]), [
    [1, "RANGE-OUTSIDE-FILE"],
    [2, "RANGE-NOT-ADMITTED"],
  ]);
  assert.equal(by(3).state, "CITATION_VERIFIED");
  assert.equal(by(3).snippet, "// <REDACTED:password-assign>");
  assert.ok(!("sensitive" in by(3)), "a marker matches no rule: plain identity over redacted text (G-2 allowance)");
  assert.equal(by(3).id, plainId("src/db.js", "config", "// <REDACTED:password-assign>", 0));
  assert.notEqual(by(3).id, keyedId(key, "src/db.js", "config", `// ${SECRET}`, 0));
  assert.deepEqual(filesContaining(repo, SECRET).filter((f) => !f.startsWith("receipts/")), []);
});
