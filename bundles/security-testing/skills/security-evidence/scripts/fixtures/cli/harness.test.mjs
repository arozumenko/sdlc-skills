// The CLI harness is hermetic against the developer's ~/.gitconfig: both its
// own `git()` and every script `runScript` spawns run with GIT_CONFIG_NOSYSTEM
// and a harness-owned, empty GIT_CONFIG_GLOBAL. Each case first proves the
// hostile config would bite a plain git in that HOME (positive control), then
// that the harness path does not see it.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERMETIC_GITCONFIG, cleanupAll, initRepo, runScript, tmpDir } from "./harness.mjs";

after(cleanupAll);

const HARNESS_URL = pathToFileURL(join(import.meta.dirname, "harness.mjs")).href;

/** A HOME whose .gitconfig blocks every commit (pre-commit exit 1), demands a GPG signature and strips diff prefixes. */
function hostileHome() {
  const home = tmpDir("sec-home-");
  const hooks = join(home, "hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\ntouch \"$PWD/hostile-hook-ran\"\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(home, ".gitconfig"), `[core]\n\thooksPath = ${hooks}\n[commit]\n\tgpgsign = true\n[diff]\n\tnoprefix = true\n`);
  return home;
}

/** A HOME whose .gitconfig is syntactically broken: every git command in it dies with "bad config". */
function brokenHome() {
  const home = tmpDir("sec-home-");
  writeFileSync(join(home, ".gitconfig"), "[core\n");
  return home;
}

/** Plain git in `home` with no GIT_CONFIG_GLOBAL — what a non-hermetic harness would run. */
function plainGit(home, cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: home, LANG: "C", GIT_CONFIG_NOSYSTEM: "1" },
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("HERMETIC_GITCONFIG is an empty file the harness owns", () => {
  assert.equal(existsSync(HERMETIC_GITCONFIG), true);
  assert.equal(readFileSync(HERMETIC_GITCONFIG, "utf8"), "");
});

test("the harness's own git() and initRepo() ignore a hostile ~/.gitconfig in HOME", async () => {
  const home = hostileHome();
  // Positive control: in that HOME, plain git reads the hostile file.
  assert.equal(plainGit(home, home, ["config", "--global", "--get", "diff.noprefix"]).trim(), "true");

  // The harness captures HOME at import, so drive it from a child node whose HOME is the hostile one.
  const probe = `
    import { initRepo, git } from ${JSON.stringify(HARNESS_URL)};
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    const repo = initRepo();
    let noprefix = "unset";
    try { noprefix = git(repo, ["config", "--get", "diff.noprefix"]); } catch { /* exit 1: not set */ }
    console.log(JSON.stringify({
      log: git(repo, ["log", "--oneline"]),
      hookRan: existsSync(join(repo, "hostile-hook-ran")),
      noprefix,
      origins: git(repo, ["config", "--show-origin", "--list"]),
    }));
  `;
  const r = await new Promise((done) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", probe],
      { env: { PATH: process.env.PATH, HOME: home, LANG: "C", TERM: "dumb" }, shell: false, encoding: "utf8" },
      (err, stdout, stderr) => done({ err, stdout, stderr }),
    );
  });
  assert.equal(r.err, null, `harness child failed under a hostile HOME:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.match(out.log, /init$/, "initRepo committed: neither the exit-1 pre-commit hook nor commit.gpgsign leaked in");
  assert.equal(out.hookRan, false, "the hostile hooksPath never ran");
  assert.equal(out.noprefix, "unset", "diff.noprefix from the hostile HOME is not visible");
  assert.doesNotMatch(out.origins, /\.gitconfig/, "no value comes from HOME/.gitconfig");
});

test("runScript's children ignore a hostile ~/.gitconfig even when the caller overrides HOME", async () => {
  const repo = initRepo();
  const home = brokenHome();
  // Positive control: plain git in that HOME cannot even parse its config.
  assert.throws(() => plainGit(home, repo, ["rev-parse", "--show-toplevel"]), /bad config/);

  // ctx resolves root through `git rev-parse --show-toplevel`; with the broken
  // config leaking in, that fails and the script cannot get past NOT-A-WORK-TREE.
  const r = await runScript("tm-lint", ["render", "--run", "abc"], { cwd: repo, env: { HOME: home } });
  assert.equal(r.stdout, "NOT-IMPLEMENTED(M2)\n", `the script under test saw the hermetic config, not HOME/.gitconfig:\n${r.stderr}`);
  assert.equal(r.code, 2);

  const hostile = hostileHome();
  const r2 = await runScript("tm-lint", ["render", "--run", "abc"], { cwd: repo, env: { HOME: hostile } });
  assert.equal(r2.stdout, "NOT-IMPLEMENTED(M2)\n");
});
