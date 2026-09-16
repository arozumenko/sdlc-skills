// tm-lint.mjs — the entry script's shape (TASK-006; usage, --help, unknown
// command, work-tree refusal, argv contract of both subcommands). The
// behaviour of `check` and `render` is lib/cmd-tm-lint.test.mjs's (TASK-039);
// what this file pins is that the dispatcher stays thin and the argv rules
// the M1 stub set are still the ones the real commands enforce.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

const RUN = `${"0".repeat(12)}-0001`;

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("tm-lint", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: tm-lint\.mjs/m);
});

test("--help ⇒ exit 0; the usage names both commands and every exit class", async () => {
  const r = await runScript("tm-lint", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /check --run <id> \[--model <path>\]/);
  assert.match(r.stdout, /render --run <id>/);
  assert.match(r.stdout, /4 TM-INVALID\(<threat\|element>: <reason>\)/);
  assert.doesNotMatch(r.stdout, /NOT-IMPLEMENTED|SCHEMA-INVALID/, "the M1 stub's tokens are gone");
});

test("unknown command ⇒ exit 2", async () => {
  const r = await runScript("tm-lint", ["lint"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown command "lint"/);
});

test("check outside a git work tree ⇒ NOT-A-WORK-TREE, exit 2", async () => {
  const r = await runScript("tm-lint", ["check", "--run", RUN], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-A-WORK-TREE\n");
});

test("check / render without --run ⇒ usage error, exit 2; a positional argument is refused", async () => {
  const repo = initRepo();
  for (const command of ["check", "render"]) {
    const r = await runScript("tm-lint", [command], { cwd: repo });
    assert.equal(r.code, 2);
    assert.match(r.stdout, new RegExp(`^USAGE\\(${command}: --run <id> is required\\)$`, "m"));
    const extra = await runScript("tm-lint", [command, "--run", RUN, "stray"], { cwd: repo });
    assert.equal(extra.code, 2);
    assert.match(extra.stdout, new RegExp(`^USAGE\\(${command}: unexpected argument stray\\)$`, "m"));
  }
});

test("check with an unreadable --model ⇒ usage error naming the path the user typed; a directory in place of the default model ⇒ the same", async () => {
  const repo = initRepo();
  // the run is resolved before the model, so an unknown run is what a bare repo reports
  const unknown = await runScript("tm-lint", ["check", "--run", RUN, "--model", "missing.json"], { cwd: repo });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(check: unknown run 000000000000-0001\)$/m);
  mkdirSync(join(repo, ".agents", "security-testing", "threat-model.json"), { recursive: true });
  const dir = await runScript("tm-lint", ["check", "--run", RUN], { cwd: repo });
  assert.equal(dir.code, 2);
  assert.match(dir.stdout, /^USAGE\(check: unknown run /m);
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "tm-lint.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
  assert.match(src, /\.\/lib\/cmd-tm-lint\.mjs/);
});
