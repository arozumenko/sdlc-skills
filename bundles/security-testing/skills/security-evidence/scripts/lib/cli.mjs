// lib/cli.mjs — the dispatcher shared by the five entry scripts (TASK-006,
// TL-1, plan §3.1).
//
//   node <script>.mjs [global flags] <command> [<subcommand>] [flags]
//
// Global flags (`--root <dir>`, `--actor <name>`, `--quiet`, `--help`) are
// accepted anywhere; everything else is the command argv handed to
// `lib/cmd-<name>.mjs`'s `run(argv, ctx) → Promise<number>`. The entry
// script is one table: `{ <command>: () => import("./lib/cmd-<name>.mjs") }`
// — a later task adds its command by adding one line there.
//
// Exit codes (lib/exit.mjs): `--help` 0 · no command / unknown command /
// bad global flag 2 (usage on stdout) · a CliError thrown by run() prints
// its token on stdout and returns its code · an integrity failure escaping
// run() is 5 · anything else is 1 with a redacted message on stderr.
// Usage, unknown command and `--help` never need a git work tree: the
// context is created only once a registered command is about to run.

import { createContext } from "./ctx.mjs";
import { CliError, EXIT, exitCodeFor, usageError } from "./exit.mjs";
import { redactString } from "../redact.mjs";

const VALUE_FLAGS = Object.freeze(["--root", "--actor"]);

/**
 * Split argv into global flags and the command argv.
 * @param {string[]} argv
 * @returns {{flags: {root?: string, actor?: string, quiet: boolean, help: boolean}, rest: string[]}}
 * @throws {CliError} 2 on a value flag without a value
 */
export function parseGlobalFlags(argv) {
  const flags = { quiet: false, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--quiet") {
      flags.quiet = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (VALUE_FLAGS.includes(name)) {
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[i + 1];
        if (value === undefined || value.startsWith("-")) throw usageError(name, "a value is required");
        i++;
      }
      if (value.length === 0) throw usageError(name, "a value is required");
      flags[name.slice(2)] = value;
      continue;
    }
    rest.push(arg);
  }
  return { flags, rest };
}

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

/**
 * Run one entry script.
 * @param {{name: string, usage: string, commands: Record<string, () => Promise<{run: (argv: string[], ctx: object) => number | Promise<number>}>>}} app
 * @param {string[]} argv process.argv.slice(2)
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, stdout?: {write(s: string): unknown}, stderr?: {write(s: string): unknown}}} [io]
 * @returns {Promise<number>} the exit code
 */
export async function main(app, argv, { cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const script = `${app.name}.mjs`;
  const say = (line) => stdout.write(`${redactString(line).text}\n`);
  const complain = (line) => stderr.write(`${redactString(line).text}\n`);

  let flags;
  let rest;
  try {
    ({ flags, rest } = parseGlobalFlags(argv));
  } catch (err) {
    if (err instanceof CliError) {
      say(err.token);
      return err.code;
    }
    throw err;
  }

  if (flags.help) {
    stdout.write(redactString(app.usage).text);
    return EXIT.OK;
  }
  const command = rest[0];
  if (command === undefined) {
    stdout.write(redactString(app.usage).text);
    return EXIT.USAGE;
  }
  if (!Object.hasOwn(app.commands, command)) {
    stdout.write(redactString(app.usage).text);
    complain(`${script}: unknown command ${JSON.stringify(command)}`);
    return EXIT.USAGE;
  }

  let ctx;
  try {
    ctx = createContext(flags, { cwd, env, stdout, stderr });
  } catch (err) {
    if (err instanceof CliError) {
      say(err.token);
      return err.code;
    }
    throw err;
  }

  try {
    const mod = await app.commands[command]();
    if (typeof mod.run !== "function") throw new Error(`${script}: command ${command} has no run()`);
    const code = await mod.run(rest.slice(1), ctx);
    if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error(`${script}: ${command} returned ${String(code)} instead of an exit code`);
    return code;
  } catch (err) {
    if (err instanceof CliError) {
      ctx.out(err.token);
      return err.code;
    }
    const message = err instanceof Error ? err.message : String(err);
    complain(`${script}: ${message}`);
    if (env.SECURITY_EVIDENCE_DEBUG && err instanceof Error && err.stack) complain(redactString(err.stack).text);
    return exitCodeFor(err); // integrity failures ⇒ 5, anything else ⇒ 1 (lib/exit.mjs)
  }
}
