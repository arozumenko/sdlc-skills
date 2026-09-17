import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as gitlib from "./git.mjs";
import { GitError, diffNameOnly, diffUnified, git, lsFiles, mergeBaseIsAncestor, must, revParse, showBytes, statusPorcelain, toplevel } from "./git.mjs";

const FIRST = "hello\n";
const SECOND = "hello\nworld\n";

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "st-git-"));
  must(root, ["init", "-q"]);
  must(root, ["config", "user.email", "t@t"]);
  must(root, ["config", "user.name", "t"]);
  must(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "a.txt"), FIRST);
  must(root, ["add", "-A"]);
  must(root, ["commit", "-qm", "c1"]);
  const c1 = revParse(root, "HEAD");
  writeFileSync(join(root, "a.txt"), SECOND);
  must(root, ["add", "-A"]);
  must(root, ["commit", "-qm", "c2"]);
  const c2 = revParse(root, "HEAD");
  return { root, c1, c2 };
}

test("the trimmed surface is exactly what the scripts import", () => {
  assert.deepEqual(Object.keys(gitlib).sort(), ["GitError", "diffNameOnly", "diffUnified", "git", "gitEnv", "lsFiles", "mergeBaseIsAncestor", "must", "revParse", "showBytes", "statusPorcelain", "toplevel"]);
});

test("git() returns non-zero exits as data and must() turns them into GitError", () => {
  const { root } = fixtureRepo();
  const r = git(root, ["rev-parse", "--verify", "--quiet", "nope"]);
  assert.notEqual(r.code, 0);
  assert.throws(() => must(root, ["rev-parse", "--verify", "--quiet", "nope"]), (err) => err instanceof GitError && err.name === "GitError");
  assert.throws(() => git(root, "rev-parse"), TypeError);
});

test("revParse resolves HEAD to 40 hex and rejects an unknown ref", () => {
  const { root, c2 } = fixtureRepo();
  const oid = revParse(root, "HEAD");
  assert.match(oid, /^[0-9a-f]{40}$/);
  assert.equal(oid, c2);
  assert.throws(() => revParse(root, "no-such-ref"), GitError);
});

test("showBytes returns the committed bytes at each oid", () => {
  const { root, c1, c2 } = fixtureRepo();
  assert.equal(showBytes(root, c1, "a.txt").toString("utf8"), FIRST);
  assert.equal(showBytes(root, c2, "a.txt").toString("utf8"), SECOND);
  assert.throws(() => showBytes(root, c1, "missing.txt"), GitError);
});

test("statusPorcelain is empty when clean and reports a modified file", () => {
  const { root } = fixtureRepo();
  assert.deepEqual(statusPorcelain(root), []);
  writeFileSync(join(root, "a.txt"), SECOND + "more\n");
  assert.deepEqual(statusPorcelain(root), [" M a.txt"]);
  assert.deepEqual(statusPorcelain(root, { paths: ["b.txt"] }), []);
  writeFileSync(join(root, "b.txt"), "new\n");
  assert.deepEqual(statusPorcelain(root, { paths: ["b.txt"] }), ["?? b.txt"]);
});

test("lsFiles lists the tracked file under the pathspec", () => {
  const { root } = fixtureRepo();
  assert.deepEqual(lsFiles(root, { paths: ["."] }), ["a.txt"]);
  assert.deepEqual(lsFiles(root, { paths: ["nowhere/"] }), []);
});

test("mergeBaseIsAncestor is directional", () => {
  const { root, c1, c2 } = fixtureRepo();
  assert.equal(mergeBaseIsAncestor(root, c1, c2), true);
  assert.equal(mergeBaseIsAncestor(root, c2, c1), false);
});

test("diffNameOnly and diffUnified describe c1..c2", () => {
  const { root, c1, c2 } = fixtureRepo();
  assert.deepEqual(diffNameOnly(root, c1, c2), ["a.txt"]);
  assert.deepEqual(diffNameOnly(root, c1, c2, { paths: ["other/"] }), []);
  const diff = diffUnified(root, c1, c2, "a.txt");
  assert.match(diff, /^\+\+\+ b\/a\.txt$/m);
  assert.match(diff, /^\+world$/m);
});

test("toplevel finds the work tree root from a subdirectory and null outside one", () => {
  const { root } = fixtureRepo();
  mkdirSync(join(root, "sub"));
  const top = toplevel(join(root, "sub"));
  assert.equal(top, toplevel(root));
  assert.equal(readFileSync(join(top, "a.txt"), "utf8"), SECOND);
  assert.equal(toplevel(join(root, "does-not-exist")), null);
});
