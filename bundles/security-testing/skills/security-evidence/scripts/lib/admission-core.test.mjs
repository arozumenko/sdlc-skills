// TASK-042 — lib/admission-core.mjs: the pure half of `plan.mjs admit` (spec
// §9.1, D7, P5; plan §5 TASK-042; US-034 AC-1…AC-4; G-9 pure core). The
// identity rule (sha256 over the redacted text = `ingest case`'s
// import_sha256), the Steps-table reading, the allowed-operation grammar and
// forbidden-pattern list over the Action cell, target validation against
// `targets.browser`, and the classification table with its one reviewable
// rule. The CLI over it is cmd-plan-admit.test.mjs / cmd-plan.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256Hex } from "../canon.mjs";
import { ALLOWED_OPERATIONS, BASE_URL_PLACEHOLDER, CLASSIFICATIONS, FORBIDDEN_PATTERNS, LINT_RULES, REVIEWABLE_RULES, caseSha256, classify, hostOf, lintSteps, parseSteps, targetPolicy, targetPolicySha256 } from "./admission-core.mjs";
import { CliError } from "./exit.mjs";
import { prepareImport } from "./imports.mjs";
import { validate } from "./schema.mjs";
import { REVIEW_CONFIRMED, REVIEW_INDETERMINATE, REVIEW_REFUTED } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "..", "references", "admission.schema.json"), "utf8"));
const FIXTURE = readFileSync(join(HERE, "..", "fixtures", "qa", "TC-SEC-001.md"));

const BROWSER = ["staging.example.com", "localhost:3000"];

/** A minimal manual-qa case whose Steps rows are the given `[action, expected]` pairs. */
function caseText(rows, { id = "TC-001", frontmatterExtra = "" } = {}) {
  const table = rows.map(([a, e], i) => `| ${i + 1} | ${a} | ${e} |`).join("\n");
  return `---\nid: ${id}\ntitle: A case\npriority: high\ntype: regression\n${frontmatterExtra}---\n\n# ${id}: A case\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n${table}\n\n## Teardown\n- nothing\n`;
}

test("pure: admission-core.mjs imports nothing from node:fs, node:child_process, git.mjs, cite.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "admission-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", 'cite.mjs"', "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `admission-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../canon.mjs", "../redact.mjs", "./exit.mjs", "./ingest/_qa-markdown.mjs", "./ingest/case.mjs", "./tokens.mjs"]);
  assert.ok(!src.includes("hmacHex("), "the case identity is plain sha256 over redacted bytes, no key involved");
});

test("caseSha256: sha256 over the redacted text, equal to ingest case's import_sha256 for the same bytes; the raw secret never survives", () => {
  const { case_sha256, redacted } = caseSha256(FIXTURE);
  assert.match(case_sha256, /^[0-9a-f]{64}$/);
  assert.equal(case_sha256, prepareImport(Buffer.alloc(32, 7), FIXTURE, { kind: "case" }).import_sha256, "one identity for an admission, a case packet subject and a case import");
  assert.ok(!redacted.includes("Test1234!") || !redacted.includes("password=`Test1234!`"), "the password assignment is redacted");
  assert.ok(redacted.includes("<REDACTED:"), "the fixture carries a redaction hit");
  assert.notEqual(case_sha256, sha256Hex(FIXTURE), "not the raw bytes' hash (G-2)");
  assert.throws(() => caseSha256("text"), TypeError);
});

test("parseSteps: the Steps table rows with their `#` numbers, the frontmatter account or `unknown`; structural failures are SCHEMA-INVALID(case: …)", () => {
  const parsed = parseSteps(caseText([["Navigate to `{{base_url}}/login`", "Login page loads"], ["Inspect the response headers", "CSP present"]]));
  assert.equal(parsed.case.id, "TC-001");
  assert.equal(parsed.account, "unknown", "never blank (spec §9.2)");
  assert.deepEqual(parsed.steps, [
    { step: 1, action: "Navigate to `{{base_url}}/login`", expected: "Login page loads" },
    { step: 2, action: "Inspect the response headers", expected: "CSP present" },
  ]);
  assert.equal(parseSteps(caseText([["Open `{{base_url}}`", "ok"]], { frontmatterExtra: "account: qa-viewer\n" })).account, "qa-viewer");
  // a `#` cell that is not a positive integer falls back to the row ordinal
  const odd = parseSteps("---\nid: TC-002\n---\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n| a | Open `{{base_url}}` | ok |\n| 7 | Reload the page | ok |\n");
  assert.deepEqual(odd.steps.map((s) => s.step), [1, 7]);
  const fixture = parseSteps(caseSha256(FIXTURE).redacted);
  assert.equal(fixture.steps.length, 5);
  assert.equal(fixture.case.id, "TC-SEC-001");
  for (const [text, reason] of [
    [`---\nid: TC-003\n---\n\n# no steps\n`, /Steps table is missing or empty/],
    [`---\nid: TC-003\n---\n\n## Steps\n\n| # | Action | Expected Result |\n|---|---|---|\n`, /Steps table is missing or empty/],
    [`---\nid: TC-003\n---\n\n## Steps\n\n| # | Do | Expected Result |\n|---|---|---|\n| 1 | Open | ok |\n`, /no Action column/],
    [`# no frontmatter\n`, /no frontmatter/],
    [`---\nid: nope\n---\n\n## Steps\n`, /not a TC id/],
  ]) {
    assert.throws(
      () => parseSteps(text),
      (err) => err instanceof CliError && err.code === 2 && /^SCHEMA-INVALID\(case: /.test(err.token) && reason.test(err.token),
      `SCHEMA-INVALID for ${JSON.stringify(text.slice(0, 30))}`,
    );
  }
});

test("lintSteps: the fixture's five passive steps produce no hit; the grammar is verb-anchored after leading markup", () => {
  const { steps } = parseSteps(caseSha256(FIXTURE).redacted);
  assert.deepEqual(lintSteps(steps, { browser: BROWSER }), []);
  assert.deepEqual(lintSteps([{ step: 1, action: "**Navigate** to `{{base_url}}/`" }, { step: 2, action: "> Reload the page" }], { browser: BROWSER }), []);
  assert.ok(ALLOWED_OPERATIONS.every((o) => typeof o.name === "string" && o.re instanceof RegExp));
  assert.ok(FORBIDDEN_PATTERNS.every((f) => LINT_RULES.includes(f.rule) && f.re instanceof RegExp));
  assert.throws(() => lintSteps([{ step: 1, action: "x" }], {}), TypeError);
  assert.throws(() => lintSteps([{ step: -1, action: "x" }], { browser: [] }), TypeError);
});

test("lintSteps: an unknown effect is an `unknown-operation` hit (US-034 AC-2); a payload, a mutating verb, tooling, volume and a foreign host are forbidden hits (AC-3); hits carry the Action cell as linted", () => {
  const hits = lintSteps(
    [
      { step: 1, action: "Fill the Email field with `test@example.com`" },
      { step: 2, action: "Navigate to `{{base_url}}/search?q=<script>alert(1)</script>`" },
      { step: 3, action: "Submit the login form" },
      { step: 4, action: "Run `sqlmap -u {{base_url}}/login`" },
      { step: 5, action: "Reload the page 500 times" },
      { step: 6, action: "Open https://evil.example.net/probe" },
      { step: 7, action: "Open https://STAGING.example.com:443/x and http://localhost:3000/y" }, // both hosts allowed (case-folded, default port dropped)
      { step: 8, action: `Navigate to ${BASE_URL_PLACEHOLDER}/login?next=../../etc/passwd` },
    ],
    { browser: BROWSER },
  );
  assert.deepEqual(
    hits.map((h) => [h.step, h.rule]),
    [
      [1, "unknown-operation"],
      [2, "injection-payload"],
      [3, "mutating-verb"],
      [4, "mutating-verb"],
      [4, "tooling"],
      [5, "volume"],
      [6, "host-not-allowed"],
      [8, "injection-payload"],
    ],
  );
  assert.equal(hits[1].text_redacted, "Navigate to `{{base_url}}/search?q=<script>alert(1)</script>`");
  assert.ok(hits.every((h) => LINT_RULES.includes(h.rule)));
  assert.equal(hostOf("https://User:pw@Staging.Example.com:8443/a?b#c"), "staging.example.com:8443");
  assert.equal(hostOf("{{base_url}}/x"), null);
  assert.equal(hostOf("ftp://x"), null);
});

test("classify: the spec §9.1 table — zero hits ⇒ admitted-heuristic; any hit ⇒ proposal; a confirmed review admits past unknown-operation only; refuted/indeterminate ⇒ proposal with a review-not-confirmed hit at step 0 (AC-4, P5)", () => {
  const unknown = [{ rule: "unknown-operation", step: 1, text_redacted: "Fill x" }];
  const payload = [{ rule: "injection-payload", step: 2, text_redacted: "Open <script>" }];
  assert.deepEqual(classify([], null), { classification: "admitted-heuristic", lint_hits: [] });
  assert.deepEqual(classify(unknown, null), { classification: "proposal", lint_hits: unknown });
  assert.deepEqual(classify([], REVIEW_CONFIRMED), { classification: "admitted-reviewed", lint_hits: [] });
  assert.deepEqual(classify(unknown, REVIEW_CONFIRMED), { classification: "admitted-reviewed", lint_hits: unknown }, "the review admits what the grammar did not know; the hit stays on record");
  assert.deepEqual(classify(payload, REVIEW_CONFIRMED), { classification: "proposal", lint_hits: payload }, "a forbidden hit is not reviewable away");
  for (const state of [REVIEW_REFUTED, REVIEW_INDETERMINATE]) {
    const r = classify([], state);
    assert.equal(r.classification, "proposal");
    assert.deepEqual(r.lint_hits, [{ rule: "review-not-confirmed", step: 0, text_redacted: `vulnerability-review: ${state}` }]);
  }
  assert.deepEqual(REVIEWABLE_RULES, ["unknown-operation"]);
  assert.deepEqual(CLASSIFICATIONS, ["admitted-heuristic", "admitted-reviewed", "proposal"]);
  assert.throws(() => classify([{ rule: "nope", step: 1, text_redacted: "" }], null), TypeError);
  assert.throws(() => classify([], "CONFIRMED"), TypeError);
  // every classification × hit shape validates against admission.schema.json once the sha fields are filled
  for (const [hits, review] of [[[], null], [unknown, null], [unknown, REVIEW_CONFIRMED], [payload, REVIEW_REFUTED]]) {
    const { classification, lint_hits } = classify(hits, review);
    const payloadOut = { case_sha256: "a".repeat(64), lint_hits, assumptions: { base_url_host: "staging.example.com", account: "unknown" }, target_policy_sha256: "b".repeat(64), classification };
    if (classification === "admitted-reviewed") payloadOut.receipt_sha256 = "c".repeat(64);
    assert.deepEqual(validate("admission", payloadOut), [], `${classification} validates`);
  }
  assert.ok(SCHEMA.$defs.LintHit.properties.step.minimum === 0, "step 0 is the header ordinal the review-not-confirmed hit uses");
});

test("targetPolicy / targetPolicySha256: {targets, base_url?} of the engagement record, plain sha256 over canonical bytes, never mutating the record", () => {
  const record = { engagement_id: "e", targets: { tracker: ["github.com"], browser: BROWSER, repo: "o/r" }, base_url: "https://staging.example.com" };
  const policy = targetPolicy(record);
  assert.deepEqual(policy, { targets: record.targets, base_url: record.base_url });
  policy.targets.browser.push("x");
  assert.deepEqual(record.targets.browser, BROWSER, "a copy, not the record");
  assert.equal(targetPolicySha256(record), sha256Hex(canonical({ targets: record.targets, base_url: record.base_url })));
  assert.deepEqual(targetPolicy({ targets: record.targets }), { targets: record.targets }, "base_url absent ⇒ key absent");
  assert.throws(() => targetPolicy({}), TypeError);
});
