// lib/git.mjs — every git call the scripts make. A child process is always
// `execFileSync("git", argv, {cwd, env, shell: false})` with an argv array —
// no shell, no string interpolation, no inherited environment: `gitEnv()`
// builds the child's env from a fixed whitelist so a consumer's `GIT_DIR`,
// `GIT_WORK_TREE` or pager can never redirect a call, and prompts are off.
// Non-zero exits are data: `git()` returns `{stdout, stderr, code}`, `must()`
// turns a non-zero code into `GitError`, and the typed helpers decide what a
// non-zero code means. Only a process that could not run at all throws from
// `git()` itself. Imports only node:*; no clock, no network.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** git could not run, or a typed helper met a state it cannot report as data. */
export class GitError extends Error {
  /**
   * @param {string} message
   * @param {{argv?: string[], code?: number|null, stderr?: string}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = "GitError";
    if (info.argv) this.argv = info.argv;
    if (info.code !== undefined) this.code = info.code;
    if (info.stderr !== undefined) this.stderr = info.stderr;
  }
}

/** Variables the child inherits — nothing else. */
const ENV_PASSTHROUGH = Object.freeze([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "GIT_SSL_CAINFO",
  "SSL_CERT_FILE",
]);

/**
 * The child environment: the whitelist above from `source`, plus fixed
 * values that make output stable and non-interactive.
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {Record<string, string>}
 */
export function gitEnv(source = process.env) {
  const env = {};
  for (const key of ENV_PASSTHROUGH) {
    if (typeof source[key] === "string") env[key] = source[key];
  }
  env.LC_ALL = "C";
  env.TERM = "dumb";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  return env;
}

/**
 * Run git with an argv array in `root`.
 * @param {string} root explicit cwd
 * @param {string[]} argv
 * @param {{input?: string | Uint8Array, encoding?: "utf8" | "buffer", env?: NodeJS.ProcessEnv}} [options]
 * @returns {{stdout: string | Buffer, stderr: string, code: number}}
 * @throws {GitError} when git cannot be run at all
 */
export function git(root, argv, { input, encoding = "utf8", env } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("git: root must be a non-empty path");
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string")) throw new TypeError("git: argv must be an array of strings");
  const opts = {
    cwd: root,
    env: gitEnv(env),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  };
  if (input !== undefined) opts.input = input;
  try {
    const stdout = execFileSync("git", argv, opts);
    return { stdout: encoding === "buffer" ? stdout : stdout.toString("utf8"), stderr: "", code: 0 };
  } catch (err) {
    if (typeof err.status === "number") {
      const stdout = err.stdout ?? Buffer.alloc(0);
      return {
        stdout: encoding === "buffer" ? Buffer.from(stdout) : Buffer.from(stdout).toString("utf8"),
        stderr: Buffer.from(err.stderr ?? "").toString("utf8"),
        code: err.status,
      };
    }
    throw new GitError(`git ${argv.join(" ")} could not run in ${root}: ${err.message}`, { argv, code: null });
  }
}

/**
 * Run git and throw GitError on a non-zero exit.
 * @param {string} root
 * @param {string[]} argv
 * @param {Parameters<typeof git>[2]} [options]
 * @returns {{stdout: string | Buffer, stderr: string, code: 0}}
 * @throws {GitError}
 */
export function must(root, argv, options) {
  const r = git(root, argv, options);
  if (r.code !== 0) throw new GitError(`git ${argv.join(" ")} failed (${r.code}): ${r.stderr.trim()}`, { argv, code: r.code, stderr: r.stderr });
  return r;
}

/** Split NUL-terminated output into entries (empty trailing entry dropped). */
function splitZ(text) {
  return text.length === 0 ? [] : text.split("\0").filter((s) => s.length > 0);
}

/**
 * Top-level directory of the work tree containing `cwd`, or null when `cwd`
 * is not inside a git work tree (a bare repo or `.git` dir counts as outside).
 * @param {string} cwd
 * @returns {string | null}
 */
export function toplevel(cwd) {
  let r;
  try {
    r = git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }
  if (r.code !== 0) return null;
  const top = r.stdout.trim();
  return top.length === 0 ? null : resolve(top);
}

/**
 * Resolve a ref to a full commit oid.
 * @param {string} root
 * @param {string} ref
 * @returns {string} 40-hex
 * @throws {GitError} unknown ref
 */
export function revParse(root, ref) {
  const r = git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const oid = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(oid)) throw new GitError(`unknown ref ${JSON.stringify(ref)}`, { argv: ["rev-parse", ref], code: r.code, stderr: r.stderr });
  return oid;
}

/**
 * Bytes of `path` at commit `oid`.
 * @param {string} root
 * @param {string} oid
 * @param {string} path repo-relative
 * @returns {Buffer}
 * @throws {GitError} when absent
 */
export function showBytes(root, oid, path) {
  return must(root, ["cat-file", "blob", "--end-of-options", `${oid}:${path}`], { encoding: "buffer" }).stdout;
}

/**
 * `git status --porcelain=v1 -z` rendered as porcelain lines, `"XY path"`;
 * a rename or copy renders as `"XY orig -> path"` (git's own non-z form).
 * `-z` is used so paths are never quoted. Empty when clean.
 * @param {string} root
 * @param {{paths?: string[]}} [options] pathspec limit
 * @returns {string[]}
 */
export function statusPorcelain(root, { paths = [] } = {}) {
  // -z reports a rename or copy as two entries, `R  new` then `old`. The
  // rename can sit in either column: X for a staged rename (`R `), Y for a
  // work-tree-side one (` R`, e.g. `mv a b; git add -N b`).
  const argv = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (paths.length) argv.push("--", ...paths);
  const entries = splitZ(must(root, argv).stdout);
  const lines = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") {
      lines.push(`${xy} ${entries[++i]} -> ${path}`);
    } else {
      lines.push(`${xy} ${path}`);
    }
  }
  return lines;
}

/**
 * `git ls-files -z` with the flags the scripts need.
 * @param {string} root
 * @param {{stage?: boolean, others?: boolean, excludeStandard?: boolean, ignored?: boolean, paths?: string[]}} [options]
 * @returns {string[]} paths (or `<mode> <oid> <stage>\t<path>` lines with `stage`)
 */
export function lsFiles(root, { stage = false, others = false, excludeStandard = false, ignored = false, paths = [] } = {}) {
  const argv = ["ls-files", "-z"];
  if (stage) argv.push("--stage");
  if (others) argv.push("--others");
  if (excludeStandard) argv.push("--exclude-standard");
  if (ignored) argv.push("--ignored");
  if (paths.length) argv.push("--", ...paths);
  return splitZ(must(root, argv).stdout);
}

/**
 * Paths changed between two commits.
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @param {{paths?: string[]}} [options]
 * @returns {string[]}
 */
export function diffNameOnly(root, base, head, { paths = [] } = {}) {
  const argv = ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", base, head];
  if (paths.length) argv.push("--", ...paths);
  return splitZ(must(root, argv).stdout);
}

/**
 * Unified diff between two commits, optionally for one path. Colour, external
 * diff drivers and textconv are off so the output is the bytes git compares;
 * the `a/` `b/` header prefixes and the short submodule format are pinned so
 * a consumer's `diff.noprefix`, `diff.mnemonicPrefix` or `diff.submodule`
 * cannot change the `+++ b/<path>` line or the hunk body a parser keys on.
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @param {string} [path]
 * @returns {string}
 */
export function diffUnified(root, base, head, path) {
  const argv = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--submodule=short", "--end-of-options", base, head];
  if (path !== undefined) argv.push("--", path);
  return must(root, argv).stdout;
}

/**
 * True when `ancestor` is an ancestor of (or equal to) `descendant`.
 * @param {string} root
 * @param {string} ancestor
 * @param {string} descendant
 * @returns {boolean}
 */
export function mergeBaseIsAncestor(root, ancestor, descendant) {
  const r = git(root, ["merge-base", "--is-ancestor", "--end-of-options", ancestor, descendant]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new GitError(`git merge-base --is-ancestor failed (${r.code}): ${r.stderr.trim()}`, { code: r.code, stderr: r.stderr });
}
