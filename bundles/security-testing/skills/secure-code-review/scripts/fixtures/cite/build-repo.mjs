// fixtures/cite/build-repo.mjs — a throwaway git repo for the cite.mjs tests,
// built by code into a `mkdtempSync` dir (never committed). Two commits:
// `c1` adds `src/app.js` (12 lines, one of them a `password = ...` line the
// redaction rules must catch), `src/util.js` and `README.md`; `c2` edits
// line 4 of `src/app.js`. `APP_LINES` is the file at `c2`, as an array, so a
// test can build a snippet: `APP_LINES.slice(2, 5).join("\n")` is lines 3–5.
// `commit.gpgsign` is off because `HOME` passes through `gitEnv()` and a
// signing user gitconfig would otherwise break every commit.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `src/app.js` at `c2`, line by line (no trailing newline entry). */
export const APP_LINES = Object.freeze([
  "import { readFileSync } from \"node:fs\";",
  "import { createServer } from \"node:http\";",
  "",
  "const PORT = Number(process.env.PORT ?? 8080);",
  "const password = \"hunter22x\";",
  "",
  "export function handler(req, res) {",
  "  const body = readFileSync(req.url.slice(1));",
  "  res.end(body);",
  "}",
  "",
  "createServer(handler).listen(PORT);",
]);

const APP_LINES_C1 = APP_LINES.map((line, i) => (i === 3 ? "const PORT = 8080;" : line));

const UTIL = ["export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));", "export const noop = () => {};", ""].join("\n");
const README = "# fixture\n\nNot under scope_paths.\n";

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true }).trim();
}

/**
 * Build the fixture repo.
 * @returns {{root: string, oid1: string, oid2: string}}
 */
export function buildRepo() {
  const root = mkdtempSync(join(tmpdir(), "st-cite-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), `${APP_LINES_C1.join("\n")}\n`);
  writeFileSync(join(root, "src", "util.js"), UTIL);
  writeFileSync(join(root, "README.md"), README);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "c1"]);
  writeFileSync(join(root, "src", "app.js"), `${APP_LINES.join("\n")}\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "c2"]);
  const oid1 = git(root, ["rev-parse", "HEAD~1"]);
  const oid2 = git(root, ["rev-parse", "HEAD"]);
  return { root, oid1, oid2 };
}
