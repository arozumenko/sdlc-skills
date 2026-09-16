// lib/register-fold.mjs — the pure half of the register (TASK-028; spec §6.8,
// plan §4.3). Everything here is a function of its arguments: no file system,
// no clock, no git (G-9). lib/register-core.mjs is the I/O half (log, lock,
// projection file) and re-exports these so the plan's `register-core.replay`
// / `verifyChain` / `anchor` / `anchorVerify` contract holds; `check` and
// `sign-off` can re-run the fold over a snapshot without touching the live
// register.
//
//   event          {seq, prev_sha256, ts, actor, row_id, event, payload, ref}
//                  exactly those eight keys; seq is 1-based and consecutive
//   event_sha256   sha256(canonical(event)) — the whole event, ts included;
//                  the chain is over what is on disk, not over a payload view
//   genesis        prev_sha256 of seq 1 = 64 zeros; chain_sha256 of an empty
//                  log = the genesis hash
//   projection     {engagement_id, seq, chain_sha256, rows} (register.schema.json)
//   anchor         "<engagement_id>:<seq>:<chain_sha256>"
//
// verifyChain(events)         → {seq, chain_sha256}; throws ChainError
// replay(events, eid)         → projection; throws ChainError | TransitionError
// anchor(projection)          → string
// parseAnchor(s)              → {engagement_id, seq, chain_sha256} | null
// anchorVerify(projection, s) → MATCH | TRUNCATED | DIVERGED (tokens.mjs)
// summarize(projection)       → {counts, open_exposure, unauthenticated_approvals, rows}
//
// Transitions. The table is lib/register-transitions.mjs (TASK-029);
// `foldEvent` is its `applyEvent`, and every (event, from) pair outside the
// table is a TransitionError — the same error the command layer turns into
// `TRANSITION-REJECTED(<event>: <from>)`. TransitionError, emptyRow and the
// add-payload vocabulary are re-exported here so TASK-028's callers keep
// their import path.
//
// Open exposure (spec §6.8, D15, G-8): a row leaves exposure only through a
// script verdict (`fixed`) or a supersession (`superseded`, whose exposure
// moves to the target by equivalence or transfer). An acceptance or a
// false-positive record is an unauthenticated approval — it lands in the one
// approvals bucket and the row stays in open_exposure. Nothing here ever
// subtracts an approval from exposure.
//
// anchorVerify semantics (representation choice, stated here because the
// spec fixes only the three tokens): the anchor is a fingerprint of one exact
// state. MATCH iff seq and chain are both equal; TRUNCATED iff the register's
// seq is below the anchored seq (the log is shorter than what was anchored);
// DIVERGED otherwise — a rewritten history at the same length, another
// engagement's register, or a log that legitimately advanced past the anchor
// (print a fresh anchor after the last register change).

import { canonical, sha256Hex } from "../canon.mjs";
import { ADD_PAYLOAD_KEYS, SUBJECT_KINDS, TransitionError, applyEvent, emptyRow } from "./register-transitions.mjs";
import { ANCHOR_DIVERGED, ANCHOR_MATCH, ANCHOR_TRUNCATED, REGISTER_PRIORITIES, REGISTER_STATUSES } from "./tokens.mjs";

export { ADD_PAYLOAD_KEYS, SUBJECT_KINDS, TransitionError, emptyRow };

export const GENESIS_SHA256 = "0".repeat(64);
export const EVENT_KEYS = Object.freeze(["seq", "prev_sha256", "ts", "actor", "row_id", "event", "payload", "ref"]);
export const STATUSES = REGISTER_STATUSES;
export const PRIORITIES = REGISTER_PRIORITIES;

const SHA256 = /^[0-9a-f]{64}$/;
const ANCHOR = /^(.+):(0|[1-9][0-9]*):([0-9a-f]{64})$/;

/** The log does not chain: a seq gap, a prev_sha256 that is not the previous event's hash, or an event that is not an event. */
export class ChainError extends Error {
  /**
   * @param {number | null} seq the seq (or 1-based position) at which the chain breaks
   * @param {string} reason
   */
  constructor(seq, reason) {
    super(seq === null ? reason : `seq ${seq}: ${reason}`);
    this.name = "ChainError";
    this.seq = seq;
    this.reason = reason;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * sha256 over the canonical bytes of the whole event (ts included).
 * @param {object} event
 * @returns {string}
 */
export function eventSha256(event) {
  return sha256Hex(canonical(event));
}

function checkEventShape(event, position) {
  if (!isPlainObject(event)) throw new ChainError(position, "event is not an object");
  const keys = Object.keys(event);
  for (const k of keys) if (!EVENT_KEYS.includes(k)) throw new ChainError(position, `unknown event key ${JSON.stringify(k)}`);
  for (const k of EVENT_KEYS) if (!(k in event)) throw new ChainError(position, `missing event key ${JSON.stringify(k)}`);
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new ChainError(position, `seq must be a positive integer, got ${String(event.seq)}`);
  if (typeof event.prev_sha256 !== "string" || !SHA256.test(event.prev_sha256)) throw new ChainError(position, "prev_sha256 must be 64 lowercase hex chars");
  for (const k of ["ts", "actor", "row_id", "event", "ref"]) {
    if (typeof event[k] !== "string") throw new ChainError(position, `${k} must be a string`);
  }
  if (event.event.length === 0) throw new ChainError(position, "event must be non-empty");
  if (!isPlainObject(event.payload)) throw new ChainError(position, "payload must be an object");
}

/**
 * Walk the log: every event has exactly the eight keys, seq is 1..n in order,
 * and each prev_sha256 is the previous event's hash (genesis for seq 1).
 * @param {object[]} events
 * @returns {{seq: number, chain_sha256: string}}
 * @throws {ChainError}
 */
export function verifyChain(events) {
  if (!Array.isArray(events)) throw new TypeError("verifyChain: events must be an array");
  let prev = GENESIS_SHA256;
  let seq = 0;
  for (const [i, event] of events.entries()) {
    checkEventShape(event, i + 1);
    if (event.seq !== seq + 1) throw new ChainError(event.seq, `seq must be ${seq + 1} (consecutive from 1)`);
    if (event.prev_sha256 !== prev) throw new ChainError(event.seq, "prev_sha256 does not match the previous event's hash");
    prev = eventSha256(event);
    seq = event.seq;
  }
  return { seq, chain_sha256: prev };
}

/**
 * The id `add` gives the next row: rows + 1, zero-padded to four. Computed
 * from the projection the event is appended to, so it is reproducible from
 * the log and — when append() evaluates it under the lock — race-free.
 * @param {{rows: Record<string, object>}} projection
 * @returns {string} R-nnnn
 */
export function nextRowId(projection) {
  const n = Object.keys(projection.rows).length + 1;
  if (n > 9999) throw new RangeError("nextRowId: the register holds R-9999 already");
  return `R-${String(n).padStart(4, "0")}`;
}

/**
 * Apply one event to the row map (pure; returns a new map) through the
 * transition table (register-transitions.applyEvent).
 * @param {Record<string, object>} rows
 * @param {object} event a chain-verified event
 * @returns {Record<string, object>}
 * @throws {TransitionError}
 */
export function foldEvent(rows, event) {
  return applyEvent(rows, event);
}

/**
 * Rebuild the projection from the log: verify the chain, then fold.
 * @param {object[]} events
 * @param {string} engagement_id
 * @returns {{engagement_id: string, seq: number, chain_sha256: string, rows: Record<string, object>}}
 * @throws {ChainError | TransitionError}
 */
export function replay(events, engagement_id) {
  if (typeof engagement_id !== "string" || engagement_id.length === 0) throw new TypeError("replay: engagement_id must be a non-empty string");
  const { seq, chain_sha256 } = verifyChain(events);
  let rows = {};
  for (const event of events) rows = foldEvent(rows, event);
  return { engagement_id, seq, chain_sha256, rows };
}

/**
 * `<engagement_id>:<seq>:<chain_sha256>`.
 * @param {{engagement_id: string, seq: number, chain_sha256: string}} projection
 * @returns {string}
 */
export function anchor(projection) {
  if (!isPlainObject(projection) || typeof projection.engagement_id !== "string" || !Number.isInteger(projection.seq) || !SHA256.test(projection.chain_sha256)) {
    throw new TypeError("anchor: a projection {engagement_id, seq, chain_sha256} is required");
  }
  return `${projection.engagement_id}:${projection.seq}:${projection.chain_sha256}`;
}

/**
 * Split an anchor from the right (an engagement id may itself contain colons).
 * @param {string} s
 * @returns {{engagement_id: string, seq: number, chain_sha256: string} | null}
 */
export function parseAnchor(s) {
  if (typeof s !== "string") return null;
  const m = s.match(ANCHOR);
  if (!m) return null;
  return { engagement_id: m[1], seq: Number(m[2]), chain_sha256: m[3] };
}

/**
 * Compare the projection against an anchor (semantics in the header).
 * @param {{engagement_id: string, seq: number, chain_sha256: string}} projection
 * @param {string} expect an anchor string
 * @returns {"MATCH" | "TRUNCATED" | "DIVERGED"}
 * @throws {TypeError} malformed anchor
 */
export function anchorVerify(projection, expect) {
  anchor(projection); // shape check
  const want = parseAnchor(expect);
  if (want === null) throw new TypeError("anchorVerify: expect must be <engagement_id>:<seq>:<chain_sha256>");
  if (projection.engagement_id !== want.engagement_id) return ANCHOR_DIVERGED;
  if (projection.seq < want.seq) return ANCHOR_TRUNCATED;
  if (projection.seq === want.seq && projection.chain_sha256 === want.chain_sha256) return ANCHOR_MATCH;
  return ANCHOR_DIVERGED;
}

const zeroByPriority = () => Object.fromEntries(PRIORITIES.map((p) => [p, 0]));

/** Statuses that carry open exposure: everything a script verdict or a supersession has not closed (header). */
export const EXPOSED_STATUSES = Object.freeze(["open", "regressed", "accepted", "false-positive"]);

/**
 * The `status` view: counts by status × priority (every cell present),
 * open_exposure = open + regressed + accepted + false-positive by priority
 * (EXPOSED_STATUSES: an approval never takes a row out of exposure, spec
 * §6.8), unauthenticated_approvals = rows with status accepted + rows with
 * status false-positive + rows with a non-empty ack_refs. Nothing is ever
 * subtracted from open_exposure (G-8).
 * @param {{rows: Record<string, object>}} projection
 * @returns {{counts: Record<string, Record<string, number>>, open_exposure: Record<string, number>, unauthenticated_approvals: number, rows: Record<string, object>}}
 */
export function summarize(projection) {
  if (!isPlainObject(projection) || !isPlainObject(projection.rows)) throw new TypeError("summarize: a projection with rows is required");
  const counts = Object.fromEntries(STATUSES.map((s) => [s, zeroByPriority()]));
  let unauthenticated_approvals = 0;
  for (const row of Object.values(projection.rows)) {
    if (!STATUSES.includes(row.status) || !PRIORITIES.includes(row.priority)) throw new TypeError(`summarize: row ${String(row.id)} has status ${String(row.status)} priority ${String(row.priority)}`);
    counts[row.status][row.priority] += 1;
    if (row.status === "accepted") unauthenticated_approvals += 1;
    if (row.status === "false-positive") unauthenticated_approvals += 1;
    if (Array.isArray(row.ack_refs) && row.ack_refs.length > 0) unauthenticated_approvals += 1;
  }
  const open_exposure = zeroByPriority();
  for (const p of PRIORITIES) open_exposure[p] = EXPOSED_STATUSES.reduce((n, s) => n + counts[s][p], 0);
  return { counts, open_exposure, unauthenticated_approvals, rows: projection.rows };
}
