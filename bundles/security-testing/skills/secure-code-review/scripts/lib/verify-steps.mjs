// lib/verify-steps.mjs — the pure and I/O pieces `verify.mjs` composes
// (spec §6 `verify.mjs` steps 3–4): the test-argv allowlist, the test run,
// the output bound, the unified-diff parser and the suppression / skip
// indicator patterns. Ported from the reference implementation's
// verify-steps.mjs and trimmed to what the spec names — no worktree, no
// install step, no keyed identities (D4).
//
// The test argv comes only from `engagement.md` `execute_project_tests.argv`
// (the caller reads it; nothing here reads a file). `checkArgv` refuses a
// first token off ALLOWED_EXECUTABLES, a token equal to one of
// DENIED_TOKENS, a `run`/`run-script` not followed by `test`, and any token
// carrying a shell metacharacter. `runTests` spawns the argv array with
// `shell: false` in the project's own checkout (D4) under `minimalEnv` —
// PATH, HOME, LANG and three fixed values, nothing else of the parent's.
// Output is the caller's to redact before it is written.
//
// Imports only node:*; no redaction, no git, no clock beyond the duration.

import { spawnSync } from "node:child_process";

/** The first argv token must be one of these. */
export const ALLOWED_EXECUTABLES = Object.freeze(["npm", "npx", "pnpm", "yarn", "node", "python", "python3", "pytest", "go", "cargo", "mvn", "./gradlew", "gradle", "make", "dotnet"]);
/** Tokens that are denied outright — an inline program is not a test surface. */
export const DENIED_TOKENS = Object.freeze(["-e", "--eval", "-c", "exec"]);
/** `run` / `run-script` must be followed by `test`. */
const RUN_TOKENS = Object.freeze(["run", "run-script"]);
const METACHARS = Object.freeze([";", "|", "&", "$", "<", ">", "`", "\n"]);
/** Default test timeout, seconds. */
export const DEFAULT_TIMEOUT_S = 600;
/** The recorded output (`tests.log`) is at most this many bytes. */
export const OUTPUT_LIMIT = 64 * 1024;
/** Bytes of child output retained before bounding. */
const CAPTURE_LIMIT = 64 << 20;

/** An added line matching one of these is an `ADVISORY <path>:<line> <kind>` (never a gate). */
export const INLINE_SUPPRESS_RE = /nosec|nosemgrep|eslint-disable|noqa|NOSONAR|gitleaks:allow|trivy:ignore|#pragma warning disable|@SuppressWarnings/;
export const TEST_SKIP_RE = /\.skip\(|\.only\(|xit\(|xdescribe\(|@pytest\.mark\.skip|@Ignore|@Disabled/;

const LF = 0x0a;

/** The test argv is rejected; `.message` says why (never echoes a token beyond its index or the denied word). */
export class ArgvError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArgvError";
  }
}

/**
 * Allowlist + deny rules. Pure. Returns the argv it was given when it passes.
 * @param {unknown} argv
 * @returns {string[]}
 * @throws {ArgvError}
 */
export function checkArgv(argv) {
  if (!Array.isArray(argv)) throw new ArgvError("argv is not an array");
  argv.forEach((t, i) => {
    if (typeof t !== "string") throw new ArgvError(`token ${i} is not a string`);
  });
  if (argv.length === 0) throw new ArgvError("empty argv");
  argv.forEach((t, i) => {
    for (const ch of METACHARS) if (t.includes(ch)) throw new ArgvError(`token ${i} contains ${ch === "\n" ? "a newline" : ch}`);
  });
  if (!ALLOWED_EXECUTABLES.includes(argv[0])) throw new ArgvError("first token is not on the allowlist");
  for (let i = 1; i < argv.length; i++) {
    if (DENIED_TOKENS.includes(argv[i])) throw new ArgvError(`token ${argv[i]} is denied`);
    if (RUN_TOKENS.includes(argv[i]) && argv[i + 1] !== "test") throw new ArgvError(`${argv[i]} without test`);
  }
  return argv;
}

/**
 * The child's environment: three names from `env`, three fixed values.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}
 */
export function minimalEnv(env) {
  const out = {};
  for (const name of ["PATH", "HOME", "LANG"]) if (typeof env[name] === "string") out[name] = env[name];
  out.TERM = "dumb";
  out.CI = "1";
  out.NO_COLOR = "1";
  return out;
}

/**
 * Bound output to `limit` bytes: whole lines from the head and the tail
 * around an omission marker. Small output passes through unchanged.
 * @param {Buffer | string} raw
 * @param {number} [limit]
 * @returns {string}
 */
export function boundOutput(raw, limit = OUTPUT_LIMIT) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  if (buf.length <= limit) return buf.toString("utf8");
  const half = Math.max(1, Math.floor((limit - 64) / 2));
  let headEnd = half;
  const lastLf = buf.subarray(0, half).lastIndexOf(LF);
  if (lastLf !== -1) headEnd = lastLf + 1;
  let tailStart = buf.length - half;
  const firstLf = buf.subarray(tailStart).indexOf(LF);
  if (firstLf !== -1) tailStart += firstLf + 1;
  const head = buf.subarray(0, headEnd).toString("utf8");
  const tail = buf.subarray(tailStart).toString("utf8");
  return `${head}${head.endsWith("\n") ? "" : "\n"}[... ${tailStart - headEnd} bytes omitted ...]\n${tail}`;
}

/**
 * Run the project's tests: `argv[0]` with the rest as its arguments,
 * `shell: false`, cwd = the checkout, env = `minimalEnv`. A non-zero exit is
 * data; a timeout or a signal leaves `exit` null and sets `timed_out` /
 * `signal`; a spawn failure (executable not found) leaves `exit` null with
 * the error code as the output.
 * @param {{root: string, argv: string[], timeout_s?: number, env?: NodeJS.ProcessEnv}} input
 * @returns {{exit: number | null, duration_ms: number, output: string, timed_out: boolean, signal: string | null}}
 */
export function runTests({ root, argv, timeout_s = DEFAULT_TIMEOUT_S, env = process.env }) {
  checkArgv(argv);
  const started = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { cwd: root, shell: false, env: minimalEnv(env), timeout: timeout_s * 1000, killSignal: "SIGTERM", maxBuffer: CAPTURE_LIMIT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const duration_ms = Date.now() - started;
  const timed_out = r.error !== undefined && r.error.code === "ETIMEDOUT";
  const parts = [r.stdout, r.stderr].filter((b) => b !== undefined && b !== null && b.length > 0);
  let output = Buffer.concat(parts).toString("utf8");
  if (r.error !== undefined && !timed_out) output += `${output.length > 0 && !output.endsWith("\n") ? "\n" : ""}[spawn failed: ${r.error.code ?? r.error.message}]\n`;
  return { exit: typeof r.status === "number" ? r.status : null, duration_ms, output, timed_out, signal: r.signal ?? null };
}

function diffName(raw) {
  if (raw === "/dev/null") return null;
  const name = raw.replace(/\t.*$/, "");
  return name.startsWith("a/") || name.startsWith("b/") ? name.slice(2) : name;
}

/** `diff --git a/<path> b/<path>` (no renames ⇒ both sides are the same path). */
function diffGitPath(line) {
  const rest = line.slice("diff --git ".length);
  const at = rest.lastIndexOf(" b/");
  if (at === -1) return null;
  const a = rest.slice(0, at);
  return a.startsWith("a/") ? a.slice(2) : a;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const stripCr = (text) => (text.endsWith("\r") ? text.slice(0, -1) : text);

/**
 * Parse a unified diff into per-file added/removed lines with line numbers
 * (new-side for added, old-side for removed). `path` is null for a deleted
 * file, `oldPath` null for a created one. Pure.
 * @param {string} text
 * @returns {{path: string | null, oldPath: string | null, added: {line: number, text: string}[], removed: {line: number, text: string}[], binary?: true}[]}
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const p = diffGitPath(line);
      cur = { path: p, oldPath: p, added: [], removed: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (cur === null) continue;
    const hunk = line.startsWith("@@ ") ? HUNK.exec(line) : null;
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) cur.binary = true;
      else if (line.startsWith("--- ")) cur.oldPath = diffName(line.slice(4));
      else if (line.startsWith("+++ ")) cur.path = diffName(line.slice(4));
      continue;
    }
    if (line.startsWith("+")) cur.added.push({ line: newLine++, text: stripCr(line.slice(1)) });
    else if (line.startsWith("-")) cur.removed.push({ line: oldLine++, text: stripCr(line.slice(1)) });
    else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    } else if (line !== "" && !line.startsWith("\\")) inHunk = false; // "\ No newline at end of file" and the diff's trailing LF stay in the hunk
  }
  return files;
}
