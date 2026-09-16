import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("register", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: register\.mjs/m);
});

test("--help ⇒ exit 0", async () => {
  const r = await runScript("register", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: register\.mjs/m);
  assert.match(r.stdout, /accept <R-id>/);
  assert.doesNotMatch(r.stdout, /\bconfirm\b/, "D15/US-021: no confirm command, not even in usage");
});

test("unknown command ⇒ exit 2 (incl. `register.mjs confirm` ⇒ 2, US-021 AC-2)", async () => {
  const repo = initRepo();
  for (const cmd of ["confirm", "nope"]) {
    const r = await runScript("register", [cmd, "R-0001"], { cwd: repo });
    assert.equal(r.code, 2, cmd);
    assert.match(r.stdout, /^usage: register\.mjs/m);
    assert.match(r.stderr, new RegExp(`unknown command "${cmd}"`));
  }
});

test("the entry script is a thin dispatcher and never spells the forbidden verb", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
  assert.doesNotMatch(src, /confirm/i, "G-8");
});

test("TASK-028 commands are registered: add, replay, status, anchor route to their lib/cmd-register-*.mjs modules", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  for (const cmd of ["add", "replay", "status", "anchor"]) {
    assert.match(src, new RegExp(`^\\s*${cmd}: \\(\\) => import\\("\\./lib/cmd-register-${cmd}\\.mjs"\\),`, "m"), cmd);
  }
});

test("a registered command outside a git work tree ⇒ exit 2 NOT-A-WORK-TREE", async () => {
  const r = await runScript("register", ["status"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-A-WORK-TREE\n");
});

// --- TASK-029 (US-021 AC-2, AC-3, AC-4) -----------------------------------------

const ADD = ["add", "--subject", "f".repeat(64), "--priority", "p1", "--title", "t", "--run", "0123456789ab-0001"];
const APPROVE = ["--approved-by", "cto", "--approval-ref", "RISK-1"];
const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };

async function repoWithEngagement() {
  const { repoWithEngagement: seed, stDir } = await import("./fixtures/register/seed.mjs");
  const repo = seed();
  return { repo, st: stDir(repo) };
}

test("confirm is an unknown command (exit 2)", async () => {
  const repo = initRepo();
  for (const argv of [["confirm", "R-0001"], ["confirm", "R-0001", ...APPROVE], ["transition", "confirm", "R-0001"]]) {
    const r = await runScript("register", argv, { cwd: repo });
    assert.equal(r.code, 2, argv.join(" "));
    assert.doesNotMatch(r.stdout, /^ROW /m);
  }
  assert.doesNotMatch(readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8"), /confirm/i);
  for (const name of ["lib/cmd-register-transition.mjs", "lib/register-transitions.mjs", "lib/register-fold.mjs", "lib/register-core.mjs"]) {
    assert.doesNotMatch(readFileSync(join(SCRIPTS_DIR, name), "utf8"), /\bconfirm(ed)?\b/i, `${name}: no confirm, no confirmed state (G-8)`);
  }
});

test("accept without both flags rejected", async () => {
  const { repo } = await repoWithEngagement();
  const add = await runScript("register", ADD, { cwd: repo, env: ENV });
  assert.equal(add.code, 0, add.stderr);
  for (const argv of [
    ["accept", "R-0001", "--until", "2026-12-31"],
    ["accept", "R-0001", "--until", "2026-12-31", "--approved-by", "cto"],
    ["accept", "R-0001", "--until", "2026-12-31", "--approval-ref", "RISK-1"],
  ]) {
    const r = await runScript("register", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(accept: .*--approved-by.*--approval-ref/);
  }
  const ok = await runScript("register", ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE], { cwd: repo, env: ENV });
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

test("approval record shape has authenticated:false", async () => {
  const { repo, st } = await repoWithEngagement();
  const { parseStrict } = await import("./canon.mjs");
  await runScript("register", ADD, { cwd: repo, env: ENV });
  await runScript("register", ADD, { cwd: repo, env: ENV });
  await runScript("register", ["accept", "R-0001", "--until", "2026-12-31", ...APPROVE], { cwd: repo, env: ENV });
  await runScript("register", ["close-false-positive", "R-0002", "--approved-by", "cto", "--approval-ref", "RISK-2"], { cwd: repo, env: ENV });
  const rows = parseStrict(readFileSync(join(st, "register", "projection.json"))).rows;
  assert.deepEqual(rows["R-0001"].acceptance, { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-1", authenticated: false, until: "2026-12-31" });
  assert.deepEqual(rows["R-0002"].false_positive, { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-2", authenticated: false });
  const status = await runScript("register", ["status", "--json"], { cwd: repo, env: ENV });
  const json = parseStrict(status.stdout.trim());
  assert.equal(json.unauthenticated_approvals, 2, "one bucket");
  assert.deepEqual(json.open_exposure, { p0: 0, p1: 2, p2: 0, p3: 0 }, "no approval reduces open exposure (spec §6.8)");
});

test("TASK-029 verbs are registered and route to lib/cmd-register-transition.mjs", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  for (const verb of ["accept", "revoke", "check", "close-false-positive", "reopen", "supersede", "alias"]) {
    assert.match(src, new RegExp(`^\\s*"?${verb}"?: \\(\\) => import\\("\\./lib/cmd-register-transition\\.mjs"\\)\\.then\\(\\(m\\) => m\\.verb\\("${verb}"\\)\\),`, "m"), verb);
  }
  assert.match(src, /^\s*transition: \(\) => import\("\.\/lib\/cmd-register-transition\.mjs"\),/m);
  assert.doesNotMatch(src, /ticketed: \(\)/, "ticketed has no dispatch line: it is appended by ingest tracker-readback only");
});
