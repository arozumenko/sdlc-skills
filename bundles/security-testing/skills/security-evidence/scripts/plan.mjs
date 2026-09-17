#!/usr/bin/env node
// plan.mjs — entry point for security test planning (plan §4.5, M3).
// `admit` and `propose` landed with TASK-042 (lib/cmd-plan-admit.mjs,
// lib/cmd-plan-propose.mjs); `ta-prompt` with TASK-044 (lib/cmd-plan.mjs).
import { main } from "./lib/cli.mjs";

const USAGE = `usage: plan.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  admit --run <id> <case.md> [--receipt <sha256>] [--dry-run]
                                                       passive admission by effect → <run>/admissions/<case_sha256>.json (--dry-run: the ADMISSION line only, nothing persisted)
  propose --run <id> <proposal.md>                     validate proposal frontmatter, write <st>/proposals/<id>.proposal.md (never under tasks/)
  ta-prompt --run <id> --slug <s> --base <branch>      print the test-automation hand-off prompt from the published admitted suite (publish --profile case first)

exit codes  0 ok · 2 usage / RUN-COMMITTED / SCHEMA-INVALID / PROPOSAL-UNDER-TASKS / ADMISSION-EXISTS
            3 INCOMPLETE(<name>) · 4 RECEIPT-MISMATCH(<reason>) · 5 INCONSISTENT(<name>)
`;

const COMMANDS = {
  admit: () => import("./lib/cmd-plan-admit.mjs").then((m) => m.admit),
  propose: () => import("./lib/cmd-plan-propose.mjs").then((m) => m.propose),
  "ta-prompt": () => import("./lib/cmd-plan.mjs").then((m) => m.taPrompt),
};

process.exitCode = await main({ name: "plan", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
