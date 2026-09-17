// TASK-042 — lib/cmd-plan-propose.mjs: the refusal matrix of `plan.mjs
// propose` (spec §9.4, D7, D15 / G-8; plan §5 TASK-042; US-038 AC-1, AC-2).
// The two named verification tests (tasks/ refusal, frontmatter validation)
// are in cmd-plan.test.mjs; this file pins argv and run refusals, the
// in-tree rule for the source path, the two-block and not-JSON refusals,
// the existing-destination rule (same bytes idempotent, different bytes a
// USAGE, never an overwrite) and the parseProposal / validateProposalFile
// exports the M1 shape kept.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, plan, readyRepo, scopedRun, ST } from "../fixtures/plan/helpers.mjs";
import { CliError } from "./exit.mjs";
import { parseProposal, validateProposalFile } from "./cmd-plan-propose.mjs";

after(cleanupAll);

const OK_PROPOSAL = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "schemas", "proposal.ok.json"), "utf8"));
const proposalText = (fm, prose = "Steps follow.") => `# Proposal\n\n\`\`\`json proposal\n${JSON.stringify(fm, null, 2)}\n\`\`\`\n\n${prose}\n`;

function draft(repo, name, text) {
  mkdirSync(join(repo, ST, "cases", "drafts"), { recursive: true });
  const rel = join(ST, "cases", "drafts", name);
  writeFileSync(join(repo, rel), text);
  return rel;
}

test("argv and run refusals: --run required and shaped, one positional, unknown run; the source must lie inside the work tree and be readable; nothing written", async () => {
  const repo = readyRepo();
  const run_id = await scopedRun(repo);
  const rel = draft(repo, "P-001.proposal.md", proposalText(OK_PROPOSAL));
  for (const [args, re] of [
    [["propose", rel], /^USAGE\(propose: --run <id> is required\)$/m],
    [["propose", "--run", "nope", rel], /^USAGE\(propose: --run must be <12 hex>-<4 digits>, got nope\)$/m],
    [["propose", "--run", run_id], /^USAGE\(propose: <proposal\.md> is required\)$/m],
    [["propose", "--run", run_id, rel, "extra.md"], /^USAGE\(propose: unexpected argument extra\.md\)$/m],
    [["propose", "--run", "abcdefabcdef-0099", rel], /^USAGE\(propose: unknown run abcdefabcdef-0099\)$/m],
    [["propose", "--run", run_id, "../p.md"], /^USAGE\(propose: cannot read \.\.\/p\.md \(outside the work tree\)\)$/m],
    [["propose", "--run", run_id, join(ST, "cases", "drafts", "nope.md")], /^USAGE\(propose: cannot read /m],
    [["propose", "--run", run_id, join(ST, "cases", "drafts")], /^USAGE\(propose: cannot read /m],
  ]) {
    const r = await plan(repo, args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
  }
  assert.equal(existsSync(join(repo, ST, "proposals")), false);
});

test("the block: two blocks, a block that is not strict JSON, a wrong id shape ⇒ SCHEMA-INVALID(proposal: …); parseProposal and validateProposalFile spell the same tokens", async () => {
  const repo = readyRepo();
  const run_id = await scopedRun(repo);
  const two = draft(repo, "two.proposal.md", `${proposalText(OK_PROPOSAL)}\n\`\`\`json proposal\n{}\n\`\`\`\n`);
  const notJson = draft(repo, "notjson.proposal.md", "```json proposal\n{ id: P-001 }\n```\n");
  const badId = draft(repo, "badid.proposal.md", proposalText({ ...OK_PROPOSAL, id: "PROP-1" }));
  for (const [rel, re] of [
    [two, /^SCHEMA-INVALID\(proposal: 2 json proposal blocks; exactly one is allowed\)$/m],
    [notJson, /^SCHEMA-INVALID\(proposal: /m],
    [badId, /^SCHEMA-INVALID\(proposal: \$\.id: /m],
  ]) {
    const r = await plan(repo, ["propose", "--run", run_id, rel]);
    assert.equal(r.code, 2, `${rel}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
  }
  assert.equal(existsSync(join(repo, ST, "proposals")), false);
  assert.deepEqual(parseProposal(proposalText(OK_PROPOSAL)), OK_PROPOSAL);
  assert.throws(() => parseProposal("# nothing\n"), (err) => err instanceof CliError && err.code === 2 && err.token === "SCHEMA-INVALID(proposal: no ```json proposal block)");
  const lines = [];
  const ctx = { input: (_c, p) => join(repo, p), out: (l) => lines.push(l) };
  assert.equal(validateProposalFile(ctx, two), 2);
  assert.deepEqual(lines, ["SCHEMA-INVALID(proposal: 2 json proposal blocks; exactly one is allowed)"]);
  assert.equal(validateProposalFile(ctx, draft(repo, "ok.proposal.md", proposalText(OK_PROPOSAL))), null);
});

test("the destination: the same proposal again is idempotent (same lines, nothing rewritten); a different proposal under the same id is refused, never overwritten; a source already at the destination is fine", async () => {
  const repo = readyRepo();
  const run_id = await scopedRun(repo);
  const rel = draft(repo, "P-001.proposal.md", proposalText(OK_PROPOSAL));
  const first = await plan(repo, ["propose", "--run", run_id, rel]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const dest = join(repo, ST, "proposals", `${OK_PROPOSAL.id}.proposal.md`);
  const before = readFileSync(dest);
  const again = await plan(repo, ["propose", "--run", run_id, rel]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(again.stdout, first.stdout);
  assert.match(again.stderr, /already present with this content; nothing rewritten/);
  assert.deepEqual(readFileSync(dest), before);
  // the file at the destination itself as the source: same bytes, idempotent
  const self = await plan(repo, ["propose", "--run", run_id, join(ST, "proposals", `${OK_PROPOSAL.id}.proposal.md`)]);
  assert.equal(self.code, 0, self.stdout + self.stderr);
  assert.equal(self.stdout, first.stdout);
  // a revised proposal under the same id
  const revised = draft(repo, "P-001-v2.proposal.md", proposalText({ ...OK_PROPOSAL, title: "A different title" }));
  const r = await plan(repo, ["propose", "--run", run_id, revised]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, `USAGE(propose: ${ST}/proposals/${OK_PROPOSAL.id}.proposal.md already exists with different content; bump the id or remove it)\n`);
  assert.deepEqual(readFileSync(dest), before, "never overwritten");
  assert.deepEqual(readdirSync(join(repo, ST, "proposals")), [`${OK_PROPOSAL.id}.proposal.md`]);
});
