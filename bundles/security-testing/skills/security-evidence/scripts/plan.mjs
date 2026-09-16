#!/usr/bin/env node
// plan.mjs — entry point for security test planning (plan §4.5, M3). M1
// ships the CLI shape and schema validation; every command ends in
// NOT-IMPLEMENTED(M3) until TASK-042.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: plan.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  admit --run <id> <case.md> [--receipt <sha256>]      passive admission by effect → <run>/admissions/<case_sha256>.json
  propose --run <id> <proposal.md>                     validate proposal frontmatter, write <st>/proposals/<id>.proposal.md (never under tasks/)
  ta-prompt --run <id> --slug <s> --base <branch>      print the test-automation hand-off prompt from admitted cases only

exit codes  0 ok · 2 usage / SCHEMA-INVALID / PROPOSAL-UNDER-TASKS / NOT-IMPLEMENTED(M3)
`;

const COMMANDS = {
  admit: () => import("./lib/cmd-plan.mjs").then((m) => m.admit),
  propose: () => import("./lib/cmd-plan.mjs").then((m) => m.propose),
  "ta-prompt": () => import("./lib/cmd-plan.mjs").then((m) => m.taPrompt),
};

process.exitCode = await main({ name: "plan", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
