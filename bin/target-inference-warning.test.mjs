// Two target inferences still work but warn on stderr that a future version
// will require an explicit --target: an unattended run that takes its hosts
// from the folders present, and GitHub Copilot inferred from a .github/ that
// holds no Copilot files. The installed targets do not change. HOME, the
// installer cache and git's global config are pinned to temp dirs (pattern:
// bin/lib/core-hook-spec.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inferredTargetWarning } from "./init.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const INIT = join(REPO, "bin/init.mjs");
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");

// A temp project holding the given paths (a trailing "/" makes a directory).
function project(...paths) {
  const root = mkdtempSync(join(tmpdir(), "tiw-"));
  const proj = join(root, "proj");
  for (const d of ["home", "proj"]) mkdirSync(join(root, d));
  for (const p of paths) {
    if (p.endsWith("/")) mkdirSync(join(proj, p), { recursive: true });
    else { mkdirSync(join(proj, p, ".."), { recursive: true }); writeFileSync(join(proj, p), "x\n"); }
  }
  const env = { ...process.env, HOME: join(root, "home"), SDLC_SKILLS_CACHE_DIR: join(root, "cache"), GIT_CONFIG_GLOBAL: NO_NETWORK };
  // stdin is a pipe, never a terminal — every run here is unattended.
  const run = (...args) => spawnSync(process.execPath, [INIT, "init", "--skills", "memory", ...args], { cwd: proj, env, encoding: "utf8" });
  return { root, proj, run };
}
const FUTURE = /A future version will require an explicit --target/g;
const GUESS = /GitHub Copilot is a guess: \.github\/ exists here but holds no Copilot files/;
const withProject = (paths, fn) => { const p = project(...paths); try { fn(p); } finally { rmSync(p.root, { recursive: true, force: true }); } };

for (const [name, args] of [["--yes", ["--yes"]], ["--all", ["--all", "--agents", ""]], ["no terminal on stdin", []]]) {
  test(`unattended run (${name}) without --target warns once and installs the detected host`, () => withProject([".cursor/"], ({ proj, run }) => {
    const r = run(...args);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stderr, /No --target given: installing for Cursor, chosen from the folders present here/);
    assert.equal(r.stderr.match(FUTURE)?.length, 1, r.stderr);
    assert.doesNotMatch(r.stdout, FUTURE);
    assert.ok(existsSync(join(proj, ".cursor/skills/memory/SKILL.md")));
    assert.ok(!existsSync(join(proj, ".claude")));
  }));
}

test("unattended run with no host folder warns that Claude Code is the default", () => withProject([], ({ proj, run }) => {
  const r = run("--yes");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr, /No --target given and no host folder found here: installing for Claude Code by default/);
  assert.equal(r.stderr.match(FUTURE)?.length, 1, r.stderr);
  assert.ok(existsSync(join(proj, ".claude/skills/memory/SKILL.md")));
}));

test("Copilot inferred from a bare .github/ warns that it is a guess, and still installs", () => withProject([".github/workflows/ci.yml"], ({ proj, run }) => {
  const r = run("--yes");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr, GUESS);
  assert.equal(r.stderr.match(FUTURE)?.length, 1, r.stderr);
  assert.ok(existsSync(join(proj, ".github/skills/memory/SKILL.md")));
}));

for (const signal of [".github/agents/", ".github/skills/", ".github/hooks/", ".github/instructions/", ".github/copilot-instructions.md"]) {
  test(`${signal} is a Copilot file: no "guess" warning`, () => withProject([signal], ({ run }) => {
    const r = run("--yes");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.doesNotMatch(r.stderr, GUESS);
    assert.match(r.stderr, /No --target given: installing for GitHub Copilot, chosen from the folders present here/);
  }));
}

test("no warning when --target is given", () => withProject([".github/workflows/ci.yml", ".cursor/"], ({ proj, run }) => {
  for (const target of ["copilot", "cursor", "claude"]) {
    const r = run("--target", target, "--yes");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.doesNotMatch(r.stderr + r.stdout, /--target given|is a guess|future version/);
  }
  assert.ok(existsSync(join(proj, ".github/skills/memory/SKILL.md")));
}));

// The attended menu cannot be driven without a terminal, so its one warning is
// checked on the function: "All of the above" with a bare .github/.
test("attended run: only the bare-.github Copilot guess warns", () => withProject([".github/workflows/ci.yml", ".claude/"], ({ proj }) => {
  const copilot = { id: "copilot", dir: ".github", label: "GitHub Copilot" };
  const claude = { id: "claude", dir: ".claude", label: "Claude Code" };
  const w = inferredTargetWarning([claude, copilot], [claude, copilot], false, proj);
  assert.match(w, GUESS);
  assert.match(w, /future version will require an explicit --target copilot/);
  assert.equal(w.split("\n").length, 2);
  assert.equal(inferredTargetWarning([claude], [claude, copilot], false, proj), null);
  mkdirSync(join(proj, ".github/agents"));
  assert.equal(inferredTargetWarning([claude, copilot], [claude, copilot], false, proj), null);
}));
