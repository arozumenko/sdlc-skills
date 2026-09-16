// lib/cli.mjs — the dispatcher shared by the five entry scripts (TASK-006,
// TL-1, plan §3.1).
//
//   node <script>.mjs [global flags] <command> [<subcommand>] [flags]
//
// Global flags (`--root <dir>`, `--actor <name>`, `--quiet`, `--help`) are
// accepted anywhere; everything else is the command argv handed to
// `lib/cmd-<name>.mjs`'s `run(argv, ctx) → Promise<number>`. The entry
// script is one table: `{ <command>: () => import("./lib/cmd-<name>.mjs") }`
// — a later task adds its command by adding one line there. A command parses
// its own argv with `lib/argv.mjs` (a leaf), so nothing under cmd-*.mjs
// imports this dispatcher.
//
// Exit codes (lib/exit.mjs): `--help` 0 · no command / unknown command /
// bad global flag 2 (usage on stdout) · a CliError thrown anywhere in main
// (flag parsing, context creation, run()) prints its token on stdout and
// returns its code · an integrity failure escaping run() is 5 · anything
// else is 1 with a redacted message on stderr. main() never rejects: the
// one catch below wraps the whole body, so an entry script's `await main()`
// cannot let Node print an unredacted stack.
// Usage, unknown command and `--help` never need a git work tree: the
// context is created only once a registered command is about to run.

import { createContext } from "./ctx.mjs";
import { CliError, EXIT, exitCodeFor, usageError } from "./exit.mjs";
export { parseCommandArgv } from "./argv.mjs";
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
      // Forwarded, not swallowed: the command's own parser (lib/argv.mjs)
      // honours `--` too, so a positional beginning with `--` can reach it.
      rest.push("--", ...argv.slice(i + 1));
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

  try {
    const { flags, rest } = parseGlobalFlags(argv);
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

    const ctx = createContext(flags, { cwd, env, stdout, stderr });
    const mod = await app.commands[command]();
    if (typeof mod.run !== "function") throw new Error(`${script}: command ${command} has no run()`);
    const code = await mod.run(rest.slice(1), ctx);
    if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error(`${script}: ${command} returned ${String(code)} instead of an exit code`);
    return code;
  } catch (err) {
    if (err instanceof CliError) {
      say(err.token); // the result channel; say() redacts like ctx.out()
      return err.code;
    }
    const message = err instanceof Error ? err.message : String(err);
    complain(`${script}: ${message}`);
    if (env.SECURITY_EVIDENCE_DEBUG && err instanceof Error && err.stack) complain(redactString(err.stack).text);
    return exitCodeFor(err); // integrity failures ⇒ 5, anything else ⇒ 1 (lib/exit.mjs)
  }
}
