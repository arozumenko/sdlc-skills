// lib/register-usage.mjs — register.mjs's usage text (TASK-028). It lives in
// lib/ rather than in the entry script because its exit-code line is built
// from tokens.mjs rows (G-13: a spelling lives in one place), and a template
// with interpolations cannot be checked by the byte-for-byte `--help` guard
// in cli.test.mjs through a source regex — the guard imports this module
// instead, which is possible only because nothing here runs a dispatcher.
//
// No redaction rule may fire on this text (register-usage.test.mjs): reword
// an example rather than exempt it.

import { ANCHOR_DIVERGED, ANCHOR_MATCH, ANCHOR_TRUNCATED, CORRUPT, EQUIVALENCE_REQUIRED, transitionRejected } from "./tokens.mjs";

export const USAGE = `usage: register.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [flags]

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
  replay [--write]                          rebuild the projection from the log; --write persists it
  anchor print                              <engagement_id>:<seq>:<chain_sha256>
  anchor verify --expect <engagement_id:seq:hash>   ${ANCHOR_MATCH} | ${ANCHOR_TRUNCATED} | ${ANCHOR_DIVERGED}

exit codes  0 ok · 2 usage / ${EQUIVALENCE_REQUIRED} (supersede with neither flag) · 4 ${transitionRejected("<event>", "<from>")} / --subject-equivalent without a same-subject or alias link · 5 ${CORRUPT} / ${ANCHOR_TRUNCATED} / ${ANCHOR_DIVERGED}
recovery    every command rebuilds a missing or behind projection from the log; a projection ahead of the log or a broken chain is ${CORRUPT}
env         SECURITY_EVIDENCE_NOW · SECURITY_EVIDENCE_ACTOR
`;
