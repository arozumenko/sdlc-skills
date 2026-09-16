// TASK-031 — the `full-report` profile (spec §6.9 "full-report (explicit)";
// plan §5 TASK-031 "report + findings JSON (explicit only)"; US-023 AC-1).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, parseStrict } from "../../canon.mjs";
import { cleanupAll } from "../../fixtures/cli/harness.mjs";
import { committedReviewRun } from "../../fixtures/publish/setup.mjs";
import { loadSource } from "./_source.mjs";
import { OUTPUTS, PROFILE, PROFILE_VERSION, apply } from "./full-report.mjs";

after(cleanupAll);

test("apply: report.md verbatim plus findings.json = the canonical claimed payload (snippets included, already redacted at gate)", async () => {
  const { dir, claimed, ids } = await committedReviewRun();
  const source = loadSource(dir, { command: "publish" });
  const outputs = apply(source, null, {});
  assert.equal(PROFILE, "full-report");
  assert.equal(PROFILE_VERSION, 1);
  assert.deepEqual(OUTPUTS, ["report.md", "findings.json"]);
  assert.deepEqual(
    outputs.map((o) => o.relpath),
    ["report.md", "findings.json"],
  );
  assert.ok(outputs[0].bytes.equals(readFileSync(join(dir, "report.md"))), "the report is the run's report, byte for byte");
  const findings = outputs[1].bytes;
  assert.ok(findings.equals(Buffer.concat([canonical(claimed.payload), Buffer.from("\n")])), "canonical claimed payload + LF");
  const parsed = parseStrict(findings);
  assert.equal(parsed.findings.length, 4);
  const injection = parsed.findings.find((f) => f.id === ids.injection);
  assert.equal(injection.snippet, 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);', "full disclosure keeps the plain snippet");
  const secret = parsed.findings.find((f) => f.id === ids.secret);
  assert.equal(secret.context_redacted, "// <REDACTED:password-assign>");
  assert.ok(!findings.toString("utf8").includes("password=1234"), "never the protected bytes: gate stored the redacted form");
});

test("apply on a source without a claimed set (a verify-kind run) writes findings.json as an empty set", async () => {
  const { dir } = await committedReviewRun();
  const source = { ...loadSource(dir, { command: "publish" }), claimed: null };
  const outputs = apply(source, null, {});
  assert.equal(outputs[1].bytes.toString("utf8"), '{"findings":[]}\n');
});
