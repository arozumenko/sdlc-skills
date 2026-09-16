// lib/fsx.mjs — the file-system primitives every writer uses (TASK-006,
// plan §3.3). Nothing under a run is rewritten except through these:
//
//   writeExclusive(path, bytes, mode)   `wx` — write-once files (G-10); EEXIST is the caller's signal
//   appendLine(path, line)              `a` + one writeSync — the register log and index lines
//   writeAtomic(path, bytes)            tmp + rename — the TL-14 index files, projections
//   withLock(dir, fn, opts)             mkdir-based mutex, async fn; withLockSync for sync callers
//   walk(dir)                           sorted posix-relative file list
//   rmTree(path)                        recursive, idempotent
//
// The lock is `mkdirSync(lockDir)`: atomic on every platform, no O_EXCL file
// dance, no PID file to trust. Acquisition polls with a 20 ms backoff and a
// 10 s timeout; a lock whose mtime is older than 60 s is treated as
// abandoned (a crashed holder) and reclaimed. Reclaim is rename-then-rm, so
// of N waiters that all judge the lock stale exactly one wins the rename and
// the others see ENOENT — nobody can rm a lock a rival just re-created.
// Consequence, by design: a *legitimate* holder that keeps the lock for more
// than 60 s (staleMs) will have it stolen; keep critical sections short or
// raise staleMs for the call. A second, narrower window: between isStale()
// judging the lock abandoned and renameSync() taking it, the old holder can
// release and a new holder re-take it — the mtime is then fresh but the
// decision was already made, and the new holder is stolen from. Both windows
// shrink with a long staleMs and short critical sections; callers must not
// lower staleMs (TASK-012's ledger lock included). Staleness is judged with the
// file system's clock — the mtime of a probe file written next to the lock —
// so this module never reads the wall clock (G-1 keeps that read inside
// ctx.now()). Elapsed time for the timeout is `performance.now()`, a
// monotonic counter, not a clock.
//
// Transient names this module creates beside a lock or a target file:
// `<lockDir>.probe-*` (fsNowMs), `<lockDir>.stale-*` (reclaim) and the
// writeAtomic tmp file. walk() does not hide them — a manifest built
// concurrently would list one — so keep lock dirs outside walked trees
// (`<st>/ledger/index.lock/` is fine; a lock under `<run>/` is not).
//
// Imports only node:*. No child process (G-6), no network (G-14).

import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Thrown by withLock / withLockSync when the lock is not free within timeoutMs. */
export class LockTimeoutError extends Error {
  constructor(lockDir, timeoutMs) {
    super(`lock ${lockDir} not acquired within ${timeoutMs} ms`);
    this.name = "LockTimeoutError";
    this.lockDir = lockDir;
    this.timeoutMs = timeoutMs;
  }
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function toBytes(bytes, fn) {
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  if (bytes instanceof Uint8Array) return bytes;
  throw new TypeError(`${fn}: bytes must be a Buffer or a string, got ${bytes === null ? "null" : typeof bytes}`);
}

/**
 * Create `path` with `bytes`; fails with `EEXIST` if it already exists (write-once).
 * @param {string} path
 * @param {Uint8Array | string} bytes
 * @param {number} [mode] default 0o644; keys use 0o600
 */
export function writeExclusive(path, bytes, mode = 0o644) {
  ensureParent(path);
  writeFileSync(path, toBytes(bytes, "writeExclusive"), { flag: "wx", mode });
}

/**
 * Append one line (`line + "\n"`) with a single writeSync on an `a`-mode fd,
 * so concurrent appenders never interleave inside a line.
 * @param {string} path
 * @param {string} line must not contain a newline
 */
export function appendLine(path, line) {
  if (typeof line !== "string") throw new TypeError("appendLine: line must be a string");
  if (line.includes("\n")) throw new TypeError("appendLine: line must not contain a newline");
  ensureParent(path);
  const fd = openSync(path, "a", 0o644);
  try {
    writeSync(fd, Buffer.from(`${line}\n`, "utf8"));
  } finally {
    closeSync(fd);
  }
}

let tmpCounter = 0;

/**
 * Replace `path` atomically: write a sibling tmp file (`wx`), then rename over.
 * A failure at any step removes the tmp file and rethrows.
 * @param {string} path
 * @param {Uint8Array | string} bytes
 * @param {{mode?: number}} [options]
 */
export function writeAtomic(path, bytes, { mode = 0o644 } = {}) {
  const data = toBytes(bytes, "writeAtomic");
  ensureParent(path);
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${++tmpCounter}`);
  try {
    writeFileSync(tmp, data, { flag: "wx", mode });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// locks

const DEFAULTS = Object.freeze({ timeoutMs: 10_000, staleMs: 60_000, backoffMs: 20 });

/** "Now" according to the file system: the mtime of a probe written next to the lock. */
function fsNowMs(lockDir) {
  const probe = `${lockDir}.probe-${process.pid}-${++tmpCounter}`;
  writeFileSync(probe, "", { flag: "wx" });
  try {
    return statSync(probe).mtimeMs;
  } finally {
    rmSync(probe, { force: true });
  }
}

function isStale(lockDir, staleMs) {
  let held;
  try {
    held = statSync(lockDir).mtimeMs;
  } catch (err) {
    if (err.code === "ENOENT") return false; // released meanwhile; the next attempt will take it
    throw err;
  }
  return fsNowMs(lockDir) - held > staleMs;
}

/** One acquisition attempt. `attempt` drives how often staleness is checked (about once per second at 20 ms backoff). */
function tryAcquire(lockDir, staleMs, attempt) {
  try {
    mkdirSync(lockDir);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      mkdirSync(dirname(lockDir), { recursive: true });
      return false;
    }
    if (err.code !== "EEXIST") throw err;
  }
  if (attempt % 50 === 0 && isStale(lockDir, staleMs)) reclaim(lockDir);
  return false;
}

/**
 * Take a stale lock away without racing another reclaimer: rename it aside
 * (atomic; only one caller can win) and remove the renamed dir. ENOENT on
 * the rename means someone else already reclaimed it — that is fine.
 */
function reclaim(lockDir) {
  const aside = `${lockDir}.stale-${process.pid}-${++tmpCounter}`;
  try {
    renameSync(lockDir, aside);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  rmSync(aside, { recursive: true, force: true });
}

function release(lockDir) {
  rmSync(lockDir, { recursive: true, force: true });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding `lockDir` (created with mkdir; removed afterwards,
 * also when fn throws). `fn` may be sync or async; the result is awaited.
 * @template T
 * @param {string} lockDir
 * @param {() => T | Promise<T>} fn
 * @param {{timeoutMs?: number, staleMs?: number, backoffMs?: number}} [options]
 * @returns {Promise<T>}
 * @throws {LockTimeoutError}
 */
export async function withLock(lockDir, fn, options = {}) {
  const { timeoutMs, staleMs, backoffMs } = { ...DEFAULTS, ...options };
  const start = performance.now();
  for (let attempt = 0; !tryAcquire(lockDir, staleMs, attempt); attempt++) {
    if (performance.now() - start >= timeoutMs) throw new LockTimeoutError(lockDir, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  try {
    return await fn();
  } finally {
    release(lockDir);
  }
}

/**
 * Synchronous twin of withLock for callers that cannot await (the backoff
 * blocks the thread with Atomics.wait, so never use it for in-process
 * concurrency — two sync waiters in one process cannot hand over).
 * @template T
 * @param {string} lockDir
 * @param {() => T} fn
 * @param {{timeoutMs?: number, staleMs?: number, backoffMs?: number}} [options]
 * @returns {T}
 * @throws {LockTimeoutError}
 */
export function withLockSync(lockDir, fn, options = {}) {
  const { timeoutMs, staleMs, backoffMs } = { ...DEFAULTS, ...options };
  const start = performance.now();
  for (let attempt = 0; !tryAcquire(lockDir, staleMs, attempt); attempt++) {
    if (performance.now() - start >= timeoutMs) throw new LockTimeoutError(lockDir, timeoutMs);
    sleepSync(backoffMs);
  }
  try {
    return fn();
  } finally {
    release(lockDir);
  }
}

// ---------------------------------------------------------------------------
// trees

/** UTF-8 byte order (what canon uses for keys), not UTF-16 code-unit order. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Every file under `dir`, as posix paths relative to `dir`, sorted by UTF-8
 * byte order (so a list that feeds a manifest sorts the way canon sorts).
 * Symlinks are listed as files, never followed. A missing dir is `[]`.
 * @param {string} dir
 * @returns {string[]}
 */
export function walk(dir) {
  const out = [];
  const visit = (abs, rel) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT" && rel === "") return;
      throw err;
    }
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else out.push(childRel);
    }
  };
  visit(dir, "");
  return out.sort(compareBytes);
}

/** Remove a file or directory tree; a missing path is not an error. */
export function rmTree(path) {
  rmSync(path, { recursive: true, force: true });
}
