// lib/cli.mjs — the dispatcher every script's `main` is one line over:
//   process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "cite" }))
// `commands[sub](args, ctx)` runs with `args = {_: positionals, ...flags}` and
// `ctx = {root, cwd, args, out(line), err(line)}`. A flag listed in
// `booleans` takes no value; any other `--flag` consumes the next token (or
// `--flag=value`). Exit codes: the handler's return (undefined ⇒ 0); usage
// and bad input ⇒ 2 with a `USAGE(<name>: <why>)` line; an error carrying a
// `.token` (EngagementError) prints the token and exits 2; a `GitError`
// prints `GIT-ERROR <message>` and exits 2; anything else is a bug —
// `INTERNAL <name>: <message>` on stderr, exit 1.
//
// Leaf module: stdlib only — no redact, no git import — because it is
// byte-identical across the script skills (`bin/check-skill-dupes.mjs` pins
// the copies) and not every one of them ships those modules. `out()` does
// NOT redact; a script redacts before it calls `out()` or writes a file.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** Usage error: printed as `USAGE(<name>: <message>)`, exit 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Parse argv into `{_: positionals, ...flags}`.
 * @param {string[]} argv
 * @param {string[]} [booleans] flags that take no value
 * @returns {Record<string, string | true | string[]> & {_: string[]}}
 * @throws {UsageError} a value-taking flag with no value
 */
export function parseArgs(argv, booleans = []) {
  const args = { _: [] };
  const isBool = new Set(booleans);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (!tok.startsWith("--") || tok.length === 2) {
      args._.push(tok);
      continue;
    }
    const eq = tok.indexOf("=");
    const key = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
    if (isBool.has(key)) {
      args[key] = true;
      continue;
    }
    if (eq !== -1) {
      args[key] = tok.slice(eq + 1);
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value`);
    args[key] = argv[++i];
  }
  return args;
}

/** `git rev-parse --show-toplevel` from `cwd`, or null when not in a work tree. */
function discoverRoot(cwd) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, shell: false, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, encoding: "utf8" }).trim();
    return top.length === 0 ? null : resolve(top);
  } catch {
    return null;
  }
}

function usageText(name, commands) {
  return [`usage: ${name} <command> [options]`, "", "commands:", ...Object.keys(commands).map((c) => `  ${c}`)].join("\n");
}

/**
 * Dispatch `argv[0]` to `commands[argv[0]]`.
 * @param {Record<string, (args: object, ctx: object) => number | void>} commands
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {{name?: string, cwd?: string, root?: string, booleans?: string[], stdout?: {write(s: string): unknown}, stderr?: {write(s: string): unknown}}} [options]
 * @returns {number} exit code
 */
export function runCli(commands, argv, { name = "cli", cwd = process.cwd(), root, booleans = [], stdout = process.stdout, stderr = process.stderr } = {}) {
  const out = (line) => stdout.write(`${line}\n`);
  const err = (line) => stderr.write(`${line}\n`);
  const sub = argv[0];
  if (sub === undefined) {
    out(`USAGE(${name}: missing command)`);
    return 2;
  }
  if (sub === "--help" || sub === "-h" || sub === "help") {
    out(usageText(name, commands));
    return 0;
  }
  if (!Object.hasOwn(commands, sub)) {
    out(`USAGE(${name}: unknown command ${sub})`);
    return 2;
  }
  try {
    const args = parseArgs(argv.slice(1), booleans);
    const top = root ?? discoverRoot(cwd);
    if (top === null) throw new UsageError("not inside a git work tree");
    const code = commands[sub](args, { root: top, cwd, args, out, err });
    return code === undefined ? 0 : code;
  } catch (e) {
    if (e instanceof UsageError) {
      out(`USAGE(${name}: ${e.message})`);
      return 2;
    }
    if (e && typeof e.token === "string") {
      out(e.token);
      return 2;
    }
    if (e && e.name === "GitError") {
      out(`GIT-ERROR ${e.message}`);
      return 2;
    }
    err(`INTERNAL ${(e && e.name) || "Error"}: ${(e && e.message) || String(e)}`);
    return 1;
  }
}
