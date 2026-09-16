#!/usr/bin/env node
// register.mjs — entry point for the residual-risk register (plan §4.3). A
// thin dispatcher (TL-1): commands live in lib/cmd-<name>.mjs. There is no
// approval verb that marks anything authenticated (D15, G-8): every
// approval-like record is stored and reported as unauthenticated.
import { main } from "./lib/cli.mjs";

const USAGE = `usage: register.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

commands
  add --subject <finding_id|threat_id> --priority p0|p1|p2|p3 --title <t> --run <run_id> [--owner <o>]
  accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>
  revoke <R-id> --approved-by <who> --approval-ref <ref>
  check                                     expire acceptances past --until
  close-false-positive <R-id> --approved-by <who> --approval-ref <ref>
  reopen <R-id> --reason <r>
  supersede <R-id> --by <R-id> (--subject-equivalent | --transfer-exposure)
  alias --from <finding_id> --to <finding_id> --reason <r> --run <run_id>
  consume-verdict <verify.json>
  render [--out <path>]                     write the Markdown view (default <st>/risk-register.md)
  transition <event> <R-id> [flags]         generic form of the verbs above (ticketed is not accepted here)
  status [--json]
  replay [--write]
  anchor print | anchor verify --expect <engagement_id:seq:hash>

exit codes  0 ok · 2 usage · 4 TRANSITION-REJECTED(<event>: <from>) / EQUIVALENCE-REQUIRED · 5 CORRUPT
env         SECURITY_EVIDENCE_NOW · SECURITY_EVIDENCE_ACTOR
`;

const COMMANDS = {
  // add / accept / revoke / check / close-false-positive / reopen / supersede / alias / transition / status / replay / anchor
  //   → () => import("./lib/cmd-register.mjs")            // TASK-028 / TASK-029
  // "consume-verdict": () => import("./lib/cmd-consume-verdict.mjs"), // TASK-030
  // render: () => import("./lib/cmd-register-render.mjs"), // TASK-059
};

process.exitCode = await main({ name: "register", usage: USAGE, commands: COMMANDS }, process.argv.slice(2));
