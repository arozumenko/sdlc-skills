// lib/cmd-register-add.mjs — `register.mjs add --subject <finding_id|threat_id>
// --priority p0|p1|p2|p3 --title <t> --run <run_id> [--owner <o>]` (TASK-028;
// plan §4.3 row `add`): a new row `R-nnnn`, status `open`.
//
// The row id is allocated under the register lock from the projection the
// event is chained to (register-fold.nextRowId: rows + 1, zero-padded), so
// two concurrent adds get distinct ids and the id is reproducible from the
// log. The payload is exactly the fields `add` sets (ADD_PAYLOAD_KEYS); every
// other Row field starts empty and `status` is the transition's doing, not
// the payload's. `ref` is the run the finding or threat was first seen in.
//
// stdout: `ROW <R-id> status=open priority=<p> seq=<n>`. Exit 0; 2 USAGE(add: …);
// 2 ENGAGEMENT-MISSING; 5 CORRUPT.
//
// TASK-029 ships the generic `transition` verb and the other aliases in
// lib/cmd-register-transition.mjs; `add` stays its own module.

import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { PRIORITIES, TransitionError, nextRowId } from "./register-fold.mjs";
import { append } from "./register-core.mjs";
import { row, transitionRejected } from "./tokens.mjs";

const COMMAND = "add";
const FINDING_ID = /^[0-9a-f]{64}$/;
const THREAT_ID = /^T-[0-9]{3}$/;
const RUN_ID = /^[0-9a-f]{12}-[0-9]{4}$/; // TL-9: head_oid[0:12] + "-" + seq zero-padded to 4

/** finding ids are sha256 hex (spec §6.1); threat ids are `T-nnn` (threat-model.schema.json). */
export function subjectKindOf(subject) {
  if (FINDING_ID.test(subject)) return "finding";
  if (THREAT_ID.test(subject)) return "threat";
  return null;
}

/**
 * @param {string[]} argv after `add`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { subject: "value", priority: "value", title: "value", run: "value", owner: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  for (const name of ["subject", "priority", "title", "run"]) {
    if (flags[name] === undefined) throw usageError(COMMAND, `--${name} is required`);
  }
  const subject_kind = subjectKindOf(flags.subject);
  if (subject_kind === null) throw usageError(COMMAND, "--subject must be a finding id (64 hex chars) or a threat id (T-nnn)");
  if (!PRIORITIES.includes(flags.priority)) throw usageError(COMMAND, `--priority must be one of ${PRIORITIES.join("|")}`);
  if (!RUN_ID.test(flags.run)) throw usageError(COMMAND, "--run must be a run id (<12 hex>-<4 digits>)");

  const payload = { subject: flags.subject, subject_kind, title: flags.title, priority: flags.priority, owner: flags.owner ?? "", first_seen_run: flags.run };
  let result;
  try {
    result = await append(ctx, { row_id: nextRowId, event: COMMAND, payload, ref: flags.run });
  } catch (err) {
    if (err instanceof TransitionError) throw new CliError(EXIT.FAIL, transitionRejected(err.event, err.from));
    throw err;
  }
  const written = result.projection.rows[result.event.row_id];
  ctx.out(row({ id: written.id, status: written.status, priority: written.priority, seq: result.event.seq }));
  return EXIT.OK;
}
