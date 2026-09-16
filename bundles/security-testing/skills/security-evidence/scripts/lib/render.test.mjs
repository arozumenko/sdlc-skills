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
import { InconsistentInput, buildView, marker, parseTemplate, renderMarkdown, sanitize } from "./render.mjs";
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
