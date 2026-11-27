#!/usr/bin/env node
// G-NNN: <the pattern, in one line>.
// Closes the class behind <incident: bug id / PR / review / retro session>.
// Allowed: <the nearest legitimate thing this guard must not flag>.
//
// Rung-4 starter: a line-pattern guard over tracked files. Node stdlib only.
// Replace PATTERN / INCLUDE / ALLOW_FILES / FIX with the guard's real shape,
// and keep the sibling check-guard.selftest.mjs fixtures in step with it.
//
// Usage: node tools/check-<what>.mjs [root]   (root defaults to the git top level)
// Exit:  0 clean, 1 violations, 2 could not run (fails closed).
//
// Exceptions: on the offending line or the line above, with an expiry date,
// the approving human and a reason. An expired exception is a violation.
//   guard-allow G-NNN until 2027-03-31 by <name>: <reason>
//
// Ratchet (only for a pattern already common when the guard lands): put the
// current count in RATCHET_FILE. The guard then fails only when a change adds
// more, and asks for the number to be lowered when a change removes some.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ID = "G-NNN";
const PATTERN = /#39\b/;                              // the shape to reject
const INCLUDE = /\.(md|ya?ml)$/;                       // which tracked files to read
const ALLOW_FILES = new Set(["docs/adr/ADR-023.md"]); // files where it is legitimate
const FIX = "cite #123 (the epic that superseded #39) instead"; // what to do instead
const RATCHET_FILE = `tools/guards/${ID}.ratchet`;   // optional: a single integer
const ALLOW = new RegExp(`guard-allow ${ID} until (\\d{4}-\\d{2}-\\d{2}) by [^:]+:\\s*\\w{3,}`);

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

const today = new Date().toISOString().slice(0, 10);
const hits = [];
let allowed = 0;
for (const f of files) {
  let lines;
  try {
    lines = readFileSync(join(root, f), "utf8").split("\n");
  } catch (e) {
    fail(2, `could not read ${f}: ${e.message}`);
  }
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    const m = ALLOW.exec(line) ?? (i > 0 ? ALLOW.exec(lines[i - 1]) : null);
    if (m && m[1] >= today) return void allowed++;
    hits.push(`${f}:${i + 1}${m ? ` (exception expired ${m[1]})` : ""}`);
  });
}
if (allowed) console.error(`${ID}: ${allowed} exception(s) in force`);

let limit = 0;
const ratchetPath = join(root, RATCHET_FILE);
if (existsSync(ratchetPath)) {
  limit = Number.parseInt(readFileSync(ratchetPath, "utf8").trim(), 10);
  if (!Number.isInteger(limit) || limit < 0) fail(2, `${RATCHET_FILE} must hold one non-negative integer`);
}

if (hits.length > limit) {
  console.error(`${ID}: <pattern> found; ${FIX}.`);
  if (limit) console.error(`${ID}: ratchet allows ${limit}, found ${hits.length}; this change adds ${hits.length - limit}.`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
if (limit && hits.length < limit) {
  console.error(`${ID}: ${hits.length} left, ratchet says ${limit}; lower ${RATCHET_FILE} to ${hits.length}.`);
  process.exit(1);
}
console.log(`${ID}: OK (${files.length} files checked${limit ? `, ${hits.length} grandfathered` : ""})`);
