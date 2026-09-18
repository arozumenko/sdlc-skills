import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALLOWED_OPERATIONS, AdmissionError, BASE_URL_PLACEHOLDER, FORBIDDEN_PATTERNS, LINT_RULES, caseId, hostOf, lintCase, lintSteps, parseSteps } from "./admission.mjs";

const FIX = (name) => new URL(`../fixtures/cases/${name}`, import.meta.url).pathname;
const read = (name) => readFileSync(FIX(name), "utf8");
const BROWSER = ["staging.example.com"];
const brief = (hits) => hits.map(({ rule, step }) => ({ rule, step }));

/** A minimal case whose single step is `action`. */
const caseWith = (action, id = "TC-010") => `---\nid: ${id}\ntitle: t\n---\n\n# ${id}: t\n\n## Steps\n\n| # | Action | Expected Result |\n|---|--------|----------------|\n| 1 | ${action} | ok |\n`;

test("the three fixtures: passive ⇒ no hits; mutating verb at step 2; foreign host at step 1", () => {
  assert.deepEqual(brief(lintCase(read("TC-001_login-headers.md"), { browser: BROWSER }).hits), []);
  assert.deepEqual(brief(lintCase(read("TC-002_delete-account.md"), { browser: BROWSER }).hits), [{ rule: "mutating-verb", step: 2 }]);
  assert.deepEqual(brief(lintCase(read("TC-003_other-host.md"), { browser: BROWSER }).hits), [{ rule: "host-not-allowed", step: 1 }]);
});

test("lintCase returns the parsed steps and hits carry {rule, step, text}", () => {
  const { steps, hits } = lintCase(read("TC-002_delete-account.md"), { browser: BROWSER });
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.step), [1, 2, 3]);
  assert.equal(steps[0].action, "Navigate to `{{base_url}}/account/danger-zone`");
  assert.equal(steps[0].expected, "Danger zone page loads");
  assert.deepEqual(Object.keys(hits[0]).sort(), ["rule", "step", "text"]);
  assert.equal(hits[0].text, 'Delete the account using the "Delete account" button');
});

test("a compound clause after `then` is a mutating-verb hit", () => {
  const hits = lintCase(caseWith(`Navigate to ${BASE_URL_PLACEHOLDER}/login then submit the form`), { browser: BROWSER }).hits;
  assert.deepEqual(brief(hits), [{ rule: "mutating-verb", step: 1 }]);
});

test("a tool name anywhere in the action is a tooling hit (and the shell payload an injection-payload hit)", () => {
  const hits = lintCase(caseWith("Inspect the response; then run `rm -rf /`"), { browser: BROWSER }).hits;
  assert.ok(hits.some((h) => h.rule === "tooling" && h.step === 1), JSON.stringify(hits));
  assert.ok(hits.some((h) => h.rule === "mutating-verb" && h.step === 1), "`; then run` is a verb-anchored clause");
  const curl = lintCase(caseWith("Inspect the output of curl against the login page"), { browser: BROWSER }).hits;
  assert.deepEqual(brief(curl), [{ rule: "tooling", step: 1 }]);
});

test("an action no allowed operation accepts is an unknown-operation hit, full stop", () => {
  assert.deepEqual(brief(lintCase(caseWith("Fill the Email field with `x@example.com`"), { browser: BROWSER }).hits), [{ rule: "unknown-operation", step: 1 }]);
  assert.deepEqual(brief(lintCase(caseWith("**Navigate** to `{{base_url}}/`"), { browser: BROWSER }).hits), [], "leading emphasis is stripped");
});

test("volume words and injection payloads are hits; a hit-carrying step is never also unknown", () => {
  assert.deepEqual(brief(lintCase(caseWith("Reload the page 50 times"), { browser: BROWSER }).hits), [{ rule: "volume", step: 1 }]);
  const inj = lintCase(caseWith("Type <script>alert(1)</script> into the search box"), { browser: BROWSER }).hits;
  assert.deepEqual(brief(inj), [{ rule: "injection-payload", step: 1 }]);
});

test("lintSteps: the placeholder host is always fine; a literal allowed host is fine; a foreign one is not", () => {
  const steps = [
    { step: 1, action: "Navigate to {{base_url}}/x", expected: "" },
    { step: 2, action: "Navigate to https://STAGING.example.com:8443/y", expected: "" },
    { step: 3, action: "Navigate to http://localhost:3000/", expected: "" },
  ];
  assert.deepEqual(brief(lintSteps(steps, { browser: ["staging.example.com:8443"] })), [{ rule: "host-not-allowed", step: 3 }]);
  assert.throws(() => lintSteps(steps, {}), TypeError);
});

test("hostOf", () => {
  assert.equal(hostOf("https://user:pw@Staging.Example.com:8443/a?b#c"), "staging.example.com:8443");
  assert.equal(hostOf("ftp://x.example.com/"), null);
  assert.equal(hostOf("not a url"), null);
  assert.equal(hostOf(42), null);
});

test("parseSteps: the ## Steps table; step numbers from the # cell else the ordinal", () => {
  const { steps } = parseSteps("# t\n\n## Steps\n\n| Step | Action | Expected |\n|---|---|---|\n| 3 | Navigate to /a | ok |\n| x | Observe the page | ok |\n");
  assert.deepEqual(steps, [
    { step: 3, action: "Navigate to /a", expected: "ok" },
    { step: 2, action: "Observe the page", expected: "ok" },
  ]);
  const noExpected = parseSteps("## Steps\n| Action |\n|---|\n| Reload |\n").steps;
  assert.deepEqual(noExpected, [{ step: 1, action: "Reload", expected: "" }]);
  assert.throws(() => parseSteps("# t\n\nno steps\n"), (e) => e instanceof AdmissionError && /## Steps/.test(e.message));
  assert.throws(() => parseSteps("## Steps\n\n| # | Action | Expected |\n|---|---|---|\n"), AdmissionError, "empty table");
  assert.throws(() => parseSteps("## Steps\n\n| # | What | Expected |\n|---|---|---|\n| 1 | x | y |\n"), (e) => e instanceof AdmissionError && /Action column/.test(e.message));
});

test("caseId reads id: TC-NNN from the frontmatter, else null", () => {
  assert.equal(caseId(read("TC-001_login-headers.md")), "TC-001");
  assert.equal(caseId("---\nid: TC-1\n---\n"), null);
  assert.equal(caseId("---\ntitle: no id\n---\n"), null);
  assert.equal(caseId("# no frontmatter\n"), null);
  assert.equal(caseId("---\nid: \"TC-042\"\n---\n"), "TC-042");
});

test("vocabulary constants", () => {
  assert.deepEqual([...LINT_RULES], ["mutating-verb", "injection-payload", "tooling", "volume", "host-not-allowed", "unknown-operation"]);
  assert.deepEqual(FORBIDDEN_PATTERNS.map((p) => p.rule), ["mutating-verb", "injection-payload", "tooling", "volume"]);
  assert.deepEqual(ALLOWED_OPERATIONS.map((p) => p.name), ["navigate", "reload", "observe"]);
  assert.equal(BASE_URL_PLACEHOLDER, "{{base_url}}");
  assert.ok(Object.isFrozen(LINT_RULES) && Object.isFrozen(FORBIDDEN_PATTERNS));
});
