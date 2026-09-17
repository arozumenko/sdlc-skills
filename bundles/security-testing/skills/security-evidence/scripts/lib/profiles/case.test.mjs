// TASK-043 — the `case` publication profile (plan §5 TASK-043; spec §9.2
// "Admitted cases are written to a dedicated suite … Format verbatim per
// manual-qa; priority map p0→critical … p3→low; header/cookie checks via the
// audit branch", D7, §2 "Only admitted cases are written to the hand-off
// suite"; US-035 AC-1, AC-2; US-038 AC-3). Pure: the source is built in
// memory here; the command-level tests live in cmd-publish.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { caseText, PASSIVE_ROWS } from "../../fixtures/plan/helpers.mjs";
import { caseSha256, parseSteps } from "../admission-core.mjs";
import { parseTestCase } from "../ingest/case.mjs";
import { AUDIT_HEADERS, CaseRefused, PRIORITY_MAP, PROFILE, PROFILE_VERSION, apply, auditForm, isAuditStep, suiteDir, suiteFile } from "./case.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(HERE, "..", "..", "fixtures", "qa", "TC-SEC-001.md"));

const admission = (case_sha256, classification, receipt) => ({ envelope: { kind: "admission", run_id: "a".repeat(12) + "-0001" }, payload: { case_sha256, classification, lint_hits: [], assumptions: { base_url_host: "staging.example.com", account: "unknown" }, target_policy_sha256: "b".repeat(64), ...(receipt ? { receipt_sha256: receipt } : {}) } });
const candidate = (name, text) => ({ relpath: `my-product/${name}`, name, ...caseSha256(Buffer.from(text, "utf8")) });
const source = (cases, admissions, slug = "my-product") => Object.freeze({ run_id: "a".repeat(12) + "-0001", engagement: { payload: { slug, base_url: "https://staging.example.com" } }, admissions, cases });

const HEADER_ROWS = Object.freeze([
  ["Navigate to `{{base_url}}/login`", "Login page loads, Email and Password visible"],
  ["Open the browser network panel and reload the page", "The document response for `/login` is listed"],
  ["Inspect the response headers of the `/login` document", "`Content-Security-Policy` is present and does not contain `unsafe-inline`"],
  ["Inspect the response headers of the `/login` document", "`Strict-Transport-Security` is present with `max-age` of at least 31536000"],
  ["Inspect the `Set-Cookie` headers of the `/login` document", "Every cookie carries `Secure` and `HttpOnly`"],
]);
const PLAIN_ROWS = Object.freeze([
  ["Navigate to `{{base_url}}/`", "The home page loads"],
  ["Inspect the page footer", "No framework version string is shown"],
]);

test("registry shape and the priority map (spec §9.2): p0→critical … p3→low; the manual-qa vocabulary passes through; suite dir and file names", () => {
  assert.equal(PROFILE, "case");
  assert.ok(Number.isInteger(PROFILE_VERSION) && PROFILE_VERSION >= 1);
  assert.deepEqual(PRIORITY_MAP, { p0: "critical", p1: "high", p2: "medium", p3: "low" });
  assert.equal(suiteDir("my-product"), "tasks/security-my-product-admitted");
  assert.throws(() => suiteDir("My Product"), TypeError);
  assert.equal(suiteFile("TC-001", "login-headers"), "TC-001_login-headers.md");
});

test("three admitted + one proposal ⇒ exactly three TC files and nothing else (US-035 AC-1); every output parses as a manual-qa TC; ids are the candidates'", () => {
  const a = candidate("TC-001_login-headers.md", caseText("TC-001", HEADER_ROWS));
  const b = candidate("TC-002_home-footer.md", caseText("TC-002", PLAIN_ROWS, { title: "Verify the footer hides versions" }));
  const c = candidate("TC-003_p1-mapped.md", caseText("TC-003", PLAIN_ROWS, { title: "Verify a p1 case maps to high" }).replace("priority: high", "priority: p1"));
  const d = candidate("TC-004_proposal.md", caseText("TC-004", [["Submit the login form", "Redirect"]], { title: "Submit login" }));
  const admissions = [admission(a.case_sha256, "admitted-heuristic"), admission(b.case_sha256, "admitted-reviewed", "c".repeat(64)), admission(c.case_sha256, "admitted-heuristic"), admission(d.case_sha256, "proposal")];
  const outputs = apply(source([d, c, b, a], admissions), null, {});
  assert.deepEqual(
    outputs.map((o) => o.relpath),
    ["TC-001_login-headers.md", "TC-002_home-footer.md", "TC-003_p1-mapped.md"],
  );
  for (const o of outputs) {
    assert.ok(Buffer.isBuffer(o.bytes));
    const tc = parseTestCase(o.bytes.toString("utf8"));
    assert.match(tc.id, /^TC-[0-9]{3}$/);
    assert.ok(tc.tags.includes("security"), `${o.relpath}: tags carry security`);
    assert.ok(["critical", "high", "medium", "low"].includes(tc.priority), `${o.relpath}: manual-qa priority`);
  }
  assert.equal(parseTestCase(outputs[2].bytes.toString("utf8")).priority, "high", "p1 → high");
  assert.equal(parseTestCase(outputs[1].bytes.toString("utf8")).priority, "high", "an already-mapped priority is kept");
  const text = outputs.map((o) => o.bytes.toString("utf8")).join("\n");
  assert.ok(!text.includes("Submit the login form") && !text.includes("proposal"), "no proposal path or text (US-038 AC-3)");
  // deterministic: same source ⇒ same bytes, whatever the candidate order
  const again = apply(source([a, b, c, d], admissions), null, {});
  assert.deepEqual(again.map((o) => o.bytes.toString("utf8")), outputs.map((o) => o.bytes.toString("utf8")));
  assert.deepEqual(apply(source([d], [admissions[3]]), null, {}), [], "no admitted case ⇒ empty set");
});

test("a plain (non header/cookie) case is the candidate verbatim below the frontmatter; the frontmatter keeps every key, maps priority and adds the security tag", () => {
  const rows = PLAIN_ROWS;
  const text = caseText("TC-002", rows, { title: "Verify the footer hides versions", extra: "account: unauthenticated" }).replace("priority: high", "priority: p2").replace("tags: [security, passive]", "tags: [passive]");
  const cand = candidate("TC-002_home-footer.md", text);
  const [out] = apply(source([cand], [admission(cand.case_sha256, "admitted-heuristic")]), null, {});
  const published = out.bytes.toString("utf8");
  const bodyOf = (t) => t.slice(t.indexOf("\n---\n") + 5);
  assert.equal(bodyOf(published), bodyOf(text), "the body is verbatim");
  const fm = published.slice(0, published.indexOf("\n---\n"));
  assert.match(fm, /^priority: medium$/m);
  assert.match(fm, /^tags: \[passive, security\]$/m);
  assert.match(fm, /^account: unauthenticated$/m);
  assert.match(fm, /^id: TC-002$/m);
  assert.doesNotMatch(published, /^tags: \[security, passive\]$/m);
  // a case without tags gains one
  const noTags = candidate("TC-005_no-tags.md", caseText("TC-005", rows, { title: "No tags" }).replace("tags: [security, passive]\n", ""));
  const [nt] = apply(source([noTags], [admission(noTags.case_sha256, "admitted-heuristic")]), null, {});
  assert.match(nt.bytes.toString("utf8"), /^tags: \[security\]\n---/m);
  assert.deepEqual(parseSteps(nt.bytes.toString("utf8")).steps.map((s) => s.action), rows.map((r) => r[0]));
});

test("a header/cookie case is emitted in the audit-step form: open URL, collect the network requests, inspect one header per row — and contains no browser-action step (US-035 AC-2 audit branch)", () => {
  const cand = candidate("TC-001_login-headers.md", caseText("TC-001", HEADER_ROWS));
  const [out] = apply(source([cand], [admission(cand.case_sha256, "admitted-heuristic")]), null, {});
  const published = out.bytes.toString("utf8");
  const { steps } = parseSteps(published);
  assert.deepEqual(steps.map((s) => s.step), [1, 2, 3, 4, 5], "renumbered");
  assert.deepEqual(
    steps.map((s) => s.action),
    [
      "Navigate to `{{base_url}}/login`",
      "Collect the network requests of the page (`browser_network_requests()`)",
      "Inspect the `Content-Security-Policy` response header of the `/login` document",
      "Inspect the `Strict-Transport-Security` response header of the `/login` document",
      "Inspect the `Set-Cookie` response headers of the `/login` document",
    ],
  );
  assert.equal(steps[0].expected, "Login page loads, Email and Password visible", "the candidate's own expectation is kept");
  assert.equal(steps[1].expected, "The document response for `/login` is listed with its response headers");
  assert.equal(steps[2].expected, "`Content-Security-Policy` is present and does not contain `unsafe-inline`", "the candidate's expected result is verbatim");
  assert.equal(steps[4].expected, "Every cookie carries `Secure` and `HttpOnly`");
  for (const s of steps) {
    assert.doesNotMatch(s.action, /reload|panel|click|fill|type|submit|press|scroll|hover/i, `no browser action: ${s.action}`);
    assert.match(s.action, /^(Navigate to|Collect the network requests|Inspect the )/);
  }
  // everything around the Steps table is verbatim
  assert.match(published, /## Preconditions\n- App is accessible at `\{\{base_url\}\}`\n/);
  assert.match(published, /## Expected Final State\nUnauthenticated, still on the page\.\n/);
  assert.match(published, /## Teardown\n- _\(nothing to clean up\)_\n$/);
  // the manual-qa fixture (TASK-018's verbatim copy) takes the same form, redacted
  const fixture = { relpath: "my-product/TC-SEC-001.md", name: "TC-SEC-001.md", ...caseSha256(FIXTURE) };
  const form = auditForm(parseSteps(fixture.redacted).steps);
  assert.equal(form.length, 5);
  assert.ok(form.every((r) => /^(Navigate to|Collect the network requests|Inspect the )/.test(r.action)));
});

test("isAuditStep / AUDIT_HEADERS: the manual-qa security-header table plus Set-Cookie flags; a step naming none is not an audit step", () => {
  assert.deepEqual(AUDIT_HEADERS, ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security", "Referrer-Policy", "Permissions-Policy", "Set-Cookie"]);
  assert.deepEqual(isAuditStep({ action: "Inspect the response headers", expected: "`X-Frame-Options` is DENY" }), ["X-Frame-Options"]);
  assert.deepEqual(isAuditStep({ action: "Inspect the cookies of the response", expected: "Every cookie carries `Secure`" }), ["Set-Cookie"]);
  assert.deepEqual(isAuditStep({ action: "inspect the CONTENT-SECURITY-POLICY and x-frame-options headers", expected: "both present" }), ["Content-Security-Policy", "X-Frame-Options"]);
  assert.deepEqual(isAuditStep({ action: "Inspect the page footer", expected: "No version string" }), []);
  assert.deepEqual(isAuditStep({ action: "Inspect the Secure area link", expected: "It is visible" }), [], "a cookie flag word without a cookie is not a cookie check");
});

test("refusals are CaseRefused with a reason, never a silent rename: a non TC-NNN id, a file name that is not <id>_<slug>.md, an unknown priority, a header step before any Navigate step, an admitted identity without a candidate, two candidates with one identity", () => {
  const refused = (cases, admissions, re) => assert.throws(() => apply(source(cases, admissions), null, {}), (err) => err instanceof CaseRefused && re.test(err.message));
  const secId = candidate("TC-SEC-001.md", caseText("TC-SEC-001", PLAIN_ROWS));
  refused([secId], [admission(secId.case_sha256, "admitted-heuristic")], /id TC-SEC-001 is not TC-NNN/);
  const badName = candidate("headers.md", caseText("TC-001", PLAIN_ROWS));
  refused([badName], [admission(badName.case_sha256, "admitted-heuristic")], /file name headers\.md is not TC-001_<slug>\.md/);
  const badPriority = candidate("TC-001_x.md", caseText("TC-001", PLAIN_ROWS).replace("priority: high", "priority: urgent"));
  refused([badPriority], [admission(badPriority.case_sha256, "admitted-heuristic")], /priority urgent/);
  const noNav = candidate("TC-001_x.md", caseText("TC-001", [["Inspect the response headers", "`X-Frame-Options` is DENY"]]));
  refused([noNav], [admission(noNav.case_sha256, "admitted-heuristic")], /before any Navigate step/);
  refused([], [admission("d".repeat(64), "admitted-heuristic")], /no candidate under/);
  const dup = candidate("TC-001_x.md", caseText("TC-001", PLAIN_ROWS));
  refused([dup, { ...dup, relpath: "other/TC-001_x.md" }], [admission(dup.case_sha256, "admitted-heuristic")], /two candidates/);
  assert.throws(() => apply(source([], []), null, { slug: "Bad Slug" }), TypeError);
});

test("G-9: case.mjs imports no fs, child_process, git or clock", () => {
  const src = readFileSync(join(HERE, "case.mjs"), "utf8");
  assert.doesNotMatch(src, /from "node:(fs|child_process|net|http|https|dns)"/);
  assert.doesNotMatch(src, /from "\.\.\/git\.mjs"/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/);
});
