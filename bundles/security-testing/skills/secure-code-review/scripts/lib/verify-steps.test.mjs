import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { ALLOWED_EXECUTABLES, ArgvError, DEFAULT_TIMEOUT_S, DENIED_TOKENS, INLINE_SUPPRESS_RE, OUTPUT_LIMIT, TEST_SKIP_RE, boundOutput, checkArgv, minimalEnv, parseUnifiedDiff, runTests } from "./verify-steps.mjs";

const FIX = new URL("../fixtures/verify/", import.meta.url).pathname;

test("constants are the reference values", () => {
  assert.ok(ALLOWED_EXECUTABLES.includes("npm") && ALLOWED_EXECUTABLES.includes("node"));
  assert.deepEqual([...DENIED_TOKENS], ["-e", "--eval", "-c", "exec"]);
  assert.equal(DEFAULT_TIMEOUT_S, 600);
  assert.equal(OUTPUT_LIMIT, 64 * 1024);
  assert.ok(INLINE_SUPPRESS_RE.test("x = 1 // eslint-disable-line"));
  assert.ok(TEST_SKIP_RE.test("test.skip('a', () => {})"));
  assert.ok(!TEST_SKIP_RE.test("test('a', () => {})"));
});

test("checkArgv accepts an allowlisted runner and throws on a shell or an eval token", () => {
  assert.deepEqual(checkArgv(["npm", "test"]), ["npm", "test"]);
  assert.deepEqual(checkArgv(["node", "--test"]), ["node", "--test"]);
  assert.throws(() => checkArgv(["bash", "-c", "x"]), ArgvError);
  assert.throws(() => checkArgv(["bash", "-c", "x"]), /not on the allowlist/);
  assert.throws(() => checkArgv(["node", "-e", "x"]), /token -e is denied/);
  assert.throws(() => checkArgv(["npm", "run", "lint"]), /run without test/);
  assert.throws(() => checkArgv(["npm", "test;", "x"]), /contains ;/);
  assert.throws(() => checkArgv([]), /empty argv/);
  assert.throws(() => checkArgv("npm test"), /not an array/);
});

test("minimalEnv passes PATH/HOME/LANG only and pins TERM/CI/NO_COLOR", () => {
  const env = minimalEnv({ PATH: "/bin", HOME: "/h", LANG: "C", SECRET: "x", GIT_DIR: "/g" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h", LANG: "C", TERM: "dumb", CI: "1", NO_COLOR: "1" });
});

test("boundOutput keeps small output and bounds large output to whole lines around a marker", () => {
  assert.equal(boundOutput("ok\n"), "ok\n");
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const bounded = boundOutput(big);
  assert.ok(Buffer.byteLength(bounded) <= OUTPUT_LIMIT + 64, `${Buffer.byteLength(bounded)} bytes`);
  assert.match(bounded, /^line 0 x+\n/);
  assert.match(bounded, /\n\[\.\.\. \d+ bytes omitted \.\.\.\]\nline \d+ /);
  assert.match(bounded, /line 4999 x+$/);
});

test("parseUnifiedDiff reports added/removed lines with new-/old-side numbers per file", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "index 1111111..2222222 100644",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -3,3 +3,3 @@ export function safeName(name) {",
    " export function safeName(name) {",
    "-  return name;",
    "+  return basename(name); // eslint-disable-line",
    " }",
    "",
  ].join("\n");
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/app.js");
  assert.equal(files[0].oldPath, "src/app.js");
  assert.deepEqual(files[0].removed, [{ line: 4, text: "  return name;" }]);
  assert.deepEqual(files[0].added, [{ line: 4, text: "  return basename(name); // eslint-disable-line" }]);
  assert.deepEqual(parseUnifiedDiff(""), []);
  const del = ["diff --git a/x b/x", "deleted file mode 100644", "--- a/x", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b", ""].join("\n");
  const d = parseUnifiedDiff(del);
  assert.equal(d[0].path, null, "a deleted file has no new-side path");
  assert.equal(d[0].oldPath, "x");
  assert.equal(d[0].added.length, 0);
  assert.equal(d[0].removed.length, 2);
});

test("runTests spawns the argv with shell:false in root and reports exit, duration and output", () => {
  const r = runTests({ root: FIX, argv: ["node", join(FIX, "exit3.mjs")], timeout_s: 30 });
  assert.equal(r.exit, 3);
  assert.equal(typeof r.duration_ms, "number");
  assert.ok(r.duration_ms >= 0);
  assert.equal(typeof r.output, "string");
  const t = runTests({ root: FIX, argv: ["node", join(FIX, "sleep.mjs")], timeout_s: 1 });
  assert.equal(t.exit, null, "a timed-out run has no exit code");
  assert.equal(t.timed_out, true);
});
