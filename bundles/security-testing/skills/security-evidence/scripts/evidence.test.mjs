import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("evidence", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: evidence\.mjs/m);
  assert.equal(r.stderr, "");
});

test("--help ⇒ exit 0", async () => {
  const r = await runScript("evidence", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: evidence\.mjs/m);
  assert.match(r.stdout, /engagement init/);
  assert.match(r.stdout, /--root <dir>/);
  // --help wins wherever it sits and does not need a git work tree
  const late = await runScript("evidence", ["scope", "--run", "x", "--help"], { cwd: tmpDir() });
  assert.equal(late.code, 0);
});

test("unknown command ⇒ exit 2", async () => {
  const r = await runScript("evidence", ["frobnicate"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: evidence\.mjs/m);
  assert.match(r.stderr, /unknown command "frobnicate"/);
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "evidence.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/, "the entry script neither spawns nor touches the fs");
  assert.doesNotMatch(src, /\bfetch\(|node:http|node:net|node:dns/, "G-14");
});
