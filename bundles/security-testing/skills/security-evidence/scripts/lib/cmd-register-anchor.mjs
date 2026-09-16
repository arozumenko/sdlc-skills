// lib/cmd-register-anchor.mjs — `register.mjs anchor print` and
// `register.mjs anchor verify --expect <engagement_id:seq:hash>` (TASK-028;
// spec §6.8).
//
//   print   → `<engagement_id>:<seq>:<chain_sha256>`, bare — paste it into a
//             ticket, a report or `sign-off --expect`.
//   verify  → MATCH (exit 0) | TRUNCATED | DIVERGED (exit 5: the register is
//             not the state that was anchored). Semantics are register-fold's:
//             MATCH is the exact state; TRUNCATED a shorter log; DIVERGED a
//             rewritten history, another engagement, or a log that advanced
//             past the anchor — print a fresh anchor after the last change.
// The recovery rule runs first (CORRUPT beats any comparison).

import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { anchor, anchorVerify, parseAnchor } from "./register-fold.mjs";
import { openRegister } from "./register-core.mjs";
import { ANCHOR_MATCH } from "./tokens.mjs";

const COMMAND = "anchor";
const SUBCOMMANDS = "print | verify --expect <engagement_id:seq:hash>";

/**
 * @param {string[]} argv after `anchor`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { expect: "value" });
  const sub = positionals[0];
  if (sub !== "print" && sub !== "verify") throw usageError(COMMAND, `subcommand is ${SUBCOMMANDS}`);
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);

  if (sub === "print") {
    if (flags.expect !== undefined) throw usageError(COMMAND, "--expect belongs to anchor verify");
    const { projection } = await openRegister(ctx);
    ctx.out(anchor(projection));
    return EXIT.OK;
  }

  if (flags.expect === undefined) throw usageError(COMMAND, "verify needs --expect <engagement_id:seq:hash>");
  if (parseAnchor(flags.expect) === null) throw usageError(COMMAND, "--expect must be <engagement_id>:<seq>:<chain_sha256>");
  const { projection } = await openRegister(ctx);
  const result = anchorVerify(projection, flags.expect);
  if (result === ANCHOR_MATCH) {
    ctx.out(result);
    return EXIT.OK;
  }
  throw new CliError(EXIT.INTEGRITY, result);
}
