// CLI test harness (TASK-006). Spawns one of the five entry scripts with an
// argv array (execFile, shell:false — guardrail G-6) and builds throwaway git
// repositories in temp dirs (never committed fixtures — G-12).
//
// Exports:
//   runScript(name, args, {cwd, env}) → Promise<{code, stdout, stderr}>
//   initRepo(dir?)                     → absolute path of a fresh repo with one commit
//   tmpDir(prefix?)                    → mkdtemp under os.tmpdir()
//   cleanupAll()                       → removes every dir tmpDir/initRepo created
//   SCRIPTS_DIR                        → absolute path of scripts/

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const created = [];

export function tmpDir(prefix = "sec-cli-") {
  // realpath: on macOS tmpdir() is a symlink (/var → /private/var) and git
  // reports the resolved path, so tests compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export function cleanupAll() {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const GIT_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: "C",
  LC_ALL: "C",
  TERM: "dumb",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

/** Run git with an argv array inside `cwd`; returns stdout as a trimmed string. */
export function git(cwd, args) {
  return execFileSync("git", args, { cwd, env: GIT_ENV, shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * A fresh repository with `README.md` and `src/app.js` committed on `main`.
 * @param {string} [dir] defaults to a new temp dir
 * @returns {string} absolute repo path
 */
export function initRepo(dir = tmpDir("sec-repo-")) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "fixture"]);
  git(dir, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "app.js"), "export const a = 1;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

/**
 * Spawn `node <scripts>/<name>.mjs <args…>` in `cwd`. Never throws on a
 * non-zero exit; the code is data for the assertion.
 * @param {"evidence"|"verify"|"register"|"tm-lint"|"plan"} name
 * @param {string[]} args
 * @param {{cwd: string, env?: Record<string,string>, timeoutMs?: number}} options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runScript(name, args, { cwd, env = {}, timeoutMs = 30_000 }) {
  if (!cwd) throw new Error("cli harness: runScript needs an explicit cwd");
  if (!Array.isArray(args)) throw new Error("cli harness: args must be an argv array");
  const script = join(SCRIPTS_DIR, `${name}.mjs`);
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        cwd: resolve(cwd),
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C", TERM: "dumb", ...env },
        shell: false,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) code = typeof err.code === "number" ? err.code : err.signal ? 128 : 1;
        done({ code, stdout: stdout || "", stderr: stderr || "" });
      },
    );
  });
}
