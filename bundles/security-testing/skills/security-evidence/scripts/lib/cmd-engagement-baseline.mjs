// lib/cmd-engagement-baseline.mjs — `evidence.mjs engagement baseline`
// (TASK-010; plan §4.1 row `engagement baseline`): rewrite
// `private/baseline.<engagement_id>.json` from the working tree as it is now.
//
// `engagement` is one command with three subcommands; TASK-008's
// lib/cmd-engagement.mjs owns the routing and calls this module's run() for
// `baseline` (009/010/011 ship modules, not pipeline steps — G-15). The
// argv it receives is everything after `baseline`: nothing is accepted.
//
// stdout: `BASELINE: <n> files ignored=<n>` then `WROTE <path> sha256=<h>`
// (§3.1: a command that writes an enveloped artifact ends with WROTE).
// Exit 0; 2 ENGAGEMENT-MISSING (no engagement.md — nothing written);
// 2 ENGAGEMENT-INVALID(…); 2 USAGE(baseline: …) (stray argv, or no key yet —
// run `engagement init` first, which creates the key before the baseline).

import { parseCommandArgv } from "./argv.mjs";
import { stepBaseline } from "./baseline.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { baselineLine } from "./tokens.mjs";

const COMMAND = "baseline";

/**
 * @param {string[]} argv after `engagement baseline`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { positionals } = parseCommandArgv(COMMAND, argv, {});
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const { artifact, path, files, ignored } = stepBaseline(ctx);
  ctx.out(baselineLine({ files, ignored }));
  ctx.wrote(path, artifact);
  return EXIT.OK;
}
