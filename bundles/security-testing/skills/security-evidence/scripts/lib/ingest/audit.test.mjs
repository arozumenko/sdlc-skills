// TASK-018 — lib/ingest/audit.mjs: `ingest audit` over a qa-auditor report
// (spec §6.6 row `audit`: structural validation = the report Markdown + its
// JSON block; trusted = finding titles and URLs whose host ∈ targets.browser;
// inert = evidence text). US-012 AC-2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redactString } from "../../redact.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_VERSION, PRIORITIES, SPECIALISTS, adapt, parseAuditReport } from "./audit.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: "reports/audit-staging.example.com-2026-09-15.md" };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const ctxWith = (browser) => ({ engagement: () => ({ targets: { tracker: ["github.com"], browser, repo: "x/y" } }) });
const FIXTURE = readFileSync(new URL("../../fixtures/qa/audit-report.md", import.meta.url), "utf8");
const redacted = redactString(FIXTURE).text;

test("the shipped fixture ⇒ an audit record then one record per JSON-block finding; titles, priority, confidence and allowed URLs trusted; reasoning/evidence/fix text inert", () => {
  const out = adapt(ctxWith(["staging.example.com"]), run, null, redacted, base);
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.equal(MAPPING_VERSION, "v1");
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 4);
  const [head, f0, f1, f2] = out.records;
  assert.deepEqual(head.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(head.trusted, {
    record: "audit",
    target: "https://staging.example.com",
    date: "2026-09-15",
    pages_audited: ["https://staging.example.com/", "https://staging.example.com/login"],
    specialists_run: ["security", "privacy", "accessibility", "content-seo", "performance"],
    findings: 3,
    findings_source: "json",
  });
  assert.deepEqual(head.inert, {});

  assert.deepEqual(f0.locator, { import_sha256: SHA, original_hmac: HMAC, index: 1 });
  assert.deepEqual(f0.trusted, { record: "finding", title: "Session cookie is set without HttpOnly", priority: "p0", confidence: 9, urls: ["https://staging.example.com/login"] });
  assert.deepEqual(Object.keys(f0.inert).sort(), ["evidence", "fix_prompt", "reasoning", "specialist", "suggested_fix", "types"]);
  for (const v of Object.values(f0.inert)) assert.match(v, /^\[UNTRUSTED CONTENT/);
  assert.ok(f0.inert.evidence.includes("Set-Cookie: session=abc123"), "evidence is quoted, never acted on");
  assert.deepEqual(f1.trusted.urls, ["https://staging.example.com/", "https://staging.example.com/login"]);
  assert.deepEqual(f2.trusted, { record: "finding", title: "Login form fields have no programmatic labels", priority: "p2", confidence: 7, urls: ["https://staging.example.com/login"] });
  const payload = { kind: "audit", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("a URL whose host is not in targets.browser is untrusted: dropped from trusted.urls / pages_audited / target and quoted inert instead (US-012 AC-2)", () => {
  const out = adapt(ctxWith(["other.example.org"]), run, null, redacted, base);
  const [head, f0] = out.records;
  assert.equal(head.trusted.target, null);
  assert.deepEqual(head.trusted.pages_audited, []);
  assert.deepEqual(Object.keys(head.inert).sort(), ["target", "untrusted_pages"]);
  assert.ok(head.inert.untrusted_pages.includes("https://staging.example.com/login"));
  assert.deepEqual(f0.trusted.urls, []);
  assert.ok(f0.inert.untrusted_urls.includes("https://staging.example.com/login"));

  // a mixed list: only the allowed host survives into trusted
  const mixed = redacted.replace('"affected_pages": ["https://staging.example.com/", "https://staging.example.com/login"]', '"affected_pages": ["https://staging.example.com/", "https://evil.example.net/login", "javascript:alert(1)"]');
  const out2 = adapt(ctxWith(["staging.example.com"]), run, null, mixed, base);
  assert.deepEqual(out2.records[2].trusted.urls, ["https://staging.example.com/"]);
  assert.ok(out2.records[2].inert.untrusted_urls.includes("https://evil.example.net/login"));
  assert.ok(out2.records[2].inert.untrusted_urls.includes("javascript:alert(1)"));
});

test("without a JSON block the documented heading form is parsed: `#### [P0, confidence 9] title` + `**Affected pages:**` lines", () => {
  const cut = redacted.slice(0, redacted.indexOf("## Findings (JSON)"));
  const out = adapt(ctxWith(["staging.example.com"]), run, null, cut, base);
  assert.equal(out.records.length, 4);
  assert.equal(out.records[0].trusted.findings_source, "markdown");
  assert.deepEqual(out.records[1].trusted, { record: "finding", title: "Session cookie is set without HttpOnly", priority: "p0", confidence: 9, urls: ["https://staging.example.com/login"] });
  assert.deepEqual(out.records[2].trusted.urls, ["https://staging.example.com/", "https://staging.example.com/login"]);
  assert.deepEqual(Object.keys(out.records[1].inert).sort(), ["evidence", "fix_prompt", "reasoning", "specialist", "suggested_fix"]);
  assert.ok(out.records[1].inert.specialist.includes("Security & OWASP"));
  // the JSON block and the headings describe the same findings in the fixture
  const viaJson = adapt(ctxWith(["staging.example.com"]), run, null, redacted, base);
  assert.deepEqual(out.records.slice(1).map((r) => r.trusted), viaJson.records.slice(1).map((r) => r.trusted));
});

test("the findings block is the fence under `## Findings (JSON)`, not the first json fence: an Evidence line quoting a JSON body in its own fence is prose; without the heading the last array fence wins", () => {
  const ctx = ctxWith(["staging.example.com"]);
  const evidenceFence = "**Evidence:**\n\n```json\n{\"error\": \"session cookie lacks HttpOnly\"}\n```\n";
  const withQuote = redacted.replace("**Suggested fix:** Add the `HttpOnly`", `${evidenceFence}\n**Suggested fix:** Add the \`HttpOnly\``);
  assert.ok(withQuote !== redacted, "the fixture line the probe rewrites is present");
  const out = adapt(ctx, run, null, withQuote, base);
  assert.equal(out.records[0].trusted.findings_source, "json");
  assert.equal(out.records.length, 4, "the findings come from the block under the heading, not the evidence fence");
  // no `## Findings (JSON)` heading: the last json fence is used when it is an array …
  const noHeading = withQuote.replace("## Findings (JSON)", "## Machine-readable");
  assert.equal(adapt(ctx, run, null, noHeading, base).records[0].trusted.findings_source, "json");
  // … and an evidence fence that is not an array falls back to the heading form instead of failing the import
  const onlyEvidence = withQuote.slice(0, withQuote.indexOf("## Findings (JSON)"));
  const md = adapt(ctx, run, null, onlyEvidence, base);
  assert.equal(md.records[0].trusted.findings_source, "markdown");
  assert.equal(md.records.length, 4);
});

test("a JSON-block priority written `P0` is the same closed-vocabulary token as the heading form's `[P0, …]`", () => {
  const text = redacted.replace('"priority": "p0",', '"priority": "P0",');
  const out = adapt(ctxWith(["staging.example.com"]), run, null, text, base);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records[1].trusted.priority, "p0");
});

test("findings the block cannot vouch for are rejected, never dropped: no title, a priority outside p0–p3; a non-integer confidence is null", () => {
  const text = redacted
    .replace('"title": "Missing Content-Security-Policy header",', '"title": 42,')
    .replace('"priority": "p2",', '"priority": "urgent",')
    .replace('"confidence": 9,', '"confidence": "high",');
  const out = adapt(ctxWith(["staging.example.com"]), run, null, text, base);
  assert.deepEqual(out.records.map((r) => r.locator.index), [0, 1]);
  assert.equal(out.records[1].trusted.confidence, null);
  assert.deepEqual(out.rejected, [
    { reason: "no-title", locator: { import_sha256: SHA, index: 2 } },
    { reason: "bad-priority", locator: { import_sha256: SHA, index: 3 } },
  ]);
  assert.equal(out.records[0].trusted.findings, 3, "the header counts every finding, rejected or not");
});

test("structural failures ⇒ 2 SCHEMA-INVALID(audit: …): no frontmatter, no date, a JSON block that is not an array of objects, no findings section at all", () => {
  const ctx = ctxWith(["staging.example.com"]);
  const bad = (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(audit: /.test(e.token);
  assert.throws(() => adapt(ctx, run, null, "# Web Audit Report\n\n#### [P0, confidence 9] x\n", base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace("date: 2026-09-15", "date: yesterday"), base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace(/```json\n\[[\s\S]*\]\n```/, "```json\n{\"findings\": []}\n```"), base), bad);
  assert.throws(() => adapt(ctx, run, null, redacted.replace(/```json\n\[[\s\S]*\]\n```/, "```json\n[1, 2]\n```"), base), bad);
  assert.throws(() => adapt(ctx, run, null, "---\ntarget: https://staging.example.com\ndate: 2026-09-15\n---\n\n# Report\n\nNo findings anywhere.\n", base), bad);
  assert.throws(() => adapt(ctx, run, null, { not: "text" }, base), TypeError);
});

test("parseAuditReport exposes the closed vocabularies", () => {
  assert.deepEqual(PRIORITIES, ["p0", "p1", "p2", "p3"]);
  assert.deepEqual(SPECIALISTS, ["security", "privacy", "accessibility", "content-seo", "performance", "ux", "responsive"]);
  const p = parseAuditReport(FIXTURE);
  assert.equal(p.source, "json");
  assert.equal(p.findings.length, 3);
  assert.deepEqual(p.specialists_run, ["security", "privacy", "accessibility", "content-seo", "performance"]);
});

test("audit.mjs is a leaf: no fs, no child process, no git, no network (G-6, G-14)", () => {
  const src = readFileSync(new URL("./audit.mjs", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:http", "node:net", "node:dns", "git.mjs", "fetch("]) assert.ok(!src.includes(forbidden), forbidden);
});
