// Offline external-cache harness (TASK-056, freezes SPIKE-001).
//
// Lets any test run `bin/init.mjs` with no network. For each external skill
// the installer would normally `git clone https://github.com/<repo>`, this
// harness:
//
//   1. `git init --bare`s a fixture remote under a temp dir and commits
//      `<subdir>/SKILL.md` (plus any other `files`) on `main`;
//   2. `git clone`s it — never copies it — into
//      `<cacheDir>/sdlc-skills/registry/<repo.replace("/", "__")>`, the exact
//      path the installer's `cacheRoot()` derives, so `shallowClone`'s
//      `.git`-exists branch runs `git fetch --depth 1 origin <ref>` against a
//      local path and `checkout FETCH_HEAD`;
//   3. writes a GIT_CONFIG_GLOBAL file with
//      `[url "/nonexistent/"] insteadOf = https://github.com/` so any attempt
//      at the real network fails immediately with
//      `'/nonexistent/<repo>' does not appear to be a git repository`.
//
// Shared by TASK-037 (manifest test) and TASK-038 (installed E2E). Stdlib
// only; every child process is `execFile` with an argv array, shell:false,
// explicit cwd and env (guardrail G-6). No network anywhere (G-14).
// Fixture repos are built by code into temp dirs, never committed (G-12).

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = nearest ancestor of this file holding bin/init.mjs. The harness
// only makes sense inside the sdlc-skills checkout (it drives the installer),
// so walking up is the honest lookup; `initPath` overrides it for callers
// that relocate the fixture.
function findInitScript() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "bin", "init.mjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("offline harness: bin/init.mjs not found above " + import.meta.url);
}

export const INIT_SCRIPT = findInitScript();

// Same substitution the installer's shallowClone() applies (only the first
// "/" — String.prototype.replace with a string pattern).
export function cacheCloneName(repo) {
  return repo.replace("/", "__");
}

function git(args, { cwd, env }) {
  return execFileSync("git", args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function defaultSkillMd(id) {
  return `---\nname: ${id}\ndescription: Offline fixture stand-in for ${id} (TASK-056 harness)\n---\n\n# ${id}\n\nOffline fixture body.\n`;
}

// Builds one bare fixture remote with `<subdir>/<file>` for every entry of
// `files` (defaults to a minimal SKILL.md whose `name:` is `id`, so the
// installer's upstream-name branch installs it under the registry id).
function buildBareRemote(tmpRoot, { id, repo, subdir, files }, env) {
  const bare = join(tmpRoot, "remotes", cacheCloneName(repo) + ".git");
  const work = join(tmpRoot, "remotes", cacheCloneName(repo) + ".work");
  mkdirSync(dirname(bare), { recursive: true });
  git(["init", "--quiet", "--bare", "--initial-branch=main", bare], { cwd: tmpRoot, env });
  git(["init", "--quiet", "--initial-branch=main", work], { cwd: tmpRoot, env });

  const skillDir = subdir ? join(work, subdir) : work;
  const entries = { ...(files || {}) };
  if (!Object.keys(entries).some((k) => k === "SKILL.md")) entries["SKILL.md"] = defaultSkillMd(id);
  for (const [rel, content] of Object.entries(entries)) {
    if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      throw new Error(`offline harness: fixture file path must stay inside the subdir: ${rel}`);
    }
    const target = join(skillDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(["add", "-A"], { cwd: work, env });
  git(
    [
      "-c", "user.name=offline-fixture",
      "-c", "user.email=offline-fixture@example.invalid",
      "-c", "commit.gpgsign=false",
      "commit", "--quiet", "-m", `fixture: ${id} from ${repo}`,
    ],
    { cwd: work, env },
  );
  git(["push", "--quiet", bare, "main"], { cwd: work, env });
  rmSync(work, { recursive: true, force: true });
  return bare;
}

/**
 * createOfflineInstall({externals: [{id, repo, subdir, files}]})
 *   → {cacheDir, gitConfigGlobal, env, projectDir, tmpRoot, remotes, cleanup()}
 *
 * - `externals`: one entry per skills.json `repo:` id the install under test
 *   will resolve. `files` maps paths relative to `subdir` → content; a
 *   SKILL.md is synthesised when absent.
 * - `env`: {SDLC_SKILLS_CACHE_DIR, GIT_CONFIG_GLOBAL, HOME} — pass it to
 *   `runInstaller` (which layers it over process.env) or straight to git.
 * - `projectDir`: an empty directory under the temp root for the installer's
 *   cwd; use it so `cleanup()` removes what the installer wrote.
 * - `remotes`: {repo → absolute bare path}, for tests that want to push a
 *   second commit and prove the fetch picks it up.
 * - Every path returned is absolute. `cleanup()` removes the whole temp root
 *   (cache, remotes, gitconfig, HOME and the project dir) and is idempotent.
 */
export function createOfflineInstall({ externals = [] } = {}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), "sdlc-offline-"));
  const home = join(tmpRoot, "home");
  const cacheDir = join(tmpRoot, "cache");
  const projectDir = join(tmpRoot, "project");
  const gitConfigGlobal = join(tmpRoot, "gitconfig");
  mkdirSync(home, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  // The rewrite is the whole point: every https://github.com/<x> becomes the
  // local path /nonexistent/<x>, which git rejects before any socket opens.
  // [user]/[commit] keep the fixture commits independent of the developer's
  // real ~/.gitconfig (HOME is redirected too, so nothing of theirs is read).
  writeFileSync(
    gitConfigGlobal,
    [
      '[url "/nonexistent/"]',
      "\tinsteadOf = https://github.com/",
      "[user]",
      "\tname = offline-fixture",
      "\temail = offline-fixture@example.invalid",
      "[commit]",
      "\tgpgsign = false",
      "[init]",
      "\tdefaultBranch = main",
      "",
    ].join("\n"),
  );

  const env = {
    SDLC_SKILLS_CACHE_DIR: cacheDir,
    GIT_CONFIG_GLOBAL: gitConfigGlobal,
    HOME: home,
  };
  // Child git needs PATH etc.; the three keys above override whatever the
  // developer's shell had.
  const gitEnv = { ...process.env, ...env };

  const registryDir = join(cacheDir, "sdlc-skills", "registry");
  mkdirSync(registryDir, { recursive: true });
  const remotes = {};
  for (const ext of externals) {
    if (!ext || typeof ext.id !== "string" || typeof ext.repo !== "string") {
      throw new Error("offline harness: each external needs {id, repo}");
    }
    if (remotes[ext.repo]) {
      throw new Error(`offline harness: repo listed twice: ${ext.repo} (put both subdirs in one entry's files)`);
    }
    const bare = buildBareRemote(tmpRoot, ext, gitEnv);
    remotes[ext.repo] = bare;
    // `git clone`, not a copy: the clone's `origin` must be the bare path so
    // the installer's `git fetch --depth 1 origin <ref>` resolves locally.
    git(["clone", "--quiet", bare, join(registryDir, cacheCloneName(ext.repo))], { cwd: tmpRoot, env: gitEnv });
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  return { cacheDir, gitConfigGlobal, env, projectDir, tmpRoot, remotes, cleanup };
}

/**
 * runInstaller({env, args, cwd}) → Promise<{code, stdout, stderr}>
 * Spawns `node bin/init.mjs <args…>` (execFile, shell:false) in `cwd` with
 * `env` layered over process.env. Never throws on a non-zero exit — the exit
 * code is data for the caller's assertion.
 */
export function runInstaller({ env, args, cwd, initPath = INIT_SCRIPT, timeoutMs = 120_000 }) {
  if (!cwd) throw new Error("offline harness: runInstaller needs an explicit cwd");
  if (!Array.isArray(args)) throw new Error("offline harness: runInstaller args must be an argv array");
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [initPath, ...args],
      {
        cwd: resolve(cwd),
        env: { ...process.env, ...(env || {}) },
        shell: false,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) code = typeof err.code === "number" ? err.code : err.signal ? 128 : 1;
        resolvePromise({ code, stdout: stdout || "", stderr: stderr || "" });
      },
    );
  });
}

/**
 * assertNoNetwork(output) — throws when the installer's combined stdout+stderr
 * shows any `https://` URL. The installer swallows git's own stderr, but its
 * `! git clone <repo>@<ref> failed: Command failed: git clone … https://github.com/…`
 * line carries the attempted URL, so this is the one reliable tell.
 */
export function assertNoNetwork(output) {
  const text = String(output);
  const hit = text.split(/\r?\n/).find((line) => /https:\/\//.test(line));
  if (hit !== undefined) {
    throw new Error(`offline harness: network access attempted — ${hit.trim()}`);
  }
}
