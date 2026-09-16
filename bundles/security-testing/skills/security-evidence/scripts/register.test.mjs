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
