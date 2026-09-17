import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, runScript, tmpDir, SCRIPTS_DIR } from "./fixtures/cli/harness.mjs";

after(cleanupAll);

const OK_PROPOSAL = JSON.parse(readFileSync(join(SCRIPTS_DIR, "fixtures", "schemas", "proposal.ok.json"), "utf8"));

function proposalMd(dir, frontmatter, name = "p.proposal.md") {
  const path = join(dir, name);
  writeFileSync(path, `# Proposal\n\n\`\`\`json proposal\n${JSON.stringify(frontmatter, null, 2)}\n\`\`\`\n\nSteps follow.\n`);
  return path;
}

test("no command ⇒ usage, exit 2", async () => {
  const r = await runScript("plan", [], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^usage: plan\.mjs/m);
});

test("--help ⇒ exit 0", async () => {
  const r = await runScript("plan", ["--help"], { cwd: tmpDir() });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /admit --run <id> <case\.md> \[--receipt <sha256>\]/);
  assert.match(r.stdout, /propose --run <id> <proposal\.md>/);
  assert.match(r.stdout, /ta-prompt --run <id> --slug <s> --base <branch>/);
});

test("unknown command ⇒ exit 2", async () => {
  const r = await runScript("plan", ["execute"], { cwd: tmpDir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown command "execute"/);
});

test("admit / propose refuse an input file outside the work tree with USAGE (inputs resolve against cwd, must lie under root)", async () => {
  // a real run so the run check passes and the path check is what refuses
  const { readyRepo, scopedRun } = await import("./fixtures/plan/helpers.mjs");
  const repo = readyRepo();
  const run_id = await scopedRun(repo);
  const proposal = proposalMd(tmpDir(), OK_PROPOSAL);
  const propose = await runScript("plan", ["propose", "--run", run_id, proposal], { cwd: repo });
  assert.equal(propose.code, 2);
  assert.equal(propose.stdout, `USAGE(propose: cannot read ${proposal} (outside the work tree))\n`, "the echoed path must survive redaction (prose leads, path follows)");
  const admit = await runScript("plan", ["admit", "--run", run_id, "../case.md"], { cwd: repo });
  assert.equal(admit.code, 2);
  assert.equal(admit.stdout, "USAGE(admit: cannot read ../case.md (outside the work tree))\n");
});

test("admit validates argv before touching the run (TASK-042 replaced the M1 stub; the real behaviour is cmd-plan.test.mjs)", async () => {
  const repo = initRepo();
  writeFileSync(join(repo, "case.md"), "# case\n");
  const missing = await runScript("plan", ["admit", "--run", "abcdefabcdef-0001"], { cwd: repo });
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /^USAGE\(admit: <case\.md> is required\)$/m);
  const badReceipt = await runScript("plan", ["admit", "--run", "abcdefabcdef-0001", "case.md", "--receipt", "xyz"], { cwd: repo });
  assert.equal(badReceipt.code, 2);
  assert.match(badReceipt.stdout, /^USAGE\(admit: --receipt must be a sha256\)$/m);
  const unknownRun = await runScript("plan", ["admit", "--run", "abcdefabcdef-0001", "case.md", "--receipt", "a".repeat(64)], { cwd: repo });
  assert.equal(unknownRun.code, 2);
  assert.equal(unknownRun.stdout, "USAGE(admit: unknown run abcdefabcdef-0001)\n");
  assert.doesNotMatch(unknownRun.stdout + missing.stdout + badReceipt.stdout, /NOT-IMPLEMENTED/);
});

test("propose validates the run and the proposal frontmatter block against the schema (TASK-042 replaced the M1 stub; the real behaviour is cmd-plan.test.mjs)", async () => {
  const repo = initRepo();
  const unknownRun = await runScript("plan", ["propose", "--run", "abcdefabcdef-0001", proposalMd(repo, OK_PROPOSAL)], { cwd: repo });
  assert.equal(unknownRun.code, 2);
  assert.equal(unknownRun.stdout, "USAGE(propose: unknown run abcdefabcdef-0001)\n");
  const badRun = await runScript("plan", ["propose", "--run", "abc", proposalMd(repo, OK_PROPOSAL)], { cwd: repo });
  assert.equal(badRun.code, 2);
  assert.match(badRun.stdout, /^USAGE\(propose: --run must be <12 hex>-<4 digits>, got abc\)$/m);
  assert.doesNotMatch(unknownRun.stdout + badRun.stdout, /NOT-IMPLEMENTED/);
});

test("ta-prompt requires --run, --slug and --base, then reads the run (TASK-044: the M1 stub is gone)", async () => {
  const repo = initRepo();
  const bad = await runScript("plan", ["ta-prompt", "--run", "abc", "--slug", "s"], { cwd: repo });
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^USAGE\(ta-prompt: --base <branch> is required\)$/m);
  const shape = await runScript("plan", ["ta-prompt", "--run", "abc", "--slug", "s", "--base", "main"], { cwd: repo });
  assert.equal(shape.code, 2);
  assert.equal(shape.stdout, "USAGE(ta-prompt: --run must be <12 hex>-<4 digits>, got abc)\n");
  const unknown = await runScript("plan", ["ta-prompt", "--run", "abcdefabcdef-0001", "--slug", "s", "--base", "main"], { cwd: repo });
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stdout, "USAGE(ta-prompt: unknown run abcdefabcdef-0001)\n");
  assert.doesNotMatch(bad.stdout + shape.stdout + unknown.stdout, /NOT-IMPLEMENTED/);
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "plan.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
});
