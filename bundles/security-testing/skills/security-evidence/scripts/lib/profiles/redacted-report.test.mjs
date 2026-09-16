// TASK-031 — the `redacted-report` profile (spec §6.9; plan §5 TASK-031
// "report minus snippets, reproduction and infra paths"; US-023 AC-1).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll } from "../../fixtures/cli/harness.mjs";
import { CLAIMS, committedReviewRun } from "../../fixtures/publish/setup.mjs";
import { loadSource } from "./_source.mjs";
import { OUTPUTS, PROFILE, PROFILE_VERSION, apply, redactReport } from "./redacted-report.mjs";

after(cleanupAll);

test("apply: one output, report.md, with every evidence block withheld, every reproduction row dropped and every infra-path line dropped; ids, titles, assets and prose kept", async () => {
  const { dir, ids } = await committedReviewRun();
  const source = loadSource(dir, { command: "publish" });
  const original = readFileSync(join(dir, "report.md"), "utf8");
  const outputs = apply(source, null, {});
  assert.equal(PROFILE, "redacted-report");
  assert.equal(PROFILE_VERSION, 1);
  assert.deepEqual(OUTPUTS, ["report.md"]);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].relpath, "report.md");
  const text = outputs[0].bytes.toString("utf8");
  // snippets: the original carries four evidence blocks (indented code); the derivative none
  assert.equal((original.match(/^Evidence \(.*\): <!-- v:findings\[\d+\]\.evidence -->$/gm) ?? []).length, 4);
  assert.ok(original.includes("    export const a = 1;"), "the original shows the snippet");
  assert.ok(!text.includes("export const a = 1;"), "no snippet in the derivative");
  assert.ok(!text.includes("req.query.id;"), "no snippet in the derivative (injection)");
  assert.ok(!text.includes("<REDACTED:password-assign>"), "not even the redacted evidence of the keyed finding");
  assert.doesNotMatch(text, /^    /m, "no indented code block survives");
  assert.equal((text.match(/^Evidence \(.*\): withheld by the redacted-report profile <!-- v:findings\[\d+\]\.evidence -->$/gm) ?? []).length, 4, "each block is replaced by one marked line");
  // reproduction
  assert.match(original, /^\| reproduction \| /m);
  assert.doesNotMatch(text, /^\| reproduction \| /m);
  assert.doesNotMatch(text, /<!-- v:findings\[\d+\]\.reproduction -->/);
  // infra paths: the bundle's own state tree
  assert.ok(original.includes(".agents/security-testing/"), "the original names the local layout");
  assert.ok(!text.includes(".agents/"), "the derivative names no local layout path");
  // kept
  for (const id of Object.values(ids)) assert.ok(text.includes(id), `finding ${id} kept`);
  for (const c of Object.values(CLAIMS)) assert.ok(text.includes(c.title), `title ${c.title} kept`);
  assert.match(text, /\| affected asset \| src\/db\.js:3-4 @ head \|/, "repo paths are the report's content, not infra");
  assert.match(text, /- Description: User input reaches the query string\./);
  assert.match(text, /^## 12\. Chain of custody$/m);
  assert.ok(text.endsWith("\n"));
  // deterministic and pure over its input
  assert.ok(apply(source, null, {})[0].bytes.equals(outputs[0].bytes));
  assert.equal(readFileSync(join(dir, "report.md"), "utf8"), original, "the source report is untouched");
});

test("redactReport (the pure transform): a verify-shaped report loses the test-output block and the executable-path row; a report without any of the three shapes is returned unchanged", () => {
  const verifyLike = [
    "| tests.executable_path | /usr/local/bin/node | <!-- v:verify.tests.executable_path -->",
    "| tests.executable_sha256 | " + "b".repeat(64) + " | <!-- v:verify.tests.executable_sha256 -->",
    "",
    "Test output (redacted, bounded): <!-- v:verify.tests.output_redacted -->",
    "",
    "    ok 1 - a",
    "    ok 2 - b",
    "",
    "- verdict: VERIFIED <!-- v:verify.evaluation.verdict -->",
    "",
  ].join("\n");
  const out = redactReport(verifyLike);
  assert.ok(!out.includes("/usr/local/bin/node"));
  assert.ok(!out.includes("ok 1 - a"));
  assert.ok(out.includes("| tests.executable_sha256 |"));
  assert.ok(out.includes("Test output (redacted, bounded): withheld by the redacted-report profile <!-- v:verify.tests.output_redacted -->"));
  assert.ok(out.includes("- verdict: VERIFIED"));
  const plain = "# r\n\n- a: 1 <!-- v:a -->\n";
  assert.equal(redactReport(plain), plain);
  assert.throws(() => redactReport(Buffer.from("x")), /string/);
});
