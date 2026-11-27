#!/usr/bin/env node
// G-NNN: <the pattern, in one line>.
// Closes the class behind <incident: bug id / PR / review / retro session>.
// Allowed: <the nearest legitimate thing this guard must not flag>.
//
// Rung-4 starter: a line-pattern guard over tracked files. Node stdlib only.
// Replace PATTERN / INCLUDE / ALLOW_FILES with the guard's real shape, and
// keep the sibling check-guard.selftest.mjs fixtures in step with it.
//
// Usage: node tools/check-<what>.mjs [root]   (root defaults to the git top level)
// Exit:  0 clean, 1 violations, 2 could not run (fails closed).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ID = "G-NNN";
const PATTERN = /#39\b/;                         // the shape to reject
const INCLUDE = /\.(md|ya?ml)$/;                  // which tracked files to read
const ALLOW_FILES = new Set(["docs/adr/ADR-023.md"]); // files where it is legitimate
const SUPPRESS = new RegExp(`guard-allow ${ID}:\\s*\\w{3,}`); // inline, reason (a word, not punctuation) required

function fail(code, msg) {
  console.error(`${ID}: ${msg}`);
  process.exit(code);
}

let root = process.argv[2];
try {
  root ??= execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
} catch {
  fail(2, "not in a git work tree and no root given; refusing to pass unchecked");
}

let files;
try {
  files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && INCLUDE.test(f) && !ALLOW_FILES.has(f));
} catch (e) {
  fail(2, `could not list tracked files under ${root}: ${e.message}`);
}
if (files.length === 0) fail(2, "matched zero files; the INCLUDE pattern or root is wrong");

const hits = [];
let suppressed = 0;
for (const f of files) {
  let lines;
  try {
    lines = readFileSync(join(root, f), "utf8").split("\n");
  } catch (e) {
    fail(2, `could not read ${f}: ${e.message}`);
  }
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    if (SUPPRESS.test(line) || (i > 0 && SUPPRESS.test(lines[i - 1]))) return void suppressed++;
    hits.push(`${f}:${i + 1}`);
  });
}

if (suppressed) console.error(`${ID}: ${suppressed} suppression(s)`);
if (hits.length) {
  console.error(`${ID}: <pattern> found (see the header of this script for why):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`${ID}: OK (${files.length} files checked)`);
