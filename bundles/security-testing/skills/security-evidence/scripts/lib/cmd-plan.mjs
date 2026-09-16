// lib/cmd-plan.mjs — `plan.mjs admit | propose | ta-prompt` (M1 shape, TASK-006).
//
// M1 ships the CLI shape and schema validation only (plan §4.5): each
// subcommand validates its argv, `propose` validates the proposal's
// frontmatter against proposal.schema.json, and all three return
// `2 NOT-IMPLEMENTED(M3)`. TASK-042 replaces the bodies; the argv contract
// and the tokens stay.
//
//   admit     --run <id> <case.md> [--receipt <sha256>]
//   propose   --run <id> <proposal.md>
//   ta-prompt --run <id> --slug <s> --base <branch>
//
// Proposal frontmatter is carried the way engagement.md carries its record
// (TL-5): one fenced ```json proposal block inside the Markdown, read with
// parseStrict. Stdlib-only leaves no YAML parser; the fence keeps the
// machine record strict and the prose free.
//
// Exports one `{run(argv, ctx)}` per subcommand.

import { readFileSync } from "node:fs";
import { parseStrict } from "../canon.mjs";
import { parseCommandArgv } from "./cli.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { validate } from "./schema.mjs";
import { notImplemented, schemaInvalid } from "./tokens.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const PROPOSAL_FENCE = /^```json proposal[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

function readText(command, ctx, path) {
  try {
    return readFileSync(ctx.abs(path), "utf8");
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES") throw usageError(command, `cannot read ${path}`);
    throw err;
  }
}

function requireRun(command, flags) {
  if (typeof flags.run !== "string") throw usageError(command, "--run <id> is required");
  return flags.run;
}

function onePositional(command, positionals, what) {
  if (positionals.length === 0) throw usageError(command, `${what} is required`);
  if (positionals.length > 1) throw usageError(command, `unexpected argument ${positionals[1]}`);
  return positionals[0];
}

/**
 * Validate the ```json proposal block of a proposal file. Prints
 * `SCHEMA-INVALID(proposal: …)` and returns 2 on failure, null when valid.
 * @param {object} ctx
 * @param {string} path
 * @returns {number | null}
 */
export function validateProposalFile(ctx, path) {
  const text = readText("propose", ctx, path);
  const blocks = [...text.matchAll(PROPOSAL_FENCE)].map((m) => m[1]);
  if (blocks.length !== 1) {
    ctx.out(schemaInvalid("proposal", blocks.length === 0 ? "no ```json proposal block" : `${blocks.length} json proposal blocks; exactly one is allowed`));
    return EXIT.USAGE;
  }
  let value;
  try {
    value = parseStrict(blocks[0]);
  } catch (err) {
    ctx.out(schemaInvalid("proposal", err.message));
    return EXIT.USAGE;
  }
  const errors = validate("proposal", value);
  if (errors.length) {
    ctx.out(schemaInvalid("proposal", errors[0]));
    return EXIT.USAGE;
  }
  return null;
}

export const admit = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("admit", argv, { run: "value", receipt: "value" });
    requireRun("admit", flags);
    const casePath = onePositional("admit", positionals, "<case.md>");
    if (flags.receipt !== undefined && !SHA256.test(flags.receipt)) throw usageError("admit", "--receipt must be a sha256");
    readText("admit", ctx, casePath);
    ctx.out(notImplemented("M3"));
    return EXIT.USAGE;
  },
};

export const propose = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("propose", argv, { run: "value" });
    requireRun("propose", flags);
    const proposalPath = onePositional("propose", positionals, "<proposal.md>");
    const code = validateProposalFile(ctx, proposalPath);
    if (code !== null) return code;
    ctx.out(notImplemented("M3"));
    return EXIT.USAGE;
  },
};

export const taPrompt = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("ta-prompt", argv, { run: "value", slug: "value", base: "value" });
    if (positionals.length) throw usageError("ta-prompt", `unexpected argument ${positionals[0]}`);
    requireRun("ta-prompt", flags);
    if (typeof flags.slug !== "string") throw usageError("ta-prompt", "--slug <s> is required");
    if (typeof flags.base !== "string") throw usageError("ta-prompt", "--base <branch> is required");
    ctx.out(notImplemented("M3"));
    return EXIT.USAGE;
  },
};
