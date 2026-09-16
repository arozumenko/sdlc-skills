// lib/verify-steps.mjs — the six I/O steps of `verify.mjs all` (TASK-027;
// spec §6.4 steps 1–6, §2 row 3 "tests execute from a validated test-start
// snapshot"; plan §4.2 row `all`, §5 TASK-027, TL-12; US-018 AC-1…AC-5).
// cmd-verify-all.mjs strings them together; each is callable on its own with
// explicit arguments so the test file can drive one step against the fixture
// repo without allocating a run.
//
//   branchStep(root, {base_oid, head_oid, path})      → COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED
//   worktreeStep(root, head_oid)                       → {dir, tmp, tree_before}
//   removeWorktree(root, {dir, tmp}, log)              always, in the caller's finally
//   installStep({wt, root, head_oid, key, install, timeout_s, env, log})
//                                                      → {install, tested_tree, tests?}
//   suppressionStep(root, {base_oid, head_oid, path, ranges, key})
//                                                      → {indicators[], deletion_only}
//   testsStep({wt, argv, timeout_s, key, env, log})    → the verify `tests` record
//
// Step 1 — branch. `NOT-COMMITTED` when base is not an ancestor of head (the
// head does not build on the base it is verified against, so nothing about
// "the fix" is a committed state on top of base); `PATH-UNTOUCHED` when
// `base..head` changes no line of the finding's path; `COMMITTED` otherwise.
// head == base is PATH-UNTOUCHED (base is its own ancestor; the diff is empty).
//
// Step 2 — worktree. `git worktree add --detach` into a fresh OS temp dir
// (git.worktreeAdd points hooks at a path that cannot exist, so the consumer's
// post-checkout hook never runs there — TASK-006 review 2). `tree_before` is
// the TREE oid of head (`HEAD^{tree}` in the checkout): what the checkout is,
// before anything else touches it. The main work tree is never read for
// bytes and never written (US-018 AC-2).
//
// Step 3 — install (only with `execute_project_tests.install.argv`). The argv
// passes the same allowlist + deny rules as the test argv and runs under the
// same controls (shell:false, minimal env, timeout, process-group kill).
// Afterwards the tree is compared to head: every tracked path git reports as
// changed (`git status --porcelain` in the worktree — a fresh checkout's
// index IS head's tree) is confirmed by HMAC_key(working bytes) ≠
// HMAC_key(blob at head_oid); a change git reports that the bytes do not
// confirm (an eol/smudge filter) is not a change. `tracked_changes` non-empty
// ⇒ `TESTS_INDETERMINATE(install-modified-tree)` and no tests run — unless
// `allow_tracked_changes: true`, in which case `tested_tree = HMAC_key(sorted
// "path\0hmac\n" over every tracked file's working bytes)` is recorded and
// the VERDICT names it (spec §6.4 step 3; G-2: keyed, never a plain hash of
// content). Untracked files the install created (dependencies) are counted
// and summed by size only — never hashed, never listed (`git ls-files
// --others`, ignored files included: that is where dependencies land). An
// install that is denied, cannot be resolved, fails, or times out ⇒
// `TESTS_INDETERMINATE(install-…)`.
//
// Step 4 — suppression over the WHOLE `base..head` diff (git.diffUnified:
// pinned a/ b/ prefixes, no renames, no textconv), not only the finding's
// path. Indicator kinds (plan §4.2, closed): `ignore-file-edit` — every added
// or removed line of a file whose basename is one of the scanner ignore /
// linter config names (`.semgrepignore .trivyignore* .gitleaksignore .snyk
// .bandit .eslintrc* .eslintignore eslint.config.* .semgrep.yml`) or that
// lives under a `.semgrep/` directory (a removed line can suppress too — a
// deleted `no-eval: error` rule — so both sides count, each at its own side's
// line number); `inline-suppress` — every added line matching the marker
// list; `test-skip` — every added line matching the skip list. `line` is the
// RAW diff line number (a citation's lines are normalised, TASK-014; an
// indicator is a diff artefact and keeps git's numbering); a trailing CR is
// dropped from the content so CRLF files hash like LF ones. `id =
// sha256(kind\0path\0line content)`, or — when the content matches a
// redaction rule — `HMAC_key(kind\0path\0redacted content)` with `sensitive:
// true` (§6.5 identity by sensitivity; G-2). Indicators are ordered by the
// diff's file order, then line, then kind.
//
// `deletion_only` (TL-12): the diff of the finding's path removes ≥ 1 line
// inside the cited range and adds zero lines to that file. The cited range
// is in normalised line numbers of the BASE side; it is mapped to raw base
// line numbers through cite-core.lineMap before the removed lines are
// matched. A path absent at base, or absent from the diff, is never
// deletion-only; a path deleted at head is (every cited line was removed) —
// and so is a RENAME of the file (no renames in the diff: a delete plus an
// add elsewhere), which is fail-closed on purpose: moving the vulnerable
// code is not a fix, and the new path needs its own finding.
//
// Step 5 — tests. argv comes only from the operator record (the caller
// passes `engagement.execute_project_tests.argv`; nothing here reads a file
// — D5, G-6). Rules (plan §4.2): the first token is one of
// ALLOWED_EXECUTABLES; no token contains `; | & $ < > \`` or a newline; no
// token equals `-e --eval -c exec`; `run` / `run-script` must be followed by
// `test`. The executable is resolved on the SCRIPTS' own PATH (`./gradlew`
// and other `/`-containing tokens resolve inside the worktree), its sha256
// recorded (plain sha256 over an executable's bytes — the G-2 allowance),
// and spawned as an argv array with `shell: false`, `cwd` = the worktree, env
// = `{PATH, HOME, LANG, TERM=dumb, CI=1, NO_COLOR=1}`, `detached: true` so
// the timeout can SIGTERM the whole process group and SIGKILL it 5 s later.
// Output (stdout + stderr, arrival order) is captured up to CAPTURE_LIMIT,
// redacted as a whole (so no rule ever sees a cut line), then bounded to
// OUTPUT_LIMIT (64 KiB) as whole lines from the head and the tail with an
// omission marker. `TESTS_PASS` on exit 0, `TESTS_FAIL` on any other exit
// code, `TESTS_INDETERMINATE(timeout | executable-not-found | spawn-failed |
// signalled | argv-rejected(…))` otherwise; `NO_TEST_SURFACE` is the
// caller's when the record is absent. `argv_sha256` is
// sha256(canonical(argv)), keyed instead when the argv matches a redaction
// rule (G-2). Known limit: the recorded output is the project's own test
// output, bounded and redacted — a runner that prints its working directory
// puts the (temporary) worktree path into `output_redacted`; nothing this
// bundle writes itself carries that path (G-1 is about the bundle's values).
//
// Imports: node:child_process (spawn — the one child process outside
// git.mjs, argv array, shell:false), node:fs (reads, the temp dir, rmSync
// for the worktree), node:os (tmpdir), node:path, ../canon.mjs, ../redact.mjs,
// ./cite-core.mjs (lineMap), ./git.mjs, ./tokens.mjs. No clock in any
// value that is recorded (setTimeout drives the timeout only; G-1), no
// network (G-14), no console (G-4: `log` is the caller's ctx.log).

import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { canonical, hmacHex, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, matches, redactString } from "../redact.mjs";
import { lineMap } from "./cite-core.mjs";
import { blobOid, diffNameOnly, diffUnified, git, lsFiles, mergeBaseIsAncestor, showBytes, statusPorcelain, worktreeAdd, worktreeRemove } from "./git.mjs";
import {
  BRANCH_COMMITTED,
  BRANCH_NOT_COMMITTED,
  BRANCH_PATH_UNTOUCHED,
  INDICATOR_IGNORE_FILE_EDIT,
  INDICATOR_INLINE_SUPPRESS,
  INDICATOR_TEST_SKIP,
  TESTS_FAIL,
  TESTS_INDETERMINATE,
  TESTS_PASS,
  TESTS_REASON_EXECUTABLE_NOT_FOUND,
  TESTS_REASON_INSTALL_FAILED,
  TESTS_REASON_INSTALL_MODIFIED_TREE,
  TESTS_REASON_SIGNALLED,
  TESTS_REASON_SPAWN_FAILED,
  TESTS_REASON_TIMEOUT,
  argvRejected,
  installArgvRejected,
} from "./tokens.mjs";

/** plan §4.2: the first argv token must be one of these. */
export const ALLOWED_EXECUTABLES = Object.freeze(["npm", "npx", "pnpm", "yarn", "node", "python", "python3", "pytest", "go", "cargo", "mvn", "./gradlew", "gradle", "make", "dotnet"]);
/** plan §4.2: tokens that are denied outright. */
export const DENIED_TOKENS = Object.freeze(["-e", "--eval", "-c", "exec"]);
/** plan §4.2: `run` / `run-script` must be followed by `test`. */
const RUN_TOKENS = Object.freeze(["run", "run-script"]);
const METACHARS = Object.freeze([";", "|", "&", "$", "<", ">", "`", "\n"]);
/** plan §4.2: default timeout, seconds. */
export const DEFAULT_TIMEOUT_S = 600;
/** SIGTERM, then SIGKILL after this many milliseconds (plan §4.2). */
export const KILL_GRACE_MS = 5000;
/** plan §4.2: the recorded output is at most this many bytes. */
export const OUTPUT_LIMIT = 64 * 1024;
/** Bytes of child output retained for redaction before bounding; beyond this the rest is drained and counted. */
export const CAPTURE_LIMIT = 4 * 1024 * 1024;
/** verify.schema.json `tested_tree` when no derived tree was tested. */
export const SAME_AS_HEAD = "same-as-head";

/** Indicator patterns (plan §4.2, closed). Basenames; `.semgrep/**` by directory. */
const IGNORE_FILE_BASENAME = /^(?:\.semgrepignore|\.trivyignore.*|\.gitleaksignore|\.snyk|\.bandit|\.eslintrc.*|\.eslintignore|eslint\.config\..+|\.semgrep\.yml)$/;
export const INLINE_SUPPRESS_RE = /nosec|nosemgrep|eslint-disable|noqa|NOSONAR|gitleaks:allow|trivy:ignore|#pragma warning disable|@SuppressWarnings/;
export const TEST_SKIP_RE = /\.skip\(|\.only\(|xit\(|xdescribe\(|@pytest\.mark\.skip|@Ignore|@Disabled/;

const LF = 0x0a;
const CR = 0x0d;

// --- step 1: branch -----------------------------------------------------------------

/**
 * @param {string} root
 * @param {{base_oid: string, head_oid: string, path: string}} input
 * @returns {"COMMITTED" | "NOT-COMMITTED" | "PATH-UNTOUCHED"}
 */
export function branchStep(root, { base_oid, head_oid, path }) {
  if (!mergeBaseIsAncestor(root, base_oid, head_oid)) return BRANCH_NOT_COMMITTED;
  const changed = diffNameOnly(root, base_oid, head_oid, { paths: [path] });
  return changed.includes(path) ? BRANCH_COMMITTED : BRANCH_PATH_UNTOUCHED;
}

// --- step 2: worktree ---------------------------------------------------------------

/**
 * Detached checkout of `head_oid` under a fresh temp dir.
 * @param {string} root
 * @param {string} head_oid
 * @returns {{dir: string, tmp: string, tree_before: string}}
 */
export function worktreeStep(root, head_oid) {
  const tmp = mkdtempSync(join(tmpdir(), "security-verify-"));
  const dir = join(tmp, "wt");
  try {
    worktreeAdd(root, dir, head_oid);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  const r = git(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{tree}"]);
  const tree_before = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(tree_before)) {
    removeWorktree(root, { dir, tmp }, () => {});
    throw new Error(`verify all: cannot read the tree of the checkout (${r.stderr.trim()})`);
  }
  return { dir, tmp, tree_before };
}

/**
 * Remove the checkout and its temp dir; never throws (the caller is in a
 * finally). A `worktree remove --force` that fails (a nested repository the
 * install created, say) falls back to deleting the directory and pruning.
 * @param {string} root
 * @param {{dir: string, tmp: string}} wt
 * @param {(...parts: unknown[]) => void} log
 */
export function removeWorktree(root, { dir, tmp }, log) {
  try {
    worktreeRemove(root, dir);
  } catch (err) {
    log(`verify all: git worktree remove failed (${err instanceof Error ? err.message : String(err)}); deleting the directory and pruning`);
    rmSync(dir, { recursive: true, force: true });
    try {
      git(root, ["worktree", "prune"]);
    } catch {
      // nothing more to do: the directory is gone; the next worktreeAdd prunes again
    }
  }
  rmSync(tmp, { recursive: true, force: true });
}

// --- argv rules and the child runner ------------------------------------------------

/**
 * plan §4.2 allowlist + deny rules. Pure.
 * @param {unknown} argv
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkArgv(argv) {
  if (!Array.isArray(argv)) return { ok: false, reason: "argv is not an array" };
  for (let i = 0; i < argv.length; i++) {
    if (typeof argv[i] !== "string") return { ok: false, reason: `token ${i} is not a string` };
  }
  if (argv.length === 0) return { ok: false, reason: "empty argv" };
  for (let i = 0; i < argv.length; i++) {
    for (const ch of METACHARS) {
      if (argv[i].includes(ch)) return { ok: false, reason: `token ${i} contains ${ch === "\n" ? "a newline" : ch}` };
    }
  }
  if (!ALLOWED_EXECUTABLES.includes(argv[0])) return { ok: false, reason: "first token is not on the allowlist" };
  for (let i = 1; i < argv.length; i++) {
    if (DENIED_TOKENS.includes(argv[i])) return { ok: false, reason: `token ${argv[i]} is denied` };
  }
  for (let i = 1; i < argv.length; i++) {
    if (RUN_TOKENS.includes(argv[i]) && argv[i + 1] !== "test") return { ok: false, reason: `${argv[i]} without test` };
  }
  return { ok: true };
}

function executableFile(abs) {
  try {
    if (!statSync(abs).isFile()) return false;
    accessSync(abs, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the first argv token: a token containing `/` (`./gradlew`) inside
 * the worktree, anything else on the given PATH (the scripts' own — never
 * the worktree, which is untrusted content). Returns the path and the
 * file's sha256, or null.
 * @param {string} token
 * @param {{cwd: string, path: string}} where
 * @returns {{path: string, sha256: string} | null}
 */
export function resolveExecutable(token, { cwd, path }) {
  if (typeof token !== "string" || token.length === 0) return null;
  const candidates = token.includes("/") ? [resolve(cwd, token)] : (path ?? "").split(delimiter).filter((d) => d.length > 0).map((d) => join(d, token));
  for (const abs of candidates) {
    if (!executableFile(abs)) continue;
    return { path: abs, sha256: sha256Hex(readFileSync(abs)) };
  }
  return null;
}

/** The child's environment (plan §4.2): six names, nothing else of the parent's. */
export function minimalEnv(env) {
  const out = {};
  for (const name of ["PATH", "HOME", "LANG"]) {
    if (typeof env[name] === "string") out[name] = env[name];
  }
  out.TERM = "dumb";
  out.CI = "1";
  out.NO_COLOR = "1";
  return out;
}

/** sha256(canonical(argv)), or HMAC_key when the argv matches a redaction rule (G-2). */
export function argvHash(key, argv) {
  const bytes = canonical(argv);
  return matches(bytes, DEFAULT_RULES) ? hmacHex(key, bytes) : sha256Hex(bytes);
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Spawn `exe` with `argv.slice(1)` in `cwd` under the step-5 controls.
 * Resolves, never rejects: `{code, signal, timed_out, output, dropped}` or
 * `{spawn_error}`.
 */
function runChild({ exe, argv, cwd, env, timeout_s }) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(exe, argv.slice(1), { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      done({ spawn_error: err });
      return;
    }
    const chunks = [];
    let size = 0;
    let dropped = 0;
    const onData = (chunk) => {
      if (size < CAPTURE_LIMIT) {
        const room = CAPTURE_LIMIT - size;
        const take = chunk.length <= room ? chunk : chunk.subarray(0, room);
        chunks.push(take);
        size += take.length;
        dropped += chunk.length - take.length;
      } else {
        dropped += chunk.length;
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let finished = false;
    let timed_out = false;
    let exited = null;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      done(result);
    };
    let killTimer;
    let closeTimer;
    const timer = setTimeout(() => {
      timed_out = true;
      killGroup(child, "SIGTERM");
      killTimer = setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS);
    }, timeout_s * 1000);
    const result = () => ({ code: exited?.code ?? null, signal: exited?.signal ?? null, timed_out, output: Buffer.concat(chunks), dropped });
    child.on("error", (err) => finish({ spawn_error: err, timed_out, output: Buffer.concat(chunks), dropped }));
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      // A grandchild that outlived the kill may still hold the pipes: do not
      // wait on `close` forever once the child itself is gone after a timeout.
      if (timed_out) closeTimer = setTimeout(() => finish(result()), 2000);
    });
    child.on("close", (code, signal) => {
      exited ??= { code, signal };
      finish(result());
    });
  });
}

/**
 * Bound captured output to `limit` bytes: whole lines from the head and the
 * tail around an omission marker. Small output passes through unchanged.
 * @param {Buffer | string} raw
 * @param {number} [limit]
 * @returns {string}
 */
export function boundOutput(raw, limit = OUTPUT_LIMIT) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  if (buf.length <= limit) return buf.toString("utf8");
  const markerRoom = 64;
  const half = Math.max(1, Math.floor((limit - markerRoom) / 2));
  let headEnd = half;
  const lastLf = buf.subarray(0, half).lastIndexOf(LF);
  if (lastLf !== -1) headEnd = lastLf + 1;
  let tailStart = buf.length - half;
  const firstLf = buf.subarray(tailStart).indexOf(LF);
  if (firstLf !== -1) tailStart += firstLf + 1;
  const head = buf.subarray(0, headEnd).toString("utf8");
  const tail = buf.subarray(tailStart).toString("utf8");
  const omitted = tailStart - headEnd;
  return `${head}${head.endsWith("\n") ? "" : "\n"}[... ${omitted} bytes omitted ...]\n${tail}`;
}

/** Redact the whole capture first (no rule ever sees a cut line), then bound; note what was never captured. */
function recordOutput(output, dropped) {
  const redacted = redactString(output, DEFAULT_RULES).text;
  let text = boundOutput(Buffer.from(redacted, "utf8"));
  if (dropped > 0) text += `${text.endsWith("\n") || text.length === 0 ? "" : "\n"}[... ${dropped} bytes beyond the capture limit not recorded ...]\n`;
  return text;
}

const indeterminate = (reason, extra = {}) => ({ result: TESTS_INDETERMINATE, reason, ...extra, timed_out: false, output_redacted: "" });

// --- step 3: install ----------------------------------------------------------------

/** `HMAC_key(sorted "path\0hmac\n")` — the `tested_tree` identity (spec §6.4 step 3). */
export function testedTreeHmac(key, entries) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")));
  return hmacHex(key, Buffer.from(sorted.map((e) => `${e.path}\0${e.hmac}\n`).join(""), "utf8"));
}

/** Working bytes of a tracked path in the worktree: file bytes, a symlink's target, null when gone or a directory (submodule). */
function workingBytes(wt, path) {
  const abs = join(wt, path);
  let st;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  if (st.isSymbolicLink()) return Buffer.from(readlinkSync(abs));
  if (st.isDirectory()) return undefined;
  return readFileSync(abs);
}

/**
 * @param {{wt: string, root: string, head_oid: string, key: Uint8Array, install?: {argv: string[], allow_tracked_changes?: boolean}, timeout_s?: number, env: NodeJS.ProcessEnv, log: (...parts: unknown[]) => void}} input
 * @returns {Promise<{install: object, tested_tree: string, tests?: object}>}
 */
export async function installStep({ wt, root, head_oid, key, install, timeout_s = DEFAULT_TIMEOUT_S, env, log }) {
  const record = { ran: false, allow_tracked_changes: install?.allow_tracked_changes === true, tracked_changes: [], untracked_count: 0, untracked_bytes: 0 };
  if (install === undefined || install === null) return { install: record, tested_tree: SAME_AS_HEAD };

  const check = checkArgv(install.argv);
  if (!check.ok) return { install: record, tested_tree: SAME_AS_HEAD, tests: indeterminate(installArgvRejected(check.reason)) };
  record.argv_sha256 = argvHash(key, install.argv);
  const exe = resolveExecutable(install.argv[0], { cwd: wt, path: env.PATH });
  if (exe === null) {
    log(`verify all: install executable ${install.argv[0]} not found on PATH`);
    return { install: record, tested_tree: SAME_AS_HEAD, tests: indeterminate(TESTS_REASON_INSTALL_FAILED) };
  }
  const r = await runChild({ exe: exe.path, argv: install.argv, cwd: wt, env: minimalEnv(env), timeout_s });
  record.ran = true;
  let failed = false;
  if (r.spawn_error) {
    log(`verify all: install could not be spawned (${r.spawn_error.code ?? r.spawn_error.message})`);
    failed = true;
  } else if (r.timed_out) {
    log(`verify all: install timed out after ${timeout_s} s`);
    failed = true;
  } else if (r.code !== 0) {
    log(`verify all: install exited ${r.code ?? r.signal}`);
    failed = true;
  }

  // the tree after install, compared to head
  const flagged = statusPorcelain(wt)
    .filter((row) => row.xy !== "??" && row.xy !== "!!")
    .map((row) => row.path);
  const tracked = lsFiles(wt);
  const trackedSet = new Set(tracked);
  const tracked_changes = [];
  for (const path of [...new Set(flagged)].sort()) {
    if (!trackedSet.has(path)) continue; // a rename target etc.: only head's paths are "tracked changes"; the new file is counted below
    const working = workingBytes(wt, path);
    if (working === undefined) continue;
    const before = blobOid(root, head_oid, path) === null ? null : showBytes(root, head_oid, path);
    const same = working !== null && before !== null && hmacHex(key, working) === hmacHex(key, before);
    if (!same) tracked_changes.push(path);
  }
  record.tracked_changes = tracked_changes;
  const others = lsFiles(wt, { others: true });
  let untracked_bytes = 0;
  for (const path of others) {
    try {
      untracked_bytes += lstatSync(join(wt, path)).size;
    } catch {
      // vanished between the listing and the stat
    }
  }
  record.untracked_count = others.length;
  record.untracked_bytes = untracked_bytes;

  if (failed) return { install: record, tested_tree: SAME_AS_HEAD, tests: indeterminate(TESTS_REASON_INSTALL_FAILED) };
  if (tracked_changes.length === 0) return { install: record, tested_tree: SAME_AS_HEAD };
  if (!record.allow_tracked_changes) return { install: record, tested_tree: SAME_AS_HEAD, tests: indeterminate(TESTS_REASON_INSTALL_MODIFIED_TREE) };
  const entries = [];
  for (const path of tracked) {
    const working = workingBytes(wt, path);
    if (working === undefined) continue;
    entries.push({ path, hmac: working === null ? "deleted" : hmacHex(key, working) });
  }
  return { install: record, tested_tree: testedTreeHmac(key, entries) };
}

// --- step 4: suppression ------------------------------------------------------------

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

const stripCr = (text) => (text.endsWith("\r") ? text.slice(0, -1) : text);

/**
 * Parse a unified diff into per-file added/removed lines with line numbers
 * (new-side for added, old-side for removed). Pure.
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
    if (!inHunk) {
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
        cur.binary = true;
      } else if (line.startsWith("--- ")) {
        cur.oldPath = diffName(line.slice(4));
      } else if (line.startsWith("+++ ")) {
        cur.path = diffName(line.slice(4));
      } else if (line.startsWith("@@ ")) {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (m) {
          oldLine = Number(m[1]);
          newLine = Number(m[2]);
          inHunk = true;
        }
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
    } else if (line.startsWith("+")) {
      cur.added.push({ line: newLine, text: stripCr(line.slice(1)) });
      newLine++;
    } else if (line.startsWith("-")) {
      cur.removed.push({ line: oldLine, text: stripCr(line.slice(1)) });
      oldLine++;
    } else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file"
    } else if (line === "") {
      // the trailing newline of the diff, or an empty context line in an odd diff
    } else {
      inHunk = false;
    }
  }
  return files;
}

/** Is `path` one of the ignore / linter-config files whose edit is an indicator? */
export function isIgnoreFile(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path === ".semgrep" || path.startsWith(".semgrep/") || path.includes("/.semgrep/")) return true;
  return IGNORE_FILE_BASENAME.test(basename(path));
}

/**
 * The indicator identity (plan §4.2 / spec §6.5): sha256 over the content,
 * keyed over the REDACTED content when a rule matches.
 * @param {Uint8Array} key
 * @param {{kind: string, path: string, line: string}} ind
 * @returns {{id: string, sensitive: boolean}}
 */
export function indicatorId(key, { kind, path, line }) {
  const sensitive = matches(line, DEFAULT_RULES);
  const content = sensitive ? redactString(line, DEFAULT_RULES).text : line;
  const pre = Buffer.from(`${kind}\0${path}\0${content}`, "utf8");
  return { id: sensitive ? hmacHex(key, pre) : sha256Hex(pre), sensitive };
}

/** Raw (1-based) line number of every normalised line of `buf`, in order. */
function rawLineNumbers(buf) {
  const { spans } = lineMap(buf);
  const out = [];
  let raw = 1;
  let i = 0;
  for (const span of spans) {
    while (i < span.start) {
      const b = buf[i];
      if (b === LF) raw++;
      else if (b === CR) {
        raw++;
        if (buf[i + 1] === LF) i++;
      }
      i++;
    }
    out.push(raw);
  }
  return out;
}

/**
 * @param {string} root
 * @param {{base_oid: string, head_oid: string, path: string, ranges: number[][], key: Uint8Array}} input the finding's path and cited ranges (normalised, base side)
 * @returns {{indicators: {id: string, kind: string, path: string, line: number, sensitive?: true}[], deletion_only: boolean}}
 */
export function suppressionStep(root, { base_oid, head_oid, path, ranges, key }) {
  const files = parseUnifiedDiff(diffUnified(root, base_oid, head_oid));
  const found = [];
  const KIND_ORDER = [INDICATOR_IGNORE_FILE_EDIT, INDICATOR_INLINE_SUPPRESS, INDICATOR_TEST_SKIP];
  const push = (kind, at, entry) => {
    const { id, sensitive } = indicatorId(key, { kind, path: at, line: entry.text });
    const row = { id, kind, path: at, line: entry.line };
    if (sensitive) row.sensitive = true;
    found.push(row);
  };
  for (const f of files) {
    if (f.binary === true) continue;
    const at = f.path ?? f.oldPath;
    if (at === null) continue;
    if (isIgnoreFile(at)) {
      for (const e of f.added) push(INDICATOR_IGNORE_FILE_EDIT, at, e);
      for (const e of f.removed) push(INDICATOR_IGNORE_FILE_EDIT, at, e);
    }
    if (f.path === null) continue;
    for (const e of f.added) {
      if (INLINE_SUPPRESS_RE.test(e.text)) push(INDICATOR_INLINE_SUPPRESS, f.path, e);
      if (TEST_SKIP_RE.test(e.text)) push(INDICATOR_TEST_SKIP, f.path, e);
    }
  }
  // diff file order is kept; within a file: line, then kind
  const order = new Map(files.map((f, i) => [f.path ?? f.oldPath, i]));
  found.sort((a, b) => order.get(a.path) - order.get(b.path) || a.line - b.line || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const indicators = found.filter((row, i) => found.findIndex((o) => o.id === row.id) === i);

  let deletion_only = false;
  const entry = files.find((f) => f.oldPath === path || f.path === path);
  if (entry !== undefined && entry.binary !== true && entry.added.length === 0 && entry.removed.length > 0 && blobOid(root, base_oid, path) !== null) {
    const raw = rawLineNumbers(showBytes(root, base_oid, path));
    const rawRanges = [];
    for (const [start, end] of ranges) {
      if (start > raw.length) continue;
      rawRanges.push([raw[start - 1], raw[Math.min(end, raw.length) - 1]]);
    }
    deletion_only = entry.removed.some((r) => rawRanges.some(([s, e]) => r.line >= s && r.line <= e));
  }
  return { indicators, deletion_only };
}

// --- step 5: tests ------------------------------------------------------------------

/**
 * @param {{wt: string, argv: string[], timeout_s?: number, key: Uint8Array, env: NodeJS.ProcessEnv, log: (...parts: unknown[]) => void}} input argv from `engagement.execute_project_tests.argv` only
 * @returns {Promise<object>} the verify `tests` record
 */
export async function testsStep({ wt, argv, timeout_s = DEFAULT_TIMEOUT_S, key, env, log }) {
  const check = checkArgv(argv);
  if (!check.ok) {
    log(`verify all: test argv rejected: ${check.reason}`);
    return indeterminate(argvRejected(check.reason));
  }
  const argv_sha256 = argvHash(key, argv);
  const exe = resolveExecutable(argv[0], { cwd: wt, path: env.PATH });
  if (exe === null) {
    log(`verify all: test executable ${argv[0]} not found on PATH`);
    return indeterminate(TESTS_REASON_EXECUTABLE_NOT_FOUND, { argv_sha256 });
  }
  const r = await runChild({ exe: exe.path, argv, cwd: wt, env: minimalEnv(env), timeout_s });
  const base = { argv_sha256, executable_path: exe.path, executable_sha256: exe.sha256 };
  if (r.spawn_error) {
    log(`verify all: tests could not be spawned (${r.spawn_error.code ?? r.spawn_error.message})`);
    return { result: TESTS_INDETERMINATE, reason: TESTS_REASON_SPAWN_FAILED, ...base, timed_out: false, output_redacted: recordOutput(r.output ?? Buffer.alloc(0), r.dropped ?? 0) };
  }
  const output_redacted = recordOutput(r.output, r.dropped);
  if (r.timed_out) {
    log(`verify all: tests timed out after ${timeout_s} s`);
    const rec = { result: TESTS_INDETERMINATE, reason: TESTS_REASON_TIMEOUT, ...base, timed_out: true, output_redacted };
    if (Number.isInteger(r.code)) rec.exit_code = r.code;
    return rec;
  }
  if (!Number.isInteger(r.code)) {
    log(`verify all: tests ended by signal ${r.signal}`);
    return { result: TESTS_INDETERMINATE, reason: TESTS_REASON_SIGNALLED, ...base, timed_out: false, output_redacted };
  }
  return { result: r.code === 0 ? TESTS_PASS : TESTS_FAIL, ...base, exit_code: r.code, timed_out: false, output_redacted };
}
