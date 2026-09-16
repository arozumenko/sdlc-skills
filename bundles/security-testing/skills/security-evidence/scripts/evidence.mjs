#!/usr/bin/env node
// evidence.mjs — entry point for the run/scope/gate/report/check/publish
// commands (plan §4.1). A thin dispatcher (TL-1): every command lives in
// lib/cmd-<name>.mjs and is registered by one line in COMMANDS below.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: evidence.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [<subcommand>] [flags]

commands
  engagement init [--rotate]                       knowledge templates, engagement.md, managed .gitignore block, key, baseline
  engagement validate                              IGNORE-BLOCK / TRACKED / KEY / BASELINE status
  engagement baseline                              rewrite private/baseline.<engagement_id>.json
  run init --kind assessment|review|verify|threat-model --base <ref> [--head <ref>]
  run snapshot register|verify|proposals --run <id> [--from <verify_run_id>]...
  scope --run <id> [--include <path-or-glob>]... [--max-bytes <n>]
  packet --run <id> --kind scope | --kind subject --subject <id>... [--type <t>] [--policy <file>]
  ingest <kind> <file> --run <id> [--sent <ticket.json>]
  gate --run <id> [--claims <payload.json>]...
  coverage --run <id> --examined <payload.json> [--scanner-rows <file>]
  receipt validate --run <id> <file> | receipt apply --run <id> [--json]
  build-report --run <id> --template review|assessment|verify|threat-model
  check <run dir | manifest.json> [--integrity] [--drift] [--trusted-digest <sha256>]
  check-export <export-manifest.json> [--source <run dir>]
  publish --run <id> --profile <p> --to <destination> [--slug <s>] [--base-url <u>]
  sign-off --engagement <id> [--expect <anchor>]
  purge --engagement <id> [--yes]

exit codes  0 ok · 1 internal · 2 usage / EDIT-AND-RERUN · 3 INDETERMINATE · 4 verification failure · 5 integrity mismatch
env         SECURITY_EVIDENCE_NOW (fixed created_at) · SECURITY_EVIDENCE_ACTOR (default actor)
`;

// One line per command; the module is loaded only when its command runs.
const COMMANDS = {
  // engagement: () => import("./lib/cmd-engagement.mjs"),   // TASK-008
  run: () => import("./lib/cmd-run.mjs"), // TASK-012 (init) / TASK-058 (snapshot)
  // scope: () => import("./lib/cmd-scope.mjs"),             // TASK-013
  ingest: () => import("./lib/cmd-ingest.mjs"), // TASK-015 (dispatcher + doc) / TASK-016/017/018 (adapters)
  // gate: () => import("./lib/cmd-gate.mjs"),               // TASK-019
  // coverage: () => import("./lib/cmd-coverage.mjs"),       // TASK-020
  // packet: () => import("./lib/cmd-packet.mjs"),           // TASK-057 / TASK-021
  // receipt: () => import("./lib/cmd-receipt.mjs"),         // TASK-022
  // "build-report": () => import("./lib/cmd-build-report.mjs"), // TASK-023
  // check: () => import("./lib/cmd-check.mjs"),             // TASK-025
  // publish: () => import("./lib/cmd-publish.mjs"),         // TASK-031
  // "check-export": () => import("./lib/cmd-check-export.mjs"), // TASK-031
  // purge: () => import("./lib/cmd-purge.mjs"),             // TASK-032
  // "sign-off": () => import("./lib/cmd-sign-off.mjs"),     // TASK-033
};

process.exitCode = await main({ name: "evidence", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
