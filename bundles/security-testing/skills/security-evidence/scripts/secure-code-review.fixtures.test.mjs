// TASK-034 — the `secure-code-review` skill's fixtures, frozen harness and
// standalone sequence (US-026 AC-3/AC-4, US-030 AC-3; plan §5 TASK-034; spec
// §6.5 "Fixtures include a non-secret-class finding citing password=1234",
// §12 "keyed id, no plain hash anywhere in publishable artifacts").
//
// The skill is prose; what this file pins is that its examples are TRUE
// against the bundle's own scripts: every fixture claims file passes the real
// `gate` on the fixture repo (built into a temp dir by code — never a
// committed `.git`, G-12), the examined declaration passes the real
// `coverage`, the harness freezes what it says it freezes, and the
// human-driven standalone sequence in SKILL.md lists the commands in the
// order TASK-038 path (b) executes them.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hmacHex, parseStrict, readArtifact, sha256Hex } from "./canon.mjs";
import { cleanupAll, git, runScript } from "./fixtures/cli/harness.mjs";
import { ENV, ST, readyRepo, runDir } from "./fixtures/ingest/setup.mjs";
import { redactString } from "./redact.mjs";
import { STANDALONE_SEQUENCE } from "./fixtures/e2e/helpers.mjs";
import { fixtureRevision, promptSha256 } from "../../secure-code-review/scripts/score-findings.mjs";

after(cleanupAll);

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "secure-code-review");
const FIXTURES = join(SKILL_DIR, "fixtures");
const SECRET = "password=1234";
const ZERO = "0".repeat(64);
const SHA256 = /^[0-9a-f]{64}$/;

/** Every `<name>.json` under fixtures/claims, sorted — the fixture set the skill documents. */
const CLAIM_FILES = readdirSync(join(FIXTURES, "claims"))
  .filter((n) => n.endsWith(".json"))
  .sort();

/** Copy `fixtures/repo/` (head tree) with the `fixtures/repo-base/` overlay committed first, so base ≠ head for src/auth.js. */
async function fixtureRepo() {
  const repo = readyRepo(); // engagement.md from the template: scope_paths ["src/"]
  cpSync(join(FIXTURES, "repo"), repo, { recursive: true });
  cpSync(join(FIXTURES, "repo-base"), repo, { recursive: true });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  cpSync(join(FIXTURES, "repo"), repo, { recursive: true });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "head"]);
  const init = await runScript("evidence", ["run", "init", "--kind", "review", "--base", base], { cwd: repo, env: ENV });
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const run_id = /^RUN (\S+)/.exec(init.stdout)[1];
  const s = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(s.code, 0, s.stdout + s.stderr);
  const p = await runScript("evidence", ["packet", "--run", run_id, "--kind", "scope"], { cwd: repo, env: ENV });
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const packet_sha256 = /sha256=([0-9a-f]{64})/.exec(p.stdout)[1];
  const scope = readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
  return { repo, run_id, base, scope_sha256: scope.envelope.self_sha256, packet_sha256 };
}

/** Drop a fixture payload into the agent drop-box with the run's hashes filled in (the fixture ships 64 zeros as placeholders). */
function drop(repo, run_id, name, payload) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(payload, null, 2));
  return join(ST, "receipts", run_id, name);
}

function keyBytes(repo) {
  const current = readFileSync(join(repo, ST, "private", "keys", "current"), "utf8").trim();
  return readFileSync(join(repo, ST, "private", "keys", current));
}

const keyedId = (key, path, cls, snippet, occurrence) => hmacHex(key, Buffer.from(`${path}\0${cls}\0${redactString(snippet).text}\0${occurrence}`, "utf8"));
const plainId = (path, cls, snippet, occurrence) => sha256Hex(Buffer.from(`${path}\0${cls}\0${snippet}\0${occurrence}`, "utf8"));

test("every fixture claim passes gate on its fixture repo when it names the fixture scope packet; password=1234 fixture yields a keyed id", async () => {
  assert.ok(CLAIM_FILES.length >= 3, `three fixture claims files at least: ${CLAIM_FILES}`);
  const { repo, run_id, scope_sha256, packet_sha256 } = await fixtureRepo();
  const args = ["gate", "--run", run_id];
  const sets = [];
  for (const name of CLAIM_FILES) {
    const set = parseStrict(readFileSync(join(FIXTURES, "claims", name), "utf8"));
    assert.equal(set.scope_sha256, ZERO, `${name}: ships the placeholder scope_sha256`);
    assert.equal(set.packet_sha256, ZERO, `${name}: ships the placeholder packet_sha256`);
    assert.ok(Array.isArray(set.findings) && set.findings.length > 0, `${name}: findings[] is non-empty`);
    for (const c of set.findings) assert.ok(!("id" in c) && !("state" in c) && !("occurrence" in c) && !("source" in c), `${name}: a claim never carries id/state/occurrence/source (G-7)`);
    const filled = { ...set, scope_sha256, packet_sha256 };
    args.push("--claims", drop(repo, run_id, name, filled));
    sets.push({ name, set: filled });
  }
  const r = await runScript("evidence", args, { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const total = sets.reduce((n, s) => n + s.set.findings.length, 0);
  assert.equal(r.stdout.split("\n")[0], `GATE accepted=${total} unverifiable=0 rejected=0 unlocated=0`);

  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  const gateResult = readArtifact(join(runDir(repo, run_id), "gate-result.json"), { kind: "gate-result" });
  assert.equal(claimed.payload.findings.length, total);
  for (const f of claimed.payload.findings) assert.equal(f.state, "CITATION_VERIFIED", `${f.title}: every fixture citation verifies`);
  assert.equal(gateResult.payload.accepted.length, total);

  // AC-3 (i): the non-secret-class finding citing password=1234 ⇒ keyed id, snippet redacted, no plain hash, no secret in any public artifact
  const key = keyBytes(repo);
  const pw = sets.flatMap((s) => s.set.findings).find((c) => typeof c.snippet === "string" && c.snippet.includes(SECRET));
  assert.ok(pw, "a fixture claim cites password=1234");
  assert.notEqual(pw.class, "secret", "…in a non-secret class");
  const gated = claimed.payload.findings.find((f) => f.path === pw.path && f.class === pw.class && f.lines[0] === pw.lines[0]);
  assert.ok(gated, "the password fixture was gated");
  assert.equal(gated.sensitive, true);
  assert.equal(gated.id, keyedId(key, pw.path, pw.class, pw.snippet, gated.occurrence));
  assert.notEqual(gated.id, plainId(pw.path, pw.class, pw.snippet, gated.occurrence));
  assert.ok(!("snippet" in gated) && gated.snippet_redacted.includes("<REDACTED:password-assign>"));
  const runFiles = readdirSync(runDir(repo, run_id)).filter((n) => n.endsWith(".json"));
  for (const n of runFiles) {
    const bytes = readFileSync(join(runDir(repo, run_id), n), "utf8");
    assert.ok(!bytes.includes(SECRET), `${n} carries no original secret bytes`);
    assert.ok(!bytes.includes(plainId(pw.path, pw.class, pw.snippet, gated.occurrence)), `${n} carries no plain hash of protected content`);
  }

  // AC-3 (ii): the data-flow finding carries typed citations and gate marks the class as requiring them
  const df = claimed.payload.findings.find((f) => Array.isArray(f.citations_typed) && f.citations_typed.length > 0);
  assert.ok(df, "a fixture claim carries citations_typed");
  assert.equal(df.requires_typed_citations, true, "a data-flow class");
  const roles = df.citations_typed.map((c) => c.role);
  assert.ok(roles.includes("source") && roles.includes("sink"), `source and sink are both cited: ${roles}`);
  assert.ok(df.citations_typed.every((c) => c.context === true), "gate flags every typed citation context");

  // AC-3 (iii): the deleted-code finding is a base-side citation admitted against the base blob
  const del = claimed.payload.findings.find((f) => f.side === "base");
  assert.ok(del, "a fixture claim cites side: base");
  assert.equal(del.state, "CITATION_VERIFIED");
  const headLines = readFileSync(join(repo, del.path), "utf8").split("\n").filter((l) => l.trim() !== "").length;
  assert.ok(del.lines[1] > headLines, `the cited base range ${del.lines} lies beyond head's ${headLines} lines: the code is gone at head`);
  assert.ok(SHA256.test(del.id));
});

test("the examined declaration fixture passes coverage on the fixture repo when it names the fixture scope packet", async () => {
  const { repo, run_id, packet_sha256 } = await fixtureRepo();
  const decl = parseStrict(readFileSync(join(FIXTURES, "examined", "examined-1.json"), "utf8"));
  assert.equal(decl.packet_sha256, ZERO);
  const file = drop(repo, run_id, "examined-1.json", { ...decl, packet_sha256 });
  const r = await runScript("evidence", ["coverage", "--run", run_id, "--examined", file], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout.split("\n")[0], /^COVERAGE examined=[1-9][0-9]* skipped=0 scanner=0$/);
  const cov = readArtifact(join(runDir(repo, run_id), "coverage.json"), { kind: "coverage" });
  assert.ok(cov.payload.accounting.every((a) => a.status === "examined"), "the fixture declares every admitted range: nothing unexamined");
});

test("harness.json pins the six fields", () => {
  const harness = parseStrict(readFileSync(join(SKILL_DIR, "evals", "harness.json"), "utf8"));
  assert.match(harness.prompt_sha256, SHA256, "prompt_sha256");
  assert.equal(typeof harness.model_id, "string");
  assert.ok(harness.model_id.length > 0, "model_id");
  assert.deepEqual(Object.keys(harness.sampling).sort(), ["max_tokens", "temperature", "top_p"], "sampling");
  assert.equal(harness.sampling.temperature, 0);
  assert.equal(harness.sampling.top_p, 1);
  assert.ok(Number.isInteger(harness.sampling.max_tokens) && harness.sampling.max_tokens > 0);
  assert.match(harness.fixture_revision, SHA256, "fixture_revision");
  assert.equal(harness.output_selection, "first");
  assert.equal(harness.matching.assertion_exact, true, "matching");
  // frozen means frozen: the recorded digests are the digests of what is on disk
  assert.equal(harness.prompt_sha256, promptSha256(SKILL_DIR), "prompt_sha256 is the digest of the frozen prompt files (re-freeze with `score-findings.mjs digest` after an intentional edit)");
  assert.equal(harness.fixture_revision, fixtureRevision(SKILL_DIR), "fixture_revision is the digest of evals/fixtures + expected-verdicts.json");
  // expected verdicts exist for every eval fixture and were authored against this revision
  const expected = parseStrict(readFileSync(join(SKILL_DIR, "evals", "expected-verdicts.json"), "utf8"));
  const cases = readdirSync(join(SKILL_DIR, "evals", "fixtures")).filter((n) => statSync(join(SKILL_DIR, "evals", "fixtures", n)).isDirectory()).sort();
  assert.deepEqual(Object.keys(expected.cases).sort(), cases);
  assert.equal(cases.length, 6);
  const kinds = cases.map((c) => parseStrict(readFileSync(join(SKILL_DIR, "evals", "fixtures", c, "case.json"), "utf8")).kind);
  assert.equal(kinds.filter((k) => k === "known-bad").length, 3);
  assert.equal(kinds.filter((k) => k === "clean-control").length, 1);
  assert.equal(kinds.filter((k) => k === "fp-shaped").length, 1);
  assert.equal(kinds.filter((k) => k === "adversarial").length, 1);
  assert.ok(existsSync(join(SKILL_DIR, "evals", "runs", ".gitkeep")));
  assert.ok(existsSync(join(SKILL_DIR, "evals", "README.md")));
});

test("SKILL.md standalone section lists the commands in the order of TASK-038 path (b)", () => {
  const md = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const start = md.indexOf("## Standalone review, human-driven");
  assert.ok(start >= 0, "the section exists with that exact heading");
  const next = md.indexOf("\n## ", start + 1);
  const section = md.slice(start, next === -1 ? md.length : next);
  // every backticked command in the section, in document order, reduced to `<script> <command> [<subcommand>]`
  const names = [];
  for (const m of section.matchAll(/`([^`\n]+)`/g)) {
    const cmd = /(?:^|[\s/])((?:evidence|verify)\.mjs)\s+([a-z-]+)(?:\s+([a-z-]+))?/.exec(m[1]);
    if (!cmd) continue;
    const sub = cmd[3] && ["init", "validate", "all"].includes(cmd[3]) ? ` ${cmd[3]}` : "";
    names.push(`${cmd[1]} ${cmd[2]}${sub}`);
  }
  // first occurrence of each expected name must be strictly increasing
  let last = -1;
  for (const expected of STANDALONE_SEQUENCE) {
    const at = names.indexOf(expected);
    assert.ok(at >= 0, `${expected} is in the standalone section (found: ${JSON.stringify(names)})`);
    assert.ok(at > last, `${expected} comes after the previous command (index ${at} > ${last})`);
    last = at;
  }
  assert.ok(section.includes("EDIT-ENGAGEMENT-AND-RERUN"), "the first engagement init on a bare repo exits 2 EDIT-ENGAGEMENT-AND-RERUN");
  assert.ok(section.includes("NO-ASSESSMENT"), "sign-off exits 4 NO-ASSESSMENT by design (D12)");
  assert.ok(/fresh session/i.test(section), "the vulnerability-review is performed by a fresh session");
  assert.ok(section.includes("claims-1.json") && section.includes("examined-1.json"), "the review contract's two output files are named");
});

test("SKILL.md frontmatter: agentskills.io shape, user-facing (no discoverable: false), the closed vocabularies present", () => {
  const md = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  assert.ok(fm, "frontmatter block");
  assert.match(fm[1], /^name: secure-code-review$/m);
  assert.match(fm[1], /^description: .{20,}$/m);
  assert.match(fm[1], /^license: /m);
  assert.match(fm[1], /^metadata:\n/m);
  assert.match(fm[1], /^  version: /m);
  assert.ok(!/discoverable:\s*false/.test(fm[1]), "user-facing skill: discoverable is not set to false");
  const desc = /^description: (.*)$/m.exec(fm[1])[1];
  assert.ok(desc.length <= 1024, "description ≤ 1024 chars (agentskills.io)");
  for (const token of ["confirmed", "refuted", "indeterminate", "gap", "not-refound", "refound", "source", "sink", "control", "CWE-", "do-not-flag", "refutation"]) {
    assert.ok(md.includes(token), `SKILL.md names ${token}`);
  }
  for (const ref of ["references/taxonomy.md", "references/refutation-criteria.md", "references/do-not-flag.md"]) {
    assert.ok(md.includes(ref), `SKILL.md points at ${ref}`);
    assert.ok(existsSync(join(SKILL_DIR, ref)), `${ref} exists`);
  }
  for (const forbidden of ["UNGATED", "exact checkout"]) assert.ok(!md.includes(forbidden), `G-13 forbidden string ${forbidden}`);
  // no fixture directory is named `test` (G-12)
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? [relative(SKILL_DIR, join(d, n)), ...walk(join(d, n))] : []));
  assert.ok(walk(SKILL_DIR).every((p) => !p.split("/").includes("test")), "no directory named test under the skill");
});
