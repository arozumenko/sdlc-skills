// lib/cmd-plan.mjs — `plan.mjs ta-prompt` (M1 shape, TASK-006; the body is
// TASK-044's).
//
// `admit` and `propose` left this file with TASK-042: they live in
// lib/cmd-plan-admit.mjs and lib/cmd-plan-propose.mjs (plan.mjs dispatches
// to each directly). What remains is the last M1 stub of the planning
// entry point: `ta-prompt` validates its argv and returns
// `2 NOT-IMPLEMENTED(M3)` until TASK-044 prints the §9.3 prompt from the
// admitted cases (plan §4.5). The argv contract and the token stay.
//
//   ta-prompt --run <id> --slug <s> --base <branch>
//
// Exports `taPrompt = {run(argv, ctx)}`.

import { parseCommandArgv } from "./argv.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { notImplemented } from "./tokens.mjs";

export const taPrompt = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("ta-prompt", argv, { run: "value", slug: "value", base: "value" });
    if (positionals.length) throw usageError("ta-prompt", `unexpected argument ${positionals[0]}`);
    if (typeof flags.run !== "string") throw usageError("ta-prompt", "--run <id> is required");
    if (typeof flags.slug !== "string") throw usageError("ta-prompt", "--slug <s> is required");
    if (typeof flags.base !== "string") throw usageError("ta-prompt", "--base <branch> is required");
    ctx.out(notImplemented("M3"));
    return EXIT.USAGE;
  },
};
