// The fast test set is "every test file, minus a short list of slow ones", so
// a new test file runs on every pull request without anyone listing it.
// These tests never run the suite itself: they check the selection only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOW, discoverTests, selectFast } from "./fast-tests.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "fast-tests-"));
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), "");
  }
  return root;
}

test("discovery finds what `node --test` finds: test-named files, not helpers, dot dirs or node_modules", () => {
  const root = tree([
    "a/one.test.mjs",
    "a/b/two.test.mjs",
    "a/helper.mjs",
    "a/notes.test.md",
    "c/test-three.mjs",
    "c/four_test.js",
    "c/five-test.cjs",
    "d/test/six.mjs",
    "d/test/fixture.js.tpl",
    "node_modules/pkg/seven.test.mjs",
    ".hidden/eight.test.mjs",
  ]);
  assert.deepEqual(discoverTests(root), [
    "a/b/two.test.mjs",
    "a/one.test.mjs",
    "c/five-test.cjs",
    "c/four_test.js",
    "c/test-three.mjs",
    "d/test/six.mjs",
  ]);
});

test("a new test file is in the fast set without being listed anywhere", () => {
  const root = tree(["a/slow.test.mjs", "a/old.test.mjs"]);
  const before = selectFast(root, ["a/slow.test.mjs"]);
  assert.deepEqual(before, { fast: ["a/old.test.mjs"], stale: [] });
  writeFileSync(join(root, "a/new.test.mjs"), "");
  assert.deepEqual(selectFast(root, ["a/slow.test.mjs"]).fast, ["a/new.test.mjs", "a/old.test.mjs"]);
});

test("an exclude entry that matches no test file is reported as stale", () => {
  const root = tree(["a/one.test.mjs"]);
  assert.deepEqual(selectFast(root, ["a/renamed-away.test.mjs"]), {
    fast: ["a/one.test.mjs"],
    stale: ["a/renamed-away.test.mjs"],
  });
});

test("the real exclude list has no stale entry and leaves most test files in the fast set", () => {
  const all = discoverTests(REPO);
  const { fast, stale } = selectFast(REPO, SLOW);
  assert.deepEqual(stale, [], "every SLOW entry must be an existing test file");
  assert.equal(fast.length, all.length - SLOW.length);
  assert.ok(fast.length > all.length * 0.8, `fast set is ${fast.length} of ${all.length} files`);
  assert.ok(fast.includes("bin/fast-tests.test.mjs"));
});

test("--list prints the fast set and runs nothing", () => {
  const r = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), selectFast(REPO, SLOW).fast);
});
