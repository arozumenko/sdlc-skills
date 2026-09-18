// TASK-034 — scripts/score-findings.mjs: the deterministic scorer of the
// frozen eval harness (US-026 AC-4). Pure matching over
// expected-verdicts.json and a run's output files; stdlib only; no clock,
// no network. Exit codes follow the bundle's convention: 0 every case
// passed, 2 usage, 4 at least one case failed, 5 the run was produced under
// a harness that is not the one on disk (HARNESS-DRIFT).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureRevision, main, promptSha256, render, scoreCase, scoreRun } from "./score-findings.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "harness.json"), "utf8"));
const MATCHING = HARNESS.matching;
const created = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "score-findings-"));
  created.push(d);
  return d;
};
after(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

const claim = (over = {}) => ({ title: "t", class: "injection", priority: "p1", confidence: 8, path: "src/search.js", side: "head", lines: [5, 6], snippet: "x", citations_typed: [{ role: "source", path: "src/search.js", side: "head", lines: [3, 3], context: false }, { role: "sink", path: "src/search.js", side: "head", lines: [6, 6], context: false }], ...over });
const reviewExpected = (over = {}) => ({ contract: "review", expected: [{ class: "injection", path: "src/search.js", lines: [5, 6], typed_citations_required: true }], forbidden: [], max_extra: 0, ...over });

test("review contract: an output finding matches an expectation by exact class, exact path and overlapping lines; typed citations required for data-flow expectations", () => {
  const ok = scoreCase(reviewExpected(), { contract: "review", findings: [claim()] }, MATCHING);
  assert.equal(ok.pass, true, JSON.stringify(ok));
  assert.deepEqual(ok.reasons, []);
  assert.equal(ok.matched, 1);
  assert.equal(ok.extra, 0);

  const overlap = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ lines: [6, 9] })] }, MATCHING);
  assert.equal(overlap.pass, true, "lines overlap is enough");
  const noOverlap = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ lines: [8, 9] })] }, MATCHING);
  assert.equal(noOverlap.pass, false);
  assert.ok(noOverlap.reasons.some((r) => r.startsWith("unmatched:")), JSON.stringify(noOverlap.reasons));
  const wrongClass = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ class: "input-validation" })] }, MATCHING);
  assert.equal(wrongClass.pass, false);
  const wrongPath = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ path: "src/other.js" })] }, MATCHING);
  assert.equal(wrongPath.pass, false);

  const noTyped = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ citations_typed: undefined })] }, MATCHING);
  assert.equal(noTyped.pass, false);
  assert.ok(noTyped.reasons.some((r) => r.startsWith("typed-citations:")), JSON.stringify(noTyped.reasons));
  const sinkOnly = scoreCase(reviewExpected(), { contract: "review", findings: [claim({ citations_typed: [{ role: "sink", path: "src/search.js", side: "head", lines: [6, 6], context: false }] })] }, MATCHING);
  assert.equal(sinkOnly.pass, false, "source and sink are both required");
  const notRequired = scoreCase(reviewExpected({ expected: [{ class: "injection", path: "src/search.js", lines: [5, 6] }] }), { contract: "review", findings: [claim({ citations_typed: undefined })] }, MATCHING);
  assert.equal(notRequired.pass, true, "no typed-citation requirement ⇒ not checked");
});

test("review contract: extras beyond max_extra fail; a forbidden path or class fails; a clean control passes only on an empty findings list", () => {
  const extra = scoreCase(reviewExpected(), { contract: "review", findings: [claim(), claim({ class: "config", lines: [1, 1] })] }, MATCHING);
  assert.equal(extra.pass, false);
  assert.ok(extra.reasons.some((r) => r.startsWith("extra:")), JSON.stringify(extra.reasons));
  assert.equal(extra.extra, 1);
  const allowed = scoreCase(reviewExpected({ max_extra: 1 }), { contract: "review", findings: [claim(), claim({ class: "config", lines: [1, 1] })] }, MATCHING);
  assert.equal(allowed.pass, true);

  const forbiddenPath = scoreCase(reviewExpected({ forbidden: [{ path: "src/health.js" }], max_extra: 5 }), { contract: "review", findings: [claim(), claim({ path: "src/health.js", class: "xss" })] }, MATCHING);
  assert.equal(forbiddenPath.pass, false);
  assert.ok(forbiddenPath.reasons.some((r) => r.startsWith("forbidden:")), JSON.stringify(forbiddenPath.reasons));
  const forbiddenClass = scoreCase(reviewExpected({ forbidden: [{ class: "xss" }], max_extra: 5 }), { contract: "review", findings: [claim(), claim({ class: "xss", lines: [1, 1] })] }, MATCHING);
  assert.equal(forbiddenClass.pass, false);

  const clean = { contract: "review", expected: [], forbidden: [], max_extra: 0 };
  assert.equal(scoreCase(clean, { contract: "review", findings: [] }, MATCHING).pass, true);
  assert.equal(scoreCase(clean, { contract: "review", findings: [claim()] }, MATCHING).pass, false);
});

test("vulnerability-review contract: assertion_exact; a missing, malformed or wrong-contract output fails with a named reason", () => {
  const exp = { contract: "vulnerability-review", expected_assertion: "refuted" };
  assert.equal(scoreCase(exp, { contract: "vulnerability-review", assertion: "refuted" }, MATCHING).pass, true);
  const wrong = scoreCase(exp, { contract: "vulnerability-review", assertion: "confirmed" }, MATCHING);
  assert.equal(wrong.pass, false);
  assert.deepEqual(wrong.reasons, ["assertion: expected refuted, got confirmed"]);
  const missing = scoreCase(exp, null, MATCHING);
  assert.equal(missing.pass, false);
  assert.deepEqual(missing.reasons, ["no-output"]);
  const contract = scoreCase(exp, { contract: "review", findings: [] }, MATCHING);
  assert.equal(contract.pass, false);
  assert.deepEqual(contract.reasons, ["contract: expected vulnerability-review, got review"]);
  const malformed = scoreCase(reviewExpected(), { contract: "review", findings: "nope" }, MATCHING);
  assert.equal(malformed.pass, false);
  assert.deepEqual(malformed.reasons, ["malformed: findings is not an array"]);
});

test("scoreRun is deterministic: cases in id order, sorted keys, identical JSON for identical input; render prints CASE lines then SCORE", () => {
  const expected = { cases: { b: reviewExpected(), a: { contract: "vulnerability-review", expected_assertion: "refuted" } } };
  const outputs = { b: { contract: "review", findings: [claim()] }, a: { contract: "vulnerability-review", assertion: "confirmed" } };
  const one = scoreRun({ expected, outputs, matching: MATCHING });
  const two = scoreRun({ expected, outputs: { a: outputs.a, b: outputs.b }, matching: MATCHING });
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.deepEqual(one.cases.map((c) => c.id), ["a", "b"]);
  assert.equal(one.passed, 1);
  assert.equal(one.failed, 1);
  assert.equal(one.total, 2);
  assert.deepEqual(Object.keys(one), ["cases", "failed", "passed", "total"]);
  assert.deepEqual(Object.keys(one.cases[0]), ["extra", "id", "matched", "pass", "reasons"]);
  assert.deepEqual(render(one), ["CASE a FAIL assertion: expected refuted, got confirmed", "CASE b PASS", "SCORE passed=1 failed=1 total=2"]);
});

test("digests: fixtureRevision covers evals/fixtures + expected-verdicts.json and changes with one byte; promptSha256 covers the frozen prompt files", () => {
  const copy = tmp();
  cpSync(SKILL_DIR, copy, { recursive: true });
  assert.equal(fixtureRevision(copy), fixtureRevision(SKILL_DIR), "a byte-identical copy has the same revision");
  assert.equal(promptSha256(copy), promptSha256(SKILL_DIR));
  const harness = JSON.parse(readFileSync(join(copy, "evals", "harness.json"), "utf8"));
  assert.equal(harness.fixture_revision, fixtureRevision(copy), "harness.json is frozen against the fixtures on disk");
  assert.equal(harness.prompt_sha256, promptSha256(copy));
  const caseFile = join(copy, "evals", "fixtures", "kb-sqli-concat", "case.json");
  writeFileSync(caseFile, readFileSync(caseFile, "utf8") + "\n");
  assert.notEqual(fixtureRevision(copy), fixtureRevision(SKILL_DIR), "one byte in a fixture changes the revision");
  assert.equal(promptSha256(copy), promptSha256(SKILL_DIR), "…but not the prompt digest");
  writeFileSync(join(copy, "SKILL.md"), readFileSync(join(copy, "SKILL.md"), "utf8") + "\n");
  assert.notEqual(promptSha256(copy), promptSha256(SKILL_DIR), "one byte in SKILL.md changes the prompt digest");
  // a run record under evals/runs/ never enters the fixture revision
  mkdirSync(join(copy, "evals", "runs", "r1"), { recursive: true });
  writeFileSync(join(copy, "evals", "runs", "r1", "run.json"), "{}");
  const before = fixtureRevision(copy);
  writeFileSync(join(copy, "evals", "runs", "r1", "x.output.json"), "{}");
  assert.equal(fixtureRevision(copy), before);
});

/** A run directory under a skill copy: run.json naming the harness digests + one output file per case given. */
function runDirIn(copy, outputs, harnessOverride = {}) {
  const harness = JSON.parse(readFileSync(join(copy, "evals", "harness.json"), "utf8"));
  const dir = join(copy, "evals", "runs", "2026-09-16-a");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ harness: { prompt_sha256: harness.prompt_sha256, fixture_revision: harness.fixture_revision, model_id: harness.model_id, ...harnessOverride } }));
  for (const [id, out] of Object.entries(outputs)) writeFileSync(join(dir, `${id}.output.json`), JSON.stringify(out));
  return dir;
}

async function cli(argv, skillDir) {
  const lines = [];
  const code = await main(argv, { skillDir, stdout: (s) => lines.push(s) });
  return { code, stdout: lines.join("\n") };
}

test("CLI: `score <run-dir>` prints CASE/SCORE lines and exits 0 when every case passes, 4 otherwise; `--json` prints the scoreRun object", async () => {
  const copy = tmp();
  cpSync(SKILL_DIR, copy, { recursive: true });
  const expected = JSON.parse(readFileSync(join(copy, "evals", "expected-verdicts.json"), "utf8"));
  // a perfect run: one output per case built straight from the expectations
  const perfect = {};
  for (const [id, exp] of Object.entries(expected.cases)) {
    if (exp.contract === "review") perfect[id] = { contract: "review", findings: exp.expected.map((e) => claim({ class: e.class, path: e.path, lines: e.lines, citations_typed: e.typed_citations_required ? [{ role: "source", path: e.path, side: "head", lines: e.lines, context: false }, { role: "sink", path: e.path, side: "head", lines: e.lines, context: false }] : undefined })) };
    else perfect[id] = { contract: exp.contract, assertion: exp.expected_assertion };
  }
  const dir = runDirIn(copy, perfect);
  const ok = await cli(["score", dir], copy);
  assert.equal(ok.code, 0, ok.stdout);
  const lines = ok.stdout.split("\n");
  assert.equal(lines.length, Object.keys(expected.cases).length + 1);
  assert.ok(lines.slice(0, -1).every((l) => /^CASE [a-z0-9-]+ PASS$/.test(l)), ok.stdout);
  assert.equal(lines.at(-1), `SCORE passed=${lines.length - 1} failed=0 total=${lines.length - 1}`);
  const json = await cli(["score", dir, "--json"], copy);
  assert.equal(json.code, 0);
  assert.equal(JSON.parse(json.stdout).failed, 0);

  // one output removed ⇒ that case fails with no-output, exit 4
  rmSync(join(dir, "kb-sqli-concat.output.json"));
  const fail = await cli(["score", dir], copy);
  assert.equal(fail.code, 4);
  assert.ok(fail.stdout.includes("CASE kb-sqli-concat FAIL no-output"), fail.stdout);
});

test("CLI: a run recorded under another harness ⇒ 5 HARNESS-DRIFT(<field>), nothing scored; usage errors ⇒ 2; `digest` prints the current digests", async () => {
  const copy = tmp();
  cpSync(SKILL_DIR, copy, { recursive: true });
  const dir = runDirIn(copy, {}, { fixture_revision: "f".repeat(64) });
  const drift = await cli(["score", dir], copy);
  assert.equal(drift.code, 5);
  assert.equal(drift.stdout, "HARNESS-DRIFT(fixture_revision)");
  const dir2 = runDirIn(copy, {}, { prompt_sha256: "e".repeat(64) });
  const drift2 = await cli(["score", dir2], copy);
  assert.equal(drift2.code, 5);
  assert.equal(drift2.stdout, "HARNESS-DRIFT(prompt_sha256)");

  for (const argv of [[], ["nope"], ["score"], ["score", join(copy, "does-not-exist")], ["score", dir, "--bogus"]]) {
    const r = await cli(argv, copy);
    assert.equal(r.code, 2, JSON.stringify(argv) + r.stdout);
    assert.match(r.stdout, /^USAGE/);
  }
  const d = await cli(["digest"], copy);
  assert.equal(d.code, 0);
  assert.equal(d.stdout, `prompt_sha256=${promptSha256(copy)}\nfixture_revision=${fixtureRevision(copy)}`);
});
