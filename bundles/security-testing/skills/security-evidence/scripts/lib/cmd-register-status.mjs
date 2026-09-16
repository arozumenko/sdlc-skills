// lib/cmd-register-status.mjs — `register.mjs status [--json]` (TASK-028;
// plan §4.3): counts by status × priority, open exposure (open + regressed),
// and the one unauthenticated-approvals bucket. Nothing is ever subtracted
// from open exposure (D15, G-8) — that arithmetic is register-fold.summarize.
//
// stdout, text form (every cell printed, zeros included, so the shape is fixed):
//   STATUS rows=<n> seq=<n>
//   OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>
//   APPROVALS unauthenticated=<n>
//   COUNT <status> p0=<n> p1=<n> p2=<n> p3=<n>      one per status, REGISTER_STATUSES order
// --json: one line, {counts, open_exposure, unauthenticated_approvals, rows}.
// Exit 0; 2 usage; 5 CORRUPT (the recovery rule runs on open, like every command).

import { parseCommandArgv } from "./argv.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { STATUSES, summarize } from "./register-fold.mjs";
import { openRegister } from "./register-core.mjs";
import { approvals, count, openExposure, statusLine } from "./tokens.mjs";

const COMMAND = "status";

/**
 * @param {string[]} argv after `status`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { json: "boolean" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const { projection } = await openRegister(ctx);
  const summary = summarize(projection);
  if (flags.json === true) {
    ctx.out(JSON.stringify(summary));
    return EXIT.OK;
  }
  ctx.out(statusLine({ rows: Object.keys(projection.rows).length, seq: projection.seq }));
  ctx.out(openExposure(summary.open_exposure));
  ctx.out(approvals(summary.unauthenticated_approvals));
  for (const status of STATUSES) ctx.out(count(status, summary.counts[status]));
  return EXIT.OK;
}
