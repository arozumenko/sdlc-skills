#!/usr/bin/env node
// register.mjs — the risk-register script (spec §6, D7): one append-only
// `<st>/register/events.jsonl`, rows `R-nnnn`; every command folds the whole
// log through `lib/transitions.mjs` and then appends at most one line.
//
// Log line: `{seq, ts, actor, row_id, event, payload}` — `seq` consecutive
// from 1, `ts` ISO-8601 from `new Date()` (the only clock in the bundle),
// `actor` from `--by` else `$USER` else "unknown". Events: add, accept,
// revoke, acceptance-expired, fixed, regressed, close-false-positive, reopen,
// supersede, ticket.
//
// Result lines (exit 0 ok · 2 usage / refused · 4 the check failed · 5 the
// log is corrupt):
//   add/accept/revoke/close-false-positive/reopen/supersede/ticket/fixed/regressed
//          ROW <id> <status> · REFUSED <why> (2)
//   check  EXPIRED <id>  (one per acceptance whose until < today, UTC)
//   status COUNT <status>=<n> ×6 · OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>
//          UNAUTHENTICATED-APPROVALS <n> · FINGERPRINT <engagement_id>:<seq>:<sha256(events.jsonl)>
//          --expect ⇒ MATCH | ADVANCED | DIVERGED (4) · --json ⇒ one JSON document, then the --expect line
//   render RENDERED .agents/security-testing/risk-register.md
//   all    USAGE(<sub>: <why>) (2) · CORRUPT events.jsonl:<n> <why> (5) · ENGAGEMENT-* (2)
//
// Open exposure counts rows in open|regressed|accepted per priority: an
// approval never subtracts (spec §2 row 6). Every approval payload carries
// `authenticated: false`; there is no `confirm` verb and nothing here can
// create a confirmed state. Messages never echo log bytes. Stdlib ESM only;
// no child process, no network. Imports only from ./lib/.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UsageError, runCli } from "./lib/cli.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { LIVE_STATUSES, PRIORITIES, ROW_ID, STATUSES, TRANSITIONS, TransitionError, applyTransition, isCalendarDay } from "./lib/transitions.mjs";

const LOG_REL = join("register", "events.jsonl");
const VIEW_REL = "risk-register.md";
const LINE_KEYS = Object.freeze(["seq", "ts", "actor", "row_id", "event", "payload"]);
/** Statuses that count as open exposure — an approval never moves a row out of this set. */
const EXPOSED = Object.freeze(["open", "regressed", "accepted"]);
/** Statuses whose row carries an approval-like (unauthenticated) record, read by status. */
const APPROVED = Object.freeze(["accepted", "false-positive"]);
export const UNAUTHENTICATED_SENTENCE = "None of these records is authenticated.";

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const short = (findingId) => `${findingId.slice(0, 8)}…`;

/** The log cannot be folded; `.token` is the result line, exit 5. */
export class CorruptError extends Error {
  constructor(line, why) {
    super(`events.jsonl:${line} ${why}`);
    this.name = "CorruptError";
    this.token = `CORRUPT events.jsonl:${line} ${why}`;
  }
}

/** A row-level refusal (`REFUSED <why>`, exit 2): a transition the table forbids, a missing row, a duplicate finding. */
export class RefusedError extends Error {
  constructor(why) {
    super(why);
    this.name = "RefusedError";
    this.token = `REFUSED ${why}`;
  }
}

// ---------------------------------------------------------------- log

const logPath = (root) => join(stDir(root), LOG_REL);

/**
 * The parsed log lines; a missing log is `[]`. A line that is not a JSON
 * object is corrupt — the message names the line, never its bytes.
 * @param {string} root
 * @returns {object[]}
 * @throws {CorruptError}
 */
export function readLog(root) {
  const path = logPath(root);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const raw = text.split("\n");
  if (raw.at(-1) === "") raw.pop();
  return raw.map((line, i) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CorruptError(i + 1, "not JSON");
    }
    if (!isObject(value)) throw new CorruptError(i + 1, "not an event object");
    return value;
  });
}

/** sha256 of the log bytes as they are on disk (an absent log hashes as empty). */
function logSha256(root) {
  const path = logPath(root);
  return sha256Hex(existsSync(path) ? readFileSync(path) : "");
}

/**
 * Fold the log into rows. Every line is checked (exact keys, consecutive
 * `seq`, a row id, a transition the table allows) — the CLI never writes a
 * line that fails here, so a failure is a corrupt log (exit 5).
 * @param {object[]} lines parsed log lines, in file order
 * @returns {{rows: Map<string, object>, seq: number}}
 * @throws {CorruptError}
 */
export function foldEvents(lines) {
  const rows = new Map();
  let seq = 0;
  lines.forEach((ev, i) => {
    const n = i + 1;
    if (!isObject(ev) || Object.keys(ev).length !== LINE_KEYS.length || !LINE_KEYS.every((k) => k in ev)) throw new CorruptError(n, "line keys are not {seq, ts, actor, row_id, event, payload}");
    if (ev.seq !== seq + 1) throw new CorruptError(n, `seq must be ${seq + 1}`);
    if (typeof ev.ts !== "string" || typeof ev.actor !== "string") throw new CorruptError(n, "ts and actor must be strings");
    if (typeof ev.row_id !== "string" || !ROW_ID.test(ev.row_id)) throw new CorruptError(n, "row_id is not R-nnnn");
    if (!Object.hasOwn(TRANSITIONS, ev.event)) throw new CorruptError(n, "unknown event");
    const row = rows.get(ev.row_id);
    if (ev.event === "add" && ev.row_id !== nextId(rows)) throw new CorruptError(n, `add must create ${nextId(rows)}`);
    let next;
    try {
      next = applyTransition(row, ev.event, ev.payload);
    } catch (e) {
      if (e instanceof TransitionError) throw new CorruptError(n, e.message);
      throw e;
    }
    if (ev.event === "supersede" && !rows.has(ev.payload.by)) throw new CorruptError(n, `supersede target ${ev.payload.by} does not exist`);
    next.id = ev.row_id;
    rows.set(ev.row_id, next);
    seq = ev.seq;
  });
  return { rows, seq };
}

/** The id `add` gives the next row: rows are never removed, so it is the count + 1. */
const nextId = (rows) => `R-${String(rows.size + 1).padStart(4, "0")}`;

/**
 * The live row holding a finding id, if any (a superseded or false-positive
 * row releases it).
 * @param {Map<string, object>} rows
 * @param {string} findingId
 * @returns {object | undefined}
 */
export function rowForFinding(rows, findingId) {
  for (const row of rows.values()) if (row.finding_id === findingId && LIVE_STATUSES.includes(row.status)) return row;
  return undefined;
}

/** `--by`, else `$USER`, else "unknown". */
const actorOf = (by) => (typeof by === "string" && by.length > 0 ? by : process.env.USER || "unknown");

/**
 * Fold, apply one event to one row, append one line. The fold happens first,
 * so a corrupt log or a refused transition writes nothing.
 * @param {string} root
 * @param {{event: string, rowId?: string, payload: object, actor: string}} ev `rowId` absent ⇒ `add`
 * @returns {object} the row after the event
 * @throws {CorruptError | RefusedError}
 */
function transition(root, { event, rowId, payload, actor }) {
  const { rows, seq } = foldEvents(readLog(root));
  const id = event === "add" ? nextId(rows) : rowId;
  const row = rows.get(id);
  if (event !== "add" && row === undefined) throw new RefusedError(`no row ${id}`);
  if (event === "add") {
    const live = rowForFinding(rows, payload.finding_id);
    if (live !== undefined) throw new RefusedError(`live row ${live.id} already has finding ${short(payload.finding_id)}`);
  }
  if (event === "supersede") {
    if (payload.by === id) throw new RefusedError("a row cannot supersede itself");
    if (!rows.has(payload.by)) throw new RefusedError(`supersede target ${payload.by} does not exist`);
  }
  let next;
  try {
    next = applyTransition(row, event, payload);
  } catch (e) {
    if (e instanceof TransitionError) throw new RefusedError(e.message);
    throw e;
  }
  next.id = id;
  const line = { seq: seq + 1, ts: new Date().toISOString(), actor, row_id: id, event, payload };
  mkdirSync(join(stDir(root), "register"), { recursive: true });
  appendFileSync(logPath(root), `${JSON.stringify(line)}\n`);
  return next;
}

/**
 * The `fixed`/`regressed` payload from a verify.json: its path relative to
 * the root, and the `verdict`/`head` it carries (strings, else "").
 * @param {string} root
 * @param {string} verifyPath
 * @throws {UsageError} the file is missing or not a JSON object
 */
function verifyPayload(root, verifyPath) {
  if (typeof verifyPath !== "string" || verifyPath.length === 0) throw new UsageError("--verify <verify.json> is required");
  const abs = resolve(root, verifyPath);
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    throw new UsageError(e && e.code === "ENOENT" ? `no such file ${verifyPath}` : `${verifyPath} is not valid JSON`);
  }
  if (!isObject(doc)) throw new UsageError(`${verifyPath} is not a JSON object`);
  const rel = relative(realpathSync(root), realpathSync(abs)); // both realpath'd: an aliased tmpdir (/var → /private/var) would otherwise never be "under" the root
  const verify = rel.startsWith("..") || isAbsolute(rel) ? abs : rel.split("\\").join("/");
  return { verify, verdict: typeof doc.verdict === "string" ? doc.verdict : "", head: typeof doc.head === "string" ? doc.head : "" };
}

const verifyEvent = (event) => (root, rowId, verifyPath, by) => {
  const row = transition(root, { event, rowId, payload: verifyPayload(root, verifyPath), actor: actorOf(by) });
  return { id: row.id, status: row.status };
};

/**
 * `fixed`/`regressed` for verify.mjs to call in-process: fold, append, return
 * `{id, status}`; throw `RefusedError` (no row / not allowed from the row's
 * status), `UsageError` (bad verify.json) or `CorruptError`. Never prints.
 * @type {(root: string, rowId: string, verifyPath: string, by?: string) => {id: string, status: string}}
 */
export const fixed = verifyEvent("fixed");
export const regressed = verifyEvent("regressed");

// ---------------------------------------------------------------- verbs

/** `<sub> R-nnnn …`: the row id positional, validated. */
function rowIdArg(args) {
  const id = args._[0];
  if (typeof id !== "string" || !ROW_ID.test(id)) throw new UsageError("a row id R-nnnn is required");
  return id;
}

/** `--<flag> <value>`: a non-empty string, else usage. */
function flag(args, name) {
  const v = args[name];
  if (typeof v !== "string" || v.length === 0) throw new UsageError(`--${name} <value> is required`);
  return v;
}

/** The approval payload every approval-like verb records; `authenticated` has no CLI spelling and is always false. */
function approvalPayload(args, actor, extra = {}) {
  if ("authenticated" in args) throw new UsageError("--authenticated is not a flag: approvals are never authenticated");
  return { recorded_by: actor, approved_by: typeof args["approved-by"] === "string" && args["approved-by"].length > 0 ? args["approved-by"] : actor, approval_ref: typeof args["approval-ref"] === "string" && args["approval-ref"].length > 0 ? args["approval-ref"] : "-", authenticated: false, ...extra };
}

const sayRow = (ctx, row) => ctx.out(`ROW ${row.id} ${row.status}`);

function add(args, ctx) {
  readEngagement(ctx.root);
  const finding_id = flag(args, "finding");
  if (!/^[0-9a-f]{64}$/.test(finding_id)) throw new UsageError("--finding must be a finding id (64 hex chars, from cite.mjs check)");
  const priority = flag(args, "priority");
  if (!PRIORITIES.includes(priority)) throw new UsageError(`--priority must be one of ${PRIORITIES.join("|")}`);
  const payload = { finding_id, title: flag(args, "title"), priority, owner: typeof args.owner === "string" ? args.owner : "" };
  sayRow(ctx, transition(ctx.root, { event: "add", payload, actor: actorOf(args.by) }));
}

function accept(args, ctx) {
  readEngagement(ctx.root);
  const rowId = rowIdArg(args);
  const until = flag(args, "until");
  if (!isCalendarDay(until)) throw new UsageError("--until must be a calendar day YYYY-MM-DD");
  const actor = actorOf(args.by);
  const payload = approvalPayload({ ...args, "approved-by": flag(args, "approved-by"), "approval-ref": flag(args, "approval-ref") }, actor, { until });
  sayRow(ctx, transition(ctx.root, { event: "accept", rowId, payload, actor }));
}

const approvalVerb = (event) => (args, ctx) => {
  readEngagement(ctx.root);
  const rowId = rowIdArg(args);
  const actor = actorOf(args.by);
  sayRow(ctx, transition(ctx.root, { event, rowId, payload: approvalPayload(args, actor), actor }));
};

function reopen(args, ctx) {
  readEngagement(ctx.root);
  const rowId = rowIdArg(args);
  const payload = { reason: flag(args, "reason") };
  sayRow(ctx, transition(ctx.root, { event: "reopen", rowId, payload, actor: actorOf(args.by) }));
}

/** `supersede R-a --by R-b` — here `--by` is the target row; the actor is `$USER`. */
function supersede(args, ctx) {
  readEngagement(ctx.root);
  const rowId = rowIdArg(args);
  const by = flag(args, "by");
  if (!ROW_ID.test(by)) throw new UsageError("--by must be a row id R-nnnn");
  sayRow(ctx, transition(ctx.root, { event: "supersede", rowId, payload: { by }, actor: actorOf(undefined) }));
}

function ticket(args, ctx) {
  readEngagement(ctx.root);
  const rowId = rowIdArg(args);
  const ticket_url = args._[1];
  if (typeof ticket_url !== "string" || ticket_url.length === 0) throw new UsageError("ticket R-nnnn <url>");
  sayRow(ctx, transition(ctx.root, { event: "ticket", rowId, payload: { ticket_url }, actor: actorOf(args.by) }));
}

const verifyVerb = (fn) => (args, ctx) => {
  readEngagement(ctx.root);
  const row = fn(ctx.root, rowIdArg(args), args.verify, args.by);
  ctx.out(`ROW ${row.id} ${row.status}`);
};

/** Today as a UTC calendar day — the bundle's one clock, shared with `ts`. */
const today = () => new Date().toISOString().slice(0, 10);

function check(args, ctx) {
  readEngagement(ctx.root);
  const { rows } = foldEvents(readLog(ctx.root));
  const now = today();
  for (const row of [...rows.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (row.status !== "accepted" || !(row.accepted_until < now)) continue;
    transition(ctx.root, { event: "acceptance-expired", rowId: row.id, payload: { until: row.accepted_until }, actor: actorOf(args.by) });
    ctx.out(`EXPIRED ${row.id}`);
  }
}

// ---------------------------------------------------------------- status / render

/** Fold + engagement + fingerprint: the state every read-only verb reports. */
function summary(root) {
  const { record } = readEngagement(root);
  const { rows, seq } = foldEvents(readLog(root));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const open_exposure = Object.fromEntries(PRIORITIES.map((p) => [p, 0]));
  let unauthenticated_approvals = 0;
  for (const row of rows.values()) {
    counts[row.status] += 1;
    if (EXPOSED.includes(row.status)) open_exposure[row.priority] += 1;
    if (APPROVED.includes(row.status)) unauthenticated_approvals += 1;
  }
  const sha = logSha256(root);
  const fingerprint = `${record.engagement_id}:${seq}:${sha}`;
  return { engagement_id: record.engagement_id, seq, sha256: sha, fingerprint, counts, open_exposure, unauthenticated_approvals, rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

const FINGERPRINT = /^([^:]+):(\d+):([0-9a-f]{64})$/;

/**
 * `--expect <FINGERPRINT>` (the pasted line, with or without its
 * `FINGERPRINT ` prefix): the same string ⇒ MATCH; the same engagement at a
 * higher seq ⇒ ADVANCED; anything else ⇒ DIVERGED (exit 4).
 */
function parseExpect(raw) {
  const expect = raw.startsWith("FINGERPRINT ") ? raw.slice("FINGERPRINT ".length) : raw;
  const m = FINGERPRINT.exec(expect);
  if (!m) throw new UsageError("--expect must be a FINGERPRINT <engagement_id>:<seq>:<sha256>");
  return { expect, engagement_id: m[1], seq: Number(m[2]) };
}

function compareExpect(expected, s) {
  if (expected.expect === s.fingerprint) return "MATCH";
  if (expected.engagement_id === s.engagement_id && expected.seq < s.seq) return "ADVANCED";
  return "DIVERGED";
}

function status(args, ctx) {
  const expected = typeof args.expect === "string" ? parseExpect(args.expect) : undefined; // before anything prints
  const s = summary(ctx.root);
  if (args.json === true) {
    ctx.out(JSON.stringify(s, null, 2));
  } else {
    for (const st of STATUSES) ctx.out(`COUNT ${st}=${s.counts[st]}`);
    ctx.out(`OPEN-EXPOSURE ${PRIORITIES.map((p) => `${p}=${s.open_exposure[p]}`).join(" ")}`);
    ctx.out(`UNAUTHENTICATED-APPROVALS ${s.unauthenticated_approvals}`);
    ctx.out(`FINGERPRINT ${s.fingerprint}`);
  }
  if (expected === undefined) return 0;
  const verdict = compareExpect(expected, s);
  ctx.out(verdict);
  return verdict === "DIVERGED" ? 4 : 0;
}

/** One Markdown table cell: never a pipe or a line break, never empty. */
const cell = (v) => {
  const flat = String(v ?? "").replace(/\r\n|\r|\n/g, " ").replace(/\|/g, "\\|");
  return flat === "" ? "-" : flat;
};
const tableLine = (cells) => `| ${cells.join(" | ")} |`;
const table = (columns, lines) => [tableLine(columns), tableLine(columns.map(() => "---")), ...lines.map((l) => tableLine(l.map(cell)))];

/** The last approval-like record of a row, by status (never by record presence). */
function approvalLine(row) {
  const rec = row.approvals.at(-1);
  if (row.status === "accepted" && rec?.event === "accept") return [row.id, "acceptance", rec.approved_by, rec.approval_ref, rec.until];
  if (row.status === "false-positive" && rec?.event === "close-false-positive") return [row.id, "false-positive", rec.approved_by, rec.approval_ref, "-"];
  return undefined;
}

/**
 * The register view as Markdown (LF, one trailing newline): rows, superseded
 * rows, open exposure per priority, unauthenticated approvals.
 * @param {ReturnType<typeof summary>} s
 * @returns {string}
 */
export function renderView(s) {
  const live = s.rows.filter((r) => r.status !== "superseded");
  const dead = s.rows.filter((r) => r.status === "superseded");
  const exposure = PRIORITIES.map((p) => [p, live.filter((r) => EXPOSED.includes(r.status) && r.priority === p).map((r) => r.id).join(", ")]);
  const approvals = live.map(approvalLine).filter((l) => l !== undefined);
  return [
    "# Risk register",
    "",
    `- engagement: \`${s.engagement_id}\``,
    `- seq: \`${s.seq}\``,
    `- fingerprint: \`${s.fingerprint}\``,
    "",
    "## Rows",
    "",
    ...table(["id", "finding", "priority", "status", "owner", "ticket", "title"], live.map((r) => [r.id, short(r.finding_id), r.priority, r.status, r.owner, r.ticket_url, r.title])),
    "",
    "## Superseded",
    "",
    ...table(["id", "superseded by", "finding", "title"], dead.map((r) => [r.id, r.superseded_by, short(r.finding_id), r.title])),
    "",
    "## Open exposure",
    "",
    ...table(["priority", "rows"], exposure),
    "",
    "## Unauthenticated approvals",
    "",
    UNAUTHENTICATED_SENTENCE,
    "",
    ...table(["row", "kind", "approved by", "approval ref", "until"], approvals),
    "",
  ].join("\n");
}

function render(args, ctx) {
  const s = summary(ctx.root);
  const path = join(stDir(ctx.root), VIEW_REL);
  mkdirSync(stDir(ctx.root), { recursive: true });
  writeFileSync(path, renderView(s));
  ctx.out(`RENDERED ${relative(ctx.root, path).split("\\").join("/")}`);
}

// ---------------------------------------------------------------- dispatch

/**
 * A command whose own usage errors print as `USAGE(<sub>: <why>)` (exit 2),
 * a refusal as `REFUSED <why>` (2) and a corrupt log as `CORRUPT …` (5);
 * everything else propagates to runCli.
 */
const command = (sub, fn) => (args, ctx) => {
  try {
    return fn(args, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      ctx.out(`USAGE(${sub}: ${e.message})`);
      return 2;
    }
    if (e instanceof RefusedError) {
      ctx.out(e.token);
      return 2;
    }
    if (e instanceof CorruptError) {
      ctx.out(e.token);
      return 5;
    }
    throw e;
  }
};

export const COMMANDS = Object.fromEntries(
  Object.entries({ add, accept, revoke: approvalVerb("revoke"), "close-false-positive": approvalVerb("close-false-positive"), reopen, supersede, ticket, fixed: verifyVerb(fixed), regressed: verifyVerb(regressed), check, status, render }).map(([sub, fn]) => [sub, command(sub, fn)]),
);

/** True when this file is the process entry script (both sides realpath'd: symlinked installs, aliased tmpdirs). */
function isEntryScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "register", booleans: ["json"] }));
