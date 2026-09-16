// lib/cmd-register-replay.mjs — `register.mjs replay [--write]` (TASK-028;
// plan §4.3): rebuild the projection from the log.
//
// Opening the register already applies the recovery rule (a missing or
// behind projection is rewritten; ahead or broken ⇒ CORRUPT), so `replay`
// without `--write` is a verified dry run that reports what the log folds
// to; `--write` persists the rebuilt projection unconditionally (same bytes
// when the register was healthy — AC-5 byte-identical projections).
//
// stdout: `REPLAY seq=<n> rows=<n> chain=<sha256>`, then with --write
// `PROJECTION <repo-relative path>`. Exit 0; 2 usage; 5 CORRUPT.

import { parseCommandArgv } from "./argv.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { openRegister, rebuildProjection, registerPaths } from "./register-core.mjs";
import { projection as projectionToken, replayed } from "./tokens.mjs";

const COMMAND = "replay";

/**
 * @param {string[]} argv after `replay`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { write: "boolean" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const write = flags.write === true;
  const { projection } = write ? await rebuildProjection(ctx) : await openRegister(ctx);
  ctx.out(replayed({ seq: projection.seq, rows: Object.keys(projection.rows).length, chain_sha256: projection.chain_sha256 }));
  if (write) ctx.out(projectionToken(ctx.rel(registerPaths(ctx).projection)));
  return EXIT.OK;
}
