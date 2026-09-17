// TASK-023 — lib/render.mjs: the pure report renderer (plan §3.3 row
// `lib/render.mjs`, §5 TASK-023; spec §6.3 derivation table, §11, TL-7
// markers; US-016 AC-5/AC-6; G-9 pure core). Every input here is an
// in-memory artifact built the way the writers build them (redacted payload,
// identity over the canonical bytes); nothing touches git or the file system
// except reading the fixtures and the module source for the import guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactId, makeEnvelope, readArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { computeCoverage } from "./coverage-core.mjs";
import { findingId } from "./gate-core.mjs";
import { GENESIS_SHA256, eventSha256, replay, summarize } from "./register-fold.mjs";
import { InconsistentInput, buildView, keyIdsOf, marker, parseTemplate, renderMarkdown, sanitize } from "./render.mjs";
import { FORBIDDEN_STRINGS, NOT_ASSESSED, NOT_INDEPENDENTLY_REVIEWED, verdictLine } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "..", "templates");
const VERIFY_FIXTURES = join(HERE, "..", "fixtures", "verify");

// --- import guard (G-9) --------------------------------------------------------

test("pure: render.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "render.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `render.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith("./") || i.startsWith("../"), `only bundle modules: ${i}`);
  assert.ok(!imports.some((i) => i.startsWith("node:")), "no node:* import at all");
});

// --- template parsing ----------------------------------------------------------

test("parseTemplate: frontmatter, the required-inputs block (notes stripped) and the body", () => {
  const t = parseTemplate(readFileSync(join(TEMPLATES, "review.md"), "utf8"));
  assert.equal(t.template, "review");
  assert.equal(t.template_version, 1);
  assert.deepEqual(t.required_inputs, ["run", "scope", "claimed", "gate-result", "coverage", "examined", "packets", "receipts", "rejects", "unlocated"]);
  assert.match(t.body, /^# Security review — run \{\{run\.run_id\}\}/m);
  assert.ok(!t.body.includes("required-inputs"), "the block is not part of the body");
  const v = parseTemplate(readFileSync(join(TEMPLATES, "verify.md"), "utf8"));
  assert.deepEqual(v.required_inputs, ["run", "verify", "packets", "receipts"]);
  assert.equal(v.template_version, 1);
});

test("parseTemplate refuses a template without frontmatter, without a required-inputs block, or with a non-integer version", () => {
  assert.throws(() => parseTemplate("# no frontmatter\n"), /frontmatter/);
  assert.throws(() => parseTemplate("---\ntemplate: x\ntemplate_version: 1\n---\n# body\n"), /required-inputs/);
  assert.throws(() => parseTemplate("---\ntemplate: x\ntemplate_version: one\n---\n```required-inputs\nrun\n```\n"), /template_version/);
  assert.throws(() => parseTemplate("---\ntemplate: x\ntemplate_version: 1\n---\n```required-inputs\n```\n"), /empty/);
});

// --- sanitiser -----------------------------------------------------------------

test("sanitize: raw HTML removed, redaction markers kept, fake TL-7 markers removed", () => {
  assert.equal(sanitize("a <script>alert(1)</script> b"), "a alert(1) b");
  assert.equal(sanitize("x <!-- v:summary.total --> y"), "x  y");
  assert.equal(sanitize("p = <REDACTED:password-assign>;"), "p = <REDACTED:password-assign>;");
  assert.equal(sanitize("<img src=x onerror=alert(1)>tail"), "tail");
  assert.equal(sanitize("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2", "bare comparison operators are text");
});

test("sanitize: links rendered as text, control/bidi/zero-width stripped, fences and structural line starts escaped, table pipes escaped in cells", () => {
  assert.equal(sanitize("see [docs](https://example.invalid/x) now"), "see docs (https://example.invalid/x) now");
  assert.equal(sanitize("![alt](https://example.invalid/i.png)"), "alt (https://example.invalid/i.png)");
  assert.equal(sanitize("ref [text][1] here"), "ref text here");
  assert.equal(sanitize("a\u202Eb\u200Bc\u0007d\u200Fe"), "abcde");
  assert.equal(sanitize("```js\nx\n```"), "\\`\\`\\`js\nx\n\\`\\`\\`");
  assert.equal(sanitize("~~~\nx"), "\\~~~\nx");
  assert.equal(sanitize("# not a heading\n- not a list\n1. nor this\n> nor a quote\n===\n---"), "\\# not a heading\n\\- not a list\n\\1. nor this\n\\> nor a quote\n\\===\n\\---");
  assert.equal(sanitize("a | b", { cell: true }), "a \\| b");
  assert.equal(sanitize("line1\r\nline2", { cell: true }), "line1 line2", "a cell is one line");
  assert.equal(sanitize("line1\r\nline2"), "line1\nline2", "prose keeps LF, drops CR");
  assert.equal(sanitize(""), "");
  assert.equal(sanitize(42), "42", "non-strings are stringified");
  assert.equal(sanitize("1.0.0", { cell: true }), "1.0.0", "a cell never starts a line, so no line-start escape");
  assert.equal(sanitize("- x", { cell: true }), "- x");
  assert.equal(sanitize("<script>alert(1)</script>\r\n\u202E```", { code: true }), "<script>alert(1)</script>\n```", "code mode keeps the bytes of a cited snippet, minus controls and CR");
});

test("marker: `<!-- v:<view-path> -->` (TL-7) and a path never carries a newline or `-->`", () => {
  assert.equal(marker("summary.total"), "<!-- v:summary.total -->");
  assert.equal(marker("findings[2].state"), "<!-- v:findings[2].state -->");
  assert.throws(() => marker("a\nb"), /path/);
  assert.throws(() => marker("a-->b"), /path/);
});

// --- a synthetic review run ----------------------------------------------------

const KEY = Buffer.alloc(32, 7);
const RUN_ID = "abcdef012345-0001";
const BASE = "a0".repeat(20);
const HEAD = "b1".repeat(20);
const OID = "c2".repeat(20);
const CLAIMS_REF = "e".repeat(64);
const IMPORT = "f".repeat(64);
const head = (kind) => ({ schema_version: 1, kind, run_id: RUN_ID, engagement_id: "fixture-engagement", key_id: "k000000000000", now: () => "2026-09-16T00:00:00Z" });
/** An in-memory artifact exactly as writeArtifact would persist it (payload redacted before identity). */
const art = (kind, payload) => makeEnvelope(head(kind), redactDeep(payload, DEFAULT_RULES));

const APP_JS_LINE = "export const a = 1;";
const SENSITIVE_SNIPPET = "// password=1234";

function synthReview({ withReceipts = true, tamper = () => {} } = {}) {
  const run = art("run", { engagement_id: "fixture-engagement", seq: 1, base_oid: BASE, head_oid: HEAD, template: "review" });
  const scope = art("scope", {
    files: [
      { path: "src/app.js", side: "head", oid: OID, file_hmac: "8".repeat(64), lines: 3 },
      { path: "src/db.js", side: "head", oid: OID, file_hmac: "7".repeat(64), lines: 8 },
    ],
    ranges: { "src/app.js": [[1, 3]], "src/db.js": [[1, 8]] },
    skipped: [{ path: "assets/logo.png", reason: "binary" }],
  });
  const scopePacket = art("packet", {
    kind: "scope",
    subject_ids: [],
    files: [
      { path: "src/app.js", side: "head", oid: OID, ranges: [[1, 3]], range_hmac: "6".repeat(64) },
      { path: "src/db.js", side: "head", oid: OID, ranges: [[1, 8]], range_hmac: "5".repeat(64) },
    ],
    policy_sha256: "9".repeat(64),
  });
  const examined = art("examined", { packet_sha256: scopePacket.envelope.self_sha256, declared: [{ path: "src/app.js", ranges: [[1, 2]] }] });
  const coverage = art("coverage", computeCoverage(scope, examined, [{ tool: "semgrep", version: "1.0", import_sha256: IMPORT, paths: ["src/db.js"] }]));

  const base = (over) => ({ title: "t", class: "config", priority: "p1", confidence: 7, path: "src/app.js", side: "head", lines: [1, 1], occurrence: 0, source: { kind: "agent", ref: CLAIMS_REF, index: 0 }, ...over });
  const plain = base({ title: "app export is mutable", snippet: APP_JS_LINE, state: "CITATION_VERIFIED", description: "The export can be reassigned.", cwe: "CWE-1104", remediation: "freeze it" });
  plain.id = findingId({ path: plain.path, class: plain.class, snippet: plain.snippet, occurrence: 0, sensitive: false, key: KEY, rules: DEFAULT_RULES });
  const failed = base({ title: "not what the file says", priority: "p2", snippet: "z();", state: "CITATION_FAILED", source: { kind: "agent", ref: CLAIMS_REF, index: 1 } });
  failed.id = findingId({ path: failed.path, class: failed.class, snippet: failed.snippet, occurrence: 0, sensitive: false, key: KEY, rules: DEFAULT_RULES });
  const sensitive = base({ title: "hard-coded credential comment", priority: "p0", path: "src/db.js", lines: [6, 6], state: "CITATION_VERIFIED", sensitive: true, source: { kind: "agent", ref: CLAIMS_REF, index: 2 } });
  sensitive.snippet_redacted = redactDeep(SENSITIVE_SNIPPET, DEFAULT_RULES);
  sensitive.id = findingId({ path: sensitive.path, class: sensitive.class, snippet: SENSITIVE_SNIPPET, occurrence: 0, sensitive: true, key: KEY, rules: DEFAULT_RULES });
  const sarif = base({ title: "semgrep: sql-injection", class: "injection", priority: "p1", confidence: 6, path: "src/db.js", lines: [3, 4], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);', state: "CITATION_VERIFIED", requires_typed_citations: true, source: { kind: "sarif", ref: IMPORT, index: 0 } });
  sarif.id = findingId({ path: sarif.path, class: sarif.class, snippet: sarif.snippet, occurrence: 0, sensitive: false, key: KEY, rules: DEFAULT_RULES });
  const findings = [plain, failed, sensitive, sarif].sort((a, b) => (a.id < b.id ? -1 : 1));
  const claimed = art("claimed", { scope_sha256: scope.envelope.self_sha256, findings });
  const rejects = art("rejects", {
    rejected: [
      { reason: "agent-wrote-id", locator: { claims_sha256: CLAIMS_REF, index: 3 } },
      { reason: "claim-invalid", locator: { claims_sha256: CLAIMS_REF, index: 4 } },
      { reason: "RANGE-TOO-LONG", locator: { claims_sha256: CLAIMS_REF, index: 5 } },
    ],
  });
  const gateResult = art("gate-result", {
    accepted: findings.filter((f) => f.state === "CITATION_VERIFIED").map((f) => f.id),
    unverifiable: findings.filter((f) => f.state === "CITATION_FAILED").map((f) => f.id),
    rejected_counts: { "RANGE-TOO-LONG": 1, "agent-wrote-id": 1, "claim-invalid": 1 },
    scope_sha256: scope.envelope.self_sha256,
    claimed_sha256: claimed.envelope.self_sha256,
  });
  const unlocated = art("unlocated", { candidates: [{ locator: { import_sha256: IMPORT, index: 1 }, reason: "no-location", tool: "semgrep", rule_id: "no-loc" }] });
  const subject = art("packet", { kind: "subject", subject_ids: [plain.id], files: [{ path: "src/app.js", side: "head", oid: OID, ranges: [[1, 1]], range_hmac: "4".repeat(64) }], policy_sha256: "9".repeat(64) });
  const receipts = withReceipts ? [art("receipt", { type: "vulnerability-review", subject_id: plain.id, packet_sha256: subject.envelope.self_sha256, assertion: "confirmed", reviewer_run_id: RUN_ID })] : [];
  const packets = [scopePacket, subject].sort((a, b) => (a.envelope.self_sha256 < b.envelope.self_sha256 ? -1 : 1));
  const artifacts = { run, scope, claimed, "gate-result": gateResult, coverage, examined, packets, receipts, rejects, unlocated };
  tamper(artifacts);
  const setHash = (list) => artifactId({ members: list.map((a) => a.envelope.self_sha256).sort() });
  const hashes = {};
  for (const [name, a] of Object.entries(artifacts)) hashes[name] = Array.isArray(a) ? setHash(a) : a.envelope.self_sha256;
  return { inputs: { template: "review", artifacts, hashes }, ids: { plain: plain.id, failed: failed.id, sensitive: sensitive.id, sarif: sarif.id }, findings };
}

const OPTS = { key: KEY, rules: DEFAULT_RULES, tool_version: "1.0.0", template_version: 1 };
const reviewTemplate = () => parseTemplate(readFileSync(join(TEMPLATES, "review.md"), "utf8"));

// --- buildView: review ---------------------------------------------------------

test("buildView(review): states from gate + receipts, counts by priority × state, unresolved by priority, rejected by reason, unlocated, key availability", () => {
  const { inputs, ids } = synthReview();
  const view = buildView(inputs, OPTS);
  assert.equal(view.template, "review");
  assert.equal(view.run.run_id, RUN_ID);
  assert.equal(view.run.head_oid, HEAD);
  assert.equal(view.key, "available");
  const byId = Object.fromEntries(view.findings.map((f) => [f.id, f]));
  assert.equal(byId[ids.plain].state, "REVIEW_CONFIRMED");
  assert.equal(byId[ids.plain].reviewed, true);
  assert.equal(byId[ids.sensitive].state, "CITATION_VERIFIED");
  assert.equal(byId[ids.sensitive].reviewed, false);
  assert.equal(byId[ids.sensitive].evidence.kind, "snippet_redacted");
  assert.equal(byId[ids.sensitive].evidence.sensitive, true);
  assert.equal(byId[ids.failed].state, "CITATION_FAILED");
  assert.equal(byId[ids.failed].occurrence, 0, "gate records occurrence 0 on CITATION_FAILED");
  assert.deepEqual(view.summary.by_priority_state.p0, { CITATION_VERIFIED: 1, CITATION_FAILED: 0, REVIEW_CONFIRMED: 0, REVIEW_REFUTED: 0, REVIEW_INDETERMINATE: 0 });
  assert.deepEqual(view.summary.by_priority_state.p1, { CITATION_VERIFIED: 1, CITATION_FAILED: 0, REVIEW_CONFIRMED: 1, REVIEW_REFUTED: 0, REVIEW_INDETERMINATE: 0 });
  assert.deepEqual(view.summary.unresolved_by_priority, { p0: 0, p1: 0, p2: 1, p3: 0 });
  assert.deepEqual(view.summary.rejected_by_reason, { "RANGE-TOO-LONG": 1, "agent-wrote-id": 1, "claim-invalid": 1 });
  assert.equal(view.summary.rejected_total, 3);
  assert.equal(view.summary.unlocated, 1);
  assert.equal(view.summary.unauthenticated_approvals, NOT_ASSESSED);
  assert.deepEqual(view.coverage.counts, { examined: 1, skipped: 1, "scanner-only": 1, unexamined: 1 });
  assert.equal(view.coverage.indeterminate, false);
  assert.equal(view.findings.length, 4);
  assert.deepEqual(view.findings.map((f) => f.id), [...view.findings.map((f) => f.id)].sort(), "findings in id order (claimed order)");
  assert.deepEqual(view.hashes, inputs.hashes);
  assert.equal(view.custody.tool_version, "1.0.0");
  assert.equal(view.custody.template_version, 1);
  assert.doesNotThrow(() => JSON.stringify(view), "the view is plain data");
});

test("buildView(review): the gate re-run refuses a gate-result that no longer follows from claimed + scope + rejects (InconsistentInput gate-result)", () => {
  const cases = [
    ["accepted list edited", (a) => (a["gate-result"].payload.accepted = a["gate-result"].payload.accepted.slice(1))],
    ["rejected_counts edited", (a) => (a["gate-result"].payload.rejected_counts["claim-invalid"] = 2)],
    ["scope_sha256 edited", (a) => (a["gate-result"].payload.scope_sha256 = "0".repeat(64))],
    ["claimed_sha256 edited", (a) => (a["gate-result"].payload.claimed_sha256 = "0".repeat(64))],
    ["a finding id edited", (a) => (a.claimed.payload.findings[0].id = "1".repeat(64))],
    ["a CITATION_FAILED finding with occurrence 2", (a) => (a.claimed.payload.findings.find((f) => f.state === "CITATION_FAILED").occurrence = 2)],
  ];
  for (const [label, edit] of cases) {
    const { inputs } = synthReview({ tamper: edit });
    assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "gate-result", label);
  }
});

test("buildView(review): the coverage re-run refuses a coverage.json that no longer follows from scope + examined (InconsistentInput coverage)", () => {
  const { inputs } = synthReview({ tamper: (a) => (a.coverage.payload.accounting[0].status = "examined") });
  assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "coverage");
  const { inputs: other } = synthReview({ tamper: (a) => (a.coverage.payload.examined_sha256 = "0".repeat(64)) });
  assert.throws(() => buildView(other, OPTS), (err) => err instanceof InconsistentInput && err.field === "coverage");
});

test("buildView(review) without the key: plain ids are still re-derived, keyed ids are listed as unverifiable-without-key in Limitations, KEY: unavailable", () => {
  const { inputs, ids } = synthReview();
  const view = buildView(inputs, { ...OPTS, key: null });
  assert.equal(view.key, "unavailable");
  assert.ok(view.limitations.some((l) => l.includes("KEY: unavailable")), JSON.stringify(view.limitations));
  assert.ok(view.limitations.some((l) => l.includes(ids.sensitive)), "the keyed finding is named");
  const { inputs: bad } = synthReview({ tamper: (a) => (a.claimed.payload.findings.find((f) => f.sensitive !== true).id = "1".repeat(64)) });
  assert.throws(() => buildView(bad, { ...OPTS, key: null }), (err) => err instanceof InconsistentInput && err.field === "gate-result", "plain ids are checked without a key");
});

test("buildView(review): no receipts ⇒ every accepted finding stays CITATION_VERIFIED and reviewed:false; receipts not applied and conflicts are surfaced", () => {
  const { inputs } = synthReview({ withReceipts: false });
  const view = buildView(inputs, OPTS);
  for (const f of view.findings.filter((f) => f.citation_state === "CITATION_VERIFIED")) {
    assert.equal(f.state, "CITATION_VERIFIED");
    assert.equal(f.reviewed, false);
  }
  assert.equal(view.receipts.total, 0);
  assert.deepEqual(view.receipts.not_applied, []);
  assert.deepEqual(view.receipts.conflicts, []);
});

// --- renderMarkdown: review ----------------------------------------------------

test("renderMarkdown(review): the twelve sections in v3 §11 order, every derived line marked (TL-7), no blank cell, no forbidden string, byte-identical on a second render", () => {
  const { inputs, ids } = synthReview();
  const view = buildView(inputs, OPTS);
  const template = reviewTemplate();
  const text = renderMarkdown(view, template);
  assert.equal(renderMarkdown(buildView(synthReview().inputs, OPTS), template), text, "deterministic");
  const headings = [...text.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(text, new RegExp(`^# Security review — run ${RUN_ID} <!-- v:run\\.run_id -->$`, "m"));
  // every table body row (a `|` row that is neither a separator nor the header a separator follows) ends with a marker
  const lines = text.split("\n");
  const separator = (l) => /^\|(\s*:?-+:?\s*\|)+$/.test(l);
  let bodyRows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|") || separator(line) || separator(lines[i + 1] ?? "")) continue;
    bodyRows++;
    assert.match(line, /<!-- v:[^>]+ -->$/, `unmarked table row: ${line}`);
  }
  assert.ok(bodyRows >= 10, `table body rows rendered: ${bodyRows}`);
  // and every `- <label>: <value>` line whose value is a hash, an oid, a count or a state
  for (const line of lines) {
    if (/^- [a-z_ ]+: .*([0-9a-f]{40,64}|\b(CITATION|REVIEW)_[A-Z]+\b|\b\d+\b)/.test(line)) assert.match(line, /<!-- v:[^>]+ -->$/, `unmarked derived line: ${line}`);
  }
  assert.ok(!/\|[ \t]*\|/.test(text), "no blank table cell");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!text.includes(s), `forbidden string ${s}`);
  assert.ok(text.includes(NOT_INDEPENDENTLY_REVIEWED), "a CITATION_VERIFIED finding without a receipt says so");
  assert.ok(text.includes(NOT_ASSESSED), "absent fields say unknown / not assessed");
  assert.ok(text.includes(ids.plain) && text.includes(ids.failed) && text.includes(ids.sensitive) && text.includes(ids.sarif));
  assert.ok(text.includes("<REDACTED:password-assign>"), "the redacted evidence is shown as redacted");
  assert.ok(!text.includes("password=1234"), "no original sensitive bytes");
  assert.match(text, /\| RANGE-TOO-LONG \| 1 \|/);
  assert.match(text, /\| agent-wrote-id \| 1 \|/);
  assert.match(text, /\| claim-invalid \| 1 \|/);
  assert.match(text, /rejected candidates: 3 <!-- v:summary\.rejected_total -->/);
  assert.match(text, /ORIGIN: unauthenticated/);
  assert.match(text, /tool_version: 1\.0\.0 <!-- v:custody\.tool_version -->/);
  assert.match(text, /template: review v1 <!-- v:custody\.template -->/);
  for (const [name, sha] of Object.entries(inputs.hashes)) assert.match(text, new RegExp(`\\| ${name} \\| ${sha} \\| <!-- v:hashes\\.${name.replace("-", "\\-")} -->`), `custody row for ${name}`);
  assert.ok(text.endsWith("\n"), "LF-terminated");
});

test("renderMarkdown(review): input strings are sanitised — a title with HTML, a fake marker, a link and a table pipe cannot change the document structure", () => {
  const { inputs } = synthReview({
    tamper: (a) => {
      const f = a.claimed.payload.findings[0];
      f.title = "x <!-- v:nope.forged --> | [y](https://e.invalid) <b>z</b>";
      f.description = "# heading\n```\nfence\n```";
      // keep gate-result consistent: identity does not cover title/description, but claimed_sha256 does
      a["gate-result"].payload.claimed_sha256 = artifactId(a.claimed.payload);
      a.claimed.envelope.self_sha256 = artifactId(a.claimed.payload);
    },
  });
  const text = renderMarkdown(buildView(inputs, OPTS), reviewTemplate());
  assert.ok(!text.includes("<!-- v:nope.forged -->"), "the fake marker never reaches the document");
  assert.ok(text.includes("x  \\| y (https://e.invalid) z"), text.split("\n").find((l) => l.includes("y (https")));
  assert.ok(!text.includes("<b>"), "raw HTML removed");
  assert.ok(!/^# heading$/m.test(text), "a heading inside a field is escaped");
  assert.ok(!/^```$/m.test(text), "a fence inside a field is escaped");
  const headings = [...text.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("renderMarkdown refuses a template whose slots name view paths that do not exist", () => {
  const { inputs } = synthReview();
  const view = buildView(inputs, OPTS);
  assert.throws(() => renderMarkdown(view, { ...reviewTemplate(), body: "{{run.nope}}\n" }), /run\.nope/);
  assert.throws(() => renderMarkdown(view, { ...reviewTemplate(), body: "{{block:nope}}\n" }), /block nope/);
  assert.throws(() => renderMarkdown(view, { ...reviewTemplate(), template: "verify" }), /template/);
});

// --- verify template over the TASK-026 fixtures --------------------------------

function verifyInputs(rule) {
  const verify = readArtifact(join(VERIFY_FIXTURES, `${rule}.json`), { kind: "verify" });
  const run_id = verify.envelope.run_id;
  const run = makeEnvelope({ schema_version: 1, kind: "run", run_id, engagement_id: verify.envelope.engagement_id, key_id: verify.envelope.key_id, now: () => "2026-09-16T00:00:00Z" }, { engagement_id: verify.envelope.engagement_id, seq: Number(run_id.slice(-4)), base_oid: verify.payload.base_oid, head_oid: verify.payload.head_oid, template: "verify" });
  const pool = (sub, kind) => readdirSync(join(VERIFY_FIXTURES, sub)).map((n) => readArtifact(join(VERIFY_FIXTURES, sub, n), { kind }));
  const wanted = new Set([verify.payload.packet_sha256]);
  const receipts = pool("receipts", "receipt").filter((r) => verify.payload.receipts.some((x) => x.sha256 === r.envelope.self_sha256));
  for (const r of receipts) wanted.add(r.payload.packet_sha256);
  const packets = pool("packets", "packet").filter((p) => wanted.has(p.envelope.self_sha256));
  const artifacts = { run, verify, packets, receipts };
  const setHash = (list) => artifactId({ members: list.map((a) => a.envelope.self_sha256).sort() });
  const hashes = { run: run.envelope.self_sha256, verify: verify.envelope.self_sha256, packets: setHash(packets), receipts: setHash(receipts) };
  return { inputs: { template: "verify", artifacts, hashes }, verify };
}

test("buildView/renderMarkdown(verify): the VERDICT line is rendered exactly as verify.mjs prints it and the evaluation is re-run (InconsistentInput verify on a tampered one)", () => {
  const template = parseTemplate(readFileSync(join(TEMPLATES, "verify.md"), "utf8"));
  for (const rule of ["verified-two-acks", "refound-row-fixed", "two-indicators-one-ack", "refound-not-applied"]) {
    const { inputs, verify } = verifyInputs(rule);
    const view = buildView(inputs, OPTS);
    const p = verify.payload;
    const expected = verdictLine({ verdict: p.evaluation.verdict, finding: p.finding_id, base: p.base_oid, head: p.head_oid, tested_tree: p.tested_tree, verify: verify.envelope.self_sha256 });
    assert.equal(view.verify.verdict_line, expected, rule);
    const text = renderMarkdown(view, template);
    assert.ok(text.includes(`${expected} <!-- v:verify.verdict_line -->`), `${rule}: ${text}`);
    assert.equal(renderMarkdown(buildView(verifyInputs(rule).inputs, OPTS), template), text, "deterministic");
    for (const s of FORBIDDEN_STRINGS) assert.ok(!text.includes(s));
    assert.ok(!/\|[ \t]*\|/.test(text), "no blank table cell");
    assert.ok(text.includes(p.tests.result), "the tests result token is shown");
  }
  const { inputs } = verifyInputs("verified-two-acks");
  inputs.artifacts.verify.payload.evaluation.verdict = "REGRESSED";
  assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "verify");
});

// --- TASK-024: assessment + threat-model templates ------------------------------
// (plan §5 TASK-024; spec §6.3 assessment/threat-model rows, §11, TL-3, TL-7,
// TL-16 reading; US-016 AC-2/AC-5). The assessment run is the review run
// above plus every P2 input: an engagement snapshot, a threat model with one
// mitigation, a mitigation packet + mitigation-review receipt, an import
// record with its index, a QA observation with its index, one verify
// snapshot (a TASK-026 rule re-pointed at the plain finding), a register
// snapshot whose chain is built here with register-fold's own hash, and a
// proposals index. Nothing here touches <st>/register or the file system.

const MITIGATION_PACKET_HMAC = "3".repeat(64);
const PROPOSAL_SHA = "2".repeat(64);
const TS = "2026-09-16T00:00:00Z";
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A chained event list: seq 1..n, prev_sha256 = the previous event's sha256 (genesis first). */
function chain(specs) {
  const events = [];
  let prev = GENESIS_SHA256;
  specs.forEach((s, i) => {
    const event = { seq: i + 1, prev_sha256: prev, ts: TS, actor: "lead", row_id: s.row_id, event: s.event, payload: s.payload, ref: s.ref };
    events.push(event);
    prev = eventSha256(event);
  });
  return { events, seq: events.length, chain_sha256: prev };
}

function synthAssessment({ withVerify = true, tamper = () => {}, reviewOptions = {} } = {}) {
  const review = synthReview(reviewOptions);
  const A = { ...review.inputs.artifacts };
  const { plain, sensitive } = review.ids;
  A.run = art("run", { engagement_id: "fixture-engagement", seq: 1, base_oid: BASE, head_oid: HEAD, template: "assessment" });
  A.engagement = art("engagement", {
    engagement_id: "fixture-engagement",
    slug: "fixture",
    scope_paths: ["src/"],
    product_paths: ["src/", "package.json"],
    targets: { tracker: ["github.com"], browser: ["staging.example.invalid"], repo: "org/fixture" },
    base_url: "https://staging.example.invalid",
    execute_project_tests: { argv: ["npm", "test"], timeout_s: 600 },
    sign_off: { require_dispositions: "executed-or-ticketed" },
    artifact_policy: { runs: "local", reports: "committed" },
  });
  A["threat-model"] = art("threat-model", {
    elements: [{ id: "E-001", kind: "process", name: "api", citation: { path: "src/app.js", side: "head", lines: [1, 3] } }],
    threats: [
      { id: "T-001", element_id: "E-001", stride: "T", title: "query tampering", mitigations: [{ id: "M-001", claim: "parameterised queries", citation: { path: "src/db.js", side: "head", lines: [3, 4] } }], disposition: { kind: "mitigated", ref: "M-001" } },
      { id: "T-002", element_id: "E-001", stride: "I", title: "verbose errors", mitigations: [], disposition: { kind: "undisposed" } },
    ],
  });
  const mitigationPacket = art("packet", { kind: "subject", subject_ids: ["M-001"], files: [{ path: "src/db.js", side: "head", oid: OID, ranges: [[3, 4]], range_hmac: MITIGATION_PACKET_HMAC }], policy_sha256: "9".repeat(64) });
  A.packets = [...A.packets, mitigationPacket].sort((a, b) => compare(a.envelope.self_sha256, b.envelope.self_sha256));
  A.receipts = [...A.receipts, art("receipt", { type: "mitigation-review", subject_id: "M-001", packet_sha256: mitigationPacket.envelope.self_sha256, assertion: "confirmed", reviewer_run_id: RUN_ID })].sort((a, b) => compare(a.envelope.self_sha256, b.envelope.self_sha256));
  // imports: one sarif record (the index is not an input identity, TL-14)
  const importRecord = art("import", { kind: "sarif", import_sha256: IMPORT, original_hmac: "a".repeat(64), redaction_version: DEFAULT_RULES.redaction_version, mapping_version: "1", source_path: "imports/semgrep.sarif", records: [], unlocated: [], rejected: [] });
  A.imports = [importRecord];
  A["imports-index"] = art("imports-index", { imports: [{ kind: "sarif", import_sha256: IMPORT, original_hmac: "a".repeat(64) }] });
  // observations (TASK-044): one FAIL (a section-9 candidate) and one PASS (recorded, never unresolved)
  const observation = art("observation", { observation_id: "O-0123456789ab", import_sha256: IMPORT, case_id: "SEC-CASE-1", case_sha256: "b".repeat(64), result: "FAIL", run_id: RUN_ID, base_url: "https://staging.example.invalid", account: "unknown", head_oid: HEAD });
  const passed = art("observation", { observation_id: "O-0123456789ac", import_sha256: IMPORT, case_id: "SEC-CASE-2", case_sha256: "c".repeat(64), result: "PASS", run_id: RUN_ID, base_url: "unknown", account: "qa-user", head_oid: "unknown" });
  A.observations = [observation, passed];
  A["observations-index"] = art("observations-index", { observations: [observation, passed].map((o) => ({ observation_id: o.payload.observation_id, sha256: o.envelope.self_sha256 })) });
  // verify snapshot: the TASK-026 rule, its finding re-pointed at the plain finding (evaluate is independent of finding_id)
  const snapshots = [];
  if (withVerify) {
    const rule = readArtifact(join(VERIFY_FIXTURES, "verified-two-acks.json"), { kind: "verify" });
    const vid = rule.envelope.run_id;
    const vhead = (kind) => ({ schema_version: 1, kind, run_id: vid, engagement_id: "fixture-engagement", key_id: "k000000000000", now: () => TS });
    const verify = makeEnvelope(vhead("verify"), { ...rule.payload, finding_id: plain });
    const pool = (sub, kind) => readdirSync(join(VERIFY_FIXTURES, sub)).map((n) => readArtifact(join(VERIFY_FIXTURES, sub, n), { kind }));
    const receipts = pool("receipts", "receipt").filter((r) => rule.payload.receipts.some((x) => x.sha256 === r.envelope.self_sha256));
    const wanted = new Set([rule.payload.packet_sha256, ...receipts.map((r) => r.payload.packet_sha256)]);
    const packets = pool("packets", "packet").filter((p) => wanted.has(p.envelope.self_sha256));
    snapshots.push({ id: vid, verify, packets, receipts });
  }
  A["verify-snapshots"] = snapshots;
  // register snapshot: two rows — the plain finding (accepted, ticketed) and the keyed one (open); events reference this run
  const acceptance = { recorded_by: "lead", approved_by: "cto", approval_ref: "https://example.invalid/approvals/1", authenticated: false, until: "2026-12-31" };
  const log = chain([
    { row_id: "R-0001", event: "add", payload: { subject: plain, subject_kind: "finding", title: "app export is mutable", priority: "p1", owner: "team-a", first_seen_run: RUN_ID }, ref: RUN_ID },
    { row_id: "R-0002", event: "add", payload: { subject: sensitive, subject_kind: "finding", title: "hard-coded credential comment", priority: "p0", owner: "", first_seen_run: RUN_ID }, ref: RUN_ID },
    { row_id: "R-0001", event: "accept", payload: acceptance, ref: RUN_ID },
    { row_id: "R-0001", event: "ticketed", payload: { ticket_url: "https://github.com/org/fixture/issues/7", import_sha256: IMPORT }, ref: "other-run-0002" },
  ]);
  A["register-events"] = art("register-snapshot", { engagement_id: "fixture-engagement", seq: log.seq, chain_sha256: log.chain_sha256, events: log.events, aliases: [] });
  A["proposals-index"] = art("proposals-index", { proposals: [{ id: "active-sqli-probe", sha256: PROPOSAL_SHA, path: ".agents/security-testing/proposals/active-sqli-probe.proposal.md" }] });
  tamper(A);
  const setHash = (list) => artifactId({ members: list.map((a) => a.envelope.self_sha256).sort() });
  const hashes = {};
  for (const name of ["run", "scope", "claimed", "gate-result", "coverage", "examined", "packets", "receipts", "rejects", "unlocated", "engagement", "threat-model", "observations", "imports", "register-events", "proposals-index"]) {
    hashes[name] = Array.isArray(A[name]) ? setHash(A[name]) : A[name].envelope.self_sha256;
  }
  hashes["verify-snapshots"] = setHash(A["verify-snapshots"].map((s) => s.verify));
  return { inputs: { template: "assessment", artifacts: A, hashes }, ids: review.ids, log, mitigationPacket };
}

const assessmentTemplate = () => parseTemplate(readFileSync(join(TEMPLATES, "assessment.md"), "utf8"));
const threatModelTemplate = () => parseTemplate(readFileSync(join(TEMPLATES, "threat-model.md"), "utf8"));

test("parseTemplate: assessment and threat-model templates carry the spec §6.3 required-inputs lists", () => {
  assert.deepEqual(assessmentTemplate().required_inputs, ["run", "scope", "claimed", "gate-result", "coverage", "examined", "packets", "receipts", "rejects", "unlocated", "engagement", "threat-model", "observations", "imports", "verify-snapshots", "register-events", "proposals-index"]);
  assert.deepEqual(threatModelTemplate().required_inputs, ["run", "threat-model", "packets", "receipts", "dispositions"]);
});

test("buildView(assessment): section 3 counts derive from the view — priority × state, unresolved, rejected by reason, unlocated, unauthenticated approvals from the register snapshot replay, incomplete runs deferred to sign-off (TL-16)", () => {
  const { inputs, ids, log } = synthAssessment();
  const view = buildView(inputs, OPTS);
  assert.equal(view.template, "assessment");
  assert.equal(view.run.kind, "assessment");
  const s = view.summary;
  assert.deepEqual(s.by_priority_state.p1, { CITATION_VERIFIED: 1, CITATION_FAILED: 0, REVIEW_CONFIRMED: 1, REVIEW_REFUTED: 0, REVIEW_INDETERMINATE: 0 });
  assert.deepEqual(s.unresolved_by_priority, { p0: 0, p1: 0, p2: 1, p3: 0 });
  assert.deepEqual(s.rejected_by_reason, { "RANGE-TOO-LONG": 1, "agent-wrote-id": 1, "claim-invalid": 1 });
  assert.equal(s.rejected_total, 3);
  assert.equal(s.unlocated, 1);
  // the register snapshot replayed: R-0001 accepted ⇒ one unauthenticated approval; never subtracted from exposure (G-8)
  const projection = replay(log.events, "fixture-engagement");
  const summary = summarize(projection);
  assert.equal(s.unauthenticated_approvals, summary.unauthenticated_approvals);
  assert.equal(s.unauthenticated_approvals, 1);
  assert.deepEqual(view.register.open_exposure, summary.open_exposure);
  assert.deepEqual(view.register.counts, summary.counts);
  assert.equal(view.register.seq, log.seq);
  assert.equal(view.register.chain_sha256, log.chain_sha256);
  assert.match(s.incomplete_runs, /sign-off/, "TL-16: the ledger is outside the run directory");
  // findings carry ticket_url and verification history from the snapshots, never free text
  const byId = Object.fromEntries(view.findings.map((f) => [f.id, f]));
  assert.equal(byId[ids.plain].ticket_url, "https://github.com/org/fixture/issues/7");
  assert.match(byId[ids.plain].verification_history, /VERIFIED/);
  assert.match(byId[ids.plain].verification_history, /accept/);
  assert.equal(byId[ids.sensitive].ticket_url, NOT_ASSESSED);
  assert.equal(byId[ids.failed].verification_history, NOT_ASSESSED);
  // threat model + mitigation states from applyReceipts over the mitigation packet
  assert.equal(view.threat_model.elements, 1);
  assert.deepEqual(view.threat_model.mitigation_states, { "M-001": "MITIGATION_CONFIRMED" });
  assert.equal(view.threat_model.threats.length, 2);
  assert.equal(view.threat_model.undisposed, 1);
  // verify history and QA FAIL observations
  assert.equal(view.verify_history.length, 1);
  assert.equal(view.verify_history[0].finding_id, ids.plain);
  assert.equal(view.verify_history[0].verdict, "VERIFIED");
  assert.equal(view.unresolved.qa_fail.length, 1, "only the FAIL observation is a candidate");
  assert.deepEqual(view.unresolved.qa_fail[0], { observation_id: "O-0123456789ab", case_id: "SEC-CASE-1", case_sha256: "b".repeat(64), result: "FAIL", import_sha256: IMPORT, head_oid: HEAD });
  assert.deepEqual(view.observations.map((o) => [o.observation_id, o.result]).sort(), [["O-0123456789ab", "FAIL"], ["O-0123456789ac", "PASS"]], "both observations are recorded in the view");
  assert.deepEqual(view.register.proposals.map((p) => p.id), ["active-sqli-probe"]);
  assert.deepEqual(view.hashes, inputs.hashes);
  assert.doesNotThrow(() => JSON.stringify(view), "plain data");
});

test("buildView(assessment): the register section derives from the snapshot only — a snapshot whose chain, seq or chain_sha256 no longer follows from its events is InconsistentInput(register-events); a verify snapshot with a tampered evaluation is InconsistentInput(verify) (TL-3, §6.3)", () => {
  const cases = [
    ["seq edited", (a) => (a["register-events"].payload.seq += 1)],
    ["chain_sha256 edited", (a) => (a["register-events"].payload.chain_sha256 = "1".repeat(64))],
    ["an event's title edited (breaks the chain)", (a) => (a["register-events"].payload.events[0].payload.title = "edited")],
    ["an event dropped", (a) => a["register-events"].payload.events.pop()],
  ];
  for (const [label, edit] of cases) {
    const { inputs } = synthAssessment({ tamper: edit });
    assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "register-events", label);
  }
  const { inputs } = synthAssessment({ tamper: (a) => (a["verify-snapshots"][0].verify.payload.evaluation.verdict = "REGRESSED") });
  assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "verify");
  // and the review derivations still guard the assessment
  const { inputs: bad } = synthAssessment({ tamper: (a) => (a["gate-result"].payload.accepted = a["gate-result"].payload.accepted.slice(1)) });
  assert.throws(() => buildView(bad, OPTS), (err) => err instanceof InconsistentInput && err.field === "gate-result");
});

test("renderMarkdown(assessment): the twelve sections in v3 §11 order with Coverage second; every finding field filled or `unknown / not assessed`; no blank cell; markers on every derived line; deterministic (US-016 AC-5, TL-7)", () => {
  const { inputs, ids } = synthAssessment();
  const template = assessmentTemplate();
  const text = renderMarkdown(buildView(inputs, OPTS), template);
  assert.equal(renderMarkdown(buildView(synthAssessment().inputs, OPTS), template), text, "deterministic");
  const headings = [...text.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(headings.map((h) => h[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(headings[1][1], "Coverage");
  assert.equal(headings[2][1], "Executive summary");
  assert.equal(headings[9][1], "Threat model and mitigation states");
  assert.equal(headings[10][1], "Register delta and proposed acceptances");
  assert.equal(headings[11][1], "Chain of custody");
  assert.match(text, new RegExp(`^# Security assessment — run ${RUN_ID} <!-- v:run\\.run_id -->$`, "m"));
  const lines = text.split("\n");
  const separator = (l) => /^\|(\s*:?-+:?\s*\|)+$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|") || separator(line) || separator(lines[i + 1] ?? "")) continue;
    assert.match(line, /<!-- v:[^>]+ -->$/, `unmarked table row: ${line}`);
  }
  for (const line of lines) {
    if (/^- [a-z_ ]+: .*([0-9a-f]{40,64}|\b(CITATION|REVIEW|MITIGATION)_[A-Z]+\b|\b\d+\b)/.test(line)) assert.match(line, /<!-- v:[^>]+ -->$/, `unmarked derived line: ${line}`);
  }
  assert.ok(!/\|[ \t]*\|/.test(text), "no blank table cell");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!text.includes(s), `forbidden string ${s}`);
  // section 3: the six executive figures, each marked
  const section3 = text.slice(text.indexOf("## 3. "), text.indexOf("## 4. "));
  assert.match(section3, /- unauthenticated approvals: 1 <!-- v:summary\.unauthenticated_approvals -->/);
  assert.match(section3, /- incomplete runs: see sign-off[^\n]* <!-- v:summary\.incomplete_runs -->/);
  assert.match(section3, /- rejected candidates: 3 <!-- v:summary\.rejected_total -->/);
  assert.match(section3, /- unlocated candidates: 1 <!-- v:summary\.unlocated -->/);
  assert.match(section3, /\| p1 \| 1 \| 0 \| 1 \| 0 \| 0 \| <!-- v:summary\.by_priority_state\.p1 -->/);
  assert.match(section3, /\| p2 \| 1 \| <!-- v:summary\.unresolved_by_priority\.p2 -->/);
  // section 8: every required finding field is a row, ticket_url and history from the snapshots
  const section8 = text.slice(text.indexOf("## 8. "), text.indexOf("## 9. "));
  for (const field of ["id", "class / CWE", "priority", "confidence", "state", "affected asset", "reproduction", "ticket_url", "verification history"]) {
    assert.ok(section8.includes(`| ${field} | `), `finding field ${field}`);
  }
  assert.match(section8, /\| ticket_url \| https:\/\/github\.com\/org\/fixture\/issues\/7 \| <!-- v:findings\[\d+\]\.ticket_url -->/);
  assert.match(section8, /\| ticket_url \| unknown \/ not assessed \| <!-- v:findings\[\d+\]\.ticket_url -->/);
  assert.match(section8, /\| verification history \| [^|]*VERIFIED[^|]* \| <!-- v:findings\[\d+\]\.verification_history -->/);
  assert.ok(section8.includes(NOT_INDEPENDENTLY_REVIEWED));
  // section 4 shows the engagement record; section 9 the QA FAIL observation; section 10 the mitigation state; section 11 the register and the proposal
  const section4 = text.slice(text.indexOf("## 4. "), text.indexOf("## 5. "));
  assert.match(section4, /scope_paths: src\/ <!-- v:engagement\.scope_paths -->/);
  assert.match(section4, /require_dispositions: executed-or-ticketed <!-- v:engagement\.require_dispositions -->/);
  const section9 = text.slice(text.indexOf("## 9. "), text.indexOf("## 10. "));
  // TASK-044 (US-036 AC-3): the FAIL observation is a marked row with its case identity; the PASS one is not a candidate; the mitigation-review rule is printed
  assert.match(section9, /^\| observation \| case \| case_sha256 \| result \| import_sha256 \|$/m);
  assert.match(section9, new RegExp(`^\\| O-0123456789ab \\| SEC-CASE-1 \\| b{64} \\| FAIL \\| ${IMPORT} \\| <!-- v:unresolved\\.qa_fail\\[0\\] -->$`, "m"));
  assert.doesNotMatch(section9, /O-0123456789ac|SEC-CASE-2/);
  assert.match(section9, /A FAIL observation stays a candidate: a mitigation decision needs a separate `mitigation-review` receipt citing the observation/);
  assert.doesNotMatch(section9, /MITIGATION_/, "no state is derived for an observation");
  const section10 = text.slice(text.indexOf("## 10. "), text.indexOf("## 11. "));
  assert.match(section10, /\| M-001 \| T-001 \| MITIGATION_CONFIRMED \|/);
  assert.match(section10, /\| T-002 \| E-001 \| I \| verbose errors \| undisposed \|/);
  const section11 = text.slice(text.indexOf("## 11. "), text.indexOf("## 12. "));
  assert.match(section11, /\| R-0001 \| [0-9a-f]{64} \| p1 \| accepted \|/);
  assert.match(section11, /\| R-0001 \| acceptance \| cto \| https:\/\/example\.invalid\/approvals\/1 \| 2026-12-31 \|/);
  assert.match(section11, /\| active-sqli-probe \| 2{64} \|/);
  assert.match(section11, /- unauthenticated approvals: 1 <!-- v:register\.unauthenticated_approvals -->/);
  // section 6: outside-policy artifacts and local ≠ confidential
  const section6 = text.slice(text.indexOf("## 6. "), text.indexOf("## 7. "));
  assert.match(section6, /outside the local policy: reports/);
  assert.match(section6, /local ≠ confidential/);
  assert.match(section6, /KEY: available/);
  // section 12: every input hash, tool and template versions, the ORIGIN line
  for (const [name, sha] of Object.entries(inputs.hashes)) assert.match(text, new RegExp(`\\| ${name} \\| ${sha} \\| <!-- v:hashes\\.${name.replace(/-/g, "\\-")} -->`), `custody row for ${name}`);
  assert.match(text, /template: assessment v1 <!-- v:custody\.template -->/);
  assert.match(text, /ORIGIN: unauthenticated/);
  assert.ok(text.includes(ids.plain) && text.includes(ids.sensitive));
  assert.ok(!text.includes("password=1234"));
  assert.ok(text.endsWith("\n"));
});

test("buildView(assessment): with no verify snapshot and no receipts the history and review columns read unknown / not assessed and not independently reviewed — never blank", () => {
  const { inputs, ids } = synthAssessment({ withVerify: false, reviewOptions: { withReceipts: false }, tamper: (a) => (a.receipts = a.receipts.filter((r) => r.payload.type !== "mitigation-review")) });
  inputs.hashes.receipts = artifactId({ members: [] });
  const view = buildView(inputs, OPTS);
  assert.equal(view.verify_history.length, 0);
  assert.deepEqual(view.threat_model.mitigation_states, {});
  const byId = Object.fromEntries(view.findings.map((f) => [f.id, f]));
  assert.match(byId[ids.plain].verification_history, /accept/, "register events still count as history");
  assert.equal(byId[ids.sarif].verification_history, NOT_ASSESSED);
  const text = renderMarkdown(view, assessmentTemplate());
  assert.ok(!/\|[ \t]*\|/.test(text));
  assert.match(text, /\| M-001 \| T-001 \| not independently reviewed \|/);
  assert.match(text, /\(no verify snapshots\) <!-- v:verify_history -->/);
});

test("buildView: keys — an artifact whose key_id has no key file is listed in Limitations under KEY: unavailable (US-005 AC-4 half); keyIdsOf lists every distinct key_id in the closure", () => {
  const { inputs } = synthAssessment();
  assert.deepEqual(keyIdsOf(inputs), ["k000000000000"]);
  const view = buildView(inputs, { ...OPTS, keys: { k000000000000: null } });
  assert.ok(view.limitations.some((l) => l.startsWith("KEY: unavailable") && l.includes("k000000000000") && l.includes("register-events")), JSON.stringify(view.limitations));
  const available = buildView(inputs, { ...OPTS, keys: { k000000000000: KEY } });
  assert.ok(!available.limitations.some((l) => l.includes("k000000000000") && l.startsWith("KEY: unavailable")));
  // a verify snapshot enveloped under a rotated key that is gone: only that artifact is named
  const rotated = synthAssessment({ tamper: (a) => (a["verify-snapshots"][0].verify.envelope.key_id = "kdeadbeef0000") });
  assert.deepEqual(keyIdsOf(rotated.inputs), ["k000000000000", "kdeadbeef0000"]);
  const partial = buildView(rotated.inputs, { ...OPTS, keys: { k000000000000: KEY, kdeadbeef0000: null } });
  const line = partial.limitations.find((l) => l.startsWith("KEY: unavailable"));
  assert.ok(line.includes("kdeadbeef0000") && line.includes("verify-snapshots/"), line);
  assert.ok(!line.includes("register-events"));
});

// --- threat-model template ------------------------------------------------------

function synthThreatModel({ withReceipt = true, tamper = () => {} } = {}) {
  const run = art("run", { engagement_id: "fixture-engagement", seq: 1, base_oid: BASE, head_oid: HEAD, template: "threat-model" });
  const model = art("threat-model", {
    elements: [
      { id: "E-001", kind: "process", name: "api", citation: { path: "src/app.js", side: "head", lines: [1, 3] } },
      { id: "E-002", kind: "datastore", name: "users db", citation: { path: "src/db.js", side: "head", lines: [1, 8] } },
    ],
    threats: [
      { id: "T-001", element_id: "E-002", stride: "T", title: "query tampering", mitigations: [{ id: "M-001", claim: "parameterised queries", citation: { path: "src/db.js", side: "head", lines: [3, 4] } }], disposition: { kind: "mitigated", ref: "M-001" } },
      { id: "T-002", element_id: "E-001", stride: "D", title: "no rate limit", mitigations: [{ id: "M-002", claim: "gateway limits" }], disposition: { kind: "planned", ref: "active-sqli-probe" } },
      { id: "T-003", element_id: "E-001", stride: "S", title: "token replay", mitigations: [], disposition: { kind: "undisposed" } },
    ],
  });
  const packet = art("packet", { kind: "subject", subject_ids: ["M-001"], files: [{ path: "src/db.js", side: "head", oid: OID, ranges: [[3, 4]], range_hmac: MITIGATION_PACKET_HMAC }], policy_sha256: "9".repeat(64) });
  const receipts = withReceipt ? [art("receipt", { type: "mitigation-review", subject_id: "M-001", packet_sha256: packet.envelope.self_sha256, assertion: "gap", reviewer_run_id: RUN_ID })] : [];
  const dispositions = art("dispositions", {
    dispositions: [
      { threat_id: "T-001", kind: "mitigated", ref: "M-001", resolved_via: "receipt" },
      { threat_id: "T-002", kind: "planned", ref: "active-sqli-probe", resolved_via: "proposal" },
      { threat_id: "T-003", kind: "undisposed", ref: "", resolved_via: "none" },
    ],
  });
  const artifacts = { run, "threat-model": model, packets: [packet], receipts, dispositions };
  tamper(artifacts);
  const setHash = (list) => artifactId({ members: list.map((a) => a.envelope.self_sha256).sort() });
  const hashes = { run: run.envelope.self_sha256, "threat-model": artifacts["threat-model"].envelope.self_sha256, packets: setHash(artifacts.packets), receipts: setHash(artifacts.receipts), dispositions: artifacts.dispositions.envelope.self_sha256 };
  return { inputs: { template: "threat-model", artifacts, hashes } };
}

test("buildView/renderMarkdown(threat-model): elements, threats and dispositions as recorded; mitigation states from applyReceipts (gap ⇒ MITIGATION_GAP, none ⇒ not independently reviewed); v3 §11 section numbers kept; no blank cell; deterministic", () => {
  const { inputs } = synthThreatModel();
  const view = buildView(inputs, OPTS);
  assert.equal(view.template, "threat-model");
  assert.equal(view.threat_model.elements, 2);
  assert.deepEqual(view.threat_model.mitigation_states, { "M-001": "MITIGATION_GAP" });
  assert.equal(view.threat_model.undisposed, 1);
  assert.deepEqual(view.threat_model.by_disposition, { undisposed: 1, planned: 1, executed: 0, ticketed: 0, accepted: 0, mitigated: 1 });
  assert.equal(view.threat_model.dispositions.length, 3);
  const template = threatModelTemplate();
  const text = renderMarkdown(view, template);
  assert.equal(renderMarkdown(buildView(synthThreatModel().inputs, OPTS), template), text, "deterministic");
  const headings = [...text.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(headings.map((h) => h[0]), [1, 5, 6, 10, 12], "subsets keep v3 §11 numbering (templates/README.md)");
  assert.equal(headings[3][1], "Threat model and mitigation states");
  assert.match(text, /^# Threat model — run /m);
  assert.match(text, /\| E-002 \| datastore \| users db \| src\/db\.js:1-8 @ head \| <!-- v:threat_model\.elements_list\[1\] -->/);
  assert.match(text, /\| T-001 \| E-002 \| T \| query tampering \| mitigated \(M-001\) \| M-001 \| <!-- v:threat_model\.threats\[0\] -->/);
  assert.match(text, /\| M-001 \| T-001 \| MITIGATION_GAP \| src\/db\.js:3-4 @ head \| <!-- v:threat_model\.mitigations\[0\] -->/);
  assert.match(text, /\| M-002 \| T-002 \| not independently reviewed \| unknown \/ not assessed \| <!-- v:threat_model\.mitigations\[1\] -->/);
  assert.match(text, /\| T-003 \| undisposed \| unknown \/ not assessed \| none \| <!-- v:threat_model\.dispositions\[2\] -->/);
  assert.match(text, /- undisposed: 1 <!-- v:threat_model\.undisposed -->/);
  assert.ok(!/\|[ \t]*\|/.test(text), "no blank table cell");
  for (const s of FORBIDDEN_STRINGS) assert.ok(!text.includes(s));
  assert.match(text, /template: threat-model v1 <!-- v:custody\.template -->/);
  // no receipt ⇒ the mitigation is not independently reviewed
  const bare = buildView(synthThreatModel({ withReceipt: false }).inputs, OPTS);
  assert.deepEqual(bare.threat_model.mitigation_states, {});
  assert.match(renderMarkdown(bare, template), /\| M-001 \| T-001 \| not independently reviewed \|/);
  // the M1 empty model renders (the assessment E2E writes {elements: [], threats: []})
  const empty = synthThreatModel({
    withReceipt: false,
    tamper: (a) => {
      a["threat-model"] = art("threat-model", { elements: [], threats: [] });
      a.dispositions = art("dispositions", { dispositions: [] });
    },
  });
  const emptyText = renderMarkdown(buildView(empty.inputs, OPTS), template);
  assert.match(emptyText, /\(no elements\) <!-- v:threat_model\.elements_list -->/);
  assert.match(emptyText, /\(no threats\) <!-- v:threat_model\.threats -->/);
  assert.ok(!/\|[ \t]*\|/.test(emptyText));
});

test("buildView(threat-model): a dispositions index that names a threat the model does not carry, or disagrees with the threat's recorded disposition, is InconsistentInput(dispositions)", () => {
  const { inputs } = synthThreatModel({ tamper: (a) => (a.dispositions.payload.dispositions[0].kind = "undisposed") });
  assert.throws(() => buildView(inputs, OPTS), (err) => err instanceof InconsistentInput && err.field === "dispositions");
  const { inputs: stray } = synthThreatModel({ tamper: (a) => a.dispositions.payload.dispositions.push({ threat_id: "T-009", kind: "undisposed", ref: "", resolved_via: "none" }) });
  assert.throws(() => buildView(stray, OPTS), (err) => err instanceof InconsistentInput && err.field === "dispositions");
});
