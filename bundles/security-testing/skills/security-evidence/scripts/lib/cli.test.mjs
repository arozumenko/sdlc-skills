import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cleanupAll, initRepo, tmpDir } from "../fixtures/cli/harness.mjs";
import { IntegrityError } from "../canon.mjs";
import { CliError } from "./exit.mjs";
import { main, parseGlobalFlags } from "./cli.mjs";

after(cleanupAll);

function streams() {
  const stdout = { text: "", write(s) { this.text += s; } };
  const stderr = { text: "", write(s) { this.text += s; } };
  return { stdout, stderr };
}

const USAGE = "usage: fake.mjs <command>\n  foo   does foo\n";

function app(run, name = "foo") {
  return { name: "fake", usage: USAGE, commands: { [name]: async () => ({ run }) } };
}

test("parseGlobalFlags: --root/--actor/--quiet/--help anywhere; `--` ends flag parsing; the rest is the command argv", () => {
  assert.deepEqual(parseGlobalFlags(["--root", "/r", "scope", "--run", "x", "--actor=lead", "--quiet"]), {
    flags: { root: "/r", actor: "lead", quiet: true, help: false },
    rest: ["scope", "--run", "x"],
  });
  assert.deepEqual(parseGlobalFlags(["check", "-h"]).flags.help, true);
  assert.deepEqual(parseGlobalFlags(["check", "--", "--root", "kept"]).rest, ["check", "--root", "kept"]);
  assert.deepEqual(parseGlobalFlags([]).rest, []);
  assert.throws(() => parseGlobalFlags(["--root"]), (e) => e instanceof CliError && e.code === 2 && /--root/.test(e.token));
  assert.throws(() => parseGlobalFlags(["--actor", "--quiet"]), (e) => e instanceof CliError && e.code === 2);
});

test("no command ⇒ usage on stdout, 2; --help ⇒ usage, 0; unknown ⇒ usage + stderr, 2 — none needs a work tree", async () => {
  const dir = tmpDir();
  let s = streams();
  assert.equal(await main(app(), [], { cwd: dir, env: {}, ...s }), 2);
  assert.equal(s.stdout.text, USAGE);
  s = streams();
  assert.equal(await main(app(), ["--help"], { cwd: dir, env: {}, ...s }), 0);
  assert.equal(s.stdout.text, USAGE);
  s = streams();
  assert.equal(await main(app(), ["bar"], { cwd: dir, env: {}, ...s }), 2);
  assert.equal(s.stdout.text, USAGE);
  assert.equal(s.stderr.text, 'fake.mjs: unknown command "bar"\n');
  s = streams();
  assert.equal(await main(app(), ["--root"], { cwd: dir, env: {}, ...s }), 2);
  assert.match(s.stdout.text, /^USAGE\(--root/);
});

test("a known command outside a work tree ⇒ NOT-A-WORK-TREE, 2", async () => {
  const s = streams();
  assert.equal(await main(app(async () => 0), ["foo"], { cwd: tmpDir(), env: {}, ...s }), 2);
  assert.equal(s.stdout.text, "NOT-A-WORK-TREE\n");
});

test("routes to run(argv, ctx) with the command argv and a ctx; the returned integer is the exit code", async () => {
  const repo = initRepo();
  const s = streams();
  let seen;
  const code = await main(
    app(async (argv, ctx) => {
      seen = { argv, root: ctx.root, actor: ctx.actor };
      ctx.out("HELLO");
      return 4;
    }),
    ["--actor", "lead", "foo", "--run", "r1"],
    { cwd: repo, env: {}, ...s },
  );
  assert.equal(code, 4);
  assert.deepEqual(seen, { argv: ["--run", "r1"], root: repo, actor: "lead" });
  assert.equal(s.stdout.text, "HELLO\n");
  // a run() that returns something other than an exit-code integer is an internal error
  const bad = streams();
  assert.equal(await main(app(async () => "ok"), ["foo"], { cwd: repo, env: {}, ...bad }), 1);
  assert.match(bad.stderr.text, /exit code/);
});

test("CliError ⇒ token on stdout, its code; integrity failure ⇒ 5; anything else ⇒ 1 with a redacted message on stderr", async () => {
  const repo = initRepo();
  let s = streams();
  assert.equal(await main(app(async () => { throw new CliError(3, "INCOMPLETE(scope)"); }), ["foo"], { cwd: repo, env: {}, ...s }), 3);
  assert.equal(s.stdout.text, "INCOMPLETE(scope)\n");
  assert.equal(s.stderr.text, "");

  s = streams();
  assert.equal(await main(app(async () => { throw new IntegrityError("/p/x.json", "self_sha256 mismatch"); }), ["foo"], { cwd: repo, env: {}, ...s }), 5);
  assert.equal(s.stdout.text, "");
  assert.match(s.stderr.text, /integrity: self_sha256 mismatch/);

  s = streams();
  assert.equal(await main(app(async () => { throw new Error("db password=hunter2 refused"); }), ["foo"], { cwd: repo, env: {}, ...s }), 1);
  assert.equal(s.stdout.text, "");
  assert.equal(s.stderr.text, "fake.mjs: db <REDACTED:password-assign> refused\n");

  // a synchronous throw inside run() is caught the same way
  s = streams();
  assert.equal(await main(app(() => { throw new TypeError("sync"); }), ["foo"], { cwd: repo, env: {}, ...s }), 1);
  assert.match(s.stderr.text, /sync/);
});

test("the subcommand stays at the head of the command argv; the cmd module routes it", async () => {
  const repo = initRepo();
  const s = streams();
  const cmds = { engagement: async () => ({ run: async (argv) => (argv[0] === "init" ? 0 : 2) }) };
  assert.equal(await main({ name: "fake", usage: USAGE, commands: cmds }, ["engagement", "init"], { cwd: repo, env: {}, ...s }), 0);
  assert.equal(await main({ name: "fake", usage: USAGE, commands: cmds }, ["engagement", "nope"], { cwd: repo, env: {}, ...s }), 2);
});
