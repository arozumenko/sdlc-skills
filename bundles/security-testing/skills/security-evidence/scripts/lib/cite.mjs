// lib/cite.mjs — side-aware citation resolution (TASK-014; plan §3.3 row
// `lib/cite.mjs`, §5 TASK-014; spec §6.2 "Every citation carries side: base |
// head | snapshot and is resolved against that side's bytes"; US-009 AC-5).
//
// One resolver for `gate`, `packet`, `check`, `verify`, `ingest sarif` and
// `tm-lint`. The rules that need no I/O (range rule, occurrence, raw bytes of
// a range) live in cite-core.mjs and are re-exported below, so `lib/cite.mjs`
// is the one import a consumer needs. This file adds the two reads:
//
//   resolveSide(ctx, run, scope, {path, side}) → Buffer
//     base | head  git cat-file blob <base_oid|head_oid>:<path> — after
//                  git.blobOid has verified the object is a blob (a tree at
//                  that path is ObjectMissing, never tree bytes); the scope
//                  is not consulted: `base` has no scope entry by design
//                  (deleted code), and a git blob at an immutable oid needs
//                  no cross-check
//     snapshot     <st>/private/snapshots/<run_id>/<path>, the REDACTED bytes
//                  cmd-scope persisted; the scope must record the path under
//                  `snapshot` (else SnapshotMissing), the file must exist
//                  (else SnapshotMissing) and its sha256 must equal the
//                  recorded `redacted_sha256` (else SnapshotMismatch) — so no
//                  consumer hashes or cites tampered snapshot bytes. Plain
//                  sha256 over redacted bytes is the G-2 allowance.
//   resolveWorking(ctx, path) → Buffer | null
//     the working-tree file for `check --drift`; null when there is no
//     regular file at the path (absent, a directory, a symlink — scope never
//     follows links, so drift does not either).
//
// `run` is the run artifact (`{envelope, payload}` — run_id from the
// envelope) or the ingest-adapter shape `{run_id, dir, envelope, payload}`.
// `scope` is the scope artifact or its payload. `path` is a repo-relative
// posix path exactly as scope.json spells it: no `..`, no leading `/` or
// `./`, no `\`, no empty segment, no NUL — anything else is a caller bug
// (TypeError), because the path is joined under root / the snapshot dir.
//
// Imports: node:fs (lstatSync, readFileSync — reads only), node:path,
// ../canon.mjs (sha256Hex), ./git.mjs (blobOid, showBytes: the only git
// calls, G-6), ./ledger.mjs (RUN_ID), ./cite-core.mjs. No writes, no clock
// (G-1), no network (G-14). Never prints: errors are typed for the caller.

import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../canon.mjs";
import { SIDES } from "./cite-core.mjs";
import { blobOid, showBytes } from "./git.mjs";
import { RUN_ID } from "./ledger.mjs";

export { MAX_RANGE_LINES, SIDES, TYPED_ROLES, checkRange, lineMap, occurrenceOf, rangeBytes } from "./cite-core.mjs";

const OID = /^[0-9a-f]{40}$/;

/** Base class of the three resolution failures, so a caller can catch them together. */
export class CiteError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

/** `side: snapshot` and the scope did not record a snapshot for the path, or the file is gone. */
export class SnapshotMissing extends CiteError {
  constructor(run_id, path, why) {
    super(`snapshot for ${path} in run ${run_id} ${why}`);
    this.run_id = run_id;
    this.path = path;
  }
}

/** `side: snapshot` and the file's sha256 is not the recorded `redacted_sha256`. */
export class SnapshotMismatch extends CiteError {
  constructor(run_id, path, expected, actual) {
    super(`snapshot for ${path} in run ${run_id} is not the recorded bytes (expected sha256 ${expected}, got ${actual})`);
    this.run_id = run_id;
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

/** `side: base|head` and there is no blob at `<oid>:<path>` (absent, or a tree). */
export class ObjectMissing extends CiteError {
  constructor(side, oid, path) {
    super(`no blob at ${side} ${oid}:${path}`);
    this.side = side;
    this.oid = oid;
    this.path = path;
  }
}

/** A repo-relative posix path as scope.json spells it; anything else is a caller bug. */
function requireRepoPath(where, path) {
  if (typeof path !== "string" || path === "") throw new TypeError(`${where}: path must be a non-empty string`);
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/")) throw new TypeError(`${where}: path must be a repo-relative posix path, got ${JSON.stringify(path)}`);
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) throw new TypeError(`${where}: path must not contain empty, "." or ".." segments, got ${JSON.stringify(path)}`);
  return path;
}

function requireSide(where, side) {
  if (!SIDES.includes(side)) throw new TypeError(`${where}: side must be one of ${SIDES.join("|")}, got ${String(side)}`);
  return side;
}

function runId(run) {
  const id = run !== null && typeof run === "object" ? (run.run_id ?? run.envelope?.run_id) : undefined;
  if (typeof id !== "string" || !RUN_ID.test(id)) throw new TypeError("resolveSide: run must carry run_id (envelope.run_id or run_id)");
  return id;
}

function runOid(run, side) {
  const payload = run !== null && typeof run === "object" ? (run.payload ?? run) : undefined;
  const oid = payload !== null && typeof payload === "object" ? payload[`${side}_oid`] : undefined;
  if (typeof oid !== "string" || !OID.test(oid)) throw new TypeError(`resolveSide: run payload must carry ${side}_oid`);
  return oid;
}

function scopeSnapshot(scope) {
  const p = scope !== null && typeof scope === "object" && scope.payload !== undefined && scope.envelope !== undefined ? scope.payload : scope;
  if (p === null || typeof p !== "object") throw new TypeError("resolveSide: scope must be a scope payload or its artifact");
  return p.snapshot !== null && typeof p.snapshot === "object" ? p.snapshot : {};
}

/**
 * The bytes a citation is resolved against (spec §6.2).
 * @param {object} ctx
 * @param {object} run run artifact, or `{run_id, dir, envelope, payload}`
 * @param {object} scope scope artifact or payload
 * @param {{path: string, side: "base"|"head"|"snapshot"}} citation
 * @returns {Buffer}
 * @throws {ObjectMissing|SnapshotMissing|SnapshotMismatch} typed, for the caller to record
 * @throws {TypeError} on a caller bug (side vocabulary, path shape, run shape)
 */
export function resolveSide(ctx, run, scope, { path, side } = {}) {
  requireSide("resolveSide", side);
  requireRepoPath("resolveSide", path);
  if (side === "snapshot") {
    const run_id = runId(run);
    const recorded = scopeSnapshot(scope);
    if (!Object.hasOwn(recorded, path) || recorded[path] === null || typeof recorded[path] !== "object") throw new SnapshotMissing(run_id, path, "was not recorded by scope");
    let bytes;
    try {
      bytes = readFileSync(join(ctx.st, "private", "snapshots", run_id, path));
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "EISDIR") throw new SnapshotMissing(run_id, path, "is not on disk");
      throw err;
    }
    const actual = sha256Hex(bytes);
    const expected = recorded[path].redacted_sha256;
    if (actual !== expected) throw new SnapshotMismatch(run_id, path, expected, actual);
    return bytes;
  }
  const oid = runOid(run, side);
  if (blobOid(ctx.root, oid, path) === null) throw new ObjectMissing(side, oid, path);
  return showBytes(ctx.root, oid, path);
}

/**
 * The working-tree bytes of `path` for `check --drift`, or null when no
 * regular file is there (absent, directory, symlink).
 * @param {object} ctx
 * @param {string} path repo-relative
 * @returns {Buffer|null}
 */
export function resolveWorking(ctx, path) {
  requireRepoPath("resolveWorking", path);
  const abs = join(ctx.root, path);
  let st;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "ELOOP") return null;
    throw err;
  }
  if (!st.isFile()) return null;
  try {
    return readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") return null; // replaced between lstat and read
    throw err;
  }
}
