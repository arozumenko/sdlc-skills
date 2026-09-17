// lib/transitions.mjs — the register's transition table as data and the pure
// function that applies it. No file system, no clock, no git: register.mjs
// folds every event of `events.jsonl` through `applyTransition`, so a line
// the table refuses can never have been written by the CLI (a corrupt log is
// exit 5 there). Hand-ported from the reference implementation's
// `register-transitions.mjs`, reduced to the ten events of spec §6 — no
// aliases, subject kinds, supersede modes or emitter lists.
//
// TRANSITIONS[event] = {from: [...statuses], to: <status> | "same"};
// `from: [NO_ROW]` means "no row yet" (`add`). Any (event, from) pair outside
// the table is a `TransitionError("<event> not allowed from <status>")`.
//
// Approvals (spec §2 row 6): every approval-like payload — `accept`,
// `revoke`, `close-false-positive` — is `{recorded_by, approved_by,
// approval_ref, authenticated: false}` (+ `until` for an acceptance).
// Nothing here can produce an authenticated record: `authenticated` must be
// exactly `false` or the transition throws "approvals are never
// authenticated". `accepted_until` is present only while the status is
// `accepted`; every transition out of it clears the field.

export const NO_ROW = "-";
export const STATUSES = Object.freeze(["open", "fixed", "regressed", "accepted", "false-positive", "superseded"]);
export const PRIORITIES = Object.freeze(["p0", "p1", "p2", "p3"]);
/** A live row holds a finding id against re-`add`; `supersede` and `ticket` act on live rows only. */
export const LIVE_STATUSES = Object.freeze(["open", "fixed", "regressed", "accepted"]);
export const APPROVAL_KEYS = Object.freeze(["recorded_by", "approved_by", "approval_ref", "authenticated"]);

const t = (from, to) => Object.freeze({ from: Object.freeze([...from]), to });

/** Spec §6 transition table, as data. */
export const TRANSITIONS = Object.freeze({
  add: t([NO_ROW], "open"),
  accept: t(["open", "regressed"], "accepted"),
  revoke: t(["accepted"], "open"),
  "acceptance-expired": t(["accepted"], "open"),
  fixed: t(["open", "regressed", "accepted"], "fixed"),
  regressed: t(["fixed"], "regressed"),
  "close-false-positive": t(["open", "regressed"], "false-positive"),
  reopen: t(["fixed", "false-positive"], "open"),
  supersede: t(LIVE_STATUSES, "superseded"),
  ticket: t(LIVE_STATUSES, "same"),
});

export const EVENTS = Object.freeze(Object.keys(TRANSITIONS));

const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ROW_ID = /^R-\d{4}$/;

/** An (event, from) pair outside the table, or a payload the event does not accept. Messages never echo payload values. */
export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.length > 0;

/**
 * A real YYYY-MM-DD calendar day (proleptic Gregorian).
 * @param {unknown} s
 * @returns {boolean}
 */
export function isCalendarDay(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1];
}

/** The row `add` starts from; every field present, `id` filled in by the caller. */
function emptyRow() {
  return { id: "", finding_id: "", title: "", priority: "p3", status: "open", owner: "", ticket_url: "", accepted_until: "", approvals: [], superseded_by: "" };
}

// --- payload checks (one per event; exact keys) ------------------------------

function exactKeys(event, payload, keys) {
  if (!isPlainObject(payload)) throw new TransitionError(`${event}: payload must be an object`);
  for (const k of Object.keys(payload)) if (!keys.includes(k)) throw new TransitionError(`${event}: payload key ${k} is not a field ${event} sets`);
  for (const k of keys) if (!(k in payload)) throw new TransitionError(`${event}: payload.${k} is required`);
}

function checkApproval(event, payload, extraKeys = []) {
  exactKeys(event, payload, [...APPROVAL_KEYS, ...extraKeys]);
  for (const k of ["recorded_by", "approved_by", "approval_ref"]) if (!nonEmptyString(payload[k])) throw new TransitionError(`${event}: payload.${k} must be a non-empty string`);
  if (payload.authenticated !== false) throw new TransitionError("approvals are never authenticated");
}

function checkVerify(event, payload) {
  exactKeys(event, payload, ["verify", "verdict", "head"]);
  if (!nonEmptyString(payload.verify)) throw new TransitionError(`${event}: payload.verify must be a non-empty string`);
  for (const k of ["verdict", "head"]) if (typeof payload[k] !== "string") throw new TransitionError(`${event}: payload.${k} must be a string`);
}

const CHECKS = {
  add(p) {
    exactKeys("add", p, ["finding_id", "title", "priority", "owner"]);
    if (typeof p.finding_id !== "string" || !SHA256.test(p.finding_id)) throw new TransitionError("add: payload.finding_id must be a finding id (sha256 hex)");
    if (!nonEmptyString(p.title)) throw new TransitionError("add: payload.title must be a non-empty string");
    if (!PRIORITIES.includes(p.priority)) throw new TransitionError("add: payload.priority is not p0|p1|p2|p3");
    if (typeof p.owner !== "string") throw new TransitionError("add: payload.owner must be a string");
  },
  accept(p) {
    checkApproval("accept", p, ["until"]);
    if (!isCalendarDay(p.until)) throw new TransitionError("accept: payload.until must be a calendar day YYYY-MM-DD");
  },
  revoke: (p) => checkApproval("revoke", p),
  "acceptance-expired"(p) {
    exactKeys("acceptance-expired", p, ["until"]);
    if (!isCalendarDay(p.until)) throw new TransitionError("acceptance-expired: payload.until must be a calendar day YYYY-MM-DD");
  },
  fixed: (p) => checkVerify("fixed", p),
  regressed: (p) => checkVerify("regressed", p),
  "close-false-positive": (p) => checkApproval("close-false-positive", p),
  reopen(p) {
    exactKeys("reopen", p, ["reason"]);
    if (!nonEmptyString(p.reason)) throw new TransitionError("reopen: payload.reason must be a non-empty string");
  },
  supersede(p) {
    exactKeys("supersede", p, ["by"]);
    if (typeof p.by !== "string" || !ROW_ID.test(p.by)) throw new TransitionError("supersede: payload.by must be a row id R-nnnn");
  },
  ticket(p) {
    exactKeys("ticket", p, ["ticket_url"]);
    if (!nonEmptyString(p.ticket_url)) throw new TransitionError("ticket: payload.ticket_url must be a non-empty string");
  },
};

/**
 * Apply one event to one row (pure; returns a new row). `row` is undefined
 * for `add`; the caller sets `id` on the result.
 * @param {object | undefined} row
 * @param {string} event
 * @param {object} payload
 * @returns {object} the new row
 * @throws {TransitionError}
 */
export function applyTransition(row, event, payload) {
  const from = row === undefined || row === null ? NO_ROW : row.status;
  const spec = TRANSITIONS[event];
  if (spec === undefined || !spec.from.includes(from)) throw new TransitionError(`${event} not allowed from ${from}`);
  CHECKS[event](payload);
  const next = from === NO_ROW ? emptyRow() : structuredClone(row);
  if (spec.to !== "same") next.status = spec.to;
  if (from === "accepted" && next.status !== "accepted") next.accepted_until = "";
  switch (event) {
    case "add":
      Object.assign(next, payload);
      break;
    case "accept":
      next.accepted_until = payload.until;
      next.approvals.push({ event, ...payload });
      break;
    case "revoke":
    case "close-false-positive":
      next.approvals.push({ event, ...payload });
      break;
    case "supersede":
      next.superseded_by = payload.by;
      break;
    case "ticket":
      next.ticket_url = payload.ticket_url;
      break;
    default:
      break; // acceptance-expired, fixed, regressed, reopen: status only
  }
  return next;
}
