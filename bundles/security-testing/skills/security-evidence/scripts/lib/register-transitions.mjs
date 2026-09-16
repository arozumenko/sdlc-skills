// lib/register-transitions.mjs — the register's transition table as data and
// the pure functions that apply it (TASK-029; spec §6.8, D15, plan §4.3).
// No file system, no clock, no git (G-9): register-fold.replay folds every
// event through applyEvent, and `check` / `sign-off` re-run that fold over a
// snapshot without touching the live register.
//
// TRANSITIONS[event] = {from: [...statuses] | "any", to: <status> | "same",
// requires: [...cli flags], emitters: [...commands]} — exactly the §4.3 table
// (v3 §6.7 minus the forbidden verb, plus P5). `from: [NO_ROW]` means "no row yet"
// (`add`); `from: []` means the event never touches a row (`alias` lines live
// in finding-alias.jsonl, never in events.jsonl). Any (event, from) pair
// outside the table is a TransitionError; the command layer prints it as
// `TRANSITION-REJECTED(<event>: <from>)` (exit 4).
//
// Emitter-only events (EMITTER_ONLY_EVENTS) are appended only by the command
// named in `emitters` — `ingest tracker-readback` (ticketed), `consume-verdict`
// (fixed, regressed, regression-observed, verify-observed), `check`
// (acceptance-expired) — through register-core.append directly; the generic
// `transition` verb refuses them with `EMITTER-ONLY(<event>)` (exit 2).
//
// Approvals (D15, G-8). Every approval-like payload — `accept`, `revoke`,
// `close-false-positive` — is `{recorded_by, approved_by, approval_ref,
// authenticated: false}` (+ `until` for an acceptance), checked here so a
// record with any other `authenticated` value never folds. Nothing in this
// module can produce an authenticated record, and nothing reduces open
// exposure: an acceptance or a false-positive record moves a row into the
// unauthenticated-approvals bucket and leaves it in exposure
// (register-fold.summarize).
//
// Invariant: `acceptance` is present only while status is `accepted` and
// `false_positive` only while status is `false-positive` — every transition
// out of those statuses (revoke, acceptance-expired, fixed, reopen, a
// transfer-exposure reopen) strips the record. The one exception is a
// `superseded` row, where a record left behind is history on a dead row.
// Consumers (TASK-046 skill, TASK-059 render) read the approval state from
// `status`, never from the record's presence.
//
// Supersession (spec §6.8, US-021 AC-5). One event on the SOURCE row
// `{by, mode: subject-equivalent | transfer-exposure}`; applyEvent updates the
// target FIRST (`supersedes`, and for transfer-exposure `priority =
// max(both)` and `status = open` when the source was open|regressed), then
// the source becomes `superseded` with `superseded_by`. The target must exist,
// differ from the source and not itself be superseded — a superseded target
// is either a cycle (its chain leads back to the source) or a dead row; both
// are refused before anything is appended. Whether the subjects are
// equivalent (same finding id, or linked through the alias log) is the
// command's guard: the fold cannot see finding-alias.jsonl.
//
// Alias log. Lines `{from_id, to_id, reason, run_id, seq, prev_sha256}`
// chain exactly like events (sha256 over the canonical line, genesis zeros);
// verifyAliasChain / aliasSha256 mirror register-fold.verifyChain /
// eventSha256. Equivalence through aliases is undirected and transitive.
//
// Expiry. `check` expires an acceptance whose `until` (a UTC calendar day)
// is strictly before today's UTC date: on the `until` day itself the
// acceptance still stands; it lapses at 00:00 UTC of the next day.

import { canonical, sha256Hex } from "../canon.mjs";
import { REGISTER_PRIORITIES, REGISTER_STATUSES, VERDICT_PATTERN } from "./tokens.mjs";

export const NO_ROW = "-";
export const STATUSES = REGISTER_STATUSES;
export const PRIORITIES = REGISTER_PRIORITIES;
export const SUBJECT_KINDS = Object.freeze(["finding", "threat"]);
export const SUPERSEDE_MODES = Object.freeze(["subject-equivalent", "transfer-exposure"]);

/** The fields `add` sets; every other Row field starts empty (emptyRow). */
export const ADD_PAYLOAD_KEYS = Object.freeze(["subject", "subject_kind", "title", "priority", "owner", "first_seen_run"]);
export const APPROVAL_KEYS = Object.freeze(["recorded_by", "approved_by", "approval_ref", "authenticated"]);
export const ALIAS_KEYS = Object.freeze(["from_id", "to_id", "reason", "run_id", "seq", "prev_sha256"]);

const freeze = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? Object.freeze([...v]) : v])));

/** Plan §4.3 transition table, verbatim, as data. */
export const TRANSITIONS = Object.freeze({
  add: freeze({ from: [NO_ROW], to: "open", requires: ["subject", "priority", "title", "run"], emitters: ["add"] }),
  accept: freeze({ from: ["open", "regressed"], to: "accepted", requires: ["until", "approved-by", "approval-ref"], emitters: ["accept"] }),
  revoke: freeze({ from: ["accepted"], to: "open", requires: ["approved-by", "approval-ref"], emitters: ["revoke"] }),
  "acceptance-expired": freeze({ from: ["accepted"], to: "open", requires: [], emitters: ["check"] }),
  fixed: freeze({ from: ["open", "regressed", "accepted"], to: "fixed", requires: [], emitters: ["consume-verdict"] }),
  regressed: freeze({ from: ["fixed"], to: "regressed", requires: [], emitters: ["consume-verdict"] }),
  "close-false-positive": freeze({ from: ["open"], to: "false-positive", requires: ["approved-by", "approval-ref"], emitters: ["close-false-positive"] }),
  reopen: freeze({ from: ["false-positive"], to: "open", requires: ["reason"], emitters: ["reopen"] }),
  supersede: freeze({ from: ["open", "regressed", "accepted"], to: "superseded", requires: ["by"], emitters: ["supersede"] }),
  ticketed: freeze({ from: "any", to: "same", requires: [], emitters: ["ingest tracker-readback"] }),
  "regression-observed": freeze({ from: "any", to: "same", requires: [], emitters: ["consume-verdict"] }),
  "verify-observed": freeze({ from: "any", to: "same", requires: [], emitters: ["consume-verdict"] }),
  alias: freeze({ from: [], to: NO_ROW, requires: ["from", "to", "reason", "run"], emitters: ["alias"] }),
});

export const EVENTS = Object.freeze(Object.keys(TRANSITIONS));

/** Register verbs a person runs on a row; every other emitter is a script step. */
const ROW_VERBS = Object.freeze(["add", "accept", "revoke", "close-false-positive", "reopen", "supersede", "alias"]);

/** Events the generic `transition` verb refuses (`EMITTER-ONLY(<event>)`): their emitter is not a row verb. */
export const EMITTER_ONLY_EVENTS = Object.freeze(EVENTS.filter((e) => !TRANSITIONS[e].emitters.some((m) => ROW_VERBS.includes(m))));

const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_8601 = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const ROW_ID = /^R-[0-9]{4}$/;

/** An (event, from) pair outside the transition table, or a payload the transition does not accept. */
export class TransitionError extends Error {
  /**
   * @param {string} event
   * @param {string} from the row's current status, or "-" for no row
   * @param {string} [detail]
   */
  constructor(event, from, detail) {
    super(detail ? `${event} from ${from}: ${detail}` : `${event} from ${from}`);
    this.name = "TransitionError";
    this.event = event;
    this.from = from;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.length > 0;

/**
 * A Row with every schema field present and empty, ready for `add`'s fields.
 * @param {string} id R-nnnn
 * @returns {object}
 */
export function emptyRow(id) {
  return {
    id,
    subject: "",
    subject_kind: "finding",
    title: "",
    status: "open",
    priority: "p3",
    owner: "",
    first_seen_run: "",
    last_verified_run: "",
    ticket_url: "",
    test_refs: [],
    proposal_refs: [],
    ack_refs: [],
    rationale: "",
    supersedes: "",
    superseded_by: "",
  };
}

/**
 * Is (event, from) a pair of the table?
 * @param {string} event
 * @param {string} from a status or NO_ROW
 * @returns {boolean}
 */
export function allowedFrom(event, from) {
  const spec = TRANSITIONS[event];
  if (spec === undefined) return false;
  if (spec.from === "any") return from !== NO_ROW && STATUSES.includes(from);
  return spec.from.includes(from);
}

/**
 * A calendar day is real: YYYY-MM-DD that round-trips through the UTC calendar.
 * @param {unknown} s
 * @returns {boolean}
 */
export function isCalendarDay(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// Civil-calendar arithmetic without the Date object (G-1: no clock, and the
// purity guard greps for the Date constructor). Proleptic Gregorian, days since
// 1970-01-01 (Howard Hinnant's days_from_civil / civil_from_days).
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// --- payload checks (one per event; exact keys) ------------------------------

function exactKeys(event, from, payload, keys) {
  if (!isPlainObject(payload)) throw new TransitionError(event, from, "payload must be an object");
  for (const k of Object.keys(payload)) if (!keys.includes(k)) throw new TransitionError(event, from, `payload key ${JSON.stringify(k)} is not a field ${event} sets`);
  for (const k of keys) if (!(k in payload)) throw new TransitionError(event, from, `payload.${k} is required`);
}

function checkApproval(event, from, payload, extraKeys = []) {
  exactKeys(event, from, payload, [...APPROVAL_KEYS, ...extraKeys]);
  for (const k of ["recorded_by", "approved_by", "approval_ref"]) {
    if (!nonEmptyString(payload[k])) throw new TransitionError(event, from, `payload.${k} must be a non-empty string`);
  }
  if (payload.authenticated !== false) throw new TransitionError(event, from, "an approval record is always authenticated: false (D15)");
}

function checkSha(event, from, payload, key) {
  if (typeof payload[key] !== "string" || !SHA256.test(payload[key])) throw new TransitionError(event, from, `payload.${key} must be a sha256`);
}

const CHECKS = {
  add(from, p) {
    exactKeys("add", from, p, ADD_PAYLOAD_KEYS);
    for (const k of ADD_PAYLOAD_KEYS) if (typeof p[k] !== "string") throw new TransitionError("add", from, `payload.${k} must be a string`);
    if (p.subject.length === 0) throw new TransitionError("add", from, "payload.subject must be non-empty");
    if (!SUBJECT_KINDS.includes(p.subject_kind)) throw new TransitionError("add", from, `payload.subject_kind ${JSON.stringify(p.subject_kind)} is not finding|threat`);
    if (!PRIORITIES.includes(p.priority)) throw new TransitionError("add", from, `payload.priority ${JSON.stringify(p.priority)} is not p0|p1|p2|p3`);
  },
  accept(from, p) {
    checkApproval("accept", from, p, ["until"]);
    if (!isCalendarDay(p.until)) throw new TransitionError("accept", from, "payload.until must be a calendar day YYYY-MM-DD");
  },
  revoke(from, p) {
    checkApproval("revoke", from, p);
  },
  "acceptance-expired"(from, p, row) {
    exactKeys("acceptance-expired", from, p, ["until"]);
    if (!isCalendarDay(p.until)) throw new TransitionError("acceptance-expired", from, "payload.until must be a calendar day YYYY-MM-DD");
    if (!isPlainObject(row.acceptance) || row.acceptance.until !== p.until) throw new TransitionError("acceptance-expired", from, `payload.until ${p.until} is not the row's acceptance until`);
  },
  fixed(from, p) {
    exactKeys("fixed", from, p, ["verify_sha256", "ack_refs", "last_verified_run"]);
    checkSha("fixed", from, p, "verify_sha256");
    if (!Array.isArray(p.ack_refs) || !p.ack_refs.every((r) => typeof r === "string" && SHA256.test(r))) throw new TransitionError("fixed", from, "payload.ack_refs must be an array of sha256");
    if (typeof p.last_verified_run !== "string") throw new TransitionError("fixed", from, "payload.last_verified_run must be a string");
  },
  regressed(from, p) {
    exactKeys("regressed", from, p, ["verify_sha256"]);
    checkSha("regressed", from, p, "verify_sha256");
  },
  "close-false-positive"(from, p) {
    checkApproval("close-false-positive", from, p);
  },
  reopen(from, p) {
    exactKeys("reopen", from, p, ["reason"]);
    if (!nonEmptyString(p.reason)) throw new TransitionError("reopen", from, "payload.reason must be a non-empty string");
  },
  supersede(from, p) {
    exactKeys("supersede", from, p, ["by", "mode"]);
    if (typeof p.by !== "string" || !ROW_ID.test(p.by)) throw new TransitionError("supersede", from, "payload.by must be a row id R-nnnn");
    if (!SUPERSEDE_MODES.includes(p.mode)) throw new TransitionError("supersede", from, `payload.mode must be ${SUPERSEDE_MODES.join("|")}`);
  },
  ticketed(from, p) {
    exactKeys("ticketed", from, p, ["ticket_url", "import_sha256"]);
    if (!nonEmptyString(p.ticket_url)) throw new TransitionError("ticketed", from, "payload.ticket_url must be a non-empty string");
    checkSha("ticketed", from, p, "import_sha256");
  },
  "regression-observed"(from, p) {
    exactKeys("regression-observed", from, p, ["verify_sha256"]);
    checkSha("regression-observed", from, p, "verify_sha256");
  },
  "verify-observed"(from, p) {
    exactKeys("verify-observed", from, p, ["verify_sha256", "verdict"]);
    checkSha("verify-observed", from, p, "verify_sha256");
    if (typeof p.verdict !== "string" || !VERDICT_PATTERN.test(p.verdict)) throw new TransitionError("verify-observed", from, "payload.verdict is outside the closed vocabulary");
  },
};

// --- the per-row transition ---------------------------------------------------

/**
 * Apply one event to one row (pure; returns a new row). `row` is undefined
 * for `add`. Only the source side of `supersede` happens here — the target's
 * update is applyEvent's, over the row map.
 * @param {object | undefined} row
 * @param {string} event
 * @param {object} payload
 * @returns {object} the new row
 * @throws {TransitionError}
 */
export function applyTransition(row, event, payload) {
  const from = row === undefined || row === null ? NO_ROW : row.status;
  if (!allowedFrom(event, from)) throw new TransitionError(event, from);
  const spec = TRANSITIONS[event];
  CHECKS[event](from, payload, row);
  const next = from === NO_ROW ? emptyRow("") : structuredClone(row);
  if (spec.to !== "same") next.status = spec.to;
  switch (event) {
    case "add":
      Object.assign(next, payload);
      break;
    case "accept":
      next.acceptance = { ...payload };
      break;
    case "revoke":
    case "acceptance-expired":
      delete next.acceptance;
      break;
    case "fixed":
      next.ack_refs = [...payload.ack_refs];
      next.last_verified_run = payload.last_verified_run;
      delete next.acceptance;
      break;
    case "close-false-positive":
      next.false_positive = { ...payload };
      break;
    case "reopen":
      delete next.false_positive;
      next.rationale = payload.reason;
      break;
    case "supersede":
      next.superseded_by = payload.by;
      break;
    case "ticketed":
      next.ticket_url = payload.ticket_url;
      break;
    default:
      break; // regressed, regression-observed, verify-observed: status only, or nothing
  }
  return next;
}

/**
 * The `--transfer-exposure` half of a supersession, on the target (pure):
 * `priority = max(both)`; `status = open` when the source was open|regressed
 * (a target reopened this way carries no stale acceptance or false-positive
 * record — the same invariant revoke / acceptance-expired / reopen keep).
 * Applied BEFORE the source becomes superseded.
 * @param {object} target
 * @param {object} source
 * @returns {object} the new target
 */
export function transferExposure(target, source) {
  const next = structuredClone(target);
  if (PRIORITIES.indexOf(source.priority) < PRIORITIES.indexOf(target.priority)) next.priority = source.priority;
  if (source.status === "open" || source.status === "regressed") {
    next.status = "open";
    delete next.acceptance;
    delete next.false_positive;
  }
  return next;
}

/**
 * Can `sourceId` be superseded by `by`? Self, a missing target, a target
 * whose supersession chain leads back to the source (cycle) or any other
 * already-superseded target (dead) are refused.
 * @param {Record<string, object>} rows
 * @param {string} sourceId
 * @param {string} by
 * @returns {{ok: true, target: object} | {ok: false, reason: "self" | "missing" | "cycle" | "superseded"}}
 */
export function supersedeTarget(rows, sourceId, by) {
  if (by === sourceId) return { ok: false, reason: "self" };
  const target = rows[by];
  if (target === undefined) return { ok: false, reason: "missing" };
  if (target.status === "superseded") {
    const seen = new Set();
    let cursor = target;
    while (cursor !== undefined && cursor.status === "superseded" && cursor.superseded_by !== "" && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.superseded_by === sourceId) return { ok: false, reason: "cycle" };
      cursor = rows[cursor.superseded_by];
    }
    return { ok: false, reason: "superseded" };
  }
  return { ok: true, target };
}

/**
 * Apply one chain-verified event to the row map (pure; returns a new map).
 * @param {Record<string, object>} rows
 * @param {{row_id: string, event: string, payload: object}} event
 * @returns {Record<string, object>}
 * @throws {TransitionError}
 */
export function applyEvent(rows, event) {
  const existing = rows[event.row_id];
  const from = existing === undefined ? NO_ROW : existing.status;
  if (event.event === "alias") throw new TransitionError("alias", from, "alias lines live in finding-alias.jsonl, not in events.jsonl");
  if (event.event === "add") {
    if (existing !== undefined) throw new TransitionError("add", from);
    return { ...rows, [event.row_id]: { ...applyTransition(undefined, "add", event.payload), id: event.row_id } };
  }
  if (event.event === "supersede") {
    const source = applyTransition(existing, "supersede", event.payload); // (event, from) and payload checks first
    const guard = supersedeTarget(rows, event.row_id, event.payload.by);
    if (!guard.ok) {
      const detail = { self: "a row cannot supersede itself", missing: `target ${event.payload.by} does not exist`, cycle: `target ${event.payload.by} is superseded by a chain that leads back to ${event.row_id}`, superseded: `target ${event.payload.by} is itself superseded` }[guard.reason];
      throw new TransitionError("supersede", from, detail);
    }
    const target = event.payload.mode === "transfer-exposure" ? transferExposure(guard.target, existing) : structuredClone(guard.target);
    target.supersedes = event.row_id;
    return { ...rows, [event.payload.by]: target, [event.row_id]: source };
  }
  return { ...rows, [event.row_id]: applyTransition(existing, event.event, event.payload) };
}

// --- expiry ---------------------------------------------------------------------

/**
 * The UTC calendar day of an ISO-8601 timestamp (offsets are normalised).
 * @param {string} iso
 * @returns {string} YYYY-MM-DD
 */
export function todayOf(iso) {
  const m = typeof iso === "string" ? iso.match(ISO_8601) : null;
  if (!m || !isCalendarDay(m[1])) throw new TypeError(`todayOf: not an ISO-8601 timestamp: ${String(iso)}`);
  const [y, mo, d] = m[1].split("-").map(Number);
  let minutes = Number(m[2]) * 60 + Number(m[3]);
  if (m[4] !== "Z") {
    const sign = m[4][0] === "-" ? -1 : 1;
    minutes -= sign * (Number(m[4].slice(1, 3)) * 60 + Number(m[4].slice(4, 6)));
  }
  return civilFromDays(daysFromCivil(y, mo, d) + Math.floor(minutes / 1440));
}

/**
 * Accepted rows whose `until` is strictly before `today` (UTC calendar days
 * compare as strings), in row-id order.
 * @param {Record<string, object>} rows
 * @param {string} today YYYY-MM-DD
 * @returns {Array<{id: string, until: string}>}
 */
export function expiredAcceptances(rows, today) {
  if (!isCalendarDay(today)) throw new TypeError(`expiredAcceptances: today must be YYYY-MM-DD, got ${String(today)}`);
  const out = [];
  for (const id of Object.keys(rows).sort()) {
    const row = rows[id];
    if (row.status !== "accepted" || !isPlainObject(row.acceptance)) continue;
    if (row.acceptance.until < today) out.push({ id, until: row.acceptance.until });
  }
  return out;
}

// --- alias chain ----------------------------------------------------------------

/**
 * sha256 over the canonical bytes of one alias line.
 * @param {object} alias
 * @returns {string}
 */
export function aliasSha256(alias) {
  return sha256Hex(canonical(alias));
}

function checkAliasShape(alias, position) {
  if (!isPlainObject(alias)) throw new TypeError(`alias ${position}: not an object`);
  for (const k of Object.keys(alias)) if (!ALIAS_KEYS.includes(k)) throw new TypeError(`alias ${position}: unknown key ${JSON.stringify(k)}`);
  for (const k of ALIAS_KEYS) if (!(k in alias)) throw new TypeError(`alias ${position}: missing key ${JSON.stringify(k)}`);
  for (const k of ["from_id", "to_id"]) if (typeof alias[k] !== "string" || !SHA256.test(alias[k])) throw new TypeError(`alias ${position}: ${k} must be a finding id (sha256)`);
  if (alias.from_id === alias.to_id) throw new TypeError(`alias ${position}: a finding id cannot alias itself`);
  for (const k of ["reason", "run_id"]) if (typeof alias[k] !== "string") throw new TypeError(`alias ${position}: ${k} must be a string`);
  if (!Number.isInteger(alias.seq) || alias.seq < 1) throw new TypeError(`alias ${position}: seq must be a positive integer`);
  if (typeof alias.prev_sha256 !== "string" || !SHA256.test(alias.prev_sha256)) throw new TypeError(`alias ${position}: prev_sha256 must be 64 lowercase hex chars`);
}

/**
 * Walk finding-alias.jsonl exactly like register-fold.verifyChain walks the
 * event log: exact keys, seq 1..n, each prev_sha256 the previous line's hash.
 * @param {object[]} aliases
 * @returns {{seq: number, chain_sha256: string}}
 * @throws {TypeError} where the chain breaks
 */
export function verifyAliasChain(aliases) {
  if (!Array.isArray(aliases)) throw new TypeError("verifyAliasChain: aliases must be an array");
  let prev = "0".repeat(64);
  let seq = 0;
  for (const [i, alias] of aliases.entries()) {
    checkAliasShape(alias, i + 1);
    if (alias.seq !== seq + 1) throw new TypeError(`alias seq ${alias.seq}: seq must be ${seq + 1} (consecutive from 1)`);
    if (alias.prev_sha256 !== prev) throw new TypeError(`alias seq ${alias.seq}: prev_sha256 does not match the previous line's hash`);
    prev = aliasSha256(alias);
    seq = alias.seq;
  }
  return { seq, chain_sha256: prev };
}

/**
 * Are two finding ids the same, or connected through the alias log
 * (undirected, transitive)?
 * @param {object[]} aliases
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function aliasLinked(aliases, a, b) {
  if (a === b) return true;
  const adj = new Map();
  const link = (x, y) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x).add(y);
  };
  for (const alias of aliases) {
    link(alias.from_id, alias.to_id);
    link(alias.to_id, alias.from_id);
  }
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length > 0) {
    const x = stack.pop();
    for (const y of adj.get(x) ?? []) {
      if (y === b) return true;
      if (!seen.has(y)) {
        seen.add(y);
        stack.push(y);
      }
    }
  }
  return false;
}

/**
 * `--subject-equivalent`: the two rows' subjects are the same id, or both are
 * findings linked through the alias log. A threat subject is only ever
 * equivalent to the same threat id.
 * @param {Record<string, object>} rows
 * @param {object[]} aliases
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {boolean}
 */
export function subjectEquivalent(rows, aliases, sourceId, targetId) {
  const s = rows[sourceId];
  const t = rows[targetId];
  if (s === undefined || t === undefined) return false;
  if (s.subject === t.subject && s.subject_kind === t.subject_kind) return true;
  if (s.subject_kind !== "finding" || t.subject_kind !== "finding") return false;
  return aliasLinked(aliases, s.subject, t.subject);
}
