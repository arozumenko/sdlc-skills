// lib/ctx.mjs — the one context every command receives (TASK-006, plan §3.3).
//
//   ctx = {
//     root, st, cwd, actor, quiet,
//     now()            ISO-8601 — SECURITY_EVIDENCE_NOW when set (TL-11); the only clock read in scripts/ (G-1)
//     engagement()     lazy: engagement.parseEngagementMd over <st>/engagement.md (TL-5; TASK-007 owns the parser); cached
//     key()            lazy: {key_id, bytes} of private/keys/current, or null (TL-9); cached
//     keyById(id)      {key_id, bytes} or null
//     toolVersion()    scripts/version.json → tool_version (P5; the only reader)
//     log(...parts)    stderr diagnostics, redacted; silent under --quiet
//     out(line)        stdout result token, one line, redacted (G-4)
//     wrote(path, a)   prints `WROTE <rel> sha256=<a.envelope.self_sha256>` after checking `a` is what is on disk
//     writeArtifact()  canon.writeArtifact + wrote(), so a caller cannot print the wrong identity
//     rel(p) / abs(p)  repo-relative posix path / absolute path under root — for repo-LAYOUT
//                      paths the scripts spell themselves (<st>/…, ledger/…), never for argv
//     input(cmd, p)    absolute on-disk path of a file the USER typed on the command line:
//                      resolved against the invocation cwd (what the user pointed at),
//                      realpath'd (symlinks followed, so an alias of the tree is inside it
//                      and a symlink out of the tree is outside it), then required to lie
//                      inside root — outside ⇒ USAGE(<cmd>: cannot read <p> (outside the work tree))
//   }
//
// The two path bases, stated once so every command picks the same one:
//   abs()   root-relative — the scripts' own layout is spelled relative to the
//           consumer root whatever directory the user invoked from;
//   input() cwd-relative — `--model tm.json` from repo/sub/ means repo/sub/tm.json,
//           exactly as every other CLI reads a relative argument. Inputs must
//           still live under root: the artifacts record inputs by repo-relative
//           path and a file outside the work tree has no such name.
//
// Every string that leaves the process passes redact.mjs here (G-4): out()
// and log() are the only writers to stdout/stderr — a `console.log` anywhere
// else in scripts/ is a review finding. The streams and the environment are
// injectable so tests drive a ctx without spawning.
//
// Why wrote() re-reads the file: writeArtifact redacts the payload and
// recomputes self_sha256 over the redacted bytes, so the makeEnvelope result
// and the written artifact differ whenever a redaction rule fired. The WROTE
// line must carry the on-disk identity, and the cheapest way to make that
// true by construction is to compare against the file.

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, parseStrict, readArtifact, writeArtifact as canonWriteArtifact } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { parseEngagementMd } from "./engagement.mjs";
import { toplevel } from "./git.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { ENGAGEMENT_MISSING, KEY_ID, NOT_A_WORK_TREE, inconsistent, wrote as wroteToken } from "./tokens.mjs";

const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION_PATH = join(SCRIPTS_DIR, "version.json");
export const ST_REL = join(".agents", "security-testing");

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function redactLine(s) {
  return redactString(s).text;
}

function stringify(part) {
  if (typeof part === "string") return part;
  if (part instanceof Error) return part.message;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

/** The one wall-clock read under scripts/ (G-1). */
function now(env) {
  const fixed = env.SECURITY_EVIDENCE_NOW;
  if (fixed !== undefined && fixed !== "") {
    if (!ISO_8601.test(fixed)) throw usageError("now", "SECURITY_EVIDENCE_NOW must be an ISO-8601 timestamp");
    return fixed;
  }
  return new Date().toISOString();
}

/**
 * realpath(3) of `p`, or — when `p` does not exist yet — the realpath of its
 * nearest existing ancestor plus the remaining names. A user-typed input
 * usually exists (the command reads it next and turns ENOENT into its own
 * USAGE), but the containment check must not be the place that fails on a
 * typo, and an output-style argument must resolve through an aliased
 * directory the same way its siblings do. Any error other than "not there"
 * propagates: a permission failure is not a reason to fall back to the
 * lexical path.
 */
function realpathLenient(p) {
  try {
    return realpathSync.native(p);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
  }
  const parent = dirname(p);
  if (parent === p) return p;
  return join(realpathLenient(parent), basename(p));
}

/**
 * The consumer root is the top level of a git work tree, full stop (TL-2).
 * Without `--root`, that is the top level containing cwd. With `--root`, the
 * given dir must *be* the top level — a dir merely inside a work tree is
 * refused, because git.mjs resolves `ls-files`/`status` against cwd but
 * `<oid>:<path>` against the top level, so a nested root would list one file
 * and hash another, and ctx.rel() would yield `../…` paths. Compared after
 * realpath (macOS /var → /private/var) so a symlinked spelling of the top
 * level is still the top level. `realpathSync.native`, not `realpathSync`:
 * the JS implementation resolves symlinks but keeps the caller's letter
 * case, while git's toplevel comes from getcwd() and carries the on-disk
 * spelling — on a case-insensitive file system (APFS, NTFS) `--root ~/Dev/Repo`
 * for `~/dev/repo` would otherwise fail the equality and refuse a valid
 * invocation. realpath(3) returns the on-disk spelling, matching git.
 */
function resolveRoot(flags, cwd) {
  if (flags.root !== undefined) {
    const root = resolve(cwd, flags.root);
    const top = toplevel(root);
    if (top === null) throw new CliError(EXIT.USAGE, NOT_A_WORK_TREE);
    if (realpathSync.native(root) !== top) throw usageError("--root", "must be the top level of a git work tree");
    return top;
  }
  const top = toplevel(cwd);
  if (top === null) throw new CliError(EXIT.USAGE, NOT_A_WORK_TREE);
  return top;
}

/**
 * Build the command context.
 * @param {{root?: string, actor?: string, quiet?: boolean}} flags global flags (plan §3.1)
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, stdout?: {write(s: string): unknown}, stderr?: {write(s: string): unknown}}} [io]
 * @returns {object} ctx
 * @throws {CliError} 2 NOT-A-WORK-TREE
 */
export function createContext(flags = {}, { cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const root = resolveRoot(flags, cwd);
  const st = join(root, ST_REL);
  const actor = flags.actor ?? (typeof env.SECURITY_EVIDENCE_ACTOR === "string" && env.SECURITY_EVIDENCE_ACTOR !== "" ? env.SECURITY_EVIDENCE_ACTOR : "unknown");
  const quiet = flags.quiet === true;

  let engagementCache;
  let keyCache;
  let versionCache;

  const rel = (p) => {
    const r = relative(root, resolve(root, p));
    return sep === "/" ? r : r.split(sep).join("/");
  };
  const abs = (p) => (isAbsolute(p) ? p : resolve(root, p));

  // realpath(3) the cwd once and the target every time, so a symlinked
  // spelling of either (macOS /var → /private/var, an alias of the tree)
  // compares against root — itself git's realpath'd toplevel — like with
  // like, and a symlink *inside* the tree that points out of it is judged
  // by where it really leads (TASK-015 follow-up: the check is on the
  // on-disk path, not the lexical one).
  let inputBase;
  const input = (command, p) => {
    if (typeof command !== "string" || command === "") throw new TypeError("ctx.input: command name is required");
    if (typeof p !== "string" || p === "") throw usageError(command, "a file path is required");
    inputBase ??= realpathSync.native(cwd);
    const target = realpathLenient(resolve(inputBase, p));
    const inside = relative(root, target);
    // Prose first, path second: a token whose value *starts* with a long
    // absolute path reads as `<cmd>: <high-entropy>` to redact.mjs (G-4) and
    // would leave the process as <REDACTED:high-entropy-assign>.
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw usageError(command, `cannot read ${p} (outside the work tree)`);
    return target;
  };

  const out = (line) => {
    if (typeof line !== "string") throw new TypeError("ctx.out: line must be a string");
    if (line.includes("\n")) throw new TypeError("ctx.out: one line per call");
    stdout.write(`${redactLine(line)}\n`);
  };

  const log = (...parts) => {
    if (quiet) return;
    stderr.write(`${redactLine(parts.map(stringify).join(" "))}\n`);
  };

  const keyById = (key_id) => {
    if (typeof key_id !== "string" || !KEY_ID.test(key_id)) throw new CliError(EXIT.INTEGRITY, inconsistent("key_id"));
    let bytes;
    try {
      bytes = readFileSync(join(st, "private", "keys", key_id));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    return { key_id, bytes };
  };

  const key = () => {
    if (keyCache !== undefined) return keyCache;
    let current;
    try {
      current = readFileSync(join(st, "private", "keys", "current"), "utf8").trim();
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      keyCache = null;
      return keyCache;
    }
    if (!KEY_ID.test(current)) throw new CliError(EXIT.INTEGRITY, inconsistent("keys/current"));
    keyCache = keyById(current);
    return keyCache;
  };

  const engagement = () => {
    if (engagementCache !== undefined) return engagementCache;
    let bytes;
    try {
      bytes = readFileSync(join(st, "engagement.md"));
    } catch (err) {
      if (err.code === "ENOENT") throw new CliError(EXIT.USAGE, ENGAGEMENT_MISSING);
      throw err;
    }
    engagementCache = parseEngagementMd(bytes);
    return engagementCache;
  };

  const toolVersion = () => {
    if (versionCache !== undefined) return versionCache;
    const raw = parseStrict(readFileSync(VERSION_PATH));
    const keys = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw) : [];
    if (keys.length !== 1 || keys[0] !== "tool_version" || typeof raw.tool_version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.tool_version)) {
      throw new Error(`version.json must be exactly {"tool_version": "<semver>"} (${VERSION_PATH})`);
    }
    versionCache = raw.tool_version;
    return versionCache;
  };

  const wrote = (path, written) => {
    if (written === null || typeof written !== "object" || !written.envelope || typeof written.envelope.self_sha256 !== "string") {
      throw new TypeError("ctx.wrote: pass the artifact returned by writeArtifact");
    }
    const onDisk = readArtifact(abs(path));
    if (onDisk.envelope.self_sha256 !== written.envelope.self_sha256 || artifactId(written.payload) !== written.envelope.self_sha256) {
      throw new Error(`ctx.wrote: ${rel(path)}: the artifact passed is not the artifact on disk (pass writeArtifact's return value, not the makeEnvelope result)`);
    }
    out(wroteToken(rel(path), onDisk.envelope.self_sha256));
  };

  const writeArtifact = (path, artifact, options) => {
    const written = canonWriteArtifact(abs(path), artifact, options);
    out(wroteToken(rel(path), written.envelope.self_sha256));
    return written;
  };

  return Object.freeze({
    root,
    st,
    cwd,
    actor,
    quiet,
    now: () => now(env),
    engagement,
    key,
    keyById,
    toolVersion,
    log,
    out,
    wrote,
    writeArtifact,
    rel,
    abs,
    input,
  });
}
