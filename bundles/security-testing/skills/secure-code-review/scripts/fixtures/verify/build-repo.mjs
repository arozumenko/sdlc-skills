// fixtures/verify/build-repo.mjs — a throwaway project for the verify.mjs
// tests, built by code into a `mkdtempSync` dir (never committed). Three
// commits:
//   c1  the bug: `safeName` returns its argument unchanged; `src/app.test.mjs`
//       FAILS on it. Also commits `package.json` (`npm test` = `node --test`),
//       the managed `.gitignore` block and an `engagement.md` whose
//       `execute_project_tests.argv` is `["npm","test"]`, so a clean checkout
//       carries no dirt of its own.
//   c2  the fix: line 4 becomes `return basename(name);` — tests pass.
//   c3  deletes `safeName` (lines 3–6 of c1) and drops its test — the
//       `c1..c3` diff of `src/app.js` is deletion-only.
// `commit.gpgsign` is off because `HOME` passes through and a signing user
// gitconfig would otherwise break every commit.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** `src/app.js` at `c1`, line by line (no trailing newline entry). */
export const APP_LINES_C1 = Object.freeze([
  "import { basename } from \"node:path\";",
  "",
  "export function safeName(name) {",
  "  return name;",
  "}",
  "",
  "export function greet(who) {",
  "  return `hello ${who}`;",
  "}",
]);
const APP_LINES_C2 = APP_LINES_C1.map((line, i) => (i === 3 ? "  return basename(name);" : line));
const APP_LINES_C3 = [APP_LINES_C1[0], APP_LINES_C1[1], ...APP_LINES_C1.slice(6)];

// The runner prints a secret-shaped line so the tests can prove tests.log is redacted.
const TEST_HEAD = ["import { test } from \"node:test\";", "import assert from \"node:assert/strict\";", "console.log(\"password = hunter22xyz\");"];
const TEST_C1 = [...TEST_HEAD, "import { greet, safeName } from \"./app.js\";", "", "test(\"safeName strips directories\", () => {", "  assert.equal(safeName(\"../etc/passwd\"), \"passwd\");", "});", "test(\"greet\", () => {", "  assert.equal(greet(\"x\"), \"hello x\");", "});"];
const TEST_C3 = [...TEST_HEAD, "import { greet } from \"./app.js\";", "", "test(\"greet\", () => {", "  assert.equal(greet(\"x\"), \"hello x\");", "});"];

export const ENGAGEMENT = { engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/"], execute_project_tests: { argv: ["npm", "test"] } };
const IGNORE = ["reviews", "verify", "register", "proposals"].map((d) => `.agents/security-testing/${d}/`).join("\n");

/** Run git in `root` with an argv array; returns trimmed stdout. */
export function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true }).trim();
}

/** Write `text` at `<root>/<rel>`, creating directories. */
export function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** `git add -A && git commit` → the new oid. */
export function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

/** Detached checkout of `ref`. */
export const checkout = (root, ref) => git(root, ["checkout", "-q", "--detach", ref]);

/** Write an engagement record (the fixture's, with `extra` merged in; `null` removes a key). */
export function writeEngagement(root, extra = {}) {
  const record = { ...ENGAGEMENT, ...extra };
  for (const k of Object.keys(record)) if (record[k] === null) delete record[k];
  put(root, ".agents/security-testing/engagement.md", "```json engagement\n" + JSON.stringify(record) + "\n```\n");
}

/**
 * Build the fixture repo; HEAD is left at `c3`.
 * @returns {{root: string, oid1: string, oid2: string, oid3: string}}
 */
export function buildRepo() {
  const root = mkdtempSync(join(tmpdir(), "st-verify-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  put(root, "package.json", `${JSON.stringify({ name: "fixture", private: true, scripts: { test: "node --test" } }, null, 2)}\n`);
  put(root, ".gitignore", `${IGNORE}\n`);
  put(root, "README.md", "# fixture\n\nNot under scope_paths.\n");
  writeEngagement(root);
  put(root, "src/app.js", `${APP_LINES_C1.join("\n")}\n`);
  put(root, "src/app.test.mjs", `${TEST_C1.join("\n")}\n`);
  const oid1 = commit(root, "c1");
  put(root, "src/app.js", `${APP_LINES_C2.join("\n")}\n`);
  const oid2 = commit(root, "c2");
  put(root, "src/app.js", `${APP_LINES_C3.join("\n")}\n`);
  put(root, "src/app.test.mjs", `${TEST_C3.join("\n")}\n`);
  const oid3 = commit(root, "c3");
  return { root, oid1, oid2, oid3 };
}
