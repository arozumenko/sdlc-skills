// lib/register-core.mjs — the append-only register at <st>/register/
// (TASK-028; spec §6.8, plan §4.3, TL-8). The I/O half: log, lock,
// projection file, recovery. The fold itself (replay, chain, anchor) is pure
// and lives in lib/register-fold.mjs (G-9); it is re-exported here so the
// plan's `register-core.replay` / `verifyChain` / `anchor` / `anchorVerify`
// names resolve.
//
//   <st>/register/events.jsonl        one canonical JSON event per line, appended only
//   <st>/register/projection.json     canonical bytes of replay(events) — derived, rebuilt
//   <st>/register/finding-alias.jsonl one canonical alias line, appended only, chained like events (TASK-029)
//   <st>/register/lock/               mkdir mutex (fsx.withLock) around read-verify-append-project
//
// Recovery, on every open (spec §6.8):
//   projection missing or projection.seq < log.seq  ⇒ rebuild (an interrupted
//                                                     append is normal: the line
//                                                     landed, the projection did not)
//   projection.seq > log.seq                        ⇒ CORRUPT (the log lost lines)
//   any prev_sha256 mismatch / seq gap / bad line   ⇒ CORRUPT
//   projection.seq == log.seq but bytes differ      ⇒ CORRUPT (an edited projection)
//   projection unreadable                           ⇒ CORRUPT
// CORRUPT is CliError(5, "CORRUPT"); the reason goes to ctx.log (stderr) and
// nothing is written. The edited or truncated file is left for inspection.
//
// append(ctx, {row_id, event, payload, ref}) — under the lock: open (so the
// seq and prev_sha256 are read against the locked log), build the event with
// `ts = ctx.now()` and `actor = ctx.actor`, redact it (G-4: the title is
// operator text), fold it in memory FIRST (a rejected transition never lands
// in the log), then one fsx.appendLine of the canonical line and one
// fsx.writeAtomic of the projection. The line's hash is over the redacted
// bytes, so the chain is over what is on disk.
//
// readEvents(ctx) — parse + schema-validate + verifyChain, no lock, no
// projection: what `run snapshot register` (TASK-058) copies; throws CORRUPT.
//
// Alias log (TASK-029; spec §6.8 "separate from row supersession"). The
// recovery rule covers it too: every open parses finding-alias.jsonl and
// verifies its chain (register-transitions.verifyAliasChain), so a broken
// alias chain is CORRUPT on every command. It has no projection — the
// equivalence check reads the lines. appendAlias(ctx, {from_id, to_id,
// reason, run_id}) — under the lock, chained like an event (seq, prev_sha256,
// sha256 over the redacted canonical line), one appendLine; the file exists
// only once the first alias lands. readAliases(ctx) — no lock.
//
// Exit: CORRUPT 5 (integrityFailure); ENGAGEMENT-MISSING 2 comes from
// ctx.engagement() — the register belongs to an engagement, and the anchor
// carries its id.

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, canonical, parseStrict } from "../canon.mjs";
import { redactDeep } from "../redact.mjs";
import { integrityFailure } from "./exit.mjs";
import { appendLine, withLock, writeAtomic } from "./fsx.mjs";
import { ChainError, TransitionError, anchor, anchorVerify, replay, verifyChain } from "./register-fold.mjs";
import { verifyAliasChain } from "./register-transitions.mjs";
import { validate } from "./schema.mjs";
import { CORRUPT } from "./tokens.mjs";

export { anchor, anchorVerify, replay, verifyChain };

export const REGISTER_DIR = "register";
export const EVENTS_FILE = "events.jsonl";
export const PROJECTION_FILE = "projection.json";
export const ALIASES_FILE = "finding-alias.jsonl";
export const LOCK_DIR = "lock";

/**
 * Every path the register uses, under `<st>/register/`.
 * @param {{st: string}} ctx
 * @returns {{dir: string, events: string, projection: string, aliases: string, lock: string}}
 */
export function registerPaths(ctx) {
  const dir = join(ctx.st, REGISTER_DIR);
  return { dir, events: join(dir, EVENTS_FILE), projection: join(dir, PROJECTION_FILE), aliases: join(dir, ALIASES_FILE), lock: join(dir, LOCK_DIR) };
}

function corrupt(ctx, reason, cause) {
  ctx.log(`register: CORRUPT: ${reason}`);
  return integrityFailure(CORRUPT, cause ?? new Error(reason));
}

function readBytes(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Parse every line of events.jsonl (missing file ⇒ []); a partial or malformed line is CORRUPT. */
function parseLog(ctx, path) {
  const bytes = readBytes(path);
  if (bytes === null) return [];
  const text = bytes.toString("utf8");
  if (text.length === 0) return [];
  if (!text.endsWith("\n")) throw corrupt(ctx, `${EVENTS_FILE}: the last line is incomplete (no trailing newline)`);
  const lines = text.slice(0, -1).split("\n");
  const events = [];
  for (const [i, line] of lines.entries()) {
    if (line.length === 0) throw corrupt(ctx, `${EVENTS_FILE}: line ${i + 1} is empty`);
    let event;
    try {
      event = parseStrict(line);
    } catch (err) {
      if (err instanceof CanonError) throw corrupt(ctx, `${EVENTS_FILE}: line ${i + 1}: ${err.message}`, err);
      throw err;
    }
    const errors = validate("register-event", event);
    if (errors.length > 0) throw corrupt(ctx, `${EVENTS_FILE}: line ${i + 1}: ${errors[0]}`);
    events.push(event);
  }
  return events;
}

/** Parse every line of finding-alias.jsonl (missing file ⇒ []) and verify its chain; anything off is CORRUPT. */
function parseAliases(ctx, path) {
  const bytes = readBytes(path);
  if (bytes === null) return [];
  const text = bytes.toString("utf8");
  if (text.length === 0) return [];
  if (!text.endsWith("\n")) throw corrupt(ctx, `${ALIASES_FILE}: the last line is incomplete (no trailing newline)`);
  const aliases = [];
  for (const [i, line] of text.slice(0, -1).split("\n").entries()) {
    if (line.length === 0) throw corrupt(ctx, `${ALIASES_FILE}: line ${i + 1} is empty`);
    let alias;
    try {
      alias = parseStrict(line);
    } catch (err) {
      if (err instanceof CanonError) throw corrupt(ctx, `${ALIASES_FILE}: line ${i + 1}: ${err.message}`, err);
      throw err;
    }
    const errors = validate("finding-alias", alias);
    if (errors.length > 0) throw corrupt(ctx, `${ALIASES_FILE}: line ${i + 1}: ${errors[0]}`);
    aliases.push(alias);
  }
  try {
    verifyAliasChain(aliases);
  } catch (err) {
    if (err instanceof TypeError) throw corrupt(ctx, `${ALIASES_FILE}: ${err.message}`, err);
    throw err;
  }
  return aliases;
}

function chainOrCorrupt(ctx, events) {
  try {
    return verifyChain(events);
  } catch (err) {
    if (err instanceof ChainError) throw corrupt(ctx, `${EVENTS_FILE}: ${err.message}`, err);
    throw err;
  }
}

function replayOrCorrupt(ctx, events, engagement_id) {
  try {
    return replay(events, engagement_id);
  } catch (err) {
    if (err instanceof ChainError || err instanceof TransitionError) throw corrupt(ctx, `${EVENTS_FILE}: ${err.message}`, err);
    throw err;
  }
}

/** The stored projection, or null when absent; anything unreadable or off-schema is CORRUPT. */
function readProjection(ctx, path) {
  const bytes = readBytes(path);
  if (bytes === null) return null;
  let stored;
  try {
    stored = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw corrupt(ctx, `${PROJECTION_FILE}: ${err.message}`, err);
    throw err;
  }
  const errors = validate("register", stored);
  if (errors.length > 0) throw corrupt(ctx, `${PROJECTION_FILE}: ${errors[0]}`);
  return stored;
}

/**
 * Read and chain-verify the log without touching the projection or the lock.
 * @param {object} ctx
 * @returns {object[]} events
 * @throws {CliError} 5 CORRUPT
 */
export function readEvents(ctx) {
  const paths = registerPaths(ctx);
  const events = parseLog(ctx, paths.events);
  chainOrCorrupt(ctx, events);
  return events;
}

/**
 * Read and chain-verify finding-alias.jsonl without the lock (missing ⇒ []).
 * @param {object} ctx
 * @returns {object[]} alias lines
 * @throws {CliError} 5 CORRUPT
 */
export function readAliases(ctx) {
  return parseAliases(ctx, registerPaths(ctx).aliases);
}

/** The recovery rule, to be run with the lock held. */
function openLocked(ctx) {
  const engagement_id = ctx.engagement().engagement_id;
  const paths = registerPaths(ctx);
  mkdirSync(paths.dir, { recursive: true });
  const events = parseLog(ctx, paths.events);
  const projection = replayOrCorrupt(ctx, events, engagement_id);
  const aliases = parseAliases(ctx, paths.aliases);
  const stored = readProjection(ctx, paths.projection);
  let rebuilt = false;
  if (stored === null || stored.seq < projection.seq) {
    writeAtomic(paths.projection, canonical(projection));
    rebuilt = true;
  } else if (stored.seq > projection.seq) {
    throw corrupt(ctx, `${PROJECTION_FILE} is ahead of the log (projection seq ${stored.seq}, log seq ${projection.seq})`);
  } else if (!canonical(stored).equals(canonical(projection))) {
    throw corrupt(ctx, `${PROJECTION_FILE} differs from the replay of ${EVENTS_FILE} at seq ${projection.seq}`);
  }
  return { paths, engagement_id, events, projection, aliases, rebuilt };
}

/**
 * Open the register: create the directory, run the recovery rule (under the
 * lock) over both chains, return the verified log, the current projection
 * and the alias lines.
 * @param {object} ctx
 * @returns {Promise<{paths: object, engagement_id: string, events: object[], projection: object, aliases: object[], rebuilt: boolean}>}
 * @throws {CliError} 5 CORRUPT · 2 ENGAGEMENT-MISSING
 */
export async function openRegister(ctx) {
  const paths = registerPaths(ctx);
  ctx.engagement(); // ENGAGEMENT-MISSING before any directory exists
  mkdirSync(paths.dir, { recursive: true });
  return withLock(paths.lock, () => openLocked(ctx));
}

/**
 * Rebuild and persist the projection unconditionally (`replay --write`).
 * A corrupt register is still refused: the rule runs first.
 * @param {object} ctx
 * @returns {Promise<{projection: object, written: true}>}
 */
export async function rebuildProjection(ctx) {
  const paths = registerPaths(ctx);
  ctx.engagement();
  mkdirSync(paths.dir, { recursive: true });
  return withLock(paths.lock, () => {
    const reg = openLocked(ctx);
    writeAtomic(paths.projection, canonical(reg.projection));
    return { projection: reg.projection, written: true };
  });
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`append: ${name} must be a non-empty string`);
}

/**
 * Append one event and re-project, under the lock. `row_id` may be a function
 * of the locked projection (register-fold.nextRowId for `add`), so an id is
 * allocated against the same log the event is chained to.
 * @param {object} ctx
 * @param {{row_id: string | ((projection: object) => string), event: string, payload: object, ref: string}} input
 * @returns {Promise<{event: object, projection: object}>} the event as written (redacted) and the new projection
 * @throws {CliError} 5 CORRUPT · {TransitionError} the fold refused it (nothing written)
 */
export async function append(ctx, { row_id, event, payload, ref } = {}) {
  if (typeof row_id !== "function") requireNonEmptyString(row_id, "row_id");
  requireNonEmptyString(event, "event");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("append: payload must be an object");
  if (typeof ref !== "string") throw new TypeError("append: ref must be a string");
  const paths = registerPaths(ctx);
  ctx.engagement();
  mkdirSync(paths.dir, { recursive: true });
  return withLock(paths.lock, () => {
    const reg = openLocked(ctx);
    const id = typeof row_id === "function" ? row_id(reg.projection) : row_id;
    requireNonEmptyString(id, "row_id");
    const next = redactDeep({
      seq: reg.projection.seq + 1,
      prev_sha256: reg.projection.chain_sha256,
      ts: ctx.now(),
      actor: ctx.actor,
      row_id: id,
      event,
      payload,
      ref,
    });
    // Fold in memory first: a rejected transition never reaches the log.
    const projection = replay([...reg.events, next], reg.engagement_id);
    appendLine(paths.events, canonical(next).toString("utf8"));
    writeAtomic(paths.projection, canonical(projection));
    return { event: next, projection };
  });
}

/**
 * Append one alias line to finding-alias.jsonl, under the lock (TASK-029).
 * The recovery rule runs first (both chains); the line is chained against
 * the locked file and verified in memory before the one appendLine. No row
 * changes: an alias is separate from row supersession (spec §6.8).
 * @param {object} ctx
 * @param {{from_id: string, to_id: string, reason: string, run_id: string}} input
 * @returns {Promise<{alias: object, chain_sha256: string, projection: object}>} the line as written (redacted)
 * @throws {CliError} 5 CORRUPT · {TypeError} the chain refused it (nothing written)
 */
export async function appendAlias(ctx, { from_id, to_id, reason, run_id } = {}) {
  for (const [name, value] of Object.entries({ from_id, to_id, run_id })) requireNonEmptyString(value, name);
  if (typeof reason !== "string") throw new TypeError("appendAlias: reason must be a string");
  const paths = registerPaths(ctx);
  ctx.engagement();
  mkdirSync(paths.dir, { recursive: true });
  return withLock(paths.lock, () => {
    const reg = openLocked(ctx);
    const { seq, chain_sha256 } = verifyAliasChain(reg.aliases);
    const next = redactDeep({ from_id, to_id, reason, run_id, seq: seq + 1, prev_sha256: chain_sha256 });
    const chained = verifyAliasChain([...reg.aliases, next]); // shape and chain, before anything lands
    appendLine(paths.aliases, canonical(next).toString("utf8"));
    return { alias: next, chain_sha256: chained.chain_sha256, projection: reg.projection };
  });
}
