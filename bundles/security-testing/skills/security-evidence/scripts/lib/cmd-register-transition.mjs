// lib/cmd-register-transition.mjs — the register's row verbs and their
// generic form (TASK-029; plan §4.3, spec §6.8, D15):
//
//   accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>
//   revoke <R-id> --approved-by <who> --approval-ref <ref>
//   check                                          expire acceptances with until < today (UTC)
//   close-false-positive <R-id> --approved-by <who> --approval-ref <ref>
//   reopen <R-id> --reason <r>
//   supersede <R-id> --by <R-id> (--subject-equivalent | --transfer-exposure)
//   alias --from <finding_id> --to <finding_id> --reason <r> --run <run_id>
//   transition <event> <R-id> [flags]              generic form of the row verbs
//
// One module, many dispatch lines: register.mjs maps each verb to
// `verb("<name>")` and `transition` to `run`. `add` keeps its own module
// (cmd-register-add.mjs, TASK-028).
//
// Every approval-like record is `{recorded_by: ctx.actor, approved_by,
// approval_ref, authenticated: false}` (+ `until` for an acceptance); both
// `--approved-by` and `--approval-ref` are mandatory (exit 2) — there is no
// verb that marks a record authenticated, and no verb that reduces open
// exposure (register-fold.summarize). The record is the event payload
// (spec §6.8: "payload (all changed fields)"), and the row carries it as
// `acceptance` / `false_positive` until the acceptance is revoked, expires
// or is verified fixed, or the false positive is reopened.
//
// The generic `transition` verb refuses the emitter-only events —
// `ticketed` (ingest tracker-readback), `fixed`, `regressed`,
// `regression-observed`, `verify-observed` (consume-verdict) and
// `acceptance-expired` (check) — with `EMITTER-ONLY(<event>)` (exit 2);
// those are appended only by their emitter through register-core.append.
//
// Supersession guards, in order: argv (exit 2) → neither flag ⇒
// `EQUIVALENCE-REQUIRED` (exit 2) → self / missing / cycle / dead target ⇒
// USAGE (exit 2) → `--subject-equivalent` without the same subject or an
// alias link ⇒ `NOT-EQUIVALENT(<R-id>: <R-id>)` (exit 4) → the fold's own
// (event, from) check ⇒ `TRANSITION-REJECTED(supersede: <from>)` (exit 4).
// `--transfer-exposure` is applied by the fold, target first, in the one
// supersede event (register-transitions.applyEvent).
//
// stdout: `ROW <R-id> status=<s> priority=<p> seq=<n>` per changed row
// (supersede prints the source then the target, same seq); `check` ends with
// `CHECK expired=<n>`; `alias` prints `ALIAS from=<id> to=<id> seq=<n>`.
// Exit 0; 2 USAGE / EQUIVALENCE-REQUIRED / EMITTER-ONLY / ENGAGEMENT-MISSING;
// 4 TRANSITION-REJECTED / NOT-EQUIVALENT; 5 CORRUPT (recovery runs on every
// open, over the event chain and the alias chain).

import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { append, appendAlias, openRegister } from "./register-core.mjs";
import { EMITTER_ONLY_EVENTS, TRANSITIONS, TransitionError, expiredAcceptances, isCalendarDay, subjectEquivalent, supersedeTarget, todayOf } from "./register-transitions.mjs";
import { EQUIVALENCE_REQUIRED, aliased, checked, emitterOnly, notEquivalent, row as rowLine, transitionRejected } from "./tokens.mjs";

const ROW_ID = /^R-[0-9]{4}$/;
const FINDING_ID = /^[0-9a-f]{64}$/; // spec §6.1: a finding id is a sha256
const RUN_ID = /^[0-9a-f]{12}-[0-9]{4}$/; // TL-9 (the same shape cmd-register-add checks)

// --- shared pieces -------------------------------------------------------------

/** `<R-id>` positional plus the verb's flags; anything else is USAGE. */
function rowArgv(command, argv, spec) {
  const { flags, positionals } = parseCommandArgv(command, argv, spec);
  if (positionals.length === 0) throw usageError(command, "<R-id> is required");
  if (positionals.length > 1) throw usageError(command, `unexpected argument ${positionals[1]}`);
  const id = positionals[0];
  if (!ROW_ID.test(id)) throw usageError(command, `<R-id> must be R-nnnn, got ${id}`);
  return { flags, id };
}

/** Both approval flags, or nothing happens (US-021 AC-3). */
function approvalRecord(command, ctx, flags) {
  if (flags["approved-by"] === undefined || flags["approval-ref"] === undefined) {
    throw usageError(command, "--approved-by <who> and --approval-ref <ref> are both required (the record is stored as unauthenticated)");
  }
  return { recorded_by: ctx.actor, approved_by: flags["approved-by"], approval_ref: flags["approval-ref"], authenticated: false };
}

/** Append one row event; the fold's refusal is exit 4 TRANSITION-REJECTED. */
async function appendRow(ctx, row_id, event, payload, ref) {
  try {
    return await append(ctx, { row_id, event, payload, ref });
  } catch (err) {
    if (err instanceof TransitionError) throw new CliError(EXIT.FAIL, transitionRejected(err.event, err.from));
    throw err;
  }
}

function printRow(ctx, projection, id, seq) {
  const r = projection.rows[id];
  ctx.out(rowLine({ id: r.id, status: r.status, priority: r.priority, seq }));
}

// --- verbs -----------------------------------------------------------------------

async function accept(command, argv, ctx) {
  const { flags, id } = rowArgv(command, argv, { until: "value", "approved-by": "value", "approval-ref": "value" });
  const record = approvalRecord(command, ctx, flags);
  if (flags.until === undefined) throw usageError(command, "--until <YYYY-MM-DD> is required");
  if (!isCalendarDay(flags.until)) throw usageError(command, `--until must be a calendar day YYYY-MM-DD, got ${flags.until}`);
  const result = await appendRow(ctx, id, "accept", { ...record, until: flags.until }, record.approval_ref);
  printRow(ctx, result.projection, id, result.event.seq);
  return EXIT.OK;
}

async function revoke(command, argv, ctx) {
  const { flags, id } = rowArgv(command, argv, { "approved-by": "value", "approval-ref": "value" });
  const record = approvalRecord(command, ctx, flags);
  const result = await appendRow(ctx, id, "revoke", record, record.approval_ref);
  printRow(ctx, result.projection, id, result.event.seq);
  return EXIT.OK;
}

async function closeFalsePositive(command, argv, ctx) {
  const { flags, id } = rowArgv(command, argv, { "approved-by": "value", "approval-ref": "value" });
  const record = approvalRecord(command, ctx, flags);
  const result = await appendRow(ctx, id, "close-false-positive", record, record.approval_ref);
  printRow(ctx, result.projection, id, result.event.seq);
  return EXIT.OK;
}

async function reopen(command, argv, ctx) {
  const { flags, id } = rowArgv(command, argv, { reason: "value" });
  if (flags.reason === undefined) throw usageError(command, "--reason <r> is required");
  const result = await appendRow(ctx, id, "reopen", { reason: flags.reason }, "");
  printRow(ctx, result.projection, id, result.event.seq);
  return EXIT.OK;
}

async function check(command, argv, ctx) {
  const { positionals } = parseCommandArgv(command, argv, {});
  if (positionals.length > 0) throw usageError(command, `unexpected argument ${positionals[0]}`);
  const { projection } = await openRegister(ctx);
  const today = todayOf(ctx.now());
  const expired = expiredAcceptances(projection.rows, today);
  for (const { id, until } of expired) {
    // ref is the lapsed `until`, not today: the event's own `ts` already says when it expired.
    const result = await appendRow(ctx, id, "acceptance-expired", { until }, until);
    printRow(ctx, result.projection, id, result.event.seq);
  }
  ctx.out(checked(expired.length));
  return EXIT.OK;
}

const TARGET_REFUSALS = {
  self: (id) => `--by must name another row, not ${id} itself`,
  missing: (id, by) => `--by ${by} does not exist`,
  cycle: (id, by) => `--by ${by} is superseded by a chain that leads back to ${id} (cycle)`,
  superseded: (id, by) => `--by ${by} is itself superseded; name its successor`,
};

async function supersede(command, argv, ctx) {
  const { flags, id } = rowArgv(command, argv, { by: "value", "subject-equivalent": "boolean", "transfer-exposure": "boolean" });
  if (flags.by === undefined) throw usageError(command, "--by <R-id> is required");
  if (!ROW_ID.test(flags.by)) throw usageError(command, `--by must be R-nnnn, got ${flags.by}`);
  const equivalent = flags["subject-equivalent"] === true;
  const transfer = flags["transfer-exposure"] === true;
  if (equivalent && transfer) throw usageError(command, "--subject-equivalent and --transfer-exposure are exclusive");
  if (!equivalent && !transfer) throw new CliError(EXIT.USAGE, EQUIVALENCE_REQUIRED);

  const { projection, aliases } = await openRegister(ctx);
  if (projection.rows[id] === undefined) throw new CliError(EXIT.FAIL, transitionRejected("supersede", "-"));
  const guard = supersedeTarget(projection.rows, id, flags.by);
  if (!guard.ok) throw usageError(command, TARGET_REFUSALS[guard.reason](id, flags.by));
  if (equivalent && !subjectEquivalent(projection.rows, aliases, id, flags.by)) throw new CliError(EXIT.FAIL, notEquivalent(id, flags.by));

  const mode = equivalent ? "subject-equivalent" : "transfer-exposure";
  const result = await appendRow(ctx, id, "supersede", { by: flags.by, mode }, flags.by);
  printRow(ctx, result.projection, id, result.event.seq);
  printRow(ctx, result.projection, flags.by, result.event.seq);
  return EXIT.OK;
}

async function alias(command, argv, ctx) {
  const { flags, positionals } = parseCommandArgv(command, argv, { from: "value", to: "value", reason: "value", run: "value" });
  if (positionals.length > 0) throw usageError(command, `unexpected argument ${positionals[0]}`);
  for (const name of ["from", "to", "reason", "run"]) if (flags[name] === undefined) throw usageError(command, `--${name} is required`);
  for (const name of ["from", "to"]) if (!FINDING_ID.test(flags[name])) throw usageError(command, `--${name} must be a finding id (64 hex chars)`);
  if (flags.from === flags.to) throw usageError(command, "--from and --to must differ: a finding id cannot alias itself");
  if (!RUN_ID.test(flags.run)) throw usageError(command, "--run must be a run id (<12 hex>-<4 digits>)");
  const result = await appendAlias(ctx, { from_id: flags.from, to_id: flags.to, reason: flags.reason, run_id: flags.run });
  ctx.out(aliased({ from_id: result.alias.from_id, to_id: result.alias.to_id, seq: result.alias.seq }));
  return EXIT.OK;
}

const VERBS = Object.freeze({ accept, revoke, check, "close-false-positive": closeFalsePositive, reopen, supersede, alias });

/** Row transitions the generic form accepts: a verb with an <R-id>. */
const ROW_TRANSITIONS = Object.freeze(["accept", "revoke", "close-false-positive", "reopen", "supersede"]);

/**
 * The `{run}` module register.mjs dispatches a verb to.
 * @param {keyof typeof VERBS} name
 * @returns {{run: (argv: string[], ctx: object) => Promise<number>}}
 */
export function verb(name) {
  if (!Object.hasOwn(VERBS, name)) throw new TypeError(`cmd-register-transition: no verb ${String(name)}`);
  return { run: (argv, ctx) => VERBS[name](name, argv, ctx) };
}

/**
 * `transition <event> <R-id> [flags]` — the generic form.
 * @param {string[]} argv after `transition`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const command = "transition";
  const event = argv[0];
  if (event === undefined || event.startsWith("--")) throw usageError(command, `<event> is required (one of ${ROW_TRANSITIONS.join("|")})`);
  if (EMITTER_ONLY_EVENTS.includes(event)) throw new CliError(EXIT.USAGE, emitterOnly(event));
  if (!Object.hasOwn(TRANSITIONS, event)) throw usageError(command, `unknown event ${JSON.stringify(event)}`);
  if (!ROW_TRANSITIONS.includes(event)) throw usageError(command, `${event} is not a row transition; run \`register.mjs ${event}\``);
  return VERBS[event](command, argv.slice(1), ctx);
}
