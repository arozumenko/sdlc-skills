// TASK-008 — the assessment clean-tree check (D18 / P6), moved out of
// cmd-run.mjs into a lib module so `scope` (TASK-013) and `run init` share
// one definition without a command importing a command (TL-1; TASK-012
// review-3 follow-up). cmd-run.test.mjs "P6: …" pins the end-to-end shapes;
// this file pins the module's contract.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupAll, git, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { renderBlock } from "./ignore-block.mjs";
import { MANAGED_PATH, assessmentDirt, gitignoreOnlyManagedBlock } from "./clean-tree.mjs";

after(cleanupAll);

const HERE = resolve(new URL(".", import.meta.url).pathname);
const SELF = readFileSync(join(HERE, "clean-tree.mjs"), "utf8");
const CODE = SELF.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const BLOCK = renderBlock({});

function ctxIn(repo) {
  return createContext({}, { cwd: repo, env: {}, stdout: { write() {} }, stderr: { write() {} } });
}

function commit(repo, msg) {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", msg]);
}

test("MANAGED_PATH: the bundle's own paths (D18), nothing else", () => {
  for (const p of [".agents/security-testing/engagement.md", ".agents/security-testing/private/keys/current", "reports/security/r.md", "tasks/security-x-admitted/TC.md"]) {
    assert.ok(MANAGED_PATH.test(p), p);
  }
  for (const p of [".agents/memory/x.md", "reports/other.md", "tasks/security-notes.md", "src/security-testing/x.js", ".gitignore"]) {
    assert.ok(!MANAGED_PATH.test(p), p);
  }
});

test("assessmentDirt: empty union ⇒ [] without running git; dirt under the assessed paths listed with xy; managed paths and the block-only .gitignore excluded", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  assert.deepEqual(assessmentDirt(ctx, { scope_paths: [], product_paths: [] }), []);

  writeFileSync(join(repo, "src", "app.js"), "changed\n");
  writeFileSync(join(repo, "src", "new.js"), "untracked\n");
  writeFileSync(join(repo, "README.md"), "outside\n");
  const dirt = assessmentDirt(ctx, { scope_paths: ["src/"], product_paths: [] });
  assert.deepEqual(dirt, [
    { xy: " M", path: "src/app.js" },
    { xy: "??", path: "src/new.js" },
  ]);
  assert.deepEqual(assessmentDirt(ctx, { scope_paths: ["README.md"], product_paths: [] }), [{ xy: " M", path: "README.md" }]);

  // the whole tree assessed: the bundle's paths and a block-only .gitignore never count
  const whole = initRepo();
  const wctx = ctxIn(whole);
  writeFileSync(join(whole, ".gitignore"), BLOCK);
  mkdirSync(join(whole, ".agents", "security-testing", "private"), { recursive: true });
  writeFileSync(join(whole, ".agents", "security-testing", "engagement.md"), "record\n");
  mkdirSync(join(whole, "reports", "security"), { recursive: true });
  writeFileSync(join(whole, "reports", "security", "r.md"), "draft\n");
  assert.deepEqual(assessmentDirt(wctx, { scope_paths: ["."], product_paths: [] }), []);
  writeFileSync(join(whole, ".gitignore"), `${BLOCK}dist/\n`);
  assert.deepEqual(assessmentDirt(wctx, { scope_paths: ["."], product_paths: [] }), [{ xy: "??", path: ".gitignore" }]);
});

test("gitignoreOnlyManagedBlock: compares git-significant lines (block stripped, CR and blank lines dropped) for every HEAD shape, including a deleted working file", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  // no .gitignore at HEAD, block-only working file
  writeFileSync(join(repo, ".gitignore"), BLOCK);
  assert.equal(gitignoreOnlyManagedBlock(ctx), true);
  writeFileSync(join(repo, ".gitignore"), `${BLOCK}\ndist/\n`);
  assert.equal(gitignoreOnlyManagedBlock(ctx), false);

  // committed without a trailing LF; block attached with the LF the writer adds; CRLF variant
  writeFileSync(join(repo, ".gitignore"), "node_modules/");
  commit(repo, "gitignore");
  writeFileSync(join(repo, ".gitignore"), `node_modules/\n${BLOCK}`);
  assert.equal(gitignoreOnlyManagedBlock(ctx), true);
  writeFileSync(join(repo, ".gitignore"), `node_modules/\r\n\r\n${BLOCK.replaceAll("\n", "\r\n")}`);
  assert.equal(gitignoreOnlyManagedBlock(ctx), true);
  writeFileSync(join(repo, ".gitignore"), `node_modules/\n# security-testing:begin\ndist/\n`);
  assert.equal(gitignoreOnlyManagedBlock(ctx), false, "an unterminated begin hides nothing");

  // HEAD holds only the block and the working file is deleted: both sides reduce to no
  // significant line — clean here (re-exposing private/ is `engagement validate`'s
  // IGNORE-BLOCK: stale concern, not run init's)
  writeFileSync(join(repo, ".gitignore"), BLOCK);
  commit(repo, "block only");
  unlinkSync(join(repo, ".gitignore"));
  assert.equal(gitignoreOnlyManagedBlock(ctx), true);
  assert.deepEqual(assessmentDirt(ctx, { scope_paths: ["."], product_paths: [] }), []);
});

test("module boundary: the block's edges come from ignore-block.mjs (one definition), git only through lib/git.mjs, no writes, no cmd-* import", () => {
  assert.match(SELF, /from "\.\/ignore-block\.mjs"/);
  assert.doesNotMatch(CODE, /security-testing:(begin|end)/, "no second spelling of the markers (prose aside)");
  assert.doesNotMatch(CODE, /cmd-[a-z-]+\.mjs|ledger\.mjs|run-index\.mjs|schema\.mjs/, "a lib module, not a command");
  assert.doesNotMatch(SELF, /writeFileSync|writeAtomic|writeExclusive|child_process|console\.|Date\.now|new Date/);
});
