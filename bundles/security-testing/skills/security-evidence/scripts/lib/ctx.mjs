// lib/ctx.mjs — the one context every command receives (TASK-006, plan §3.3).
//
//   ctx = {
//     root, st, cwd, actor, quiet,
//     now()            ISO-8601 — SECURITY_EVIDENCE_NOW when set (TL-11); the only clock read in scripts/ (G-1)
//     engagement()     lazy: <st>/engagement.md's ```json engagement block, parseStrict + schema (TL-5); cached
//     key()            lazy: {key_id, bytes} of private/keys/current, or null (TL-9); cached
//     keyById(id)      {key_id, bytes} or null
//     toolVersion()    scripts/version.json → tool_version (P5; the only reader)
//     log(...parts)    stderr diagnostics, redacted; silent under --quiet
//     out(line)        stdout result token, one line, redacted (G-4)
//     wrote(path, a)   prints `WROTE <rel> sha256=<a.envelope.self_sha256>` after checking `a` is what is on disk
//     writeArtifact()  canon.writeArtifact + wrote(), so a caller cannot print the wrong identity
//     rel(p) / abs(p)  repo-relative posix path / absolute path under root
//   }
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, parseStrict, readArtifact, writeArtifact as canonWriteArtifact } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { validate } from "./schema.mjs";
import { toplevel } from "./git.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { ENGAGEMENT_MISSING, NOT_A_WORK_TREE, POLICY_INVALID_PRIVATE, engagementInvalid, inconsistent, wrote as wroteToken } from "./tokens.mjs";

const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION_PATH = join(SCRIPTS_DIR, "version.json");
export const ST_REL = join(".agents", "security-testing");

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const KEY_ID = /^k[0-9a-f]{12}$/;
const ENGAGEMENT_FENCE = /^```json engagement[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

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
 * The consumer root is the top level of a git work tree, full stop (TL-2).
 * Without `--root`, that is the top level containing cwd. With `--root`, the
 * given dir must *be* the top level — a dir merely inside a work tree is
 * refused, because git.mjs resolves `ls-files`/`status` against cwd but
 * `<oid>:<path>` against the top level, so a nested root would list one file
 * and hash another, and ctx.rel() would yield `../…` paths. Compared after
 * realpath (macOS /var → /private/var) so a symlinked spelling of the top
 * level is still the top level.
 */
function resolveRoot(flags, cwd) {
  if (flags.root !== undefined) {
    const root = resolve(cwd, flags.root);
    const top = toplevel(root);
    if (top === null) throw new CliError(EXIT.USAGE, NOT_A_WORK_TREE);
    if (realpathSync(root) !== top) throw usageError("--root", "must be the top level of a git work tree");
    return top;
  }
  const top = toplevel(cwd);
  if (top === null) throw new CliError(EXIT.USAGE, NOT_A_WORK_TREE);
  return top;
}

/**
 * Parse the TL-5 machine record out of engagement.md: exactly one fenced
 * ```json engagement block, read with parseStrict, validated against the
 * engagement schema; `artifact_policy.private` is refused first (TL-13).
 * @param {string} text
 * @returns {object}
 * @throws {CliError} 2 ENGAGEMENT-INVALID(...) | POLICY-INVALID(private)
 */
export function parseEngagementBlock(text) {
  const blocks = [...text.matchAll(ENGAGEMENT_FENCE)].map((m) => m[1]);
  if (blocks.length === 0) throw new CliError(EXIT.USAGE, engagementInvalid("no ```json engagement block"));
  if (blocks.length > 1) throw new CliError(EXIT.USAGE, engagementInvalid(`${blocks.length} json engagement blocks; exactly one is allowed`));
  let record;
  try {
    record = parseStrict(blocks[0]);
  } catch (err) {
    throw new CliError(EXIT.USAGE, engagementInvalid(redactLine(err.message)), { cause: err });
  }
  if (record !== null && typeof record === "object" && !Array.isArray(record) && record.artifact_policy && typeof record.artifact_policy === "object" && Object.hasOwn(record.artifact_policy, "private")) {
    throw new CliError(EXIT.USAGE, POLICY_INVALID_PRIVATE);
  }
  const errors = validate("engagement", record);
  if (errors.length) throw new CliError(EXIT.USAGE, engagementInvalid(redactLine(errors[0])));
  return record;
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
    let text;
    try {
      text = readFileSync(join(st, "engagement.md"), "utf8");
    } catch (err) {
      if (err.code === "ENOENT") throw new CliError(EXIT.USAGE, ENGAGEMENT_MISSING);
      throw err;
    }
    engagementCache = parseEngagementBlock(text);
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
  });
}
