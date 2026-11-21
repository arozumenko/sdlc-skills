// The fast test set is "every test file, minus a short list of slow ones", so
// a new test file runs on every pull request without anyone listing it.
// These tests never run the suite itself: they check the selection only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOW, PR_AREAS, PR_GROUPS, MAIN_ONLY, discoverTests, testsMissedByDiscovery, selectFast, changedAreas, testsInArea, slowWithoutPullRequestRun } from "./fast-tests.mjs";

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

// discoverTests is a copy of one Node version's rules, and Node versions
// differ: newer ones also run TypeScript test files, older ones also walk dot
// directories. A file that some supported Node runs under `npm test` but that
// discoverTests does not select is in neither the fast set nor an area run, so
// no pull request would run it.
function assertNothingMissed(root) {
  const missed = testsMissedByDiscovery(root);
  assert.deepEqual(
    missed,
    [],
    `${missed.join(", ")}: this file would be run by \`node --test\` on some supported Node but is not in the fast or area sets: move it, or extend discoverTests in bin/fast-tests.mjs`,
  );
}

test("a TypeScript test or a test under a dot directory is caught as missed by discovery", () => {
  const root = tree([
    "a/one.test.mjs",
    "a/two.test.ts",
    "a/three.test.mts",
    "a/helper.ts",
    "t/test/four.cts",
    ".hidden/five.test.mjs",
    ".git/six.test.mjs",
    ".claude/worktrees/x/seven.test.mjs",
    "node_modules/pkg/eight.test.ts",
  ]);
  assert.deepEqual(discoverTests(root), ["a/one.test.mjs"]);
  assert.deepEqual(testsMissedByDiscovery(root), [".hidden/five.test.mjs", "a/three.test.mts", "a/two.test.ts", "t/test/four.cts"]);
  assert.throws(() => assertNothingMissed(root), /a\/two\.test\.ts.*would be run by `node --test` on some supported Node but is not in the fast or area sets: move it, or extend discoverTests/);
});

test("discovery misses no test file in this repository under the widest rule", () => {
  assertNothingMissed(REPO);
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
  assert.deepEqual(changedAreas(["README.md", "bin/init.mjs"], areas, {}), []);
  assert.deepEqual(changedAreas(["skills/delivery-monitor/scripts/lib/report.mjs", "README.md"], areas, {}), ["skills/delivery-monitor"]);
  assert.deepEqual(changedAreas(["hooks/agent-brief.sh", "skills/delivery-monitor/SKILL.md"], areas, {}), areas);
  assert.deepEqual(changedAreas(["hooks-old/x.sh", "skills/delivery-monitor-v2/SKILL.md"], areas, {}), []);
});

// Some tests guard code that lives in another directory. The installer (bin/)
// and the shared hooks (hooks/) are exercised by two install tests that sit
// under skills/delivery-monitor, so a pull request that changes bin/ or hooks/
// runs those two files as the extra entry "installer-integration".
const INSTALL_TESTS = ["skills/delivery-monitor/scripts/installed.test.mjs", "skills/delivery-monitor/scripts/install-hooks.test.mjs"];

test("a change under bin/ alone runs the installer-integration tests", () => {
  assert.deepEqual(changedAreas(["bin/init.mjs"]), ["installer-integration"]);
  assert.deepEqual(changedAreas(["bin/lib/doctor/git.mjs", "README.md"]), ["installer-integration"]);
});

test("a change under hooks/ alone runs the hooks area and the installer-integration tests", () => {
  assert.deepEqual(changedAreas(["hooks/agent-start.sh"]), ["hooks", "installer-integration"]);
});

test("bin/ plus delivery-monitor runs the delivery-monitor area only: it already covers both install tests", () => {
  assert.deepEqual(changedAreas(["bin/init.mjs", "skills/delivery-monitor/scripts/delivery.mjs"]), ["skills/delivery-monitor"]);
  assert.deepEqual(changedAreas(["hooks/agent-start.sh", "skills/delivery-monitor/SKILL.md"]), ["skills/delivery-monitor", "hooks"]);
});

test("an unrelated change runs nothing extra, and a name that only starts like bin or hooks does not count", () => {
  assert.deepEqual(changedAreas(["README.md", "docs/notes.md", "bundles/manual-qa/FACTORY.md"]), []);
  assert.deepEqual(changedAreas(["binary/x.mjs", "hooks-old/y.sh", "bin.md"]), []);
});

test("a group is added only when an area in the list does not already cover all of its files", () => {
  const groups = { extra: { when: ["src"], files: ["a/one.test.mjs", "b/two.test.mjs"] } };
  assert.deepEqual(changedAreas(["src/x.mjs"], ["a", "b"], groups), ["extra"]);
  assert.deepEqual(changedAreas(["src/x.mjs", "a/y.mjs"], ["a", "b"], groups), ["a", "extra"], "area a covers one of the two files only");
  assert.deepEqual(changedAreas(["src/x.mjs", "a/y.mjs", "b/z.mjs"], ["a", "b"], groups), ["a", "b"]);
  assert.deepEqual(changedAreas(["a/y.mjs"], ["a", "b"], groups), ["a"]);
});

test("every file a group names is an existing test file, and its trigger directories exist", () => {
  const all = discoverTests(REPO);
  assert.deepEqual(Object.keys(PR_GROUPS), ["installer-integration"]);
  assert.deepEqual(PR_GROUPS["installer-integration"].files, INSTALL_TESTS);
  for (const [name, group] of Object.entries(PR_GROUPS)) {
    assert.ok(!PR_AREAS.includes(name), `${name} is also a directory area`);
    assert.ok(group.files.length > 0, `${name} names no file`);
    for (const file of group.files) assert.ok(all.includes(file), `${name}: ${file} is not a test file in this repository`);
    for (const dir of group.when) assert.ok(existsSync(join(REPO, dir)), `${name}: trigger directory ${dir} does not exist`);
  }
});

test("an area run is every test file under that directory, slow ones included", () => {
  const root = tree(["a/one.test.mjs", "a/b/slow.test.mjs", "ab/other.test.mjs", "c/three.test.mjs"]);
  assert.deepEqual(testsInArea(root, "a"), ["a/b/slow.test.mjs", "a/one.test.mjs"]);
  const real = testsInArea(REPO, "hooks");
  assert.ok(real.includes("hooks/agent-brief.test.mjs") && SLOW.includes("hooks/agent-brief.test.mjs"));
});

test("--changed-areas reads changed paths on stdin and prints the areas as JSON", () => {
  const run = (input) => spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--changed-areas"], { input, encoding: "utf8" });
  const none = run("README.md\ndocs/notes.md\n");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout.trim(), "[]");
  const some = run("evals/run.mjs\nhooks/agent-start.sh\n");
  assert.deepEqual(JSON.parse(some.stdout), ["hooks", "evals", "installer-integration"]);
  assert.deepEqual(JSON.parse(run("bin/init.mjs\n").stdout), ["installer-integration"]);
});

test("--changed-areas reads NUL-separated paths, so a name git would quote still counts", () => {
  // Without -z, git prints a non-ASCII or odd name quoted and escaped
  // ("bin/\303\251.mjs"); the leading quote hid the path from its area.
  const run = (input) => spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--changed-areas"], { input, encoding: "utf8" });
  assert.deepEqual(JSON.parse(run("bin/\u00e9.mjs\0").stdout), ["installer-integration"]);
  assert.deepEqual(JSON.parse(run("README.md\0evals/a b.mjs\0hooks/tab\there.sh\0").stdout), ["hooks", "evals", "installer-integration"]);
  assert.equal(run("").stdout.trim(), "[]");
});

test("--area lists the files it would run, and refuses a directory that is not an area", () => {
  const list = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--area", "hooks", "--list"], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split("\n"), testsInArea(REPO, "hooks"));
  const bad = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--area", "bin", "--list"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not an area in PR_AREAS or a group in PR_GROUPS/);
});

test("--area installer-integration runs exactly the two install tests", () => {
  const r = spawnSync(process.execPath, [join(REPO, "bin/fast-tests.mjs"), "--area", "installer-integration", "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), INSTALL_TESTS);
});

test("the pull-request area workflow takes its areas from this script", () => {
  const yml = readFileSync(join(REPO, ".github/workflows/tests-areas.yml"), "utf8");
  assert.match(yml, /node bin\/fast-tests\.mjs --changed-areas/);
  assert.match(yml, /node bin\/fast-tests\.mjs --area /);
  // A file renamed out of an area must still count as a change to that area:
  // with rename detection the diff lists only the new path.
  // -z: NUL-separated and never quoted, whatever the file is called.
  assert.match(yml, /git diff --no-renames --name-only -z /);
});
