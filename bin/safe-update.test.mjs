// safe-update.test.mjs — `init --update` must not destroy what a user may own.
//
// Every case runs the real installer (bin/init.mjs) in a throwaway project.
// HOME, the installer's cache dir and the global git config are pinned to the
// sandbox, and GIT_* variables a calling git hook may have set are dropped, so
// nothing here reads or writes the developer's home, cache, git config or
// repository, and nothing reaches the network (same fixture as
// security-testing-e2e.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = new URL("..", import.meta.url).pathname;
const INIT = join(REPO, "bin/init.mjs");
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");

function sandbox({ git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "safe-update-"));
  const home = join(base, "home");
  const project = join(base, "project");
  mkdirSync(home);
  mkdirSync(project);
  const env = { ...process.env, HOME: home, SDLC_SKILLS_CACHE_DIR: join(home, ".cache"), GIT_CONFIG_GLOBAL: NO_NETWORK, GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"]) delete env[k];
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: project, encoding: "utf8", env });
  const git_ = (...args) => {
    const r = run("git", args);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const init = (...args) => {
    const r = run(process.execPath, [INIT, "init", ...args, "--target", "claude", "--yes"]);
    r.out = r.stdout + r.stderr;
    return r;
  };
  if (git) {
    git_("init", "-q");
    git_("config", "user.email", "t@example.invalid");
    git_("config", "user.name", "t");
    git_("config", "commit.gpgsign", "false");
  }
  const commitAll = (msg) => {
    git_("add", "-A");
    git_("commit", "-qm", msg);
  };
  return { project, init, git: git_, commitAll, p: (...parts) => join(project, ...parts) };
}

// ── Item 1: seeds are create-only ───────────────────────────────────────────

test("--update keeps an edited seed file and a user's own file, and adds a file the project lacks", () => {
  const s = sandbox();
  assert.equal(s.init("--factory", "security-testing").status, 0);
  const seedDir = s.p(".agents/security-testing/knowledge");
  const edited = join(seedDir, "finding-schema.md");
  const own = join(seedDir, "my-notes.md");
  const missing = join(seedDir, "report-template.md"); // stands in for a file new in the scaffold
  assert.ok(existsSync(edited) && existsSync(missing), "fixture: the factory seeds these files");
  writeFileSync(edited, "local edit\n");
  writeFileSync(own, "mine\n");
  rmSync(missing);

  const r = s.init("--factory", "security-testing", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(edited, "utf8"), "local edit\n", "an edited seed file is kept");
  assert.equal(readFileSync(own, "utf8"), "mine\n", "a user's own file in the seed folder is kept");
  assert.equal(
    readFileSync(missing, "utf8"),
    readFileSync(join(REPO, "bundles/security-testing/knowledge/report-template.md"), "utf8"),
    "a file the scaffold has and the project lacks arrives",
  );
  assert.match(r.out, /seed \.agents\/security-testing\/knowledge \(exists; existing files kept\) — added 1 new file\(s\)/);
});
