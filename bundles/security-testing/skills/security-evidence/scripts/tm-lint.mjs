#!/usr/bin/env node
// tm-lint.mjs — entry point for threat-model linting (plan §4.4; TASK-006
// shape, TASK-039 bodies). Thin dispatcher: lib/cmd-tm-lint.mjs does the work.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: tm-lint.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  check --run <id> [--model <path>]      validate the threat model (default <st>/threat-model.json): schema, one citation per element,
                                         every disposition relationship; writes <run>/threat-model.json (write-once) and <run>/dispositions.json
  render --run <id>                      write <run>/threat-model.md from the run's snapshot and dispositions

exit codes  0 ok · 2 usage / RUN-COMMITTED / SNAPSHOT-EXISTS / RENDER-EXISTS · 3 INCOMPLETE(<input>) · 4 TM-INVALID(<threat|element>: <reason>) · 5 INCONSISTENT(<input>)
`;

const COMMANDS = {
  check: () => import("./lib/cmd-tm-lint.mjs").then((m) => m.check),
  render: () => import("./lib/cmd-tm-lint.mjs").then((m) => m.render),
};

process.exitCode = await main({ name: "tm-lint", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
