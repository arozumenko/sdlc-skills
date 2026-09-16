// TASK-059 — `register.mjs render [--out <path>]` (plan §4.3, spec §6.8 / P5):
// the lead's context-doc view at <st>/risk-register.md, written atomically,
// redacted (G-4), byte-deterministic for a given projection.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../canon.mjs";
import { SCRIPTS_DIR, cleanupAll, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { ENV, FINDING, RUN, readLog, readProjection, register, registerDir, repoWithEngagement, seedRows, stDir } from "../fixtures/register/seed.mjs";
import { redactString } from "../redact.mjs";
import { renderRegister } from "./register-render.mjs";

after(cleanupAll);

const REL = ".agents/security-testing/risk-register.md";
const seeded = (rows = [["a", "p1"]]) => seedRows(repoWithEngagement(), rows);

test("writes <st>/risk-register.md from the projection; RENDER line; byte-identical on a second run", async () => {
  const repo = await seeded([["first", "p0"], ["second", "p2"]]);
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, `RENDER ${REL} rows=2 seq=2\n`);
  assert.equal(r.stderr, "");
  const path = join(stDir(repo), "risk-register.md");
  const first = readFileSync(path, "utf8");
  assert.equal(first, renderRegister(readProjection(repo)), "the file is exactly the pure render of the projection");
  assert.match(first, /^\| R-0001 \|/m);
  assert.match(first, /^\| R-0002 \|/m);
  assert.ok(first.includes("| first |") && first.includes("| second |"), "titles are the only operator text in the view");

  const again = await register(repo, ["render"]);
  assert.equal(again.code, 0);
  assert.equal(readFileSync(path, "utf8"), first, "same projection ⇒ same bytes");
  assert.ok(!existsSync(join(stDir(repo), "register", "risk-register.md")), "the view is not written inside the managed register/ directory");
});

test("password=1234 in a title is redacted — on the add path and when the log itself carries the raw bytes", async () => {
  // Path 1: the CLI redacts on append; the render carries the redacted title.
  const repo = await seeded([["Leaked password=1234 in config", "p0"]]);
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = readFileSync(join(stDir(repo), "risk-register.md"), "utf8");
  assert.ok(!md.includes("password=1234"), md);
  assert.ok(md.includes("<REDACTED:password-assign>"), md);

  // Path 2: a log written behind the CLI's back with the raw title. Recovery
  // rebuilds the projection from it; the renderer must still redact (G-4).
  const [event] = readLog(repo);
  const raw = { ...event, payload: { ...event.payload, title: "Leaked password=1234 in config" } };
  writeFileSync(join(registerDir(repo), "events.jsonl"), `${canonical(raw).toString("utf8")}\n`);
  rmSync(join(registerDir(repo), "projection.json"));
  const r2 = await register(repo, ["render"]);
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.equal(readProjection(repo).rows["R-0001"].title, "Leaked password=1234 in config", "the rebuilt projection carries the raw title");
  const md2 = readFileSync(join(stDir(repo), "risk-register.md"), "utf8");
  assert.ok(!md2.includes("password=1234"), md2);
  assert.ok(md2.includes("<REDACTED:password-assign>"));
  assert.equal(md2, redactString(renderRegister(readProjection(repo))).text, "file = redactString(renderRegister(projection))");
});

test("--out: a path under <st>/ (cwd-relative) is honoured; outside G-5's writable prefixes ⇒ 2 USAGE; outside the work tree ⇒ 2 USAGE; nothing written", async () => {
  const repo = await seeded();
  const sub = join(repo, "sub");
  mkdirSync(sub);
  const r = await register(repo, ["render", "--out", ".agents/security-testing/views/register.md"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "RENDER .agents/security-testing/views/register.md rows=1 seq=1\n");
  assert.ok(existsSync(join(stDir(repo), "views", "register.md")));
  assert.ok(!existsSync(join(stDir(repo), "risk-register.md")), "--out replaces the default, not in addition");

  const reports = await register(repo, ["render", "--out", "reports/security/register.md"]);
  assert.equal(reports.code, 0, reports.stdout + reports.stderr);
  assert.ok(existsSync(join(repo, "reports", "security", "register.md")));

  const fromSub = await runScript("register", ["render", "--out", "../.agents/security-testing/from-sub.md"], { cwd: sub, env: ENV });
  assert.equal(fromSub.code, 0, fromSub.stdout + fromSub.stderr);
  assert.ok(existsSync(join(stDir(repo), "from-sub.md")), "a relative --out resolves against the invocation cwd");

  const readme = readFileSync(join(repo, "README.md"), "utf8");
  for (const out of ["README.md", "src/register.md", "docs/risk-register.md", ".agents/notes.md", "tasks/other/register.md"]) {
    const bad = await register(repo, ["render", "--out", out]);
    assert.equal(bad.code, 2, out);
    assert.match(bad.stdout, /^USAGE\(render: --out must be under /);
    if (out === "README.md") assert.equal(readFileSync(join(repo, out), "utf8"), readme, "a tracked file outside the prefixes is untouched");
    else assert.ok(!existsSync(join(repo, out)), `${out} was not written`);
  }
  const tasks = await register(repo, ["render", "--out", "tasks/security-web-admitted/register.md"]);
  assert.equal(tasks.code, 0, tasks.stdout + tasks.stderr);
  assert.ok(existsSync(join(repo, "tasks", "security-web-admitted", "register.md")));
  const outside = await register(repo, ["render", "--out", "../outside.md"]);
  assert.equal(outside.code, 2);
  assert.match(outside.stdout, /^USAGE\(render: cannot write /);
  assert.ok(!existsSync(join(repo, "..", "outside.md")));

  const positional = await register(repo, ["render", "extra"]);
  assert.equal(positional.code, 2);
  assert.match(positional.stdout, /^USAGE\(render: unexpected argument extra\)/);
});

test("render runs the recovery rule: a projection ahead of the log ⇒ 5 CORRUPT and no view is written", async () => {
  const repo = await seeded();
  const projection = readProjection(repo);
  writeFileSync(join(registerDir(repo), "projection.json"), canonical({ ...projection, seq: 7 }));
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 5, r.stdout + r.stderr);
  assert.equal(r.stdout, "CORRUPT\n");
  assert.ok(!existsSync(join(stDir(repo), "risk-register.md")));
});

test("render without engagement.md ⇒ 2 ENGAGEMENT-MISSING", async () => {
  const repo = initRepo();
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, "ENGAGEMENT-MISSING\n");
});

test("render on an empty register writes the empty view", async () => {
  const repo = repoWithEngagement();
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, `RENDER ${REL} rows=0 seq=0\n`);
  const md = readFileSync(join(stDir(repo), "risk-register.md"), "utf8");
  assert.match(md, /^# Risk register\n/);
  assert.ok(md.includes("None of these records is authenticated"));
});

test("the view reflects the projection after transitions: an accepted row lands in the approvals bucket and stays in exposure", async () => {
  const repo = await seeded([["a", "p1"], ["b", "p1"]]);
  const acc = await register(repo, ["accept", "R-0001", "--until", "2026-12-31", "--approved-by", "cto", "--approval-ref", "RISK-1"]);
  assert.equal(acc.code, 0, acc.stdout + acc.stderr);
  const r = await register(repo, ["render"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = readFileSync(join(stDir(repo), "risk-register.md"), "utf8");
  assert.match(md, /^\| R-0001 \| f{64} \| p1 \| accepted \|/m);
  assert.match(md, /^\| R-0001 \| acceptance \| cto \| RISK-1 \| 2026-12-31 \|/m);
  assert.ok(md.includes("| p1 | 2 |"), "both p1 rows stay in open exposure");
  assert.equal(readProjection(repo).rows["R-0001"].subject, FINDING);
  assert.equal(readProjection(repo).rows["R-0001"].first_seen_run, RUN);
});

test("register.mjs routes `render` to lib/cmd-register-render.mjs", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  assert.match(src, /^\s*render: \(\) => import\("\.\/lib\/cmd-register-render\.mjs"\),/m);
});

test("cmd-register-render.mjs writes only through fsx.writeAtomic and prints only through ctx.out", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "cmd-register-render.mjs"), "utf8");
  assert.match(src, /writeAtomic/);
  assert.doesNotMatch(src, /writeFileSync|console\.log|child_process/);
  assert.match(src, /redactString/);
});
