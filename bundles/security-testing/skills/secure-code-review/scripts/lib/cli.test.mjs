import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, runCli } from "./cli.mjs";
import { EngagementError } from "./engagement.mjs";
import { GitError } from "./git.mjs";

function sink() {
  const chunks = [];
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join("") };
}

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "st-cli-"));
  execFileSync("git", ["init", "-q"], { cwd, shell: false });
  return cwd;
}

function run(commands, argv, extra = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = runCli(commands, argv, { cwd: extra.cwd ?? repo(), stdout, stderr, ...extra });
  return { code, out: stdout.text(), err: stderr.text() };
}

const HELLO = { hello: (args, ctx) => { ctx.out(`HELLO ${args.name} ${args.loud ? "!" : ""}`); return 0; } };

test("dispatches a sub-command with --flag value and a boolean flag", () => {
  const r = run(HELLO, ["hello", "--name", "x", "--loud"], { booleans: ["loud"] });
  assert.equal(r.code, 0);
  assert.equal(r.out, "HELLO x !\n");
  assert.equal(r.err, "");
});

test("a handler returning nothing exits 0; a numeric return is the exit code", () => {
  assert.equal(run({ a: () => {} }, ["a"]).code, 0);
  assert.equal(run({ a: () => 4 }, ["a"]).code, 4);
});

test("unknown sub-command is USAGE on stdout, exit 2", () => {
  const r = run(HELLO, ["nope"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "USAGE(cli: unknown command nope)\n");
  const named = run(HELLO, ["nope"], { name: "cite" });
  assert.equal(named.out, "USAGE(cite: unknown command nope)\n");
  assert.equal(run(HELLO, []).code, 2);
  assert.match(run(HELLO, []).out, /^USAGE\(cli: /);
});

test("--help prints the command list and exits 0, even outside a repo", () => {
  const r = run({ hello: HELLO.hello, world: () => 0 }, ["--help"], { cwd: mkdtempSync(join(tmpdir(), "st-cli-norepo-")), name: "cite" });
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: cite <command>/);
  assert.match(r.out, /hello/);
  assert.match(r.out, /world/);
  assert.equal(run(HELLO, ["help"]).code, 0);
});

test("an EngagementError prints its token on stdout and exits 2", () => {
  const r = run({ a: () => { throw new EngagementError("EDIT-ENGAGEMENT-AND-RERUN", "seeded"); } }, ["a"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "EDIT-ENGAGEMENT-AND-RERUN\n");
  assert.equal(r.err, "");
  const inv = run({ a: () => { throw new EngagementError("ENGAGEMENT-INVALID(scope_paths)"); } }, ["a"]);
  assert.equal(inv.out, "ENGAGEMENT-INVALID(scope_paths)\n");
});

test("a GitError prints GIT-ERROR on stdout and exits 2", () => {
  const r = run({ a: () => { throw new GitError("unknown ref \"x\""); } }, ["a"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'GIT-ERROR unknown ref "x"\n');
});

test("any other throw is INTERNAL on stderr, exit 1", () => {
  const r = run({ a: () => { throw new TypeError("boom"); } }, ["a"]);
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.equal(r.err, "INTERNAL TypeError: boom\n");
});

test("ctx carries root, cwd, args, out and err", () => {
  const cwd = repo();
  mkdirSync(join(cwd, "sub"));
  let seen;
  const r = run({ a: (args, ctx) => { seen = ctx; ctx.err("warn"); return 0; } }, ["a", "p1", "--k", "v", "p2"], { cwd: join(cwd, "sub") });
  assert.equal(r.code, 0);
  assert.equal(r.err, "warn\n");
  assert.equal(seen.cwd, join(cwd, "sub"));
  assert.equal(seen.root, execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", shell: false }).trim());
  assert.deepEqual(seen.args, { _: ["p1", "p2"], k: "v" });
  assert.equal(typeof seen.out, "function");
});

test("an explicit root option wins over discovery; outside a repo without one is USAGE", () => {
  const norepo = mkdtempSync(join(tmpdir(), "st-cli-norepo-"));
  let root;
  assert.equal(run({ a: (a, ctx) => { root = ctx.root; return 0; } }, ["a"], { cwd: norepo, root: "/explicit" }).code, 0);
  assert.equal(root, "/explicit");
  const r = run({ a: () => 0 }, ["a"], { cwd: norepo, name: "cite" });
  assert.equal(r.code, 2);
  assert.equal(r.out, "USAGE(cite: not inside a git work tree)\n");
});

test("parseArgs: --k=v, repeated positionals, -- terminator, missing value", () => {
  assert.deepEqual(parseArgs(["x", "--k=v", "--b", "--", "--notaflag"], ["b"]), { _: ["x", "--notaflag"], k: "v", b: true });
  assert.deepEqual(parseArgs(["--lines", "3", "9"]), { _: ["9"], lines: "3" });
  assert.throws(() => parseArgs(["--k"]), /needs a value/);
  const r = run(HELLO, ["hello", "--name"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "USAGE(cli: --name needs a value)\n");
});
