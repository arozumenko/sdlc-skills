// TASK-027 — lib/verify-steps.mjs: the six I/O steps of `verify.mjs all`
// (spec §6.4 steps 1–6, plan §4.2 / §5 TASK-027, TL-12), each exercised on
// its own against the fixture repo (fixtures/repo/build.mjs). The command
// that strings them together is cmd-verify-all.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, hmacHex, sha256Hex } from "../canon.mjs";
import { git, cleanupAll, tmpDir } from "../fixtures/cli/harness.mjs";
import { ctxFor } from "../fixtures/ingest/setup.mjs";
import { DB_FIXED, DB_STILL_VULNERABLE, FINDING_PATH, HELPER_SKIP, buildRepo, commit } from "../fixtures/repo/build.mjs";
import { revParse } from "./git.mjs";
import {
  ALLOWED_EXECUTABLES,
  DEFAULT_TIMEOUT_S,
  OUTPUT_LIMIT,
  boundOutput,
  branchStep,
  checkArgv,
  indicatorId,
  installStep,
  parseUnifiedDiff,
  removeWorktree,
  resolveExecutable,
  suppressionStep,
  testedTreeHmac,
  testsStep,
  worktreeStep,
} from "./verify-steps.mjs";

after(cleanupAll);

const HEX64 = /^[0-9a-f]{64}$/;
const quiet = () => {};
const keyOf = (repo) => ctxFor(repo).key().bytes;

// --- step 1: branch ---------------------------------------------------------------

test("branchStep: COMMITTED when base is an ancestor of head and the finding's path changed; PATH-UNTOUCHED when only other files changed; NOT-COMMITTED when head does not descend from base", () => {
  const { repo, base } = buildRepo();
  const untouched = commit(repo, { "README.md": "# changed\n" }, "docs only");
  assert.equal(branchStep(repo, { base_oid: base, head_oid: untouched, path: FINDING_PATH }), "PATH-UNTOUCHED");
  const fixed = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  assert.equal(branchStep(repo, { base_oid: base, head_oid: fixed, path: FINDING_PATH }), "COMMITTED");
  assert.equal(branchStep(repo, { base_oid: base, head_oid: base, path: FINDING_PATH }), "PATH-UNTOUCHED", "head == base touches nothing");
  // a sibling commit: from base, another line of history that never contains `fixed`
  git(repo, ["checkout", "-q", "-b", "sibling", base]);
  const sibling = commit(repo, { [FINDING_PATH]: DB_STILL_VULNERABLE }, "sibling");
  assert.equal(branchStep(repo, { base_oid: fixed, head_oid: sibling, path: FINDING_PATH }), "NOT-COMMITTED");
  git(repo, ["checkout", "-q", "main"]);
});

// --- step 5 argv rules (pure) ----------------------------------------------------

test("checkArgv: the §4.2 allowlist and deny rules", () => {
  assert.deepEqual(ALLOWED_EXECUTABLES, ["npm", "npx", "pnpm", "yarn", "node", "python", "python3", "pytest", "go", "cargo", "mvn", "./gradlew", "gradle", "make", "dotnet"]);
  assert.equal(checkArgv(["npm", "test"]).ok, true);
  assert.equal(checkArgv(["npm", "run", "test"]).ok, true);
  assert.equal(checkArgv(["npm", "run-script", "test"]).ok, true);
  assert.equal(checkArgv(["node", "test-runner.mjs"]).ok, true);
  assert.equal(checkArgv(["./gradlew", "test"]).ok, true);
  assert.equal(checkArgv(["pytest", "-q", "tests/"]).ok, true);
  for (const [argv, why] of [
    [[], /empty/],
    [["bash", "-c", "npm test"], /allowlist/],
    [["sh", "test.sh"], /allowlist/],
    [["/usr/bin/node", "x.mjs"], /allowlist/],
    [["node", "-e", "process.exit(0)"], /-e/],
    [["node", "--eval", "1"], /--eval/],
    [["python", "-c", "print(1)"], /-c/],
    [["npm", "exec", "something"], /exec/],
    [["npm", "run", "lint"], /run/],
    [["pnpm", "run-script", "build"], /run-script/],
    [["npm", "run"], /run/],
    [["npm", "test;", "rm"], /;/],
    [["npm", "test", "|", "tee"], /\|/],
    [["npm", "test", "&&", "x"], /&/],
    [["node", "$HOME/x.mjs"], /\$/],
    [["node", "a<b"], /</],
    [["node", "a>b"], />/],
    [["node", "`x`"], /`/],
    [["node", "x\ny"], /newline/],
    [["node", 1], /string/],
  ]) {
    const r = checkArgv(argv);
    assert.equal(r.ok, false, JSON.stringify(argv));
    assert.match(r.reason, why, JSON.stringify(argv));
  }
});

test("resolveExecutable: a bare name is searched on the scripts' own PATH (never the worktree), a ./ token resolves inside the worktree; the file's sha256 is recorded", () => {
  const cwd = tmpDir();
  const node = resolveExecutable("node", { cwd, path: process.env.PATH });
  assert.ok(node, "node is on PATH");
  assert.ok(node.path.startsWith("/"), node.path);
  assert.match(node.sha256, HEX64);
  assert.equal(node.sha256, sha256Hex(readFileSync(node.path)));
  assert.equal(resolveExecutable("definitely-not-a-program-xyz", { cwd, path: process.env.PATH }), null);
  // a name that only exists as a file in the worktree is not found: no `.` on the search path
  writeFileSync(join(cwd, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const found = resolveExecutable("npm", { cwd, path: "/nonexistent-bin-dir" });
  assert.equal(found, null);
  writeFileSync(join(cwd, "gradlew"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const gradlew = resolveExecutable("./gradlew", { cwd, path: "/nonexistent-bin-dir" });
  assert.equal(gradlew.path, join(cwd, "gradlew"));
  assert.equal(gradlew.sha256, sha256Hex(readFileSync(join(cwd, "gradlew"))));
});

// --- step 2: worktree -------------------------------------------------------------

test("worktreeStep: a detached checkout of head under the OS temp dir; tree_before is head's tree; a dirty file in the main tree is absent from it; removeWorktree cleans up", () => {
  const { repo, base } = buildRepo();
  const head = commit(repo, { [FINDING_PATH]: DB_FIXED }, "fix");
  writeFileSync(join(repo, "test-helper.mjs"), HELPER_SKIP); // dirty main tree
  const wt = worktreeStep(repo, head);
  try {
    assert.ok(wt.dir.startsWith(wt.tmp), "the checkout lives inside its own temp dir");
    assert.equal(revParse(wt.dir, "HEAD"), head);
    assert.equal(wt.tree_before, git(repo, ["rev-parse", `${head}^{tree}`]));
    assert.notEqual(wt.tree_before, git(repo, ["rev-parse", `${base}^{tree}`]));
    assert.equal(readFileSync(join(wt.dir, "test-helper.mjs"), "utf8"), "export const skip = false;\n", "the worktree has head's helper, not the dirty one");
    assert.equal(readFileSync(join(wt.dir, FINDING_PATH), "utf8"), DB_FIXED);
    assert.equal(git(wt.dir, ["status", "--porcelain"]), "", "clean");
  } finally {
    removeWorktree(repo, wt, quiet);
  }
  assert.equal(existsSync(wt.tmp), false);
  assert.doesNotMatch(git(repo, ["worktree", "list"]), /wt/);
  assert.equal(readFileSync(join(repo, "test-helper.mjs"), "utf8"), HELPER_SKIP, "the main tree is untouched");
});

// --- step 3: install --------------------------------------------------------------

async function withWorktree(repo, head, fn) {
  const wt = worktreeStep(repo, head);
  try {
    return await fn(wt);
  } finally {
    removeWorktree(repo, wt, quiet);
  }
}

test("installStep: no install record ⇒ ran:false, tested_tree same-as-head, nothing spawned", async () => {
  const { repo } = buildRepo();
  const head = revParse(repo, "HEAD");
  await withWorktree(repo, head, async (wt) => {
    const r = await installStep({ wt: wt.dir, root: repo, head_oid: head, key: keyOf(repo), install: undefined, env: process.env, log: quiet });
    assert.deepEqual(r.install, { ran: false, allow_tracked_changes: false, tracked_changes: [], untracked_count: 0, untracked_bytes: 0 });
    assert.equal(r.tested_tree, "same-as-head");
    assert.equal(r.tests, undefined);
  });
});

test("installStep: an install that only creates dependencies ⇒ tracked_changes [], untracked count + bytes recorded, tested_tree same-as-head", async () => {
  const { repo } = buildRepo();
  const head = revParse(repo, "HEAD");
  await withWorktree(repo, head, async (wt) => {
    const r = await installStep({ wt: wt.dir, root: repo, head_oid: head, key: keyOf(repo), install: { argv: ["node", "install.mjs"] }, env: process.env, log: quiet });
    assert.equal(r.install.ran, true);
    assert.equal(r.install.allow_tracked_changes, false);
    assert.deepEqual(r.install.tracked_changes, []);
    assert.equal(r.install.untracked_count, 2, "node_modules/dep/index.js + package.json");
    const bytes = statSync(join(wt.dir, "node_modules/dep/index.js")).size + statSync(join(wt.dir, "node_modules/dep/package.json")).size;
    assert.equal(r.install.untracked_bytes, bytes);
    assert.equal(r.install.argv_sha256, sha256Hex(canonical(["node", "install.mjs"])));
    assert.equal(r.tested_tree, "same-as-head");
    assert.equal(r.tests, undefined);
  });
});

test("installStep: install modifying a tracked helper ⇒ TESTS_INDETERMINATE(install-modified-tree) (spec §12); with allow_tracked_changes ⇒ tested_tree = HMAC over every tracked file after install", async () => {
  const { repo } = buildRepo();
  const head = revParse(repo, "HEAD");
  const key = keyOf(repo);
  await withWorktree(repo, head, async (wt) => {
    const r = await installStep({ wt: wt.dir, root: repo, head_oid: head, key, install: { argv: ["node", "install-edit.mjs"] }, env: process.env, log: quiet });
    assert.deepEqual(r.install.tracked_changes, ["test-helper.mjs"]);
    assert.equal(r.install.ran, true);
    assert.equal(r.tested_tree, "same-as-head", "no derived tree is named when the change is not allowed");
    assert.equal(r.tests.result, "TESTS_INDETERMINATE");
    assert.equal(r.tests.reason, "install-modified-tree");
    assert.equal(r.tests.timed_out, false);
    assert.equal(r.tests.output_redacted, "");
  });
  let first;
  await withWorktree(repo, head, async (wt) => {
    const r = await installStep({ wt: wt.dir, root: repo, head_oid: head, key, install: { argv: ["node", "install-edit.mjs"], allow_tracked_changes: true }, env: process.env, log: quiet });
    assert.deepEqual(r.install.tracked_changes, ["test-helper.mjs"]);
    assert.equal(r.install.allow_tracked_changes, true);
    assert.match(r.tested_tree, HEX64);
    assert.equal(r.tests, undefined, "tests may run");
    // the recorded value is HMAC_key over sorted "path\0hmac\n" of every tracked file's working bytes (G-2: keyed, never plain)
    const tracked = git(wt.dir, ["ls-files"]).split("\n").filter(Boolean);
    const entries = tracked.map((p) => ({ path: p, hmac: hmacHex(key, readFileSync(join(wt.dir, p))) }));
    assert.equal(r.tested_tree, testedTreeHmac(key, entries));
    first = r.tested_tree;
  });
  await withWorktree(repo, head, async (wt) => {
    const r = await installStep({ wt: wt.dir, root: repo, head_oid: head, key, install: { argv: ["node", "install-edit.mjs"], allow_tracked_changes: true }, env: process.env, log: quiet });
    assert.equal(r.tested_tree, first, "deterministic for the same resulting tree");
  });
});

test("installStep: a failing or denied install argv ⇒ TESTS_INDETERMINATE with the reason; argv never runs when denied", async () => {
  const { repo } = buildRepo();
  const head = revParse(repo, "HEAD");
  await withWorktree(repo, head, async (wt) => {
    const failing = await installStep({ wt: wt.dir, root: repo, head_oid: head, key: keyOf(repo), install: { argv: ["node", "no-such-install.mjs"] }, env: process.env, log: quiet });
    assert.equal(failing.install.ran, true);
    assert.equal(failing.tests.result, "TESTS_INDETERMINATE");
    assert.equal(failing.tests.reason, "install-failed");
    const denied = await installStep({ wt: wt.dir, root: repo, head_oid: head, key: keyOf(repo), install: { argv: ["sh", "install.sh"] }, env: process.env, log: quiet });
    assert.equal(denied.install.ran, false);
    assert.equal(denied.tests.result, "TESTS_INDETERMINATE");
    assert.match(denied.tests.reason, /^install-argv-rejected/);
    assert.equal(existsSync(join(wt.dir, "node_modules")), false);
  });
});

// --- step 4: suppression ----------------------------------------------------------

test("parseUnifiedDiff: added and removed lines with their line numbers per file; new, deleted and binary files", () => {
  const text = [
    "diff --git a/.semgrepignore b/.semgrepignore",
    "index 1..2 100644",
    "--- a/.semgrepignore",
    "+++ b/.semgrepignore",
    "@@ -1 +1,2 @@",
    " vendor/",
    "+src/db.js",
    "diff --git a/src/old.js b/src/old.js",
    "deleted file mode 100644",
    "--- a/src/old.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-a();",
    "-b();",
    "diff --git a/src/new.js b/src/new.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/new.js",
    "@@ -0,0 +1 @@",
    "+// eslint-disable",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    "diff --git a/src/x.js b/src/x.js",
    "--- a/src/x.js",
    "+++ b/src/x.js",
    "@@ -3,4 +3,4 @@ function f() {",
    " keep",
    "-old line",
    "+new line",
    " keep2",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  const files = parseUnifiedDiff(text);
  assert.deepEqual(files, [
    { path: ".semgrepignore", oldPath: ".semgrepignore", added: [{ line: 2, text: "src/db.js" }], removed: [] },
    { path: null, oldPath: "src/old.js", added: [], removed: [{ line: 1, text: "a();" }, { line: 2, text: "b();" }] },
    { path: "src/new.js", oldPath: null, added: [{ line: 1, text: "// eslint-disable" }], removed: [] },
    { path: "logo.png", oldPath: "logo.png", added: [], removed: [], binary: true },
    { path: "src/x.js", oldPath: "src/x.js", added: [{ line: 4, text: "new line" }], removed: [{ line: 4, text: "old line" }] },
  ]);
  assert.deepEqual(parseUnifiedDiff(""), []);
});

test("indicatorId: sha256(kind\\0path\\0line); a line matching a redaction rule ⇒ HMAC_key over the redacted line and sensitive:true (§6.5)", () => {
  const key = Buffer.alloc(32, 7);
  const plain = indicatorId(key, { kind: "inline-suppress", path: "src/db.js", line: "  q(); // nosemgrep" });
  assert.deepEqual(plain, { id: sha256Hex(Buffer.from("inline-suppress\0src/db.js\0  q(); // nosemgrep", "utf8")), sensitive: false });
  const secret = indicatorId(key, { kind: "inline-suppress", path: "src/db.js", line: "const password = 'hunter2'; // nosec" });
  assert.equal(secret.sensitive, true);
  assert.match(secret.id, HEX64);
  assert.equal(secret.id, hmacHex(key, Buffer.from("inline-suppress\0src/db.js\0const <REDACTED:password-assign>; // nosec", "utf8")));
  assert.notEqual(secret.id, sha256Hex(Buffer.from("inline-suppress\0src/db.js\0const password = 'hunter2'; // nosec", "utf8")), "never a plain hash over protected content (G-2)");
});

test("suppressionStep over the whole base..head diff: an ignore file edited outside the finding path ⇒ ignore-file-edit; nosemgrep / it.skip additions ⇒ inline-suppress / test-skip; deletion-only change to the cited range ⇒ deletion_only (AC-4, TL-12)", () => {
  const { repo, base } = buildRepo();
  const key = keyOf(repo);
  const head = commit(
    repo,
    {
      ".semgrepignore": "vendor/\nsrc/db.js\n",
      [FINDING_PATH]: ['import { pool } from "./pool.js";', "", "export function find(req) {", '  const q = "SELECT * FROM users WHERE id = " + req.query.id; // nosemgrep: sqli', "  return pool.query(q);", "}", ""].join("\n"),
      "src/db.test.js": "it.skip('rejects unparameterised input', () => {});\n",
      "eslint.config.js": "export default [];\n",
    },
    "suppress everything",
  );
  const r = suppressionStep(repo, { base_oid: base, head_oid: head, path: FINDING_PATH, ranges: [[3, 4]], key });
  assert.equal(r.deletion_only, false);
  const kinds = r.indicators.map((i) => [i.kind, i.path, i.line]);
  assert.deepEqual(kinds, [
    ["ignore-file-edit", ".semgrepignore", 2],
    ["ignore-file-edit", "eslint.config.js", 1],
    ["inline-suppress", "src/db.js", 4],
    ["test-skip", "src/db.test.js", 1],
  ]);
  for (const i of r.indicators) {
    assert.match(i.id, HEX64);
    assert.deepEqual(Object.keys(i), ["id", "kind", "path", "line"], "no `sensitive` key on a plain indicator");
  }
  assert.equal(r.indicators[0].id, sha256Hex(Buffer.from("ignore-file-edit\0.semgrepignore\0src/db.js", "utf8")));
  assert.equal(r.indicators[2].id, sha256Hex(Buffer.from('inline-suppress\0src/db.js\0  const q = "SELECT * FROM users WHERE id = " + req.query.id; // nosemgrep: sqli', "utf8")));

  // each variant below is a sibling of `base` (detached commit), so every diff is exactly base..variant
  const variant = (files, message) => {
    git(repo, ["checkout", "-q", "--detach", base]);
    const oid = commit(repo, files, message);
    git(repo, ["checkout", "-q", "main"]);
    return oid;
  };
  // deletion-only: the cited lines (normalised 3–4 = raw 4–5) are removed and nothing is added to the file
  const deleted = variant({ [FINDING_PATH]: ['import { pool } from "./pool.js";', "", "export function find(req) {", "}", ""].join("\n") }, "delete the sink");
  const d = suppressionStep(repo, { base_oid: base, head_oid: deleted, path: FINDING_PATH, ranges: [[3, 4]], key });
  assert.equal(d.deletion_only, true);
  assert.deepEqual(d.indicators, []);
  // a real fix removes and adds ⇒ not deletion-only
  const fixed = variant({ [FINDING_PATH]: DB_FIXED }, "fix");
  assert.equal(suppressionStep(repo, { base_oid: base, head_oid: fixed, path: FINDING_PATH, ranges: [[3, 4]], key }).deletion_only, false);
  // removing lines OUTSIDE the cited range only (raw line 1, the import) is not deletion-only for this finding
  const other = variant({ [FINDING_PATH]: ["", "export function find(req) {", '  const q = "SELECT * FROM users WHERE id = " + req.query.id;', "  return pool.query(q);", "}", ""].join("\n") }, "drop the import");
  assert.equal(suppressionStep(repo, { base_oid: base, head_oid: other, path: FINDING_PATH, ranges: [[3, 4]], key }).deletion_only, false);
  // deleting the whole file is deletion-only
  const gone = variant({ [FINDING_PATH]: null }, "delete the file");
  assert.equal(suppressionStep(repo, { base_oid: base, head_oid: gone, path: FINDING_PATH, ranges: [[3, 4]], key }).deletion_only, true);
  // a sensitive suppression line ⇒ keyed id + sensitive: true
  const sensitive = variant({ [FINDING_PATH]: DB_FIXED, "src/cfg.js": "const password = 'hunter2'; // nosec\n" }, "sensitive");
  const s = suppressionStep(repo, { base_oid: base, head_oid: sensitive, path: FINDING_PATH, ranges: [[3, 4]], key });
  assert.deepEqual(s.indicators.map((i) => i.path), ["src/cfg.js"]);
  const ind = s.indicators[0];
  assert.equal(ind.sensitive, true);
  assert.equal(ind.id, hmacHex(key, Buffer.from("inline-suppress\0src/cfg.js\0const <REDACTED:password-assign>; // nosec", "utf8")));
});

// --- step 5: tests ----------------------------------------------------------------

test("testsStep: TESTS_PASS / TESTS_FAIL from the exit code; argv hash, resolved executable path + sha256, bounded redacted output; the child sees only the minimal env", async () => {
  const { repo } = buildRepo();
  const fixed = commit(repo, { [FINDING_PATH]: DB_FIXED, "env.mjs": 'process.stdout.write(Object.keys(process.env).sort().join(",") + "\\n"); process.stdout.write("password=hunter2\\n");\n' }, "fix");
  await withWorktree(repo, fixed, async (wt) => {
    const pass = await testsStep({ wt: wt.dir, argv: ["node", "test-runner.mjs"], timeout_s: 60, key: keyOf(repo), env: process.env, log: quiet });
    assert.equal(pass.result, "TESTS_PASS");
    assert.equal(pass.exit_code, 0);
    assert.equal(pass.timed_out, false);
    assert.equal(pass.argv_sha256, sha256Hex(canonical(["node", "test-runner.mjs"])));
    assert.ok(pass.executable_path.startsWith("/"), pass.executable_path);
    assert.equal(pass.executable_sha256, sha256Hex(readFileSync(pass.executable_path)));
    assert.equal(pass.output_redacted, "1 passing\n");
    assert.equal(pass.reason, undefined);
    const env = await testsStep({ wt: wt.dir, argv: ["node", "env.mjs"], timeout_s: 60, key: keyOf(repo), env: { ...process.env, SECRET_FROM_PARENT: "x" }, log: quiet });
    assert.equal(env.result, "TESTS_PASS");
    const [keys, secret] = env.output_redacted.split("\n");
    // __CF_USER_TEXT_ENCODING is injected by macOS libc at exec, not by the parent's environment
    assert.deepEqual(keys.split(",").filter((k) => k !== "__CF_USER_TEXT_ENCODING"), ["CI", "HOME", "LANG", "NO_COLOR", "PATH", "TERM"].filter((k) => k !== "LANG" || typeof process.env.LANG === "string"));
    assert.equal(secret, "<REDACTED:password-assign>");
  });
  const still = commit(repo, { [FINDING_PATH]: DB_STILL_VULNERABLE }, "still vulnerable");
  await withWorktree(repo, still, async (wt) => {
    const fail = await testsStep({ wt: wt.dir, argv: ["node", "test-runner.mjs"], timeout_s: 60, key: keyOf(repo), env: process.env, log: quiet });
    assert.equal(fail.result, "TESTS_FAIL");
    assert.equal(fail.exit_code, 1);
    assert.equal(fail.output_redacted, "1 failing: sql is string-built\n");
  });
});

test("testsStep: timeout ⇒ TESTS_INDETERMINATE(timeout), timed_out:true, the process group is gone; denied argv / missing executable ⇒ TESTS_INDETERMINATE with the reason and nothing spawned", async () => {
  const { repo } = buildRepo();
  const head = commit(repo, { "hang.mjs": 'process.stdout.write("pid " + process.pid + "\\n"); setInterval(() => {}, 1000);\n' }, "hang");
  await withWorktree(repo, head, async (wt) => {
    const started = Date.now();
    const r = await testsStep({ wt: wt.dir, argv: ["node", "hang.mjs"], timeout_s: 1, key: keyOf(repo), env: process.env, log: quiet });
    assert.equal(r.result, "TESTS_INDETERMINATE");
    assert.equal(r.reason, "timeout");
    assert.equal(r.timed_out, true);
    assert.ok(Date.now() - started < 30_000, "did not wait for the 5 s SIGKILL grace to be exceeded by much");
    const pid = Number(/pid (\d+)/.exec(r.output_redacted)?.[1]);
    assert.ok(pid > 0, r.output_redacted);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "the timed-out child is gone");
    const denied = await testsStep({ wt: wt.dir, argv: ["node", "-e", "1"], timeout_s: 1, key: keyOf(repo), env: process.env, log: quiet });
    assert.equal(denied.result, "TESTS_INDETERMINATE");
    assert.match(denied.reason, /^argv-rejected/);
    assert.equal(denied.executable_path, undefined);
    assert.equal(denied.timed_out, false);
    const missing = await testsStep({ wt: wt.dir, argv: ["pytest"], timeout_s: 1, key: keyOf(repo), env: { ...process.env, PATH: "/nonexistent-bin-dir" }, log: quiet });
    assert.equal(missing.result, "TESTS_INDETERMINATE");
    assert.equal(missing.reason, "executable-not-found");
  });
});

test("boundOutput: ≤ OUTPUT_LIMIT bytes, whole lines from the head and the tail with an omission marker; small output passes through", () => {
  assert.equal(OUTPUT_LIMIT, 64 * 1024);
  assert.equal(DEFAULT_TIMEOUT_S, 600);
  assert.equal(boundOutput(Buffer.from("a\nb\n"), 64), "a\nb\n");
  const lines = [];
  for (let i = 0; i < 5000; i++) lines.push(`line ${String(i).padStart(5, "0")} ${"x".repeat(20)}`);
  const big = Buffer.from(`${lines.join("\n")}\n`);
  const out = boundOutput(big, 4096);
  assert.ok(Buffer.byteLength(out) <= 4096, `bounded: ${Buffer.byteLength(out)}`);
  assert.ok(out.startsWith("line 00000 "), "head kept");
  assert.ok(out.endsWith("line 04999 xxxxxxxxxxxxxxxxxxxx\n"), "tail kept");
  assert.match(out, /\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n/);
  for (const line of out.split("\n").filter((l) => l.startsWith("line "))) assert.match(line, /^line \d{5} x{20}$/, "no line is cut in half");
});
