// TASK-031 — the publication source: a COMMITTED run directory loaded once
// for `publish` and `check-export` (plan §4.1 rows `publish` / `check-export`;
// spec §6.1 "a run directory without COMMITTED is incomplete").
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll } from "../../fixtures/cli/harness.mjs";
import { committedReviewRun, ingestTicket } from "../../fixtures/publish/setup.mjs";
import { readyRepo } from "../../fixtures/ingest/setup.mjs";
import { CliError } from "../exit.mjs";
import { PathGuardError } from "../inputs.mjs";
import { loadSource } from "./_source.mjs";

after(cleanupAll);

test("loadSource: run, manifest, report bytes, claimed, gate-result and the run's import records; every artifact verified and the run's own", async () => {
  const { dir, run_id, manifest, claimed } = await committedReviewRun({
    repo: readyRepo(),
    before: (r, id) => ingestTicket(r, id, { id: 1, url: "https://github.com/my-org/my-product/issues/1", state: "open", title: "t" }),
  });
  const source = loadSource(dir, { command: "publish" });
  assert.equal(source.run_id, run_id);
  assert.equal(source.dir, dir);
  assert.equal(source.template, "review");
  assert.equal(source.run.envelope.kind, "run");
  assert.equal(source.manifest.envelope.self_sha256, manifest.envelope.self_sha256);
  assert.ok(source.report.equals(readFileSync(join(dir, "report.md"))));
  assert.equal(source.claimed.envelope.self_sha256, claimed.envelope.self_sha256);
  assert.equal(source.gateResult.envelope.kind, "gate-result");
  assert.equal(source.imports.length, 1);
  assert.equal(source.imports[0].payload.kind, "ticket");
  assert.ok(Object.isFrozen(source));
});

test("refusals: unknown run dir ⇒ 2 USAGE(<command>: unknown run …); not COMMITTED ⇒ 2 USAGE(… not COMMITTED …); a COMMITTED marker that is not the manifest hash ⇒ 5 INCONSISTENT(COMMITTED); a report that is not the manifest's ⇒ 5 INCONSISTENT(report.md); a tampered claimed set ⇒ 5 INCONSISTENT(findings.claimed.json)", async () => {
  const { dir, repo } = await committedReviewRun();
  const rejects = (fn, code, token) => {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof CliError, `CliError, got ${err?.constructor?.name}: ${err?.message}`);
      assert.equal(err.code, code);
      assert.match(err.token, token);
      return;
    }
    assert.fail("expected a refusal");
  };
  rejects(() => loadSource(join(repo, ".agents", "security-testing", "runs", "0000000000ab-0009"), { command: "publish" }), 2, /^USAGE\(publish: unknown run 0000000000ab-0009\)$/);

  const committed = join(dir, "COMMITTED");
  const marker = readFileSync(committed);
  rmSync(committed);
  rejects(() => loadSource(dir, { command: "check-export" }), 2, /^USAGE\(check-export: run [0-9a-f]{12}-\d{4} is not COMMITTED \(build-report first\)\)$/);
  writeFileSync(committed, `${"0".repeat(64)}\n`);
  rejects(() => loadSource(dir, { command: "publish" }), 5, /^INCONSISTENT\(COMMITTED\)$/);
  writeFileSync(committed, marker);

  const report = join(dir, "report.md");
  const reportBytes = readFileSync(report);
  writeFileSync(report, Buffer.concat([reportBytes, Buffer.from("tampered\n")]));
  rejects(() => loadSource(dir, { command: "publish" }), 5, /^INCONSISTENT\(report\.md\)$/);
  writeFileSync(report, reportBytes);

  const claimedPath = join(dir, "findings.claimed.json");
  const claimedBytes = readFileSync(claimedPath);
  writeFileSync(claimedPath, claimedBytes.toString("utf8").replace('"p1"', '"p0"'));
  rejects(() => loadSource(dir, { command: "publish" }), 5, /^INCONSISTENT\(findings\.claimed\.json\)$/);
  writeFileSync(claimedPath, claimedBytes);

  assert.doesNotThrow(() => loadSource(dir, { command: "publish" }), "restored");
  assert.throws(() => loadSource("relative/run", { command: "publish" }), /absolute/);
  assert.throws(() => loadSource(dir, {}), /command/);
  assert.ok(PathGuardError, "the loader reads through inputs.pathGuard");
});

// --- TASK-043: engagement, admissions and the candidate cases ---------------------------------

test("TASK-043: the run's engagement snapshot and every admission record are part of the source; `casesDir` adds the candidates under <st>/cases/** by identity (redacted text, admission-core.caseSha256); a tampered admission is 5 INCONSISTENT(admissions/<sha>)", async () => {
  const { mkdirSync, readdirSync } = await import("node:fs");
  const { caseSha256 } = await import("../admission-core.mjs");
  const { caseText, PASSIVE_ROWS, plan } = await import("../../fixtures/plan/helpers.mjs");
  const repo = readyRepo();
  const casesDir = join(repo, ".agents", "security-testing", "cases");
  const rel = ".agents/security-testing/cases/my-product/TC-001_headers.md";
  const text = caseText("TC-001", PASSIVE_ROWS);
  const { dir } = await committedReviewRun({
    repo,
    before: async (r, id) => {
      mkdirSync(join(casesDir, "my-product"), { recursive: true });
      writeFileSync(join(r, rel), text);
      writeFileSync(join(casesDir, "my-product", "notes.txt"), "not a case\n");
      const a = await plan(r, ["admit", "--run", id, rel]);
      if (a.code !== 0) throw new Error(a.stdout + a.stderr);
    },
  });
  const plain = loadSource(dir, { command: "publish" });
  assert.equal(plain.engagement.envelope.kind, "engagement");
  assert.equal(plain.engagement.payload.slug, "my-product");
  assert.equal(plain.admissions.length, 1);
  assert.equal(plain.admissions[0].envelope.kind, "admission");
  assert.equal(plain.admissions[0].payload.classification, "admitted-heuristic");
  assert.deepEqual(plain.cases, [], "no casesDir ⇒ no candidates read");

  const source = loadSource(dir, { command: "publish", casesDir });
  assert.equal(source.cases.length, 2, "every file under <st>/cases/** (recursively), sorted");
  const [tc, notes] = source.cases;
  assert.equal(notes.relpath, "my-product/notes.txt");
  assert.equal(tc.relpath, "my-product/TC-001_headers.md");
  assert.equal(tc.name, "TC-001_headers.md");
  assert.equal(tc.case_sha256, caseSha256(Buffer.from(text)).case_sha256);
  assert.equal(tc.case_sha256, source.admissions[0].payload.case_sha256, "the admission names the candidate by the same number");
  assert.equal(tc.redacted, text);
  assert.ok(Object.isFrozen(source.cases) && Object.isFrozen(tc));
  assert.deepEqual(loadSource(dir, { command: "publish", casesDir: join(repo, "nowhere") }).cases, [], "a missing cases dir is an empty list");

  const [name] = readdirSync(join(dir, "admissions"));
  const path = join(dir, "admissions", name);
  const bytes = readFileSync(path);
  writeFileSync(path, bytes.toString("utf8").replace("admitted-heuristic", "admitted-reviewed"));
  try {
    loadSource(dir, { command: "publish" });
    assert.fail("expected a refusal");
  } catch (err) {
    assert.ok(err instanceof CliError, err.message);
    assert.equal(err.code, 5);
    assert.equal(err.token, `INCONSISTENT(admissions/${name.slice(0, -5)})`);
  }
  writeFileSync(path, bytes);
  assert.throws(() => loadSource(dir, { command: "publish", casesDir: "relative" }), /absolute/);
});
