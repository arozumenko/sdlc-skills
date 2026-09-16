#!/usr/bin/env node
// tm-lint.mjs — entry point for threat-model linting (plan §4.4, M2). M1
// ships the CLI shape and schema validation; both commands end in
// NOT-IMPLEMENTED(M2) until TASK-039.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: tm-lint.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  check --run <id> [--model <path>]      validate the threat model (default <st>/threat-model.json): schema, one citation per element,
                                         every disposition relationship; writes <run>/threat-model.json and <run>/dispositions.json
  render --run <id>                      write <run>/threat-model.md

exit codes  0 ok · 2 usage / SCHEMA-INVALID / NOT-IMPLEMENTED(M2) · 4 TM-INVALID(<threat|element>: <reason>)
`;

const COMMANDS = {
  check: () => import("./lib/cmd-tm-lint.mjs").then((m) => m.check),
  render: () => import("./lib/cmd-tm-lint.mjs").then((m) => m.render),
};

process.exitCode = await main({ name: "tm-lint", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
