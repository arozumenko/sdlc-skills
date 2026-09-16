// TASK-056 — proves the offline external-cache harness against the real
// bin/init.mjs. Freezes SPIKE-001: a pre-populated cache clone whose `origin`
// is a local bare fixture repo takes the installer's `git fetch --depth 1`
// path, while a GIT_CONFIG_GLOBAL insteadOf rewrite makes every
// https://github.com/ URL unreachable — so any attempt at the network fails
// loudly instead of silently succeeding on a connected machine.
//
// No bundle is needed yet: `systematic-debugging` is a plain skills.json
// registry id (obra/superpowers, subdir skills/systematic-debugging).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createOfflineInstall, runInstaller, assertNoNetwork } from "./harness.mjs";

const SD = {
  id: "systematic-debugging",
  repo: "obra/superpowers",
  subdir: "skills/systematic-debugging",
  files: {
    "SKILL.md":
      "---\nname: systematic-debugging\ndescription: offline fixture copy (TASK-056)\n---\n\n# fixture body OFFLINE-FIXTURE-7f3c\n",
  },
};

const INSTALL_SD = ["init", "--skills", "systematic-debugging", "--target", "claude", "--yes"];

test("installer fetches systematic-debugging from the local bare remote, no https fetch", async () => {
  const h = createOfflineInstall({ externals: [SD] });
  try {
    // Every returned path is absolute (Interface Contract).
    for (const p of [h.cacheDir, h.gitConfigGlobal, h.projectDir, h.tmpRoot]) {
      assert.ok(p.startsWith("/"), `not absolute: ${p}`);
    }
    assert.equal(h.env.SDLC_SKILLS_CACHE_DIR, h.cacheDir);
    assert.equal(h.env.GIT_CONFIG_GLOBAL, h.gitConfigGlobal);
    assert.ok(h.env.HOME.startsWith(h.tmpRoot), "HOME lives under the temp root");
    // Same key the installer's cacheRoot() joins: <cache>/sdlc-skills/registry/<repo with "/" → "__">.
    const clone = join(h.cacheDir, "sdlc-skills", "registry", "obra__superpowers");
    assert.ok(existsSync(join(clone, ".git")), "cache clone has a .git (installer takes the fetch branch)");
    assert.ok(!existsSync(join(clone, ".git", "FETCH_HEAD")), "no FETCH_HEAD before the installer runs");
    const originUrl = execFileSync("git", ["-C", clone, "remote", "get-url", "origin"], {
      env: h.env,
      encoding: "utf8",
    }).trim();
    assert.ok(!originUrl.includes("://"), `origin must be a local path, got ${originUrl}`);
    assert.ok(existsSync(originUrl), "origin points at an existing local bare repo");

    const r = await runInstaller({ env: h.env, cwd: h.projectDir, args: INSTALL_SD });
    const out = r.stdout + r.stderr;
    assert.equal(r.code, 0, out);
    assertNoNetwork(out);
    assert.match(r.stdout, /✓ skill\s+systematic-debugging \(external: obra\/superpowers\)/);
    assert.ok(!/external fetch failed/.test(out), out);

    // The fetch path was actually taken: `git clone` never writes FETCH_HEAD, `git fetch` does.
    assert.ok(existsSync(join(clone, ".git", "FETCH_HEAD")), "installer ran git fetch against origin");
    const installed = join(h.projectDir, ".claude", "skills", "systematic-debugging", "SKILL.md");
    assert.ok(existsSync(installed), `installed SKILL.md missing at ${installed}`);
    assert.match(readFileSync(installed, "utf8"), /OFFLINE-FIXTURE-7f3c/);
  } finally {
    h.cleanup();
  }
});

test("a real GitHub URL fails under the rewrite", async () => {
  // SPIKE-001 replay, two layers: (1) git itself, (2) the installer with an
  // EMPTY cache, which forces its `git clone https://github.com/...` branch.
  const h = createOfflineInstall({ externals: [] });
  try {
    let gitErr = "";
    try {
      execFileSync(
        "git",
        ["clone", "--quiet", "--depth", "1", "https://github.com/obra/superpowers", join(h.tmpRoot, "gh")],
        { env: h.env, cwd: h.tmpRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      );
    } catch (e) {
      gitErr = String(e.stderr || e.message);
    }
    assert.match(gitErr, /\/nonexistent\/obra\/superpowers.*does not appear to be a git repository/s);
    assert.ok(!existsSync(join(h.tmpRoot, "gh")), "nothing was cloned");

    const r = await runInstaller({ env: h.env, cwd: h.projectDir, args: INSTALL_SD });
    const out = r.stdout + r.stderr;
    assert.match(out, /external fetch failed/);
    assert.throws(() => assertNoNetwork(out), /https:\/\//);
    assert.ok(!existsSync(join(h.projectDir, ".claude", "skills", "systematic-debugging")), "nothing installed");
  } finally {
    h.cleanup();
  }
});

test("cleanup leaves no temp dirs", async () => {
  const h = createOfflineInstall({ externals: [SD] });
  const r = await runInstaller({ env: h.env, cwd: h.projectDir, args: INSTALL_SD });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(h.projectDir, ".claude")), "installer wrote into the project dir");
  assert.ok(h.tmpRoot.startsWith(tmpdir()), "temp root is under os.tmpdir()");
  h.cleanup();
  for (const p of [h.tmpRoot, h.cacheDir, h.gitConfigGlobal, h.projectDir, h.env.HOME]) {
    assert.ok(!existsSync(p), `left behind: ${p}`);
  }
  // Idempotent: a second cleanup is a no-op, not a throw.
  h.cleanup();
});

test("assertNoNetwork accepts clean output and names the offending line", () => {
  assertNoNetwork("      ✓ skill  systematic-debugging (external: obra/superpowers)\n");
  assert.throws(
    () =>
      assertNoNetwork(
        "ok\n  ! git clone obra/superpowers@main failed: Command failed: git clone https://github.com/obra/superpowers /x\n",
      ),
    /network access attempted.*https:\/\/github\.com\/obra\/superpowers/s,
  );
});
