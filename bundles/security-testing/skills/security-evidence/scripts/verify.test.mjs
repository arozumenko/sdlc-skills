import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("verify", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: verify\.mjs/m);
});

test("--help ⇒ exit 0", async () => {
  const r = await runScript("verify", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: verify\.mjs/m);
  assert.match(r.stdout, /all --finding <id> --base <oid> --head <oid>/);
  assert.match(r.stdout, /evaluate/);
});

test("unknown command ⇒ exit 2", async () => {
  const r = await runScript("verify", ["nope"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: verify\.mjs/m);
  assert.match(r.stderr, /unknown command "nope"/);
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
});
