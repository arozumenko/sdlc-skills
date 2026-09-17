// lib/cmd-plan-propose.mjs — `plan.mjs propose --run <id> <proposal.md>`
// (TASK-042; plan §4.5, §5 TASK-042; spec §9.4, D7 "active work is a
// proposal outside tasks/", D15 / G-8 "authorization is a proposed,
// unauthenticated record"; US-038 AC-1, AC-2).
//
// A proposal is the planner's request for ACTIVE work — anything the passive
// admission grammar does not admit (references/passive-admission.md of the
// security-test-planning skill). It never enters the hand-off suite: the
// scripts write it under `<st>/proposals/`, the assessment sees it through
// `run snapshot proposals` (P2, TL-3), a human decides outside this bundle
// whether it is ever executed, and the record of that decision stays
// `authenticated: false` (D15).
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run <id>` (RUN_ID shape) and exactly one `<proposal.md>`
//      (2 USAGE); the run must exist (`<run>/run.json`; unknown ⇒ 2 USAGE) —
//      the proposal is filed against it and the NEXT line names it;
//   2. the file: a user-typed path — ctx.input keeps it inside the work tree
//      (2 USAGE(propose: cannot read <p> (outside the work tree))), unreadable
//      ⇒ 2 USAGE(propose: cannot read <p>);
//   3. the D7 rule: a source under `tasks/` (any spelling of case — fail-closed
//      on every platform, TASK-059 review 2) ⇒ 2 PROPOSAL-UNDER-TASKS: the
//      hand-off suite holds admitted cases only, and a proposal placed there
//      by hand is exactly what sign-off's UNADMITTED list (TASK-043) exists to
//      catch;
//   4. the machine record: exactly one fenced ```json proposal block (TL-5:
//      the shape engagement.md uses), strict JSON, validated against
//      proposal.schema.json — `authorization.status` is `proposed`,
//      `authenticated` is `false` by schema, so a file claiming otherwise is
//      off-schema ⇒ 2 SCHEMA-INVALID(proposal: <first error>) (the M1 stub's
//      spelling, kept: an off-schema user input is exit 2, never 5 — the
//      check/exit-5 rule in lib/exit.mjs);
//   5. the copy: the WHOLE text, redacted (redactString — G-4: every byte
//      that leaves memory passes redact.mjs; the prose around the block may
//      quote a credential), written to `<st>/proposals/<id>.proposal.md`
//      where `<id>` is the block's `id` (P-nnn) — the name `run snapshot
//      proposals` indexes. An existing file with the same bytes is the same
//      proposal (exit 0, same lines, nothing rewritten); one with different
//      bytes ⇒ 2 USAGE(propose: <path> already exists with different content;
//      bump the id or remove it) — the publish precedent (TASK-031), not a
//      silent overwrite. A source that already IS the destination and
//      carries nothing to redact is therefore idempotent too.
//
// stdout: `PROPOSAL <repo-relative path> id=<P-nnn> sha256=<h>` — `sha256`
// over the redacted text, the identity the proposals index records — then
// `NEXT: run snapshot proposals --run <run_id>`. Exit 0; 2 USAGE /
// PROPOSAL-UNDER-TASKS / SCHEMA-INVALID(proposal: …); 5 when run.json is not
// the artifact it claims to be (readArtifact).
//
// Imports: node:fs (existsSync, readFileSync — the one write is
// fsx.writeAtomic), node:path, ../canon.mjs (parseStrict, readArtifact,
// sha256Hex), ../redact.mjs, ./argv.mjs, ./exit.mjs, ./fsx.mjs,
// ./ledger.mjs (RUN_ID), ./run-index.mjs (runDir), ./schema.mjs,
// ./tokens.mjs. No git, no child process (G-6), no network (G-14), no clock
// (G-1). Exports `propose = {run(argv, ctx)}` and `validateProposalFile`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { RUN_ID } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { PROPOSAL_UNDER_TASKS, nextSnapshotProposals, proposalLine, schemaInvalid } from "./tokens.mjs";

const COMMAND = "propose";
const SCHEMA = "proposal";
export const PROPOSAL_SUFFIX = ".proposal.md";
const PROPOSAL_FENCE = /^```json proposal[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
/** `tasks/` at the repo root, any case (a case-insensitive file system would otherwise let `Tasks/` through). */
const UNDER_TASKS = /^tasks(?:\/|$)/i;

function readText(ctx, path) {
  const abs = ctx.input(COMMAND, path);
  try {
    return { abs, text: readFileSync(abs, "utf8") };
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(COMMAND, `cannot read ${path}`);
    throw err;
  }
}

/**
 * The ```json proposal block of a proposal text, validated. Returns the
 * parsed record, or the `SCHEMA-INVALID(proposal: …)` refusal as a CliError.
 * @param {string} text
 * @returns {object}
 * @throws {CliError} 2
 */
export function parseProposal(text) {
  const blocks = [...text.matchAll(PROPOSAL_FENCE)].map((m) => m[1]);
  if (blocks.length !== 1) throw new CliError(EXIT.USAGE, schemaInvalid(SCHEMA, blocks.length === 0 ? "no ```json proposal block" : `${blocks.length} json proposal blocks; exactly one is allowed`));
  let value;
  try {
    value = parseStrict(blocks[0]);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(SCHEMA, err.message), { cause: err });
    throw err;
  }
  const errors = validate(SCHEMA, value);
  if (errors.length > 0) throw new CliError(EXIT.USAGE, schemaInvalid(SCHEMA, errors[0]));
  return value;
}

/**
 * Validate a proposal file (the M1 shape, kept for callers that only want
 * the check): prints `SCHEMA-INVALID(proposal: …)` and returns 2 on
 * failure, null when valid.
 * @param {object} ctx
 * @param {string} path
 * @returns {number | null}
 */
export function validateProposalFile(ctx, path) {
  try {
    parseProposal(readText(ctx, path).text);
    return null;
  } catch (err) {
    if (err instanceof CliError && err.code === EXIT.USAGE && err.token.startsWith("SCHEMA-INVALID(")) {
      ctx.out(err.token);
      return EXIT.USAGE;
    }
    throw err;
  }
}

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value" });
  if (typeof flags.run !== "string") throw usageError(COMMAND, "--run <id> is required");
  if (!RUN_ID.test(flags.run)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${flags.run}`);
  if (positionals.length === 0) throw usageError(COMMAND, "<proposal.md> is required");
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);
  return { run_id: flags.run, path: positionals[0] };
}

/** `<run>/run.json` must exist and verify (5 on a tampered one); the run is where the proposal is filed. */
function requireRun(ctx, run_id) {
  const runPath = join(runDir(ctx, run_id), "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  readArtifact(runPath, { kind: "run" });
}

export const propose = {
  /**
   * @param {string[]} argv after `propose`
   * @param {object} ctx
   * @returns {Promise<number>}
   */
  async run(argv, ctx) {
    const { run_id, path } = parseArgs(argv);
    requireRun(ctx, run_id);
    const { abs, text } = readText(ctx, path);
    if (UNDER_TASKS.test(ctx.rel(abs))) throw new CliError(EXIT.USAGE, PROPOSAL_UNDER_TASKS);
    const record = parseProposal(text);
    const redacted = redactString(text, DEFAULT_RULES).text;
    const bytes = Buffer.from(redacted, "utf8");
    const dest = join(ctx.st, "proposals", `${record.id}${PROPOSAL_SUFFIX}`);
    if (existsSync(dest)) {
      if (!readFileSync(dest).equals(bytes)) throw usageError(COMMAND, `${ctx.rel(dest)} already exists with different content; bump the id or remove it`);
      ctx.log(`${COMMAND}: ${ctx.rel(dest)} already present with this content; nothing rewritten`);
    } else {
      writeAtomic(dest, bytes);
    }
    ctx.out(proposalLine({ relPath: ctx.rel(dest), id: record.id, sha256: sha256Hex(bytes) }));
    ctx.out(nextSnapshotProposals(run_id));
    return EXIT.OK;
  },
};
