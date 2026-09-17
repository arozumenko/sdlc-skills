#!/usr/bin/env node
// cite.mjs — the secure-code-review script (spec §6): `init` seeds the
// engagement record and the managed `.gitignore` block (D9), `show` prints
// numbered, redacted lines at a commit (the helper the reviewer reads with),
// `check` verifies citations against the bytes at their oid (Tasks 4–5),
// `redact` rewrites a Markdown file through the redaction rules (Task 5).
//
// Result lines (one per outcome; exit 0 ok · 2 usage / bad input · 4 the
// check failed · 5 a record is corrupt):
//   init   WROTE <path> · EDIT-ENGAGEMENT-AND-RERUN (2) · TRACKED <path> (4)
//          IGNORE-BLOCK: written|present · INIT ok
//   show   SHOW <path> <oid7> <start>-<end>, then `<n>\t<redacted line>`
//   both   USAGE(<sub>: <why>) (2) · ENGAGEMENT-* tokens (2) · GIT-ERROR <m> (2)
//          USAGE(cite: <why>) is the dispatcher's own (unknown command, bad flag)
//
// Every string printed or written passes through `redactString` first. Line
// numbers are raw, as `git show` prints them (D3). Stdlib ESM only; every
// child process is an argv array with `shell: false` (via lib/git.mjs); no
// network. Imports only from ./lib/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UsageError, runCli } from "./lib/cli.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { GitError, revParse, showBytes } from "./lib/git.mjs";
import { GITIGNORE, probeTracked, readGitignore, upsertBlock } from "./lib/ignore-block.mjs";
import { redactString } from "./lib/redact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A citation (and a `show` window) spans at most this many lines. */
export const MAX_RANGE_LINES = 40;

const ENGAGEMENT_REL = ".agents/security-testing/engagement.md";
const TEMPLATE_REL = join("knowledge", "engagement.md.template");

/** Redacted `out()`: nothing reaches stdout unredacted. */
const say = (ctx, line) => ctx.out(redactString(line).text);

/**
 * A command whose own usage errors print as `USAGE(<sub>: <why>)` (exit 2)
 * rather than the dispatcher's `USAGE(cite: …)`; everything else propagates.
 * @param {string} sub
 * @param {(args: object, ctx: object) => number} fn
 */
const command = (sub, fn) => (args, ctx) => {
  try {
    return fn(args, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      say(ctx, `USAGE(${sub}: ${e.message})`);
      return 2;
    }
    throw e;
  }
};

// ---------------------------------------------------------------- init

/**
 * The engagement template: the skill-relative copy in this repo's bundle
 * tree first, then the copy the installer seeds under `<st>/knowledge/`.
 * @param {string} root
 * @returns {string} absolute path
 * @throws {UsageError} neither copy exists
 */
function templatePath(root) {
  const candidates = [join(HERE, "..", "..", "..", TEMPLATE_REL), join(stDir(root), TEMPLATE_REL)];
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) throw new UsageError(`engagement template not found (looked in ${candidates.map((p) => resolve(p)).join(", ")})`);
  return found;
}

function init(args, ctx) {
  const { root } = ctx;
  const st = stDir(root);
  mkdirSync(st, { recursive: true });
  const engagement = join(st, "engagement.md");
  if (!existsSync(engagement)) {
    writeFileSync(engagement, redactString(readFileSync(templatePath(root), "utf8")).text);
    say(ctx, `WROTE ${ENGAGEMENT_REL}`);
    say(ctx, "EDIT-ENGAGEMENT-AND-RERUN");
    return 2;
  }
  readEngagement(root); // EDIT-ENGAGEMENT-AND-RERUN / ENGAGEMENT-INVALID(<why>) propagate to runCli
  const tracked = probeTracked(root);
  if (tracked.length > 0) {
    for (const path of tracked) say(ctx, `TRACKED ${path}`);
    return 4;
  }
  // .gitignore is bytes: read and written as latin1 so the consumer's own
  // lines round-trip untouched; only the ASCII block is ours.
  const current = readGitignore(root);
  const next = upsertBlock(current);
  if (next === current) {
    say(ctx, "IGNORE-BLOCK: present");
  } else {
    writeFileSync(join(root, GITIGNORE), Buffer.from(next, "latin1"));
    say(ctx, "IGNORE-BLOCK: written");
  }
  say(ctx, "INIT ok");
  return 0;
}

// ---------------------------------------------------------------- show

/**
 * True when `path` (repo-relative posix) sits under one of `scopePaths`
 * (posix prefix match on whole segments; `.` means the whole tree).
 * @param {string} path
 * @param {string[]} scopePaths
 * @returns {boolean}
 */
export function underScope(path, scopePaths) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments.includes("..") || segments.includes("")) return false;
  const clean = segments.filter((s) => s !== ".").join("/");
  if (clean.length === 0) return false;
  return scopePaths.some((scope) => {
    const s = scope.replace(/\/+$/, "").replace(/^(\.\/)+/, "");
    if (s === "" || s === ".") return true;
    return clean === s || clean.startsWith(`${s}/`);
  });
}

function lineNumber(raw, what) {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new UsageError(`${what} must be a positive integer, got ${raw}`);
  return Number(raw);
}

function show(args, ctx) {
  const { root } = ctx;
  const [path, startRaw, endRaw] = args._;
  if (path === undefined) throw new UsageError("usage: show <path> [start end] [--at <oid>]");
  if ((startRaw === undefined) !== (endRaw === undefined)) throw new UsageError("start and end go together");
  const { record } = readEngagement(root);
  if (!underScope(path, record.scope_paths)) throw new UsageError(`${path} is not under scope_paths (${record.scope_paths.join(", ")})`);
  let start = 1;
  let end;
  if (startRaw !== undefined) {
    start = lineNumber(startRaw, "start");
    end = lineNumber(endRaw, "end");
    if (end < start) throw new UsageError(`end ${end} is before start ${start}`);
    if (end - start + 1 > MAX_RANGE_LINES) throw new UsageError(`range over ${MAX_RANGE_LINES} lines (${start}-${end})`);
  }
  const at = typeof args.at === "string" ? args.at : "HEAD";
  let oid;
  try {
    oid = revParse(root, at);
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`unknown ref ${at}`);
    throw e;
  }
  const oid7 = oid.slice(0, 7);
  let bytes;
  try {
    bytes = showBytes(root, oid, path);
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`${path} is not in the tree at ${oid7}`);
    throw e;
  }
  // Raw lines, as `git show` prints them (D3): split on LF, drop the empty
  // entry a trailing LF leaves behind, keep CRs and blank lines in place.
  const lines = bytes.toString("utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (start > lines.length) throw new UsageError(`start ${start} is past the last line (${lines.length}) of ${path} at ${oid7}`);
  end = end === undefined ? lines.length : Math.min(end, lines.length);
  say(ctx, `SHOW ${path} ${oid7} ${start}-${end}`);
  for (let n = start; n <= end; n++) say(ctx, `${n}\t${lines[n - 1]}`);
  return 0;
}

// ---------------------------------------------------------------- main

/** The command table; `check` and `redact` join it in later tasks. */
export const COMMANDS = { init: command("init", init), show: command("show", show) };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "cite" }));
}
