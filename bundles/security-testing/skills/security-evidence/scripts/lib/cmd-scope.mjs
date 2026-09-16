// lib/cmd-scope.mjs — `evidence.mjs scope --run <id> [--include <path-or-glob>]…
// [--max-bytes <n>=1048576]` (TASK-013; plan §4.1 row `scope`, §5 TASK-013;
// spec §6.1 `scope.json`, §6.2, D18 / P6; US-009 AC-1…AC-4).
//
// Records which files and ranges a run examines, the files it could not, and
// — for `review` runs only — a redacted private snapshot of every dirty or
// untracked in-scope file plus the HMAC of its original bytes. `scope.json`'s
// `self_sha256` is the `scope_sha256` every later artifact references.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv; `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒
//      2 RUN-COMMITTED (G-10); `scope.json` present ⇒ 2 SCOPE-EXISTS (write-
//      once; retry = new seq); the run's key by the envelope's `key_id` ⇒
//      2 `KEY: unavailable` when its file is gone (no HMAC, no identity);
//      the engagement record from `<run>/engagement.json` — the record the
//      run was started with, not whatever engagement.md says now;
//   2. assessment only: `head_oid` must still be HEAD (2 USAGE — the clean-
//      tree check can only compare the working tree against HEAD, D18; `run
//      init` refused any other `--head`, this catches HEAD moving since),
//      then the P6 clean-tree check re-run over scope_paths ∪ product_paths
//      ⇒ 3 DIRTY-TREE;
//   3. the file set and its classification (below); review snapshots are
//      persisted as they are classified;
//   4. `<run>/scope.json`, write-once (canon.writeArtifact {exclusive}).
//
// The file set: every tracked file under `scope_paths` (`git ls-files
// --stage`, so the mode tells a symlink and a submodule apart from a file),
// plus — review only — every non-ignored untracked file there (`git ls-files
// --others --exclude-standard`); narrowed by `--include` when given (a path
// or directory prefix, or a glob with `*` / `**` / `?`); sorted by UTF-8 byte
// order like every list canon writes.
//
// "Dirty" is relative to the run's `head_oid`, not to HEAD: `git diff
// --name-only <head_oid> -- <scope_paths>` (a `review` run may pin `--head`
// to an older commit; a file equal to HEAD but different at head_oid would
// otherwise be recorded as `side: head` while the reviewer reads something
// else). For an assessment head_oid = HEAD and the P6 check has already
// passed, so the only dirt left is the bundle's own managed output, which
// resolves at head_oid like everything else (citations resolve at head_oid,
// D18) — an assessment never snapshots.
//
// Per file:
//   clean tracked           side: head; oid = blob at head_oid; file_hmac =
//                           HMAC_key(bytes at head_oid); lines = normalised
//                           line count of those bytes
//   dirty tracked/untracked (review) read working bytes → original_hmac =
//                           HMAC_key(bytes) → redactString → persist
//                           private/snapshots/<run>/<path> (writeAtomic) —
//                           read → HMAC → redact → persist, in that order,
//                           in one function (G-3); side: snapshot; oid =
//                           redacted_sha256 (plain sha256 of *redacted*
//                           bytes, G-2); file_hmac = original_hmac; lines
//                           counted over the redacted bytes, which are what
//                           a `side: snapshot` citation resolves against (a
//                           multi-line PEM block redacts to one line)
//   skipped, with reason    `symlink` (a link at head or in the working tree,
//                           never followed — a link escaping the tree is
//                           thereby skipped too), `submodule` (a gitlink, or
//                           an untracked nested repository), `too-large`
//                           (size > --max-bytes, measured before reading),
//                           `binary` (a NUL in the first 8 KiB, or bytes that
//                           are not valid UTF-8 — nothing the normaliser can
//                           line-number), `unreadable` (a tracked file
//                           missing from the working tree of a review run,
//                           or absent at head_oid, or not readable)
//   ranges[path]            [[1, lines]] — the whole file is admitted; an
//                           empty file admits no range ([]); a skipped file
//                           has no entry
//
// stdout: `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` then `WROTE
// <path> sha256=<h>`. Exit 0; 2 USAGE(scope: …) / RUN-COMMITTED /
// SCOPE-EXISTS / KEY: unavailable; 3 DIRTY-TREE; 5 when run.json or
// engagement.json is not the artifact it claims to be (readArtifact).
//
// `assessmentDirt` comes from lib/clean-tree.mjs (TASK-008 moved it out of
// cmd-run.mjs after this task was cut; the import was switched at merge).
//
// Imports: node:fs (existsSync, lstatSync, readFileSync — every write is
// canon.writeArtifact or fsx.writeAtomic), node:path, ../canon.mjs,
// ../normalize.mjs, ../redact.mjs, ./argv.mjs, ./clean-tree.mjs
// (assessmentDirt), ./exit.mjs, ./fsx.mjs, ./git.mjs (the one place git
// runs, G-6), ./ledger.mjs (RUN_ID), ./run-index.mjs (runDir), ./schema.mjs,
// ./tokens.mjs. No network (G-14), no clock (G-1: created_at is ctx.now()).
// Every string that leaves the process goes through ctx.out / ctx.log /
// canon.writeArtifact (G-4).

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hmacHex, makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { EncodingError, normalizeText } from "../normalize.mjs";
import { DEFAULT_RULES, redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { assessmentDirt } from "./clean-tree.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { blobOid, git, lsFiles, revParse, showBytes } from "./git.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, DIRTY_TREE, KEY_UNAVAILABLE, RUN_COMMITTED, SCOPE_EXISTS, scopeLine } from "./tokens.mjs";

const COMMAND = "scope";
/** `--max-bytes` default (plan §4.1). */
export const DEFAULT_MAX_BYTES = 1048576;
/** A NUL inside this many leading bytes marks a file binary. */
const BINARY_PROBE_BYTES = 8 * 1024;
/** scope.schema.json `skipped[].reason` vocabulary. */
export const SKIP_REASONS = Object.freeze({ binary: "binary", tooLarge: "too-large", symlink: "symlink", submodule: "submodule", unreadable: "unreadable" });

const MODE_SYMLINK = "120000";
const MODE_GITLINK = "160000";

// --- listing ------------------------------------------------------------------

/** UTF-8 byte order, the order canon sorts keys in. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** `scope_paths` as git pathspecs: non-empty strings, deduplicated, first-appearance order. */
function scopePaths(record) {
  return [...new Set(record.scope_paths)].filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * Tracked entries under `paths`: `path → mode` from `git ls-files --stage`
 * (a conflicted path has several stages; a gitlink at any stage makes it a
 * submodule, a symlink at any stage a symlink, else a file).
 * @returns {Map<string, string>}
 */
function trackedModes(root, paths) {
  const modes = new Map();
  if (paths.length === 0) return modes;
  for (const line of lsFiles(root, { stage: true, paths })) {
    const tab = line.indexOf("\t");
    const [mode] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    const prev = modes.get(path);
    if (prev === MODE_GITLINK || mode === MODE_GITLINK) modes.set(path, MODE_GITLINK);
    else if (prev === MODE_SYMLINK || mode === MODE_SYMLINK) modes.set(path, MODE_SYMLINK);
    else modes.set(path, mode);
  }
  return modes;
}

/** Non-ignored untracked entries under `paths`; a nested repository is listed by git as `dir/`. */
function untrackedPaths(root, paths) {
  return paths.length === 0 ? [] : lsFiles(root, { others: true, excludeStandard: true, paths });
}

/** Paths whose working-tree content differs from `head_oid` (tracked files only; untracked never appear here). */
function dirtyAgainst(root, head_oid, paths) {
  if (paths.length === 0) return new Set();
  const r = git(root, ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", head_oid, "--", ...paths]);
  if (r.code !== 0) throw new Error(`${COMMAND}: git diff --name-only ${head_oid} failed (${r.code}): ${r.stderr.trim()}`);
  return new Set(r.stdout.split("\0").filter((p) => p.length > 0));
}

/**
 * `--include` as a predicate over repo-relative paths. A value without glob
 * characters admits that path and everything under it as a directory
 * (`src`, `src/`, `src/app.js`); a glob admits `*` (one segment), `**` (any
 * depth) and `?` — anchored to the whole path, so `*.ts` means a top-level
 * `.ts` file and `** /*.ts` one at any depth.
 * @param {string[] | undefined} includes
 * @returns {(path: string) => boolean}
 */
export function includeFilter(includes) {
  if (includes === undefined || includes.length === 0) return () => true;
  const tests = includes.map((raw) => {
    const value = raw.replace(/\/+$/, "");
    if (value === "" || value === ".") return () => true;
    if (!/[*?]/.test(value)) return (path) => path === value || path.startsWith(`${value}/`);
    let re = "";
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === "*") {
        if (value[i + 1] === "*") {
          i++;
          if (value[i + 1] === "/") {
            i++;
            re += "(?:.*/)?"; // `**/` matches zero or more whole segments
          } else re += ".*";
        } else re += "[^/]*";
      } else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    const compiled = new RegExp(`^${re}$`);
    return (path) => compiled.test(path);
  });
  return (path) => tests.some((t) => t(path));
}

// --- classification -------------------------------------------------------------

function hasNul(bytes) {
  return bytes.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/** Normalised line count, or null when the bytes are not valid UTF-8. */
function lineCount(bytes) {
  try {
    return normalizeText(bytes).lines.length;
  } catch (err) {
    if (err instanceof EncodingError) return null;
    throw err;
  }
}

/** Byte size of the blob `oid` (git metadata, never content). */
function blobSize(root, oid) {
  const r = git(root, ["cat-file", "-s", "--end-of-options", oid]);
  if (r.code !== 0) throw new Error(`${COMMAND}: git cat-file -s ${oid} failed (${r.code}): ${r.stderr.trim()}`);
  return Number(r.stdout.trim());
}

/**
 * A clean tracked file, recorded from `head_oid` (never from the working tree).
 * @returns {{file: object} | {skip: string}}
 */
function classifyHead({ root, keyBytes, head_oid, maxBytes }, path, mode) {
  if (mode === MODE_SYMLINK) return { skip: SKIP_REASONS.symlink };
  const oid = blobOid(root, head_oid, path);
  if (oid === null) return { skip: SKIP_REASONS.unreadable };
  if (blobSize(root, oid) > maxBytes) return { skip: SKIP_REASONS.tooLarge };
  const bytes = showBytes(root, head_oid, path);
  if (hasNul(bytes)) return { skip: SKIP_REASONS.binary };
  const lines = lineCount(bytes);
  if (lines === null) return { skip: SKIP_REASONS.binary };
  return { file: { path, side: "head", oid, file_hmac: hmacHex(keyBytes, bytes), lines } };
}

/**
 * A dirty or untracked file of a review run: the one snapshot writer
 * (G-3: read → HMAC → redact → persist, in this function, in this order).
 * The original bytes leave this function only as an HMAC.
 * @returns {{file: object, snapshot: object} | {skip: string}}
 */
function classifySnapshot({ root, keyBytes, maxBytes, snapshotsDir }, path) {
  const abs = join(root, path);
  let st;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "EACCES" || err.code === "ELOOP") return { skip: SKIP_REASONS.unreadable };
    throw err;
  }
  if (st.isSymbolicLink()) return { skip: SKIP_REASONS.symlink };
  if (st.isDirectory()) return { skip: SKIP_REASONS.submodule };
  if (!st.isFile()) return { skip: SKIP_REASONS.unreadable };
  if (st.size > maxBytes) return { skip: SKIP_REASONS.tooLarge };
  // read
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EACCES" || err.code === "EISDIR" || err.code === "EPERM") return { skip: SKIP_REASONS.unreadable };
    throw err;
  }
  if (bytes.length > maxBytes) return { skip: SKIP_REASONS.tooLarge }; // grew between lstat and read
  if (hasNul(bytes) || lineCount(bytes) === null) return { skip: SKIP_REASONS.binary };
  // HMAC
  const original_hmac = hmacHex(keyBytes, bytes);
  // redact
  const redacted = Buffer.from(redactString(bytes, DEFAULT_RULES).text, "utf8");
  const redacted_sha256 = sha256Hex(redacted);
  const lines = normalizeText(redacted).lines.length;
  // persist — redacted bytes only; the original is gone from here on
  writeAtomic(join(snapshotsDir, path), redacted);
  return {
    file: { path, side: "snapshot", oid: redacted_sha256, file_hmac: original_hmac, lines },
    snapshot: { original_hmac, redacted_sha256, redaction_version: DEFAULT_RULES.redaction_version },
  };
}

// --- the command ------------------------------------------------------------------

function parseMaxBytes(raw) {
  if (raw === undefined) return DEFAULT_MAX_BYTES;
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) throw usageError(COMMAND, "--max-bytes must be a positive integer");
  return Number(raw);
}

/**
 * @param {string[]} argv after `scope`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", include: "list", "max-bytes": "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  const maxBytes = parseMaxBytes(flags["max-bytes"]);
  const include = includeFilter(flags.include);

  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const scopePath = join(dir, "scope.json");
  if (existsSync(scopePath)) throw new CliError(EXIT.USAGE, SCOPE_EXISTS);
  const runArtifact = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  const { head_oid, template: kind } = runArtifact.payload;
  const key = ctx.keyById(runArtifact.envelope.key_id);
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);
  const record = readArtifact(join(dir, "engagement.json"), { kind: "engagement" }).payload;

  if (kind === "assessment") {
    if (revParse(ctx.root, "HEAD") !== head_oid) throw usageError(COMMAND, `run ${run_id} head_oid ${head_oid} is not HEAD (assessment)`);
    const dirt = assessmentDirt(ctx, record);
    if (dirt.length > 0) {
      ctx.log(`${COMMAND}: ${dirt.length} dirty path(s) under the assessed paths:`, ...dirt.map((row) => `${row.xy} ${row.path}${row.orig === undefined ? "" : ` <- ${row.orig}`}`));
      throw new CliError(EXIT.INDETERMINATE, DIRTY_TREE);
    }
  }

  const paths = scopePaths(record);
  const tracked = trackedModes(ctx.root, paths);
  const review = kind === "review";
  const dirty = review ? dirtyAgainst(ctx.root, head_oid, paths) : new Set();
  const candidates = new Map(); // path → "tracked" | "untracked" | "nested-repo"
  for (const path of tracked.keys()) candidates.set(path, "tracked");
  if (review) {
    for (const entry of untrackedPaths(ctx.root, paths)) {
      if (entry.endsWith("/")) candidates.set(entry.slice(0, -1), "nested-repo");
      else if (!candidates.has(entry)) candidates.set(entry, "untracked");
    }
  }

  const env = { root: ctx.root, keyBytes: key.bytes, head_oid, maxBytes, snapshotsDir: join(ctx.st, "private", "snapshots", run_id) };
  const files = [];
  const ranges = {};
  const skipped = [];
  const snapshot = {};
  for (const path of [...candidates.keys()].filter(include).sort(compareBytes)) {
    const origin = candidates.get(path);
    const mode = tracked.get(path);
    let result;
    if (origin === "nested-repo" || mode === MODE_GITLINK) result = { skip: SKIP_REASONS.submodule };
    else if (review && (origin === "untracked" || dirty.has(path))) result = classifySnapshot(env, path);
    else result = classifyHead(env, path, mode);
    if (result.skip !== undefined) {
      skipped.push({ path, reason: result.skip });
      continue;
    }
    files.push(result.file);
    ranges[path] = result.file.lines === 0 ? [] : [[1, result.file.lines]];
    if (result.snapshot !== undefined) snapshot[path] = result.snapshot;
  }

  const payload = { files, ranges, skipped };
  const snapshotCount = Object.keys(snapshot).length;
  if (snapshotCount > 0) payload.snapshot = snapshot;
  const errors = validate("scope", payload);
  if (errors.length > 0) throw new Error(`${COMMAND}: scope.json payload is off-schema: ${errors[0]}`);

  const { schema_version, engagement_id } = runArtifact.envelope;
  const head = { schema_version, kind: "scope", run_id, engagement_id, key_id: key.key_id, now: ctx.now };
  let written;
  try {
    written = writeArtifact(scopePath, makeEnvelope(head, payload), { exclusive: true });
  } catch (err) {
    if (err.code === "EEXIST") throw new CliError(EXIT.USAGE, SCOPE_EXISTS, { cause: err });
    throw err;
  }
  const rangeCount = Object.values(ranges).reduce((n, list) => n + list.length, 0);
  ctx.out(scopeLine({ files: files.length, ranges: rangeCount, skipped: skipped.length, snapshot: snapshotCount }));
  ctx.wrote(scopePath, written);
  return EXIT.OK;
}
