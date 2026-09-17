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
import { AUDIT_HEADERS, AUDIT_STEPS, CaseRefused, PRIORITY_MAP, PROFILE, PROFILE_VERSION, apply, auditForm, isAuditStep, suiteDir, suiteFile } from "./case.mjs";

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
  // review 1: tags are read as manual-qa reads them — a quoted item with a comma stays one item; `security` is
  // appended to the original text (a line that already carries it is verbatim); a bare scalar and an empty list work
  const tagsLine = (t) => {
    const c = candidate("TC-006_tags.md", caseText("TC-006", rows, { title: "Tags" }).replace("tags: [security, passive]", t));
    const [o] = apply(source([c], [admission(c.case_sha256, "admitted-heuristic")]), null, {});
    const text = o.bytes.toString("utf8");
    return { line: /^tags:.*$/m.exec(text)[0], tags: parseTestCase(text).tags };
  };
  assert.deepEqual(tagsLine('tags: ["a, b", passive]'), { line: 'tags: ["a, b", passive, security]', tags: ["a, b", "passive", "security"] });
  assert.deepEqual(tagsLine('tags: ["a, b", security]'), { line: 'tags: ["a, b", security]', tags: ["a, b", "security"] });
  assert.deepEqual(tagsLine("tags: [security, passive]"), { line: "tags: [security, passive]", tags: ["security", "passive"] });
  assert.deepEqual(tagsLine("tags: [passive] # keep"), { line: "tags: [passive, security] # keep", tags: ["passive", "security"] });
  assert.deepEqual(tagsLine("tags: passive # keep"), { line: "tags: [passive, security]", tags: ["passive", "security"] });
  assert.deepEqual(tagsLine("tags: []"), { line: "tags: [security]", tags: ["security"] });
  assert.deepEqual(tagsLine("tags:"), { line: "tags: [security]", tags: ["security"] });
});

test("a sized candidate publishes with `size:` verbatim and in place (final-review I-3): the admitted suite ships sized, so test-run-lead never edits a suite file", () => {
  // the planning skill's template carries `size: M` between tags and account; the profile rewrites only priority/tags
  const text = caseText("TC-007", PLAIN_ROWS, { title: "Sized case", extra: "size: M\naccount: unauthenticated" }).replace("priority: high", "priority: p1");
  const cand = candidate("TC-007_sized.md", text);
  const [out] = apply(source([cand], [admission(cand.case_sha256, "admitted-heuristic")]), null, {});
  const published = out.bytes.toString("utf8");
  const fm = published.slice(0, published.indexOf("\n---\n"));
  assert.match(fm, /^size: M$/m, "size: survives publish verbatim");
  assert.deepEqual(
    fm.split("\n").slice(1).map((l) => l.split(":")[0]),
    ["id", "title", "priority", "type", "module", "requirements", "tags", "size", "account"],
    "every frontmatter key is kept, in the candidate's order",
  );
  assert.equal(parseTestCase(published).size, "M", "the manual-qa reader sees the size");
  assert.equal(parseTestCase(published).priority, "high");
  // an unsized candidate publishes unsized: the profile never invents a size (that would be test-sizer's word)
  const unsized = candidate("TC-008_unsized.md", caseText("TC-008", PLAIN_ROWS, { title: "Unsized case" }));
  const [u] = apply(source([unsized], [admission(unsized.case_sha256, "admitted-heuristic")]), null, {});
  assert.doesNotMatch(u.bytes.toString("utf8"), /^size:/m);
  assert.equal(parseTestCase(u.bytes.toString("utf8")).size, null);
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

test("review 1: a CRLF candidate (Windows checkout, admit accepts it) publishes as the LF twin with \\n→\\r\\n — priority mapped, one tags line, audit rows only", () => {
  const lfText = caseText("TC-001", HEADER_ROWS).replace("priority: high", "priority: p1");
  const crlfText = lfText.replace(/\n/g, "\r\n");
  assert.ok(crlfText.includes("\r\n") && !lfText.includes("\r"));
  const lf = candidate("TC-001_login-headers.md", lfText);
  const crlf = candidate("TC-001_login-headers.md", crlfText);
  assert.notEqual(lf.case_sha256, crlf.case_sha256, "distinct identities (the redacted bytes differ)");
  const [lfOut] = apply(source([lf], [admission(lf.case_sha256, "admitted-heuristic")]), null, {});
  const [crlfOut] = apply(source([crlf], [admission(crlf.case_sha256, "admitted-heuristic")]), null, {});
  assert.equal(crlfOut.relpath, lfOut.relpath);
  assert.equal(crlfOut.bytes.toString("utf8"), lfOut.bytes.toString("utf8").replace(/\n/g, "\r\n"), "CRLF output === LF output re-expanded");
  const published = crlfOut.bytes.toString("utf8");
  assert.ok(!/[^\r]\n/.test(published) && !/^\n/.test(published), "uniform CRLF: every \\n is preceded by \\r");
  const tc = parseTestCase(published);
  assert.equal(tc.priority, "high", "p1 → high");
  assert.deepEqual(tc.tags, ["security", "passive"], "the original tags line, once — no second `tags: [security]` spliced in");
  assert.equal((published.match(/^tags:/gm) ?? []).length, 1);
  assert.deepEqual(
    parseSteps(published).steps.map((s) => s.action),
    [
      "Navigate to `{{base_url}}/login`",
      "Collect the network requests of the page (`browser_network_requests()`)",
      "Inspect the `Content-Security-Policy` response header of the `/login` document",
      "Inspect the `Strict-Transport-Security` response header of the `/login` document",
      "Inspect the `Set-Cookie` response headers of the `/login` document",
    ],
    "the audit rows only — the reload/panel step is gone, the original table is not left in place",
  );
  assert.doesNotMatch(published, /network panel and reload/);
  // a mixed-ending file becomes uniform CRLF
  const mixed = candidate("TC-002_home-footer.md", caseText("TC-002", PLAIN_ROWS, { title: "Mixed endings" }).replace("\ntype:", "\r\ntype:"));
  const [mx] = apply(source([mixed], [admission(mixed.case_sha256, "admitted-heuristic")]), null, {});
  const mxText = mx.bytes.toString("utf8");
  assert.ok(!/[^\r]\n/.test(mxText), "uniform CRLF");
  assert.equal(parseTestCase(mxText).id, "TC-002");
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

test("TASK-043-FU: a literal absolute URL in a Navigate step keeps its path (audit-branch.md: `/login` for a literal on an allowed host) — the host class excludes `/` and is not lazy; a bare host is `/`", () => {
  const paths = (action) => auditForm([{ step: 1, action, expected: "Loads" }, { step: 2, action: "Inspect the response headers", expected: "`X-Frame-Options` is DENY" }]).map((r) => r.action);
  assert.equal(paths("Navigate to https://staging.example.com/login")[2], AUDIT_STEPS.header("X-Frame-Options", "/login"));
  assert.equal(paths("Navigate to `https://staging.example.com/a/b?x=1`")[2], AUDIT_STEPS.header("X-Frame-Options", "/a/b?x=1"));
  assert.equal(paths("Navigate to https://staging.example.com")[2], AUDIT_STEPS.header("X-Frame-Options", "/"));
  assert.equal(paths("Navigate to `{{base_url}}/login`")[2], AUDIT_STEPS.header("X-Frame-Options", "/login"), "the placeholder form is unchanged");
  assert.equal(paths("Open http://localhost:3000/health and wait")[2], AUDIT_STEPS.header("X-Frame-Options", "/health"), "a port stays in the host, the path is captured up to whitespace");
  assert.equal(paths("Navigate to https://staging.example.com/login")[1], AUDIT_STEPS.collect);
  // the collection row names the same path
  const rows = auditForm([{ step: 1, action: "Navigate to https://staging.example.com/login", expected: "Loads" }]);
  assert.equal(rows[1].expected, AUDIT_STEPS.collected("/login"));
});

test("TASK-043-FU: the priority lookup is an own-property read — `priority: constructor` (toString, valueOf, hasOwnProperty) is refused with the existing token, never published as a native function", () => {
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const cand = candidate("TC-001_x.md", caseText("TC-001", PLAIN_ROWS).replace("priority: high", `priority: ${key}`));
    assert.throws(() => apply(source([cand], [admission(cand.case_sha256, "admitted-heuristic")]), null, {}), (err) => err instanceof CaseRefused && new RegExp(`priority ${key} is neither p0…p3 nor critical\\|high\\|medium\\|low`).test(err.message), key);
  }
  // the vocabulary itself still maps and passes through, case-insensitively
  const p3 = candidate("TC-001_x.md", caseText("TC-001", PLAIN_ROWS).replace("priority: high", "priority: P3"));
  assert.match(apply(source([p3], [admission(p3.case_sha256, "admitted-heuristic")]), null, {})[0].bytes.toString("utf8"), /^priority: low$/m);
  const low = candidate("TC-001_x.md", caseText("TC-001", PLAIN_ROWS).replace("priority: high", "priority: Low"));
  assert.match(apply(source([low], [admission(low.case_sha256, "admitted-heuristic")]), null, {})[0].bytes.toString("utf8"), /^priority: low$/m);
});

test("TASK-043-FU: case.mjs declares no slug regex of its own — SLUG is the registry's one export (lib/profiles/index.mjs)", () => {
  const src = readFileSync(join(HERE, "case.mjs"), "utf8");
  assert.doesNotMatch(src, /^const SLUG = /m, "the naming inversion lives in index.mjs");
  assert.match(src, /import \{[^}]*\bSLUG\b[^}]*\} from "\.\/index\.mjs"/);
});

test("G-9: case.mjs imports no fs, child_process, git or clock", () => {
  const src = readFileSync(join(HERE, "case.mjs"), "utf8");
  assert.doesNotMatch(src, /from "node:(fs|child_process|net|http|https|dns)"/);
  assert.doesNotMatch(src, /from "\.\.\/git\.mjs"/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/);
});
