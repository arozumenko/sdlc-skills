// The installer writes into the current directory. It refuses two directories
// that are never a project root: the account's home directory and the
// sdlc-skills package itself. Everything runs in temp dirs — HOME, the installer
// cache and git's global config are pinned there (pattern:
// bin/lib/core-hook-spec.test.mjs), so nothing reaches the real home or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const INIT = join(REPO, "bin/init.mjs");
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");
const ACCOUNT_HOME = join(REPO, "bin/fixtures/install-root-guard/account-home.cjs");

// A sandbox: <root>/home is HOME, <root>/cache the installer cache, <root>/proj the project.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "irg-"));
  for (const d of ["home", "proj"]) mkdirSync(join(root, d));
  const env = { ...process.env, HOME: join(root, "home"), SDLC_SKILLS_CACHE_DIR: join(root, "cache"), GIT_CONFIG_GLOBAL: NO_NETWORK };
  return { root, proj: join(root, "proj"), env };
}
const install = (init, cwd, env, nodeArgs = []) =>
  spawnSync(process.execPath, [...nodeArgs, init, "init", "--skills", "memory", "--target", "claude", "--yes"], { cwd, env, encoding: "utf8" });

// A minimal copy of this package (the installer plus one skill) in a temp dir,
// so "current directory is the package root" can be tried without writing into
// the real checkout.
function packageCopy(root) {
  const pkg = join(root, "pkg");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  cpSync(INIT, join(pkg, "bin/init.mjs"));
  cpSync(join(REPO, "bin/lib"), join(pkg, "bin/lib"), { recursive: true, filter: (src) => !src.endsWith(".test.mjs") });
  mkdirSync(join(pkg, "skills/memory"), { recursive: true });
  writeFileSync(join(pkg, "skills/memory/SKILL.md"), "---\nname: memory\ndescription: Fixture skill\n---\n# Fixture\n");
  return pkg;
}

test("refuses the account's home directory and writes nothing", () => {
  const { root, proj, env } = sandbox();
  try {
    writeFileSync(join(proj, "notes.txt"), "mine\n");
    const r = install(INIT, proj, { ...env, SDLC_TEST_ACCOUNT_HOME: proj }, ["--require", ACCOUNT_HOME]);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /Refusing to install into your home directory/);
    assert.match(r.stderr, /cd into that project/);
    assert.deepEqual(readdirSync(proj), ["notes.txt"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("refuses the package's own root and writes nothing", () => {
  const { root, env } = sandbox();
  try {
    const pkg = packageCopy(root);
    const r = install(join(pkg, "bin/init.mjs"), pkg, env);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /Refusing to install into the sdlc-skills package itself/);
    assert.deepEqual(readdirSync(pkg).sort(), ["bin", "skills"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// On a case-insensitive file system (the macOS default) one directory has many
// spellings; the comparison must not depend on which one the command used.
test("refuses the package's own root when it is reached through another spelling", (t) => {
  const { root, env } = sandbox();
  try {
    const pkg = packageCopy(root);
    const spelled = join(root, "PKG");
    if (!existsSync(spelled)) return t.skip("case-sensitive file system");
    const r = install(join(spelled, "bin/init.mjs"), pkg, env);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /Refusing to install into the sdlc-skills package itself/);
    assert.deepEqual(readdirSync(pkg).sort(), ["bin", "skills"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the same package copy installs into a separate project", () => {
  const { root, proj, env } = sandbox();
  try {
    const r = install(join(packageCopy(root), "bin/init.mjs"), proj, env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(proj, ".claude/skills/memory/SKILL.md")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a normal temp project still installs", () => {
  const { root, proj, env } = sandbox();
  try {
    const r = install(INIT, proj, env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(proj, ".claude/skills/memory/SKILL.md")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Several installer tests isolate by pointing HOME at the temp project itself.
// That is not the account's home directory, and it must keep installing.
test("a project that HOME points at (sandbox isolation) still installs", () => {
  const { root, proj, env } = sandbox();
  try {
    const r = install(INIT, proj, { ...env, HOME: proj });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(proj, ".claude/skills/memory/SKILL.md")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("read-only commands are not refused", () => {
  const { root, proj, env } = sandbox();
  try {
    const home = { ...env, SDLC_TEST_ACCOUNT_HOME: proj };
    const run = (...a) => spawnSync(process.execPath, ["--require", ACCOUNT_HOME, INIT, "init", ...a], { cwd: proj, env: home, encoding: "utf8" });
    assert.equal(run("--help").status, 0);
    assert.doesNotMatch(run("doctor", "--json").stderr, /Refusing to install/);
    assert.deepEqual(readdirSync(proj), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
