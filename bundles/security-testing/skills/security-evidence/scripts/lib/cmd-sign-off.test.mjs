// TASK-033 — `evidence.mjs sign-off --engagement <id> [--expect <anchor>]`
// (plan §4.1 row `sign-off`, §5 TASK-033; spec §7 closed table, §2 last row,
// §6.10, §12; US-025 AC-1…AC-5, US-006 AC-2…AC-4, US-014 AC-3).
//
// Every repo is built in a temp dir by the CLI harness and every run by the
// real commands (run init → scope → packet → gate → coverage → threat-model
// → run snapshot register → build-report), so sign-off checks the bundle's
// own artifacts. The COMMITTED-assessment fixture is built once and copied
// per test (the key lives inside the repo, so a copy checks identically).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, runScript, tmpDir } from "../fixtures/cli/harness.mjs";
import { ENV, ST, ctxFor, engagementMd, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { DB_JS } from "../fixtures/sarif/index.mjs";
import { defaultRecord } from "./engagement.mjs";
import { FAIL_CAUSES, LISTING_HEADERS, signOff } from "./cmd-sign-off.mjs";
import * as tokens from "./tokens.mjs";

after(cleanupAll);

const EID = defaultRecord().engagement_id;
const NOW = () => ENV.SECURITY_EVIDENCE_NOW;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;

const evidence = (repo, args) => runScript("evidence", args, { cwd: repo, env: ENV });
const register = (repo, args) => runScript("register", args, { cwd: repo, env: ENV });
const signOffCli = (repo, args = []) => evidence(repo, ["sign-off", "--engagement", EID, ...args]);
const lines = (s) => s.split("\n").filter((l) => l !== "");
const ok = (r, what) => {
  assert.equal(r.code, 0, `${what}: ${r.stdout}${r.stderr}`);
  return r;
};

const claim = (over = {}) => ({ title: "app export", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });

function drop(repo, run_id, name, value) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2));
  return join(ST, "receipts", run_id, name);
}

function packetSha(stdout) {
  const m = PACKET_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `PACKET line: ${JSON.stringify(stdout)}`);
  return m[2];
}

/** The run's own envelope head for an artifact the test plants. */
function headFor(repo, run_id, kind) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id, now: NOW };
}

const EMPTY_MODEL = Object.freeze({ elements: [], threats: [] });

/**
 * One run of `kind` through the real pipeline up to COMMITTED: scope,
 * scope packet, gate over `claims`, coverage over `declared`, and — for an
 * assessment — the threat model (planted as the snapshot, or linted by the
 * real `tm-lint check` when `lint` is set, which also writes the
 * dispositions index), an optionally planted `dispositions.json` (`index`:
 * the rows, Dispositions shape) and the register snapshot.
 */
async function committedRun(repo, kind, { claims = [claim()], declared = [{ path: "src/app.js", ranges: [[1, 1]] }], model = EMPTY_MODEL, index = null, lint = false } = {}) {
  const run_id = await initRun(repo, kind);
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const packet = packetSha(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet").stdout);
  const claimsFile = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet, findings: claims });
  ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claimsFile]), "gate");
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: packet, declared });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  if (kind === "assessment") {
    if (lint) {
      const modelFile = drop(repo, run_id, "model.json", model);
      ok(await runScript("tm-lint", ["check", "--run", run_id, "--model", modelFile], { cwd: repo, env: ENV }), "tm-lint check");
    } else {
      writeArtifact(join(dir, "threat-model.json"), makeEnvelope(headFor(repo, run_id, "threat-model"), model), { exclusive: true });
    }
    if (index !== null) writeArtifact(join(dir, "dispositions.json"), makeEnvelope(headFor(repo, run_id, "dispositions"), { dispositions: index }), { exclusive: true });
    ok(await evidence(repo, ["run", "snapshot", "register", "--run", run_id]), "snapshot register");
  }
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", kind]), `build-report ${kind}`);
  return { run_id, dir, claimsFile };
}

/** A repo with src/db.js + package.json committed, a baseline, and one COMMITTED assessment run (seq 1). */
async function buildSigned() {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "package.json"), '{"name":"fixture"}\n');
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + package"]);
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const run = await committedRun(repo, "assessment");
  return { repo, ...run };
}

let cached = null;
/** A fresh copy of the COMMITTED-assessment fixture. */
async function signedRepo() {
  cached ??= await buildSigned();
  const repo = tmpDir("sec-signoff-");
  cpSync(cached.repo, repo, { recursive: true });
  return { repo, run_id: cached.run_id, dir: runDir(repo, cached.run_id), claimsFile: cached.claimsFile };
}

const runsEntry = (stdout, run_id) => lines(stdout).find((l) => l.startsWith(`  ${run_id} `));
const failLines = (stdout) => lines(stdout).filter((l) => l.startsWith("SIGN-OFF: FAIL("));

// --- AC-1: the ledger is the inventory -------------------------------------------------------

test("only ledger-listed runs are considered; an uncommitted run is listed as incomplete; a COMMITTED run directory the ledger does not list is invisible (US-025 AC-1)", async () => {
  const { repo, run_id, dir } = await signedRepo();
  const pending = await initRun(repo, "assessment"); // seq 2, never built
  // a COMMITTED-looking run directory outside the ledger: copied under another id
  const ghost = `${run_id.slice(0, 12)}-0099`;
  cpSync(dir, runDir(repo, ghost), { recursive: true });

  const r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out[0], "SIGN-OFF: OK");
  assert.equal(out[1], "RUNS: 1");
  assert.equal(out[2], `  ${run_id} seq=1 kind=assessment CONSISTENT CURRENT`);
  assert.equal(out[3], "INCOMPLETE: 1");
  assert.equal(out[4], `  ${pending} seq=2 kind=assessment`);
  assert.ok(!r.stdout.includes(ghost), "a run the ledger does not list is never considered");
  // the listing headers, in the plan §4.1 order, each exactly once
  const headers = out.filter((l) => !l.startsWith(" ") && !l.startsWith("SIGN-OFF:")).map((l) => `${l.split(" ")[0]}`);
  assert.deepEqual(headers, LISTING_HEADERS);

  // the programmatic entry: the same result, structured
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.equal(result.code, 0);
  assert.deepEqual(result.causes, []);
  assert.equal(result.latest, run_id);
  assert.deepEqual(result.incomplete.map((e) => e.run_id), [pending]);
  assert.deepEqual(result.runs.map((e) => e.run_id), [run_id]);
});

// --- AC-2: no assessment ----------------------------------------------------------------------

test("only review runs ⇒ exit 4 NO-ASSESSMENT, the review run still listed with its check result, and no UNGATED banner (US-025 AC-2; spec §12 path b)", async () => {
  const repo = readyRepo();
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const { run_id } = await committedRun(repo, "review");
  const r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out[0], "SIGN-OFF: FAIL(NO-ASSESSMENT)");
  assert.equal(out[1], "RUNS: 1");
  assert.equal(out[2], `  ${run_id} seq=1 kind=review CONSISTENT`, "no drift line: drift is the latest assessment's");
  assert.ok(!r.stdout.includes("UNGATED") && !r.stderr.includes("UNGATED"));
  assert.ok(out.includes("INCOMPLETE: 0"));
  assert.ok(out.includes("DISPOSITIONS: not evaluated"), "no assessment ⇒ no threat model to evaluate");
});

test("an empty ledger ⇒ exit 4 NO-ASSESSMENT with empty listings", async () => {
  const repo = readyRepo();
  const r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(NO-ASSESSMENT)"]);
  assert.ok(lines(r.stdout).includes("RUNS: 0"));
  assert.ok(lines(r.stdout).includes("CHANGES-SINCE-BASELINE: not observed"), "no baseline yet");
});

// --- AC-3: each failing condition names its cause ------------------------------------------------

const CASES = [
  {
    name: "INCONSISTENT run (the COMMITTED marker rewritten)",
    mutate: ({ dir }) => writeFileSync(join(dir, "COMMITTED"), `${"0".repeat(64)}\n`),
    expect: ({ run_id }) => [`SIGN-OFF: FAIL(INCONSISTENT(COMMITTED)) run=${run_id}`],
  },
  {
    name: "STRUCTURE-ONLY run (the key file gone)",
    mutate: ({ repo, dir }) => rmSync(join(repo, ST, "private", "keys", readArtifact(join(dir, "run.json"), { kind: "run" }).envelope.key_id)),
    expect: ({ run_id }) => [`SIGN-OFF: FAIL(STRUCTURE-ONLY) run=${run_id}`],
    also: (stdout) => assert.ok(lines(stdout).includes("CHANGES-SINCE-BASELINE: not observed"), "without the key no change can be observed"),
  },
  {
    name: "latest assessment not CURRENT at scope level (an in-scope file edited)",
    mutate: ({ repo }) => writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n"),
    expect: ({ run_id }) => [`SIGN-OFF: FAIL(SCOPE-DRIFTED(1 files)) run=${run_id}`],
    also: (stdout, { run_id }) => assert.equal(runsEntry(stdout, run_id), `  ${run_id} seq=1 kind=assessment CONSISTENT CITATION-DRIFTED(1)`, "the RUNS entry carries check's own drift line"),
  },
  {
    name: "CORRUPT register (a line that is not an event)",
    mutate: ({ repo }) => {
      mkdirSync(join(repo, ST, "register"), { recursive: true });
      appendFileSync(join(repo, ST, "register", "events.jsonl"), "not an event\n");
    },
    expect: () => ["SIGN-OFF: FAIL(CORRUPT)"],
    also: (stdout) => assert.ok(lines(stdout).includes("UNAUTHENTICATED-APPROVALS: not observed"), "a corrupt register has no projection to count"),
  },
  {
    name: "anchor mismatch: DIVERGED",
    args: ["--expect", `${EID}:0:${"f".repeat(64)}`],
    expect: () => ["SIGN-OFF: FAIL(DIVERGED)"],
  },
  {
    name: "anchor mismatch: TRUNCATED",
    args: ["--expect", `${EID}:9:${"f".repeat(64)}`],
    expect: () => ["SIGN-OFF: FAIL(TRUNCATED)"],
  },
  {
    name: "tracked file under a managed path",
    mutate: ({ repo, claimsFile }) => git(repo, ["add", "-f", claimsFile]),
    expect: ({ claimsFile }) => [`SIGN-OFF: FAIL(TRACKED(${claimsFile}))`],
  },
];

for (const c of CASES) {
  test(`each failing condition ⇒ exit 4 naming the cause (US-025 AC-3): ${c.name}`, async () => {
    const fx = await signedRepo();
    if (c.mutate) c.mutate(fx);
    const r = await signOffCli(fx.repo, c.args ?? []);
    assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
    assert.deepEqual(failLines(r.stdout), c.expect(fx));
    assert.equal(lines(r.stdout)[0], c.expect(fx)[0], "the verdict comes first");
    assert.ok(lines(r.stdout).includes("UNADMITTED: 0"), "the listings still follow");
    if (c.also) c.also(r.stdout, fx);
  });
}

test("coverage INDETERMINATE on the latest assessment ⇒ exit 4 COVERAGE-INDETERMINATE(<run>) (US-014 AC-3; P5)", async () => {
  const record = defaultRecord();
  record.scope_paths = ["lib/"]; // nothing tracked there ⇒ empty scope
  record.product_paths = ["src/"];
  const repo = readyRepo({ record });
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const { run_id } = await committedRun(repo, "assessment", { claims: [], declared: [] });
  assert.equal(readArtifact(join(runDir(repo, run_id), "coverage.json"), { kind: "coverage" }).payload.indeterminate, true);
  const r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), [`SIGN-OFF: FAIL(COVERAGE-INDETERMINATE(${run_id}))`]);
});

test("a matching --expect anchor passes; several causes are all named, in the spec's order", async () => {
  const fx = await signedRepo();
  const anchor = ok(await register(fx.repo, ["anchor", "print"]), "anchor print").stdout.trim();
  const r0 = await signOffCli(fx.repo, ["--expect", anchor]);
  assert.equal(r0.code, 0, `${r0.stdout}${r0.stderr}`);
  assert.equal(lines(r0.stdout)[0], "SIGN-OFF: OK");
  // now three conditions at once: drift, anchor, tracked
  writeFileSync(join(fx.repo, "src", "app.js"), "export const a = 2;\n");
  git(fx.repo, ["add", "-f", fx.claimsFile]);
  const r = await signOffCli(fx.repo, ["--expect", `${EID}:0:${"f".repeat(64)}`]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), [`SIGN-OFF: FAIL(SCOPE-DRIFTED(1 files)) run=${fx.run_id}`, "SIGN-OFF: FAIL(DIVERGED)", `SIGN-OFF: FAIL(TRACKED(${fx.claimsFile}))`]);
});

test("a malformed --expect is a usage error (exit 2), nothing else printed", async () => {
  const { repo } = await signedRepo();
  const r = await signOffCli(repo, ["--expect", "nonsense"]);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^USAGE\(sign-off: --expect /);
  assert.equal(lines(r.stdout).length, 1);
});

test("argv: --engagement is required and must name the engagement in engagement.md; positionals and unknown flags are usage errors", async () => {
  const { repo } = await signedRepo();
  let r = await evidence(repo, ["sign-off"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(sign-off: --engagement is required/);
  r = await evidence(repo, ["sign-off", "--engagement", "eng-other"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(sign-off: --engagement eng-other is not the engagement in engagement\.md/);
  r = await signOffCli(repo, ["extra"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(sign-off: unexpected argument extra/);
  r = await signOffCli(repo, ["--yes"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(sign-off: unknown flag --yes/);
});

// --- AC-4: the §12 four-step, step 4 ------------------------------------------------------------

test("redacted-only review run + current clean COMMITTED assessment ⇒ exit 0 and lists it (US-025 AC-4; spec §12 four-step step 4)", async () => {
  const repo = readyRepo();
  // step 1: a dirty review over a file carrying a secret ⇒ snapshot citation (redacted bytes, keyed identity)
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=1234 };\n");
  const keyed = claim({ title: "credential in config", priority: "p0", side: "snapshot", lines: [2, 2], snippet_redacted: "const cfg = { <REDACTED:password-assign> };" });
  delete keyed.snippet;
  const review = await committedRun(repo, "review", { claims: [keyed], declared: [{ path: "src/app.js", ranges: [[1, 2]] }] });
  const snap = join(repo, ST, "private", "snapshots", review.run_id, "src", "app.js");
  assert.ok(!readFileSync(snap, "utf8").includes("password=1234"), "the snapshot is redacted");
  // step 2: the working file changes ⇒ the original is gone; then the fix is committed so the assessment sees a clean tree
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\nconst cfg = { password=5678 };\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "rotate"]);
  let r = await evidence(repo, ["check", join(ST, "runs", review.run_id), "--integrity"]);
  assert.equal(lines(r.stdout)[0], "CONSISTENT-REDACTED-ONLY(1 citations)");
  // step 3 (sign-off half): a current, clean, COMMITTED assessment after the mutation
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const assessment = await committedRun(repo, "assessment");
  r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out[0], "SIGN-OFF: OK");
  assert.equal(out[1], "RUNS: 2");
  assert.equal(out[2], `  ${review.run_id} seq=1 kind=review CONSISTENT-REDACTED-ONLY(1 citations)`);
  assert.equal(out[3], `  ${assessment.run_id} seq=2 kind=assessment CONSISTENT CURRENT`);
  assert.ok(!r.stdout.includes("password=") && !r.stderr.includes("password="), "no secret on either channel");
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.equal(result.runs[0].check.consistency.status, "redacted-only");
  assert.equal(result.runs[0].check.drift, null, "drift is computed for the latest assessment only");
  assert.equal(result.runs[1].check.drift.current, true);
});

// --- AC-5: informational listings never change the exit ----------------------------------------------

test("informational listings do not affect exit: an incomplete run, a working-tree change outside scope and an unauthenticated approval ⇒ still exit 0 (US-025 AC-5)", async () => {
  const { repo, run_id } = await signedRepo();
  const pending = await initRun(repo, "review", ["--base", "HEAD"]);
  writeFileSync(join(repo, "package.json"), '{"name":"fixture","private":true}\n'); // a product path, not a scope path
  const finding = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" }).payload.findings[0];
  ok(await register(repo, ["add", "--subject", finding.id, "--priority", "p2", "--title", "app export", "--run", run_id]), "register add");
  ok(await register(repo, ["accept", "R-0001", "--until", "2027-01-01", "--approved-by", "someone", "--approval-ref", "TICKET-1"]), "register accept");
  const r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out[0], "SIGN-OFF: OK");
  assert.ok(out.includes("INCOMPLETE: 1") && out.includes(`  ${pending} seq=2 kind=review`));
  assert.ok(out.includes("CHANGES-SINCE-BASELINE: 1") && out.includes("  changed package.json"));
  assert.ok(out.includes("UNAUTHENTICATED-APPROVALS: 1") && out.includes("  R-0001 status=accepted acceptance"));
  assert.ok(!r.stdout.includes("authenticated: true") && !r.stdout.includes("confirmed"));
  // the register the run snapshotted is older than the live one: sign-off reads the live register for approvals, check re-derives the snapshot — both consistent
  assert.equal(runsEntry(r.stdout, run_id), `  ${run_id} seq=1 kind=assessment CONSISTENT CURRENT`);
});

// --- US-006: per-path observation ---------------------------------------------------------------------

test("tracked change / untracked change listed per path (observed, not attributed); an ignored change is reported as excluded coverage and never named (US-006 AC-2…AC-4)", async () => {
  const { repo } = await signedRepo();
  writeFileSync(join(repo, "package.json"), '{"name":"changed"}\n'); // tracked, product path
  writeFileSync(join(repo, "src", "new.js"), "export const n = 1;\n"); // untracked, scope path — not a scope.json file, so no drift
  writeFileSync(join(repo, "src", "debug.log"), "secret-looking token=abcdef0123456789\n"); // ignored below
  appendFileSync(join(repo, ".git", "info", "exclude"), "src/debug.log\n");
  git(repo, ["rm", "-q", "--cached", "src/db.js"]); // index only: the working file stays — now untracked, still observed
  const r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  const from = out.indexOf("CHANGES-SINCE-BASELINE: 2");
  assert.ok(from > 0, r.stdout);
  assert.deepEqual(out.slice(from, from + 3), ["CHANGES-SINCE-BASELINE: 2", "  added src/new.js", "  changed package.json"]);
  assert.ok(!out.includes("  removed src/db.js") && !out.includes("  changed src/db.js"), "a tracked file that became untracked with the same content is not a change");
  const ex = out.indexOf("EXCLUDED-COVERAGE: ignored=1");
  assert.ok(ex > from, r.stdout);
  assert.deepEqual(out.slice(ex, ex + 4), ["EXCLUDED-COVERAGE: ignored=1", "  src/ ignored=1", "  package.json ignored=0", "  package-lock.json ignored=0"]);
  assert.ok(!r.stdout.includes("debug.log"), "an ignored file is counted, never named");
});

// --- dispositions (TASK-041: the policy over `<run>/dispositions.json`, tm-lint check's script-derived index; spec §6.10, US-033) ---

const CITE = Object.freeze({ path: "src/app.js", side: "head", lines: [1, 1] });
const TICKET = "https://tracker.example/1";
/** Four threats, one per policy-relevant kind; the agent's `disposition.kind` is an assertion the index either validated or not (G-7). */
const THREAT_MODEL = Object.freeze({
  elements: [{ id: "E-001", kind: "process", name: "app", citation: CITE }],
  threats: [
    { id: "T-001", element_id: "E-001", stride: "S", title: "spoofed caller", mitigations: [], disposition: { kind: "undisposed" } },
    { id: "T-002", element_id: "E-001", stride: "T", title: "tampered config", mitigations: [], disposition: { kind: "planned", ref: "P-001" } },
    { id: "T-003", element_id: "E-001", stride: "I", title: "leaked log", mitigations: [], disposition: { kind: "ticketed", ref: TICKET } },
    { id: "T-004", element_id: "E-001", stride: "E", title: "escalated role", mitigations: [{ id: "M-001", claim: "role checked server-side", citation: CITE }], disposition: { kind: "mitigated", ref: "M-001" } },
  ],
});
/** The index `tm-lint check` would derive for THREAT_MODEL once every relationship validated (references/threat-model.schema.json, Dispositions). */
const INDEX = Object.freeze([
  { threat_id: "T-001", kind: "undisposed", ref: "", resolved_via: "none" },
  { threat_id: "T-002", kind: "planned", ref: "P-001", resolved_via: "proposal" },
  { threat_id: "T-003", kind: "ticketed", ref: TICKET, resolved_via: "tracker-readback" },
  { threat_id: "T-004", kind: "mitigated", ref: "M-001", resolved_via: "receipt" },
]);

function setPolicy(repo, require_dispositions) {
  const record = defaultRecord();
  if (require_dispositions === undefined) delete record.sign_off;
  else record.sign_off = { require_dispositions };
  writeFileSync(join(repo, ST, "engagement.md"), engagementMd(record));
}

/** A repo with one COMMITTED assessment carrying THREAT_MODEL as its snapshot and, unless `index: null`, INDEX as its dispositions index. */
async function dispositionsRepo({ index = INDEX, model = THREAT_MODEL, lint = false } = {}) {
  const repo = readyRepo();
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const run = await committedRun(repo, "assessment", { model, index, lint });
  return { repo, ...run };
}

const dispositionsBlock = (stdout) => {
  const out = lines(stdout);
  const at = out.findIndex((l) => l.startsWith("DISPOSITIONS:"));
  assert.ok(at > 0, stdout);
  return out.slice(at);
};

test("default policy lists undisposed/planned and exits 0: the list comes from dispositions.json, so a validated `ticketed`/`mitigated` is not listed (US-033 AC-1)", async () => {
  const { repo, run_id } = await dispositionsRepo();
  for (const policy of [undefined, "executed-or-ticketed"]) {
    setPolicy(repo, policy);
    const r = await signOffCli(repo);
    assert.equal(r.code, 0, `${policy}: ${r.stdout}${r.stderr}`);
    assert.equal(lines(r.stdout)[0], "SIGN-OFF: OK");
    assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: 2 undisposed-or-planned policy=executed-or-ticketed", "  T-001 undisposed", "  T-002 planned"]);
  }
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.deepEqual(result.dispositions, { policy: "executed-or-ticketed", evaluated: true, linted: true, listed: [{ id: "T-001", kind: "undisposed" }, { id: "T-002", kind: "planned" }] });
  assert.equal(result.latest, run_id);
});

test("all ⇒ exit 4 naming threat ids: DISPOSITIONS(<threat ids>) over the index's undisposed/planned rows, the listing still printed (US-033 AC-2)", async () => {
  const { repo } = await dispositionsRepo();
  setPolicy(repo, "all");
  const r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(DISPOSITIONS(T-001, T-002))"]);
  assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: 2 undisposed-or-planned policy=all", "  T-001 undisposed", "  T-002 planned"]);
});

test("none ⇒ not evaluated: no DISPOSITIONS fail, no threat named, the index not even read (US-033 AC-3)", async () => {
  const { repo } = await dispositionsRepo({ index: null }); // absent index: would list every threat under any other policy
  setPolicy(repo, "none");
  const r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: not evaluated"]);
  assert.ok(!r.stdout.includes("T-00") && !r.stderr.includes("not linted"));
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.deepEqual(result.dispositions, { policy: "none", evaluated: false, linted: false, listed: [] });
});

test("absent dispositions.json ⇒ every threat of the snapshot counts as undisposed — the agent's unvalidated `ticketed`/`mitigated` assertions never dispose anything (G-7; PM log after G20)", async () => {
  const { repo, run_id } = await dispositionsRepo({ index: null });
  setPolicy(repo, undefined);
  let r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: 4 undisposed-or-planned policy=executed-or-ticketed", "  T-001 undisposed", "  T-002 undisposed", "  T-003 undisposed", "  T-004 undisposed"]);
  assert.match(r.stderr, new RegExp(`sign-off: runs/${run_id} has no dispositions\\.json .*not linted`), "the reason is on stderr");
  assert.ok(!r.stderr.includes(repo), "no absolute path on stderr");
  setPolicy(repo, "all");
  r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(DISPOSITIONS(T-001, T-002, T-003, T-004))"]);
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.equal(result.dispositions.linted, false);
  assert.equal(result.dispositions.evaluated, true);
  // a snapshot without threats has nothing to dispose: nothing listed, nothing on stderr
  const empty = await dispositionsRepo({ index: null, model: EMPTY_MODEL });
  setPolicy(empty.repo, "all");
  r = await signOffCli(empty.repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: 0 undisposed-or-planned policy=all"]);
});

test("the index the real `tm-lint check` writes is the one sign-off reads (R1: script-derived, never agent-authored)", async () => {
  const model = { elements: THREAT_MODEL.elements, threats: [THREAT_MODEL.threats[0], { ...THREAT_MODEL.threats[3], disposition: { kind: "undisposed" } }] };
  const { repo, dir } = await dispositionsRepo({ index: null, model, lint: true });
  assert.ok(existsSync(join(dir, "dispositions.json")), "tm-lint check wrote the index");
  assert.equal(readArtifact(join(dir, "dispositions.json"), { kind: "dispositions" }).payload.dispositions.length, 2);
  setPolicy(repo, "all");
  const r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(DISPOSITIONS(T-001, T-004))"]);
  assert.ok(!r.stderr.includes("not linted"));
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.equal(result.dispositions.linted, true);
});

test("a dispositions.json that is not the snapshot's index (rows for other threats, or a tampered envelope) ⇒ exit 4 INCONSISTENT(dispositions) run=<id>, DISPOSITIONS not evaluated", async () => {
  // rows that do not match the snapshot's threats one-to-one
  const stale = await dispositionsRepo({ index: [INDEX[0], INDEX[1], INDEX[2]] });
  let r = await signOffCli(stale.repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), [`SIGN-OFF: FAIL(INCONSISTENT(dispositions)) run=${stale.run_id}`]);
  assert.deepEqual(dispositionsBlock(r.stdout), ["DISPOSITIONS: not evaluated"]);
  assert.ok(!r.stderr.includes(stale.repo), "no absolute path on stderr");
  // a row whose kind is not the snapshot's assertion
  const rekinded = await dispositionsRepo({ index: [{ ...INDEX[0], kind: "executed", ref: "O-0123456789ab", resolved_via: "observation" }, INDEX[1], INDEX[2], INDEX[3]] });
  r = await signOffCli(rekinded.repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), [`SIGN-OFF: FAIL(INCONSISTENT(dispositions)) run=${rekinded.run_id}`]);
  // the file rewritten after the fact
  const tampered = await dispositionsRepo();
  writeFileSync(join(tampered.dir, "dispositions.json"), '{"envelope":{},"payload":{"dispositions":[]}}\n');
  r = await signOffCli(tampered.repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), [`SIGN-OFF: FAIL(INCONSISTENT(dispositions)) run=${tampered.run_id}`]);
});

// --- run kind: the ledger entry must agree with run.json's template (PM log after G16; fail-closed) --------

function rekindLedger(repo, run_id, kind) {
  const path = join(repo, ST, "ledger", "index.json");
  const entries = JSON.parse(readFileSync(path, "utf8"));
  entries.find((e) => e.run_id === run_id).kind = kind;
  writeFileSync(path, `${JSON.stringify(entries)}\n`);
}

test("a ledger entry whose kind is not run.json's template ⇒ exit 4 INCONSISTENT(runs/<id>) run=<id>, the run never taken as the latest assessment, no ENOENT, no absolute path on stderr", async () => {
  // a review run relabelled `assessment`: it must not become the latest assessment (its threat-model.json does not exist)
  const repo = readyRepo();
  ok(await evidence(repo, ["engagement", "baseline"]), "baseline");
  const review = await committedRun(repo, "review");
  rekindLedger(repo, review.run_id, "assessment");
  let r = await signOffCli(repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(NO-ASSESSMENT)", `SIGN-OFF: FAIL(INCONSISTENT(runs/${review.run_id})) run=${review.run_id}`]);
  assert.equal(runsEntry(r.stdout, review.run_id), `  ${review.run_id} seq=1 kind=assessment INCONSISTENT(runs/${review.run_id})`, "listed under the ledger's kind, with the cross-check's verdict");
  assert.ok(!r.stderr.includes(repo) && !r.stderr.includes("ENOENT"), r.stderr);
  assert.match(r.stderr, new RegExp(`sign-off: runs/${review.run_id} is listed as assessment but run\\.json says review`));
  assert.ok(lines(r.stdout).includes("DISPOSITIONS: not evaluated"));
  // an assessment relabelled `review`: the same cause, and it is no longer an assessment either
  const fx = await signedRepo();
  rekindLedger(fx.repo, fx.run_id, "review");
  r = await signOffCli(fx.repo);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.deepEqual(failLines(r.stdout), ["SIGN-OFF: FAIL(NO-ASSESSMENT)", `SIGN-OFF: FAIL(INCONSISTENT(runs/${fx.run_id})) run=${fx.run_id}`]);
});

// --- the exported contract TASK-035's test reads --------------------------------------------------------

test("FAIL_CAUSES and LISTING_HEADERS: frozen, non-empty, spelled from tokens.mjs; every header is printed by a sign-off, in order", () => {
  assert.ok(Object.isFrozen(FAIL_CAUSES) && Object.isFrozen(LISTING_HEADERS));
  assert.deepEqual(FAIL_CAUSES, ["NO-ASSESSMENT", "INCONSISTENT(<field>)", "STRUCTURE-ONLY", "SCOPE-DRIFTED(<n> files)", "COVERAGE-INDETERMINATE(<run>)", "CORRUPT", "TRUNCATED", "DIVERGED", "DISPOSITIONS(<threat ids>)", "TRACKED(<path>)"]);
  assert.deepEqual(LISTING_HEADERS, ["RUNS:", "INCOMPLETE:", "CHANGES-SINCE-BASELINE:", "EXCLUDED-COVERAGE:", "UNAUTHENTICATED-APPROVALS:", "UNADMITTED:", "DISPOSITIONS:"]);
  assert.equal(tokens.SIGN_OFF_OK, "SIGN-OFF: OK");
  assert.equal(tokens.signOffFail("NO-ASSESSMENT"), "SIGN-OFF: FAIL(NO-ASSESSMENT)");
  assert.equal(tokens.signOffFail("STRUCTURE-ONLY", "0123456789ab-0001"), "SIGN-OFF: FAIL(STRUCTURE-ONLY) run=0123456789ab-0001");
  assert.throws(() => tokens.signOffFail("STRUCTURE-ONLY", "nope"), /run_id/);
  assert.equal(tokens.coverageIndeterminate("0123456789ab-0001"), "COVERAGE-INDETERMINATE(0123456789ab-0001)");
  assert.equal(tokens.dispositionsBlocking(["T-001", "T-002"]), "DISPOSITIONS(T-001, T-002)");
  assert.throws(() => tokens.dispositionsBlocking([]), /threat/);
});

// --- TASK-043: UNADMITTED — the suite against what publish --profile case recorded (spec §2, §12; US-025 AC-6, US-035 AC-4) ---

/** A COMMITTED review run in `repo` with `<st>/cases/my-product/<name>` admitted (heuristic route), published to the suite; returns the run id. */
async function publishedSuite(repo, cases) {
  const { caseText } = await import("../fixtures/plan/helpers.mjs");
  const casesDir = join(repo, ST, "cases", "my-product");
  mkdirSync(casesDir, { recursive: true });
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const packet = packetSha(ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet").stdout);
  ok(await evidence(repo, ["gate", "--run", run_id, "--claims", drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet, findings: [claim()] })]), "gate");
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", drop(repo, run_id, "examined-1.json", { packet_sha256: packet, declared: [{ path: "src/app.js", ranges: [[1, 1]] }] })]), "coverage");
  for (const [name, rows, title] of cases) {
    writeFileSync(join(casesDir, name), caseText(name.slice(0, 6), rows, { title }));
    ok(await runScript("plan", ["admit", "--run", run_id, join(ST, "cases", "my-product", name)], { cwd: repo, env: ENV }), `admit ${name}`);
  }
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report review");
  ok(await evidence(repo, ["publish", "--run", run_id, "--profile", "case", "--to", "tasks/security-my-product-admitted"]), "publish case");
  return run_id;
}

test("extra TC placed in the admitted suite by hand ⇒ listed as unadmitted; the published cases are not; the comparison is the published file's identity (what publish recorded), not the candidate's; informational — exit unchanged (spec §12; US-025 AC-6, US-035 AC-4)", async () => {
  const { repo } = await signedRepo();
  const suite = join(repo, "tasks", "security-my-product-admitted");
  await publishedSuite(repo, [
    ["TC-001_headers.md", [["Navigate to `{{base_url}}/login`", "Loads"], ["Inspect the response headers of the `/login` document", "`X-Frame-Options` is DENY"]], "Headers"],
    ["TC-002_plain.md", [["Navigate to `{{base_url}}/`", "Loads"]], "Plain"],
  ]);
  assert.deepEqual(readdirSync(suite).sort(), ["TC-001_headers.md", "TC-002_plain.md"]);
  let r = await signOffCli(repo);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.ok(lines(r.stdout).includes("UNADMITTED: 0"), r.stdout);
  // the audit-form rewrite gives TC-001 a different identity than its candidate: still admitted, because publish recorded it
  const candidate = readFileSync(join(repo, ST, "cases", "my-product", "TC-001_headers.md"));
  assert.ok(!readFileSync(join(suite, "TC-001_headers.md")).equals(candidate), "the published file is not the candidate byte for byte");

  writeFileSync(join(suite, "TC-003_by-hand.md"), "---\nid: TC-003\ntitle: Sneaked in\npriority: high\n---\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | Submit the form | ok |\n");
  writeFileSync(join(suite, "README.md"), "# not a case\n");
  mkdirSync(join(suite, "nested"));
  writeFileSync(join(suite, "nested", "TC-004_deep.md"), "deep\n");
  // a copy of the candidate itself (the admitted identity, but not what publish wrote) is unadmitted too
  writeFileSync(join(suite, "TC-005_candidate-copy.md"), candidate);
  r = await signOffCli(repo);
  assert.equal(r.code, 0, `informational: ${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  const at = out.indexOf("UNADMITTED: 4");
  assert.ok(at > 0, r.stdout);
  assert.deepEqual(out.slice(at + 1, at + 5), [
    "  tasks/security-my-product-admitted/README.md",
    "  tasks/security-my-product-admitted/TC-003_by-hand.md",
    "  tasks/security-my-product-admitted/TC-005_candidate-copy.md",
    "  tasks/security-my-product-admitted/nested/TC-004_deep.md",
  ]);
  assert.ok(!r.stdout.includes("Sneaked") && !/[0-9a-f]{64}/.test(out.slice(at, at + 5).join("\n")), "paths only: no content, no hash");
  assert.ok(out.findIndex((l) => l.startsWith("UNAUTHENTICATED-APPROVALS:")) < at && at < out.findIndex((l) => l.startsWith("DISPOSITIONS:")), "in the plan §4.1 order");
  const result = await signOff(ctxFor(repo), { engagement_id: EID });
  assert.deepEqual(result.unadmitted.files, out.slice(at + 1, at + 5).map((l) => l.trim()));
  assert.deepEqual(result.unadmitted.suites, ["tasks/security-my-product-admitted"]);
  assert.ok(result.ok);
});

test("a suite directory with no publish behind it ⇒ every file unadmitted; no suite directory ⇒ UNADMITTED: 0; a case manifest that is not the artifact it claims to be is skipped with a stderr note (fail-closed: its members count for nothing)", async () => {
  const { repo } = await signedRepo();
  let r = await signOffCli(repo);
  assert.ok(lines(r.stdout).includes("UNADMITTED: 0"), r.stdout);
  const suite = join(repo, "tasks", "security-my-product-admitted");
  mkdirSync(suite, { recursive: true });
  writeFileSync(join(suite, "TC-001_x.md"), "x\n");
  r = await signOffCli(repo);
  assert.equal(r.code, 0);
  const out = lines(r.stdout);
  assert.deepEqual(out.slice(out.indexOf("UNADMITTED: 1"), out.indexOf("UNADMITTED: 1") + 2), ["UNADMITTED: 1", "  tasks/security-my-product-admitted/TC-001_x.md"]);
  rmSync(suite, { recursive: true });
  await publishedSuite(repo, [["TC-002_plain.md", [["Navigate to `{{base_url}}/`", "Loads"]], "Plain"]]);
  assert.ok(lines((await signOffCli(repo)).stdout).includes("UNADMITTED: 0"));
  const [manifest] = readdirSync(join(repo, ST, "handoffs")).filter((n) => n.endsWith(".case.export-manifest.json"));
  const path = join(repo, ST, "handoffs", manifest);
  writeFileSync(path, readFileSync(path, "utf8").replace('"slug":"my-product"', '"slug":"my-prodact"'));
  r = await signOffCli(repo);
  assert.equal(r.code, 0);
  assert.ok(lines(r.stdout).includes("UNADMITTED: 1"), r.stdout);
  assert.match(r.stderr, /case\.export-manifest\.json is not the artifact it claims to be — its recorded suite is not trusted/);
});

test("review 1: a directory named <run>.case.export-manifest.json, or a plain file at the suite path, is skipped with a stderr note — sign-off still prints its verdict (never EISDIR/ENOTDIR)", async () => {
  const { repo } = await signedRepo();
  const handoffs = join(repo, ST, "handoffs");
  mkdirSync(join(handoffs, `${"f".repeat(12)}-0001.case.export-manifest.json`), { recursive: true });
  let r = await signOffCli(repo);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(lines(r.stdout).includes("UNADMITTED: 0"), r.stdout);
  assert.match(r.stderr, /case\.export-manifest\.json is not a regular file — its recorded suite is not trusted/);
  mkdirSync(join(repo, "tasks"), { recursive: true });
  writeFileSync(join(repo, "tasks", "security-my-product-admitted"), "not a directory\n");
  r = await signOffCli(repo);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(lines(r.stdout).includes("UNADMITTED: 0"), r.stdout);
  assert.match(r.stderr, /tasks\/security-my-product-admitted is not a directory — its files are not listed/);
});

test("cmd-sign-off imports: no child process of its own, no network, no writer, stdout only through ctx (G-4, G-6, G-14)", () => {
  const src = readFileSync(new URL("./cmd-sign-off.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /child_process|\bfetch\(|node:http|node:net|node:dns/);
  assert.doesNotMatch(src, /writeFileSync|writeAtomic|writeExclusive|writeArtifact|"\.gitignore"/, "sign-off writes nothing");
  assert.doesNotMatch(src, /console\.(log|error)|process\.stdout|process\.stderr/, "stdout/stderr only through ctx (G-4)");
  assert.ok(existsSync(new URL("./cmd-sign-off.mjs", import.meta.url)));
});
