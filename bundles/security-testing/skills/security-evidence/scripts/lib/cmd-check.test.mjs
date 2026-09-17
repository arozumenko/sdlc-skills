// TASK-025 — `evidence.mjs check <run dir | manifest.json> [--integrity]
// [--drift] [--trusted-digest <sha256>]` (plan §4.1 row `check`, §5
// TASK-025; spec §2 rows 1–2, §6.2, §6.3 derivation table + result lines,
// §6.5 replay, §12; US-017 AC-1…AC-8, US-005 AC-4, US-009 AC-5; G-16).
//
// Every repo is built in a temp dir by the CLI harness and every run by the
// real commands (run init → scope → packet → gate → coverage → [receipt] →
// build-report), so `check` recomputes over the bundle's own artifacts. A
// COMMITTED review fixture is built once and copied per test (the key lives
// inside the repo, so a copy checks identically); tamper helpers re-envelope
// an artifact hash-consistently and re-forge the manifest + marker, which is
// how the derivation-level checks (not the file-level ones) are reached.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs, { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript, tmpDir } from "../fixtures/cli/harness.mjs";
import { ENV, ST, ctxFor, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS, fixture } from "../fixtures/sarif/index.mjs";
import { loadTemplate } from "./cmd-build-report.mjs";
import { checkRun } from "./cmd-check.mjs";
import { closeOver } from "./inputs.mjs";
import { CITATION_FAILED, CITATION_VERIFIED } from "./tokens.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, "..");
const SKILL = resolve(SCRIPTS, "..");
const VERIFY_FIXTURES = join(SCRIPTS, "fixtures", "verify");
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
const DUP_JS = "a();\nb();\na();\nb();\na();\n";
const NOW = () => ENV.SECURITY_EVIDENCE_NOW;

const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });
const CLAIMS = Object.freeze({
  injection: claim({
    title: "sql built from req.query.id",
    class: "injection",
    priority: "p1",
    path: "src/db.js",
    lines: [3, 4],
    snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
    description: "User input reaches the query string.",
    cwe: "CWE-89",
    citations_typed: [
      { role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true },
      { role: "source", path: "src/app.js", side: "head", lines: [1, 1], context: true },
    ],
  }),
  app: claim({ title: "app export", class: "config", path: "src/app.js", lines: [1, 1], snippet: "export const a = 1;" }),
  // the spec §6.5 fixture: a non-secret-class finding citing password=1234 ⇒ keyed identity
  sensitive: claim({ title: "credential in a comment", class: "config", priority: "p0", path: "src/db.js", lines: [6, 6], snippet: "// password=1234" }),
  failed: claim({ title: "not what the file says", class: "config", priority: "p3", path: "src/dup.js", lines: [1, 1], snippet: "z();" }),
  wroteId: claim({ id: "f".repeat(64) }),
  tooLong: claim({ title: "too long", path: "src/db.js", lines: [1, 50], snippet: "x" }),
});

const evidence = (repo, args, env = ENV) => runScript("evidence", args, { cwd: repo, env });
const register = (repo, args) => runScript("register", args, { cwd: repo, env: ENV });
const check = (repo, args) => evidence(repo, ["check", ...args]);
const lines = (s) => s.split("\n").filter((l) => l !== "");

function drop(repo, run_id, name, value) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2));
  return join(ST, "receipts", run_id, name);
}

function parsePacketLine(stdout) {
  const m = PACKET_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `PACKET line: ${JSON.stringify(stdout)}`);
  return { path: m[1], sha256: m[2] };
}

const ok = (r, what) => {
  assert.equal(r.code, 0, `${what}: ${r.stdout}${r.stderr}`);
  return r;
};

/** Every finding of the run's claimed artifact, by title. */
function findings(dir) {
  const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
  const byTitle = (title) => {
    const f = claimed.payload.findings.find((x) => x.title === title);
    assert.ok(f, `gated finding titled ${JSON.stringify(title)}`);
    return f;
  };
  return { claimed, injection: byTitle(CLAIMS.injection.title), app: byTitle(CLAIMS.app.title), sensitive: byTitle(CLAIMS.sensitive.title), failed: byTitle(CLAIMS.failed.title) };
}

/**
 * A COMMITTED review run over src/app.js, src/db.js, src/dup.js: scoped,
 * scope-packeted, gated over CLAIMS (three accepted — one keyed —, one
 * CITATION_FAILED, two rejected), covered over src/db.js 1-4, a subject
 * packet over the two plain accepted findings, optionally a confirmed
 * vulnerability-review receipt on `injection`, then built.
 */
async function buildReview({ withReceipt = false } = {}) {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const scopePacket = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet").stdout).sha256;
  const claims = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: Object.values(CLAIMS) });
  const g = ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claims]), "gate");
  assert.match(g.stdout, /^GATE accepted=3 unverifiable=1 rejected=2 unlocated=0/);
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: scopePacket, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  const f = findings(dir);
  const subject = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", f.injection.id, "--subject", f.app.id]), "subject packet").stdout).sha256;
  let receipt = null;
  if (withReceipt) {
    const file = drop(repo, run_id, "receipt-1.json", { type: "vulnerability-review", subject_id: f.injection.id, packet_sha256: subject, assertion: "confirmed", reviewer_run_id: run_id });
    receipt = /sha256=([0-9a-f]{64})/.exec(ok(await evidence(repo, ["receipt", "validate", "--run", run_id, file]), "receipt validate").stdout)[1];
  }
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
  return { repo, run_id, dir, scopePacket, subject, receipt };
}

const cache = new Map();
/** A fresh copy of the cached COMMITTED review fixture (built once per variant). */
async function reviewRepo(variant = "plain") {
  if (!cache.has(variant)) cache.set(variant, await buildReview({ withReceipt: variant === "receipt" }));
  const src = cache.get(variant);
  const repo = tmpDir("sec-check-");
  cpSync(src.repo, repo, { recursive: true });
  const dir = runDir(repo, src.run_id);
  return { ...src, repo, dir, ...findings(dir) };
}

// --- tamper helpers ------------------------------------------------------------------

/** Rewrite an enveloped artifact with a mutated payload under the same envelope head (hash-consistent). Returns the written artifact. */
function reenvelope(path, mutate, { kind } = {}) {
  const art = readArtifact(path, kind === undefined ? {} : { kind });
  const payload = structuredClone(art.payload);
  mutate(payload);
  const { schema_version, engagement_id, key_id, run_id } = art.envelope;
  rmSync(path);
  return writeArtifact(path, makeEnvelope({ schema_version, kind: art.envelope.kind, run_id, engagement_id, key_id, now: NOW }, payload), { prered: true });
}

/** Re-envelope a content-addressed set member and re-file it under its new identity. */
function reenvelopeMember(dir, sub, sha, mutate) {
  const art = reenvelope(join(dir, sub, `${sha}.json`), mutate);
  const to = join(dir, sub, `${art.envelope.self_sha256}.json`);
  fs.renameSync(join(dir, sub, `${sha}.json`), to);
  return art.envelope.self_sha256;
}

/** Recompute manifest.json + COMMITTED over the run directory as it is now (a consistent forgery of the sidecar); returns the new manifest identity. */
function reforge(repo, dir) {
  const ctx = ctxFor(repo);
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  const template = run.payload.template;
  const inputs = closeOver(dir, template, { ledgerDir: join(repo, ST, "ledger", run.envelope.run_id) });
  const parsed = loadTemplate(template);
  const payload = { inputs: inputs.hashes, report_sha256: sha256Hex(readFileSync(join(dir, "report.md"))), template, template_version: parsed.template_version, tool_version: ctx.toolVersion() };
  const { schema_version, engagement_id, key_id, run_id } = run.envelope;
  rmSync(join(dir, "manifest.json"));
  rmSync(join(dir, "COMMITTED"));
  const m = writeArtifact(join(dir, "manifest.json"), makeEnvelope({ schema_version, kind: "manifest", run_id, engagement_id, key_id, now: NOW }, payload));
  writeFileSync(join(dir, "COMMITTED"), `${m.envelope.self_sha256}\n`);
  return m.envelope.self_sha256;
}

/** Drop the three build outputs and run build-report again: a full-set forgery (the report re-rendered over the tampered inputs). */
async function rebuild(repo, run_id, template) {
  const dir = runDir(repo, run_id);
  for (const f of ["report.md", "manifest.json", "COMMITTED"]) rmSync(join(dir, f), { force: true });
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", template]), "rebuild");
}

const committedOf = (dir) => readFileSync(join(dir, "COMMITTED"), "utf8").trim();
const keyFile = (repo, dir) => join(repo, ST, "private", "keys", readArtifact(join(dir, "run.json"), { kind: "run" }).envelope.key_id);

// --- AC-1: the happy path ----------------------------------------------------------------

test("untouched COMMITTED run ⇒ CONSISTENT, CURRENT, ORIGIN: unauthenticated, KEY: available, exit 0 (US-017 AC-1); run dir and manifest.json are both accepted; --integrity agrees", async () => {
  const { repo, run_id, dir } = await reviewRepo();
  const r = await check(repo, [join(ST, "runs", run_id), "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  const viaManifest = await check(repo, [join(ST, "runs", run_id, "manifest.json")]);
  assert.equal(viaManifest.code, 0, `${viaManifest.stdout}${viaManifest.stderr}`);
  assert.deepEqual(lines(viaManifest.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"], "no --drift ⇒ no drift line");
  const full = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(full.code, 0, `${full.stdout}${full.stderr}`);
  assert.deepEqual(lines(full.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  // the programmatic entry sign-off uses: the same result, structured
  const result = checkRun(ctxFor(repo), dir, { integrity: true, drift: true });
  assert.equal(result.code, 0);
  assert.equal(result.consistency.token, "CONSISTENT");
  assert.equal(result.consistency.redacted_only, 0);
  assert.equal(result.drift.token, "CURRENT");
  assert.deepEqual([result.drift.citations_drifted, result.drift.scope_drifted], [0, 0]);
  assert.equal(result.origin.token, "ORIGIN: unauthenticated");
  assert.equal(result.origin.recomputed_manifest_sha256, committedOf(dir), "the recomputed manifest hash is the marker's for an untouched run");
  assert.equal(result.key.token, "KEY: available");
  assert.ok(result.consistency.checked.citations >= 4 && result.consistency.checked.packets >= 2, JSON.stringify(result.consistency.checked));
  // nothing is written by check
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith(".")), []);
});

test("usage and refusals: no path, two paths, unknown flag, a path outside the tree, a directory that is not a run, a run without COMMITTED ⇒ 3 INCOMPLETE(COMMITTED), a malformed --trusted-digest", async () => {
  const { repo, run_id, dir } = await reviewRepo();
  const cases = [
    [[], 2, /^USAGE\(check: a run directory or manifest\.json path is required\)$/],
    [[join(ST, "runs", run_id), "extra"], 2, /^USAGE\(check: unexpected argument extra\)$/],
    [[join(ST, "runs", run_id), "--nope"], 2, /^USAGE\(check: unknown flag --nope\)$/],
    [["/etc"], 2, /^USAGE\(check: cannot read \/etc \(outside the work tree\)\)$/],
    [["src"], 2, /^USAGE\(check: src is not a run directory or manifest\.json under /],
    [[join(ST, "runs", "0123456789ab-0042")], 2, /^USAGE\(check: unknown run 0123456789ab-0042\)$/],
    [[join(ST, "runs", run_id), "--trusted-digest", "abc"], 2, /^USAGE\(check: --trusted-digest must be 64 lowercase hex chars/],
  ];
  for (const [args, code, re] of cases) {
    const r = await check(repo, args);
    assert.equal(r.code, code, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout.trim(), re, args.join(" "));
  }
  fs.renameSync(join(dir, "COMMITTED"), join(dir, "COMMITTED.aside"));
  const r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, "INCOMPLETE(COMMITTED)\n");
});

// --- AC-2: every derivation-table row -----------------------------------------------------

test("derivation table, file level: a tampered artifact (self_sha256 no longer matches) ⇒ INCONSISTENT(<file>); a re-enveloped input the manifest never saw ⇒ INCONSISTENT(input:<kind>); a deleted input ⇒ INCONSISTENT(input:<kind>); a report edit ⇒ INCONSISTENT(<view path>) naming the line's marker; a tampered marker ⇒ INCONSISTENT(COMMITTED); exit 5", async () => {
  const cases = [
    ["scope.json edited in place", (dir) => writeFileSync(join(dir, "scope.json"), readFileSync(join(dir, "scope.json"), "utf8").replace('"files"', '"filez"')), "INCONSISTENT(scope.json)"],
    ["coverage.json re-enveloped", (dir) => reenvelope(join(dir, "coverage.json"), (p) => (p.examined_sha256 = "0".repeat(64))), "INCONSISTENT(input:coverage)"],
    ["unlocated.json deleted", (dir) => rmSync(join(dir, "unlocated.json")), "INCONSISTENT(input:unlocated)"],
    ["a packet deleted", (dir, { subject }) => rmSync(join(dir, "packets", `${subject}.json`)), "INCONSISTENT(input:packets)"],
    ["the accepted count edited in report.md", (dir) => writeFileSync(join(dir, "report.md"), readFileSync(join(dir, "report.md"), "utf8").replace(/^- accepted at gate \(CITATION_VERIFIED\): 3 <!-- v:summary\.accepted -->$/m, "- accepted at gate (CITATION_VERIFIED): 4 <!-- v:summary.accepted -->")), "INCONSISTENT(summary.accepted)"],
    ["COMMITTED rewritten", (dir) => writeFileSync(join(dir, "COMMITTED"), `${"0".repeat(64)}\n`), "INCONSISTENT(COMMITTED)"],
    ["manifest.json replaced by another run's shape", (dir) => reenvelope(join(dir, "manifest.json"), (p) => (p.tool_version = "0.0.1")), "INCONSISTENT(manifest:tool_version)"],
  ];
  for (const [name, tamper, expected] of cases) {
    const fx = await reviewRepo();
    tamper(fx.dir, fx);
    const r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--integrity", "--drift", "--trusted-digest", committedOf(fx.dir)]);
    assert.equal(r.code, 5, `${name}: ${r.stdout}${r.stderr}`);
    const out = lines(r.stdout);
    assert.equal(out[0], expected, name);
    assert.ok(out.includes("ORIGIN: unauthenticated"), `${name}: an inconsistent set never matches a digest`);
    assert.equal(out.at(-1), "KEY: available", name);
    assert.ok(!out.some((l) => l.startsWith("CURRENT") || l.startsWith("CITATION-DRIFTED") || l.startsWith("SCOPE-DRIFTED")), `${name}: no drift line for an inconsistent set`);
  }
});

test("derivation table, hash-consistent forgeries (US-017 AC-2, one sub-test per row): finding ids / CITATION states / coverage counts / REVIEW states / rejected + unlocated totals / executive counts ⇒ INCONSISTENT(<field>), the recomputed-artifact name before any byte comparison", async () => {
  const rows = [
    {
      row: "finding ids",
      variant: "plain",
      tamper: (dir, fx) => {
        const forged = "e".repeat(64);
        reenvelope(join(dir, "findings.claimed.json"), (p) => (p.findings.find((f) => f.id === fx.app.id).id = forged));
        const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
        reenvelope(join(dir, "gate-result.json"), (p) => {
          p.accepted = p.accepted.map((id) => (id === fx.app.id ? forged : id));
          p.claimed_sha256 = claimed.envelope.self_sha256;
        });
      },
      expected: "INCONSISTENT(gate-result)",
    },
    {
      row: "CITATION states (recomputed gate-result no longer follows)",
      variant: "plain",
      tamper: (dir, fx) => {
        reenvelope(join(dir, "findings.claimed.json"), (p) => {
          const f = p.findings.find((x) => x.id === fx.app.id);
          f.state = CITATION_FAILED;
          f.occurrence = 0;
        });
        const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
        reenvelope(join(dir, "gate-result.json"), (p) => (p.claimed_sha256 = claimed.envelope.self_sha256));
      },
      expected: "INCONSISTENT(gate-result)",
    },
    {
      row: "coverage counts",
      variant: "plain",
      tamper: (dir) => reenvelope(join(dir, "coverage.json"), (p) => (p.accounting.find((e) => e.status === "unexamined").status = "examined")),
      expected: "INCONSISTENT(coverage)",
    },
    {
      row: "REVIEW states (a receipt re-asserted; applyReceipts no longer yields what the report shows)",
      variant: "receipt",
      tamper: (dir, fx) => reenvelopeMember(dir, "receipts", fx.receipt, (p) => (p.assertion = "refuted")),
      expected: /^INCONSISTENT\((summary\.by_priority_state\.p1|findings\[\d+\]\.(state|review|review_receipts))\)$/,
    },
    {
      row: "rejected totals (rejects.json shortened; gate-result's rejected_counts no longer follow)",
      variant: "plain",
      tamper: (dir) => reenvelope(join(dir, "rejects.json"), (p) => p.rejected.pop()),
      expected: "INCONSISTENT(gate-result)",
    },
    {
      // the display-level unlocated row lives in the sarif test below (a candidate must name an import record of the run)
      row: "unlocated totals (a candidate naming an import the run never made: the record is re-checked before the count)",
      variant: "plain",
      tamper: (dir) => reenvelope(join(dir, "unlocated.json"), (p) => p.candidates.push({ reason: "no-location", tool: "x", locator: { import_sha256: "a".repeat(64), index: 0 } })),
      expected: `INCONSISTENT(import:${"a".repeat(64)})`,
    },
    {
      row: "executive counts (the report's total edited, sidecar re-forged over it)",
      variant: "plain",
      tamper: (dir) => writeFileSync(join(dir, "report.md"), readFileSync(join(dir, "report.md"), "utf8").replace(/^- findings gated: 4 <!-- v:summary\.total -->$/m, "- findings gated: 3 <!-- v:summary.total -->")),
      expected: "INCONSISTENT(summary.total)",
    },
  ];
  for (const { row, variant, tamper, expected } of rows) {
    const fx = await reviewRepo(variant);
    tamper(fx.dir, fx);
    const digest = reforge(fx.repo, fx.dir);
    const r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--trusted-digest", digest]);
    assert.equal(r.code, 5, `${row}: ${r.stdout}${r.stderr}`);
    const out = lines(r.stdout);
    if (expected instanceof RegExp) assert.match(out[0], expected, row);
    else assert.equal(out[0], expected, row);
    assert.ok(out.includes("ORIGIN: unauthenticated"), `${row}: a forged sidecar digest never matches`);
  }
});

test("derivation table, snapshots (assessment): a tampered verify verdict ⇒ INCONSISTENT(verify); a tampered register event ⇒ INCONSISTENT(register-events); the untouched assessment ⇒ CONSISTENT with --integrity and can never print CONSISTENT-REDACTED-ONLY (AC-8)", async () => {
  const fx = await assessedRepo();
  const base = fx.repo;
  const clone = () => {
    const repo = tmpDir("sec-check-a-");
    cpSync(base, repo, { recursive: true });
    return { repo, dir: runDir(repo, fx.run_id) };
  };
  const untouched = clone();
  const r0 = await check(untouched.repo, [join(ST, "runs", fx.run_id), "--integrity", "--drift"]);
  assert.equal(r0.code, 0, `${r0.stdout}${r0.stderr}`);
  assert.deepEqual(lines(r0.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  const result = checkRun(ctxFor(untouched.repo), untouched.dir, { integrity: true });
  assert.equal(result.consistency.redacted_only, 0);
  assert.equal(result.template, "assessment");

  const v = clone();
  reenvelope(join(v.dir, "verify-snapshots", fx.vid, "verify.json"), (p) => (p.evaluation.verdict = "UNVERIFIED-TESTS-FAILED"));
  reforge(v.repo, v.dir);
  const rv = await check(v.repo, [join(ST, "runs", fx.run_id)]);
  assert.equal(rv.code, 5, `${rv.stdout}${rv.stderr}`);
  assert.equal(lines(rv.stdout)[0], "INCONSISTENT(verify)");

  const e = clone();
  reenvelope(join(e.dir, "register-events.json"), (p) => (p.events[0].payload.priority = "p3"));
  reforge(e.repo, e.dir);
  const re = await check(e.repo, [join(ST, "runs", fx.run_id)]);
  assert.equal(re.code, 5, `${re.stdout}${re.stderr}`);
  assert.equal(lines(re.stdout)[0], "INCONSISTENT(register-events)");

  // AC-8: an assessment whose scope claims a snapshot is inconsistent, never REDACTED-ONLY
  const s = clone();
  const scope = readArtifact(join(s.dir, "scope.json"), { kind: "scope" });
  reenvelope(join(s.dir, "scope.json"), (p) => (p.snapshot = { "src/db.js": { original_hmac: "a".repeat(64), redacted_sha256: "b".repeat(64), redaction_version: 1 } }));
  const forgedScope = readArtifact(join(s.dir, "scope.json"), { kind: "scope" });
  reenvelope(join(s.dir, "findings.claimed.json"), (p) => (p.scope_sha256 = forgedScope.envelope.self_sha256));
  const claimed = readArtifact(join(s.dir, "findings.claimed.json"), { kind: "claimed" });
  reenvelope(join(s.dir, "gate-result.json"), (p) => {
    p.scope_sha256 = forgedScope.envelope.self_sha256;
    p.claimed_sha256 = claimed.envelope.self_sha256;
  });
  reenvelope(join(s.dir, "coverage.json"), (p) => (p.scope_sha256 = forgedScope.envelope.self_sha256));
  assert.notEqual(scope.envelope.self_sha256, forgedScope.envelope.self_sha256);
  await rebuild(s.repo, fx.run_id, "assessment");
  const rs = await check(s.repo, [join(ST, "runs", fx.run_id), "--integrity"]);
  assert.equal(rs.code, 5, `${rs.stdout}${rs.stderr}`);
  assert.equal(lines(rs.stdout)[0], "INCONSISTENT(snapshot)");
  assert.ok(!rs.stdout.includes("REDACTED-ONLY"));
});

// --- AC-3 / AC-4: origin ---------------------------------------------------------------------

test("consistent full-set forgery ⇒ CONSISTENT and ORIGIN: unauthenticated (AC-3, D2); --trusted-digest matches only the recomputed hash, never the sidecar (AC-4)", async () => {
  const fx = await reviewRepo();
  const original = committedOf(fx.dir);
  // AC-4 first, on the genuine run: the marker's digest matches, any other does not
  let r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--trusted-digest", original]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: matches supplied digest", "KEY: available"]);
  r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--trusted-digest", "1".repeat(64)]);
  assert.equal(r.code, 0);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);
  // a sidecar forged to a different identity (marker agrees with it): its digest never matches — the recomputed hash is what ORIGIN compares
  const forged = await reviewRepo();
  const sidecar = reenvelope(join(forged.dir, "manifest.json"), (p) => (p.report_sha256 = "2".repeat(64))).envelope.self_sha256;
  writeFileSync(join(forged.dir, "COMMITTED"), `${sidecar}\n`);
  r = await check(forged.repo, [join(ST, "runs", forged.run_id), "--trusted-digest", sidecar]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["INCONSISTENT(manifest.json)", "ORIGIN: unauthenticated", "KEY: available"]);
  // AC-3: a prose field edited and the whole set re-derived is consistent — and unauthenticated
  const full = await reviewRepo();
  reenvelope(join(full.dir, "findings.claimed.json"), (p) => (p.findings.find((f) => f.id === full.injection.id).description = "forged prose"));
  const claimed = readArtifact(join(full.dir, "findings.claimed.json"), { kind: "claimed" });
  reenvelope(join(full.dir, "gate-result.json"), (p) => (p.claimed_sha256 = claimed.envelope.self_sha256));
  await rebuild(full.repo, full.run_id, "review");
  assert.notEqual(committedOf(full.dir), original, "the forgery has a new identity");
  r = await check(full.repo, [join(ST, "runs", full.run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  assert.ok(readFileSync(join(full.dir, "report.md"), "utf8").includes("forged prose"));
  // and the consumer's digest of the genuine run tells the two apart
  r = await check(full.repo, [join(ST, "runs", full.run_id), "--trusted-digest", original]);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);
});

// --- AC-5: drift ---------------------------------------------------------------------------------

test("drift: an edited cited head line ⇒ CITATION-DRIFTED(1); an edited uncited in-scope file ⇒ SCOPE-DRIFTED(1 files); a deleted cited file counts once; drift never changes the exit code (AC-5)", async () => {
  const a = await reviewRepo();
  writeFileSync(join(a.repo, "src", "db.js"), DB_JS.replace('const q = "SELECT * FROM users WHERE id = " + req.query.id;', 'const q = "SELECT * FROM users WHERE id = $1";'));
  let r = await check(a.repo, [join(ST, "runs", a.run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CITATION-DRIFTED(1)", "ORIGIN: unauthenticated", "KEY: available"]);
  const result = checkRun(ctxFor(a.repo), a.dir, { drift: true });
  assert.deepEqual([result.drift.citations_drifted, result.drift.scope_drifted], [1, 1], "the cited file is also a drifted scope file; the citation token wins the line");

  const b = await reviewRepo();
  writeFileSync(join(b.repo, "src", "dup.js"), DUP_JS.replace("a();\nb();\na();", "a();\nb();\nc();"));
  r = await check(b.repo, [join(ST, "runs", b.run_id), "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "SCOPE-DRIFTED(1 files)", "ORIGIN: unauthenticated", "KEY: available"]);

  const c = await reviewRepo();
  rmSync(join(c.repo, "src", "dup.js"));
  r = await check(c.repo, [join(ST, "runs", c.run_id), "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CITATION-DRIFTED(1)", "ORIGIN: unauthenticated", "KEY: available"], "the failed finding's citation of dup.js has no working counterpart");
});

test("historical report after a fix: the fix committed on top ⇒ CONSISTENT (git objects at head_oid still resolve) + CITATION-DRIFTED; base citations are skipped by drift and pass integrity (§12)", async () => {
  const fx = await reviewRepo();
  writeFileSync(join(fx.repo, "src", "db.js"), DB_JS.replace("return pool.query(q);", "return pool.query(q, []);"));
  git(fx.repo, ["add", "-A"]);
  git(fx.repo, ["commit", "-q", "-m", "fix"]);
  let r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CITATION-DRIFTED(2)", "ORIGIN: unauthenticated", "KEY: available"], "the primary [3,4] and the typed sink [4,4] both moved");

  // a review run whose base is the pre-fix commit: a base citation of the removed line
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "vulnerable"]);
  writeFileSync(join(repo, "src", "db.js"), DB_JS.replace("return pool.query(q);", "return pool.query(q, []);"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixed"]);
  const run_id = await initRun(repo, "review", ["--base", "HEAD~1"]);
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const packet = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "packet").stdout).sha256;
  const claims = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet, findings: [claim({ title: "deleted code", class: "injection", priority: "p1", path: "src/db.js", side: "base", lines: [4, 4], snippet: "return pool.query(q);" })] });
  const g = ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claims]), "gate");
  assert.match(g.stdout, /^GATE accepted=1 /);
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: packet, declared: [] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
  r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"], "the working tree equals head; the base citation has no current counterpart and is skipped");
  const result = checkRun(ctxFor(repo), dir, { integrity: true, drift: true });
  assert.equal(result.consistency.checked.citations, 1);
  assert.equal(result.drift.citations_skipped, 1, "base citations are counted as skipped, not drifted");
});

// --- AC-6: the snapshot four-step (spec §12) ---------------------------------------------------

test("review run with a snapshot citation of password=1234: CONSISTENT before the working file changes, CONSISTENT-REDACTED-ONLY(1 citations) after, INCONSISTENT(snapshot:<path>) when the redacted snapshot is altered — never the snapshot's actual hash on stdout (AC-6; §12 steps 1–3)", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=1234 };\n");
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  assert.equal(scope.payload.files.find((f) => f.path === "src/app.js").side, "snapshot", "the dirty file is snapshotted");
  const packet = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "packet").stdout).sha256;
  // two snapshot citations: the reviewer says it read redacted bytes (snippet_redacted ⇒ keyed identity + private record over the REDACTED snapshot's range), and a plain one on the clean line
  const keyed = claim({ title: "credential in config", class: "config", priority: "p0", side: "snapshot", lines: [2, 2], snippet: undefined, snippet_redacted: "const cfg = { <REDACTED:password-assign> };" });
  delete keyed.snippet;
  const plain = claim({ title: "app export", class: "config", side: "snapshot", lines: [1, 1], snippet: "export const a = 1;" });
  const claims = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet, findings: [keyed, plain] });
  const g = ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claims]), "gate");
  assert.match(g.stdout, /^GATE accepted=2 unverifiable=0 /);
  const gated = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" }).payload.findings;
  const keyedId = gated.find((f) => f.title === keyed.title).id;
  assert.equal(gated.find((f) => f.id === keyedId).sensitive, true);
  const record = readArtifact(join(repo, ST, "private", "citations", run_id, `${keyedId}.json`), { kind: "citation-record" });
  assert.equal(record.payload.side, "snapshot");
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: packet, declared: [{ path: "src/app.js", ranges: [[1, 2]] }] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
  const snap = join(repo, ST, "private", "snapshots", run_id, "src", "app.js");
  assert.ok(!readFileSync(snap, "utf8").includes("password=1234"), "the snapshot is redacted");

  // step 1: the original is still on disk
  let r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  // without --integrity the snapshot is never opened: CONSISTENT is the structural verdict
  r = await check(repo, [join(ST, "runs", run_id)]);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);

  // step 2: the working file changes — the original is gone; only the redacted snapshot can be re-validated (both citations of the file)
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=5678 };\n");
  r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  // drift: the change lies inside the redacted span, so the cited (redacted) text is unchanged and the file — not the citation — is what drifted
  assert.deepEqual(lines(r.stdout), ["CONSISTENT-REDACTED-ONLY(2 citations)", "SCOPE-DRIFTED(1 files)", "ORIGIN: unauthenticated", "KEY: available"]);
  const result = checkRun(ctxFor(repo), dir, { integrity: true });
  assert.equal(result.consistency.redacted_only, 2);
  assert.equal(result.code, 0);
  // a visible edit next to the secret drifts the citation too
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=5678 }; // rotated\n");
  r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT-REDACTED-ONLY(2 citations)", "CITATION-DRIFTED(1)", "ORIGIN: unauthenticated", "KEY: available"]);
  // the working file restored ⇒ CONSISTENT again (the original HMAC re-derives)
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=1234 };\n");
  r = await check(repo, [join(ST, "runs", run_id), "--integrity"]);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);

  // step 3: the redacted snapshot altered ⇒ INCONSISTENT(snapshot:<path>), and the resolver's message (with the actual sha) never reaches stdout
  writeFileSync(snap, "export const a = 1;\n// edited\n");
  r = await check(repo, [join(ST, "runs", run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["INCONSISTENT(snapshot:src/app.js)", "ORIGIN: unauthenticated", "KEY: available"]);
  assert.ok(!r.stdout.includes(sha256Hex(readFileSync(snap))), "err.actual never printed");
  assert.ok(!r.stdout.includes("expected sha256"), "err.message never printed");
  // the snapshot gone ⇒ the redacted bytes cannot be re-validated either
  rmSync(snap);
  r = await check(repo, [join(ST, "runs", run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], "INCONSISTENT(snapshot:src/app.js)");
});

// --- AC-7: the key ---------------------------------------------------------------------------------

test("key file absent ⇒ KEY: unavailable and STRUCTURE-ONLY, never CONSISTENT, with and without --integrity; exit 0; the structure is still checked (a tampered input is still INCONSISTENT) (AC-7; US-005 AC-4)", async () => {
  const fx = await reviewRepo();
  rmSync(keyFile(fx.repo, fx.dir));
  let r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["STRUCTURE-ONLY", "CURRENT", "ORIGIN: unauthenticated", "KEY: unavailable"]);
  r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--integrity", "--trusted-digest", committedOf(fx.dir)]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["STRUCTURE-ONLY", "ORIGIN: matches supplied digest", "KEY: unavailable"]);
  assert.ok(!r.stdout.includes("CONSISTENT\n"));
  const result = checkRun(ctxFor(fx.repo), fx.dir, { integrity: true, drift: true });
  assert.equal(result.consistency.token, "STRUCTURE-ONLY");
  assert.equal(result.key.available, false);
  assert.equal(result.consistency.checked.citations, 0, "no content re-validation without the key");
  // the structural checks still run
  reenvelope(join(fx.dir, "coverage.json"), (p) => (p.accounting.find((e) => e.status === "unexamined").status = "examined"));
  reforge(fx.repo, fx.dir);
  r = await check(fx.repo, [join(ST, "runs", fx.run_id)]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["INCONSISTENT(coverage)", "ORIGIN: unauthenticated", "KEY: unavailable"]);
  // a report built while the key was already missing is checked the same way
  const late = await reviewRepo();
  rmSync(keyFile(late.repo, late.dir));
  await rebuild(late.repo, late.run_id, "review");
  assert.match(readFileSync(join(late.dir, "report.md"), "utf8"), /^- key: unavailable <!-- v:key -->$/m);
  r = await check(late.repo, [join(ST, "runs", late.run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["STRUCTURE-ONLY", "CURRENT", "ORIGIN: unauthenticated", "KEY: unavailable"]);
});

// --- --integrity: citations, packets, receipts ----------------------------------------------------

test("--integrity re-validates every citation against its recorded side: a full-set forgery that flips a CITATION state is CONSISTENT without --integrity and INCONSISTENT(citation:<id>) with it; a sensitive finding's private record is compared (source_hmac re-derived, claimed_hmac as recorded); a packet's range_hmac is recomputed", async () => {
  // a plain finding's state flipped to CITATION_FAILED, the set re-derived
  const a = await reviewRepo();
  reenvelope(join(a.dir, "findings.claimed.json"), (p) => {
    const f = p.findings.find((x) => x.id === a.app.id);
    f.state = CITATION_FAILED;
    f.occurrence = 0;
  });
  let claimed = readArtifact(join(a.dir, "findings.claimed.json"), { kind: "claimed" });
  reenvelope(join(a.dir, "gate-result.json"), (p) => {
    p.accepted = p.accepted.filter((id) => id !== a.app.id);
    p.unverifiable = [...p.unverifiable, a.app.id].sort();
    p.claimed_sha256 = claimed.envelope.self_sha256;
  });
  await rebuild(a.repo, a.run_id, "review");
  let r = await check(a.repo, [join(ST, "runs", a.run_id)]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], "CONSISTENT", "a re-derived set is consistent by construction (D2)");
  r = await check(a.repo, [join(ST, "runs", a.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(citation:${a.app.id})`);

  // the failed finding promoted to CITATION_VERIFIED: the bytes at head say otherwise
  const b = await reviewRepo();
  reenvelope(join(b.dir, "findings.claimed.json"), (p) => {
    const f = p.findings.find((x) => x.id === b.failed.id);
    f.state = CITATION_VERIFIED;
  });
  claimed = readArtifact(join(b.dir, "findings.claimed.json"), { kind: "claimed" });
  reenvelope(join(b.dir, "gate-result.json"), (p) => {
    p.unverifiable = p.unverifiable.filter((id) => id !== b.failed.id);
    p.accepted = [...p.accepted, b.failed.id].sort();
    p.claimed_sha256 = claimed.envelope.self_sha256;
  });
  await rebuild(b.repo, b.run_id, "review");
  r = await check(b.repo, [join(ST, "runs", b.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(citation:${b.failed.id})`);

  // the sensitive finding's private record: tampered source_hmac ⇒ INCONSISTENT(citation:<id>); the record gone ⇒ INCONSISTENT(citations/<id>)
  const c = await reviewRepo();
  const recordPath = join(c.repo, ST, "private", "citations", c.run_id, `${c.sensitive.id}.json`);
  const record = readArtifact(recordPath, { kind: "citation-record" });
  assert.equal(record.payload.side, "head");
  assert.equal(record.payload.match, true);
  reenvelope(recordPath, (p) => (p.source_hmac = "c".repeat(64)));
  r = await check(c.repo, [join(ST, "runs", c.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(citation:${c.sensitive.id})`);
  rmSync(recordPath);
  r = await check(c.repo, [join(ST, "runs", c.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(citations/${c.sensitive.id})`);
  assert.ok(!r.stdout.includes("password"), "nothing protected reaches stdout");

  // a packet whose range_hmac no longer binds the bytes at its side (re-filed under its new identity, the set re-derived)
  const d = await reviewRepo();
  const newSubject = reenvelopeMember(d.dir, "packets", d.subject, (p) => (p.files[0].range_hmac = "d".repeat(64)));
  await rebuild(d.repo, d.run_id, "review");
  r = await check(d.repo, [join(ST, "runs", d.run_id)]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  r = await check(d.repo, [join(ST, "runs", d.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.match(lines(r.stdout)[0], new RegExp(`^INCONSISTENT\\(packets/${newSubject}:src/(app|db)\\.js\\)$`));
});

test("--integrity re-checks receipt binding with verify all's rule: a review run's receipt naming another run ⇒ INCONSISTENT(receipts/<sha>); a verify run's receipt from a pass-1 run of the same head is accepted (TL-6, PM log after G13)", async () => {
  const fx = await reviewRepo("receipt");
  const other = `${fx.run_id.slice(0, 12)}-0009`;
  const sha = reenvelopeMember(fx.dir, "receipts", fx.receipt, (p) => (p.reviewer_run_id = other));
  await rebuild(fx.repo, fx.run_id, "review");
  let r = await check(fx.repo, [join(ST, "runs", fx.run_id)]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  r = await check(fx.repo, [join(ST, "runs", fx.run_id), "--integrity"]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(receipts/${sha})`);

  // a verify run: TASK-026's fixture planted under a real run, receipts naming the pass-1 run (same head prefix) — accepted; a foreign head ⇒ refused
  const { repo, run_id, dir } = await verifyRepo("verified-two-acks");
  r = await check(repo, [join(ST, "runs", run_id)]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "ORIGIN: unauthenticated", "KEY: available"]);
  const receipts = fs.readdirSync(join(dir, "receipts")).map((n) => readArtifact(join(dir, "receipts", n), { kind: "receipt" }));
  assert.ok(receipts.every((x) => x.payload.reviewer_run_id === run_id), "the planted receipts name the run itself");
  const result = checkRun(ctxFor(repo), dir, { integrity: true });
  assert.equal(result.consistency.status, "inconsistent", "the fixture's synthetic oid is not the blob at this run's head: the packet does not bind the bytes");
  assert.match(result.consistency.token, /^INCONSISTENT\(packets\/[0-9a-f]{64}:src\/db\.js\)$/);
  assert.equal(result.consistency.checked.receipts, receipts.length, "receipt binding is checked before the packet bytes");
});

test("--integrity re-checks that every import record a coverage scanner row or an unlocated candidate names is present in the run (PM log after G12); a deleted ingest/<sha>.json ⇒ INCONSISTENT(import:<sha>)", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  mkdirSync(join(repo, ST, "imports"), { recursive: true });
  copyFileSync(fixture("located.sarif"), join(repo, ST, "imports", "located.sarif"));
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const packet = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "packet").stdout).sha256;
  const ing = ok(await evidence(repo, ["ingest", "sarif", join(ST, "imports", "located.sarif"), "--run", run_id]), "ingest");
  const import_sha256 = /import_sha256=([0-9a-f]{64})/.exec(ing.stdout)[1];
  ok(await evidence(repo, ["gate", "--run", run_id]), "gate");
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: packet, declared: [{ path: "src/db.js", ranges: [[3, 4]] }] });
  const rows = drop(repo, run_id, "scanner-rows.json", { rows: [{ import_sha256 }] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined, "--scanner-rows", rows]), "coverage");
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
  let r = await check(repo, [join(ST, "runs", run_id), "--integrity", "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"]);
  // the display-level "unlocated totals" row (spec §6.3): a candidate naming this import added hash-consistently, the sidecar re-forged ⇒ the report's count is stale
  const forged = tmpDir("sec-check-u-");
  cpSync(repo, forged, { recursive: true });
  reenvelope(join(runDir(forged, run_id), "unlocated.json"), (p) => p.candidates.push({ reason: "no-location", tool: "Semgrep OSS", locator: { import_sha256, index: 7 } }));
  const digest = reforge(forged, runDir(forged, run_id));
  r = await check(forged, [join(ST, "runs", run_id), "--trusted-digest", digest]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["INCONSISTENT(summary.unlocated)", "ORIGIN: unauthenticated", "KEY: available"]);
  // the record gone ⇒ named before any derivation
  rmSync(join(dir, "ingest", `${import_sha256}.json`));
  r = await check(repo, [join(ST, "runs", run_id)]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], `INCONSISTENT(import:${import_sha256})`);
});

test("TL-7 field naming ignores look-alike markers inside indented evidence blocks: a code line carrying `<!-- v:summary.total -->` names report.md, not the field", async () => {
  const fx = await reviewRepo();
  const text = readFileSync(join(fx.dir, "report.md"), "utf8");
  const codeLine = text.split("\n").find((l) => l.startsWith("    ") && l.includes("pool.query"));
  assert.ok(codeLine, "an indented evidence line");
  writeFileSync(join(fx.dir, "report.md"), text.replace(codeLine, `${codeLine} <!-- v:summary.total -->`));
  const r = await check(fx.repo, [join(ST, "runs", fx.run_id)]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], "INCONSISTENT(report.md)");
});

// --- G-16: the read set ----------------------------------------------------------------------------

/** Patch the fs builtin so every read records its path; returns {records, restore}. */
function spyReads() {
  const records = [];
  const originals = {};
  const record = (op, p) => {
    if (typeof p === "string" || Buffer.isBuffer(p) || p instanceof URL) records.push({ op, path: p instanceof URL ? fileURLToPath(p) : String(p) });
  };
  const wrap = (name) => {
    originals[name] = fs[name];
    fs[name] = function (...args) {
      record(name, args[0]);
      return originals[name].apply(this, args);
    };
    if (typeof originals[name].native === "function") {
      fs[name].native = function (...args) {
        record(`${name}.native`, args[0]);
        return originals[name].native.apply(this, args);
      };
    }
  };
  for (const name of ["readFileSync", "readdirSync", "openSync", "statSync", "lstatSync", "existsSync", "realpathSync"]) wrap(name);
  syncBuiltinESMExports();
  return {
    records,
    restore() {
      for (const [name, fn] of Object.entries(originals)) fs[name] = fn;
      syncBuiltinESMExports();
    },
  };
}

test("check reads nothing outside the run dir except git objects, the working tree and the key (G-16, fs spy): the ledger index, the live register, other runs and the drop-box are never opened", async () => {
  const fx = await reviewRepo("receipt");
  // decoys: a newer run, a live register, an index, a drop-box file
  const decoyRun = join(fx.repo, ST, "runs", `${fx.run_id.slice(0, 12)}-0099`);
  mkdirSync(decoyRun, { recursive: true });
  writeFileSync(join(decoyRun, "run.json"), "{}");
  mkdirSync(join(fx.repo, ST, "register"), { recursive: true });
  writeFileSync(join(fx.repo, ST, "register", "events.jsonl"), "");
  const spy = spyReads();
  let result;
  let fail = null;
  try {
    result = checkRun(ctxFor(fx.repo), fx.dir, { integrity: true, drift: true, trustedDigest: committedOf(fx.dir) });
  } catch (err) {
    fail = err;
  } finally {
    spy.restore();
  }
  if (fail) throw fail;
  assert.equal(result.consistency.token, "CONSISTENT");
  assert.equal(result.origin.token, "ORIGIN: matches supplied digest");
  const st = join(fx.repo, ST);
  const allowed = [
    fx.dir, // the run directory
    join(st, "ledger", fx.run_id), // TL-3's second root (redacted import bytes)
    join(st, "private", "keys"), // the key
    join(st, "private", "citations", fx.run_id), // the run's private citation records (--integrity)
    join(st, "private", "snapshots", fx.run_id), // the run's redacted snapshots (--integrity)
    join(fx.repo, "src"), // the working tree (--drift / snapshot originals)
    SKILL, // the shipped templates, version.json, rule files
  ];
  const under = (p, root) => {
    const rel = relative(root, p);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  const reads = spy.records.map((r) => ({ ...r, path: isAbsolute(r.path) ? r.path : resolve(fx.repo, r.path) }));
  assert.ok(reads.length > 10, `the spy saw check's reads (${reads.length})`);
  const offenders = reads.filter((r) => !allowed.some((root) => under(r.path, root)) && r.path !== fx.repo && r.path !== st && r.path !== join(st, "runs") && r.path !== join(st, "private") && r.path !== dirname(fx.repo));
  assert.deepEqual(
    offenders.map((r) => `${r.op} ${relative(fx.repo, r.path)}`),
    [],
    "every read lies under the run dir, its ledger dir, private/keys, its private records, the working tree or the skill",
  );
  for (const forbidden of [join(st, "ledger", "index.json"), join(st, "register"), decoyRun, join(st, "receipts"), join(st, "engagement.md")]) {
    assert.ok(!reads.some((r) => under(r.path, forbidden)), `never reads ${relative(fx.repo, forbidden)}`);
  }
});

// --- fixtures: assessment and verify runs ------------------------------------------------------------

/** The run's own envelope head for an artifact the test plants. */
function headFor(repo, run_id, kind) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id, now: NOW };
}

/** TASK-026's `verify/<rule>.json` planted as a fake COMMITTED verify run, returning its run id. */
function plantVerifyRun(repo, rule) {
  const src = join(VERIFY_FIXTURES, `${rule}.json`);
  const verify = readArtifact(src, { kind: "verify" });
  const vid = verify.envelope.run_id;
  const dir = runDir(repo, vid);
  mkdirSync(join(dir, "packets"), { recursive: true });
  mkdirSync(join(dir, "receipts"), { recursive: true });
  copyFileSync(src, join(dir, "verify.json"));
  const packets = new Set([verify.payload.packet_sha256]);
  for (const { sha256 } of verify.payload.receipts) {
    copyFileSync(join(VERIFY_FIXTURES, "receipts", `${sha256}.json`), join(dir, "receipts", `${sha256}.json`));
    packets.add(readArtifact(join(VERIFY_FIXTURES, "receipts", `${sha256}.json`), { kind: "receipt" }).payload.packet_sha256);
  }
  for (const sha of packets) copyFileSync(join(VERIFY_FIXTURES, "packets", `${sha}.json`), join(dir, "packets", `${sha}.json`));
  writeFileSync(join(dir, "COMMITTED"), `${sha256Hex(Buffer.from("fake manifest bytes", "utf8"))}\n`);
  return { vid, verify };
}

/** An assessment run carrying every §6.3 assessment input (the cmd-build-report.test.mjs recipe), built. */
async function assessedRepo() {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const run_id = await initRun(repo, "assessment");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const scopePacket = parsePacketLine(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet").stdout).sha256;
  const claims = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: Object.values(CLAIMS) });
  ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claims]), "gate");
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: scopePacket, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  const { injection } = findings(dir);
  writeArtifact(join(dir, "threat-model.json"), makeEnvelope(headFor(repo, run_id, "threat-model"), { elements: [], threats: [] }), { exclusive: true });
  // the index tm-lint check derives beside the empty model (TASK-048: a required assessment input)
  writeArtifact(join(dir, "dispositions.json"), makeEnvelope(headFor(repo, run_id, "dispositions"), { dispositions: [] }), { exclusive: true });
  ok(await register(repo, ["add", "--subject", injection.id, "--priority", "p1", "--title", "sql built from request input", "--run", run_id]), "register add");
  ok(await evidence(repo, ["run", "snapshot", "register", "--run", run_id]), "snapshot register");
  const { vid } = plantVerifyRun(repo, "verified-two-acks");
  ok(await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", vid]), "snapshot verify");
  mkdirSync(join(repo, ST, "proposals"), { recursive: true });
  writeFileSync(join(repo, ST, "proposals", "active-sqli-probe.proposal.md"), "---\nid: active-sqli-probe\n---\n# probe\n");
  ok(await evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]), "snapshot proposals");
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "assessment"]), "build-report");
  return { repo, run_id, dir, vid };
}

/**
 * A verify-kind run allocated by `run init`, carrying a TASK-026 fixture
 * re-enveloped under the run's own identity (payloads unchanged, so every
 * self_sha256 stays what verify.json names), then built.
 */
async function verifyRepo(rule) {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  const run_id = await initRun(repo, "verify");
  const dir = runDir(repo, run_id);
  const head = (kind) => headFor(repo, run_id, kind);
  const verify = readArtifact(join(VERIFY_FIXTURES, `${rule}.json`), { kind: "verify" });
  const packet = readArtifact(join(VERIFY_FIXTURES, "packets", `${verify.payload.packet_sha256}.json`), { kind: "packet" });
  writeArtifact(join(dir, "packets", `${packet.envelope.self_sha256}.json`), makeEnvelope(head("packet"), packet.payload), { exclusive: true });
  // reviewer_run_id is part of a receipt's payload: the fixture's receipts are
  // re-issued under this run's id, re-filed under their new identities, and
  // verify.json's rows + ack_refs follow (order kept: evaluate() lists acks in row order)
  const renamed = {};
  for (const row of verify.payload.receipts) {
    const receipt = readArtifact(join(VERIFY_FIXTURES, "receipts", `${row.sha256}.json`), { kind: "receipt" });
    const art = makeEnvelope(head("receipt"), { ...receipt.payload, reviewer_run_id: run_id });
    writeArtifact(join(dir, "receipts", `${art.envelope.self_sha256}.json`), art, { exclusive: true });
    renamed[row.sha256] = art.envelope.self_sha256;
    row.sha256 = art.envelope.self_sha256;
  }
  verify.payload.evaluation.ack_refs = verify.payload.evaluation.ack_refs.map((s) => renamed[s] ?? s);
  writeArtifact(join(dir, "verify.json"), makeEnvelope(head("verify"), verify.payload), { exclusive: true });
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "verify"]), "build-report verify");
  return { repo, run_id, dir };
}

test("verify template: a verify run's check without --integrity ⇒ CONSISTENT; a tampered evaluation (hash-consistent, re-forged) ⇒ INCONSISTENT(verify)", async () => {
  const { repo, run_id, dir } = await verifyRepo("verified-no-indicators");
  let r = await check(repo, [join(ST, "runs", run_id), "--drift"]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ["CONSISTENT", "CURRENT", "ORIGIN: unauthenticated", "KEY: available"], "a verify run has no scope: drift is CURRENT over zero files and citations");
  reenvelope(join(dir, "verify.json"), (p) => (p.evaluation.verdict = "UNVERIFIED-TESTS-FAILED"));
  reforge(repo, dir);
  r = await check(repo, [join(ST, "runs", run_id)]);
  assert.equal(r.code, 5, `${r.stdout}${r.stderr}`);
  assert.equal(lines(r.stdout)[0], "INCONSISTENT(verify)");
  assert.ok(existsSync(join(dir, "COMMITTED")));
});
