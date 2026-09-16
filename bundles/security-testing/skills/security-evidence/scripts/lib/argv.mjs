// lib/argv.mjs — a command's own argv parser (TASK-006, plan §3.1).
//
// Kept apart from lib/cli.mjs so a `cmd-*.mjs` module never imports the
// dispatcher: this is a leaf that depends only on lib/exit.mjs (itself a
// leaf over lib/tokens.mjs). cli.mjs re-exports it for callers that already
// import from there.

import { usageError } from "./exit.mjs";

/**
 * Parse a command's own argv against a flag spec. `spec` maps a flag name
 * (without dashes) to `"value"` (takes one value; repeatable when the spec
 * value is `"list"`) or `"boolean"`. Unknown `--flags` are usage errors; a
 * `--flag` given twice keeps the last value unless it is a `list`.
 * @param {string} command for the USAGE(<command>: …) token
 * @param {string[]} argv
 * @param {Record<string, "value" | "list" | "boolean">} spec
 * @returns {{flags: Record<string, string | string[] | boolean>, positionals: string[]}}
 * @throws {CliError} 2
 */
export function parseCommandArgv(command, argv, spec) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg : arg.slice(0, eq)).slice(2);
    const kind = spec[name];
    if (kind === undefined) throw usageError(command, `unknown flag --${name}`);
    if (kind === "boolean") {
      if (eq !== -1) throw usageError(command, `--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw usageError(command, `--${name} needs a value`);
      i++;
    }
    if (value.length === 0) throw usageError(command, `--${name} needs a value`);
    if (kind === "list") (flags[name] ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, positionals };
}

