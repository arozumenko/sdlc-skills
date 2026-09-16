import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

const OK_MODEL = join(SCRIPTS_DIR, "fixtures", "schemas", "threat-model.ok.json");
const BAD_MODEL = join(SCRIPTS_DIR, "fixtures", "schemas", "threat-model.bad.json");

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("tm-lint", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: tm-lint\.mjs/m);
});

test("--help ⇒ exit 0", async () => {
  const r = await runScript("tm-lint", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /check --run <id> \[--model <path>\]/);
  assert.match(r.stdout, /render --run <id>/);
});

test("unknown command ⇒ exit 2", async () => {
  const r = await runScript("tm-lint", ["lint"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown command "lint"/);
});

test("check outside a git work tree ⇒ NOT-A-WORK-TREE, exit 2", async () => {
  const r = await runScript("tm-lint", ["check", "--run", "abc"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-A-WORK-TREE\n");
});

test("check without --run ⇒ usage error, exit 2", async () => {
  const r = await runScript("tm-lint", ["check"], { cwd: initRepo() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check: --run <id> is required\)$/m);
});

test("tm-lint check on a schema-invalid model ⇒ exit 2 naming the schema error before NOT-IMPLEMENTED", async () => {
  const repo = initRepo();
  const r = await runScript("tm-lint", ["check", "--run", "abc", "--model", BAD_MODEL], { cwd: repo });
  assert.equal(r.code, 2);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "SCHEMA-INVALID(threat-model: $.elements[0].id: does not match pattern ^E-[0-9]{3}$)");
  assert.equal(lines.includes("NOT-IMPLEMENTED(M2)"), false, "a schema error stops before NOT-IMPLEMENTED");
});

test("check on a schema-valid model ⇒ NOT-IMPLEMENTED(M2), exit 2 (M1 ships shape only)", async () => {
  const repo = initRepo();
  const r = await runScript("tm-lint", ["check", "--run", "abc", "--model", OK_MODEL], { cwd: repo });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-IMPLEMENTED(M2)\n");
});

test("check defaults --model to <st>/threat-model.json and validates it when present", async () => {
  const repo = initRepo();
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, "threat-model.json"), readFileSync(BAD_MODEL));
  const r = await runScript("tm-lint", ["check", "--run", "abc"], { cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^SCHEMA-INVALID\(threat-model: /m);
});

test("check on a model with a duplicate key ⇒ SCHEMA-INVALID naming the strict-reader error", async () => {
  const repo = initRepo();
  const model = join(repo, "dup.json");
  writeFileSync(model, '{"elements": [], "threats": [], "elements": []}');
  const r = await runScript("tm-lint", ["check", "--run", "abc", "--model", model], { cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^SCHEMA-INVALID\(threat-model: duplicate key "elements"/m);
});

test("check when the default <st>/threat-model.json is a directory ⇒ usage error, not an internal error", async () => {
  const repo = initRepo();
  mkdirSync(join(repo, ".agents", "security-testing", "threat-model.json"), { recursive: true });
  const r = await runScript("tm-lint", ["check", "--run", "abc"], { cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check: cannot read .*threat-model\.json\)$/m);
});

test("check with an unreadable --model ⇒ usage error", async () => {
  const repo = initRepo();
  const r = await runScript("tm-lint", ["check", "--run", "abc", "--model", "missing.json"], { cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check: cannot read missing\.json\)$/m);
});

test("render --run <id> ⇒ NOT-IMPLEMENTED(M2), exit 2; render without --run ⇒ usage error", async () => {
  const repo = initRepo();
  const ok = await runScript("tm-lint", ["render", "--run", "abc"], { cwd: repo });
  assert.equal(ok.code, 2);
  assert.equal(ok.stdout, "NOT-IMPLEMENTED(M2)\n");
  const bad = await runScript("tm-lint", ["render"], { cwd: repo });
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^USAGE\(render: --run <id> is required\)$/m);
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "tm-lint.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
});
