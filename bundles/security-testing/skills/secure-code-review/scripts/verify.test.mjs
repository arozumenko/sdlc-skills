import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APP_LINES_C1, buildRepo, checkout, commit, put, writeEngagement } from "./fixtures/verify/build-repo.mjs";

const SCRIPTS = new URL("./", import.meta.url).pathname;
const VERIFY = join(SCRIPTS, "verify.mjs");
const CITE = join(SCRIPTS, "cite.mjs");
const REGISTER = new URL("../../risk-register/scripts/register.mjs", import.meta.url).pathname;
const REVIEW = ".agents/security-testing/reviews/r1";
const ST = ".agents/security-testing";
const HEX64 = /^[0-9a-f]{64}$/;

const spawn = (script, root, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, USER: "env-user" } });
  return { code: r.status, out: r.stdout.trim().split("\n"), err: r.stderr };
};
const run = (root, ...args) => spawn(VERIFY, root, args);
const register = (root, ...args) => spawn(REGISTER, root, args);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const runDir = (root, id, head) => join(root, ST, "verify", `${id.slice(0, 8)}-${head.slice(0, 7)}`);

/** Build the repo, write and `check` a findings file citing `safeName` at c1; HEAD stays at c3. */
function setup() {
  const repo = buildRepo();
  const doc = {
    head: repo.oid1,
    scope_paths: ["src/"],
    examined: [{ path: "src/app.js" }],
    findings: [{ title: "Unsanitised file name", class: "path-traversal", priority: "p1", confidence: "high", citations: [{ path: "src/app.js", lines: [3, 5], snippet: APP_LINES_C1.slice(2, 5).join("\n") }], rationale: "…", fix: "…" }],
  };
  put(repo.root, `${REVIEW}/findings.json`, `${JSON.stringify(doc, null, 2)}\n`);
  const c = spawn(CITE, repo.root, ["check", `${REVIEW}/findings.json`]);
  assert.equal(c.code, 0, `cite check: ${c.out.join("\n")}${c.err}`);
  const id = readJson(join(repo.root, REVIEW, "findings.json")).findings[0].id;
  assert.match(id, HEX64);
  return { ...repo, id, review: REVIEW };
}
const first = (t) => run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid2);
const second = (t, value, by = "s1") => run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid2, "--assertion", value, "--by", by);

test("not at head / dirty cited path are refused; nothing is written", () => {
  const t = setup();
  checkout(t.root, t.oid1);
  let r = first(t);
  assert.equal(r.code, 2, r.out.join("\n") + r.err);
  assert.equal(r.out[0], `NOT-AT-HEAD ${t.oid2.slice(0, 7)} (checkout is at ${t.oid1.slice(0, 7)})`);
  checkout(t.root, t.oid2);
  put(t.root, "src/app.js", `${APP_LINES_C1.join("\n")}\n// edited\n`);
  r = first(t);
  assert.equal(r.code, 2, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "DIRTY src/app.js");
  assert.ok(!existsSync(join(t.root, ST, "verify")), "no run directory on a refusal");
  r = run(t.root, "--finding", t.id, "--review", t.review);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(verify: --head/);
  r = run(t.root, "--finding", "deadbeef", "--review", t.review, "--head", t.oid2);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(verify: no finding with id prefix deadbeef/);
});

test("first invocation runs the tests, records the diff, asks for the fix-review", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  const r = first(t);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), "NEXT: dispatch security-reviewer fix-review");
  assert.ok(!r.out.some((l) => l.startsWith("VERDICT")), "no verdict before the fix-review");
  const dir = runDir(t.root, t.id, t.oid2);
  const v = readJson(join(dir, "verify.json"));
  assert.deepEqual(Object.keys(v), ["finding_id", "review", "base", "head", "carried_dirt", "tests", "diff", "assertion", "verdict"]);
  assert.equal(v.finding_id, t.id);
  assert.equal(v.review, REVIEW);
  assert.equal(v.base, t.oid1);
  assert.equal(v.head, t.oid2);
  assert.deepEqual(v.carried_dirt, []);
  assert.equal(v.verdict, "PENDING-REVIEW");
  assert.deepEqual(v.tests.argv, ["npm", "test"]);
  assert.equal(v.tests.exit, 0);
  assert.equal(typeof v.tests.duration_ms, "number");
  assert.equal(v.tests.log, "tests.log");
  const log = join(dir, "tests.log");
  assert.ok(existsSync(log));
  assert.ok(statSync(log).size <= 64 * 1024);
  const logText = readFileSync(log, "utf8");
  assert.match(logText, /pass 2|# pass 2/);
  assert.ok(logText.includes("password = <REDACTED:key-value>"), "the runner's output is redacted before it is written");
  assert.ok(!logText.includes("hunter22xyz") && !r.out.join("\n").includes("hunter22xyz"), "the secret reaches neither disk nor stdout");
  assert.deepEqual(v.diff, { deletion_only: false, advisories: [] });
  assert.equal(v.assertion, null);
  assert.equal(first(t).code, 0, "the first invocation is re-runnable (D2)");
});

test("second invocation with not-refound ⇒ VERIFIED and the register row is fixed", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  assert.equal(second(t, "not-refound").code, 2, "no run yet: --assertion needs a PENDING-REVIEW verify.json");
  assert.equal(register(t.root, "add", "--finding", t.id, "--priority", "p1", "--title", "Unsanitised file name").out[0], "ROW R-0001 open");
  assert.equal(first(t).code, 0);
  let r = second(t, "not-refound");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT VERIFIED finding=${t.id} base=${t.oid1} head=${t.oid2}`);
  assert.ok(!r.out.some((l) => l.startsWith("REGISTER:")), r.out.join("\n"));
  const v = readJson(join(runDir(t.root, t.id, t.oid2), "verify.json"));
  assert.equal(v.verdict, "VERIFIED");
  assert.deepEqual(v.assertion, { value: "not-refound", by: "s1" });
  const s = register(t.root, "status");
  assert.ok(s.out.includes("COUNT fixed=1"), s.out.join("\n"));
  const events = readFileSync(join(t.root, ST, "register/events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.at(-1).event, "fixed");
  assert.equal(events.at(-1).actor, "s1");
  assert.equal(events.at(-1).payload.verify, `${ST}/verify/${t.id.slice(0, 8)}-${t.oid2.slice(0, 7)}/verify.json`);
  r = second(t, "not-refound");
  assert.equal(r.code, 2, "a verdict is set once per run; restart with a first invocation");
  assert.match(r.out[0], /^USAGE\(verify: .*VERIFIED/);
  r = run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid2, "--assertion", "maybe", "--by", "s1");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(verify: --assertion must be not-refound or refound/);
});
test("refound ⇒ UNVERIFIED-REFOUND and the row is regressed only if it was fixed", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  register(t.root, "add", "--finding", t.id, "--priority", "p1", "--title", "x");
  assert.equal(first(t).code, 0);
  let r = second(t, "refound", "s2");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT UNVERIFIED-REFOUND finding=${t.id} base=${t.oid1} head=${t.oid2}`);
  let s = register(t.root, "status").out;
  assert.ok(s.includes("COUNT open=1") && s.includes("COUNT regressed=0"), `an open row is not regressed: ${s.join("\n")}`);
  assert.equal(first(t).code, 0);
  assert.equal(second(t, "not-refound").code, 0);
  assert.ok(register(t.root, "status").out.includes("COUNT fixed=1"));
  assert.equal(first(t).code, 0);
  r = second(t, "refound", "s3");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.match(r.out.at(-1), /^VERDICT UNVERIFIED-REFOUND /);
  s = register(t.root, "status").out;
  assert.ok(s.includes("COUNT regressed=1") && s.includes("COUNT fixed=0"), s.join("\n"));
  const v = readJson(join(runDir(t.root, t.id, t.oid2), "verify.json"));
  assert.deepEqual(v.assertion, { value: "refound", by: "s3" });
});

test("head not touching the cited path ⇒ UNVERIFIED-NOT-A-FIX; deletion-only ⇒ UNVERIFIED-DELETION-ONLY (c3)", () => {
  const t = setup();
  checkout(t.root, t.oid1);
  put(t.root, "README.md", "# fixture\n\nchanged\n");
  const oid1b = commit(t.root, "readme only");
  let r = run(t.root, "--finding", t.id, "--review", t.review, "--head", oid1b);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT UNVERIFIED-NOT-A-FIX finding=${t.id} base=${t.oid1} head=${oid1b}`);
  assert.ok(!r.out.includes("NEXT: dispatch security-reviewer fix-review"));
  let v = readJson(join(runDir(t.root, t.id, oid1b), "verify.json"));
  assert.equal(v.verdict, "UNVERIFIED-NOT-A-FIX");
  assert.equal(v.tests, null, "no tests run for a non-fix");
  assert.ok(!existsSync(join(runDir(t.root, t.id, oid1b), "tests.log")));
  checkout(t.root, t.oid1);
  r = run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid1);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.match(r.out.at(-1), /^VERDICT UNVERIFIED-NOT-A-FIX /, "head == base is not a fix either");
  checkout(t.root, t.oid3);
  r = run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid3);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT UNVERIFIED-DELETION-ONLY finding=${t.id} base=${t.oid1} head=${t.oid3}`);
  v = readJson(join(runDir(t.root, t.id, t.oid3), "verify.json"));
  assert.equal(v.diff.deletion_only, true);
  assert.equal(v.tests.exit, 0, "the tests still ran (spec step 3 precedes step 4)");
  r = run(t.root, "--finding", t.id, "--review", t.review, "--head", t.oid3, "--assertion", "not-refound", "--by", "s1");
  assert.equal(r.code, 2, "a decided run takes no assertion");
});

test("no argv in the engagement ⇒ UNVERIFIED-NO-TEST-SURFACE; failing tests ⇒ UNVERIFIED-TESTS-FAILED", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  writeEngagement(t.root, { execute_project_tests: null });
  let r = first(t);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT UNVERIFIED-NO-TEST-SURFACE finding=${t.id} base=${t.oid1} head=${t.oid2}`);
  let v = readJson(join(runDir(t.root, t.id, t.oid2), "verify.json"));
  assert.equal(v.tests, null);
  assert.deepEqual(v.carried_dirt, [`${ST}/engagement.md`], "the edited engagement is unrelated dirt");
  writeEngagement(t.root, { execute_project_tests: { argv: ["bash", "-c", "true"] } });
  r = first(t);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(verify: execute_project_tests\.argv rejected: first token is not on the allowlist/);
  writeEngagement(t.root); // back to the fixture's `npm test`, so the commit below carries it
  checkout(t.root, t.oid1);
  put(t.root, "src/app.js", `${APP_LINES_C1.map((l, i) => (i === 3 ? "  return name.trim();" : l)).join("\n")}\n`);
  const bad = commit(t.root, "wrong fix");
  r = run(t.root, "--finding", t.id, "--review", t.review, "--head", bad);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out.at(-1), `VERDICT UNVERIFIED-TESTS-FAILED finding=${t.id} base=${t.oid1} head=${bad}`);
  v = readJson(join(runDir(t.root, t.id, bad), "verify.json"));
  assert.notEqual(v.tests.exit, 0);
  assert.match(readFileSync(join(runDir(t.root, t.id, bad), "tests.log"), "utf8"), /fail 1|# fail 1/);
});

test("unrelated dirt is carried, not refused; a moved cited path is DIRTY", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  put(t.root, "README.md", "# fixture\n\ndirty\n");
  let r = first(t);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.deepEqual(readJson(join(runDir(t.root, t.id, t.oid2), "verify.json")).carried_dirt, ["README.md"]);
  spawnSync("git", ["mv", "src/app.js", "src/main.js"], { cwd: t.root });
  r = first(t);
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "DIRTY src/app.js", "the cited path is gone from the work tree");
});

test("an added suppression is an ADVISORY; a standalone install skips the register", () => {
  const t = setup();
  checkout(t.root, t.oid2);
  put(t.root, "src/app.js", `${APP_LINES_C1.map((l, i) => (i === 3 ? "  return basename(name); // eslint-disable-line no-restricted-syntax" : l)).join("\n")}\n`);
  const head = commit(t.root, "fix with a suppression");
  let r = run(t.root, "--finding", t.id, "--review", t.review, "--head", head);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.deepEqual(r.out, ["ADVISORY src/app.js:4 inline-suppress", "NEXT: dispatch security-reviewer fix-review"]);
  assert.deepEqual(readJson(join(runDir(t.root, t.id, head), "verify.json")).diff.advisories, [{ path: "src/app.js", line: 4, kind: "inline-suppress" }]);
  // A one-skill install: the skill dir copied alone, so `../../risk-register` does not resolve.
  const alone = join(mkdtempSync(join(tmpdir(), "st-alone-")), "skills", "secure-code-review");
  cpSync(join(SCRIPTS, ".."), alone, { recursive: true });
  register(t.root, "add", "--finding", t.id, "--priority", "p1", "--title", "x");
  r = spawn(join(alone, "scripts", "verify.mjs"), t.root, ["--finding", t.id, "--review", t.review, "--head", head, "--assertion", "not-refound", "--by", "s1"]);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.deepEqual(r.out, ["REGISTER: skipped (risk-register not installed)", `VERDICT VERIFIED finding=${t.id} base=${t.oid1} head=${head}`]);
  assert.ok(register(t.root, "status").out.includes("COUNT open=1"), "the row is untouched");
});
