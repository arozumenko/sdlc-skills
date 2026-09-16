import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupAll, git as fixtureGit, initRepo, tmpDir, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import {
  GitError,
  blobOid,
  checkIgnore,
  diffNameOnly,
  diffUnified,
  git,
  lsFiles,
  mergeBaseIsAncestor,
  revParse,
  showBytes,
  statusPorcelain,
  toplevel,
  worktreeAdd,
  worktreeRemove,
} from "./git.mjs";

after(cleanupAll);

// ---------------------------------------------------------------------------
// G-6 guard over the whole scripts tree

function walkMjs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walkMjs(p, out);
    } else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

test("every child process is spawned with shell:false and an argv array", () => {
  const self = fileURLToPath(import.meta.url);
  const files = walkMjs(SCRIPTS_DIR).filter((f) => f !== self); // the guard's own regex literals
  assert.ok(files.length >= 10, "walk found the scripts tree");
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = relative(SCRIPTS_DIR, file);
    // `exec(` and `execSync(` take a shell string; execFile/spawn take argv arrays.
    assert.doesNotMatch(src, /(?<![A-Za-z0-9_.])exec\s*\(/, `${rel}: exec( takes a shell string`);
    assert.doesNotMatch(src, /(?<![A-Za-z0-9_.])execSync\s*\(/, `${rel}: execSync( takes a shell string`);
    assert.doesNotMatch(src, /shell\s*:\s*true/, `${rel}: shell: true`);
    // every spawn-family call passes an array literal or an identifier as argv, never a template string
    for (const m of src.matchAll(/\b(execFileSync|execFile|spawnSync|spawn)\s*\(\s*([^,]+),\s*([^,]+)/g)) {
      assert.doesNotMatch(m[3].trim(), /^`/, `${rel}: template literal argv in ${m[1]}`);
      assert.doesNotMatch(m[3].trim(), /^["']/, `${rel}: string argv in ${m[1]}`);
    }
    // G-14: no network anywhere under scripts/
    assert.doesNotMatch(src, /\bfetch\s*\(|["']node:https?["']|["']https?["']|["']node:net["']|["']node:dns["']/, `${rel}: network API`);
  }
});

test("git.mjs imports only node:* and the fixed env never inherits the caller's whole environment", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "git.mjs"), "utf8");
  const specifiers = [...src.matchAll(/^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const s of specifiers) assert.ok(s.startsWith("node:"), `unexpected import ${s}`);
  assert.doesNotMatch(src, /\.\.\.process\.env/, "explicit env, never a spread of process.env");
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1");
});

// ---------------------------------------------------------------------------
// behaviour

test("git(): argv array, explicit cwd, {stdout, stderr, code}; non-zero exit is data, not a throw", () => {
  const repo = initRepo();
  const ok = git(repo, ["rev-parse", "--is-inside-work-tree"]);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), "true");
  const bad = git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/does-not-exist"]);
  assert.notEqual(bad.code, 0);
  assert.equal(typeof bad.stderr, "string");
  // input is piped to stdin
  const hashed = git(repo, ["hash-object", "--stdin"], { input: "hello\n" });
  assert.equal(hashed.stdout.trim(), "ce013625030ba8dba906f756967f9e9ca394464a");
  // encoding: "buffer" yields raw bytes
  const raw = git(repo, ["hash-object", "--stdin"], { input: "hello\n", encoding: "buffer" });
  assert.ok(Buffer.isBuffer(raw.stdout));
});

test("git() throws GitError when git cannot run at all (missing cwd)", () => {
  assert.throws(() => git(join(tmpDir(), "missing"), ["status"]), (e) => e instanceof GitError);
});

test("toplevel: inside ⇒ root, nested dir ⇒ root, outside ⇒ null", () => {
  const repo = initRepo();
  assert.equal(toplevel(repo), repo);
  mkdirSync(join(repo, "a", "b"), { recursive: true });
  assert.equal(toplevel(join(repo, "a", "b")), repo);
  assert.equal(toplevel(tmpDir()), null);
});

test("revParse resolves refs and throws GitError on an unknown ref", () => {
  const repo = initRepo();
  const head = revParse(repo, "HEAD");
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(revParse(repo, "main"), head);
  assert.throws(() => revParse(repo, "nope"), (e) => e instanceof GitError && /nope/.test(e.message));
});

test("blobOid and showBytes read a path at an oid; missing path ⇒ null / GitError", () => {
  const repo = initRepo();
  const head = revParse(repo, "HEAD");
  const oid = blobOid(repo, head, "src/app.js");
  assert.match(oid, /^[0-9a-f]{40}$/);
  assert.equal(oid, fixtureGit(repo, ["hash-object", "src/app.js"]));
  assert.equal(blobOid(repo, head, "src/missing.js"), null);
  assert.equal(blobOid(repo, head, "src"), null, "a directory is a tree, never a blob oid");
  const bytes = showBytes(repo, head, "src/app.js");
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString("utf8"), "export const a = 1;\n");
  assert.throws(() => showBytes(repo, head, "src/missing.js"), (e) => e instanceof GitError);
});

test("statusPorcelain parses -z output incl. renames and untracked files; path filter", () => {
  const repo = initRepo();
  assert.deepEqual(statusPorcelain(repo), []);
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  writeFileSync(join(repo, "new file.txt"), "x\n");
  fixtureGit(repo, ["mv", "README.md", "README.txt"]);
  const rows = statusPorcelain(repo);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(byPath["src/app.js"].xy, " M");
  assert.equal(byPath["new file.txt"].xy, "??");
  assert.equal(byPath["README.txt"].xy, "R ");
  assert.equal(byPath["README.txt"].orig, "README.md");
  assert.deepEqual(
    statusPorcelain(repo, { paths: ["src"] }).map((r) => r.path),
    ["src/app.js"],
  );
});

test("statusPorcelain: a work-tree-side rename (` R`, intent-to-add) also carries the original path", () => {
  const repo = initRepo();
  renameSync(join(repo, "README.md"), join(repo, "README.txt"));
  fixtureGit(repo, ["add", "-N", "README.txt"]);
  assert.deepEqual(statusPorcelain(repo), [{ xy: " R", path: "README.txt", orig: "README.md" }]);
});

test("lsFiles: tracked, others with excludeStandard, ignored", () => {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  writeFileSync(join(repo, "a.log"), "");
  writeFileSync(join(repo, "b.txt"), "");
  assert.deepEqual(lsFiles(repo), ["README.md", "src/app.js"]);
  assert.deepEqual(lsFiles(repo, { others: true, excludeStandard: true }), [".gitignore", "b.txt"]);
  assert.deepEqual(lsFiles(repo, { others: true, ignored: true, excludeStandard: true }), ["a.log"]);
  assert.deepEqual(lsFiles(repo, { paths: ["src"] }), ["src/app.js"]);
  const staged = lsFiles(repo, { stage: true });
  assert.equal(staged.length, 2);
  assert.match(staged[0], /^100644 [0-9a-f]{40} 0\tREADME\.md$/);
});

test("checkIgnore: ignored ⇒ true, not ignored ⇒ false", () => {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), ".agents/security-testing/private/\n");
  assert.equal(checkIgnore(repo, ".agents/security-testing/private/keys/k1"), true);
  assert.equal(checkIgnore(repo, "src/app.js"), false);
});

test("diffNameOnly, diffUnified and mergeBaseIsAncestor over two commits", () => {
  const repo = initRepo();
  const base = revParse(repo, "HEAD");
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  writeFileSync(join(repo, "src", "b.js"), "export const b = 1;\n");
  fixtureGit(repo, ["add", "-A"]);
  fixtureGit(repo, ["commit", "-q", "-m", "change"]);
  const head = revParse(repo, "HEAD");
  assert.deepEqual(diffNameOnly(repo, base, head), ["src/app.js", "src/b.js"]);
  assert.deepEqual(diffNameOnly(repo, base, head, { paths: ["src/b.js"] }), ["src/b.js"]);
  const diff = diffUnified(repo, base, head, "src/app.js");
  assert.match(diff, /^-export const a = 1;$/m);
  assert.match(diff, /^\+export const a = 2;$/m);
  assert.doesNotMatch(diff, /b\.js/);
  assert.match(diffUnified(repo, base, head), /b\.js/);
  assert.equal(mergeBaseIsAncestor(repo, base, head), true);
  assert.equal(mergeBaseIsAncestor(repo, head, base), false);
});

test("diffNameOnly / diffUnified: a ref beginning with `-` is a revision, never a flag (--end-of-options)", () => {
  const repo = initRepo();
  const head = revParse(repo, "HEAD");
  assert.throws(() => diffNameOnly(repo, "--stat", head), (e) => e instanceof GitError && /bad revision|unknown revision|--stat/.test(e.message));
  assert.throws(() => diffUnified(repo, "--stat", head), (e) => e instanceof GitError);
});

test("every argv that takes a revision carries --end-of-options (a ref beginning with `-` is data, never a flag)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "git.mjs"), "utf8");
  const revTaking = ["rev-parse", "cat-file", "diff", "merge-base"];
  const seen = new Set();
  for (const line of src.split("\n")) {
    const m = line.match(/(?:\b(?:git|must)\(\w+,|\bconst argv =)\s*\[\s*"([a-z-]+)"/); // executed argv only, not a GitError's diagnostic argv
    if (!m || !revTaking.includes(m[1])) continue;
    if (line.includes('"--show-toplevel"')) continue; // toplevel(): no revision argument
    seen.add(m[1]);
    assert.match(line, /"--end-of-options"/, `git ${m[1]} argv without --end-of-options: ${line.trim()}`);
  }
  assert.deepEqual([...seen].sort(), revTaking.sort(), "every rev-taking subcommand is covered by the guard");
});

test("worktreeAdd: the consumer's post-checkout hook does not run in the new work tree", () => {
  const repo = initRepo();
  const head = revParse(repo, "HEAD");
  const hook = join(repo, ".git", "hooks", "post-checkout");
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\ntouch hook-ran\n", { mode: 0o755 });
  // Positive control: the hook is live for an ordinary checkout in the repo.
  fixtureGit(repo, ["checkout", "-q", "--detach", head]);
  assert.equal(existsSync(join(repo, "hook-ran")), true, "control: post-checkout fires on a plain checkout");
  const dir = join(tmpDir(), "wt");
  worktreeAdd(repo, dir, head);
  assert.equal(existsSync(join(dir, "hook-ran")), false, "the hook must not run for the verify worktree");
  assert.equal(existsSync(join(dir, ".no-hooks")), false, "nothing is created at the hooks path");
  worktreeRemove(repo, dir);
});

test("worktreeAdd / worktreeRemove: detached checkout at an oid, removed cleanly", () => {
  const repo = initRepo();
  const head = revParse(repo, "HEAD");
  const dir = join(tmpDir(), "wt");
  worktreeAdd(repo, dir, head);
  assert.equal(readFileSync(join(dir, "src", "app.js"), "utf8"), "export const a = 1;\n");
  assert.equal(revParse(dir, "HEAD"), head);
  worktreeRemove(repo, dir);
  assert.equal(existsSync(dir), false);
  assert.doesNotMatch(fixtureGit(repo, ["worktree", "list"]), /wt/);
});
