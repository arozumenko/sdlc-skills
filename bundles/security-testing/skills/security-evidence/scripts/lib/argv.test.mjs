import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCommandArgv } from "./argv.mjs";
import { parseCommandArgv as reexported } from "./cli.mjs";
import { CliError } from "./exit.mjs";

const usage2 = (re) => (e) => e instanceof CliError && e.code === 2 && re.test(e.token);

test("argv.mjs is a leaf over exit.mjs, and cli.mjs re-exports the same function", () => {
  const src = readFileSync(fileURLToPath(new URL("./argv.mjs", import.meta.url)), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./exit.mjs"]);
  assert.equal(reexported, parseCommandArgv);
});

test("value, list and boolean flags; `=` form; positionals; `--` ends flag parsing", () => {
  const spec = { run: "value", path: "list", json: "boolean" };
  assert.deepEqual(parseCommandArgv("x", ["--run", "r1", "--path", "a", "--path=b", "--json", "pos", "--", "--not-a-flag"], spec), {
    flags: { run: "r1", path: ["a", "b"], json: true },
    positionals: ["pos", "--not-a-flag"],
  });
  assert.deepEqual(parseCommandArgv("x", ["--run", "first", "--run", "last"], spec).flags, { run: "last" });
  assert.deepEqual(parseCommandArgv("x", [], spec), { flags: {}, positionals: [] });
});

test("usage errors name the command: unknown flag, value for a boolean, missing or empty value", () => {
  const spec = { run: "value", json: "boolean" };
  assert.throws(() => parseCommandArgv("check", ["--nope"], spec), usage2(/^USAGE\(check: unknown flag --nope\)$/));
  assert.throws(() => parseCommandArgv("check", ["--json=1"], spec), usage2(/^USAGE\(check: --json takes no value\)$/));
  assert.throws(() => parseCommandArgv("check", ["--run"], spec), usage2(/^USAGE\(check: --run needs a value\)$/));
  assert.throws(() => parseCommandArgv("check", ["--run", "--json"], spec), usage2(/^USAGE\(check: --run needs a value\)$/));
  assert.throws(() => parseCommandArgv("check", ["--run="], spec), usage2(/^USAGE\(check: --run needs a value\)$/));
});
