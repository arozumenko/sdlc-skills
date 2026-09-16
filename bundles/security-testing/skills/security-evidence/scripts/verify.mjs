#!/usr/bin/env node
// verify.mjs — entry point for fix verification (plan §4.2). A thin
// dispatcher (TL-1): commands live in lib/cmd-<name>.mjs.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: verify.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  all --finding <id> --base <oid> --head <oid> [--receipts <dir>] [--timeout-s <n>]
        allocate a verify-kind run, execute steps 1-6a, evaluate, write <run>/verify.json,
        build the verify report; last line: VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>
  evaluate <verify.json> | --raw <json>
        pure verdict function over recorded results; prints {verdict, refound_observed, ack_refs, events}

exit codes  0 whenever a verdict is emitted · 2 UNKNOWN-FINDING / malformed · 4 UNVERIFIED-REFUTED-FINDING (refusal) · 5 integrity mismatch
env         SECURITY_EVIDENCE_NOW · SECURITY_EVIDENCE_ACTOR
`;

const COMMANDS = {
  // all: () => import("./lib/cmd-verify-all.mjs"),        // TASK-027
  // evaluate: () => import("./lib/cmd-evaluate.mjs"),     // TASK-026
};

process.exitCode = await main({ name: "verify", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
