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

test("admit validates argv, then NOT-IMPLEMENTED(M3)", async () => {
  const repo = initRepo();
  writeFileSync(join(repo, "case.md"), "# case\n");
  const missing = await runScript("plan", ["admit", "--run", "abc"], { cwd: repo });
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /^USAGE\(admit: <case\.md> is required\)$/m);
  const absent = await runScript("plan", ["admit", "--run", "abc", "nope.md"], { cwd: repo });
  assert.equal(absent.code, 2);
  assert.match(absent.stdout, /^USAGE\(admit: cannot read nope\.md\)$/m);
  const ok = await runScript("plan", ["admit", "--run", "abc", "case.md", "--receipt", "a".repeat(64)], { cwd: repo });
  assert.equal(ok.code, 2);
  assert.equal(ok.stdout, "NOT-IMPLEMENTED(M3)\n");
  const badReceipt = await runScript("plan", ["admit", "--run", "abc", "case.md", "--receipt", "xyz"], { cwd: repo });
  assert.equal(badReceipt.code, 2);
  assert.match(badReceipt.stdout, /^USAGE\(admit: --receipt must be a sha256\)$/m);
});

test("propose validates the proposal frontmatter block against the schema, then NOT-IMPLEMENTED(M3)", async () => {
  const repo = initRepo();
  const ok = await runScript("plan", ["propose", "--run", "abc", proposalMd(repo, OK_PROPOSAL)], { cwd: repo });
  assert.equal(ok.code, 2);
  assert.equal(ok.stdout, "NOT-IMPLEMENTED(M3)\n");

  const bad = { ...OK_PROPOSAL, authorization: { ...OK_PROPOSAL.authorization, authenticated: true } };
  const r = await runScript("plan", ["propose", "--run", "abc", proposalMd(repo, bad, "bad.proposal.md")], { cwd: repo });
  assert.equal(r.code, 2);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "SCHEMA-INVALID(proposal: $.authorization.authenticated: expected const false)");
  assert.equal(lines.includes("NOT-IMPLEMENTED(M3)"), false);

  writeFileSync(join(repo, "none.proposal.md"), "# no block here\n");
  const none = await runScript("plan", ["propose", "--run", "abc", "none.proposal.md"], { cwd: repo });
  assert.equal(none.code, 2);
  assert.match(none.stdout, /^SCHEMA-INVALID\(proposal: no ```json proposal block\)$/m);
});

test("ta-prompt requires --run, --slug and --base, then NOT-IMPLEMENTED(M3)", async () => {
  const repo = initRepo();
  const bad = await runScript("plan", ["ta-prompt", "--run", "abc", "--slug", "s"], { cwd: repo });
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^USAGE\(ta-prompt: --base <branch> is required\)$/m);
  const ok = await runScript("plan", ["ta-prompt", "--run", "abc", "--slug", "s", "--base", "main"], { cwd: repo });
  assert.equal(ok.code, 2);
  assert.equal(ok.stdout, "NOT-IMPLEMENTED(M3)\n");
});

test("the entry script is a thin dispatcher", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "plan.mjs"), "utf8");
  assert.match(src, /from "\.\/lib\/cli\.mjs"/);
  assert.doesNotMatch(src, /child_process|node:fs\b/);
});
