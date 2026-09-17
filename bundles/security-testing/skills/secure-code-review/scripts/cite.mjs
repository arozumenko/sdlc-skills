#!/usr/bin/env node
// cite.mjs — the secure-code-review script (spec §6): `init` seeds the
// engagement record and the managed `.gitignore` block (D9), `show` prints
// numbered, redacted lines at a commit (the helper the reviewer reads with),
// `check` verifies every citation of a findings file against the bytes at
// its oid, stamps the file, tiles coverage and validates second opinions
// (findings mode here; threat-model mode and `--md` in Task 5), `redact`
// rewrites a Markdown file through the redaction rules (Task 5).
//
// Result lines (one per outcome; exit 0 ok · 2 usage / bad input · 4 the
// check failed · 5 a record is corrupt):
//   init   WROTE <path> · EDIT-ENGAGEMENT-AND-RERUN (2) · TRACKED <path> (4)
//          IGNORE-BLOCK: written|present · INIT ok
//   show   SHOW <path> <oid7> <start>-<end>, then `<n>\t<redacted line>`
//   check  REFUSED agent-written key <key> (2) · DIRTY-SCOPE <path> (2)
//          FAILED <finding-index>.<citation-index> <why> (4)
//          SECOND <id> <assertion> · STALE-REVIEW <id> (4)
//          COVERAGE examined=<n> partial=<n> unexamined=<n>
//          CHECK verified=<n> failed=<n>   (always last; exit 4 on any FAILED/STALE)
//   all    USAGE(<sub>: <why>) (2) · ENGAGEMENT-* tokens (2) · GIT-ERROR <m> (2)
//          USAGE(cite: <why>) is the dispatcher's own (unknown command, bad flag)
//
// Every string printed or written passes through `redactString` first —
// field-wise for JSON, because the `high-entropy` rule would otherwise eat
// every 40-hex oid and 64-hex hash a serialised file carries (see `token`
// and `redactDeep`). Line numbers are raw, as `git show` prints them (D3).
// Stdlib ESM only; every child process is an argv array with `shell: false`
// (via lib/git.mjs); no network. Imports only from ./lib/.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkCitation, findingId, isOid } from "./lib/citations.mjs";
import { UsageError, runCli } from "./lib/cli.mjs";
import { CoverageError, tileCoverage } from "./lib/coverage.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { GitError, lsFiles, revParse, showBytes, statusPorcelain } from "./lib/git.mjs";
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
  // lines round-trip untouched; only the ASCII block is ours. This is the
  // one write that does NOT pass through `redactString` — the same bytes go
  // back to the same file, and redacting a consumer's ignore file would
  // corrupt it. Nothing here originates from us but the block.
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

// ---------------------------------------------------------------- check

/**
 * Keys only `check` writes (D10). A file carrying any of them must carry a
 * `check_stamp` that matches the rest of the file — check's own output
 * re-runs freely; a hand-written `id`/`state`/`verdict`, or an assertion
 * edited underneath check's keys, is REFUSED. `oid` is not here: a citation
 * may carry its own (spec §6 `oid?`); check stamps it only when absent.
 * `verdict` is never written by check, so it is refused whenever present.
 */
const CHECK_KEYS = Object.freeze({ finding: ["id", "verdict"], citation: ["state", "verdict", "snippet_redacted"], top: ["coverage", "check_stamp"] });
/** Keys whose value is a commit oid or a sha256 by construction; the walker keeps those as full hex. */
const HEX_KEYS = new Set(["head", "oid", "id", "check_stamp", "finding_id", "findings_sha256"]);
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ASSERTIONS = new Set(["confirmed", "refuted", "indeterminate"]);
const SECOND_FILE = /^second-(.+)\.json$/;

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A full oid or sha256 prints as is (the high-entropy rule would eat it); anything else is redacted. */
const token = (s) => (typeof s === "string" && HEX.test(s) ? s : redactString(String(s)).text);

/**
 * `JSON.parse` that never lets the file's bytes into a thrown message (V8
 * echoes a slice of the source in its SyntaxError).
 * @param {Buffer} bytes
 * @param {string} what for the usage line
 * @returns {object}
 * @throws {UsageError}
 */
function parseStrict(bytes, what) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new UsageError(`${what} is not valid JSON`);
  }
  if (!isObject(doc)) throw new UsageError(`${what} is not a JSON object`);
  return doc;
}

/**
 * Deep copy with every string (keys included) redacted, except a value under
 * one of `HEX_KEYS` that is a full oid/sha256. Arrays pass no key down.
 * @param {unknown} value
 * @param {string} [key] the property name `value` sits under
 */
function redactDeep(value, key) {
  if (typeof value === "string") return key !== undefined && HEX_KEYS.has(key) && HEX.test(value) ? value : redactString(value).text;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[redactString(k).text] = redactDeep(v, k);
    return out;
  }
  return value;
}

/** The document without the keys `check` writes — the `check_stamp` preimage. */
function stripCheckKeys(doc) {
  const out = { ...doc };
  delete out.check_stamp;
  delete out.coverage;
  if (Array.isArray(out.findings)) {
    out.findings = out.findings.map((f) => {
      if (!isObject(f)) return f;
      const g = { ...f };
      delete g.id;
      if (Array.isArray(g.citations)) {
        g.citations = g.citations.map((c) => {
          if (!isObject(c)) return c;
          const d = { ...c };
          delete d.state;
          delete d.oid;
          delete d.snippet_redacted;
          return d;
        });
      }
      return g;
    });
  }
  return out;
}
const stampOf = (doc) => sha256Hex(JSON.stringify(stripCheckKeys(doc)));

/** Every check-written key the file carries, findings first (the keys D10 names come first). */
function checkKeysPresent(doc) {
  const found = [];
  for (const f of Array.isArray(doc.findings) ? doc.findings : []) {
    if (!isObject(f)) continue;
    for (const k of CHECK_KEYS.finding) if (Object.hasOwn(f, k)) found.push(k);
    for (const c of Array.isArray(f.citations) ? f.citations : []) {
      if (!isObject(c)) continue;
      for (const k of CHECK_KEYS.citation) if (Object.hasOwn(c, k)) found.push(k);
    }
  }
  for (const k of CHECK_KEYS.top) if (Object.hasOwn(doc, k)) found.push(k);
  return found;
}

/** Raw line count of `path` at `oid` (lines as `git show` prints them); 0 when absent there. */
function rawLineCount(root, oid, path) {
  let bytes;
  try {
    bytes = showBytes(root, oid, path);
  } catch (e) {
    if (e instanceof GitError) return 0;
    throw e;
  }
  if (bytes.length === 0) return 0;
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes[bytes.length - 1] === 0x0a ? n : n + 1;
}

/**
 * Every `second-<id>.json` beside the findings file, validated against the
 * findings as read (`findings_sha256` is the hash of the file bytes BEFORE
 * this run's write-back — the lead runs `check` before dispatching the second
 * opinion, so the reviewer hashes a stamped file, and a re-run of check on
 * its own output leaves those bytes unchanged).
 * @returns {{lines: string[], stale: number}}
 */
function secondOpinions(dir, findings, fileSha) {
  const byId = new Map(findings.filter((f) => typeof f.id === "string").map((f) => [f.id, f]));
  const lines = [];
  let stale = 0;
  for (const name of readdirSync(dir).filter((n) => SECOND_FILE.test(n)).sort()) {
    let s = null;
    try {
      s = parseStrict(readFileSync(join(dir, name)), name);
    } catch {
      s = null;
    }
    const id = s !== null && typeof s.finding_id === "string" ? s.finding_id : name.match(SECOND_FILE)[1];
    const f = byId.get(id);
    const ok =
      s !== null &&
      f !== undefined &&
      s.oid === f.citations[0].oid &&
      s.findings_sha256 === fileSha &&
      typeof s.assertion === "string" &&
      ASSERTIONS.has(s.assertion) &&
      typeof s.note === "string" &&
      typeof s.by === "string";
    if (ok) {
      lines.push(`SECOND ${token(id)} ${s.assertion}`);
    } else {
      stale++;
      lines.push(`STALE-REVIEW ${token(id)}`);
    }
  }
  return { lines, stale };
}

function checkFindings(doc, { root, bytes, abs }, ctx) {
  if (!Array.isArray(doc.findings)) throw new UsageError("findings must be an array");
  if (!Array.isArray(doc.examined)) throw new UsageError("examined must be an array of {path, lines?}");
  if (doc.head !== undefined && !isOid(doc.head)) throw new UsageError("head must be a 40-hex oid");
  doc.findings.forEach((f, i) => {
    if (!isObject(f) || typeof f.class !== "string" || f.class.length === 0 || !Array.isArray(f.citations) || f.citations.length === 0) {
      throw new UsageError(`findings[${i}] must carry a class and a non-empty citations array`);
    }
  });
  // D10: check's own keys are fine when the stamp matches; otherwise someone wrote them.
  const present = checkKeysPresent(doc);
  if (present.length > 0 && doc.check_stamp !== stampOf(doc)) {
    say(ctx, `REFUSED agent-written key ${present[0]}`);
    return 2;
  }
  const { record } = readEngagement(root);
  const scope = record.scope_paths;
  // A rename renders as `XY old -> new`; the path that is dirty is the last segment.
  const dirty = [...new Set(statusPorcelain(root, { paths: scope }).map((l) => l.slice(3).split(" -> ").pop()))].sort();
  if (dirty.length > 0) {
    for (const p of dirty) say(ctx, `DIRTY-SCOPE ${p}`);
    return 2;
  }
  let head;
  try {
    head = revParse(root, doc.head ?? "HEAD");
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`head ${String(doc.head).slice(0, 7)} is not a commit`);
    throw e;
  }
  const failed = [];
  let verified = 0;
  doc.findings.forEach((f, fi) => {
    let first;
    f.citations.forEach((c, ci) => {
      const r = checkCitation(root, scope, c, { maxRangeLines: MAX_RANGE_LINES, defaultOid: head });
      if (r.state === "VERIFIED") verified++;
      else failed.push(`FAILED ${fi}.${ci} ${r.why}`);
      if (ci === 0) first = r;
      if (!isObject(c)) return; // nothing to stamp on a non-object; it is reported bad-shape above
      if (r.path !== undefined) c.path = r.path;
      if (r.oid !== undefined) c.oid = r.oid;
      c.state = r.state === "VERIFIED" ? "VERIFIED" : `FAILED(${r.why})`;
      if (r.state === "VERIFIED") c.snippet_redacted = r.snippet_redacted;
      else delete c.snippet_redacted;
    });
    const allVerified = f.citations.every((c) => isObject(c) && c.state === "VERIFIED");
    if (allVerified) f.id = findingId({ path: first.path, cls: f.class, normalisedSnippet: first.normalised });
    else delete f.id;
  });
  const files = lsFiles(root, { paths: scope });
  const counts = new Map(files.map((p) => [p, rawLineCount(root, head, p)]));
  let coverage;
  try {
    coverage = tileCoverage(files, doc.examined, counts);
  } catch (e) {
    if (e instanceof CoverageError) throw new UsageError(`examined: ${e.message}`);
    throw e;
  }
  doc.coverage = coverage;
  const seconds = secondOpinions(dirname(abs), doc.findings, sha256Hex(bytes));
  // Redact field-wise, then stamp the redacted document so a re-run matches.
  const out = redactDeep(doc);
  out.check_stamp = stampOf(out);
  writeFileSync(abs, `${JSON.stringify(out, null, 2)}\n`);
  for (const line of failed) say(ctx, line);
  for (const line of seconds.lines) ctx.out(line); // already token-redacted; the ids must survive
  say(ctx, `COVERAGE examined=${coverage.examined} partial=${coverage.partial} unexamined=${coverage.unexamined}`);
  say(ctx, `CHECK verified=${verified} failed=${failed.length}`);
  return failed.length > 0 || seconds.stale > 0 ? 4 : 0;
}

function check(args, ctx) {
  const [file] = args._;
  if (file === undefined) throw new UsageError("usage: check <findings.json | threat-model.json> [--md [--no-snippets]]");
  const abs = resolve(ctx.cwd, file);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch {
    throw new UsageError(`${file} not found`);
  }
  const doc = parseStrict(bytes, file);
  if (!("findings" in doc)) throw new UsageError("threat-model mode is not available yet");
  return checkFindings(doc, { root: ctx.root, bytes, abs }, ctx);
}

// ---------------------------------------------------------------- main

/** The command table; `redact` joins it in Task 5. */
export const COMMANDS = { init: command("init", init), show: command("show", show), check: command("check", check) };

/**
 * True when this file is the process entry script. Both sides are realpath'd:
 * `import.meta.url` is already canonical, `argv[1]` is whatever the caller
 * typed — a file symlink, a `--symlink` install, or a copy under an aliased
 * tmpdir (`/var/…` → `/private/var/…` on macOS) would otherwise never match
 * and main would silently not run.
 * @returns {boolean}
 */
function isEntryScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "cite" }));
