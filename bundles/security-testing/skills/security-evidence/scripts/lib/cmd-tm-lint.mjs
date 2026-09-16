// lib/cmd-tm-lint.mjs — `tm-lint.mjs check | render` (M1 shape, TASK-006).
//
// M1 ships the CLI shape and schema validation only (plan §4.4): both
// subcommands validate their argv, `check` validates the model file against
// threat-model.schema.json when one is given or the default exists, and then
// both return `2 NOT-IMPLEMENTED(M2)`. TASK-039 replaces the bodies; the
// argv contract and the tokens stay.
//
//   check  --run <id> [--model <path>=<st>/threat-model.json]
//   render --run <id>
//
// `--model <path>` is a user-typed path: ctx.input() resolves it against the
// invocation cwd and refuses a file outside the work tree (USAGE). The
// default `<st>/threat-model.json` is absolute under root and passes through.
//
// Exports one `{run(argv, ctx)}` per subcommand; the entry script's table
// picks the one it dispatches to.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseStrict } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { validate } from "./schema.mjs";
import { notImplemented, schemaInvalid } from "./tokens.mjs";

/**
 * Read a JSON file with the strict reader and validate it against a schema.
 * Prints `SCHEMA-INVALID(<schema>: <first error>)` and returns 2 on failure —
 * the strict reader's errors (duplicate key, float) count as schema errors —
 * or null when the file is valid. An unreadable path is a usage error.
 * @param {object} ctx
 * @param {string} command for the USAGE token
 * @param {string} schemaName
 * @param {string} path as the user typed it (cwd-relative) or absolute
 * @returns {number | null}
 */
export function validateJsonFile(ctx, command, schemaName, path) {
  let bytes;
  try {
    bytes = readFileSync(ctx.input(command, path));
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES") throw usageError(command, `cannot read ${path}`);
    throw err;
  }
  let value;
  try {
    value = parseStrict(bytes);
  } catch (err) {
    ctx.out(schemaInvalid(schemaName, err.message));
    return EXIT.USAGE;
  }
  const errors = validate(schemaName, value);
  if (errors.length) {
    ctx.out(schemaInvalid(schemaName, errors[0]));
    return EXIT.USAGE;
  }
  return null;
}

function requireRun(command, flags) {
  if (typeof flags.run !== "string") throw usageError(command, "--run <id> is required");
  return flags.run;
}

/** True when the default model file exists; a directory in its place is the same usage error validateJsonFile raises. */
function exists(command, path) {
  let st;
  try {
    st = statSync(path);
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  if (!st.isFile()) throw usageError(command, `cannot read ${path}`);
  return true;
}

export const check = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("check", argv, { run: "value", model: "value" });
    if (positionals.length) throw usageError("check", `unexpected argument ${positionals[0]}`);
    requireRun("check", flags);
    const model = typeof flags.model === "string" ? flags.model : join(ctx.st, "threat-model.json");
    if (typeof flags.model === "string" || exists("check", model)) {
      const code = validateJsonFile(ctx, "check", "threat-model", model);
      if (code !== null) return code;
    }
    ctx.out(notImplemented("M2"));
    return EXIT.USAGE;
  },
};

export const render = {
  async run(argv, ctx) {
    const { flags, positionals } = parseCommandArgv("render", argv, { run: "value" });
    if (positionals.length) throw usageError("render", `unexpected argument ${positionals[0]}`);
    requireRun("render", flags);
    ctx.out(notImplemented("M2"));
    return EXIT.USAGE;
  },
};
