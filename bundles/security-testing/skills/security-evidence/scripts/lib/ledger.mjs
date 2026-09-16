// lib/ledger.mjs — run allocation and the run lock (TASK-012; spec §6.1
// "`run init` appends {seq, run_id, kind} to ledger/index.json under a
// lock", plan TL-9, TL-14, §3.3 row `lib/ledger.mjs`).
//
// On disk, under `<st>/ledger/` (managed-ignored):
//
//   index.json          a JSON array of `{kind, run_id, seq}` in seq order —
//                       canonical JSON plus LF, rewritten tmp+rename under
//                       `index.lock/`; not an enveloped artifact (no kind in
//                       the envelope vocabulary; its identity never enters a
//                       preimage, TL-14)
//   index.lock/         the allocation mutex (fsx.withLock, mkdir-based)
//   <run_id>.lock/      the run lock — every rewrite of a TL-14 index file
//                       inside `<run>/` happens under it (run-index.appendIndex)
//   <run_id>/imports/   redacted import bytes (imports.snapshotImport, TASK-015)
//
// Why the run lock is `ledger/<run_id>.lock/` and not `<run>/.lock/`: fsx
// leaves transient `.probe-*` / `.stale-*` entries beside a lock dir, and
// fsx.walk() does not hide them — a manifest built while another process
// holds a lock inside the run would list one. `ledger/` is walked by nobody
// (sign-off reads index.json; build-report reads `ledger/<run_id>/` only), so
// the lock and its probes are invisible to every tree listing.
//
//   allocateRun(ctx, {kind, base_oid, head_oid}) → {seq, run_id}
//       under index.lock: seq = max(seq) + 1 (1 when the index is empty; gaps
//       are never refilled), run_id = head_oid[0:12] + "-" + seq (4 digits,
//       TL-9), the entry appended and the index rewritten atomically. Only
//       the ledger is touched; the caller creates the run directory.
//   readIndex(ctx) → entries[]      `[]` when absent; anything off-shape is
//                                    CliError 5 INCONSISTENT(ledger/index.json)
//   listCommittedRuns(ctx)          the entries whose `<run>/COMMITTED` exists
//   withRunLock(ctx, run_id, fn)    fsx.withLock over `ledger/<run_id>.lock/`
//   runIdOf(head_oid, seq), RUN_ID, RUN_KINDS, ledgerPaths(ctx)
//
// Both locks keep the fsx staleMs default (60 s): a shorter window would let
// a slow-but-live allocator be stolen from (see the fsx.mjs header).
//
// Imports: node:fs (read only — writes go through fsx), node:path,
// ../canon.mjs (canonical, parseStrict), ./fsx.mjs, ./exit.mjs, ./tokens.mjs.
// No child process (G-6), no git, no network (G-14), no clock (G-1).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, canonical, parseStrict } from "../canon.mjs";
import { CliError, EXIT } from "./exit.mjs";
import { withLock, writeAtomic } from "./fsx.mjs";
import { COMMITTED, inconsistent } from "./tokens.mjs";

/** `<12 hex>-<4 digits>` (TL-9). */
export const RUN_ID = /^[0-9a-f]{12}-[0-9]{4}$/;
/** The `--kind` vocabulary of `run init` = run.schema.json `template` (plan §4.1). */
export const RUN_KINDS = Object.freeze(["assessment", "review", "verify", "threat-model"]);

const OID = /^[0-9a-f]{40}$/;
const INDEX_FILE = "index.json";
const INDEX_LOCK = "index.lock";
const INDEX_TOKEN = `ledger/${INDEX_FILE}`;
const MAX_SEQ = 9999; // four digits in the run_id (TL-9)

/** Every path under `<st>/ledger/`. */
export function ledgerPaths(ctx) {
  const dir = join(ctx.st, "ledger");
  return { dir, index: join(dir, INDEX_FILE), lock: join(dir, INDEX_LOCK) };
}

/** `<st>/ledger/<run_id>.lock` — the run lock dir (see the header for why it is not under `<run>/`). */
export function runLockPath(ctx, run_id) {
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw new TypeError(`ledger: run_id must be <12 hex>-<4 digits>, got ${String(run_id)}`);
  return join(ledgerPaths(ctx).dir, `${run_id}.lock`);
}

/**
 * `head_oid[0:12] + "-" + seq` zero-padded to four digits (TL-9).
 * @param {string} head_oid 40-hex
 * @param {number} seq 1..9999
 * @returns {string}
 */
export function runIdOf(head_oid, seq) {
  if (typeof head_oid !== "string" || !OID.test(head_oid)) throw new TypeError(`runIdOf: head_oid must be a 40-hex oid, got ${String(head_oid)}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) throw new TypeError(`runIdOf: seq must be an integer 1..${MAX_SEQ}, got ${String(seq)}`);
  return `${head_oid.slice(0, 12)}-${String(seq).padStart(4, "0")}`;
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One index entry, exactly `{kind, run_id, seq}` with the right shapes. */
function entryOk(entry) {
  if (!isPlainRecord(entry)) return false;
  const keys = Object.keys(entry).sort();
  if (keys.length !== 3 || keys[0] !== "kind" || keys[1] !== "run_id" || keys[2] !== "seq") return false;
  return RUN_KINDS.includes(entry.kind) && typeof entry.run_id === "string" && RUN_ID.test(entry.run_id) && Number.isInteger(entry.seq) && entry.seq >= 1;
}

/**
 * The ledger index as `[{kind, run_id, seq}]` in seq order; `[]` when absent.
 * A file this module wrote that no longer parses, or whose entries are off
 * shape, out of order or duplicated, is an integrity failure (exit-5 class),
 * never a usage error.
 * @param {object} ctx
 * @returns {{kind: string, run_id: string, seq: number}[]}
 * @throws {CliError} 5 INCONSISTENT(ledger/index.json)
 */
export function readIndex(ctx) {
  let bytes;
  try {
    bytes = readFileSync(ledgerPaths(ctx).index);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const fail = (cause) => new CliError(EXIT.INTEGRITY, inconsistent(INDEX_TOKEN), cause === undefined ? undefined : { cause });
  let raw;
  try {
    raw = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw fail(err);
    throw err;
  }
  if (!Array.isArray(raw)) throw fail();
  const ids = new Set();
  let last = 0;
  for (const entry of raw) {
    if (!entryOk(entry) || entry.seq <= last || ids.has(entry.run_id)) throw fail();
    last = entry.seq;
    ids.add(entry.run_id);
  }
  return raw;
}

function writeIndex(ctx, entries) {
  writeAtomic(ledgerPaths(ctx).index, Buffer.concat([canonical(entries), Buffer.from("\n")]));
}

/**
 * Allocate the next run: `seq = max + 1`, `run_id = runIdOf(head_oid, seq)`,
 * the entry appended to the index — all under `ledger/index.lock/`, so two
 * concurrent allocators get distinct seqs and neither loses the other's
 * entry. Touches nothing but the index; the run directory is the caller's.
 * @param {object} ctx
 * @param {{kind: string, base_oid: string, head_oid: string}} run
 * @returns {Promise<{seq: number, run_id: string}>}
 * @throws {TypeError} on a bad kind or oid (before the lock is taken)
 * @throws {CliError} 5 when the index is unreadable
 */
export async function allocateRun(ctx, { kind, base_oid, head_oid } = {}) {
  if (!RUN_KINDS.includes(kind)) throw new TypeError(`allocateRun: kind must be one of ${RUN_KINDS.join("|")}, got ${String(kind)}`);
  if (typeof base_oid !== "string" || !OID.test(base_oid)) throw new TypeError(`allocateRun: base_oid must be a 40-hex oid, got ${String(base_oid)}`);
  if (typeof head_oid !== "string" || !OID.test(head_oid)) throw new TypeError(`allocateRun: head_oid must be a 40-hex oid, got ${String(head_oid)}`);
  return withLock(ledgerPaths(ctx).lock, () => {
    const entries = readIndex(ctx);
    const seq = entries.reduce((max, e) => (e.seq > max ? e.seq : max), 0) + 1;
    const run_id = runIdOf(head_oid, seq);
    writeIndex(ctx, [...entries, { kind, run_id, seq }]);
    return { seq, run_id };
  });
}

/**
 * The index entries whose run directory carries the `COMMITTED` marker, in
 * seq order. A run without the marker is incomplete (spec §6.1) and is left
 * to `sign-off` to list as such.
 * @param {object} ctx
 * @returns {{kind: string, run_id: string, seq: number}[]}
 */
export function listCommittedRuns(ctx) {
  return readIndex(ctx).filter((e) => existsSync(join(ctx.st, "runs", e.run_id, COMMITTED)));
}

/**
 * Run `fn` while holding the run's lock (`ledger/<run_id>.lock/`). The one
 * mutex every rewrite of a TL-14 index file in `<run>/` takes (G-10).
 * @template T
 * @param {object} ctx
 * @param {string} run_id
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withRunLock(ctx, run_id, fn) {
  return withLock(runLockPath(ctx, run_id), fn);
}
