// The fast test set is "every test file, minus a short list of slow ones", so
// a new test file runs on every pull request without anyone listing it.
// These tests never run the suite itself: they check the selection only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOW, PR_AREAS, MAIN_ONLY, discoverTests, selectFast, changedAreas, testsInArea, slowWithoutPullRequestRun } from "./fast-tests.mjs";

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

// The script once decided "am I the entry point" by comparing a file URL with
// a raw path. They differ when the path has a space (the URL encodes it) or
// when the script is reached through a symlink, and then it ran nothing and
// exited 0: a green run with no tests.
test("the script runs when it is started through a symlink in a directory with a space", () => {
  const dir = mkdtempSync(join(tmpdir(), "fast tests "));
  const link = join(dir, "linked fast-tests.mjs");
  symlinkSync(join(REPO, "bin/fast-tests.mjs"), link);
  const r = spawnSync(process.execPath, [link, "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), selectFast(REPO, SLOW).fast);
});

test("a copy in a checkout whose path has a space lists and runs its tests: a failing test fails the run", () => {
  const root = mkdtempSync(join(tmpdir(), "fast tests "));
  for (const f of [...SLOW, "a/failing.test.mjs", "bin/fast-tests.mjs"]) mkdirSync(dirname(join(root, f)), { recursive: true });
  for (const f of SLOW) writeFileSync(join(root, f), "");
  writeFileSync(join(root, "a/failing.test.mjs"), 'import { test } from "node:test";\ntest("fails on purpose", () => { throw new Error("ran"); });\n');
  copyFileSync(join(REPO, "bin/fast-tests.mjs"), join(root, "bin/fast-tests.mjs"));
  const script = join(root, "bin/fast-tests.mjs");
  const list = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8" });
  assert.equal(list.stdout.trim(), "a/failing.test.mjs", list.stderr);
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(run.status, 1, "the failing test must fail the run");
  assert.match(run.stdout, /fails on purpose/);
});

// A file in SLOW is not in the fast set, so a pull request would not run it at
// all. PR_AREAS closes that: a pull request that changes a file under one of
// those directories runs every test in it (.github/workflows/tests-areas.yml).
test("a slow file outside every area and off the main-only list is reported", () => {
  const slow = ["a/x/slow.test.mjs", "b/slow.test.mjs", "c/slow.test.mjs", "ab/slow.test.mjs"];
  assert.deepEqual(slowWithoutPullRequestRun(slow, ["a"], { "b/slow.test.mjs": "needs the network" }), [
    "c/slow.test.mjs",
    "ab/slow.test.mjs",
  ]);
  assert.deepEqual(slowWithoutPullRequestRun(slow, ["a"], { "b/slow.test.mjs": "" }).includes("b/slow.test.mjs"), true, "a main-only entry needs a reason");
});

test("every SLOW file runs on pull requests to its area, or is main-only with a reason", () => {
  const uncovered = slowWithoutPullRequestRun(SLOW, PR_AREAS, MAIN_ONLY);
  assert.deepEqual(uncovered, [], `add an area to PR_AREAS, or a reason to MAIN_ONLY, for: ${uncovered.join(", ")}`);
  for (const file of Object.keys(MAIN_ONLY)) assert.ok(SLOW.includes(file), `${file} is main-only but not in SLOW`);
  for (const area of PR_AREAS) assert.ok(testsInArea(REPO, area).length > 0, `${area} holds no test file`);
});

test("changed files select their areas, by directory and not by name prefix", () => {
  const areas = ["hooks", "skills/delivery-monitor"];
  assert.deepEqual(changedAreas(["README.md", "bin/init.mjs"], areas), []);
  assert.deepEqual(changedAreas(["skills/delivery-monitor/scripts/lib/report.mjs", "README.md"], areas), ["skills/delivery-monitor"]);
  assert.deepEqual(changedAreas(["hooks/agent-brief.sh", "skills/delivery-monitor/SKILL.md"], areas), areas);
  assert.deepEqual(changedAreas(["hooks-old/x.sh", "skills/delivery-monitor-v2/SKILL.md"], areas), []);
});

test("an area run is every test file under that directory, slow ones included", () => {
  const root = tree(["a/one.test.mjs", "a/b/slow.test.mjs", "ab/other.test.mjs", "c/three.test.mjs"]);
  assert.deepEqual(testsInArea(root, "a"), ["a/b/slow.test.mjs", "a/one.test.mjs"]);
  const real = testsInArea(REPO, "hooks");
  assert.ok(real.includes("hooks/agent-brief.test.mjs") && SLOW.includes("hooks/agent-brief.test.mjs"));
});

test("--changed-areas reads changed paths on stdin and prints the areas as JSON", () => {
  const run = (input) => spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--changed-areas"], { input, encoding: "utf8" });
  const none = run("README.md\nbin/init.mjs\n");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout.trim(), "[]");
  const some = run("evals/run.mjs\nhooks/agent-start.sh\n");
  assert.deepEqual(JSON.parse(some.stdout), ["hooks", "evals"]);
});

test("--area lists the files it would run, and refuses a directory that is not an area", () => {
  const list = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--area", "hooks", "--list"], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split("\n"), testsInArea(REPO, "hooks"));
  const bad = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--area", "bin", "--list"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not an area in PR_AREAS/);
});

test("the pull-request area workflow takes its areas from this script", () => {
  const yml = readFileSync(join(REPO, ".github/workflows/tests-areas.yml"), "utf8");
  assert.match(yml, /node bin\/fast-tests\.mjs --changed-areas/);
  assert.match(yml, /node bin\/fast-tests\.mjs --area /);
});
